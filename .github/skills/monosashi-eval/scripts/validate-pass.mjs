// Stage 3.5 (gate before S4): validate a judge ScorePass against the track plan
// BEFORE aggregation, so malformed/incomplete passes fail loudly instead of silently
// skewing the scoreboard. Deterministic, static — never executes the target.
//
// Checks (hard errors -> exit 1):
//   - every plan.criteriaToScore[].criterion is present (M2 is mechanical, not scored)
//   - each score is an integer 0..4 or the string "N/A"
//   - each criterion id is a real rubric id; confidence ∈ {high,medium,low}
// Warnings (exit 0, reported) — all dropped from the pass by --fix so the gate self-heals:
//   - criteria outside the plan (unexpected or naByRule) — dropped from pass
//   - naByRule criterion with a numeric score — numeric score dropped, treated as N/A-by-rule
//   - planned criterion (criteriaToScore, non-naByRule) scored "N/A" — coerced to 0, confidence
//     pinned to medium (it has a rubric floor; N/A there is illegitimate and would otherwise be
//     silently excluded from the radar average)
//   - evidence missing/empty, or an evidence item lacks {path, snippet}
//   - with --target <dir>: a snippet whose (whitespace-normalised) text does not occur
//     in the cited file — i.e. paraphrased rather than verbatim (§7 anti-hallucination)
//   - a non-N/A score with no evidence (forced to confidence:"low" under --fix)
//   - evidenceRefs given but no --evidence pack to resolve them (cannot verify)
// Hard error: an evidenceRef index that does not exist in the pack for that criterion.
//
// Evidence may be cited either inline (`evidence: [{path,snippet}]`) or, preferably, by
// reference into the gatherer pack (`evidenceRefs: [i]`); pass --evidence to resolve refs.
//
// Usage:
//   node validate-pass.mjs <pass.toon> <plan.toon> [--target <artifactDir>] [--evidence <pack.toon>] [--fix <out.toon>]
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { RUBRIC } from "./rubric.mjs";
import { indexPack, resolveScoreEvidence, snippetInFile, linesInFile, listTargetFiles, snapPath } from "./evidence-util.mjs";
import { normalizePass, normalizePack, coercionWarnings } from "./normalize.mjs";
import { cliDone, runCli } from "./cli.mjs";
import { readToonFile, toonStringify } from "./serde.mjs";
const VALID_IDS = new Set(RUBRIC.tracks.flatMap((t) => t.criteria.map((c) => c.id)));
const CONF = new Set(["high", "medium", "low"]);
function parseArgs(argv) {
    const opt = { pass: null, plan: null, target: null, fix: null, evidence: null };
    const pos = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--target")
            opt.target = argv[++i];
        else if (a === "--fix")
            opt.fix = argv[++i];
        else if (a === "--evidence")
            opt.evidence = argv[++i];
        else
            pos.push(a);
    }
    opt.pass = pos[0] ?? null;
    opt.plan = pos[1] ?? null;
    return opt;
}
/** Validate a judge pass against the plan (after absorbing LLM surface drift), optionally
 *  resolving evidenceRefs against a pack and verbatim-checking against an on-disk target. Pure —
 *  the only IO is the optional verbatim check (snippetInFile/linesInFile read the cited files).
 *  Exported so the CLI `main()` and the unit tests share one path. */
export function validatePass(rawPass, plan, opts = {}) {
    const packIndex = opts.packIndex ?? null;
    const target = opts.target ?? null;
    const { pass, coercions } = normalizePass(rawPass);
    const errors = [];
    const warnings = coercionWarnings(coercions);
    const scores = Array.isArray(pass.scores) ? pass.scores : [];
    if (!Array.isArray(pass.scores))
        errors.push("pass.scores is not an array");
    // Filesystem-grounded path snapping for INLINE citations (パス揺れ吸収). Pack-referenced evidence
    // already carries canonical, snapped paths (validate-evidence did this at S2.6), so refs need no
    // snap here; but a pass may add an inline {path, snippet} that drifts the same way. With --target,
    // snap each inline path to the real on-disk file so the verbatim check below resolves it and the
    // citation matches the pack's spelling. Refs are the preferred, drift-free citation (§7).
    const snapFiles = target ? listTargetFiles(target) : [];
    if (target) {
        for (const s of scores) {
            for (const e of Array.isArray(s?.evidence) ? s.evidence : []) {
                if (!e || typeof e.path !== "string" || !e.path)
                    continue;
                const snap = snapPath(e.path, snapFiles);
                if (snap && snap.path !== e.path) {
                    warnings.push(`[${s.criterion}] snapped inline path ${e.path} → ${snap.path} (${snap.how}, on-disk; パス揺れ吸収)`);
                    e.path = snap.path;
                }
            }
        }
    }
    const byId = new Map();
    for (const s of scores) {
        if (byId.has(s.criterion))
            errors.push(`duplicate criterion: ${s.criterion}`);
        byId.set(s.criterion, s);
    }
    // Expected = exactly plan.criteriaToScore. M2 is mechanical (plan.m2) and no longer
    // scored by passes — it is neither required nor rejected if a stray legacy M2 appears.
    const expected = new Set((plan.criteriaToScore ?? []).map((c) => c.criterion));
    for (const id of expected)
        if (!byId.has(id))
            errors.push(`missing criterion: ${id}`);
    // Out-of-plan criteria are dropped from the fixed pass with a warning so the gate self-heals
    // without requiring a re-emit. Three sub-cases, all treated as warnings:
    //   naByRule + "N/A"   — judge confirmed a mechanical N/A; harmless, drop.
    //   naByRule + numeric — judge tried to override a mechanical N/A; numeric score dropped.
    //   other criterion    — criterion not in plan.criteriaToScore; dropped.
    // M2 is mechanical (plan.m2) and is neither required nor rejected (legacy tolerance).
    const naByRule = new Set((plan.naByRule ?? []).map((c) => c.criterion));
    const dropped = new Set();
    for (const id of byId.keys()) {
        if (expected.has(id) || id === "M2")
            continue;
        if (naByRule.has(id)) {
            if (byId.get(id).score === "N/A") {
                warnings.push(`[${id}] is N/A-by-rule (plan.naByRule) — not scored by passes; dropped from the pass (§5/§6)`);
            }
            else {
                warnings.push(`[${id}] is N/A-by-rule (plan.naByRule) but was scored ${JSON.stringify(byId.get(id).score)} — numeric score dropped, treated as N/A-by-rule (§5/§6)`);
            }
            dropped.add(id);
        }
        else {
            warnings.push(`[${id}] unexpected criterion not in plan — dropped from pass`);
            dropped.add(id);
        }
    }
    // Per-criterion shape + evidence.
    const fixed = [];
    for (const s of scores) {
        if (dropped.has(s.criterion))
            continue; // pruned: N/A-by-rule, kept out of the fixed pass
        const where = `[${s.criterion}]`;
        if (!VALID_IDS.has(s.criterion))
            errors.push(`${where} unknown rubric id`);
        const numeric = Number.isInteger(s.score) && s.score >= 0 && s.score <= 4;
        const na = s.score === "N/A";
        if (!numeric && !na)
            errors.push(`${where} score must be integer 0..4 or "N/A" (got ${JSON.stringify(s.score)})`);
        if (!CONF.has(s.confidence))
            errors.push(`${where} confidence must be high|medium|low (got ${JSON.stringify(s.confidence)})`);
        // Planned criterion (in plan.criteriaToScore, i.e. NOT naByRule) scored "N/A" by the judge.
        // Such a criterion has a defined rubric floor — e.g. S2 level0 = "テストが存在しない" is 0, not
        // "doesn't apply" — so a judge N/A here is illegitimate (rule-based N/A was already dropped
        // above). Coerce it to 0 with a warning and pin confidence to medium, so it is neither
        // silently excluded from the radar average (aggregate excludes N/A) nor later demoted to low
        // by the no-evidence rule. A floor-0 needs no citation, so skip the evidence checks (§5/§6).
        if (na && expected.has(s.criterion)) {
            warnings.push(`${where} planned criterion scored "N/A" — coerced to 0 (no applicable N/A floor; confidence→medium, §5/§6)`);
            fixed.push({ ...s, score: 0, confidence: "medium", _coercedNAtoZero: true });
            continue;
        }
        // Evidence may be cited by reference (evidenceRefs → pack) and/or inline. Resolve both.
        const { resolved, unresolved } = resolveScoreEvidence(s, packIndex);
        const declaredRefs = Array.isArray(s.evidenceRefs) ? s.evidenceRefs.length : 0;
        // A bad ref index is a hard error — but only when a pack is present to check against.
        if (unresolved.length && packIndex)
            errors.push(`${where} evidenceRefs ${JSON.stringify(unresolved)} not present in evidence pack for ${s.criterion}`);
        if (declaredRefs && !packIndex)
            warnings.push(`${where} evidenceRefs given but no --evidence pack to resolve/verify them`);
        // refs-first (§7): when a pack IS present, the judge should cite by evidenceRefs (an index —
        // drift-free, the path lives once in the snapped pack) rather than re-typing an inline path,
        // which is exactly where path 揺れ re-enters. Nudge, don't fail (inline stays valid evidence).
        if (packIndex && declaredRefs === 0 && resolved.some((e) => e.source === "inline"))
            warnings.push(`${where} cited inline {path} though an evidence pack is present — prefer evidenceRefs (drift-free; パス揺れ吸収 §7)`);
        // "cited something" = declared a ref OR a complete inline citation. The fix-to-low rule
        // (§7) fires only when the judge cited *nothing* — not when a pack is merely absent.
        const citedSomething = declaredRefs > 0 || resolved.some((e) => e.source === "inline");
        let out = s;
        if (!na && !citedSomething) {
            warnings.push(`${where} non-N/A score with no evidence (no evidenceRefs, no {path,snippet}) -> should be confidence:"low" (§7)`);
            if (s.confidence !== "low")
                out = { ...s, confidence: "low", _forcedLowByValidator: true };
        }
        if (target) {
            for (const e of resolved) {
                // A line-range citation is checked by range; a snippet citation, verbatim.
                const ok = e.snippet ? snippetInFile(target, e.path, e.snippet) : linesInFile(target, e.path, e.lines);
                if (!ok) {
                    const tag = e.source === "ref" ? `evidenceRef ${e.ref}` : "inline";
                    warnings.push(`${where} ${tag} evidence not found in ${e.path} (paraphrased snippet / out-of-range lines? cite verbatim — §7)`);
                }
            }
        }
        fixed.push(out);
    }
    return { ok: errors.length === 0, errors, warnings, fixed, scored: fixed.length, expected: expected.size };
}
export function main(argv = process.argv.slice(2)) {
    const opt = parseArgs(argv);
    if (!opt.pass || !opt.plan) {
        console.error("Usage: validate-pass <pass.toon> <plan.toon> [--target <dir>] [--fix <out.toon>]");
        process.exit(2);
    }
    const rawPass = readToonFile(opt.pass);
    const plan = readToonFile(opt.plan);
    // Normalise the pack before indexing so its ids align with the (normalised) pass ids.
    const packIndex = opt.evidence
        ? indexPack(normalizePack(readToonFile(opt.evidence)).pack)
        : null;
    const { ok, errors, warnings, fixed, scored, expected } = validatePass(rawPass, plan, {
        packIndex,
        target: opt.target,
    });
    const report = {
        pass: opt.pass,
        ok,
        counts: { scored, expected, errors: errors.length, warnings: warnings.length },
        errors,
        warnings,
    };
    process.stderr.write(toonStringify(report) + "\n");
    if (opt.fix) {
        // Re-normalise to recover the parsed pass shell (target/declaredType) for the fixed output.
        const { pass } = normalizePass(rawPass);
        writeFileSync(opt.fix, toonStringify({ ...pass, scores: fixed }) + "\n");
        process.stderr.write(`fixed pass written to ${opt.fix}\n`);
    }
    cliDone("validate-pass", ok, ok ? `${scored}/${expected} scored (${warnings.length} warning(s))` : `${errors.length} error(s)`);
    process.exit(ok ? 0 : 1);
}
// CLI only when invoked directly; importing the module (tests) is side-effect-free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    runCli("validate-pass", main);
