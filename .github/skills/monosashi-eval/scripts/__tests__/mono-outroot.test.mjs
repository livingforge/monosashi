// Unit tests for `outRoot` — `--out <dir>` names the directory that *contains* `eval-out/`
// (the caller always appends the `eval-out/<slug>` segments). These pin the regression where
// `--out eval-out` double-nested the run into `eval-out/eval-out/<slug>`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { outRoot } from "../mono.mjs";
test("an explicit --out <dir> wins and is resolved to absolute", () => {
    assert.equal(outRoot("results", process.cwd()), resolve("results"));
});
test("--out eval-out does not double-nest: appending 'eval-out' lands on the dir the user named", () => {
    const root = outRoot("eval-out", process.cwd());
    assert.equal(join(root, "eval-out"), resolve("eval-out"));
});
test("a nested --out path ending in eval-out collapses the same way", () => {
    const explicit = join("some", "where", "eval-out");
    const root = outRoot(explicit, process.cwd());
    assert.equal(join(root, "eval-out"), resolve(explicit));
});
test("an --out dir merely containing 'eval-out' as a substring is untouched", () => {
    assert.equal(outRoot("eval-output", process.cwd()), resolve("eval-output"));
});
