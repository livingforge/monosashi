// Unit tests for the Stage-3.2 second-opinion selector: pass B re-scores only the criteria
// pass A was NOT highly confident about (the high-confidence remainder stays singlePass).
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectSecondOpinion } from "../second-opinion.mjs";
const plan = {
    target: "t",
    declaredType: "skill",
    rubricVersion: "v3",
    scale: [],
    hasCodePath: true,
    appliedTracks: ["M", "G"],
    criteriaToScore: [
        { criterion: "M1", levels: [], tags: [] },
        { criterion: "G1", levels: [], tags: [] },
        { criterion: "G3", levels: [], tags: [] },
    ],
};
function passA(scores) {
    return { target: "t", scores };
}
test("targets only the criteria A was not high-confident about", () => {
    const a = passA([
        { criterion: "M1", score: 3, confidence: "high", rationale: "" },
        { criterion: "G1", score: 2, confidence: "medium", rationale: "" },
        { criterion: "G3", score: 1, confidence: "high", rationale: "" },
    ]);
    const out = selectSecondOpinion(a, plan);
    assert.equal(out.shouldRun, true);
    assert.deepEqual(out.reviewTargets, ["G1"]);
    assert.equal(out.criteriaToScore.length, 1);
});
test("a criterion A skipped entirely is treated as low-confidence and re-scored", () => {
    const a = passA([
        { criterion: "M1", score: 3, confidence: "high", rationale: "" },
        { criterion: "G1", score: 2, confidence: "high", rationale: "" },
        // G3 missing
    ]);
    const out = selectSecondOpinion(a, plan);
    assert.deepEqual(out.reviewTargets, ["G3"]);
    assert.equal(out.reviewDetail.find((r) => r.criterion === "G3")?.confidenceA, "low");
});
test("A uniformly high-confidence ⇒ shouldRun:false (skip pass B)", () => {
    const a = passA([
        { criterion: "M1", score: 3, confidence: "high", rationale: "" },
        { criterion: "G1", score: 2, confidence: "high", rationale: "" },
        { criterion: "G3", score: 1, confidence: "high", rationale: "" },
    ]);
    const out = selectSecondOpinion(a, plan);
    assert.equal(out.shouldRun, false);
    assert.equal(out.reviewTargets.length, 0);
});
test("--also-high re-scores every planned criterion", () => {
    const a = passA([
        { criterion: "M1", score: 3, confidence: "high", rationale: "" },
        { criterion: "G1", score: 2, confidence: "high", rationale: "" },
        { criterion: "G3", score: 1, confidence: "high", rationale: "" },
    ]);
    const out = selectSecondOpinion(a, plan, { alsoHigh: true });
    assert.deepEqual(out.reviewTargets.sort(), ["G1", "G3", "M1"]);
});
test("LLM drift is normalised first: 'High' is read as high (no needless re-score) and lc ids match", () => {
    // Without normalisation, "High" reads as != "high" → every criterion would be re-scored, and
    // lower-cased "m1"/"g1"/"g3" would never match the plan ids. This pins that normalizePass runs.
    const a = passA([
        { criterion: "m1", score: 3, confidence: "High", rationale: "" },
        { criterion: "g1", score: 2, confidence: " HIGH ", rationale: "" },
        { criterion: "g3", score: 1, confidence: "medium", rationale: "" },
    ]);
    const out = selectSecondOpinion(a, plan);
    assert.equal(out.shouldRun, true);
    assert.deepEqual(out.reviewTargets, ["G3"], "only the genuinely medium-confidence id, matched after normalisation");
});
