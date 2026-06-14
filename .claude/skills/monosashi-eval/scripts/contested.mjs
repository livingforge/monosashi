// Stage 3.6 (L, tie-break selector): from two independent passes + the plan, emit a
// reduced plan covering only the *contested* criteria — those whose pass-A/pass-B scores
// differ by >= threshold (default 1). The orchestrator runs the judge ONE more time over
// just this subset; `aggregate --passC` then takes the median of {A,B,C} for each, which
// resolves the ±1 boundary drift without re-scoring everything. Deterministic.
//
// The output is itself a valid plan (same shape, embedded rubric slice carried through),
// so the unchanged monosashi-judge + validate-pass consume it directly. M2 is mechanical
// (plan.m2) and not scored by any pass, so it is not added here; `contested` lists the
// genuinely-divergent ids and `shouldRun` says whether a 3rd pass is worth it.
//
// Usage:
//   node contested.mjs <passA.toon> <passB.toon> <plan.toon> [--threshold 1] > tiebreak-plan.toon
import { pathToFileURL } from "node:url";
import { normalizePass } from "./normalize.mjs";
import { cliOk, runCli } from "./cli.mjs";
import { readToonFile, toonStringify } from "./serde.mjs";
function parseArgs(argv) {
    const pos = [];
    let threshold = 1;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--threshold")
            threshold = Number(argv[++i]);
        else
            pos.push(argv[i]);
    }
    return { passA: pos[0], passB: pos[1], plan: pos[2], threshold };
}
function isNum(s) {
    return typeof s === "number";
}
/** From two independent passes + the plan, select the *contested* criteria (|A−B| ≥
 *  threshold). Pure — no IO. Exported so the CLI `main()` and the unit tests share one path. */
export function selectContested(rawA, rawB, plan, opts = {}) {
    const threshold = opts.threshold ?? 1;
    // Normalise both passes so a string score ("3") or lower-cased id compares correctly — an
    // unnormalised "3" would be treated as non-numeric and silently excluded from the diff.
    const { pass: a } = normalizePass(rawA);
    const { pass: b } = normalizePass(rawB);
    const bById = new Map(b.scores.map((s) => [s.criterion, s]));
    const sliceById = new Map((plan.criteriaToScore ?? []).map((c) => [c.criterion, c]));
    const contested = [];
    for (const sa of a.scores) {
        const sb = bById.get(sa.criterion);
        if (!sb)
            continue;
        if (!isNum(sa.score) || !isNum(sb.score))
            continue; // N/A divergence handled elsewhere
        const diff = Math.abs(sa.score - sb.score);
        if (diff >= threshold)
            contested.push({ criterion: sa.criterion, passA: sa.score, passB: sb.score, diff });
    }
    // criteriaToScore = just the contested criteria (carrying their embedded slice). M2 is
    // mechanical (plan.m2) and no longer scored by any pass, so it is not added here.
    const ids = new Set(contested.map((c) => c.criterion));
    const criteriaToScore = [...ids].map((id) => sliceById.get(id)).filter(Boolean);
    const out = {
        target: plan.target,
        declaredType: plan.declaredType ?? null,
        rubricVersion: plan.rubricVersion,
        scale: plan.scale,
        hasCodePath: plan.hasCodePath,
        appliedTracks: plan.appliedTracks,
        criteriaToScore,
        contested: contested.map((c) => c.criterion),
        contestedDetail: contested,
        threshold,
        // A 3rd pass only earns its tokens if something real is contested.
        shouldRun: contested.length > 0,
        counts: { contested: contested.length, criteriaInPassC: criteriaToScore.length },
        note: "tie-break (L): 採点者にこの criteriaToScore を独立採点させ、aggregate --passC で median(A,B,C) を取る。shouldRun=false なら3パス目は不要。",
    };
    return out;
}
export function main(argv = process.argv.slice(2)) {
    const opt = parseArgs(argv);
    if (!opt.passA || !opt.passB || !opt.plan) {
        console.error("Usage: contested <passA.toon> <passB.toon> <plan.toon> [--threshold 1]");
        process.exit(2);
    }
    const a = readToonFile(opt.passA);
    const b = readToonFile(opt.passB);
    const plan = readToonFile(opt.plan);
    const out = selectContested(a, b, plan, { threshold: opt.threshold });
    process.stdout.write(toonStringify(out) + "\n");
    cliOk("contested", `shouldRun=${out.shouldRun}, ${out.contested.length} contested (threshold ${opt.threshold})`);
}
// CLI only when invoked directly; importing the module is side-effect-free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    runCli("contested", main);
