// Bundle-internal doc↔code conformance — this test SHIPS into the skill bundle (it is NOT in
// SOURCE_ONLY_TESTS), so the mechanical doc-code-consistency guard is *visible inside the evaluated
// artifact bundle itself* (G4 Lv4: "ドキュメントとコードの整合を機械的に担保する仕組み(差分検出)が
// 存在") — not only in the repo's source tree, where a Monosashi evaluation scoped to the shipped
// bundle would never see it. It is a *差分検出* (drift detection) guard over the deterministic tool
// set: it asserts every `scripts/<tool>.mjs` the tool reference doc (docs/tools.md) names is actually
// shipped, so renaming or dropping a tool without updating the doc fails CI rather than letting the
// documentation silently diverge from the code (G4 Lv4 vs L3).
//
// It reads only files guaranteed present in the shipped bundle (docs/tools.md + scripts/*.mjs) and
// resolves their location from this test's own path, so the same compiled .mjs runs in BOTH layouts:
//   - installed skill: <skillDir>/scripts/__tests__/  -> docs at ../../docs, scripts at ../
//   - repo build:       <repo>/dist/__tests__/         -> the canonical .claude bundle
// The cross-root checks that need skill-src/agents (agent roster, model tiering) stay in the
// source-only doc-conformance.test.ts, since the agent manifests are not inside the skill bundle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
/** Locate the skill bundle (docs/ + scripts/) from this test's own location, for either layout. */
function resolveBundle() {
    const candidates = [
        // installed skill: scripts/__tests__/ -> skill dir is ../..
        { docs: join(here, "../../docs"), scripts: join(here, "..") },
        // repo dist build: dist/__tests__/ -> the canonical shipped .claude bundle
        {
            docs: join(here, "../../.claude/skills/monosashi-eval/docs"),
            scripts: join(here, "../../.claude/skills/monosashi-eval/scripts"),
        },
    ];
    const found = candidates.find((c) => existsSync(join(c.docs, "tools.md")));
    assert.ok(found, "could not locate the skill bundle (docs/tools.md) from this test's location");
    return found;
}
const { docs, scripts } = resolveBundle();
const TOOLS_MD = readFileSync(join(docs, "tools.md"), "utf8");
test("every scripts/<tool>.mjs referenced in tools.md is backed by a shipped scripts/<tool>.mjs", () => {
    const refs = new Set([...TOOLS_MD.matchAll(/scripts\/([a-z-]+)\.mjs/g)].map((m) => m[1]));
    assert.ok(refs.size >= 5, "expected tools.md to reference the deterministic stage scripts");
    for (const tool of refs) {
        assert.ok(existsSync(join(scripts, `${tool}.mjs`)), `tools.md documents scripts/${tool}.mjs but no such script is shipped in the bundle`);
    }
});
