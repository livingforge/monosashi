// Unit tests for the three validation gates (validate-profile / validate-pass / validate-evidence),
// now exported as pure functions. They are the gates that stop a malformed or drifted LLM artifact
// from silently skewing the scoreboard, so both their hard-error rules AND their new 揺れ-absorption
// (lower-cased ids, string scores, "yes" booleans match the schema after normalisation) are pinned.
// No IO: the verbatim/line-range check (which reads cited files) is exercised via target:null=off.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateProfile } from "../validate-profile.mjs";
import { validatePass } from "../validate-pass.mjs";
import { validateEvidence } from "../validate-evidence.mjs";
// ── validate-profile ───────────────────────────────────────────────────────────────────────
test("validateProfile: a clean profile passes with no errors", () => {
    const r = validateProfile({
        target: "t",
        declaredType: "agent",
        hasCodePath: true,
        axes: { orchestration: "present", encapsulation: "absent", harness: "absent", knowledge: "absent" },
        note: "ok",
    });
    assert.equal(r.ok, true);
    assert.equal(r.errors.length, 0);
});
test("validateProfile: surface drift ('Present', 'yes') is absorbed and reported, not rejected", () => {
    const r = validateProfile({
        target: "t",
        declaredType: "agent",
        hasCodePath: "yes",
        axes: { orchestration: "Present", encapsulation: "none", harness: "absent", knowledge: "Substantive" },
        note: "ok",
    });
    assert.equal(r.ok, true, "normalised values are legal");
    assert.ok(r.warnings.some((w) => /normalised/.test(w)), "coercions surfaced as warnings");
});
test("validateProfile: an uninterpretable axis and a missing target are hard errors", () => {
    const r = validateProfile({
        hasCodePath: true,
        axes: { orchestration: "banana", encapsulation: "absent", harness: "absent", knowledge: "absent" },
    });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /axes\.orchestration/.test(e)));
    assert.ok(r.errors.some((e) => /target/.test(e)));
});
test("validateProfile: a well-formed riskSurface passes; class casing is absorbed", () => {
    const r = validateProfile({
        target: "t",
        declaredType: "agent",
        hasCodePath: true,
        axes: { orchestration: "present", encapsulation: "absent", harness: "absent", knowledge: "absent" },
        note: "ok",
        riskSurface: [{ op: "delete record", evidence: { path: "a.ts", lines: "10" }, class: "High", external: "yes" }],
    });
    assert.equal(r.ok, true, "High→high and yes→true are normalised before the schema check");
});
test("validateProfile: a malformed riskSurface entry is a hard error", () => {
    const r = validateProfile({
        target: "t",
        declaredType: "agent",
        hasCodePath: true,
        axes: { orchestration: "present", encapsulation: "absent", harness: "absent", knowledge: "absent" },
        riskSurface: [{ op: "", evidence: { path: "a.ts" }, class: "danger", external: 1 }],
    });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /riskSurface\[0\]\.op/.test(e)));
    assert.ok(r.errors.some((e) => /riskSurface\[0\]\.class/.test(e)));
    assert.ok(r.errors.some((e) => /riskSurface\[0\]\.evidence/.test(e)));
});
test("validateProfile: a missing riskSurface is only a warning (A4 will be scored, the safe default)", () => {
    const r = validateProfile({
        target: "t",
        declaredType: "agent",
        hasCodePath: true,
        axes: { orchestration: "present", encapsulation: "absent", harness: "absent", knowledge: "absent" },
        note: "ok",
    });
    assert.equal(r.ok, true);
    assert.ok(r.warnings.some((w) => /riskSurface missing/.test(w)));
});
// ── validate-pass ──────────────────────────────────────────────────────────────────────────
const plan2 = { criteriaToScore: [{ criterion: "M1" }, { criterion: "G1" }] };
test("validatePass: a complete pass with inline evidence passes", () => {
    const r = validatePass({
        target: "t",
        scores: [
            { criterion: "M1", score: 2, confidence: "high", rationale: "x", evidence: [{ path: "a.md", snippet: "s" }] },
            { criterion: "G1", score: 3, confidence: "high", rationale: "y", evidence: [{ path: "b.md", snippet: "s" }] },
        ],
    }, plan2);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
});
test("validatePass: a lower-cased id and a string score normalise to match the plan", () => {
    const r = validatePass({
        target: "t",
        scores: [
            { criterion: "m1", score: "2", confidence: "High", rationale: "x", evidence: [{ path: "a.md", snippet: "s" }] },
            { criterion: "g1", score: "N/A", confidence: "low", rationale: "y" },
        ],
    }, plan2);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.ok(!r.errors.some((e) => /missing criterion/.test(e)), "ids matched after normalisation");
});
test("validatePass: a missing criterion is a hard error; an unexpected one is dropped with a warning (gate self-heals)", () => {
    const missing = validatePass({ target: "t", scores: [{ criterion: "M1", score: 2, confidence: "high", rationale: "", evidence: [{ path: "a", snippet: "s" }] }] }, plan2);
    assert.ok(missing.errors.some((e) => /missing criterion: G1/.test(e)), "a missing criterion still fails — only a re-emit can supply it");
    const extra = validatePass({ target: "t", scores: [{ criterion: "M1", score: 2, confidence: "high", rationale: "", evidence: [{ path: "a", snippet: "s" }] }, { criterion: "K9", score: 1, confidence: "high", rationale: "", evidence: [{ path: "a", snippet: "s" }] }] }, { criteriaToScore: [{ criterion: "M1" }] });
    assert.equal(extra.ok, true, JSON.stringify(extra.errors));
    assert.ok(extra.warnings.some((w) => /K9.*not in plan/.test(w)), "an out-of-plan criterion is warned, not errored");
    assert.deepEqual(extra.fixed.map((s) => s.criterion), ["M1"], "K9 dropped from the fixed pass so the gate self-heals");
});
test("validatePass: an N/A-by-rule criterion (in plan.naByRule) is pruned with a warning, not rejected as 'not in plan'", () => {
    const r = validatePass({
        target: "t",
        scores: [
            { criterion: "M1", score: 2, confidence: "high", rationale: "x", evidence: [{ path: "a", snippet: "s" }] },
            { criterion: "A4", score: "N/A", confidence: "high", rationale: "no high-risk op" },
        ],
    }, { criteriaToScore: [{ criterion: "M1" }], naByRule: [{ criterion: "A4" }] });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.ok(!r.errors.some((e) => /not in plan/.test(e)), "A4 IS in the plan (naByRule) — must not claim 'not in plan'");
    assert.ok(r.warnings.some((w) => /A4.*N\/A-by-rule/.test(w)), "the prune is surfaced as a warning");
    assert.deepEqual(r.fixed.map((s) => s.criterion), ["M1"], "A4 pruned from the fixed pass so the gate self-heals");
});
test("validatePass: scoring an N/A-by-rule criterion with a NUMBER drops it with a warning (the mechanical N/A is not overridden)", () => {
    const r = validatePass({
        target: "t",
        scores: [
            { criterion: "M1", score: 2, confidence: "high", rationale: "x", evidence: [{ path: "a", snippet: "s" }] },
            { criterion: "A4", score: 3, confidence: "high", rationale: "overriding", evidence: [{ path: "a", snippet: "s" }] },
        ],
    }, { criteriaToScore: [{ criterion: "M1" }], naByRule: [{ criterion: "A4" }] });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.ok(r.warnings.some((w) => /A4.*N\/A-by-rule.*numeric score dropped/.test(w)), "the numeric score is dropped, not allowed to override the mechanical N/A");
    assert.deepEqual(r.fixed.map((s) => s.criterion), ["M1"], "A4 dropped from the fixed pass so the gate self-heals");
});
test("validatePass: a non-N/A score with no evidence is warned and forced to low under --fix", () => {
    const r = validatePass({ target: "t", scores: [{ criterion: "M1", score: 3, confidence: "high", rationale: "no cite" }] }, { criteriaToScore: [{ criterion: "M1" }] });
    assert.ok(r.warnings.some((w) => /no evidence/.test(w)));
    assert.equal(r.fixed[0].confidence, "low");
    assert.equal(r.fixed[0]._forcedLowByValidator, true);
});
test("validatePass: a planned criterion scored N/A is coerced to 0 with confidence medium (no evidence needed)", () => {
    const r = validatePass({ target: "t", scores: [{ criterion: "M1", score: "N/A", confidence: "high", rationale: "absent axis" }] }, { criteriaToScore: [{ criterion: "M1" }] });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    // Planned (criteriaToScore) criterion has a rubric floor: N/A is illegitimate → coerced to 0.
    assert.equal(r.fixed[0].score, 0);
    assert.equal(r.fixed[0].confidence, "medium");
    assert.equal(r.fixed[0]._coercedNAtoZero, true);
    assert.ok(r.warnings.some((w) => /coerced to 0/.test(w)), "the coercion is surfaced as a warning");
    // The floor-0 is not a no-evidence violation and is not demoted to low.
    assert.ok(!r.warnings.some((w) => /no evidence/.test(w)));
    assert.ok(!r.fixed[0]._forcedLowByValidator);
});
test("validatePass: an N/A-by-rule criterion is still dropped, NOT coerced to 0 (the mechanical N/A stands)", () => {
    const r = validatePass({
        target: "t",
        scores: [
            { criterion: "M1", score: 2, confidence: "high", rationale: "x", evidence: [{ path: "a", snippet: "s" }] },
            { criterion: "G2", score: "N/A", confidence: "high", rationale: "no code path" },
        ],
    }, { criteriaToScore: [{ criterion: "M1" }], naByRule: [{ criterion: "G2" }] });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    // G2 is N/A-by-rule (not in criteriaToScore) → dropped, never coerced to a numeric 0.
    assert.deepEqual(r.fixed.map((s) => s.criterion), ["M1"]);
    assert.ok(!r.warnings.some((w) => /G2.*coerced to 0/.test(w)));
});
// ── validate-evidence ──────────────────────────────────────────────────────────────────────
test("validateEvidence: a pack covering the plan with shaped candidates passes", () => {
    const r = validateEvidence({ target: "t", items: [{ criterion: "M1", candidates: [{ path: "a.md", snippet: "s" }] }, { criterion: "G1", candidates: [{ path: "b.md", lines: "1-3" }] }] }, plan2);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
});
test("validateEvidence: lower-cased ids normalise to cover the plan", () => {
    const r = validateEvidence({ target: "t", items: [{ criterion: "m1", candidates: [{ path: "a.md", snippet: "s" }] }, { criterion: "g1", candidates: [{ path: "b.md", lines: "L9" }] }] }, plan2);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.pack.items[1].candidates[0].lines, "9", "line range canonicalised");
});
test("validateEvidence: a missing criterion and a candidate without a path are hard errors", () => {
    const r = validateEvidence({ target: "t", items: [{ criterion: "M1", candidates: [{ snippet: "s" }] }] }, plan2);
    assert.ok(r.errors.some((e) => /missing evidence for criterion: G1/.test(e)));
    assert.ok(r.errors.some((e) => /candidate missing non-empty/.test(e)));
});
test("validateEvidence: an extra criterion is an error normally but a warning under --superset", () => {
    const input = { target: "t", items: [{ criterion: "M1", candidates: [{ path: "a", snippet: "s" }] }, { criterion: "G1", candidates: [{ path: "b", snippet: "s" }] }] };
    const strict = validateEvidence(input, { criteriaToScore: [{ criterion: "M1" }] });
    assert.equal(strict.ok, false);
    assert.ok(strict.errors.some((e) => /unexpected criterion not in plan: G1/.test(e)));
    const superset = validateEvidence(input, { criteriaToScore: [{ criterion: "M1" }] }, { superset: true });
    assert.equal(superset.ok, true);
    assert.ok(superset.warnings.some((w) => /allowed under --superset/.test(w)));
});
