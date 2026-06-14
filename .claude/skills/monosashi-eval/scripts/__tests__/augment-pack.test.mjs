// Unit tests for the pack augmenter (S3.25 opt-in re-gather): a targeted re-gathered pack is merged
// into the master APPEND-ONLY per review criterion, so pass A's evidenceRefs indices stay valid, the
// master↔slice index alignment the rest of the pipeline relies on is preserved, and pass B gets the
// extra evidence. These pin: index preservation, de-dup, non-review criteria untouched, and the slice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { augmentPack } from "../augment-pack.mjs";
const master = {
    target: "t",
    items: [
        { criterion: "M1", candidates: [{ path: "a.md", lines: "1-3", snippet: "x" }] },
        { criterion: "G2", candidates: [{ path: "b.mjs", lines: "9", snippet: "y" }] },
        { criterion: "K5", candidates: [{ path: "c.md", lines: "4", snippet: "z" }] },
    ],
};
test("augments a review criterion APPEND-ONLY: existing candidate keeps index 0, fresh appended after", () => {
    const gather = {
        target: "t",
        items: [{ criterion: "G2", candidates: [{ path: "b.mjs", lines: "20-22", snippet: "fresh" }] }],
    };
    const { master: aug } = augmentPack(master, gather, { criteriaToScore: [{ criterion: "G2" }] });
    const g2 = aug.items.find((i) => i.criterion === "G2");
    assert.equal(g2.candidates.length, 2);
    assert.equal(g2.candidates[0].snippet, "y", "the pre-existing candidate keeps index 0 (pass A refs stay valid)");
    assert.equal(g2.candidates[1].snippet, "fresh", "the freshly-gathered candidate is appended after");
});
test("non-review criteria are untouched in the master", () => {
    const gather = {
        target: "t",
        // gather also returns M1 candidates, but M1 is NOT in the review plan → must be ignored.
        items: [
            { criterion: "G2", candidates: [{ path: "b.mjs", lines: "20", snippet: "fresh" }] },
            { criterion: "M1", candidates: [{ path: "a.md", lines: "50", snippet: "should-not-appear" }] },
        ],
    };
    const { master: aug } = augmentPack(master, gather, { criteriaToScore: [{ criterion: "G2" }] });
    const m1 = aug.items.find((i) => i.criterion === "M1");
    assert.deepEqual(m1.candidates.map((c) => c.snippet), ["x"], "M1 (not in review plan) is unchanged");
});
test("a duplicate fresh candidate (same path + lines) is de-duped, not appended twice", () => {
    const gather = {
        target: "t",
        items: [{ criterion: "G2", candidates: [
                    { path: "b.mjs", lines: "9", snippet: "y" }, // same path+lines as existing → drop
                    { path: "b.mjs", lines: "30", snippet: "new" }, // genuinely new → keep
                ] }],
    };
    const { master: aug } = augmentPack(master, gather, { criteriaToScore: [{ criterion: "G2" }] });
    const g2 = aug.items.find((i) => i.criterion === "G2");
    assert.equal(g2.candidates.length, 2, "the duplicate is dropped; only the new range is appended");
    assert.equal(g2.candidates[1].lines, "30");
});
test("the emitted slice covers exactly the review plan's criteria, in plan order, with augmented candidates", () => {
    const gather = {
        target: "t",
        items: [
            { criterion: "K5", candidates: [{ path: "c.md", lines: "40", snippet: "k5-new" }] },
            { criterion: "M1", candidates: [{ path: "a.md", lines: "60", snippet: "m1-new" }] },
        ],
    };
    const { slice } = augmentPack(master, gather, { criteriaToScore: [{ criterion: "M1" }, { criterion: "K5" }] });
    assert.deepEqual(slice.items.map((i) => i.criterion), ["M1", "K5"], "plan order, review subset only (no G2)");
    assert.equal(slice.items[1].candidates.length, 2, "K5 got its fresh candidate appended");
    assert.equal(slice.target, "t", "carries pack metadata through");
});
test("a review criterion with no fresh candidates is left exactly as-is (no spurious change)", () => {
    const gather = { target: "t", items: [] };
    const { master: aug, slice } = augmentPack(master, gather, { criteriaToScore: [{ criterion: "G2" }] });
    assert.deepEqual(aug.items.find((i) => i.criterion === "G2").candidates, master.items[1].candidates);
    assert.equal(slice.items.length, 1);
    assert.equal(slice.items[0].criterion, "G2");
});
test("a review criterion missing from the master is added from the re-gathered pack alone", () => {
    const thin = { target: "t", items: [{ criterion: "M1", candidates: [{ path: "a.md", lines: "1" }] }] };
    const gather = { target: "t", items: [{ criterion: "S1", candidates: [{ path: "d.md", lines: "2", snippet: "s1" }] }] };
    const { slice } = augmentPack(thin, gather, { criteriaToScore: [{ criterion: "S1" }] });
    assert.equal(slice.items.length, 1);
    assert.equal(slice.items[0].criterion, "S1");
    assert.equal(slice.items[0].candidates[0].snippet, "s1");
});
test("normalises a lower-cased gather criterion id before matching the plan", () => {
    const gather = {
        target: "t",
        items: [{ criterion: "g2", candidates: [{ path: "b.mjs", lines: "44", snippet: "drift" }] }],
    };
    const { master: aug } = augmentPack(master, gather, { criteriaToScore: [{ criterion: "G2" }] });
    const g2 = aug.items.find((i) => i.criterion === "G2");
    assert.equal(g2.candidates.length, 2, "the drifted 'g2' id is canonicalised to 'G2' and matched");
});
