// Unit tests for the shared CLI status-line contract (reliability / G2 graceful degradation).
// The whole toolchain relies on `runCli` turning any uncaught throw on the main path — malformed
// TOON, a missing input file — into a single `ERR <tool>: <reason>` line + exit 1 (NOT a raw
// stack trace), so a consumer always branches on the exit code + the OK/ERR line. serde-io.test.ts
// documents that contract but does not exercise it; this pins it. No IO — process.stderr/exit are
// stubbed and restored, so the test is hermetic and ships with the bundle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cliOk, cliDone, runCli } from "../cli.mjs";
/** Capture everything written to stderr and any process.exit code while `fn` runs. */
function capture(fn) {
    const origWrite = process.stderr.write;
    const origExit = process.exit;
    let out = "";
    let exitCode;
    process.stderr.write = ((s) => {
        out += typeof s === "string" ? s : s.toString();
        return true;
    });
    // Stub exit to unwind via throw (so we never actually kill the test process), then swallow it.
    process.exit = ((code) => {
        exitCode = code;
        throw new Error("__stubbed_exit__");
    });
    try {
        fn();
    }
    catch (e) {
        if (!(e instanceof Error) || e.message !== "__stubbed_exit__")
            throw e;
    }
    finally {
        process.stderr.write = origWrite;
        process.exit = origExit;
    }
    return { out, exitCode };
}
test("cliOk writes a single 'OK <tool>: <summary>' line and does not exit", () => {
    const { out, exitCode } = capture(() => cliOk("inventory", "12 files"));
    assert.equal(out, "OK inventory: 12 files\n");
    assert.equal(exitCode, undefined);
});
test("cliDone writes OK or ERR per the boolean, leaving the exit code to the caller", () => {
    assert.equal(capture(() => cliDone("validate-pass", true, "8/8 scored")).out, "OK validate-pass: 8/8 scored\n");
    assert.equal(capture(() => cliDone("validate-pass", false, "2 error(s)")).out, "ERR validate-pass: 2 error(s)\n");
});
test("runCli passes a clean main through untouched (no ERR, no exit)", () => {
    let ran = false;
    const { out, exitCode } = capture(() => runCli("demo", () => { ran = true; }));
    assert.equal(ran, true);
    assert.equal(out, "", "a clean run prints nothing here (main owns its own OK line)");
    assert.equal(exitCode, undefined);
});
test("runCli degrades a thrown Error to 'ERR <tool>: <message>' + exit 1 (no stack trace)", () => {
    const { out, exitCode } = capture(() => runCli("validate-evidence", () => {
        throw new Error("malformed TOON in evidence.toon: Line 5: ...");
    }));
    assert.equal(out, "ERR validate-evidence: malformed TOON in evidence.toon: Line 5: ...\n");
    assert.equal(exitCode, 1);
});
test("runCli stringifies a non-Error throw", () => {
    const { out, exitCode } = capture(() => runCli("demo", () => { throw "boom"; }));
    assert.equal(out, "ERR demo: boom\n");
    assert.equal(exitCode, 1);
});
