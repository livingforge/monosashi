// Unit tests for the Stage-0 deterministic core (inventory): artifact-boundary enumeration
// and the multi-root common-ancestor logic. These pin two faithfulness guarantees:
//   1. agents emitted into a PACK namespace subfolder (agents/<pack>/<name>.md, the build-skill
//      layout) are still enumerated as agents — not silently dropped.
//   2. when a named *system* spans separate trees, recording paths relative to the roots' common
//      ancestor preserves agents/… and skills/<name>/… structure so both units are detected.
// Pure functions — no IO, no LLM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sep } from "node:path";
import { enumerateArtifacts, guessDeclaredType, commonAncestor } from "../inventory.mjs";
test("enumerateArtifacts detects a flat agent (agents/<name>.md)", () => {
    const arts = enumerateArtifacts(["agents/reviewer.md"]);
    assert.deepEqual(arts, [{ type: "agent", path: "agents/reviewer.md" }]);
});
test("enumerateArtifacts detects a PACK-namespaced agent (agents/<pack>/<name>.md)", () => {
    // build-skill emits agents under a pack subfolder; the old `agents/<file>.md` regex missed these.
    const arts = enumerateArtifacts([
        "agents/monosashi/monosashi-conductor.md",
        "agents/monosashi/monosashi-judge.md",
    ]);
    assert.equal(arts.length, 2);
    assert.ok(arts.every((a) => a.type === "agent"));
    assert.deepEqual(arts.map((a) => a.path).sort(), [
        "agents/monosashi/monosashi-conductor.md",
        "agents/monosashi/monosashi-judge.md",
    ]);
});
test("enumerateArtifacts detects the GitHub *.agent.md suffix layout", () => {
    const arts = enumerateArtifacts(["agents/monosashi/monosashi-conductor.agent.md"]);
    assert.equal(arts.length, 1);
    assert.equal(arts[0].type, "agent");
});
test("enumerateArtifacts detects a skill via skills/<name>/SKILL.md", () => {
    const arts = enumerateArtifacts(["skills/monosashi-eval/SKILL.md", "skills/monosashi-eval/scripts/inventory.mjs"]);
    const skill = arts.find((a) => a.type === "skill");
    assert.ok(skill);
    assert.equal(skill.name, "monosashi-eval");
});
test("enumerateArtifacts surfaces agents + skill as separate units (the option-3 bundle)", () => {
    const arts = enumerateArtifacts([
        "agents/monosashi/monosashi-conductor.md",
        "agents/monosashi/monosashi-judge.md",
        "agents/monosashi/monosashi-surveyor.md",
        "skills/monosashi-eval/SKILL.md",
        "skills/monosashi-eval/scripts/aggregate.mjs",
    ]);
    assert.equal(arts.filter((a) => a.type === "agent").length, 3);
    assert.equal(arts.filter((a) => a.type === "skill").length, 1);
    // > 1 artifact ⇒ inventory marks multiArtifact (the orchestrator then chooses scope).
    assert.ok(arts.length > 1);
});
test("guessDeclaredType: agents + skill ⇒ composite (multi-structure bundle, not collapsed to one identity)", () => {
    // The exact Monosashi shape (agents/ + skills/). Forcing a single type here is what made the
    // call model-unstable; a genuine composite is reported as such.
    assert.equal(guessDeclaredType(["agents/monosashi/monosashi-conductor.md", "skills/monosashi-eval/SKILL.md"]), "composite");
});
test("guessDeclaredType: a single structural convention returns that bare type", () => {
    assert.equal(guessDeclaredType(["agents/reviewer.md"]), "agent");
    assert.equal(guessDeclaredType(["skills/invoice/SKILL.md", "skills/invoice/run.mjs"]), "skill");
});
test("guessDeclaredType: skill + harness layer ⇒ composite", () => {
    assert.equal(guessDeclaredType(["skills/x/SKILL.md", "triggers/guardrail/eval-harness.md"]), "composite");
});
test("guessDeclaredType: knowledge/docs alone are not a structural component", () => {
    // Docs never tip a single-structure (or doc-only) bundle into composite — mirrors the M2 rule.
    assert.equal(guessDeclaredType(["README.md", "GUIDE.md"]), "knowledge/doc");
    assert.equal(guessDeclaredType(["agents/x.md", "README.md"]), "agent");
});
test("commonAncestor returns the shared parent of separate trees", () => {
    const a = ["x", ".claude", "agents", "monosashi"].join(sep);
    const b = ["x", ".claude", "skills", "monosashi-eval"].join(sep);
    assert.equal(commonAncestor([a, b]), ["x", ".claude"].join(sep));
});
test("commonAncestor of a single path is that path", () => {
    const a = ["x", "y", "z"].join(sep);
    assert.equal(commonAncestor([a]), a);
});
