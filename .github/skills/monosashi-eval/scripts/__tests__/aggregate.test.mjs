// Unit tests for the Stage-4 aggregator (aggregate). Pins the reconciliation math (two-pass
// mean, three-pass median tie-break, singlePass, N/A handling, needsHumanReview), the radar /
// weighted-index computation, and — critically — the new robustness: a pass that emitted a string
// "3" or an "N/A" spelling must still be counted, not silently dropped from the radar. Pure — no IO.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate } from "../aggregate.mjs";
function pass(scores, over = {}) {
    return { target: "t", declaredType: "skill", scores, ...over };
}
test("single pass: radar means per track, N/A excluded and counted", () => {
    const out = aggregate({
        passA: pass([
            { criterion: "M1", score: 2, confidence: "high", rationale: "" }, // track M
            { criterion: "G1", score: 4, confidence: "high", rationale: "" }, // track G
            { criterion: "G2", score: "N/A", confidence: "high", rationale: "" },
        ]),
    });
    assert.equal(out.scoreboard.radarByTrack.M.mean, 2);
    assert.equal(out.scoreboard.radarByTrack.G.mean, 4);
    assert.equal(out.scoreboard.naCount, 1);
    assert.equal(out.twoPass, false);
});
test("robustness: a string score and an N/A spelling are normalised, not dropped", () => {
    const out = aggregate({
        passA: pass([
            { criterion: "g1", score: "3", confidence: "High", rationale: "" }, // string score + lc id + cap conf
            { criterion: "G2", score: "na", confidence: "high", rationale: "" }, // N/A spelling
        ]),
    });
    // "3" must land in the G radar (would be excluded if left as a string).
    assert.equal(out.scoreboard.radarByTrack.G.mean, 3);
    assert.equal(out.scoreboard.radarByTrack.G.n, 1);
    assert.equal(out.scoreboard.naCount, 1, "'na' counted as N/A");
    assert.equal(out.scoreboard.confidence.high, 2, "'High' normalised to high");
});
test("two-pass: merged score is the mean; a diff of 2 flags needsHumanReview", () => {
    const out = aggregate({
        passA: pass([{ criterion: "M1", score: 2, confidence: "medium", rationale: "" }]),
        passB: pass([{ criterion: "M1", score: 4, confidence: "medium", rationale: "" }]),
    });
    const m1 = out.mergedScores.find((s) => s.criterion === "M1");
    assert.equal(m1.score, 3);
    assert.equal(m1.scoreA, 2);
    assert.equal(m1.scoreB, 4);
    assert.equal(out.reconciliation.needsHumanReview, 1);
    assert.equal(out.needsHumanReview[0].criterion, "M1");
});
test("three-pass tie-break: merged score is the median of {A,B,C}", () => {
    const out = aggregate({
        passA: pass([{ criterion: "M1", score: 1, confidence: "low", rationale: "" }]),
        passB: pass([{ criterion: "M1", score: 3, confidence: "low", rationale: "" }]),
        passC: pass([{ criterion: "M1", score: 3, confidence: "low", rationale: "" }]),
    });
    const m1 = out.mergedScores.find((s) => s.criterion === "M1");
    assert.equal(m1.score, 3, "median(1,3,3)=3");
    assert.equal(m1.scoreC, 3);
    assert.equal(out.reconciliation.tieBroken, 1);
});
test("singlePass: a criterion pass B skipped keeps A's judgement and is counted", () => {
    const out = aggregate({
        passA: pass([
            { criterion: "M1", score: 4, confidence: "high", rationale: "" },
            { criterion: "G1", score: 2, confidence: "low", rationale: "" },
        ]),
        passB: pass([{ criterion: "G1", score: 3, confidence: "low", rationale: "" }]),
    });
    const m1 = out.mergedScores.find((s) => s.criterion === "M1");
    assert.equal(m1.singlePass, true);
    assert.equal(m1.score, 4);
    assert.equal(out.reconciliation.singlePass, 1);
});
test("both-N/A reconciles to N/A; one-N/A keeps the numeric and flags divergence", () => {
    const out = aggregate({
        passA: pass([
            { criterion: "M1", score: "N/A", confidence: "high", rationale: "" },
            { criterion: "G1", score: "N/A", confidence: "high", rationale: "" },
        ]),
        passB: pass([
            { criterion: "M1", score: "N/A", confidence: "high", rationale: "" },
            { criterion: "G1", score: 3, confidence: "high", rationale: "" },
        ]),
    });
    const m1 = out.mergedScores.find((s) => s.criterion === "M1");
    const g1 = out.mergedScores.find((s) => s.criterion === "G1");
    assert.equal(m1.score, "N/A");
    assert.equal(g1.score, 3);
    assert.ok(out.needsHumanReview.some((f) => f.criterion === "G1"), "N/A vs numeric is a divergence");
    // Both passes ran, so the per-pass breakdown is carried (incl. "N/A") and the criterion is
    // NOT marked singlePass — otherwise the report renders the "A·/B·" placeholder as if B never ran.
    assert.equal(m1.scoreA, "N/A");
    assert.equal(m1.scoreB, "N/A");
    assert.equal(m1.singlePass, undefined);
    assert.equal(g1.scoreA, "N/A");
    assert.equal(g1.scoreB, 3);
    assert.equal(g1.singlePass, undefined);
    // An N/A on either side is a passthrough, not a numeric mean — the audit method must say so.
    const trail = out.audit.trail;
    assert.equal(trail.find((t) => t.criterion === "M1").method, "N/A passthrough");
    assert.equal(trail.find((t) => t.criterion === "G1").method, "N/A passthrough");
    // Both judgements are recorded for the one-N/A case (the report can show A=N/A, B=3).
    assert.equal(trail.find((t) => t.criterion === "G1").judgements.length, 2);
});
test("no passB (second-opinion shouldRun=false): every criterion is marked singlePass", () => {
    // The whole second opinion was skipped — pass A stood alone. Each criterion must carry
    // singlePass=true (like the per-criterion skip path) so the report shows the "単一パス"
    // badge instead of falling back to the "A·/B·" placeholder as if B had run and produced nothing.
    const out = aggregate({
        passA: pass([
            { criterion: "M1", score: 3, confidence: "high", rationale: "" },
            { criterion: "G1", score: "N/A", confidence: "high", rationale: "" },
        ]),
    });
    const m1 = out.mergedScores.find((s) => s.criterion === "M1");
    const g1 = out.mergedScores.find((s) => s.criterion === "G1");
    assert.equal(m1.singlePass, true);
    assert.equal(g1.singlePass, true);
    assert.equal(out.audit.passes.B, false);
});
test("internal weighting lifts structure/reliability-tagged criteria", () => {
    const scores = [
        { criterion: "M1", score: 0, confidence: "high", rationale: "" }, // meta/docs → weight 1
        { criterion: "G1", score: 4, confidence: "high", rationale: "" }, // structure/reliability → weight 2
    ];
    const unweighted = aggregate({ passA: pass(scores) });
    const weighted = aggregate({ passA: pass(scores), weighting: "internal" });
    assert.equal(unweighted.scoreboard.overallMean, 2, "(0+4)/2");
    // Weighted: (1*0 + 2*4) / (1+2) = 8/3 ≈ 2.67
    assert.equal(weighted.scoreboard.weightedIndex, 2.67);
});
test("M2 flag from the plan is surfaced verbatim in the scoreboard", () => {
    const m2 = {
        criterion: "M2",
        score: 0,
        divergent: true,
        severity: "HIGH — 宣言乖離が大きい",
        rationale: "demo",
        mechanical: true,
        basis: { declaredType: "agent", onStructuralAxes: [], declaredAxis: "orchestration" },
    };
    const out = aggregate({ passA: pass([{ criterion: "M1", score: 1, confidence: "high", rationale: "" }]) }, { m2FromPlan: m2 });
    assert.equal(out.scoreboard.m2Flag.score, 0);
    assert.equal(out.scoreboard.m2Flag.divergent, true);
    assert.match(out.scoreboard.m2Flag.severity, /HIGH/);
});
test("without a plan M2 the scoreboard notes it was not derived", () => {
    const out = aggregate({ passA: pass([{ criterion: "M1", score: 1, confidence: "high", rationale: "" }]) });
    assert.equal(out.scoreboard.m2Flag.score, "not derived");
});
