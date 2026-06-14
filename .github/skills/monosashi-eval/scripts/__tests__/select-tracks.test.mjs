// Unit tests for the Stage-2 deterministic core (select-tracks): the mechanical M2 flag,
// the track-applicability table, and full plan assembly. These are the heart of the
// "every matching track applies, M2 is an independent mechanical flag" policy (§5/§6), so
// they are pinned here. Pure functions — no IO, no LLM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeM2, trackApplies, declaredAxisOf, buildPlan } from "../select-tracks.mjs";
function profile(over = {}) {
    return {
        target: over.target ?? "t",
        declaredType: over.declaredType,
        hasCodePath: over.hasCodePath ?? false,
        ...(over.riskSurface !== undefined ? { riskSurface: over.riskSurface } : {}),
        axes: {
            orchestration: over.axes?.orchestration ?? "absent",
            encapsulation: over.axes?.encapsulation ?? "absent",
            harness: over.axes?.harness ?? "absent",
            knowledge: over.axes?.knowledge ?? "absent",
        },
    };
}
const HIGH_OP = { op: "delete remote record", evidence: { path: "a.ts", lines: "10" }, class: "high", external: true };
const LOW_OP = { op: "write eval-out only", evidence: { path: "b.ts", lines: "20" }, class: "low", external: false };
/** An agent profile (orchestration on → track A applies, so A4 is in scope) with a given surface. */
const agentWith = (riskSurface) => profile({ declaredType: "agent", hasCodePath: true, axes: { orchestration: "present" }, riskSurface });
test("declaredAxisOf maps declared types to the axis that must be on", () => {
    assert.equal(declaredAxisOf("agent"), "orchestration");
    assert.equal(declaredAxisOf("skill"), "encapsulation");
    assert.equal(declaredAxisOf("harness"), "harness");
    assert.equal(declaredAxisOf("knowledge-doc"), "knowledge");
    assert.equal(declaredAxisOf(null), null);
    assert.equal(declaredAxisOf("widget"), null);
});
test("computeM2: declared axis present, no undeclared sub-component → faithful (Lv3)", () => {
    const m2 = computeM2(profile({ declaredType: "agent", axes: { orchestration: "present" } }));
    assert.equal(m2.score, 3);
    assert.equal(m2.divergent, false);
});
test("computeM2: undeclared structural sub-component → Lv2 LOW divergence", () => {
    const m2 = computeM2(profile({ declaredType: "agent", axes: { orchestration: "present", harness: "present" } }));
    assert.equal(m2.score, 2);
    assert.equal(m2.divergent, true);
    assert.match(m2.severity, /LOW/);
    assert.deepEqual(m2.basis.onStructuralAxes.sort(), ["harness", "orchestration(agent)"]);
});
test("computeM2: declared capability absent → Lv0 HIGH (実体が別物)", () => {
    const m2 = computeM2(profile({ declaredType: "skill", axes: { encapsulation: "absent", harness: "present" } }));
    assert.equal(m2.score, 0);
    assert.equal(m2.divergent, true);
    assert.match(m2.severity, /HIGH/);
});
test("computeM2: unrecognisable declared type → Lv1 MEDIUM", () => {
    const m2 = computeM2(profile({ declaredType: undefined, axes: { orchestration: "present" } }));
    assert.equal(m2.score, 1);
    assert.equal(m2.divergent, true);
    assert.match(m2.severity, /MEDIUM/);
});
test("computeM2: knowledge-only doc with no structural axes → faithful (Lv3)", () => {
    const m2 = computeM2(profile({ declaredType: "knowledge-doc", axes: { knowledge: "primary" } }));
    assert.equal(m2.score, 3);
    assert.equal(m2.divergent, false);
});
test("computeM2: composite with ≥2 structural axes on → faithful (Lv3)", () => {
    const m2 = computeM2(profile({ declaredType: "composite", axes: { orchestration: "present", encapsulation: "present" } }));
    assert.equal(m2.score, 3);
    assert.equal(m2.divergent, false);
    assert.deepEqual(m2.basis.onStructuralAxes.sort(), ["encapsulation(skill)", "orchestration(agent)"]);
});
test("computeM2: composite claimed but only one structural axis → Lv0 over-claim", () => {
    const m2 = computeM2(profile({ declaredType: "composite", axes: { orchestration: "present" } }));
    assert.equal(m2.score, 0);
    assert.equal(m2.divergent, true);
    assert.match(m2.severity, /HIGH/);
});
test("trackApplies: M and G always; A/S/H/K gate on their axis", () => {
    const bare = profile();
    assert.equal(trackApplies("M", bare), true);
    assert.equal(trackApplies("G", bare), true);
    assert.equal(trackApplies("A", bare), false);
    assert.equal(trackApplies("A", profile({ axes: { orchestration: "partial" } })), true);
    assert.equal(trackApplies("S", profile({ axes: { encapsulation: "present" } })), true);
    assert.equal(trackApplies("H", profile({ axes: { harness: "present" } })), true);
    assert.equal(trackApplies("K", profile({ axes: { knowledge: "minor" } })), false);
    assert.equal(trackApplies("K", profile({ axes: { knowledge: "substantial" } })), true);
});
test("buildPlan: G2 is N/A by rule when there is no code path, and present when there is", () => {
    const noCode = buildPlan(profile({ declaredType: "agent", hasCodePath: false, axes: { orchestration: "present" } }));
    assert.ok(noCode.naByRule.some((n) => n.criterion === "G2"));
    assert.ok(!noCode.criteriaToScore.some((c) => c.criterion === "G2"));
    const withCode = buildPlan(profile({ declaredType: "skill", hasCodePath: true, axes: { encapsulation: "present" } }));
    assert.ok(!withCode.naByRule.some((n) => n.criterion === "G2"));
    assert.ok(withCode.criteriaToScore.some((c) => c.criterion === "G2"));
});
test("buildPlan: A4 is N/A by rule when riskSurface was extracted but has no high-risk op", () => {
    const plan = buildPlan(agentWith([LOW_OP]));
    assert.ok(plan.naByRule.some((n) => n.criterion === "A4"), "no high op ⇒ A4 N/A-by-rule");
    assert.ok(!plan.criteriaToScore.some((c) => c.criterion === "A4"), "A4 must not be scored");
    // an empty (extracted-but-nothing) surface is also "no high op" → N/A
    assert.ok(buildPlan(agentWith([])).naByRule.some((n) => n.criterion === "A4"));
});
test("buildPlan: A4 is scored when riskSurface carries a high-risk op, and the surface travels in the plan", () => {
    const plan = buildPlan(agentWith([LOW_OP, HIGH_OP]));
    assert.ok(plan.criteriaToScore.some((c) => c.criterion === "A4"), "≥1 high op ⇒ A4 scored");
    assert.ok(!plan.naByRule.some((n) => n.criterion === "A4"));
    assert.equal(plan.riskSurface.length, 2, "riskSurface is propagated into the plan for the judge");
});
test("buildPlan: A4 is scored (never auto-N/A) when riskSurface was NOT extracted", () => {
    const plan = buildPlan(agentWith(undefined));
    assert.ok(plan.criteriaToScore.some((c) => c.criterion === "A4"), "no extraction ⇒ cannot decide ⇒ score A4");
    assert.ok(!plan.naByRule.some((n) => n.criterion === "A4"));
    assert.equal(plan.riskSurface, null, "plan.riskSurface is null when none was extracted");
});
test("buildPlan: the A4 N/A rule does not fire when track A is absent (A4 not in scope anyway)", () => {
    // a knowledge doc: orchestration absent ⇒ no A track ⇒ A4 never considered, regardless of surface
    const plan = buildPlan(profile({ declaredType: "knowledge-doc", axes: { knowledge: "primary" }, riskSurface: [] }));
    assert.ok(!plan.appliedTracks.includes("A"));
    assert.ok(!plan.naByRule.some((n) => n.criterion === "A4"), "A4 is out-of-track, not N/A-by-rule");
});
test("buildPlan: M2 is mechanical (plan.m2), never in criteriaToScore", () => {
    const plan = buildPlan(profile({ declaredType: "skill", hasCodePath: true, axes: { encapsulation: "present" } }));
    assert.equal(plan.m2.criterion, "M2");
    assert.ok(!plan.criteriaToScore.some((c) => c.criterion === "M2"));
});
test("buildPlan: applies exactly the matching tracks (M,G always; A only when orchestration on)", () => {
    const skill = buildPlan(profile({ declaredType: "skill", hasCodePath: true, axes: { encapsulation: "present", harness: "present", knowledge: "primary" } }));
    assert.deepEqual(skill.appliedTracks.sort(), ["G", "H", "K", "M", "S"]);
    assert.ok(!skill.appliedTracks.includes("A"), "no orchestration ⇒ no A track");
    const agent = buildPlan(profile({ declaredType: "agent", hasCodePath: false, axes: { orchestration: "present", harness: "present", knowledge: "primary" } }));
    assert.ok(agent.appliedTracks.includes("A"), "orchestration present ⇒ A track applies");
});
test("buildPlan: every scored criterion carries its verbatim level ladder (0..4)", () => {
    const plan = buildPlan(profile({ declaredType: "skill", hasCodePath: true, axes: { encapsulation: "present" } }));
    for (const c of plan.criteriaToScore) {
        assert.equal(c.levels.length, 5, `${c.criterion} must embed 5 verbatim levels`);
        assert.ok(c.levels.every((l) => typeof l === "string" && l.length > 0));
    }
});
