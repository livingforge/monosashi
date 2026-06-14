// Consolidated regression hard-case set for the deterministic spine (H1 評価カバレッジ).
// package-meta/monosashi/coverage.md names THIS file as the end-to-end pin of the spine, so each behaviour that
// doc claims is covered must fail here if it regresses:
//   - the coverage invariant (exact track set + per-track criteria counts, 23 total),
//   - the M2 hard cases (liar / undeclared sub-component / ambiguous / faithful),
//   - track applicability + G2 N/A gating threaded through buildPlan,
//   - reconciliation (mean / median tie-break / single-pass / N/A passthrough, needsHumanReview),
//   - the audit trail projected from a reconciled aggregate run.
// Pure functions — no IO, no LLM — so it ships into the bundle and runs in `npm test` too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RUBRIC } from "../rubric.mjs";
import { computeM2, buildPlan } from "../select-tracks.mjs";
import { aggregate, buildAudit } from "../aggregate.mjs";
function profile(over = {}) {
    return {
        target: over.target ?? "t",
        declaredType: over.declaredType,
        hasCodePath: over.hasCodePath ?? false,
        axes: {
            orchestration: over.axes?.orchestration ?? "absent",
            encapsulation: over.axes?.encapsulation ?? "absent",
            harness: over.axes?.harness ?? "absent",
            knowledge: over.axes?.knowledge ?? "absent",
        },
    };
}
function pass(scores, over = {}) {
    return { target: "t", declaredType: "skill", scores, ...over };
}
// --- Coverage invariant: a silently dropped/added criterion must fail the suite (coverage.md). ---
test("coverage invariant: exactly 6 tracks / 23 criteria with the documented per-track counts", () => {
    assert.deepEqual(RUBRIC.tracks.map((t) => t.id), ["M", "G", "A", "S", "H", "K"]);
    const perTrack = Object.fromEntries(RUBRIC.tracks.map((t) => [t.id, t.criteria.length]));
    assert.deepEqual(perTrack, { M: 2, G: 5, A: 5, S: 3, H: 3, K: 5 });
    const total = RUBRIC.tracks.reduce((n, t) => n + t.criteria.length, 0);
    assert.equal(total, 23, "the documented '23 criteria' coverage range must stay pinned");
});
// --- M2 hard cases (mechanical declaration↔reality flag). ---
test("M2 hard cases: liar agent (0) / undeclared sub-component (2) / ambiguous (1) / faithful (3)", () => {
    const liar = computeM2(profile({ declaredType: "agent", axes: { orchestration: "absent", knowledge: "primary" } }));
    assert.equal(liar.score, 0);
    assert.match(liar.severity, /HIGH/);
    const undeclared = computeM2(profile({ declaredType: "agent", axes: { orchestration: "present", harness: "present" } }));
    assert.equal(undeclared.score, 2);
    assert.match(undeclared.severity, /LOW/);
    const ambiguous = computeM2(profile({ declaredType: "widget", axes: { orchestration: "present" } }));
    assert.equal(ambiguous.score, 1);
    assert.match(ambiguous.severity, /MEDIUM/);
    const faithful = computeM2(profile({ declaredType: "skill", axes: { encapsulation: "present" } }));
    assert.equal(faithful.score, 3);
    assert.equal(faithful.divergent, false);
});
// --- Track applicability + G2 N/A gating, threaded through the real plan builder. ---
test("track applicability + G2 N/A gating + M2 plumbing via buildPlan", () => {
    const agent = buildPlan(profile({ declaredType: "agent", hasCodePath: true, axes: { orchestration: "present" } }));
    assert.ok(agent.appliedTracks.includes("A"), "orchestration present ⇒ A applies");
    assert.ok(agent.criteriaToScore.some((c) => c.criterion === "G2"), "code path ⇒ G2 is scored");
    assert.ok(!agent.criteriaToScore.some((c) => c.criterion === "M2"), "M2 is mechanical, never in criteriaToScore");
    assert.equal(agent.m2.criterion, "M2");
    const doc = buildPlan(profile({ declaredType: "knowledge-doc", hasCodePath: false, axes: { knowledge: "primary" } }));
    assert.ok(!doc.appliedTracks.includes("A"), "no orchestration ⇒ no A track");
    assert.ok(doc.naByRule.some((n) => n.criterion === "G2"), "no code path ⇒ G2 N/A by rule");
});
// --- Reconciliation hard cases end-to-end, plus the M2 flag wired from the plan. ---
test("reconciliation: median tie-break, two-pass mean + needsHumanReview, single-pass, N/A passthrough", () => {
    const plan = buildPlan(profile({ declaredType: "agent", hasCodePath: true, axes: { orchestration: "absent", encapsulation: "present" } }));
    assert.equal(plan.m2.score, 0, "declared agent but orchestration absent ⇒ M2=0");
    const out = aggregate({
        passA: pass([
            { criterion: "M1", score: 1, confidence: "medium", rationale: "" }, // median target (A,B,C)
            { criterion: "G1", score: 2, confidence: "medium", rationale: "" }, // mean(A,B), diff 2
            { criterion: "S1", score: 4, confidence: "high", rationale: "" }, // single-pass (absent from B)
            { criterion: "G2", score: "N/A", confidence: "high", rationale: "" }, // both N/A
        ]),
        passB: pass([
            { criterion: "M1", score: 3, confidence: "medium", rationale: "" },
            { criterion: "G1", score: 4, confidence: "medium", rationale: "" },
            { criterion: "G2", score: "N/A", confidence: "high", rationale: "" },
        ]),
        passC: pass([{ criterion: "M1", score: 3, confidence: "low", rationale: "" }]),
    }, { m2FromPlan: plan.m2 });
    const m1 = out.mergedScores.find((s) => s.criterion === "M1");
    assert.equal(m1.score, 3, "median(1,3,3)=3");
    const g1 = out.mergedScores.find((s) => s.criterion === "G1");
    assert.equal(g1.score, 3, "mean(2,4)=3");
    const s1 = out.mergedScores.find((s) => s.criterion === "S1");
    assert.equal(s1.singlePass, true);
    assert.equal(s1.score, 4);
    assert.equal(out.mergedScores.find((s) => s.criterion === "G2").score, "N/A");
    assert.equal(out.reconciliation.tieBroken, 1, "M1 resolved by median");
    assert.equal(out.reconciliation.singlePass, 1, "S1 judged by A alone");
    assert.ok(out.needsHumanReview.some((f) => f.criterion === "G1"), "A/B diff of 2 surfaces needsHumanReview");
    assert.equal(out.scoreboard.m2Flag.score, 0, "plan.m2 surfaced verbatim, never averaged into the M radar");
    // Audit trail re-projects the reconciled scores, with the method label matching the reconciliation.
    const trail = buildAudit(out.mergedScores, new Set(["M1", "G1"]));
    const method = (c) => trail.find((e) => e.criterion === c)?.method;
    assert.equal(method("M1"), "median(A,B,C)");
    assert.equal(method("G1"), "mean(A,B)");
    assert.equal(method("S1"), "single (A)");
    assert.ok(!trail.some((e) => e.criterion === "M2"), "M2 is excluded from the audit trail");
});
