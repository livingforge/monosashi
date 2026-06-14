// Unit tests for the shared evidence-reference resolver (§7 ref-token cut): parsing line
// ranges, indexing a pack by criterion, and resolving a score's evidenceRefs/inline cites.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLineRange, indexPack, resolveScoreEvidence, clampSnippet, MAX_SPAN, snapPath } from "../evidence-util.mjs";
test("clampSnippet truncates an over-wide snippet to MAX_SPAN lines, verbatim prefix", () => {
    const wide = Array.from({ length: 100 }, (_, i) => `line${i + 1}`).join("\n");
    const { text, clamped } = clampSnippet(wide);
    assert.equal(clamped, true);
    assert.equal(String(text).split("\n").length, MAX_SPAN);
    assert.ok(wide.startsWith(String(text)), "kept text is a verbatim contiguous prefix");
});
test("clampSnippet leaves a tight snippet untouched", () => {
    const small = "a\nb\nc";
    const { text, clamped } = clampSnippet(small);
    assert.equal(clamped, false);
    assert.equal(text, small);
});
test("clampSnippet respects a custom maxLines and passes null through", () => {
    assert.equal(clampSnippet("a\nb\nc\nd", 2).text, "a\nb");
    assert.equal(clampSnippet("a\nb\nc\nd", 2).clamped, true);
    assert.equal(clampSnippet(null).clamped, false);
});
test("parseLineRange accepts a single line and a range, rejects malformed input", () => {
    assert.deepEqual(parseLineRange("42"), { start: 42, end: 42 });
    assert.deepEqual(parseLineRange("120-145"), { start: 120, end: 145 });
    assert.deepEqual(parseLineRange(" 10 - 12 "), { start: 10, end: 12 });
    assert.equal(parseLineRange(null), null);
    assert.equal(parseLineRange(""), null);
    assert.equal(parseLineRange("abc"), null);
    assert.equal(parseLineRange("0"), null, "lines are 1-based");
    assert.equal(parseLineRange("10-5"), null, "end before start is invalid");
});
const pack = {
    target: "t",
    items: [
        { criterion: "M1", candidates: [{ path: "a.md", lines: "1-3" }, { path: "b.md", snippet: "hello" }] },
        { criterion: "G1", candidates: [{ path: "c.md", lines: "9" }] },
    ],
};
test("indexPack groups candidates by criterion", () => {
    const idx = indexPack(pack);
    assert.equal(idx.size, 2);
    assert.equal(idx.get("M1")?.length, 2);
    assert.equal(idx.get("G1")?.[0].path, "c.md");
    assert.equal(indexPack(null).size, 0);
});
test("resolveScoreEvidence resolves valid refs and reports unresolved ones", () => {
    const idx = indexPack(pack);
    const { resolved, unresolved } = resolveScoreEvidence({ criterion: "M1", evidenceRefs: [0, 5] }, idx);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].source, "ref");
    assert.equal(resolved[0].ref, 0);
    assert.deepEqual(unresolved, [5], "index 5 has no candidate");
});
test("resolveScoreEvidence keeps inline citations alongside refs", () => {
    const { resolved } = resolveScoreEvidence({ criterion: "G1", evidence: [{ path: "inline.md", snippet: "x" }] }, indexPack(pack));
    assert.ok(resolved.some((r) => r.source === "inline" && r.path === "inline.md"));
});
test("with no pack, refs cannot resolve", () => {
    const { resolved, unresolved } = resolveScoreEvidence({ criterion: "M1", evidenceRefs: [0] }, null);
    assert.equal(resolved.length, 0);
    assert.deepEqual(unresolved, [0]);
});
// ── snapPath (パス揺れ吸収): drifted cited path → unique real on-disk file ──────────────────
const FILES = ["src/foo.ts", "src/sub/bar.ts", "docs/readme.md", "scripts/foo.mjs"];
test("snapPath: an exact (case-insensitive) match canonicalises case/separators", () => {
    assert.deepEqual(snapPath("src/foo.ts", FILES), { path: "src/foo.ts", how: "exact" });
    assert.deepEqual(snapPath("SRC/FOO.TS", FILES), { path: "src/foo.ts", how: "exact" }, "case-insensitive → real spelling");
    assert.deepEqual(snapPath("src\\foo.ts", FILES), { path: "src/foo.ts", how: "exact" }, "back-slashes");
});
test("snapPath: a dropped leading dir / absolute path snaps by longest path-suffix", () => {
    assert.deepEqual(snapPath("foo.ts", FILES), { path: "src/foo.ts", how: "suffix" }, "basename of a unique file");
    assert.deepEqual(snapPath("/abs/root/src/sub/bar.ts", FILES), { path: "src/sub/bar.ts", how: "suffix" }, "absolute → relative tail");
    assert.deepEqual(snapPath("sub/bar.ts", FILES), { path: "src/sub/bar.ts", how: "suffix" });
});
test("snapPath: an ambiguous suffix (shared basename) does NOT snap — returns null", () => {
    const dup = ["a/index.ts", "b/index.ts"];
    assert.equal(snapPath("index.ts", dup), null, "two files share the basename → ambiguous");
    // but a longer, distinguishing suffix resolves the ambiguity
    assert.deepEqual(snapPath("a/index.ts", dup), { path: "a/index.ts", how: "exact" });
});
test("snapPath: a path naming no real file returns null (caller keeps raw + warns)", () => {
    assert.equal(snapPath("nope/ghost.ts", FILES), null);
    assert.equal(snapPath("foo.ts", []), null, "empty file list → null");
});
