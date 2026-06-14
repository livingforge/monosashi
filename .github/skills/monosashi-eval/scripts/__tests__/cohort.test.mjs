// cohort rolls several artifacts' scoreboard summaries into one comparison view (S5). The pure
// builders are tested here (the file-reading / --dir glob / usage-exit shell stays in main()):
// canonical track-key ordering, the TOON cohort object (weighting inherited from the first
// artifact), and the markdown table — where the mechanical M2 stays an independent column
// (severity, never folded into the track radar) and null cells render as "—".
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCohort, cohortTrackKeys, renderCohortMd } from "../cohort.mjs";
function summary(over = {}) {
    return {
        target: "a",
        declaredType: "agent",
        weighting: "internal",
        weightedIndex: 2.5,
        overallMean: 2.5,
        naCount: 0,
        tracks: { M: 3, G: 2 },
        trackN: { M: 1, G: 5 },
        domains: {},
        m2: { divergent: false, severity: "none", score: 3, rationale: "ok" },
        reconciliation: null,
        confidence: { high: 1, medium: 0, low: 0 },
        needsHumanReview: [],
        lowConfidence: [],
        criteria: {},
        ...over,
    };
}
test("cohortTrackKeys yields the canonical M,G,A,S,H,K order, unknown tracks last", () => {
    const keys = cohortTrackKeys([
        summary({ tracks: { K: 1, A: 1 } }),
        summary({ tracks: { G: 1, M: 1, Z: 1 } }),
    ]);
    assert.deepEqual(keys, ["M", "G", "A", "K", "Z"]);
});
test("buildCohort inherits weighting from the first artifact and passes summaries through", () => {
    const a = summary({ target: "a", weighting: "external", tracks: { M: 3 } });
    const b = summary({ target: "b", weighting: "internal", tracks: { G: 2 } });
    const cohort = buildCohort([a, b]);
    assert.equal(cohort.count, 2);
    assert.equal(cohort.weighting, "external", "weighting follows the first artifact");
    assert.deepEqual(cohort.trackKeys, ["M", "G"]);
    assert.deepEqual(cohort.artifacts, [a, b]);
});
test("buildCohort on an empty cohort defaults weighting to internal", () => {
    const cohort = buildCohort([]);
    assert.equal(cohort.count, 0);
    assert.equal(cohort.weighting, "internal");
    assert.deepEqual(cohort.trackKeys, []);
});
test("renderCohortMd: one row per artifact, header carries the count and the union track columns", () => {
    const md = renderCohortMd([
        summary({ target: "a", tracks: { M: 3, G: 2 } }),
        summary({ target: "b", tracks: { M: 1, A: 4 } }),
    ]);
    const lines = md.split("\n");
    assert.equal(lines[0], "# Cohort summary (2 artifacts)");
    assert.match(md, /\| Artifact \| type \| wIndex \| M \| G \| A \| M2 \| needsReview \|/);
    // 1 title + 1 blank + 1 header + 1 separator + 2 data rows.
    assert.equal(lines.filter((l) => l.startsWith("| ") && /\bagent\b/.test(l)).length, 2);
});
test("renderCohortMd: M2 is an independent column (severity when divergent, else 'none')", () => {
    const md = renderCohortMd([
        summary({ target: "honest", m2: { divergent: false, severity: "none", rationale: "" } }),
        summary({ target: "liar", m2: { divergent: true, severity: "HIGH", rationale: "" }, needsHumanReview: [{ criterion: "A2" }] }),
    ]);
    const liar = md.split("\n").find((l) => l.includes("liar"));
    const honest = md.split("\n").find((l) => l.includes("honest"));
    assert.match(liar, /\| HIGH \| 1 \|$/, "divergent M2 surfaces its severity + needsReview count");
    assert.match(honest, /\| none \| 0 \|$/, "faithful M2 surfaces 'none'");
});
test("renderCohortMd: a null radar/index cell renders as an em dash", () => {
    const md = renderCohortMd([summary({ target: "x", weightedIndex: null, tracks: { M: 3, G: 2 }, declaredType: null })]);
    const row = md.split("\n").find((l) => l.includes("| x |"));
    // declaredType null -> "—", weightedIndex null -> "—"
    assert.match(row, /\| x \| — \| — \|/);
});
