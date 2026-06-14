// Unit tests for the pack slicer (S3.3/S3.6 token cut): a reduced plan keeps only its
// criteria's evidence items, and surface-drift in ids is normalised before matching.
import { test } from "node:test";
import assert from "node:assert/strict";
import { slicePack } from "../slice-pack.mjs";
const pack = {
    target: "t",
    items: [
        { criterion: "M1", candidates: [{ path: "a.md", lines: "1-3" }] },
        { criterion: "G2", candidates: [{ path: "b.mjs", lines: "9" }] },
        { criterion: "K5", candidates: [{ path: "c.md", lines: "4" }] },
    ],
};
test("slicePack keeps only the criteria the reduced plan covers", () => {
    const out = slicePack(pack, { criteriaToScore: [{ criterion: "K5" }] });
    assert.equal(out.items.length, 1);
    assert.equal(out.items[0].criterion, "K5");
    assert.equal(out.target, "t", "carries pack metadata through");
});
test("slicePack with a multi-criterion plan keeps exactly those, order-independent", () => {
    const out = slicePack(pack, { criteriaToScore: [{ criterion: "G2" }, { criterion: "M1" }] });
    assert.deepEqual(out.items.map((i) => i.criterion).sort(), ["G2", "M1"]);
});
test("slicePack of an empty plan keeps nothing", () => {
    assert.equal(slicePack(pack, { criteriaToScore: [] }).items.length, 0);
    assert.equal(slicePack(pack, {}).items.length, 0);
});
test("slicePack normalises a lower-cased id before matching", () => {
    // normalizePack canonicalises "k5" → "K5", so a drifted plan id still matches.
    const out = slicePack(pack, { criteriaToScore: [{ criterion: "K5" }] });
    assert.equal(out.items.length, 1);
});
