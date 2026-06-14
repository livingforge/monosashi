// Stage 0 (§3 S0): take inventory of an artifact bundle. Walks one or more target roots,
// categorises each file, and surfaces mechanical *signals* (has code path? tests?
// eval data? frontmatter declaration?) that the profiler uses as evidence in S1. It also emits
// a per-markdown heading *outline* (read-map, idea ③) so the single-read surveyor/gatherer can
// locate candidate sections directly instead of relying on scrolling.
// This does NOT classify the artifact — it only gathers facts deterministically.
//
// Usage: node inventory.mjs <targetDir> [<targetDir2> ...] [--run-id <id>]
//   Pass several roots to assemble a named *system* that spans separate trees (e.g. an agent
//   suite under agents/<pack>/ plus its skill under skills/<name>/) into one bundle — paths are
//   then recorded relative to the roots' common ancestor so agents/… / skills/<name>/… structure
//   survives for enumerateArtifacts. A single root keeps the old target-relative paths.
// Output: inventory TOON on stdout.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { cliOk, runCli } from "./cli.mjs";
import { toonStringify } from "./serde.mjs";
import { argRunId, makeProvenance, mintRunId, readToolVersion } from "./provenance.mjs";
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx", ".py", ".go", ".rs", ".java", ".rb", ".sh", ".ps1", ".bash"]);
const CONFIG_EXT = new Set([".json", ".yaml", ".yml", ".toml", ".ini", ".env"]);
const DOC_EXT = new Set([".md", ".mdx", ".txt", ".rst"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "__pycache__", ".venv", "venv", "test-results"]);
function categorize(rel) {
    const lower = rel.toLowerCase();
    const ext = extname(lower);
    const parts = lower.split(/[\\/]/);
    const base = parts[parts.length - 1];
    if (/(^|[._-])eval(s)?([._-]|$)/.test(base) || parts.includes("eval") || parts.includes("evals"))
        return "eval";
    if (/(^|[._-])(test|spec)([._-]|$)/.test(base) || parts.includes("test") || parts.includes("tests") || parts.includes("__tests__"))
        return "test";
    if (CODE_EXT.has(ext))
        return "code";
    if (CONFIG_EXT.has(ext))
        return "config";
    if (DOC_EXT.has(ext))
        return "doc";
    if ([".csv", ".jsonl", ".tsv"].includes(ext))
        return "data";
    return "other";
}
function* walk(dir, root) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const e of entries) {
        if (SKIP_DIRS.has(e.name))
            continue;
        const abs = join(dir, e.name);
        if (e.isDirectory())
            yield* walk(abs, root);
        else if (e.isFile())
            yield abs;
    }
}
/** Extract the markdown heading outline (`#`..`######` …) with **1-based line numbers**,
 *  skipping fenced code blocks so a `#` comment inside ``` … ``` is not mistaken for a heading.
 *  This is the per-doc **read-map** (idea ③) the surveyor/gatherer use to *locate* candidate
 *  sections — e.g. a 誤用例 / pitfalls / 対比 section bearing on K3 — before opening the file,
 *  so recall no longer depends on scrolling far enough to notice a labelled section. */
function readOutline(abs) {
    let text;
    try {
        text = readFileSync(abs, "utf8");
    }
    catch {
        return [];
    }
    const out = [];
    let fenced = false;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*(```|~~~)/.test(line)) {
            fenced = !fenced;
            continue;
        }
        if (fenced)
            continue;
        const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
        if (m)
            out.push({ line: i + 1, depth: m[1].length, heading: m[2].trim() });
    }
    return out;
}
/** Read leading YAML frontmatter `name:`/`description:` if present. */
function readFrontmatter(abs) {
    let text;
    try {
        text = readFileSync(abs, "utf8");
    }
    catch {
        return null;
    }
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m)
        return null;
    const fm = {};
    for (const line of m[1].split(/\r?\n/)) {
        const kv = line.match(/^(name|description)\s*:\s*(.+)$/);
        if (kv)
            fm[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
    }
    return Object.keys(fm).length ? fm : null;
}
/** Longest shared leading path segment of several absolute paths — the dir to record file
 *  paths relative to when multiple roots are bundled, so each root's distinguishing structure
 *  (agents/…, skills/<name>/…) is preserved instead of collapsed to a basename. */
export function commonAncestor(absPaths) {
    if (absPaths.length === 0)
        return sep;
    const split = absPaths.map((p) => p.split(sep));
    const first = split[0];
    let n = first.length;
    for (const parts of split.slice(1)) {
        n = Math.min(n, parts.length);
        for (let i = 0; i < n; i++) {
            if (parts[i] !== first[i]) {
                n = i;
                break;
            }
        }
    }
    return first.slice(0, n).join(sep) || sep;
}
/** Guess the declared type from path conventions (.claude/agents, SKILL.md, etc.).
 *  A bundle that carries more than one *structural* convention (agent / skill / harness — e.g.
 *  Monosashi itself ships agents/ + skills/ + a deterministic tool layer) is genuinely a
 *  **composite** and is reported as such rather than collapsed to whichever single type the
 *  scan happens to hit first; forcing one identity is exactly what makes the call model-unstable.
 *  Knowledge/docs are NOT a structural component (almost every bundle carries prose), so they
 *  never push a single-structure bundle into composite — mirroring the M2 derivation. This is the
 *  authoritative declared-type signal: select-tracks adopts it over the profiler's free-text guess. */
export function guessDeclaredType(relPaths) {
    const joined = relPaths.map((p) => p.toLowerCase().split(sep).join("/"));
    const structural = [];
    if (joined.some((p) => /(^|\/)agents?\//.test(p) || p.endsWith(".agent.md")))
        structural.push("agent");
    if (joined.some((p) => p.endsWith("skill.md") || /(^|\/)skills?\//.test(p)))
        structural.push("skill");
    if (joined.some((p) => /harness|guardrail|eval-?harness/.test(p)))
        structural.push("harness");
    if (structural.length > 1)
        return "composite";
    if (structural.length === 1)
        return structural[0];
    if (joined.length > 0 && joined.every((p) => DOC_EXT.has(extname(p))))
        return "knowledge/doc";
    return null;
}
/** Enumerate sub-artifact boundaries so the orchestrator can choose scope instead of
 *  flattening a heterogeneous folder into one "type". Detects skills (skills/<name>/SKILL.md),
 *  agents (.claude/agents/[<pack>/]*.md, *.agent.md), the triggers/ harness layer, and top-level docs. */
export function enumerateArtifacts(relPaths) {
    const paths = relPaths.map((p) => p.split(sep).join("/"));
    const artifacts = [];
    const seen = new Set();
    for (const p of paths) {
        const m = p.match(/^(.*?skills\/([^/]+))\/SKILL\.md$/i);
        if (m && !seen.has("skill:" + m[1])) {
            seen.add("skill:" + m[1]);
            artifacts.push({ type: "skill", path: m[1], name: m[2] });
        }
    }
    for (const p of paths) {
        // `agents/<file>.md` and `agents/<pack>/<file>.md` (build-skill emits agents into a PACK
        // namespace subfolder), plus the GitHub `*.agent.md` suffix layout.
        if ((/(^|\/)agents?\/(?:[^/]+\/)*[^/]+\.md$/i.test(p) || /\.agent\.md$/i.test(p)) && !seen.has("agent:" + p)) {
            seen.add("agent:" + p);
            artifacts.push({ type: "agent", path: p });
        }
    }
    const triggerMembers = new Set();
    for (const p of paths) {
        const m = p.match(/(^|\/)triggers\/([^/]+)\//i);
        if (m)
            triggerMembers.add(m[2]);
    }
    if (triggerMembers.size)
        artifacts.push({ type: "harness", path: "triggers", members: [...triggerMembers].sort() });
    const topDocs = paths.filter((p) => /^[^/]+\.md$/.test(p)).sort();
    if (topDocs.length)
        artifacts.push({ type: "knowledge/doc", path: "(top-level docs)", members: topDocs });
    return artifacts;
}
export function main(argv = process.argv.slice(2)) {
    // Positional args are target roots (one or more); `--run-id <id>` is optional.
    const targets = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--run-id") {
            i++;
            continue;
        }
        if (!argv[i].startsWith("--"))
            targets.push(argv[i]);
    }
    if (targets.length === 0) {
        console.error("Usage: inventory <targetDir> [<targetDir2> ...] [--run-id <id>]");
        process.exit(2);
    }
    // S0 mints the run correlation ID (A5/H3) when the orchestrator did not supply one. Every
    // downstream deterministic stage is told to thread this same --run-id, so the run's artifacts
    // (inventory.toon → plan.toon → scoreboard.toon) are correlatable by `runId`.
    const runId = argRunId(argv) ?? mintRunId(targets[0]);
    // With several roots (a named system spanning separate trees), record each file relative to
    // the roots' common ancestor so agents/… and skills/<name>/… structure survives for
    // enumerateArtifacts. A single root keeps the old target-relative paths (backward compatible).
    const absTargets = targets.map((t) => resolve(t));
    const base = targets.length > 1 ? commonAncestor(absTargets) : null;
    const files = [];
    const frontmatters = [];
    const outlines = [];
    for (const target of targets) {
        const st = statSync(target);
        const roots = st.isDirectory() ? [...walk(target, target)] : [target];
        for (const abs of roots) {
            const rel = base ? relative(base, resolve(abs)) : st.isDirectory() ? relative(target, abs) : abs;
            const relPath = rel.split(sep).join("/");
            let bytes = 0;
            try {
                bytes = statSync(abs).size;
            }
            catch {
                /* ignore */
            }
            const category = categorize(rel);
            files.push({ path: relPath, category, bytes });
            const ext = extname(abs).toLowerCase();
            if (ext === ".md" || ext === ".mdx") {
                const fm = readFrontmatter(abs);
                if (fm)
                    frontmatters.push({ path: relPath, ...fm });
                const headings = readOutline(abs);
                if (headings.length)
                    outlines.push({ path: relPath, headings });
            }
        }
    }
    const counts = files.reduce((acc, f) => {
        acc[f.category] = (acc[f.category] ?? 0) + 1;
        return acc;
    }, {});
    const signals = {
        hasCodePath: (counts.code ?? 0) > 0,
        hasTests: (counts.test ?? 0) > 0,
        hasEval: (counts.eval ?? 0) > 0,
        hasDocs: (counts.doc ?? 0) > 0,
        hasConfig: (counts.config ?? 0) > 0,
        hasFrontmatter: frontmatters.length > 0,
        fileCount: files.length,
    };
    const artifacts = enumerateArtifacts(files.map((f) => f.path));
    const multiArtifact = artifacts.length > 1;
    const recommendedScope = multiArtifact
        ? "multi: prefer per-artifact (cohort) scoring. Whole-bundle-as-one blends heterogeneous units (e.g. code-backed vs doc-only skills) and can mask per-artifact gaps — one missing test file zeroes S2 for the entire cohort. Confirm scope with the user."
        : "single: score as one bundle.";
    const out = {
        provenance: makeProvenance("inventory", runId, targets, undefined, readToolVersion()),
        runId,
        target: targets.length === 1 ? targets[0] : targets.join(" + "),
        ...(targets.length > 1 ? { targets } : {}),
        guessedDeclaredType: guessDeclaredType(files.map((f) => f.path)),
        multiArtifact,
        recommendedScope,
        artifacts,
        counts,
        signals,
        frontmatters,
        files: files.sort((a, b) => a.path.localeCompare(b.path)),
        outlines: outlines.sort((a, b) => a.path.localeCompare(b.path)),
        note: "これは静的インベントリ。能力軸の判定(S1)は profiler が証拠付きで行う。artifacts/recommendedScope はスコープ決定の補助で、種別判定そのものではない。outlines は各 md の見出し+行番号(read-map): surveyor/gatherer が候補節(例: K3 の誤用例/対比節)をスクロール頼みでなく直接特定するための索引。",
    };
    process.stdout.write(toonStringify(out) + "\n");
    cliOk("inventory", `${files.length} files, declared=${out.guessedDeclaredType ?? "?"}, multiArtifact=${multiArtifact}`);
}
// Run as a CLI only when invoked directly (`node inventory.mjs …`); importing the module
// (e.g. from the test suite) is side-effect-free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    runCli("inventory", main);
