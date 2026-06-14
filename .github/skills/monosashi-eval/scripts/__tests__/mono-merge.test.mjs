// Unit tests for `mergePassScores` — the re-emit *patch* merge that lets a judge re-score ONLY the
// flagged criteria (written to passX.patch.json) instead of re-emitting the whole pass. mono merges
// the patch into the existing pass TOON, so the judge never reads back the prior JSON (the
// reference-token cut). Option 1: a patch entry overwrites an existing criterion (and is reported in
// `overwritten` so the CLI can log it). These tests pin add-vs-overwrite, shell preservation, and the
// no-op patch — the contract the gate's self-heal depends on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergePassScores } from "../mono.mjs";
const score = (criterion, s) => ({ criterion, score: s, confidence: "high" });
test("a patch ADDS a criterion missing from the base (the headline case: plan has A4, base lacks it)", () => {
    const base = { target: "x", scores: [score("K1", 3), score("E1", 2)] };
    const patch = { scores: [score("A4", "N/A")] };
    const { merged, added, overwritten } = mergePassScores(base, patch);
    assert.deepEqual(added, ["A4"]);
    assert.deepEqual(overwritten, []);
    assert.equal(merged.scores.length, 3);
    assert.deepEqual(merged.scores.map((s) => s.criterion), ["K1", "E1", "A4"]);
});
test("a patch OVERWRITES an existing criterion (option 1) and reports it in `overwritten`", () => {
    const base = { scores: [score("K1", 3), score("E1", 2)] };
    const patch = { scores: [{ ...score("K1", 1), confidence: "low" }] };
    const { merged, added, overwritten } = mergePassScores(base, patch);
    assert.deepEqual(added, []);
    assert.deepEqual(overwritten, ["K1"], "existing key is reported as overwritten (for the audit log)");
    const k1 = merged.scores.find((s) => s.criterion === "K1");
    assert.equal(k1.score, 1, "patch value wins");
    assert.equal(k1.confidence, "low");
    assert.equal(merged.scores.length, 2, "no duplicate K1 — replaced in place");
});
test("a patch mixing a new and an existing criterion splits add vs overwrite correctly", () => {
    const base = { scores: [score("K1", 3)] };
    const patch = { scores: [score("K1", 4), score("H1", 2)] };
    const { added, overwritten } = mergePassScores(base, patch);
    assert.deepEqual(overwritten, ["K1"]);
    assert.deepEqual(added, ["H1"]);
});
test("the base's non-scores shell fields (target, declaredType) survive the merge", () => {
    const base = { target: "agent-x", declaredType: "skill", scores: [score("K1", 3)] };
    const { merged } = mergePassScores(base, { scores: [score("A4", "N/A")] });
    assert.equal(merged.target, "agent-x");
    assert.equal(merged.declaredType, "skill");
});
test("an empty / scores-less patch is a no-op (base returned unchanged, nothing added or overwritten)", () => {
    const base = { scores: [score("K1", 3)] };
    for (const patch of [{ scores: [] }, {}]) {
        const { merged, added, overwritten } = mergePassScores(base, patch);
        assert.deepEqual(added, []);
        assert.deepEqual(overwritten, []);
        assert.deepEqual(merged.scores.map((s) => s.criterion), ["K1"]);
    }
});
test("a duplicate criterion WITHIN the patch resolves last-wins (a lazy full-dump patch still merges cleanly)", () => {
    const base = { scores: [score("K1", 3)] };
    const patch = { scores: [score("K1", 1), score("K1", 4)] };
    const { merged } = mergePassScores(base, patch);
    assert.equal(merged.scores.filter((s) => s.criterion === "K1").length, 1);
    assert.equal(merged.scores.find((s) => s.criterion === "K1").score, 4, "last patch entry wins");
});
