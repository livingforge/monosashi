// Unit tests for the Stage-3.6 tie-break selector: only criteria whose pass-A/pass-B scores
// differ by >= threshold are contested (N/A divergence is handled elsewhere, not here).
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectContested } from "../contested.mjs";
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
const A = {
    target: "t",
    scores: [
        { criterion: "M1", score: 3, confidence: "high", rationale: "" },
        { criterion: "G1", score: 3, confidence: "medium", rationale: "" },
        { criterion: "G3", score: 1, confidence: "medium", rationale: "" },
    ],
};
const B = {
    target: "t",
    scores: [
        { criterion: "M1", score: 3, confidence: "high", rationale: "" }, // agree
        { criterion: "G1", score: 1, confidence: "medium", rationale: "" }, // diff 2
        { criterion: "G3", score: "N/A", confidence: "low", rationale: "" }, // N/A → skipped
    ],
};
test("default threshold 1: only genuinely divergent numeric pairs are contested", () => {
    const out = selectContested(A, B, plan);
    assert.equal(out.shouldRun, true);
    assert.deepEqual(out.contested, ["G1"]);
    assert.equal(out.criteriaToScore.length, 1);
    assert.equal(out.contestedDetail[0].diff, 2);
});
test("N/A scores are not contested (divergence handled elsewhere)", () => {
    const out = selectContested(A, B, plan);
    assert.ok(!out.contested.includes("G3"));
});
test("raising the threshold above the gap ⇒ nothing contested, shouldRun:false", () => {
    const out = selectContested(A, B, plan, { threshold: 3 });
    assert.equal(out.shouldRun, false);
    assert.equal(out.contested.length, 0);
    assert.equal(out.threshold, 3);
});
test("a criterion only one pass scored is never contested (no overlap)", () => {
    const bMissing = { target: "t", scores: [{ criterion: "M1", score: 3, confidence: "high", rationale: "" }] };
    const out = selectContested(A, bMissing, plan);
    assert.deepEqual(out.contested, []);
});
test("LLM drift is normalised first: string scores and lc ids still diff correctly", () => {
    // A string score "1" left unnormalised is non-numeric, so the |A−B| diff would silently skip
    // G1 (the genuinely contested pair). Pins that normalizePass runs before the diff.
    const aDrift = {
        target: "t",
        scores: [
            { criterion: "m1", score: "3", confidence: "high", rationale: "" },
            { criterion: "g1", score: "3", confidence: "medium", rationale: "" },
        ],
    };
    const bDrift = {
        target: "t",
        scores: [
            { criterion: "M1", score: 3, confidence: "high", rationale: "" },
            { criterion: "G1", score: "1", confidence: "medium", rationale: "" },
        ],
    };
    const out = selectContested(aDrift, bDrift, plan);
    assert.deepEqual(out.contested, ["G1"], "string '3' vs '1' diffs to 2 after normalisation");
    assert.equal(out.contestedDetail[0].diff, 2);
});
