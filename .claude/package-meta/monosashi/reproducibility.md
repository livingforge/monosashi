# Environment, dependencies & reproducibility

The exact environment the toolchain requires, the (zero) runtime dependencies, the steps to
reproduce a build/run from a clean checkout, the determinism guarantees, and the compatibility
range + prerequisite constraints. Version/governance policy lives in the sibling pack-catalog
[CHANGELOG.md](./CHANGELOG.md); this page is the *operational* reproduction manifest.

## Required environment

| Requirement | Version | Why |
|---|---|---|
| Node.js | **≥ 22** (declared in `package.json` `engines.node`) | built-in `node:test` runner (the suite has no test framework dep), stable ESM, `structuredClone`, modern `fs`/`path`. The shipped skill runs `node scripts/*.mjs` directly — no transpile step at runtime. |
| OS | Windows / macOS / Linux | path handling is OS-native (see *Compatibility* below) |
| Network | **none** | the toolchain makes no network calls at build or run time |

## Dependencies — pinned, and zero at runtime

- **Shipped skill runtime: zero npm dependencies.** The only third-party code is the TOON codec
  (`@toon-format/toon`), which is **vendored** at build time into `scripts/toon-vendor.mjs` (see
  [`build-skill.mjs`](../../../scripts/build-skill.mjs)). The bundle therefore runs with **no
  `npm install` and no `node_modules`** — only Node ≥ 22 built-ins + the vendored file. There is
  therefore no runtime dependency-resolution step that can drift between installs.
- **Build/dev dependencies are version-pinned** in the root [`package.json`](../../../package.json)
  and **locked** in `package-lock.json` (committed). `npm ci` installs the lockfile exactly.
- The rubric ↔ toolchain ↔ TOON-API version correspondence (which version produced an artifact,
  and what API it speaks) is the K4 concern, tabulated in the
  [CHANGELOG](./CHANGELOG.md).

For the full security analysis of the dependency surface — supply-chain integrity mechanisms,
vendoring trust profile, network isolation guarantees, CVE response policy, and known gaps — see
[dependencies.md](./dependencies.md).

## Reproduce from a clean checkout

```bash
# 1. Repo build + self-test (needs the dev dependencies):
npm ci            # install locked dev deps exactly (typescript, @types/node, toon)
npm run build     # tsc → dist/ → build-skill.mjs → .claude/ + .github/ bundles
npm test          # tsc + node --test over dist/__tests__ (the deterministic core)

# 2. Run a shipped skill with NO install (dependency-free bundle):
cd .claude/skills/monosashi-eval
node scripts/inventory.mjs <targetDir> > inventory.toon
npm test          # node --test over the bundled scripts/__tests__ (hermetic, fs-free)
```

The shipped `scripts/__tests__` are kept dependency-free **and** filesystem-free, so the bundle's
self-verification is hermetic; fs-touching tests (e.g. `serde-io`) stay source-only and run only
in the repo suite.

## Determinism guarantees

- The scoring/aggregation spine is a **pure function of its inputs** — no `Math.random`, no clock
  read inside any scoring path, no network, no subprocess.
- The **only** time-varying outputs are provenance metadata: `runId` and `producedAt`. Pin the run
  with `--run-id <id>` (threaded through `inventory` → `select-tracks` → `aggregate`) and the
  artifacts are **byte-stable across re-runs except the `producedAt` timestamp**, which is metadata
  and does not affect any score. Omitting `--run-id` mints one from the target basename + a UTC
  timestamp (so distinct runs don't collide); clocks are injectable in tests for exact pinning.
- **LLM-output side:** the judge subagents are not deterministic, but their output is canonicalised
  before any scoring tool consumes it (`normalize` — surface forms like `"3"`/`"High"`/`"k1"`/`"L42"`;
  `snapPath` — drifted evidence **paths** snapped to the real on-disk file). So an evaluation no
  longer flips on *cosmetic* LLM drift — only a genuine judgement change moves a score. The layer is
  **conservative + auditable**: uninterpretable values are left raw (the validator still fails), and
  every change is reported as a `normalised …` / `snapped …` warning. Threat/defence framing: see
  [threat-model.md](./threat-model.md) T3 (paths) and T5 (output drift).
- Consequence: a re-run cannot silently diverge, and a retry of a failed stage is free (see
  [reliability.md](./reliability.md) *idempotency*).

## Compatibility range & prerequisite constraints

- **Platforms.** Windows, macOS, Linux. Paths are OS-native: pass absolute paths in the local form
  (on Windows `c:\…`, not `/c/…`); the orchestrator threads OS-native paths to the judge agents.
  File I/O is UTF-8.
- **Module system.** ESM only (`"type": "module"`). The tools are invoked as `node scripts/x.mjs`;
  importing a tool module is side-effect-free (the CLI `main()` runs only when invoked directly),
  which is what lets the test suite exercise the same code path without spawning processes.
- **Node range.** Tested on Node 22.x; `engines.node` is `>=22`. `node:test` is stable from Node 20,
  but 22+ is required for the full built-in surface the tools use. Newer majors are expected to work
  (no deprecated API in the runtime path); older than 22 is unsupported.
- **Argument-size limit.** The OS caps `argv` length, which silently truncates a very large TOON
  passed inline. Constraint: always pass large artifacts (plans, packs, passes) **by file path**,
  never as an inline CLI argument — every stage in [SKILL.md](../../skills/monosashi-eval/SKILL.md) is specified file-to-file
  for this reason.
- **No global state / no install.** The bundle writes only where you redirect it; it reads only the
  committed artifacts under the target. It never mutates the target and never executes it.
