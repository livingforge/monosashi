// Integrity tests for the source-of-truth rubric. §7 requires the verbatim level text to be
// carried to the judge, so every criterion must expose a complete 0..4 ladder; a missing or
// empty level would silently degrade scoring. Also pins the weight-profile postures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RUBRIC, WEIGHT_PROFILES } from "../rubric.mjs";
test("rubric is v3.1 with a 5-step 0..4 scale", () => {
    assert.equal(RUBRIC.version, "v3.1");
    assert.equal(RUBRIC.scale.length, 5);
    assert.deepEqual(RUBRIC.scale.map((s) => s.level), [0, 1, 2, 3, 4]);
});
test("every criterion carries a complete, non-empty 0..4 level ladder and tags", () => {
    for (const track of RUBRIC.tracks) {
        for (const c of track.criteria) {
            assert.equal(c.levels.length, 5, `${c.id} must have 5 levels`);
            assert.ok(c.levels.every((l) => typeof l === "string" && l.trim().length > 0), `${c.id} has an empty level`);
            assert.ok(Array.isArray(c.tags) && c.tags.length > 0, `${c.id} must carry >=1 tag`);
            assert.equal(c.track, track.id, `${c.id}.track must match its track`);
        }
    }
});
test("criterion ids are unique and the M track exists with M1/M2", () => {
    const ids = RUBRIC.tracks.flatMap((t) => t.criteria.map((c) => c.id));
    assert.equal(new Set(ids).size, ids.length, "duplicate criterion id");
    assert.ok(ids.includes("M1") && ids.includes("M2"));
    assert.ok(RUBRIC.tracks.some((t) => t.id === "M"));
});
test("track ids are drawn from the legal set", () => {
    const legal = new Set(["M", "G", "A", "S", "H", "K"]);
    for (const t of RUBRIC.tracks)
        assert.ok(legal.has(t.id), `illegal track id ${t.id}`);
});
test("weight profiles encode the two postures", () => {
    assert.equal(WEIGHT_PROFILES.external.safety, 2.0);
    assert.equal(WEIGHT_PROFILES.external.observability, 2.0);
    assert.equal(WEIGHT_PROFILES.external.governance, 2.0);
    assert.equal(WEIGHT_PROFILES.internal.structure, 2.0);
    assert.equal(WEIGHT_PROFILES.internal.reusability, 2.0);
    assert.equal(WEIGHT_PROFILES.internal.reliability, 2.0);
});
