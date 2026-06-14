// Round-trip guard for the TOON serialization boundary (serde.ts). The whole pipeline crosses
// disk/wire as TOON now, so `toonParse(toonStringify(x))` MUST equal x's JSON value-semantics
// (undefined dropped, real null kept) for every shape the tools emit — plans with verbatim
// multiline level ladders, evidence packs with code snippets full of delimiters, passes that
// distinguish the number 3 from the string "N/A", and scoreboards with sparse optional columns.
// Fixtures are inline (no fs) so this ships in the skill bundle and verifies the *vendored*
// codec too (`scripts/__tests__/serde.mjs` → `../serde.mjs` → `./toon-vendor.mjs`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { toonParse, toonStringify } from "../serde.mjs";
/** JSON value-semantics baseline: what the old `JSON.stringify`/`parse` pipeline would have
 *  preserved (drops `undefined` object fields, keeps real `null`). TOON must match this. */
function jsonBaseline(x) {
    return JSON.parse(JSON.stringify(x));
}
function roundTrips(name, value) {
    test(`round-trips: ${name}`, () => {
        const back = toonParse(toonStringify(value));
        assert.deepEqual(back, jsonBaseline(value));
    });
}
roundTrips("plan criteriaToScore with verbatim multiline JP levels + anchor", {
    target: "c:\\eval2\\art",
    declaredType: "agent",
    rubricVersion: "v3",
    scale: [
        { level: 0, name: "Absent", meaning: "痕跡なし" },
        { level: 4, name: "Optimized", meaning: "失敗知見の反映" },
    ],
    appliedTracks: ["M", "G"],
    criteriaToScore: [
        {
            criterion: "M1",
            track: "M",
            title: "宣言と実体",
            tags: ["meta", "structure"],
            levels: ["欠如", "曖昧", "種別・目的・適用範囲を明示『できること/禁止』", "失敗時の縮退・再試行・冪等性が設計", "主/従の構成が明示的に文書化\n複数行の\nレベル定義"],
            anchor: "Lv3とLv4の差: 構成の明示文書があるか",
        },
        { criterion: "G2", track: "G", title: "x", tags: ["reliability"], levels: ["a", "b", "c", "d", "e"] },
    ],
    m2: { criterion: "M2", score: 3, divergent: false, severity: "none", rationale: "一致", mechanical: true, basis: { declaredType: "agent", onStructuralAxes: ["orchestration"], declaredAxis: "orchestration" } },
});
roundTrips("evidence pack: nested candidates, multiline code snippet, delimiter-heavy text, empty", {
    target: "c:\\eval2\\art",
    items: [
        {
            criterion: "K1",
            candidates: [
                { path: "SKILL.md:42", lines: "42", snippet: "const x = {a: 1, b: [2,3]}; // commas, colons, brackets", note: "supports Lv3" },
                { path: "a.ts:10-14", lines: "10-14", snippet: "function f() {\n  return 1\n}\n# hash, \"quotes\", trailing space   ", note: "caps at Lv2" },
            ],
        },
        { criterion: "G2", candidates: [] },
    ],
});
roundTrips("pass: N/A string vs number, sparse optional columns, refs + inline evidence", {
    target: "t",
    declaredType: "agent",
    scores: [
        { criterion: "G2", score: "N/A", evidenceRefs: [], rationale: "absent", confidence: "low" },
        { criterion: "M1", score: 3, evidenceRefs: [0, 2], rationale: "理由", confidence: "high", scoreA: 3, scoreB: "N/A", confidenceA: "high" },
        { criterion: "K1", score: 2, evidence: [{ path: "x.md:1", snippet: "verbatim" }], rationale: "r", confidence: "medium" },
    ],
});
roundTrips("scoreboard-ish: nested objects, numbers, null, empty object/array", {
    twoPass: true,
    tieBreak: { applied: false },
    needsHumanReview: [],
    scoreboard: {
        radarByTrack: { M: { mean: 2.5, n: 4 }, G: { mean: 3, n: 2 } },
        overallMean: 2.75,
        weightedIndex: null,
        confidence: { high: 3, medium: 1, low: 0 },
        naCount: 0,
        empties: { arr: [], obj: {} },
    },
});
// Regression: a HETEROGENEOUS candidates array — some candidates carry a resolved `snippet`,
// one does not (an un-resolvable line range left it bare) — forces the encoder off the tabular
// `candidates[N]{...}:` header into the expanded block (`- path:` list) form. A block-form
// scalar string value that contains BOTH a ':' and '[]' across a newline (exactly an evidence
// code snippet) used to encode fine but FAIL to decode (`Unexpected content … between bracket
// segment and colon`) — the codec couldn't round-trip its own output. The bite surfaced two
// stages late, at `validate-pass`, not at the `validate-evidence` write. Fixed in the vendored
// codec by scripts/patch-toon.mjs; this guards the round-trip via the shipped boundary.
roundTrips("evidence pack: heterogeneous candidates force block form, snippet has ':' + '[]' + newline", {
    target: "t",
    items: [
        {
            criterion: "S1",
            candidates: [
                { path: "x.mjs", lines: "152-181", note: "raises", snippet: "export function buildPlan(prof) {\n    const appliedTracks = [];\n    const naByRule = [];\n    reason: \"コード経路が無いため N/A\";\n}" },
                { path: "y.mjs", lines: "31-45", note: "raises", snippet: "import { a } from \"./serde.mjs\";\nconst m = [];" },
                { path: "z.mjs", lines: "41", note: "limits: large single module (no snippet)" },
            ],
        },
    ],
});
test("toonStringify drops undefined object fields (parity with JSON.stringify), keeps null", () => {
    const back = toonParse(toonStringify({ a: 1, b: undefined, c: null, nested: { d: undefined, e: "x" } }));
    assert.deepEqual(back, { a: 1, c: null, nested: { e: "x" } });
});
test("toonParse throws on malformed input (re-emit signal parity with JSON.parse)", () => {
    assert.throws(() => toonParse("criteriaToScore[2]:\n  - criterion: M1\n    bad indent here\n bad"));
});
