// Unit tests for the mono loop governor (A1: 停止条件・上限が実装上強制 / 自律度が外部パラメータ).
// `mono next` is the only way the pipeline advances or spawns, so bounding it bounds the whole loop
// structurally. These tests pin that the bound is real (not a prose request) and that the autonomy
// presets are the external knob that sets it. They exercise the same pure `governorCheck` the CLI
// calls at the top of `cmdNext` and inside `spawn`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { governorCheck, AUTONOMY_CAPS } from "../mono.mjs";
const clean = (over = {}) => ({
    nextInvocations: 1,
    attempts: {},
    lastFingerprint: "inventory.toon",
    stalls: 0,
    ...over,
});
test("a fresh, in-bounds governor does not abort", () => {
    const v = governorCheck(clean(), AUTONOMY_CAPS.standard);
    assert.equal(v.abort, false);
});
test("the three autonomy presets are the external knob: strictly tighter as strict<standard<auto", () => {
    const keys = ["maxNext", "maxAttemptsPerStage", "maxStalls"];
    for (const k of keys) {
        assert.ok(AUTONOMY_CAPS.strict[k] < AUTONOMY_CAPS.standard[k], `strict.${k} < standard.${k}`);
        assert.ok(AUTONOMY_CAPS.standard[k] < AUTONOMY_CAPS.auto[k], `standard.${k} < auto.${k}`);
    }
});
test("maxNext is enforced exactly at the boundary (cap ok, cap+1 aborts)", () => {
    const caps = AUTONOMY_CAPS.standard;
    assert.equal(governorCheck(clean({ nextInvocations: caps.maxNext }), caps).abort, false);
    const over = governorCheck(clean({ nextInvocations: caps.maxNext + 1 }), caps);
    assert.equal(over.abort, true);
    assert.match(over.reason, /next.*invocations/i);
});
test("per-stage spawn attempts are capped, and the reason names the offending stage", () => {
    const caps = AUTONOMY_CAPS.standard; // maxAttemptsPerStage = 3
    assert.equal(governorCheck(clean({ attempts: { "S3:A": caps.maxAttemptsPerStage } }), caps).abort, false);
    const over = governorCheck(clean({ attempts: { S1: 1, "S3:A": caps.maxAttemptsPerStage + 1 } }), caps);
    assert.equal(over.abort, true);
    assert.match(over.reason, /S3:A/);
});
test("consecutive no-progress invocations (stalls) are capped — catches a gate/spawn spin-loop", () => {
    const caps = AUTONOMY_CAPS.standard;
    assert.equal(governorCheck(clean({ stalls: caps.maxStalls }), caps).abort, false);
    assert.equal(governorCheck(clean({ stalls: caps.maxStalls + 1 }), caps).abort, true);
});
test("autonomy=strict tightens the bound: the same governor that clears standard aborts under strict", () => {
    // 4 spawns of one stage — fine under standard (cap 3? no: 4>3 aborts). Use a value between presets.
    const gov = clean({ nextInvocations: AUTONOMY_CAPS.strict.maxNext + 1 });
    assert.equal(governorCheck(gov, AUTONOMY_CAPS.strict).abort, true, "aborts under strict");
    assert.equal(governorCheck(gov, AUTONOMY_CAPS.standard).abort, false, "still clears standard");
});
test("a realistic happy-path run clears even the tightest (strict) preset", () => {
    // A normal run: ~6 next invocations, each stage spawned once, no stalls.
    const happy = clean({
        nextInvocations: 6,
        attempts: { S1: 1, "S3:A": 1, "S3:B": 1, "S3:C": 1 },
        stalls: 0,
    });
    assert.equal(governorCheck(happy, AUTONOMY_CAPS.strict).abort, false);
});
