// Helper for the merged single-read flow (§5): emit a LIGHTWEIGHT plan covering ALL rubric
// criteria (every track) for the `monosashi-surveyor` to gather evidence against — *without* a
// capability profile, and crucially **without the verbatim level definitions or tie-break
// anchor** (§7 reference-token cut, idea E). The surveyor's job is to find *what evidence
// exists* per criterion, not to grade it; for that it needs the criterion's identity (id /
// title / tags) and a short `lookFor` hint of what the capability looks like when present —
// not the full 0–4 ladder. The verbatim `levels[0..4]` + `anchor` are the *judge's* tools
// and are embedded later, only into the applicable subset, by `select-tracks` → plan.toon.
// The surveyor reads the bundle ONCE and gathers candidate evidence for every criterion here,
// before tracks are known; `select-tracks` narrows the applicable subset from the profile.
// Deterministic; no LLM here.
//
// Usage:
//   node full-plan.mjs > full-plan.toon
import { pathToFileURL } from "node:url";
import { RUBRIC } from "./rubric.mjs";
import { cliOk, runCli } from "./cli.mjs";
import { toonStringify } from "./serde.mjs";
/** Build the surveyor's per-criterion hunt hint (idea ①). Names the Lv2 floor and the Lv3/Lv4
 *  climbing signals by their *capability description* (never a bare level number), so the one
 *  sweep hunts the ceiling, not just "the capability is present". */
export function huntHint(c) {
    return `存在: ${c.levels[2]} ／ さらに上段も探す → 加点: ${c.levels[3]} ／ 網羅: ${c.levels[4]}`;
}
/** The lightweight all-criteria plan, derived purely from the rubric (no profile, no IO). M2 is
 *  excluded — it is mechanical (computed by select-tracks), never an evidence-gathering target. */
export function buildFullPlan() {
    const toScore = [];
    for (const track of RUBRIC.tracks) {
        for (const c of track.criteria) {
            // M2 is mechanical (computed by select-tracks); never gather evidence for it.
            if (c.id === "M2")
                continue;
            toScore.push({
                criterion: c.id,
                track: track.id,
                title: c.title,
                tags: c.tags,
                lookFor: huntHint(c),
            });
        }
    }
    return {
        target: null,
        all: true,
        lightweight: true,
        rubricVersion: RUBRIC.version,
        scale: RUBRIC.scale,
        criteriaToScore: toScore,
        counts: { criteria: toScore.length },
        note: "全criteria(全track)の軽量リスト。monosashi-surveyor が1回読みで全criteria分の証拠を収集するための入力。逐語 levels/anchor は含めない(採点用に select-tracks が plan.toon へ埋め込む)。各criteriaは title/tags と lookFor(存在=Lv2 の姿 に加え、上段の弁別子=誤用例・対比や版整合網羅 までを名指しした探索ヒント。レベル番号は持たない)のみ。track適用と M2 は後続の select-tracks が profile から決定する。",
    };
}
export function main(argv = process.argv.slice(2)) {
    void argv;
    const plan = buildFullPlan();
    process.stdout.write(toonStringify(plan) + "\n");
    cliOk("full-plan", `${plan.counts.criteria} criteria (all tracks, lightweight)`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    runCli("full-plan", main);
