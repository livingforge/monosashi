// Shared CLI status line (reliability). Every tool prints exactly ONE concise line to stderr at
// the end of a run, so a successful run is an explicit `OK <tool>: <summary>` instead of silence,
// and a failure is a non-zero exit code paired with an `ERR <tool>: <reason>` line. stdout is
// reserved for the tool's real output (TOON data for the producers, the formatted report for
// report/cohort), so this status line never pollutes a redirected `> out.toon`.
//
// The exit code stays the machine-readable signal; this line is the human/log-readable
// confirmation that "no stdout" is a deliberate success, NOT a silent/hung failure — the exact
// ambiguity that makes a delayed or quiet run look broken.
/** Success line for producers/formatters (they exit 0 by returning from main). */
export function cliOk(tool, summary) {
    process.stderr.write(`OK ${tool}: ${summary}\n`);
}
/** Failure line + non-zero exit, for an unrecoverable CLI error. */
export function cliErr(tool, reason) {
    process.stderr.write(`ERR ${tool}: ${reason}\n`);
    process.exit(1);
}
/** One-line terminal status for tools that already compute an ok/fail boolean (the validators):
 *  `OK <tool>: <summary>` or `ERR <tool>: <summary>`. The caller still sets the exit code. */
export function cliDone(tool, ok, summary) {
    process.stderr.write(`${ok ? "OK" : "ERR"} ${tool}: ${summary}\n`);
}
/**
 * Run a tool's `main()` under the two-channel contract, **degrading any uncaught error to a
 * clean failure** instead of a raw stack trace. Malformed TOON (`ToonDecodeError`), a missing
 * input file (`ENOENT`), or any other throw on the main path is caught here and re-emitted as a
 * single `ERR <tool>: <reason>` line + exit 1 — the same shape `cliErr` produces for a usage
 * error — so a consumer can always branch on the exit code + the OK/ERR line and never has to
 * parse a multi-line crash dump. The throw happens during input parse, before any stdout is
 * written, so a failed run leaves **no partial artifact** (fail-closed). `process.exit(…)` inside
 * `main` (usage errors, the validators' `exit(ok?0:1)`) terminates the process and is not caught.
 *
 * Wrap every producer/validator entry point: `runCli("inventory", main)` in place of `main()`.
 */
export function runCli(tool, main) {
    try {
        main();
    }
    catch (e) {
        cliErr(tool, e instanceof Error ? e.message : String(e));
    }
}
