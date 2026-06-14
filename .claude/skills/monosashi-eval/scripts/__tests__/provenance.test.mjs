// Unit tests for the run-correlation / audit-trail layer (A5 観測性 / H3 監査基盤).
// The clock is injected (fixed Date) so these stay deterministic. buildAudit is pure and
// re-projects reconciled scores into a judgement-provenance trail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { argRunId, makeProvenance, mintRunId } from "../provenance.mjs";
import { buildAudit } from "../aggregate.mjs";
const FIXED = new Date("2026-05-31T12:00:00.000Z");
test("mintRunId: basename + compact UTC stamp, sanitised", () => {
    assert.equal(mintRunId("eval-out/my skill", FIXED), "my-skill-20260531T120000Z");
    assert.equal(mintRunId("c:\\eval2\\agents\\foo.md", FIXED), "foo.md-20260531T120000Z");
});
test("argRunId: parses --run-id, null when absent", () => {
    assert.equal(argRunId(["--run-id", "abc"]), "abc");
    assert.equal(argRunId(["profile.json", "--run-id", "r1"]), "r1");
    assert.equal(argRunId(["profile.json"]), null);
    assert.equal(argRunId(["--run-id"]), null); // dangling flag, no value
});
test("makeProvenance: stamps runId/tool/inputs with injected clock", () => {
    const p = makeProvenance("aggregate", "r1", ["passA.json", "plan.json"], FIXED);
    assert.equal(p.runId, "r1");
    assert.equal(p.producedBy, "aggregate");
    assert.equal(p.producedAt, "2026-05-31T12:00:00.000Z");
    assert.deepEqual(p.inputs, ["passA.json", "plan.json"]);
    // No inputs → omit the key entirely.
    assert.equal("inputs" in makeProvenance("inventory", "r1", [], FIXED), false);
    // toolVersion omitted by default, included when supplied.
    assert.equal("toolVersion" in makeProvenance("inventory", "r1", [], FIXED), false);
    assert.equal(makeProvenance("inventory", "r1", [], FIXED, "0.2.0").toolVersion, "0.2.0");
});
test("buildAudit: median(A,B,C) entry records all three judgements + review flag + evidence", () => {
    const merged = [
        {
            criterion: "A1", score: 2, confidence: "low",
            scoreA: 1, scoreB: 3, scoreC: 2,
            confidenceA: "medium", confidenceB: "medium", confidenceC: "low",
            rationale: "…", evidence: [{ path: "body.md", lines: "10-12" }],
        },
    ];
    const trail = buildAudit(merged, new Set(["A1"]));
    assert.equal(trail.length, 1);
    const e = trail[0];
    assert.equal(e.criterion, "A1");
    assert.equal(e.track, "A");
    assert.equal(e.method, "median(A,B,C)");
    assert.deepEqual(e.judgements.map((j) => `${j.pass}:${j.score}`), ["A:1", "B:3", "C:2"]);
    assert.equal(e.needsHumanReview, true);
    assert.deepEqual(e.evidence, [{ path: "body.md", lines: "10-12" }]);
});
test("buildAudit: single-pass criterion → one A judgement, method 'single (A)', M2 excluded", () => {
    const merged = [
        { criterion: "K1", score: 3, confidence: "high", rationale: "…", evidence: [{ path: "SKILL.md" }] },
        { criterion: "M2", score: 3, confidence: "high", rationale: "mechanical" },
    ];
    const trail = buildAudit(merged, new Set());
    assert.equal(trail.length, 1, "M2 is excluded from the trail");
    assert.equal(trail[0].criterion, "K1");
    assert.equal(trail[0].method, "single (A)");
    assert.deepEqual(trail[0].judgements, [{ pass: "A", score: 3, confidence: "high" }]);
    assert.equal(trail[0].needsHumanReview, false);
});
