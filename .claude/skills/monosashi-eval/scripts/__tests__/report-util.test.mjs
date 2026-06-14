// Unit tests for the report layer (report-util + report-html). `summarizeBoard` flattens the
// scoreboard.toon that `aggregate` writes — and the comment at the top of report-util.ts records
// that the orchestrator USED to re-derive this by hand and got the nesting wrong (radar / m2Flag
// live under `.scoreboard`, while reconciliation / needsHumanReview / mergedScores are top-level).
// So the flatten, the track ordering, the markdown render, and that renderHtml does not throw are
// pinned here. Pure formatting — no IO, ships with the bundle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeBoard, orderedTrackKeys, renderMarkdown } from "../report-util.mjs";
import { renderHtml } from "../report-html.mjs";
/** A representative scoreboard in the exact nested shape aggregate.ts emits. */
function board(over = {}) {
    return {
        provenance: { runId: "run-demo", producedBy: "aggregate", toolVersion: "0.4.1", producedAt: "2026-01-01T00:00:00Z", inputs: [] },
        target: "demo-artifact",
        declaredType: "skill",
        twoPass: true,
        tieBreak: { applied: false },
        reconciliation: { comparedNumeric: 2, exactAgreement: 0.5, needsHumanReview: 1, tieBroken: 0, singlePass: 0 },
        needsHumanReview: [{ criterion: "G1", diff: 2, passA: 1, passB: 3 }],
        scoreboard: {
            radarByTrack: { G: { mean: 2, n: 2 }, M: { mean: 3, n: 1 }, K: { mean: 4, n: 1 } },
            radarByDomain: { structure: { mean: 2.5, n: 2 } },
            overallMean: 2.75,
            weighting: "internal",
            weightedIndex: 2.9,
            confidence: { high: 1, medium: 1, low: 2 },
            naCount: 1,
            m2Flag: { score: 0, divergent: true, severity: "HIGH — 宣言乖離が大きい", rationale: "実体が別物", mechanical: true, basis: { declaredType: "skill", onStructuralAxes: ["harness"], declaredAxis: "encapsulation" } },
        },
        mergedScores: [
            { criterion: "M1", score: 3, confidence: "high", rationale: "" },
            { criterion: "G1", score: 2, confidence: "low", rationale: "", scoreA: 1, scoreB: 3 },
            { criterion: "K1", score: 4, confidence: "low", rationale: "" },
            { criterion: "G2", score: "N/A", confidence: "medium", rationale: "" },
        ],
        audit: {
            passes: { A: true, B: true, C: false },
            trail: [
                { criterion: "G1", track: "G", finalScore: 2, confidence: "low", method: "mean(A,B)", judgements: [{ pass: "A", score: 1, confidence: "low" }, { pass: "B", score: 3, confidence: "medium" }], evidence: [{ path: "a.md", lines: "1-3" }], needsHumanReview: true },
            ],
        },
        ...over,
    };
}
test("orderedTrackKeys: canonical M,G,A,S,H,K order; unknown tracks sort last alphabetically", () => {
    assert.deepEqual(orderedTrackKeys(["K", "G", "M"]), ["M", "G", "K"]);
    assert.deepEqual(orderedTrackKeys(["Z", "A", "M"]), ["M", "A", "Z"]);
});
test("summarizeBoard: flattens the nested scoreboard without losing or mis-nesting fields", () => {
    const s = summarizeBoard(board());
    assert.equal(s.target, "demo-artifact");
    assert.equal(s.declaredType, "skill");
    assert.equal(s.weightedIndex, 2.9);
    assert.equal(s.overallMean, 2.75);
    assert.equal(s.naCount, 1);
    // radar (was nested under .scoreboard) lands at top level, in track order
    assert.deepEqual(Object.keys(s.tracks), ["M", "G", "K"]);
    assert.equal(s.tracks.G, 2);
    assert.equal(s.trackN.G, 2);
    assert.equal(s.domains.structure, 2.5);
    // m2 lifted out of scoreboard.m2Flag
    assert.equal(s.m2.divergent, true);
    assert.match(s.m2.severity, /HIGH/);
    assert.equal(s.m2.score, 0);
    // reconciliation/needsHumanReview were already top-level on the board
    assert.equal(s.reconciliation.comparedNumeric, 2);
    assert.deepEqual(s.needsHumanReview, [{ criterion: "G1", range: 2 }]);
    // provenance envelope flattened into runId/producedAt/toolVersion
    assert.equal(s.runId, "run-demo");
    assert.equal(s.toolVersion, "0.4.1");
});
test("summarizeBoard: per-criterion scores + low-confidence list derive from mergedScores", () => {
    const s = summarizeBoard(board());
    assert.deepEqual(s.criteria, { M1: 3, G1: 2, K1: 4, G2: "N/A" });
    assert.deepEqual(s.lowConfidence.sort(), ["G1", "K1"]);
});
test("summarizeBoard: a not-derived M2 (note instead of score) degrades to severity 'not derived'", () => {
    const b = board();
    b.scoreboard.m2Flag = { score: "not derived", note: "plan.m2 が渡されていません" };
    const s = summarizeBoard(b);
    assert.equal(s.m2.divergent, false);
    assert.equal(s.m2.severity, "not derived");
    assert.match(s.m2.rationale, /plan\.m2/);
});
test("renderMarkdown: leads with the radar, surfaces M2 independently, and renders the audit trail", () => {
    const md = renderMarkdown(summarizeBoard(board()));
    assert.match(md, /# Monosashi report — demo-artifact/);
    assert.match(md, /## Radar/);
    assert.match(md, /## M2 — declaration↔reality divergence/);
    assert.match(md, /\| G \| 2 \| 2 \|/, "radar row for track G");
    assert.match(md, /## Audit trail \(passes A\+B\)/);
    assert.match(md, /G1 \| 2 \(low\) \| mean\(A,B\)/, "audit row");
    assert.match(md, /run-demo/, "run id correlation line");
});
test("renderHtml: produces a self-contained HTML document naming the target (smoke, no throw)", () => {
    const html = renderHtml(board());
    assert.equal(typeof html, "string");
    assert.match(html, /<html/i);
    assert.match(html, /demo-artifact/);
    assert.ok(html.length > 500, "non-trivial document");
});
