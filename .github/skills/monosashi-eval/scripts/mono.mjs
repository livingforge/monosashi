// mono.ts — the single LLM-facing entrypoint for the whole Monosashi evaluation.
//
// WHY THIS EXISTS
// The pipeline is ~12 deterministic tools threaded through ~20 stage files, with stage-specific
// flags, an `eval-out/<slug>/` output convention, and TOON passed file-to-file. Driving that by
// hand puts every fragile, deterministic detail on the orchestrating LLM: it had to discover the
// skill dir, mint and thread a slug through ~14 filenames, build per-stage flag grammars, pick the
// right `--target`, branch on `shouldRun` read out of a TOON file, and — worst on weaker models /
// GitHub Copilot — write each producer's stdout to a file with a shell `> file` redirect. On
// Windows PowerShell that redirect writes UTF-16+BOM, which `serde` (utf8-only) then rejects:
// silent, shell-dependent TOON corruption.
//
// mono removes ALL of that from the model:
//   * it resolves the skill dir from its own location (no path discovery),
//   * `init` mints the slug + `eval-out/<slug>/` and writes a run.toon manifest once,
//   * every later command takes only `--run <dir>` and resolves the ~14 conventional filenames,
//     the `--target` base, and the per-stage flags itself,
//   * it invokes each tool IN-PROCESS, captures its stdout, and writes the file itself as UTF-8
//     (no shell redirect anywhere — the UTF-16/BOM corruption class is gone by construction),
//   * `next` is a state machine: it auto-runs the deterministic stages (inventory, full-plan,
//     select-tracks, the validators, second-opinion, slice-pack, contested, aggregate, report)
//     and stops only where a *subagent* must run (surveyor, judge A/B/C), printing exactly what to
//     spawn and which files to write. The model loops: `init` → `next` → (spawn when told) →
//     `next` → … → DONE. It never constructs a path, a flag, or a redirect.
//
// The 12 tools keep their own CLIs for tests/dev (import-safe guards), but mono is the only
// surface the agents are pointed at.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { toonParse, toonStringify } from "./serde.mjs";
import { commonAncestor, main as inventoryMain } from "./inventory.mjs";
import { main as fullPlanMain } from "./full-plan.mjs";
import { main as selectTracksMain } from "./select-tracks.mjs";
import { main as validateProfileMain } from "./validate-profile.mjs";
import { main as validateEvidenceMain } from "./validate-evidence.mjs";
import { main as secondOpinionMain } from "./second-opinion.mjs";
import { main as slicePackMain } from "./slice-pack.mjs";
import { main as augmentPackMain } from "./augment-pack.mjs";
import { main as validatePassMain } from "./validate-pass.mjs";
import { main as contestedMain } from "./contested.mjs";
import { main as aggregateMain } from "./aggregate.mjs";
import { main as reportMain } from "./report.mjs";
import { main as cohortMain } from "./cohort.mjs";
import { mintRunId } from "./provenance.mjs";
/** This tool's own absolute path (for the "then call mono" hints printed to the agent). */
const MONO = fileURLToPath(import.meta.url);
/** Cap presets per autonomy level — the external knob that bounds the loop. Tighter = fewer
 *  self-driven retries before a terminal `needsHumanReview` stop. A normal run spends ~5–6 `next`
 *  invocations and spawns each stage once, so even `strict` clears the happy path with headroom. */
export const AUTONOMY_CAPS = {
    strict: { maxNext: 15, maxAttemptsPerStage: 1, maxStalls: 1 },
    standard: { maxNext: 40, maxAttemptsPerStage: 3, maxStalls: 3 },
    auto: { maxNext: 80, maxAttemptsPerStage: 6, maxStalls: 5 },
};
/** Pure, IO-free abort decision: the loop is **structurally** halted (not merely asked to stop) once
 *  any bound is exceeded. The returned `reason` is surfaced verbatim by the caller's terminal `die`.
 *  Exported (with `AUTONOMY_CAPS`) so the regression suite can pin the cap behaviour directly. */
export function governorCheck(gov, caps) {
    if (gov.nextInvocations > caps.maxNext)
        return { abort: true, reason: `ran ${gov.nextInvocations} 'next' invocations, over the cap of ${caps.maxNext}` };
    for (const [stage, n] of Object.entries(gov.attempts)) {
        if (n > caps.maxAttemptsPerStage)
            return { abort: true, reason: `stage '${stage}' spawned ${n}×, over the per-stage cap of ${caps.maxAttemptsPerStage}` };
    }
    if (gov.stalls > caps.maxStalls)
        return { abort: true, reason: `${gov.stalls} consecutive no-progress 'next' invocations, over the cap of ${caps.maxStalls}` };
    return { abort: false };
}
/** Conventional stage filenames inside the run dir — owned here, never spelled by the LLM.
 *  The five LLM-authored artifacts (profile / evidence / passA–C) are authored as **JSON** by the
 *  subagents and converted to canonical TOON by `ingest()` — LLMs serialize JSON reliably, so the
 *  hand-authored-TOON error class (blank lines in arrays, unquoted `():[]`, bad indentation, count
 *  headers) is gone by construction. Every deterministic stage still reads/writes the `.toon`. */
const F = {
    manifest: "run.toon",
    inventory: "inventory.toon",
    fullPlan: "full-plan.toon",
    profileJson: "profile.json",
    profile: "profile.toon",
    evidenceJson: "evidence.json",
    evidence: "evidence.toon",
    plan: "plan.toon",
    passAJson: "passA.json",
    passA: "passA.toon",
    passAPatch: "passA.patch.json",
    reviewPlan: "review-plan.toon",
    reviewGatherJson: "review-gather.json",
    reviewGather: "review-gather.toon",
    reviewEvidence: "review-evidence.toon",
    passBJson: "passB.json",
    passB: "passB.toon",
    passBPatch: "passB.patch.json",
    tiebreakPlan: "tiebreak-plan.toon",
    tiebreakEvidence: "tiebreak-evidence.toon",
    passCJson: "passC.json",
    passC: "passC.toon",
    passCPatch: "passC.patch.json",
    scoreboard: "scoreboard.toon",
    html: "scoreboard.html",
    scorecard: "scorecard.toon",
};
// ── stdout/stderr channels ──────────────────────────────────────────────────
// `out` = the actionable instruction the agent must act on (SPAWN / DONE / usage). `log` = stage
// progress. Both reach the agent's terminal; neither is ever TOON, so there is nothing to redirect.
const out = (s) => process.stdout.write(s + "\n");
const log = (s) => process.stderr.write(s + "\n");
/** Run a tool's `main(argv)` while capturing its stdout/stderr/exit, restoring the real streams
 *  afterward. A producer's TOON lands in `stdout` (mono writes it to a file as UTF-8); a
 *  validator's signal is its exit code. A thrown error (malformed TOON, ENOENT) is captured too —
 *  the same failure `runCli` would turn into an `ERR` line, surfaced here as `error`. */
function invoke(toolMain, argv) {
    const origOut = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    const origExit = process.exit.bind(process);
    let stdout = "";
    let stderr = "";
    let exitCode;
    let error;
    const sink = (buf) => typeof buf === "string" ? buf : Buffer.from(buf).toString("utf8");
    process.stdout.write = ((b) => { stdout += sink(b); return true; });
    process.stderr.write = ((b) => { stderr += sink(b); return true; });
    process.exit = ((code) => { exitCode = code ?? 0; throw new Error("__mono_exit__"); });
    try {
        toolMain(argv);
    }
    catch (e) {
        if (!(e instanceof Error) || e.message !== "__mono_exit__")
            error = e instanceof Error ? e : new Error(String(e));
    }
    finally {
        process.stdout.write = origOut;
        process.stderr.write = origErr;
        process.exit = origExit;
    }
    return { stdout, stderr, exitCode, error };
}
const succeeded = (c) => !c.error && (c.exitCode === undefined || c.exitCode === 0);
const reason = (c, tool) => c.error ? c.error.message : (c.stderr.trim() || c.stdout.trim() || `${tool}: exit ${c.exitCode}`);
/** Last non-empty line of a tool's stderr — the concise `OK <tool>: …` status, not its full report. */
const lastLine = (s) => s.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
/** Hard-stop the whole run with a clear instruction for the agent, exit non-zero. */
function die(message, remedy) {
    log("");
    out(`ERR: ${message}`);
    if (remedy)
        out(`NEXT: ${remedy}`);
    process.exit(1);
}
/** Terminal, structural halt of the run loop (A1 暴走防止). Distinct from `die` (a recoverable gate
 *  ERR/NEXT): an ABORT means a governor bound was hit, so re-running `next` will not help — the run
 *  needs human review or a fresh `init` with a higher autonomy / cap. Exits non-zero. */
function abort(m, reason) {
    log("");
    out(`ABORT: loop governor halted the run (autonomy=${m.autonomy ?? "standard"}) — ${reason}`);
    out(`  this is a structural runaway stop, not a recoverable gate; re-running 'next' will not advance.`);
    out(`  NEXT: review eval-out/${m.slug}; if the run was legitimately long, re-init with --autonomy auto`);
    out(`        or raise the specific bound (--max-next / --max-attempts / --max-stalls).`);
    process.exit(1);
}
/** Run a *producer* tool and persist its TOON stdout to `<outdir>/<outName>` as UTF-8. */
function produce(m, tool, toolMain, argv, outName) {
    const cap = invoke(toolMain, argv);
    if (!succeeded(cap))
        die(`${tool} failed: ${reason(cap, tool)}`, `fix the inputs above, then re-run: ${nextCmd(m)}`);
    writeFileSync(join(m.outdir, outName), cap.stdout, "utf8");
    log(`  ✓ ${tool} → ${outName}${lastLine(cap.stderr) ? "  (" + lastLine(cap.stderr) + ")" : ""}`);
}
/** Run a *validator/in-place* tool; on a hard error stop the run with a re-emit instruction.
 *  `onFailDelete` names derived artifacts to remove before stopping: when a gate rejects a TOON that
 *  was converted from an agent's JSON, deleting the stale `.toon` makes the next run reconvert from
 *  the corrected `.json` (the agent owns the `.json`; the `.toon` is a derived build artifact). */
function gate(m, tool, toolMain, argv, remedy, onFailDelete = []) {
    const cap = invoke(toolMain, argv);
    if (!succeeded(cap)) {
        for (const name of onFailDelete)
            rmSync(f(m, name), { force: true });
        die(`${tool} gate failed: ${reason(cap, tool)}`, remedy);
    }
    log(`  ✓ ${tool}${lastLine(cap.stderr) ? "  (" + lastLine(cap.stderr) + ")" : ""}`);
}
/** Ingest an agent-authored JSON artifact into canonical TOON.
 *  The subagents emit JSON (which LLMs serialize reliably); `mono` converts it to TOON with the
 *  vetted serializer, so the hand-authored-TOON failure class is removed *by construction* — none of
 *  blank-lines-in-arrays, unquoted special chars, indentation drift, or wrong count headers can occur
 *  in machine-serialized output. Returns true once the `.toon` exists (already converted, or written
 *  directly as `.toon` by a legacy path); false if the agent has not written the `.json` yet (the
 *  caller then spawns it). A JSON **syntax** error stops the run with a re-emit instruction; schema /
 *  coverage problems are still caught downstream by the unchanged `.toon` validators. */
function ingest(m, jsonName, toonName, agent) {
    if (has(m, toonName))
        return true; // already converted, or written directly as TOON
    if (!has(m, jsonName))
        return false; // agent still owes us the JSON
    let value;
    try {
        value = JSON.parse(readFileSync(f(m, jsonName), "utf8"));
    }
    catch (e) {
        die(`malformed JSON in ${jsonName}: ${e instanceof Error ? e.message : String(e)}`, `have ${agent} re-emit ${jsonName} as valid JSON, then re-run: ${nextCmd(m)}`);
    }
    writeFileSync(f(m, toonName), toonStringify(value) + "\n", "utf8");
    log(`  ✓ ingest ${jsonName} → ${toonName}  (JSON → canonical TOON)`);
    return true;
}
/** Merge a judge-authored re-emit *patch* (only the re-scored criteria) into an existing pass's
 *  `scores[]`, keyed by criterion id. The patch entry WINS for an id already present (option 1:
 *  overwrite — a re-emit may legitimately re-score a flagged criterion), and every overwrite is
 *  reported in `overwritten` so the caller can log it (audit, matching normalize.ts' "never change
 *  silently"). Pure, IO-free. Exported so the regression suite pins the merge/overwrite behaviour. */
export function mergePassScores(base, patch) {
    const byId = new Map();
    for (const s of Array.isArray(base.scores) ? base.scores : [])
        byId.set(s.criterion, s);
    const added = [];
    const overwritten = [];
    for (const s of Array.isArray(patch.scores) ? patch.scores : []) {
        (byId.has(s.criterion) ? overwritten : added).push(s.criterion);
        byId.set(s.criterion, s);
    }
    return { merged: { ...base, scores: [...byId.values()] }, added, overwritten };
}
/** Apply a judge-authored re-emit patch onto an existing pass TOON, so a re-emit carries ONLY the
 *  flagged criteria — never the whole pass, and the judge never reads back the prior JSON (the
 *  reference-token cut a full re-emit would cost). No-op on the happy path (no patch pending) and
 *  when no base exists yet (a full re-emit is still owed). The patch overwrites an existing criterion
 *  (logged) per option 1, and is removed on a successful merge so the next gate runs on the merged
 *  pass. A malformed patch stops the run with a re-emit instruction (mirrors `ingest`). */
function applyPatch(m, toonName, patchJsonName) {
    if (!has(m, patchJsonName) || !has(m, toonName))
        return;
    let patch;
    try {
        patch = JSON.parse(readFileSync(f(m, patchJsonName), "utf8"));
    }
    catch (e) {
        die(`malformed JSON in ${patchJsonName}: ${e instanceof Error ? e.message : String(e)}`, `re-emit ${patchJsonName} as valid JSON (only the flagged criteria's scores), then re-run: ${nextCmd(m)}`);
    }
    const base = readToon(f(m, toonName));
    const { merged, added, overwritten } = mergePassScores(base, patch);
    for (const id of overwritten)
        log(`  ⚠ patch re-scored ${id} in ${toonName} — overwrote the prior score (再採点として上書き)`);
    writeFileSync(f(m, toonName), toonStringify(merged) + "\n", "utf8");
    rmSync(f(m, patchJsonName), { force: true });
    log(`  ✓ merged ${patchJsonName} → ${toonName}  (+${added.length} added, ${overwritten.length} overwritten; 差分マージ — 全文再作成を回避)`);
}
// ── Path helpers ─────────────────────────────────────────────────────────────
const f = (m, name) => join(m.outdir, name);
const has = (m, name) => existsSync(f(m, name));
const q = (s) => /\s/.test(s) ? `"${s}"` : s;
const nextCmd = (m) => `node ${q(MONO)} next --run ${q(m.outdir)}`;
// ── Loop-governor helpers ────────────────────────────────────────────────────
/** Every stage file the loop can produce — the basis of the progress fingerprint. Includes the
 *  agent-authored `.json` so that a gate re-emit loop (same fileset, rewritten content) reads as
 *  no-progress and is caught by the stall cap. Order-independent: `fingerprint` sorts implicitly by
 *  filtering this fixed list. */
const STAGE_FILES = [
    F.inventory, F.fullPlan, F.profileJson, F.profile, F.evidenceJson, F.evidence, F.plan,
    F.passAJson, F.passA, F.passAPatch, F.reviewPlan, F.reviewGatherJson, F.reviewGather, F.reviewEvidence, F.passBJson, F.passB, F.passBPatch,
    F.tiebreakPlan, F.tiebreakEvidence, F.passCJson, F.passC, F.passCPatch, F.scoreboard, F.html,
];
/** The set of stage files that currently exist, as a stable string — two consecutive `next`
 *  invocations with the same fingerprint made no progress. */
const fingerprint = (m) => STAGE_FILES.filter((n) => has(m, n)).join(",");
/** Backfill the governor/caps/autonomy on a manifest (older runs lack them) and return the governor.
 *  Idempotent: only fills what is missing, so persisted counters survive. */
function ensureGovernor(m) {
    if (!m.autonomy)
        m.autonomy = "standard";
    if (!m.caps)
        m.caps = AUTONOMY_CAPS[m.autonomy];
    if (!m.governor)
        m.governor = { nextInvocations: 0, attempts: {}, lastFingerprint: "<init>", stalls: 0 };
    if (!m.governor.attempts)
        m.governor.attempts = {};
    return m.governor;
}
/** Persist the (mutated) manifest back to `run.toon` — called after every counter change so the
 *  bound survives the process exits that `spawn`/`die` perform mid-loop. */
const saveManifest = (m) => {
    writeFileSync(join(m.outdir, F.manifest), toonStringify(m) + "\n", "utf8");
};
/** The base dir line-ranges in the evidence pack are resolved against. Single root: that root.
 *  Multiple roots: their common ancestor (inventory records file paths relative to it). */
const targetBase = (m) => (m.targets.length > 1 ? commonAncestor(m.targets) : m.targets[0]);
/** Walk up from `start` to the nearest ancestor that holds a `.git` entry — i.e. the repo root
 *  of the evaluated system. Returns undefined if none is found before the filesystem root.
 *  This is what lets `eval-out/` be anchored to a *stable, cwd-independent* place: the agent no
 *  longer has to `cd` into the project root before `mono init` (the historical reason it did). */
function repoRoot(start) {
    let dir = resolve(start);
    try {
        if (statSync(dir).isFile())
            dir = dirname(dir);
    }
    catch { /* start may not exist yet */ }
    for (;;) {
        if (existsSync(join(dir, ".git")))
            return dir;
        const parent = dirname(dir);
        if (parent === dir)
            return undefined; // hit the filesystem root
        dir = parent;
    }
}
/** Where `eval-out/` lives — resolved WITHOUT depending on the shell's cwd. Order:
 *    1. an explicit `--out <dir>` (wins, resolved to absolute), else
 *    2. the repo root of `anchor` (so results land next to the evaluated system), else
 *    3. `process.cwd()` (legacy fallback for a non-git target — `cd` still matters only here).
 *  Returns the directory that should *contain* `eval-out/`. The caller always appends the
 *  `eval-out/` segment, so an explicit `--out` that already ends in `eval-out` is treated as
 *  the eval-out dir itself (its parent is returned) — `--out eval-out` must not nest as
 *  `eval-out/eval-out/<slug>`. */
export function outRoot(explicit, anchor) {
    if (explicit) {
        const abs = resolve(explicit);
        return basename(abs) === "eval-out" ? dirname(abs) : abs;
    }
    return repoRoot(anchor) ?? process.cwd();
}
function readToon(path) {
    return toonParse(readFileSync(path, "utf8"));
}
// ── init ─────────────────────────────────────────────────────────────────────
function cmdInit(argv) {
    const targets = [];
    let name;
    let outArg;
    let weighting = "internal";
    let autonomy = "standard";
    let reviewRegather = false;
    const capOverride = {};
    const USAGE = `usage: mono init <targetRoot> [<targetRoot2> …] [--name <slug>] [--out <dir>] [--weighting internal|external] [--autonomy strict|standard|auto] [--max-next N] [--max-attempts N] [--max-stalls N] [--review-regather|--no-review-regather]`;
    const num = (flag, raw) => {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1)
            die(`${flag} must be a positive integer (got ${raw})`);
        return n;
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--name")
            name = argv[++i];
        else if (a === "--out")
            outArg = argv[++i];
        else if (a === "--weighting") {
            const w = argv[++i];
            if (w !== "internal" && w !== "external")
                die(`--weighting must be internal|external (got ${w})`);
            weighting = w;
        }
        else if (a === "--autonomy") {
            const w = argv[++i];
            if (w !== "strict" && w !== "standard" && w !== "auto")
                die(`--autonomy must be strict|standard|auto (got ${w})`);
            autonomy = w;
        }
        else if (a === "--max-next")
            capOverride.maxNext = num("--max-next", argv[++i]);
        else if (a === "--max-attempts")
            capOverride.maxAttemptsPerStage = num("--max-attempts", argv[++i]);
        else if (a === "--max-stalls")
            capOverride.maxStalls = num("--max-stalls", argv[++i]);
        else if (a === "--review-regather")
            reviewRegather = true;
        else if (a === "--no-review-regather")
            reviewRegather = false;
        else if (!a.startsWith("--"))
            targets.push(a);
        else
            die(`unknown flag ${a}`, USAGE);
    }
    if (targets.length === 0)
        die("no target roots given", USAGE);
    const absTargets = targets.map((t) => resolve(t));
    for (const t of absTargets) {
        if (!existsSync(t))
            die(`target root does not exist: ${t}`);
    }
    const slug = (name ?? basename(absTargets[0])).replace(/[^A-Za-z0-9._-]/g, "-") || "run";
    // Anchor eval-out to the evaluated system's repo root (not cwd) so `mono init` is cwd-independent.
    const outdir = join(outRoot(outArg, absTargets[0]), "eval-out", slug);
    mkdirSync(outdir, { recursive: true });
    // Caps = the autonomy preset, with any explicit --max-* overrides applied on top.
    const caps = { ...AUTONOMY_CAPS[autonomy], ...capOverride };
    const m = {
        runId: mintRunId(absTargets[0]), slug, targets: absTargets, outdir, weighting, autonomy, caps,
        reviewRegather,
        governor: { nextInvocations: 0, attempts: {}, lastFingerprint: "<init>", stalls: 0 },
    };
    writeFileSync(join(outdir, F.manifest), toonStringify(m) + "\n", "utf8");
    log(`Initialised run '${slug}' (runId=${m.runId})`);
    log(`  roots:     ${absTargets.join("  +  ")}`);
    log(`  outdir:    ${outdir}`);
    log(`  weighting: ${weighting}`);
    log(`  autonomy:  ${autonomy}  (maxNext=${caps.maxNext}, maxAttemptsPerStage=${caps.maxAttemptsPerStage}, maxStalls=${caps.maxStalls})`);
    log(`  review-regather: ${reviewRegather ? "on (pass B re-extracts evidence for the review criteria)" : "off (pass B uses the sliced S1 pack)"}`);
    out(`OK: run initialised at ${outdir}`);
    out(`NEXT: ${nextCmd(m)}`);
}
// ── manifest loader (for next/status) ────────────────────────────────────────
function loadManifest(argv) {
    let runDir;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--run")
            runDir = argv[++i];
    }
    if (!runDir) {
        // Auto-discover: a single eval-out/*/run.toon. Look in the repo-anchored eval-out (the same
        // place `init` writes), falling back to cwd — so discovery survives an arbitrary cwd too.
        const base = join(outRoot(undefined, process.cwd()), "eval-out");
        const found = [];
        if (existsSync(base)) {
            for (const d of readdirSync(base)) {
                const p = join(base, d, F.manifest);
                if (existsSync(p))
                    found.push(join(base, d));
            }
        }
        if (found.length === 1)
            runDir = found[0];
        else if (found.length === 0)
            die("no run found", "run `mono init <targetRoot>` first");
        else
            die(`multiple runs under eval-out/ — pass --run <dir>`, `one of: ${found.join(", ")}`);
    }
    const abs = isAbsolute(runDir) ? runDir : resolve(runDir);
    const mp = join(abs, F.manifest);
    if (!existsSync(mp))
        die(`no ${F.manifest} in ${abs}`, "run `mono init <targetRoot>` first");
    const m = readToon(mp);
    m.outdir = abs; // trust the on-disk location over a possibly-relocated stored path
    return m;
}
// ── spawn instruction printer ────────────────────────────────────────────────
function spawn(m, stageKey, agent, label, inputs, outputs, note) {
    // Count this (re-)spawn of the stage and persist it BEFORE printing, so the bound survives the
    // exit below. Exceeding the per-stage cap is a terminal structural stop, not another SPAWN.
    const gov = ensureGovernor(m);
    gov.attempts[stageKey] = (gov.attempts[stageKey] ?? 0) + 1;
    saveManifest(m);
    const verdict = governorCheck(gov, m.caps);
    if (verdict.abort)
        abort(m, verdict.reason);
    out("");
    out(`SPAWN: ${agent}  —  ${label}`);
    out(`  read-only inputs:`);
    for (const i of inputs)
        out(`    - ${i}`);
    out(`  write as JSON (absolute paths, UTF-8, via your Write tool — mono converts your JSON to canonical TOON; never a shell '>' redirect):`);
    for (const o of outputs)
        out(`    - ${o}`);
    out(`  task: ${note}`);
    out(`  when the file(s) above exist, continue: ${nextCmd(m)}`);
    process.exit(0);
}
// ── next: the state machine ──────────────────────────────────────────────────
function cmdNext(argv) {
    const m = loadManifest(argv);
    const base = targetBase(m);
    log(`Run '${m.slug}' — advancing pipeline (outdir ${m.outdir})`);
    // Loop governor (A1): count this invocation, detect a no-progress stall, and halt structurally if
    // any bound is exceeded — persisted every call so the cap survives the spawn/die process exits.
    const gov = ensureGovernor(m);
    gov.nextInvocations += 1;
    const fp = fingerprint(m);
    if (fp === gov.lastFingerprint)
        gov.stalls += 1;
    else {
        gov.stalls = 0;
        gov.lastFingerprint = fp;
    }
    saveManifest(m);
    const verdict = governorCheck(gov, m.caps);
    if (verdict.abort)
        abort(m, verdict.reason);
    // S0 — inventory + full-plan (deterministic)
    if (!has(m, F.inventory))
        produce(m, "inventory", inventoryMain, [...m.targets, "--run-id", m.runId], F.inventory);
    if (!has(m, F.fullPlan))
        produce(m, "full-plan", fullPlanMain, [], F.fullPlan);
    // S1 — surveyor (subagent): capability profile + all-criteria evidence pack, one read.
    // The surveyor writes profile.json + evidence.json; mono converts each to canonical TOON. On a
    // re-emit, the rejected .toon was deleted at its gate, so ingest reconverts from the fixed .json.
    const haveProfile = ingest(m, F.profileJson, F.profile, "monosashi-surveyor");
    const haveEvidence = ingest(m, F.evidenceJson, F.evidence, "monosashi-surveyor");
    if (!haveProfile || !haveEvidence) {
        spawn(m, "S1", "monosashi-surveyor", "S1 single read → profile + evidence", [`bundle root(s): ${m.targets.join("  +  ")}`, f(m, F.inventory), f(m, F.fullPlan)], [f(m, F.profileJson), f(m, F.evidenceJson)], "read the bundle ONCE; write the capability profile (axes / declaredType / hasCodePath) AND the all-criteria evidence pack ({path, lines, note} candidates for EVERY criterion in full-plan.toon, paths exactly as listed in inventory.toon) — both as JSON (schema in docs/schemas.md); mono converts your JSON to canonical TOON.");
    }
    // S1.5 — validate profile (gate). On failure delete the derived profile.toon → reconvert from JSON.
    gate(m, "validate-profile", validateProfileMain, [f(m, F.profile)], "have monosashi-surveyor re-emit profile.json with the schema fixed, then re-run next", [F.profile]);
    // S2 — select tracks (deterministic): plan + embedded rubric slice + mechanical M2
    if (!has(m, F.plan)) {
        produce(m, "select-tracks", selectTracksMain, [f(m, F.profile), "--inventory", f(m, F.inventory), "--run-id", m.runId], F.plan);
    }
    // S2.6 — validate + resolve evidence (gate, rewrites evidence.toon in place). Run once, before
    // pass A exists: it turns line ranges into snippets so the judge scores without reopening the target.
    // The judge writes passA.json; mono converts to passA.toon.
    if (!ingest(m, F.passAJson, F.passA, "monosashi-judge")) {
        gate(m, "validate-evidence", validateEvidenceMain, [f(m, F.evidence), f(m, F.plan), "--target", base, "--superset", "--resolve", f(m, F.evidence)], "have monosashi-surveyor re-emit evidence.json (cover every plan criterion; valid {path,lines}), then re-run next", [F.evidence]);
        // S3 — judge pass A (subagent), full
        spawn(m, "S3:A", "monosashi-judge", "S3 pass A (full)", [f(m, F.plan), f(m, F.evidence)], [f(m, F.passAJson)], "score EVERY plan.criteriaToScore 0–4 (or N/A) from the embedded verbatim levels + the evidence pack, as JSON (schema in docs/schemas.md); cite evidence by evidenceRefs index; do NOT score M2 (it is mechanical, plan.m2); do NOT reopen the target (an insufficient pack ⇒ low confidence, not a re-read). mono converts your JSON to canonical TOON.");
    }
    // S3.5 — validate pass A (gate, --fix forces low confidence on evidence-less scores, in place).
    // A pending re-emit patch (only the flagged criteria) is merged into passA.toon FIRST, so the
    // judge re-scores just those criteria — never the whole pass. On failure the toon is kept (the
    // merge base) and the judge writes passA.patch.json; mono merges it on the next `next`.
    applyPatch(m, F.passA, F.passAPatch);
    gate(m, "validate-pass:A", validatePassMain, [f(m, F.passA), f(m, F.plan), "--target", base, "--evidence", f(m, F.evidence), "--fix", f(m, F.passA)], "have monosashi-judge write ONLY the criteria flagged in the errors above to passA.patch.json (a {scores:[…]} JSON with just those criteria, same schema — do NOT rewrite the others), then re-run next", []);
    // S3.2 — second-opinion selector (deterministic)
    if (!has(m, F.reviewPlan))
        produce(m, "second-opinion", secondOpinionMain, [f(m, F.passA), f(m, F.plan)], F.reviewPlan);
    const review = readToon(f(m, F.reviewPlan));
    if (review.shouldRun) {
        // Build pass B's evidence ONCE. Default: slice the master pack to the review criteria (their
        // candidate arrays are index-identical to the master, so refs resolve everywhere). With
        // `--review-regather`: first re-extract evidence for ONLY the review criteria (S3.25, gatherer),
        // then AUGMENT the master with it — so pass B sees A's evidence PLUS what the first sweep missed.
        if (!has(m, F.reviewEvidence)) {
            if (m.reviewRegather) {
                // S3.25 — targeted re-extraction (subagent). The gatherer re-reads the bundle for the review
                // criteria; the judge still never re-reads (extraction stays the gatherer's job, §7), and the
                // fresh pack passes the SAME S2.6 integrity gate (validate-evidence --resolve) before use.
                if (!ingest(m, F.reviewGatherJson, F.reviewGather, "monosashi-gatherer")) {
                    spawn(m, "S3:gatherB", "monosashi-gatherer", "S3.25 re-gather (second-opinion criteria)", [`bundle root(s): ${m.targets.join("  +  ")}`, f(m, F.reviewPlan), f(m, F.inventory)], [f(m, F.reviewGatherJson)], "read the bundle and gather FRESH {path, lines, note} candidates (both raises: and limits:) for EVERY criterion in review-plan.criteriaToScore, as JSON (schema in docs/schemas.md). This AUGMENTS pass A's evidence for the second opinion, so prefer citations the first single-sweep may have missed. Do NOT score. mono converts your JSON to canonical TOON.");
                }
                gate(m, "validate-evidence:B", validateEvidenceMain, [f(m, F.reviewGather), f(m, F.reviewPlan), "--target", base, "--superset", "--resolve", f(m, F.reviewGather)], "have monosashi-gatherer re-emit review-gather.json (cover every review-plan criterion; valid {path,lines}), then re-run next", [F.reviewGather]);
                // Append the re-gathered candidates into the master (append-only ⇒ pass A's indices stay
                // valid) and emit the review slice pass B scores from. Master↔slice index alignment is
                // preserved, so validate-pass:B and aggregate still resolve B's refs against the master.
                produce(m, "augment-pack:B", augmentPackMain, [f(m, F.evidence), f(m, F.reviewGather), f(m, F.reviewPlan), "--update-master", f(m, F.evidence)], F.reviewEvidence);
            }
            else {
                produce(m, "slice-pack:B", slicePackMain, [f(m, F.evidence), f(m, F.reviewPlan)], F.reviewEvidence);
            }
        }
        // S3.3 — judge pass B (subagent), targeted second opinion over the (possibly augmented) pack.
        // The judge writes passB.json; mono converts to passB.toon.
        if (!ingest(m, F.passBJson, F.passB, "monosashi-judge")) {
            spawn(m, "S3:B", "monosashi-judge", "S3.3 pass B (second opinion)", [f(m, F.reviewPlan), f(m, F.reviewEvidence)], [f(m, F.passBJson)], "independently re-score ONLY review-plan.criteriaToScore from review-evidence.toon, as JSON; you must NOT see or reuse pass A's scores. mono converts your JSON to canonical TOON.");
        }
        applyPatch(m, F.passB, F.passBPatch);
        gate(m, "validate-pass:B", validatePassMain, [f(m, F.passB), f(m, F.reviewPlan), "--target", base, "--evidence", f(m, F.evidence), "--fix", f(m, F.passB)], "have monosashi-judge write ONLY the criteria flagged in the errors above to passB.patch.json (a {scores:[…]} JSON with just those criteria — do NOT rewrite the others), then re-run next", []);
        // S3.6 — contested selector (deterministic) + optional tie-break pass C
        if (!has(m, F.tiebreakPlan))
            produce(m, "contested", contestedMain, [f(m, F.passA), f(m, F.passB), f(m, F.plan), "--threshold", "1"], F.tiebreakPlan);
        const tb = readToon(f(m, F.tiebreakPlan));
        if (tb.shouldRun) {
            // The judge writes passC.json; mono converts to passC.toon.
            if (!ingest(m, F.passCJson, F.passC, "monosashi-judge")) {
                if (!has(m, F.tiebreakEvidence))
                    produce(m, "slice-pack:C", slicePackMain, [f(m, F.evidence), f(m, F.tiebreakPlan)], F.tiebreakEvidence);
                spawn(m, "S3:C", "monosashi-judge", "S3.6 pass C (tie-break)", [f(m, F.tiebreakPlan), f(m, F.tiebreakEvidence)], [f(m, F.passCJson)], "independently re-score ONLY the contested criteria in tiebreak-plan.toon from tiebreak-evidence.toon, as JSON; the median of {A,B,C} resolves each. mono converts your JSON to canonical TOON.");
            }
            applyPatch(m, F.passC, F.passCPatch);
            gate(m, "validate-pass:C", validatePassMain, [f(m, F.passC), f(m, F.tiebreakPlan), "--target", base, "--evidence", f(m, F.evidence), "--fix", f(m, F.passC)], "have monosashi-judge write ONLY the criteria flagged in the errors above to passC.patch.json (a {scores:[…]} JSON with just those criteria — do NOT rewrite the others), then re-run next", []);
        }
    }
    // S4 — aggregate (deterministic). passB/passC included only if they exist.
    if (!has(m, F.scoreboard)) {
        const argvAgg = ["--passA", f(m, F.passA)];
        if (has(m, F.passB))
            argvAgg.push("--passB", f(m, F.passB));
        if (has(m, F.passC))
            argvAgg.push("--passC", f(m, F.passC));
        argvAgg.push("--plan", f(m, F.plan), "--evidence", f(m, F.evidence), "--weighting", m.weighting, "--run-id", m.runId);
        produce(m, "aggregate", aggregateMain, argvAgg, F.scoreboard);
    }
    // S6 — render the HTML deliverable (deterministic)
    if (!has(m, F.html))
        produce(m, "report", reportMain, [f(m, F.scoreboard), "--html"], F.html);
    // …and the portable scorecard: scores + declaredType + creation date, with every path / evidence
    // / run-correlation field projected out — safe to publish, archive, or diff across machines.
    if (!has(m, F.scorecard))
        produce(m, "report", reportMain, [f(m, F.scoreboard), "--scorecard"], F.scorecard);
    printDone(m);
}
function printDone(m) {
    // Headline straight from the scoreboard so the agent need not hand-extract nested keys.
    let headline = "";
    try {
        const sb = readToon(f(m, F.scoreboard));
        const board = sb.scoreboard ?? {};
        const m2 = board.m2Flag ?? {};
        const wi = board.weightedIndex;
        const nhr = Array.isArray(sb.needsHumanReview) ? sb.needsHumanReview.length : 0;
        headline =
            `M2: ${m2.divergent ? `DIVERGENT (${m2.severity})` : "aligned"}` +
                (wi !== undefined && wi !== null ? ` · weightedIndex(${m.weighting})=${Math.round(wi * 100) / 100}` : "") +
                ` · needsHumanReview=${nhr}`;
    }
    catch {
        /* headline is best-effort */
    }
    out("");
    out(`DONE: evaluation complete.`);
    if (headline)
        out(`  ${headline}`);
    out(`  deliverable: ${f(m, F.html)}`);
    out(`  scorecard:   ${f(m, F.scorecard)}  (portable scores-only TOON — no paths/evidence)`);
    out(`  hand the user this HTML path with the one-line headline above; do not paste the full report.`);
    process.exit(0);
}
// ── status (read-only) ───────────────────────────────────────────────────────
function cmdStatus(argv) {
    const m = loadManifest(argv);
    const gov = ensureGovernor(m);
    const caps = m.caps;
    out(`Run '${m.slug}' (runId=${m.runId}, weighting=${m.weighting})`);
    out(`  outdir: ${m.outdir}`);
    out(`  autonomy: ${m.autonomy}  (next ${gov.nextInvocations}/${caps.maxNext}, stalls ${gov.stalls}/${caps.maxStalls}, maxAttemptsPerStage ${caps.maxAttemptsPerStage})`);
    out(`  review-regather: ${m.reviewRegather ? "on" : "off"}`);
    const attempts = Object.entries(gov.attempts);
    if (attempts.length)
        out(`  spawns: ${attempts.map(([k, n]) => `${k}=${n}`).join(", ")}`);
    for (const name of [F.inventory, F.fullPlan, F.profile, F.evidence, F.plan, F.passA, F.reviewPlan, F.reviewGather, F.passB, F.tiebreakPlan, F.passC, F.scoreboard, F.html]) {
        out(`  [${has(m, name) ? "x" : " "}] ${name}`);
    }
    out(`NEXT: ${nextCmd(m)}`);
}
// ── cohort passthrough ───────────────────────────────────────────────────────
function cmdCohort(argv) {
    // Thin wrapper so multi-artifact runs are summarised through mono too. mono writes the TOON;
    // pass --md for the markdown table (printed to stdout).
    const wantMd = argv.includes("--md");
    // Resolve the eval-out dir cwd-independently (same anchor as init): an explicit relative/absolute
    // `--dir` is honoured (resolved against the repo root), else default to the repo-anchored eval-out.
    const evalOut = join(outRoot(undefined, process.cwd()), "eval-out");
    const passthrough = argv.filter((a, i) => a !== "--dir" && argv[i - 1] !== "--dir");
    const dirIdx = argv.indexOf("--dir");
    const dir = dirIdx >= 0 && argv[dirIdx + 1]
        ? (isAbsolute(argv[dirIdx + 1]) ? argv[dirIdx + 1] : join(outRoot(undefined, process.cwd()), argv[dirIdx + 1]))
        : evalOut;
    const cap = invoke(cohortMain, ["--dir", dir, ...passthrough]);
    if (!succeeded(cap))
        die(`cohort failed: ${reason(cap, "cohort")}`);
    if (wantMd) {
        process.stdout.write(cap.stdout);
    }
    else {
        const dest = join(evalOut, "cohort-summary.toon");
        writeFileSync(dest, cap.stdout, "utf8");
        out(`OK: cohort summary → ${dest}`);
    }
}
// ── dispatch ─────────────────────────────────────────────────────────────────
function usage() {
    out(`mono — single entrypoint for the Monosashi evaluation`);
    out(`  mono init <targetRoot> [<targetRoot2> …] [--name <slug>] [--out <dir>] [--weighting internal|external]`);
    out(`           [--autonomy strict|standard|auto] [--max-next N] [--max-attempts N] [--max-stalls N]`);
    out(`           [--review-regather]   # opt-in: re-extract evidence for the review criteria before pass B`);
    out(`  mono next   [--run <evalOutDir>]      # advance the pipeline; stops at each subagent step`);
    out(`  mono status [--run <evalOutDir>]      # show which stage artifacts exist`);
    out(`  mono cohort [--dir eval-out] [--md]   # combine per-artifact scoreboards`);
    process.exit(2);
}
function main() {
    const argv = process.argv.slice(2);
    const cmd = argv[0];
    const rest = argv.slice(1);
    switch (cmd) {
        case "init": return cmdInit(rest);
        case "next": return cmdNext(rest);
        case "status": return cmdStatus(rest);
        case "cohort": return cmdCohort(rest);
        default: return usage();
    }
}
// Run as a CLI only when invoked directly (`node mono.mjs …`); importing the module (e.g. the
// regression suite, which exercises the pure governor logic) is side-effect-free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    main();
