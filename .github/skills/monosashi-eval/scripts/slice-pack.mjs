// Stage 3.3 / 3.6 helper (pack slice): reduce a full all-criteria evidence pack to only the
// criteria a *reduced* plan covers, so the targeted second-opinion pass (review-plan) and the
// tie-break pass (tiebreak-plan) are handed only the evidence they need — not the whole pack.
//
// Why: the resolved evidence pack is the single largest input fed to the judge, and it is read
// once per pass (A, B, C). Pass B re-scores only the criteria A was unsure about, and pass C only
// the contested overlap (often ONE criterion) — yet without slicing each was handed the full pack
// (every criterion's snippets). Slicing the pack to the reduced plan cuts pass B/C input
// proportionally (a 1-criterion tie-break reads 1 item, not 22). Deterministic; no LLM.
//
// The output is a valid EvidencePack (same shape), so the unchanged monosashi-judge +
// validate-pass + aggregate consume it directly. A criterion in the plan with no matching pack
// item is dropped silently here (validate-evidence is the coverage gate, not this tool).
//
// Usage:
//   node slice-pack.mjs <evidence.toon> <plan.toon> > review-evidence.toon
import { pathToFileURL } from "node:url";
import { normalizePack } from "./normalize.mjs";
import { cliOk, runCli } from "./cli.mjs";
import { readToonFile, toonStringify } from "./serde.mjs";
/** Reduce a pack to only the criteria the (reduced) plan covers. Pure — no IO. Exported so the
 *  CLI `main()` and the unit tests share one path. */
export function slicePack(rawPack, plan) {
    const { pack } = normalizePack(rawPack);
    const keep = new Set((plan.criteriaToScore ?? []).map((c) => c.criterion));
    const items = (Array.isArray(pack.items) ? pack.items : []).filter((it) => keep.has(it.criterion));
    return { ...pack, items };
}
export function main(argv = process.argv.slice(2)) {
    const [evidencePath, planPath] = argv;
    if (!evidencePath || !planPath) {
        console.error("Usage: slice-pack <evidence.toon> <plan.toon> > sliced.toon");
        process.exit(2);
    }
    const pack = readToonFile(evidencePath);
    const plan = readToonFile(planPath);
    const out = slicePack(pack, plan);
    process.stdout.write(toonStringify(out) + "\n");
    const planN = (plan.criteriaToScore ?? []).length;
    cliOk("slice-pack", `${out.items.length}/${Array.isArray(pack.items) ? pack.items.length : 0} item(s) kept (plan covers ${planN})`);
}
// CLI only when invoked directly; importing the module (tests) is side-effect-free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    runCli("slice-pack", main);
