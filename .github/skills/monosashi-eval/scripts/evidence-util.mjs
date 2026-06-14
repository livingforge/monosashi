// Shared helper for the evidence-reference scheme (§7 ref-token cut). A judge pass cites
// evidence by index into the gatherer's pack (`evidenceRefs`) instead of re-emitting the
// verbatim snippet. validate-pass and aggregate both resolve those indices back into
// concrete {path, snippet} citations — this module is the single resolver they share.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
// ── Verbatim snippet checking (shared by validate-pass and validate-evidence) ──────────
function normalize(s) {
    return String(s).replace(/\s+/g, "").toLowerCase();
}
// Strip a trailing citation suffix from an evidence path, e.g. "SKILL.md:42",
// "scripts/foo.mjs:10-20", or "foo:12:3" -> the bare file path (§7 cites "path:line").
function stripLineSuffix(path) {
    return path.replace(/:\d+(?:-\d+)?(?::\d+)?$/, "");
}
// Candidate on-disk locations for a cited evidence path. Handles both a directory target
// (join target + path) and a single-file target (the artifact itself, where the evidence
// path typically just repeats the file's own name).
function resolveEvidencePaths(target, path) {
    const clean = stripLineSuffix(path);
    let targetIsFile = false;
    try {
        targetIsFile = statSync(target).isFile();
    }
    catch {
        /* target missing -> fall through to join/relative candidates */
    }
    return targetIsFile ? [target, clean] : [join(target, clean), clean];
}
// ── Filesystem-grounded path snapping (パス揺れ吸収) ────────────────────────────────────
// canonPath (normalize.ts) fixes a cited path's *surface* form (separators, "./", dedot). But a
// judge/surveyor also drifts on the *structure*: an absolute path, a leading dir dropped, or
// extra leading segments — all naming a file that IS in the bundle under a different spelling.
// Left raw, the same file reads as several distinct citations (coverage / dedup / A∩B overlap all
// skew) and a genuinely-hallucinated path is indistinguishable from a mis-spelled real one. So we
// snap each cited path to the unique real file under the target, against the actual on-disk list.
const SNAP_SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "__pycache__", ".venv", "venv", "test-results"]);
/** Every file under `target`, as target-relative POSIX paths (bounded; skips heavy dirs). For a
 *  single-file target, returns its bare basename (matching how evidence cites a single-file artifact).
 *  This is the authoritative on-disk file list a drifted citation is snapped against. */
export function listTargetFiles(target) {
    let st;
    try {
        st = statSync(target);
    }
    catch {
        return [];
    }
    if (st.isFile())
        return [target.split(/[\\/]/).pop() || target];
    const out = [];
    const stack = [target];
    while (stack.length) {
        const dir = stack.pop();
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const e of entries) {
            if (SNAP_SKIP_DIRS.has(e.name))
                continue;
            const abs = join(dir, e.name);
            if (e.isDirectory())
                stack.push(abs);
            else if (e.isFile())
                out.push(relative(target, abs).split(sep).join("/"));
        }
    }
    return out;
}
/** Snap a cited evidence path to the real file it names under `target`, matched case-insensitively
 *  against `files` (the on-disk list — pass it once per pack to avoid re-walking). Strategy, in
 *  order: (1) exact canonical match; (2) the longest **path-suffix** match by trailing segment —
 *  recovers an absolute path, a dropped leading dir, or extra leading segments. The winner must be
 *  UNIQUE: a suffix that two real files share (e.g. two `index.ts`) is ambiguous → null, so we never
 *  silently snap to the wrong file. Returns the matched target-relative path (canonical spelling) +
 *  how it matched, or null when there is no match or it is ambiguous (caller keeps raw + warns). */
export function snapPath(rawPath, files) {
    if (!files.length)
        return null;
    const cited = stripLineSuffix(String(rawPath))
        .replace(/\\/g, "/")
        .replace(/\/{2,}/g, "/")
        .replace(/^(?:\.\/)+/, "")
        .replace(/^\/+/, "")
        .toLowerCase();
    if (!cited)
        return null;
    const exact = files.filter((f) => f.toLowerCase() === cited);
    if (exact.length === 1)
        return { path: exact[0], how: "exact" };
    if (exact.length > 1)
        return null; // case-only collision — ambiguous
    const citedSegs = cited.split("/");
    let best = null;
    let bestN = 0;
    let tie = false;
    for (const f of files) {
        const segs = f.toLowerCase().split("/");
        let n = 0;
        while (n < citedSegs.length && n < segs.length && citedSegs[citedSegs.length - 1 - n] === segs[segs.length - 1 - n])
            n++;
        if (n === 0)
            continue;
        if (n > bestN) {
            bestN = n;
            best = f;
            tie = false;
        }
        else if (n === bestN) {
            tie = true;
        }
    }
    if (best && !tie && bestN >= 1)
        return { path: best, how: "suffix" };
    return null;
}
// ── Line-range references (§7 output-token cut) ────────────────────────────────────────
// A candidate may cite evidence as a 1-based inclusive line range ("42" or "120-145")
// instead of re-emitting the verbatim snippet — the surveyor/gatherer write a tiny range,
// and validate-evidence --resolve reads the actual text back in (deterministically).
/** Parse "N" or "N-M" into {start, end} (1-based, inclusive), or null if malformed. */
export function parseLineRange(lines) {
    if (lines == null)
        return null;
    const m = String(lines)
        .trim()
        .match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!m)
        return null;
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    if (start < 1 || end < start)
        return null;
    return { start, end };
}
/** Resolve a line range in the cited file to its verbatim text, or null if the range is
 *  malformed / the file unreadable / the start line is past EOF. The end is clamped to EOF. */
export function resolveLines(target, path, lines) {
    const r = parseLineRange(lines);
    if (!r)
        return null;
    for (const cand of resolveEvidencePaths(target, path)) {
        try {
            const all = readFileSync(cand, "utf8").split(/\r?\n/);
            if (r.start > all.length)
                continue;
            return all.slice(r.start - 1, Math.min(r.end, all.length)).join("\n");
        }
        catch {
            /* unreadable at this candidate; try the next */
        }
    }
    return null;
}
/** True if the cited line range's start is within the file (i.e. the range resolves). */
export function linesInFile(target, path, lines) {
    return resolveLines(target, path, lines) != null;
}
/** Default tight-span bar (lines). A resolved snippet wider than this over-quotes (§7) and is
 *  the single biggest driver of evidence-pack token bloat, since every scoring pass re-reads it. */
export const MAX_SPAN = 30;
/** Clamp a resolved snippet to at most `maxLines` lines (a contiguous prefix — so it stays
 *  verbatim against the source file and validate-pass --target still matches). Used at
 *  --resolve time to auto-tighten an over-wide range instead of letting a 100+-line block be
 *  copied into the pack and re-read by pass A/B/C. Returns {text, clamped, original}. */
export function clampSnippet(snippet, maxLines = MAX_SPAN) {
    if (snippet == null)
        return { text: snippet, clamped: false, from: 0, to: 0 };
    const lines = String(snippet).split(/\r?\n/);
    if (lines.length <= maxLines)
        return { text: snippet, clamped: false, from: lines.length, to: lines.length };
    return { text: lines.slice(0, maxLines).join("\n"), clamped: true, from: lines.length, to: maxLines };
}
/** A candidate's verbatim text: its explicit `snippet`, else resolved from its `lines`. */
export function candidateText(target, c) {
    if (c && typeof c.snippet === "string" && c.snippet)
        return c.snippet;
    if (c && c.lines != null && target)
        return resolveLines(target, c.path, c.lines);
    return null;
}
/** True if `snippet` occurs (whitespace-normalised) in the cited file under `target` —
 *  i.e. the citation is verbatim, not paraphrased (§7 anti-hallucination). Empty snippet
 *  is treated as present (emptiness is handled by the caller). */
export function snippetInFile(target, path, snippet) {
    if (!snippet)
        return true;
    const needle = normalize(snippet).slice(0, 40); // first ~40 non-ws chars
    if (needle.length === 0)
        return true;
    for (const cand of resolveEvidencePaths(target, path)) {
        try {
            if (normalize(readFileSync(cand, "utf8")).includes(needle))
                return true;
        }
        catch {
            /* unreadable at this candidate; try the next */
        }
    }
    return false;
}
/** Build a criterion → candidate[] lookup from an evidence pack. */
export function indexPack(pack) {
    const m = new Map();
    if (!pack || !Array.isArray(pack.items))
        return m;
    for (const item of pack.items) {
        if (!item || typeof item.criterion !== "string")
            continue;
        m.set(item.criterion, (Array.isArray(item.candidates) ? item.candidates : []).map((c) => ({ path: c.path, snippet: c.snippet, lines: c.lines })));
    }
    return m;
}
/** Resolve a single score's citations: pack references first (looked up by the score's own
 *  criterion), then any inline evidence. `unresolved` lists ref indices with no matching
 *  candidate (a hard error for validate-pass). When `packIndex` is null, refs cannot be
 *  resolved and are all reported as unresolved. */
export function resolveScoreEvidence(score, packIndex) {
    const resolved = [];
    const unresolved = [];
    const cands = packIndex?.get(score.criterion) ?? null;
    for (const ref of score.evidenceRefs ?? []) {
        const c = cands && Number.isInteger(ref) ? cands[ref] : undefined;
        // A candidate resolves if it carries a verbatim snippet OR a line range (resolved to
        // text downstream by candidateText with a target).
        if (c && c.path && (c.snippet || c.lines != null))
            resolved.push({ ...c, source: "ref", ref });
        else
            unresolved.push(ref);
    }
    for (const e of score.evidence ?? []) {
        if (e && e.path && (e.snippet || e.lines != null))
            resolved.push({ path: e.path, snippet: e.snippet, lines: e.lines, source: "inline" });
    }
    return { resolved, unresolved };
}
