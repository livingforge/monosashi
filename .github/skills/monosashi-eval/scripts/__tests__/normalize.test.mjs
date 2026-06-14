// Unit tests for the LLM-output normalisation layer (揺れ吸収). This is the new robustness gate:
// every judge-produced field is canonicalised to its schema form before the deterministic tools
// consume it, and every coercion is recorded. A regression here would let surface drift (a string
// "3", "High" confidence, a lower-cased id, "L42" line ranges) silently skew every score, so the
// canonicalisers and the composite normalisers are pinned. Pure functions — no IO.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canonPresence, canonKnowledge, canonConfidence, canonScore, canonBool, canonCriterionId, canonLines, canonPath, canonRefs, normalizeProfile, normalizePass, normalizePack, } from "../normalize.mjs";
test("canonPresence: case, whitespace, and synonyms → present|partial|absent", () => {
    assert.equal(canonPresence("present"), "present");
    assert.equal(canonPresence("Present"), "present");
    assert.equal(canonPresence("  PARTIAL "), "partial");
    assert.equal(canonPresence("yes"), "present");
    assert.equal(canonPresence("none"), "absent");
    assert.equal(canonPresence("no"), "absent");
    assert.equal(canonPresence("some"), "partial");
    assert.equal(canonPresence("weird"), undefined, "uninterpretable → undefined (caller keeps raw)");
    assert.equal(canonPresence(42), undefined);
});
test("canonKnowledge: synonyms map onto the 4-grade ladder", () => {
    assert.equal(canonKnowledge("PRIMARY"), "primary");
    assert.equal(canonKnowledge("substantive"), "substantial");
    assert.equal(canonKnowledge("none"), "absent");
    assert.equal(canonKnowledge("small"), "minor");
    assert.equal(canonKnowledge("minimal"), "minor", "'minimal' is the lowest non-absent knowledge grade");
    assert.equal(canonKnowledge("nonsense"), undefined);
});
test("canonConfidence: case + abbreviations → high|medium|low", () => {
    assert.equal(canonConfidence("High"), "high");
    assert.equal(canonConfidence("med"), "medium");
    assert.equal(canonConfidence("moderate"), "medium");
    assert.equal(canonConfidence("LOW"), "low");
    assert.equal(canonConfidence("hi"), "high");
    assert.equal(canonConfidence(""), undefined);
});
test("canonConfidence: intensifier phrases, hyphen/space boundaries, and Japanese labels", () => {
    assert.equal(canonConfidence("very high"), "high");
    assert.equal(canonConfidence("Fairly High"), "high");
    assert.equal(canonConfidence("highly confident"), "high");
    assert.equal(canonConfidence("medium-high"), "medium", "boundary maps down, never inflated to high");
    assert.equal(canonConfidence("medium high"), "medium");
    assert.equal(canonConfidence("very low"), "low");
    assert.equal(canonConfidence("tentative"), "low");
    assert.equal(canonConfidence("中程度"), "medium");
    assert.equal(canonConfidence("高"), "high");
    assert.equal(canonConfidence("低い"), "low");
    assert.equal(canonConfidence("somewhat"), undefined, "still undefined → validator flags");
});
test("canonScore: coerces numeric strings and near-integer floats, canonicalises N/A spellings", () => {
    assert.equal(canonScore(3), 3);
    assert.equal(canonScore("3"), 3);
    assert.equal(canonScore(" 4 "), 4);
    assert.equal(canonScore("3.0"), 3);
    assert.equal(canonScore(3.4), 3);
    assert.equal(canonScore("N/A"), "N/A");
    assert.equal(canonScore("na"), "N/A");
    assert.equal(canonScore("n/a."), "N/A");
    assert.equal(canonScore("not applicable"), "N/A");
    assert.equal(canonScore("five"), undefined, "non-numeric, non-N/A → undefined (validator flags)");
    assert.equal(canonScore(7), undefined, "out of range is NOT clamped — left for the validator");
    assert.equal(canonScore(-1), undefined);
});
test("canonBool: boolean-ish inputs → true|false, else undefined", () => {
    assert.equal(canonBool(true), true);
    assert.equal(canonBool("yes"), true);
    assert.equal(canonBool("true"), true);
    assert.equal(canonBool(1), true);
    assert.equal(canonBool("no"), false);
    assert.equal(canonBool(0), false);
    assert.equal(canonBool("maybe"), undefined);
});
test("canonCriterionId: trim + upper-case + drop internal whitespace", () => {
    assert.equal(canonCriterionId("k1 "), "K1");
    assert.equal(canonCriterionId(" m2"), "M2");
    assert.equal(canonCriterionId("G 1"), "G1");
});
test("canonCriterionId: separators and a leading 'Criterion'/'基準' label are stripped", () => {
    assert.equal(canonCriterionId("K-1"), "K1");
    assert.equal(canonCriterionId("k.1"), "K1");
    assert.equal(canonCriterionId("M2."), "M2");
    assert.equal(canonCriterionId("g_1"), "G1");
    assert.equal(canonCriterionId("A/2"), "A2");
    assert.equal(canonCriterionId("Criterion K1"), "K1");
    assert.equal(canonCriterionId("criteria: G3"), "G3");
    assert.equal(canonCriterionId("基準 H2"), "H2");
});
test("canonLines: L-prefix, dash variants, and the word 'lines' are stripped to N / N-M", () => {
    assert.equal(canonLines("L42"), "42");
    assert.equal(canonLines("120 – 145"), "120-145", "en-dash normalised to hyphen");
    assert.equal(canonLines("lines 9"), "9");
    assert.equal(canonLines(9), "9");
    assert.equal(canonLines("abc"), undefined);
    assert.equal(canonLines(0), undefined, "0 is not a valid 1-based line");
});
test("canonRefs: coerces a mixed array to non-negative integers, drops the rest", () => {
    assert.deepEqual(canonRefs(["0", "1", 2.0]), [0, 1, 2]);
    assert.deepEqual(canonRefs([1.5, "x", -1]), [], "non-integers/strings/negatives dropped");
    assert.equal(canonRefs("0"), undefined, "non-array → undefined");
});
test("canonPath: separators, ./ and / prefixes, and dot segments collapse to one form", () => {
    assert.equal(canonPath("src\\foo.ts"), "src/foo.ts", "back-slashes → forward");
    assert.equal(canonPath("./src/foo.ts"), "src/foo.ts", "leading ./ stripped");
    assert.equal(canonPath("/src/foo.ts"), "src/foo.ts", "leading / stripped");
    assert.equal(canonPath("src//foo.ts"), "src/foo.ts", "duplicate slashes collapsed");
    assert.equal(canonPath("src/./bar/../foo.ts"), "src/foo.ts", "./ and ../ segments resolved");
    assert.equal(canonPath("  src/foo.ts  "), "src/foo.ts", "trimmed");
    assert.equal(canonPath("foo.ts"), "foo.ts", "already-canonical unchanged");
    assert.equal(canonPath("SKILL.md:42"), "SKILL.md:42", "a trailing :line suffix is preserved (stripped only at resolve)");
});
test("canonPath: case is preserved (display), uninterpretable input → undefined", () => {
    assert.equal(canonPath("Src/Foo.TS"), "Src/Foo.TS", "case kept");
    assert.equal(canonPath(""), undefined);
    assert.equal(canonPath("   "), undefined);
    assert.equal(canonPath("./"), undefined);
    assert.equal(canonPath(42), undefined);
});
test("normalizePack: a drifted candidate path is canonicalised and the coercion recorded", () => {
    const { pack, coercions } = normalizePack({
        target: "t",
        items: [{ criterion: "M1", candidates: [{ path: ".\\src\\a.ts", snippet: "x" }] }],
    });
    assert.equal(pack.items[0].candidates[0].path, "src/a.ts");
    assert.ok(coercions.some((c) => c.path === "items[0].candidates[0].path"));
});
test("normalizeProfile: canonicalises axes + hasCodePath and records each coercion", () => {
    const { profile, coercions } = normalizeProfile({
        target: "  t  ",
        declaredType: " agent ",
        hasCodePath: "yes",
        axes: { orchestration: "Present", encapsulation: "none", harness: "absent", knowledge: "Substantive" },
    });
    assert.equal(profile.target, "t");
    assert.equal(profile.declaredType, "agent");
    assert.equal(profile.hasCodePath, true);
    assert.deepEqual(profile.axes, {
        orchestration: "present",
        encapsulation: "absent",
        harness: "absent",
        knowledge: "substantial",
    });
    // orchestration, encapsulation, knowledge, hasCodePath changed; harness did not.
    const paths = coercions.map((c) => c.path).sort();
    assert.deepEqual(paths, ["axes.encapsulation", "axes.knowledge", "axes.orchestration", "hasCodePath"]);
});
test("normalizeProfile: leaves an uninterpretable axis raw so the validator can still reject it", () => {
    const { profile, coercions } = normalizeProfile({
        target: "t",
        hasCodePath: true,
        axes: { orchestration: "banana", encapsulation: "absent", harness: "absent", knowledge: "absent" },
    });
    assert.equal(profile.axes.orchestration, "banana", "raw kept (no silent fix)");
    assert.ok(!coercions.some((c) => c.path === "axes.orchestration"));
});
test("normalizePass: string score, 'High' confidence, and lower-cased id are all canonicalised", () => {
    const { pass, coercions } = normalizePass({
        target: "t",
        scores: [
            { criterion: "k1", score: "3", confidence: "High", rationale: "x", evidenceRefs: ["0", 1] },
            { criterion: "G2", score: "N/A", confidence: "low", rationale: "y" },
        ],
    });
    assert.equal(pass.scores[0].criterion, "K1");
    assert.equal(pass.scores[0].score, 3);
    assert.equal(pass.scores[0].confidence, "high");
    assert.deepEqual(pass.scores[0].evidenceRefs, [0, 1]);
    assert.equal(pass.scores[1].score, "N/A");
    assert.ok(coercions.length >= 4);
});
test("normalizePass: inline-evidence paths are trimmed (so the verbatim check resolves them)", () => {
    const { pass } = normalizePass({
        target: "t",
        scores: [
            { criterion: "K1", score: 3, confidence: "high", rationale: "x", evidence: [{ path: "  a.md  ", snippet: "s" }] },
        ],
    });
    assert.equal(pass.scores[0].evidence[0].path, "a.md");
});
test("normalizePack: canonicalises item ids, candidate paths, and line ranges", () => {
    const { pack, coercions } = normalizePack({
        target: "t",
        items: [
            { criterion: "m1", candidates: [{ path: " a.md ", lines: "L10" }, { path: "b.md", snippet: "x" }] },
        ],
    });
    assert.equal(pack.items[0].criterion, "M1");
    assert.equal(pack.items[0].candidates[0].path, "a.md");
    assert.equal(pack.items[0].candidates[0].lines, "10");
    assert.ok(coercions.some((c) => c.path === "items[0].criterion"));
    assert.ok(coercions.some((c) => c.path === "items[0].candidates[0].lines"));
});
test("normalisers are idempotent on already-canonical input (no coercions)", () => {
    assert.equal(normalizeProfile({ target: "t", hasCodePath: true, axes: { orchestration: "present", encapsulation: "absent", harness: "absent", knowledge: "absent" } }).coercions.length, 0);
    assert.equal(normalizePass({ target: "t", scores: [{ criterion: "K1", score: 3, confidence: "high", rationale: "x" }] }).coercions.length, 0);
});
