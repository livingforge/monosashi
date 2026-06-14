// Stage 3.25 helper (pack augment): merge a TARGETED re-gathered evidence pack (gatherer over the
// review-plan subset) into the master pack, then emit the review slice pass B scores from.
//
// Why: the second opinion (pass B) is where two independent passes most often disagree — and a
// disagreement caused by *missing evidence* (the single S1 sweep didn't cite the deciding line),
// not by judgement, is a false low that pass B alone cannot fix while it is pack-only. The opt-in
// `--review-regather` flow lets the gatherer re-read the bundle for ONLY the review criteria and
// hand pass B that fresh evidence — without letting the judge re-scan (extraction stays the
// gatherer's job; the judge stays pack-only, §7).
//
// The merge is APPEND-ONLY per review criterion: the master's existing candidates keep their
// positions (so pass A's `evidenceRefs` indices stay valid) and the freshly-gathered candidates
// are appended after them, de-duplicated against what is already there (same path + same
// lines/snippet). This preserves the pipeline invariant the slicer relies on — a criterion's
// candidate array is index-identical in the master `evidence.toon` and in the sliced pack — so
// `validate-pass:B` and `aggregate` still resolve pass B's refs against the (augmented) master.
//
// Two outputs:
//   - stdout: the review slice (augmented master filtered to plan.criteriaToScore) → review-evidence.toon
//   - --update-master <path>: the augmented master written back in place (same in-place pattern as
//     validate-evidence --resolve), so downstream stages see the appended candidates at stable indices.
//
// Deterministic; no LLM. Both inputs are expected already resolved (snippets present): the master by
// the S2.6 gate, the re-gathered pack by the S3.25 validate-evidence --resolve gate.
//
// Usage:
//   node augment-pack.mjs <masterEvidence.toon> <gather.toon> <reviewPlan.toon> [--update-master <out.toon>] > review-evidence.toon
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { normalizePack } from "./normalize.mjs";
import { cliOk, runCli } from "./cli.mjs";
import { readToonFile, toonStringify } from "./serde.mjs";
/** A de-dup key for a candidate: same file + same location (line range when present, else snippet).
 *  Two candidates with the same path and the same `lines` are the same citation even if one carries
 *  a resolved `snippet` and the other does not; falling back to the snippet covers no-range citations. */
function candidateKey(c) {
    const loc = (c.lines && String(c.lines).trim()) || (c.snippet && String(c.snippet).trim()) || "";
    return `${c.path ?? ""}¦${loc}`;
}
/** Merge a re-gathered pack into the master pack (append-only per review criterion) and return both
 *  the augmented master and the review slice. Pure — no IO. Exported so the CLI `main()` and the
 *  unit tests share one code path.
 *
 *  - `master`: the full, resolved evidence pack (every criterion).
 *  - `gather`: the targeted re-gathered pack (covers the review subset).
 *  - `plan`:   the reduced review plan (defines which criteria + the slice's order).
 */
export function augmentPack(rawMaster, rawGather, plan) {
    const { pack: master } = normalizePack(rawMaster);
    const { pack: gather } = normalizePack(rawGather);
    const review = new Set((plan.criteriaToScore ?? []).map((c) => c.criterion));
    const masterItems = Array.isArray(master.items) ? master.items : [];
    const gatherByCriterion = new Map();
    for (const it of Array.isArray(gather.items) ? gather.items : []) {
        if (it && typeof it.criterion === "string")
            gatherByCriterion.set(it.criterion, Array.isArray(it.candidates) ? it.candidates : []);
    }
    // For a review criterion: existing candidates first (indices preserved), then the freshly-gathered
    // ones that are not already present. Returns the merged candidate list.
    const mergeFor = (criterion, existing) => {
        const fresh = gatherByCriterion.get(criterion) ?? [];
        if (fresh.length === 0)
            return existing;
        const seen = new Set(existing.map(candidateKey));
        const appended = [];
        for (const c of fresh) {
            const k = candidateKey(c);
            if (seen.has(k))
                continue;
            seen.add(k);
            appended.push(c);
        }
        return appended.length ? [...existing, ...appended] : existing;
    };
    // Rebuild the master items, augmenting review criteria in place (order preserved).
    const seenCriteria = new Set();
    const augmentedItems = masterItems.map((it) => {
        seenCriteria.add(it.criterion);
        if (!review.has(it.criterion))
            return it;
        return { ...it, candidates: mergeFor(it.criterion, Array.isArray(it.candidates) ? it.candidates : []) };
    });
    // A review criterion absent from the master (should not happen post-S2.6, but be robust) is added
    // from the re-gathered pack alone, so the slice still covers it.
    for (const criterion of review) {
        if (seenCriteria.has(criterion))
            continue;
        const fresh = gatherByCriterion.get(criterion);
        if (fresh && fresh.length)
            augmentedItems.push({ criterion, candidates: fresh });
    }
    const augmentedMaster = { ...master, items: augmentedItems };
    // The slice is the augmented master reduced to exactly the review plan's criteria (its order).
    const byCriterion = new Map(augmentedItems.map((it) => [it.criterion, it]));
    const sliceItems = [];
    for (const c of plan.criteriaToScore ?? []) {
        const it = byCriterion.get(c.criterion);
        if (it)
            sliceItems.push(it);
    }
    const slice = { ...master, items: sliceItems };
    return { master: augmentedMaster, slice };
}
export function main(argv = process.argv.slice(2)) {
    const pos = [];
    let updateMaster = null;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--update-master")
            updateMaster = argv[++i];
        else
            pos.push(argv[i]);
    }
    const [masterPath, gatherPath, planPath] = pos;
    if (!masterPath || !gatherPath || !planPath) {
        console.error("Usage: augment-pack <masterEvidence.toon> <gather.toon> <reviewPlan.toon> [--update-master <out.toon>] > review-evidence.toon");
        process.exit(2);
    }
    const master = readToonFile(masterPath);
    const gather = readToonFile(gatherPath);
    const plan = readToonFile(planPath);
    const { master: augmented, slice } = augmentPack(master, gather, plan);
    // Write the augmented master back in place (so validate-pass:B / aggregate resolve B's refs at
    // stable indices), then emit the slice on stdout for review-evidence.toon.
    if (updateMaster)
        writeFileSync(updateMaster, toonStringify(augmented) + "\n");
    process.stdout.write(toonStringify(slice) + "\n");
    const before = (master.items ?? []).reduce((n, it) => n + (Array.isArray(it.candidates) ? it.candidates.length : 0), 0);
    const after = augmented.items.reduce((n, it) => n + (Array.isArray(it.candidates) ? it.candidates.length : 0), 0);
    cliOk("augment-pack", `${slice.items.length} review criteria; +${after - before} candidate(s) appended${updateMaster ? " (master updated in place)" : ""}`);
}
// CLI only when invoked directly; importing the module (tests) is side-effect-free.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    runCli("augment-pack", main);
