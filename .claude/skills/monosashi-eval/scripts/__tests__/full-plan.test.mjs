// full-plan builds the LIGHTWEIGHT all-criteria plan the surveyor gathers evidence against in
// its single read (§5). The contract that matters: every rubric criterion is present EXCEPT the
// mechanical M2, no verbatim level ladder / anchor leaks (§7 reference-token cut — those are the
// judge's tools, embedded later by select-tracks), and each entry's `lookFor` names the Lv2 floor
// PLUS the Lv3/Lv4 climbing discriminators (idea ① — so the sweep hunts the ceiling, e.g. 誤用例・
// 対比, not just "the capability exists"), while leaking NO bare level number. A regression here
// silently changes what the surveyor hunts for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFullPlan, huntHint } from "../full-plan.mjs";
import { RUBRIC } from "../rubric.mjs";
test("covers every rubric criterion across all tracks except the mechanical M2", () => {
    const plan = buildFullPlan();
    const got = plan.criteriaToScore.map((c) => c.criterion);
    const expected = RUBRIC.tracks.flatMap((t) => t.criteria.map((c) => c.id)).filter((id) => id !== "M2");
    assert.deepEqual(new Set(got), new Set(expected));
    assert.ok(!got.includes("M2"), "M2 is mechanical and must not be an evidence-gathering target");
    // counts.criteria mirrors the list length (the surveyor reads it as the coverage target).
    assert.equal(plan.counts.criteria, got.length);
    assert.equal(got.length, expected.length, "no duplicate or missing criterion");
});
test("each entry carries title/track/tags + a climbing-discriminator lookFor, and NO verbatim ladder or anchor", () => {
    const plan = buildFullPlan();
    const byId = new Map(RUBRIC.tracks.flatMap((t) => t.criteria.map((c) => [c.id, c])));
    for (const entry of plan.criteriaToScore) {
        const c = byId.get(entry.criterion);
        assert.ok(c, `${entry.criterion} is a real rubric criterion`);
        assert.equal(entry.track, c.track);
        assert.equal(entry.title, c.title);
        assert.deepEqual(entry.tags, c.tags);
        // lookFor is the hunt hint (idea ①): it names the Lv2 floor AND the Lv3/Lv4 climbing
        // discriminators so the sweep hunts the ceiling, not just "the capability exists".
        assert.equal(entry.lookFor, huntHint(c));
        assert.ok(entry.lookFor.includes(c.levels[2]), `${entry.criterion} lookFor names the Lv2 floor signal`);
        assert.ok(entry.lookFor.includes(c.levels[3]), `${entry.criterion} lookFor names the Lv3 discriminator`);
        assert.ok(entry.lookFor.includes(c.levels[4]), `${entry.criterion} lookFor names the Lv4 ceiling signal`);
        // The hint must NOT carry a bare level number — that would pre-empt the judge's 0–4 mapping.
        assert.ok(!/Lv\s*[0-4]/i.test(entry.lookFor), `${entry.criterion} lookFor must not leak a level number`);
        // §7 cut: the full 0..4 ladder and the tie-break anchor are NOT shipped to the surveyor.
        assert.ok(!("levels" in entry), `${entry.criterion} must not carry verbatim levels`);
        assert.ok(!("anchor" in entry), `${entry.criterion} must not carry the tie-break anchor`);
    }
});
test("plan is lightweight, profile-free, and version-stamped", () => {
    const plan = buildFullPlan();
    assert.equal(plan.target, null, "no target/profile is bound at full-plan time");
    assert.equal(plan.all, true);
    assert.equal(plan.lightweight, true);
    assert.equal(plan.rubricVersion, RUBRIC.version);
    assert.deepEqual(plan.scale, RUBRIC.scale);
});
test("buildFullPlan is pure — repeated calls are value-equal", () => {
    assert.deepEqual(buildFullPlan(), buildFullPlan());
});
