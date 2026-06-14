// Stage 3.2 (second-opinion selector): from a full pass A + the plan, emit a reduced plan
// covering only the criteria pass A was NOT highly confident about (confidence != "high").
// Pass B then re-scores ONLY this subset — that is where two independent passes most often
// disagree — instead of re-scoring everything. The high-confidence remainder keeps A's
// single judgement (aggregate marks those `singlePass`). Deterministic; no LLM here.
//
// The output is itself a valid plan (same shape as `contested`, embedded rubric slice
// carried), so the unchanged monosashi-judge + validate-pass consume it directly. M2 is
// mechanical (plan.m2) and never part of a pass, so it is not added here.
//
// Usage:
//   node second-opinion.mjs <passA.toon> <plan.toon> [--also-high] > review-plan.toon
//   (--also-high re-scores everything = a full independent pass B, the old behaviour.)
import { pathToFileURL } from "node:url";
import { normalizePass } from "./normalize.mjs";
import { cliOk, runCli } from "./cli.mjs";
import { readToonFile, toonStringify } from "./serde.mjs";
function parseArgs(argv) {
    const pos = [];
    let alsoHigh = false;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--also-high")
            alsoHigh = true;
        else
            pos.push(argv[i]);
    }
    return { passA: pos[0], plan: pos[1], alsoHigh };
}
/** From a full pass A + the plan, select the criteria a second opinion should re-score
 *  (confidence != "high", or every criterion when `alsoHigh`). Pure — no IO. Exported so the
 *  CLI `main()` and the unit tests share one code path. */
export function selectSecondOpinion(rawA, plan, opts = {}) {
    const alsoHigh = opts.alsoHigh ?? false;
    // Normalise pass A first so "High" confidence and a lower-cased id are read as the judge
    // meant — otherwise "High" reads as not-high and triggers a needless second pass.
    const { pass: a } = normalizePass(rawA);
    const sliceById = new Map((plan.criteriaToScore ?? []).map((c) => [c.criterion, c]));
    const aById = new Map(a.scores.map((s) => [s.criterion, s]));
    // Target every planned criterion A was not highly confident about. (A criterion A skipped
    // entirely is also a target — it needs a judgement.) --also-high targets everything.
    const review = [];
    for (const c of plan.criteriaToScore ?? []) {
        const sa = aById.get(c.criterion);
        const conf = sa?.confidence ?? "low";
        if (alsoHigh || conf !== "high") {
            review.push({ criterion: c.criterion, confidenceA: conf, scoreA: sa?.score ?? "N/A" });
        }
    }
    const criteriaToScore = review.map((r) => sliceById.get(r.criterion)).filter(Boolean);
    const out = {
        target: plan.target,
        declaredType: plan.declaredType ?? null,
        rubricVersion: plan.rubricVersion,
        scale: plan.scale,
        hasCodePath: plan.hasCodePath,
        appliedTracks: plan.appliedTracks,
        criteriaToScore,
        reviewTargets: review.map((r) => r.criterion),
        reviewDetail: review,
        // A second pass only earns its tokens if pass A left something less-than-certain.
        shouldRun: review.length > 0,
        counts: { plannedCriteria: (plan.criteriaToScore ?? []).length, reviewTargets: review.length },
        note: "second-opinion (S3.2): 採点者Bにこの criteriaToScore のみ独立採点させる。A が high 確信だった残りは単一判定として A を採用(aggregate が singlePass を付与)。shouldRun=false なら B 不要。",
    };
    return out;
}
export function main(argv = process.argv.slice(2)) {
    const opt = parseArgs(argv);
    if (!opt.passA || !opt.plan) {
        console.error("Usage: second-opinion <passA.toon> <plan.toon> [--also-high]");
        process.exit(2);
    }
    const a = readToonFile(opt.passA);
    const plan = readToonFile(opt.plan);
    const out = selectSecondOpinion(a, plan, { alsoHigh: opt.alsoHigh });
    process.stdout.write(toonStringify(out) + "\n");
    cliOk("second-opinion", `shouldRun=${out.shouldRun}, ${out.reviewTargets.length} review target(s)`);
}
// CLI only when invoked directly; importing the module is side-effect-free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    runCli("second-opinion", main);
