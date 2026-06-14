// Single serialization boundary for the monosashi-eval toolchain.
//
// Inter-stage evaluation data is **TOON** (Token-Oriented Object Notation), not JSON.
// TOON is ~29% smaller than the pretty JSON we used to emit, and the LLM agents read it
// (the big `plan`/`evidence` reads are re-read up to 3× across scoring passes) and write
// it. The real `@toon-format/toon` library is vendored into the shipped skill's `scripts/`
// at build time (see `scripts/build-skill.mjs`) so the runtime stays dependency-free.
//
// Use `toonParse`/`toonStringify` everywhere a tool crosses the on-disk / on-wire boundary,
// in place of `JSON.parse` / `JSON.stringify`. (Internal deep-clones and message formatting
// keep using JSON — they are not serialization boundaries.)
import { readFileSync } from "node:fs";
import { encode, decode } from "./toon-vendor.mjs";
/**
 * Serialize a value to canonical on-disk / on-wire TOON (no trailing newline — callers add
 * their own, matching the old `JSON.stringify(x, null, 2) + "\n"` idiom).
 *
 * We round-trip through JSON first so TOON sees exactly JSON's value semantics: `undefined`
 * object fields are dropped (TOON's `encode` would otherwise emit them as `null`, which would
 * null-fill optional columns in tabular arrays and blur "absent" vs "explicitly null" — a
 * distinction `aggregate`/`validate-pass` rely on). Real `null` is preserved.
 */
export function toonStringify(value) {
    return encode(JSON.parse(JSON.stringify(value)));
}
/**
 * Parse TOON text back into a value. Throws (`ToonDecodeError`) on malformed input — parity
 * with `JSON.parse`; the `runCli` wrapper turns a throw here into a clean `ERR <tool>` line + a
 * non-zero exit (a re-emit request for the agent that produced the file), not a stack trace.
 */
export function toonParse(text) {
    return decode(text);
}
/**
 * Read a `.toon` file and parse it, attributing any failure to a concrete path. A bad read
 * (`ENOENT`, a directory, …) or malformed TOON throws an `Error` whose message names the file
 * and the cause, so `runCli` surfaces e.g. `ERR validate-evidence: malformed TOON in
 * evidence.toon: Line 5: Expected 3 tabular row values, but got 6` — input validation on the
 * main path that points the operator straight at the offending artifact. Prefer this over
 * `toonParse(readFileSync(path, "utf8"))` at every on-disk stage boundary.
 */
export function readToonFile(path) {
    let text;
    try {
        text = readFileSync(path, "utf8");
    }
    catch (e) {
        throw new Error(`cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
        return decode(text);
    }
    catch (e) {
        throw new Error(`malformed TOON in ${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
}
