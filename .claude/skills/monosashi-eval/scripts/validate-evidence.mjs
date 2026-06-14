// Stage 2.6 (gate after the read stage, before S3): validate the evidence pack (from
// monosashi-surveyor, or the split-mode gatherer) against the plan BEFORE the judges consume
// it. A complete, verbatim pack is what lets the
// scoring passes judge from references alone and NOT re-read the whole target (§7) — so an
// incomplete or paraphrased pack must fail here rather than silently forcing re-reads or
// uncitable scores. Deterministic, static — never executes the target.
//
// Checks (hard errors -> exit 1):
//   - `items` is an array; one item per plan.criteriaToScore[].criterion (none missing)
//   - no unknown criterion (an item not in the plan; a stray `M2` is tolerated with a warning)
//   - every candidate has non-empty string `path` and `snippet`
// Warnings (exit 0, reported):
//   - a criterion whose `candidates` array is empty (gatherer: "absence is evidence" — cite
//     the nearest signal instead of leaving it empty)
//   - with --target <dir>: a candidate snippet not found verbatim in the cited file
//   - a stray `M2` item (M2 is mechanical, needs no pack)
//
// With --superset, a pack covering MORE than plan.criteriaToScore is allowed (extra criteria
// → warning, not error). The merged single-read flow (§5) gathers evidence for ALL criteria
// before tracks are known, so the post-`select-tracks` plan is a subset of the pack.
//
// Candidates cite evidence either as a verbatim `snippet` or (preferred, §7 output-token cut)
// as a 1-based inclusive line range `lines` ("42" or "120-145"). With --target the range is
// checked against the file; with --resolve <out> each `lines` is read back into a concrete
// `snippet` (kept alongside `lines`) so downstream judges score from text without re-reading.
//
// Usage:
//   node validate-evidence.mjs <evidence.toon> <plan.toon> [--target <artifactDir>] [--superset] [--resolve <out.toon>]
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { snippetInFile, parseLineRange, linesInFile, resolveLines, clampSnippet, MAX_SPAN, listTargetFiles, snapPath } from "./evidence-util.mjs";
import { normalizePack, coercionWarnings } from "./normalize.mjs";
import { cliDone, runCli } from "./cli.mjs";
import { readToonFile, toonStringify } from "./serde.mjs";
function parseArgs(argv) {
    const pos = [];
    let target = null;
    let superset = false;
    let resolve = null;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--target")
            target = argv[++i];
        else if (argv[i] === "--superset")
            superset = true;
        else if (argv[i] === "--resolve")
            resolve = argv[++i];
        else
            pos.push(argv[i]);
    }
    return { evidence: pos[0], plan: pos[1], target, superset, resolve };
}
/** Validate an evidence pack against the plan (after absorbing LLM surface drift). Pure — the
 *  only IO is the optional verbatim/line-range check against an on-disk target. Returns the
 *  normalised pack so the CLI can resolve line ranges from it. Exported so the CLI `main()` and
 *  the unit tests share one path. */
export function validateEvidence(rawPack, plan, opts = {}) {
    const target = opts.target ?? null;
    const superset = opts.superset ?? false;
    const { pack, coercions } = normalizePack(rawPack);
    const errors = [];
    const warnings = coercionWarnings(coercions);
    const items = Array.isArray(pack.items) ? pack.items : [];
    if (!Array.isArray(pack.items))
        errors.push("evidence.items is not an array");
    const byCriterion = new Map();
    for (const it of items) {
        if (!it || typeof it.criterion !== "string") {
            errors.push("an items[] entry has no string `criterion`");
            continue;
        }
        if (byCriterion.has(it.criterion))
            errors.push(`duplicate items[] entry: ${it.criterion}`);
        byCriterion.set(it.criterion, it);
    }
    // Coverage: exactly plan.criteriaToScore (M2 is mechanical → tolerated but not required).
    const expected = new Set((plan.criteriaToScore ?? []).map((c) => c.criterion));
    for (const id of expected)
        if (!byCriterion.has(id))
            errors.push(`missing evidence for criterion: ${id}`);
    for (const id of byCriterion.keys()) {
        if (expected.has(id))
            continue;
        if (id === "M2")
            warnings.push("stray M2 evidence item — M2 is mechanical (plan.m2), no pack needed");
        else if (superset)
            warnings.push(`evidence for criterion ${id} not in this (subset) plan — allowed under --superset`);
        else
            errors.push(`evidence for unexpected criterion not in plan: ${id}`);
    }
    // Filesystem-grounded path snapping (パス揺れ吸収): with --target, snap each candidate's cited
    // path to the real file it names under the target, so a drifted/partial/absolute spelling becomes
    // the one canonical on-disk path BEFORE the verbatim/range checks run against it (and before
    // --resolve writes the pack downstream consumers read). A path that snaps to NO unique file is
    // left raw and warned — the verbatim/range check below then reports it as unreadable (a real
    // evidence bug, possibly a hallucinated file), so snapping never hides a bad citation.
    if (target) {
        const files = listTargetFiles(target);
        for (const it of items) {
            const where = `[${it?.criterion ?? "?"}]`;
            for (const c of Array.isArray(it?.candidates) ? it.candidates : []) {
                if (!c || typeof c.path !== "string" || !c.path)
                    continue;
                const snap = snapPath(c.path, files);
                if (snap && snap.path !== c.path) {
                    warnings.push(`${where} snapped path ${c.path} → ${snap.path} (${snap.how}, on-disk; パス揺れ吸収)`);
                    c.path = snap.path;
                }
            }
        }
    }
    // Per-candidate shape + (optionally) verbatim check.
    for (const it of items) {
        const where = `[${it?.criterion ?? "?"}]`;
        const cands = Array.isArray(it?.candidates) ? it.candidates : [];
        if (it && it.criterion !== "M2" && cands.length === 0)
            warnings.push(`${where} no candidates — cite the nearest signal even for an absent capability (gatherer §4)`);
        for (const c of cands) {
            const hasPath = c && typeof c.path === "string" && c.path;
            const hasSnippet = c && typeof c.snippet === "string" && c.snippet;
            const span = c ? parseLineRange(c.lines) : null;
            if (!hasPath || (!hasSnippet && !span)) {
                errors.push(`${where} candidate missing non-empty {path} and one of {lines, snippet}`);
                continue;
            }
            if (!target)
                continue;
            if (span) {
                // Line-range citation: must resolve, and should be a tight span.
                if (!linesInFile(target, c.path, c.lines))
                    warnings.push(`${where} lines ${c.lines} out of range / unreadable in ${c.path} (judge would see no evidence — fix)`);
                else if (span.end - span.start + 1 > MAX_SPAN)
                    warnings.push(`${where} lines ${c.lines} spans ${span.end - span.start + 1} lines — cite a tighter range (§7)`);
            }
            else if (hasSnippet && !snippetInFile(target, c.path, c.snippet)) {
                warnings.push(`${where} snippet not found verbatim in ${c.path} (paraphrased? copy exactly — §7)`);
            }
        }
    }
    return { ok: errors.length === 0, errors, warnings, pack, items: items.length, expected: expected.size };
}
export function main(argv = process.argv.slice(2)) {
    const opt = parseArgs(argv);
    if (!opt.evidence || !opt.plan) {
        console.error("Usage: validate-evidence <evidence.toon> <plan.toon> [--target <dir>]");
        process.exit(2);
    }
    const plan = readToonFile(opt.plan);
    const res = validateEvidence(readToonFile(opt.evidence), plan, {
        target: opt.target,
        superset: opt.superset,
    });
    const { errors, warnings, pack } = res;
    // --resolve: read each line range back into a concrete `snippet` (kept alongside `lines`) so
    // the judge/aggregate judge from text without re-reading the target. Needs --target. Operates
    // on the *normalised* pack, so canonicalised line ranges ("L42" → "42") resolve correctly.
    if (opt.resolve) {
        if (!opt.target) {
            errors.push("--resolve requires --target (line ranges are resolved against the cited files)");
        }
        else {
            const items = Array.isArray(pack.items) ? pack.items : [];
            let clampedCount = 0;
            const resolved = {
                ...pack,
                items: items.map((it) => ({
                    ...it,
                    candidates: (Array.isArray(it.candidates) ? it.candidates : []).map((c) => {
                        if (c && c.lines != null && (!c.snippet || parseLineRange(c.lines))) {
                            const text = resolveLines(opt.target, c.path, c.lines);
                            if (text != null) {
                                // Auto-tighten an over-wide range (§7): a 100+-line resolved snippet is the
                                // biggest evidence-pack token sink, since every scoring pass re-reads it. Clamp
                                // to MAX_SPAN lines (a verbatim contiguous prefix, so --target checks still
                                // match) and narrow `lines` to the kept sub-range so the pack stays consistent.
                                const { text: snippet, clamped } = clampSnippet(text);
                                if (clamped) {
                                    clampedCount++;
                                    const span = parseLineRange(c.lines);
                                    const newLines = span ? `${span.start}-${span.start + MAX_SPAN - 1}` : c.lines;
                                    return { ...c, snippet, lines: newLines };
                                }
                                return { ...c, snippet };
                            }
                        }
                        return c;
                    }),
                })),
            };
            if (clampedCount > 0)
                warnings.push(`auto-tightened ${clampedCount} over-wide snippet(s) to ${MAX_SPAN} lines (§7 token cut) on --resolve`);
            writeFileSync(opt.resolve, toonStringify(resolved) + "\n");
            warnings.push(`resolved pack (line ranges → snippets) written to ${opt.resolve}`);
        }
    }
    const ok = errors.length === 0;
    const report = {
        evidence: opt.evidence,
        ok,
        counts: { items: res.items, expected: res.expected, errors: errors.length, warnings: warnings.length },
        errors,
        warnings,
    };
    process.stderr.write(toonStringify(report) + "\n");
    cliDone("validate-evidence", ok, ok ? `${res.items}/${res.expected} criteria covered (${warnings.length} warning(s))` : `${errors.length} error(s)`);
    process.exit(ok ? 0 : 1);
}
// CLI only when invoked directly; importing the module (tests) is side-effect-free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    runCli("validate-evidence", main);
