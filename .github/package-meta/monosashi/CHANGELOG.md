# Changelog & version policy — monosashi-eval

This is the **single home for version information**: the rubric ↔ toolchain ↔ tool/TOON-API correspondence, the version/governance policy, and the release history. A reader can answer here both "which version produced this artifact, and what API does it speak?" and "what changed when?".

This file is the **pack catalog** entry (`package-meta/monosashi/CHANGELOG.md`) — a repo-level index that travels with the pack, **not** shipped inside the skill bundle. Per the evidence ≠ context principle ([framework.md](../../skills/monosashi-eval/docs/framework.md#証拠--実行時コンテキストevidence--context)), version history is **reference evidence**, never inlined into any agent's runtime prompt.

**The pack catalog is the home for the project's management & operational rules.** Alongside this changelog, the catalog (`package-meta/monosashi/`) carries the operational-rule documents — [coverage.md](./coverage.md) (evaluation coverage & regression policy, H1), [reliability.md](./reliability.md) (failure-mode / degradation / recovery contract, G2), [reproducibility.md](./reproducibility.md) (environment / reproduce-from-checkout manifest, G5), [dependencies.md](./dependencies.md) (dependency surface & supply-chain security), and [threat-model.md](./threat-model.md) (threat model & defence-update policy, H2). They live here, **not** in the shipped skill `docs/`, because they are management/operational reference evidence that travels with the pack rather than runtime prompt the agents read. The skill bundle keeps only what a run needs at hand (`docs/tools.md`, `docs/schemas.md`, `docs/framework.md`, `docs/example-walkthrough.md`).

## Two version axes (they move independently)

| Axis | Current | Source of truth | Surfaced in | Changes when… |
|---|---|---|---|---|
| **Rubric version** | `v3.1` | `RUBRIC.version` (`src/rubric.ts`) | `scripts/rubric.toon`, `plan.rubricVersion`, every report header | a criterion / level definition / track / weight profile **or tie-break anchor (§7)** changes |
| **Toolchain version** | `0.4.16` | `package.json` `version` | `provenance.toolVersion` on `inventory.toon` / `plan.toon` / `scoreboard.toon` (best-effort) | a tool's CLI flags, TOON schema, or pipeline behaviour changes |

The rubric can stay `v3` across several toolchain releases (the criteria are stable while the implementation evolves), and a toolchain release can ship without touching the rubric. Keeping them separate is deliberate — conflating them is the drift K4 warns about.

## Tool API ↔ schema correspondence

Each deterministic tool's contract (CLI flags + the TOON shape it reads/writes) is specified in [`schemas.md`](../../skills/monosashi-eval/docs/schemas.md). The pipeline order and stage gates are in [`framework.md`](../../skills/monosashi-eval/docs/framework.md) §3 and `SKILL.md`.

| Tool (`scripts/*.mjs`) | Reads | Writes | Schema section |
|---|---|---|---|
| `inventory.mjs` | a target dir | inventory + `runId` + `provenance` | (S0; see SKILL.md) |
| `full-plan.mjs` | — (rubric) | all-criteria lightweight list | framework §6 |
| `select-tracks.mjs` | `profile.toon` | `plan.toon` (+ `provenance`, embedded levels, `m2`) | "Track-application plan" |
| `validate-profile.mjs` | `profile.toon` | report (exit code) | "Capability profile" |
| `validate-evidence.mjs` | `evidence.toon` + `plan.toon` | report; `--resolve` rewrites pack | "Evidence pack" |
| `second-opinion.mjs` / `contested.mjs` | passes + plan | reduced plan | "Review plan / Tie-break plan" |
| `slice-pack.mjs` | `evidence.toon` + (reduced) `plan.toon` | sliced `evidence.toon` (pack reduced to the plan's criteria) | "Evidence pack" |
| `augment-pack.mjs` *(opt-in S3.25)* | `evidence.toon` + re-gathered `review-gather.toon` + `review-plan.toon` | review slice (stdout) + augmented master (`--update-master`, append-only) | "Evidence pack" |
| `aggregate.mjs` | passes + `plan.toon` + `evidence.toon` | `scoreboard.toon` (+ `provenance`, `audit`) | "Scoreboard", "Run provenance & audit trail" |
| `validate-pass.mjs` | a pass + its plan | report | "Scoring pass" |
| `report.mjs` / `cohort.mjs` | scoreboard(s) | markdown / flat TOON | "Scoreboard" |

The correspondence is also **machine-traceable**: a `scoreboard.toon` carries both `provenance.toolVersion` (which toolchain produced it) and `scoreboard`-side `rubricVersion` lineage via the plan, so an artifact self-describes the versions it was scored under.

## Update triggers (版同期の運用方針)

When you change…

- **a rubric criterion / level / weight** → bump `RUBRIC.version` (`src/rubric.ts`), regenerate `rubric.toon` (happens in `npm run build`), update `framework.md` level text, add a release entry below. Existing `scoreboard.toon`s from the old rubric stay readable (they carry the old version) but are **not** comparable cell-for-cell — note the rubric change in any longitudinal (S5) diff.
- **a tool CLI flag / TOON schema / pipeline step** → bump the toolchain `version` (both `package.json`s), update `schemas.md` and/or `SKILL.md`/`body.md`, add a release entry below. Keep old flags working for one minor cycle where feasible; announce removals here.
- **a TOON shape consumed across stages** → update `schemas.md` first (it is the contract), then the producing + consuming tools together, then the validators.

Rule of thumb: **schemas.md is the contract; this file is the history + version index.** A change that touches behaviour but neither is undocumented and should be treated as a bug.

## Governance & lifecycle

- **Owner / source of truth**: this repository. Source is `src/*.ts` + `skill-src/` (agents `body.md` + per-platform YAML, `SKILL.md`, `docs/`, pack metadata `packs/<pack>/`); the shipped `.claude/` and `.github/` trees are **build artifacts** of `npm run build` — never hand-edit them.
- **Versioning**: semver on the toolchain (`package.json`), an explicit rubric tag (`v3.1`) on the criteria. Both recorded in the release history below.
- **Lifecycle stage**: pre-1.0 (`0.x`) — additive changes are expected; breaking changes are allowed at minor bumps but must be called out below. The rubric (`v3.x`) is the stable contract evaluators rely on.
- **Deprecation policy**: a removed/renamed CLI flag or schema field is listed under a "Deprecated" / "Removed" heading at least one minor release before removal where feasible. Mechanically-derived fields (e.g. `plan.m2`) and provenance keys are additive and never silently repurposed.
- **Node engine**: `>=22` (`package.json` `engines`); the toolchain is ESM-only (`"type": "module"`).

---

## Release history

The format is loosely [Keep a Changelog](https://keepachangelog.com/). Dates are ISO-8601.

### [0.4.16] — 2026-06-10

Rubric: **v3.1** (unchanged). **Fix: `mono init --out eval-out` double-nests the run into `eval-out/eval-out/<slug>`.** `--out <dir>` names the directory that *contains* `eval-out/` (`init` always appends `eval-out/<slug>`), but the natural reading — "put the results in this dir" — leads callers to pass `--out eval-out`, which produced `eval-out/eval-out/<slug>`. The nested run was then invisible to `mono next` auto-discovery and to the default `mono cohort` sweep (both scan one level under the repo-anchored `eval-out/`).

#### Fixed
- **`mono.mjs` `outRoot` — an explicit `--out` whose last path segment is exactly `eval-out` is now treated as the eval-out dir itself** (its parent is returned, so the single `join(…, "eval-out", slug)` site lands on the dir the caller named). `--out eval-out` → `eval-out/<slug>`; `--out results` keeps the documented container semantics (`results/eval-out/<slug>`); a dir merely containing the substring (e.g. `eval-output`) is untouched.

#### Added
- **`src/__tests__/mono-outroot.test.ts`** — pins the collapse (`--out eval-out`, nested `…/eval-out`), the untouched container case, and the substring non-match.

#### Notes
- Toolchain **0.4.15 → 0.4.16** (both `package.json`s): `--out` flag behaviour fix on `mono init`; no rubric / criterion / level / weight / anchor change, no TOON-schema change. Existing runs already nested under `eval-out/eval-out/<slug>` keep working via an explicit `mono next --run <dir>` (the manifest stores absolute paths); only auto-discovery missed them.

---

### [0.4.15] — 2026-06-04

Rubric: **v3.1** (unchanged). **Pack catalog: add `dependencies.md` — dependency surface & supply-chain security.** No tool CLI flag, TOON schema, pipeline step, or rubric changed. This is a pack catalog documentation addition only.

#### Added
- **`package-meta/monosashi/dependencies.md`** — the dependency surface and supply-chain security document. Covers: the full dependency inventory (runtime / platform / build / dev) with license table; supply-chain integrity mechanisms (`npm ci` sha512 hash verification, `@toon-format/toon` trust profile including the local scalar-bracket patch and build-time assertion); vendoring trade-offs (what it eliminates vs. what remains); network isolation basis and verification gap; Node.js LTS / CVE response policy; build artifact integrity known gap (no consumer-verifiable checksum); dependency update policy with CVE response SLA; and license compliance — including the **MIT notice-retention known gap** (the vendored `toon-vendor.mjs` ships without the upstream copyright/permission notice; closing it needs a build-side header injection, not a doc fix).

#### Changed
- **`reproducibility.md` — dependencies section gains a pointer to `dependencies.md`** for the full security analysis. The operational facts (zero runtime deps, lockfile-locked build deps) remain in-place; the security-oriented detail is now in the dedicated document.
- **`CHANGELOG.md` intro paragraph** — `dependencies.md` added to the pack-catalog document listing; `reproducibility.md`'s description trimmed to match its narrowed scope.

#### Notes
- Toolchain **0.4.14 → 0.4.15** (both `package.json`s): documentation-only; no rubric / criterion / level / weight / anchor change, no tool CLI-flag or TOON-schema change. `npm test` unaffected.

---

### [0.4.14] — 2026-06-04

Rubric: **v3.1** (unchanged). **Fix: surveyor mis-classifies scoped tool grants as `class:"high", external:true`.** When an artifact documents a tool grant (e.g. `Bash`) alongside explicit least-privilege prose that narrows its allowed usage, weaker models pattern-matched on the bare tool name ("Bash ≈ arbitrary command exec → high") instead of reading the documented scope. The fix adds a generic rule: classify `riskSurface` entries from the **effective scope stated in the artifact's documentation**, not from the worst-case capability the tool could theoretically reach. If no constraint is stated, the full capability of the tool applies. This caused the artifact's own A4 score to be over-penalised when monosashi evaluated itself with weaker judge models.

#### Changed
- **`monosashi-surveyor` `body.md` — `riskSurface` classification now requires reading documented least-privilege constraints before assigning `class`.** The instruction now explicitly states: when a tool grant is accompanied by a prose scope constraint in the artifact ("Bash: run only X — not for network"), classify from that constrained scope rather than the bare tool name. A scoped invocation writing only to the artifact's own output directory is `low`, not `high`. Conversely, undocumented or unbounded usage retains a `high` classification. The rule is phrased generically (not tied to any specific tool or artifact).

#### Notes
- Toolchain **0.4.13 → 0.4.14** (both `package.json`s): surveyor agent-prompt (`body.md`) behaviour change; **no rubric / criterion / level / weight / anchor change**, no tool CLI-flag or TOON-schema change.

---

### [0.4.13] — 2026-06-04

Rubric: **v3.1** (unchanged). **Fix: judge over-claims `confidence:"high"`, suppressing pass B for
genuinely ambiguous boundary criteria.** Discovered via a 10-run variance measurement on the system
evaluating itself (whole / 社内向け / `.claude/`): wIndex σ=0.058, range=0.20, but all 10 runs
returned 21/21 `high` confidence → second-opinion `shouldRun=false` every time. Cross-run analysis
revealed 5 criteria (G1/G3/G4/G5/M1) with range=1 at the 3↔4 boundary — genuine uncertainty the
confidence field was not capturing. Root cause: `high` was defined as "has a concrete citation,"
which the evidence pack always satisfies. `medium` was undefined and never used. Pass B's trigger
(`second-opinion.mjs` targets non-`high` criteria) therefore never fired.

#### Changed
- **`monosashi-judge` `body.md` — confidence levels now have distinct bars (Method step 4 and
  Discipline `[claim]` bullet).** `high`: citation **and** adjacent level clearly not met; another
  judge would reach the same conclusion. `medium`: citation present but boundary genuinely ambiguous
  — deciding evidence is `[claim]`-only (no `[mechanism]`/`[test]`), or pack has opposing
  `raises:`/`limits:` candidates, or next level is partially satisfied. `low`: no citable snippet.
  Added explicit instruction: "**Default to `medium` at any boundary you are not fully certain
  about**" and named pass B as the safety net that resolves close calls. Also updated the
  `[claim]`-only guidance: previously "hold down a rung or set `confidence:"low"`"; now "hold down
  a rung and set `confidence:"medium"`" — preserving the score penalty while correctly marking it
  for pass-B review rather than masking it as un-citable.

#### Notes
- Toolchain **0.4.12 → 0.4.13** (both `package.json`s): agent-prompt (`body.md`) behaviour change;
  **no rubric / criterion / level / weight / anchor change**, no tool CLI-flag or TOON-schema change.
  Expected effect: `medium`-confidence criteria now surface to pass B, reducing cross-run score
  variance for boundary criteria. Existing `scoreboard.toon`s produced under 0.4.12 remain valid;
  their single-pass scores reflect the old over-claiming behaviour and should be re-run under 0.4.13
  if longitudinal comparison matters.

### [0.4.12] — 2026-06-03

Rubric: **v3.1** (unchanged). **Cut output-token cost: stop the surveyor and judge writing the
same level-ceiling argument twice.** Motivated by a self-evaluation cost trace — on a single-pass
run (`second-opinion shouldRun=false`) the output tokens were dominated by two free-text fields
whose measured length ran 2–3× the spec: `evidence.json` `note` (avg ~277 chars × 86 candidates)
and `passA.json` `rationale` (median ~687 chars × 21 criteria). Diagnosis: the prompts paired a
single soft "be terse" line with several hard rules that *force* length — and there is no
length-rejecting gate to push back. Two of those hard rules made the surveyor's `note` argue the
ceiling ("robustness is bounded", "Lv4 self-audit not present") and the judge re-quote the verbatim
level ladder — the **same argument paid for twice**. Fixed prompt-side only (no mechanical
truncation), by removing the contradiction rather than capping output.

#### Changed
- **`monosashi-judge` `body.md` — rationale references the level, never transcribes it.** Resolved
  the standing contradiction between "1–2 sentences, don't re-transcribe the ladder" and "Always
  quote/anchor to the **verbatim** level definition / do not paraphrase": the judge still *reads* the
  verbatim `levels[0..4]` to decide the level (input, Method step 1), but now *writes* the chosen
  level by its **number/name + the deciding discriminator** (`"Lv3: <discriminator> met by ref[0];
  not Lv4 because <ceiling reason>."`) — the full level text already travels in `plan.toon`, so the
  reader resolves the number against it. Updated the "Stay terse" block, Method step 3, the
  Discipline "Verbatim levels" bullet, Hard rule 1, and the JSON example placeholder.
- **`monosashi-surveyor` `body.md` — `note` is a telegraphic pointer, not a level argument.** The
  `lines` range is the locator; the note names `direction: signal [kind]` in ~one clause (~≤120
  chars) and **must not argue the level** ("bounded / top rung not reached" reasoning is the judge's
  rationale, not the pack's). The **both-directions / ≥1 `limits:` candidate** rule is unchanged —
  a `limits:` candidate still *points* at where the ceiling shows, it just no longer *argues* it.
  Updated the `note` format bullet, the ceiling-question bullet, Hard rule 4, and the contract
  example note.

#### Notes
- Toolchain **0.4.11 → 0.4.12** (both `package.json`s): agent-prompt (`body.md`) behaviour change
  reducing per-criterion output verbosity; **no rubric / criterion / level / weight / anchor
  change**, and no tool CLI-flag or TOON-schema change (`note`/`rationale` are still free-text
  strings; only the authored content is shorter). Scores should be unaffected — the judgement still
  anchors to the verbatim level wording on the read side; only the *written* prose is shortened.
  No length-rejecting validator gate was added (mechanical truncation was explicitly not adopted).

### [0.4.11] — 2026-06-03

Rubric: **v3.1** (unchanged). **Fix: report's "パス" column showed `A·/B·` for a single-pass
run.** Surfaced while the system was evaluating *itself* — a run where the second opinion was
skipped wholesale (`second-opinion shouldRun=false`: every pass-A criterion was high-confidence).

#### Fixed
- **`aggregate` now marks every criterion `singlePass: true` when pass B is skipped wholesale**
  (`src/aggregate.ts`). The no-`passB` branch copied `passA.scores` verbatim, omitting the
  `singlePass` flag that the *per-criterion* skip path inside `reconcile()` already sets. So the
  report's pass column ([`report-html.ts`](../../skills/monosashi-eval) `s.singlePass === true`
  test) fell through to the multi-pass template `A${scoreA ?? "·"}/B${scoreB ?? "·"}` — and with
  no `scoreA`/`scoreB` on those objects (those are attached only inside `reconcile()`), both
  rendered as the `·` placeholder, giving **`A·/B·`** instead of the **「単一パス」** badge.
  Scores, weighted index, and M2 were never affected — display only. Regression test added
  (`aggregate.test.ts`: "no passB … every criterion is marked singlePass").

#### Notes
- Toolchain **0.4.10 → 0.4.11** (both `package.json`s): pipeline-output change (`mergedScores`
  now carry `singlePass` on the no-second-opinion path), **no rubric / criterion / level / weight
  / anchor change** and no tool CLI-flag or TOON-schema change.

### [0.4.10] — 2026-06-03

Rubric: **v3.1** (unchanged). **Improve first-sweep evidence recall (S1/S2.5)** and **drop
criterion-ID self-labels from doc headings.** Motivated by a self-evaluation miss: K3 (例の正しさ・
自己完結性) scored **2** when the bundle in fact carried an explicit `## Common pitfalls — 誤用例と
正例の対比` section (a Lv3 `誤用例・対比`) — the single sweep never captured it, so every downstream
pass (which re-scores from the pack, never re-reading) was capped at the floor. Root cause was three
converging gaps in the **initial collection**, all fixed here.

#### Changed
- **① `lookFor` now names the climbing discriminators, not just the floor** (`src/full-plan.ts`,
  `huntHint()`). It was `levels[2]` verbatim (the Lv2 "the capability exists" definition), so the surveyor
  hunted the floor and stopped. It is now `存在: <Lv2> ／ さらに上段も探す → 加点: <Lv3> ／ 網羅: <Lv4>` —
  the surveyor is pointed at the **ceiling** evidence (e.g. 誤用例・対比, 版整合のコピー動作網羅) too. Derived
  from the rubric levels; carries **no level number** (the judge still owns the 0–4 mapping) and the verbatim
  ladder + tie-break anchor are still withheld (§7), so nothing extra leaks to the judge.
- **③ `inventory.mjs` now emits a per-markdown `outlines` read-map** (`src/inventory.ts`, `readOutline()`):
  `{path, headings:[{line, depth, heading}]}`, fenced-code-aware (a `#` inside ``` … ``` is not a heading).
  The single-read surveyor/gatherer scan it first to **locate** candidate sections (a 誤用例/対比/落とし穴
  section → K1/K3, a contract section → K2/S1) instead of relying on scrolling far enough to notice a
  labelled block.
- **Dropped criterion-ID self-labels from doc/section headings AND live-description subtitles** in the
  scored bundle. Headings: `# Reliability … (G2)`, `# … reproducibility (G5)`, `## Governance & lifecycle
  (G3)`, `## Update triggers (… — K4)`, `## Loop governor … (A1)`, `## Run provenance & audit trail (A5 /
  H3)`, `## Common pitfalls … (K3)`. Inline subtitles mapping a live feature/doc to a rubric cell:
  `coverage.md` (H1, and the observation-points (H3) tag), `threat-model.md` (H2), `schemas.md` provenance
  (K4), and this file's opening (K4). A passage tagged with the rubric cell it is *meant* to satisfy is
  exactly the **self-label** the framework says is **not** evidence (§1; the surveyor/gatherer rule uses
  `## Governance (G3)` as the canonical "do not cite" example) — so labelling our own prose that way both
  contradicts the rule and erodes the credibility of the self-evaluation. The realised mechanism in each
  doc is unchanged and is what a judge must cite; the maintainer-facing criterion↔doc mapping lives in
  `src/traceability.ts` (outside the scored roots). **Kept on purpose:** references where a criterion id is
  the grammatical *subject* (`M2 is mechanical`, `the drift K4 warns about`, the `K3` band note), pipeline
  **stage** labels (`S0`/`S2`/…), the test **fixtures** under `evals/fixtures/` (their `(A1)`…`(H3)`
  headings are deliberate evaluation-target inputs), and the **dated release-history** annotations below
  (a developer changelog log — and tracking that rubric↔toolchain correspondence is itself the K4 function
  this file serves; scrubbing it would be revisionist).

#### Fixed
- **② docs-track self-label exception** (`monosashi-surveyor` / `monosashi-gatherer` bodies). The
  "cite the realisation, not the self-label" rule (right for *mechanism* criteria — a `## Governance (G3)`
  heading is a claim, not proof) **mis-fired for K-track docs criteria**: it suppressed the very
  `… (K3)`-labelled examples section because its heading names the criterion. The rule now carves out the
  `K` track — for a docs criterion the *content under* such a section **is** the realisation; cite the
  example body (the ❌/✅ lines), not the heading.

#### Notes
- Toolchain **0.4.9 → 0.4.10** (both `package.json`s): pipeline-behaviour + inventory-schema change (new
  `outlines` field; `full-plan.lookFor` text format), **no rubric / criterion / level / weight / anchor
  change** and no tool CLI-flag change. `full-plan.test.ts` updated (lookFor now floor+discriminators,
  no level-number leak); `inventory` pure-function tests unaffected (output-shape not pinned).
- These three are the **initial-collection** half of the fix. The complementary recovery path — the opt-in
  `--review-regather` (S3.25) that re-reads the bundle before pass B — is unchanged and remains the backstop
  when a first-sweep miss survives.

### [0.4.9] — 2026-06-03

Rubric: **v3.1** (unchanged). **Fix: the vendored TOON codec could not round-trip its own output.**
A serialization-boundary (G2 reliability) bug — surfaced while the system was evaluating *itself*. The
vendored `@toon-format/toon` (^2.3.0) decoder's `parseArrayHeaderLine` detected an array-header line
(`key[N]:` / `key[N]{f}:`) for an **unquoted** key by scanning the whole line with `indexOf("[")`, so a
`[` inside a scalar string **value** (e.g. an evidence `snippet: "… const a = []; reason: \"x\""`) was
mistaken for a header bracket. In strict mode (which the decoder uses) it then threw `Unexpected content
"…" between bracket segment and colon` instead of parsing the line as a `key: value` scalar — a value the
**encoder itself had produced**. So `toonParse(toonStringify(x))` failed for any multi-line string value
containing both a `:` and `[]` — exactly the code snippets `validate-evidence --resolve` injects into the
evidence pack. The bite was **latent and late-binding**: the malformed `evidence.toon` passed the S2.6
write/resolve gate and only failed two stages later at `validate-pass` (S3.5), where the `ERR/NEXT` hint
mis-attributed it to the *pass* file. Triggered only when a candidate array is **heterogeneous** (some
candidates resolved a snippet, one didn't), which pushes the encoder off the tabular
`candidates[N]{…}:` header into the expanded block (`- path:` list) form.

#### Fixed
- **`scripts/patch-toon.mjs` (new)** — a dependency-free, **idempotent** patch applied to
  `node_modules/@toon-format/toon/dist/index.mjs`: if a key/value `:` precedes the first `[` on an
  unquoted-key line, the `[` is inside the scalar value, so `parseArrayHeaderLine` bails out (returns
  undefined) and the caller falls through to its scalar `key: value` path. Marker-guarded (re-run = no-op)
  and **fails loudly** if the anchor is gone (upstream restructured/fixed it → re-derive). Wired into
  `postinstall` (re-applies after every `npm install`, so `npm ci` → `npm test` sees the fix) and the
  `build` / `test` scripts. The shipped bundle inherits the fix because `build-skill.mjs` vendors the
  (patched) `node_modules` copy — and now **asserts** the `monosashi-patch:scalar-bracket` marker is present
  in `toon-vendor.mjs`, failing the build on a pristine (unpatched) tree rather than silently shipping a
  codec that can't round-trip its own output.
- **`src/__tests__/serde.test.ts`** — added a round-trip regression for the exact failure: a heterogeneous
  evidence candidates array (block form) whose snippet carries `:` + `[]` + a newline. Ships in the bundle
  (verifies the *vendored* codec via `scripts/__tests__/serde.mjs`). Confirmed red on the pristine codec
  (`not ok … between bracket segment and colon`), green after the patch.

#### Notes
- Toolchain **0.4.8 → 0.4.9** (both `package.json`s); a behaviour fix at the serialization boundary, no
  rubric / criterion / level / weight / anchor change and no tool CLI-flag or TOON-schema change. `npm test`
  225 → green; the shipped skill's own `npm test` (vendored codec) green.
- **Upstream**: the root cause is in `@toon-format/toon@2.3.0`; the patch is a local hold until a fixed
  release can be pinned. When bumping the dep, re-run `scripts/patch-toon.mjs` — it no-ops if upstream has
  fixed it (anchor gone, marker absent → build assertion will catch a regressed vendor).

### [0.4.8] — 2026-06-03

Rubric: **v3.1** (unchanged). **Opt-in second-opinion re-gather (S3.25).** A new, default-off pipeline
step lets **pass B (the second opinion) judge from freshly re-extracted evidence** for the criteria it
re-scores — closing the failure mode where a second-opinion disagreement is caused by *missing
evidence* (the single S1 sweep didn't cite the deciding line), not by judgement, which a pack-only
pass B cannot fix. **Pass A is unchanged (pack-only); the judge still never re-reads** — extraction
stays the gatherer's job (separation of concerns, §7), and the re-gathered pack passes the **same S2.6
integrity gate** before use. New CLI flag (`mono init --review-regather`), new pipeline step, and one
new deterministic tool — so this is a toolchain minor bump (both `package.json`s **0.4.5/0.4.4 → 0.4.8**,
re-synced with this changelog's release line).

#### Added
- **`mono init --review-regather` (default off; `--no-review-regather` is the explicit off)** — records
  `reviewRegather` on the run manifest. When set and `second-opinion` says `shouldRun`, `mono next`
  inserts **S3.25** before pass B: spawn `monosashi-gatherer` scoped to `review-plan.toon` (a fresh,
  targeted read of the bundle → `review-gather.json`), gate it through `validate-evidence --superset
  --resolve` (the same S2.6 contract), then `augment-pack` it into the master. Surfaced in
  `mono status` and the `init` log. The conductor governor counts the extra spawn as stage `S3:gatherB`
  (clears `standard`/`strict` caps — a re-gather run spends one more `next` + one more spawn).
- **`src/augment-pack.ts` (`augment-pack.mjs`)** — merges the targeted re-gathered pack into the master
  **append-only per review criterion**: the master's existing candidates keep their array positions (so
  **pass A's `evidenceRefs` stay valid**) and only de-duplicated fresh citations (same `path` +
  `lines`/`snippet` dropped) are appended. It writes the augmented master back in place
  (`--update-master`, the same in-place pattern as `validate-evidence --resolve`) and emits the review
  slice on stdout (`review-evidence.toon`). This **preserves the master↔slice index-alignment invariant**
  the slicer relies on, so `validate-pass:B` and `aggregate` keep resolving pass B's refs against the
  (augmented) master with no signature change. Pure builder `augmentPack(master, gather, plan)` split
  from `main()` (codebase builder/IO convention), covered by `src/__tests__/augment-pack.test.ts`
  (index preservation, de-dup, non-review criteria untouched, slice order/coverage, id-drift match).
- **`mono` files** `review-gather.json` / `review-gather.toon` added to the stage-file set (governor
  fingerprint / stall detection) and the `mono status` checklist.

#### Notes
- **Why not let pass B re-read directly?** The judge's `Glob`/`Grep` are withheld by design (§7 pack-only,
  pinned by `self-conformance.test.ts`) so a present pack cannot be bypassed by re-scanning. Routing the
  re-investigation through the gatherer keeps that boundary intact, keeps the new evidence **gated** (S2.6,
  fail-closed) and **reproducible** (the judge still scores from a validated pack, not an ad-hoc scan), and
  keeps A↔B comparable (both ultimately judge from the master pack; the append-only merge means B simply
  sees a superset). Default-off so existing runs' cost and the per-stage governor expectations are unchanged.
- No rubric criterion, level, weight, or tie-break anchor changed; the default (no flag) pipeline is
  byte-for-byte the prior behaviour (`slice-pack` → pass B). `npm test` extended, all green.

### [0.4.7] — 2026-06-03

Rubric: **v3.1** (unchanged). **Packaging: ship the behavioural-eval golden set into the pack catalog.** `build-skill.mjs` now emits the top-level `evals/` assets (the LLM-judge fixtures + `CATALOG.md` + the runner) into `package-meta/<pack>/evals/` for the `monosashi` pack, so the "all fixtures green" claim travels with the pack as **audit evidence**. `package-meta/` stays reference evidence that tools never read; the top-level `evals/` remains the source of truth (run by `npm run eval`) and these are build-emitted copies. No evaluation tool CLI flag, TOON schema, pipeline step, or rubric changed.

#### Added
- **`build-skill.mjs` `copyEvalsForPack`** — copies `evals/CATALOG.md` + `evals/fixtures/**` verbatim into `package-meta/monosashi/evals/` (both `.claude/` and `.github/`), hooked into `buildPackMeta` for the `monosashi` pack only (same `pack === PACK` pattern as `emitTraceability`). Fixture artifacts ship **as-is** — they are read-AS-evidence by an auditor, and altering them would desync them from their `expected.toon` oracle.

#### Security / neutralisation
- **`evals/run-eval.mjs` ships neutralised** — every line commented out (line-comments via `neutraliseScript`, not a block wrapper, since the runner carries its own `/* */` JSDoc that a block comment would terminate early). It cannot run from the catalog regardless (no `dist/`, no agents, no spawn infra); the neutralisation makes a stray `node` invocation a no-op.
- **`evals/fixtures/injection/` is NOT shipped** — its artifact carries a deliberate prompt-injection payload, a **read-time** threat that comment syntax cannot neutralise (an LLM reads comments too). The distributed pack gets an `injection/OMITTED.md` note instead (paraphrased, no verbatim imperative); the live fixture stays repo-only for the resistance eval. Verified: no verbatim injection imperative appears anywhere under `.claude/package-meta` / `.github/package-meta`.

#### Notes
- Build stays idempotent (`buildPackMeta` rm's `package-meta/` first); `.claude` ↔ `.github` mirror parity confirmed (41 files each); `npm test` (217) green.
- **Catalog docs reconciled with the shipped golden set** (no self-score language; mechanisms stated, levels left for the judge): [coverage.md](./coverage.md) — corrected the "LLM layer not pinned by fixtures" wording (the band golden set *does* pin the judge within tolerance) and added a `Behavioural-eval golden set (evals/fixtures/)` section distinguishing it from the deterministic suite and the `eval_queries.json`/`evals.json` eval definitions; [threat-model.md](./threat-model.md) — added trust boundary 4 (the distributed pack carries adversarial-by-design fixtures) and **T11** (the distributed pack injecting a downstream reader → live injection payload omitted + runner neutralised; residuals stated, incl. that this is a build/packaging control, not a toolchain mechanism).

### [0.4.6] — 2026-06-03

Rubric: **v3.1** (unchanged). **Repo-only eval-oracle maintenance** — re-validated all 13 behavioural-eval fixtures against the current pipeline (the 2026-06-02 A4 `no-high-risk-surface` N/A rule + `riskSurface` axis) via `evals/run-eval.mjs` (sonnet, headless `claude -p`, subscription auth). All green. No evaluation tool CLI flag, TOON schema, pipeline step, or rubric changed — only two `expected.toon` oracles were corrected. Observed per-fixture results stay in each fixture's `expected.toon` (per the 0.4.4 catalog-trim decision); no run-result table is re-added to `evals/CATALOG.md`.

#### Fixed
- **`evals/fixtures/composite-skill/expected.toon`: dropped the `profile.declaredType: skill` over-pin.** The profiler's free-text `declaredType` is model-unstable — it now labels the composite bundle `"composite"`, which `declaredAxisOf` does not map, so the axis-equivalence fallback in `assertProfile` cannot rescue it. Production never uses this field: `select-tracks --inventory` adopts inventory's path-derived `guessedDeclaredType` (`skill`) as the authority, and the fixture's real contract (`m2.score=2` LOW, tracks ⊇ {M,G,A,S}) transitively pins the skill-axis declaration. Pinning the raw profiler label was redundant and flaky; removed (note line added explaining why).
- **`evals/fixtures/pure-doc-honest/expected.toon`: K3 band `[3,4]` → `[2,4]`.** The same ±1-cushion correction already applied to K5 (see 0.4.x band note), left un-applied to K3. The static judge consistently scores K3 (example correctness) at **2** across runs — a defensible Lv2↔Lv3 boundary call, since a static read cannot verify the examples actually execute — so a high-band claim with zero slack below 3 mis-fails. Widened to keep the high intent while honoring the documented "a high-band band still keeps ≥1 slack on one side" rule.

#### Notes
- **A4 change validated on both arms.** The 2026-06-02 A4 `no-high-risk-surface` rule was the only logic change that could have stale-broken the pre-existing (2026-05-31) fixtures. It is green on both: the **scored** side (`guarded-agent` A4=2, `bare-agent` A4=0 — the profiler classifies the production deploy `class:"high"`, so A4 is scored, not auto-N/A) and the **N/A** side (`readonly-auditor` — A4 in `naByRule`). No staleness regression in the fixtures themselves.
- **Heaviest-fixture transient.** `harness` (21 criteria — M+G+A+S+H+K all apply) occasionally yields a judge pass whose `scores` is not an array, crashing `aggregate`; absorbed by re-spawn / re-run. Not a regression — a known LLM-output-shape slip on the largest scoring load.

### [0.4.5] — 2026-06-03

Rubric: **v3.1** (unchanged). Fixes the `scoreboard.toon` reconcile output so an **N/A from either scoring pass no longer hides the second opinion** in the report. No CLI flag, TOON schema field, or pipeline step was added/removed; the merged-score records gain per-pass fields they should always have carried.

#### Fixed
- **`aggregate.ts` `reconcile`: the two N/A branches now carry `scoreA`/`scoreB` (incl. `"N/A"`) and `confidenceA`/`confidenceB`.** Previously, when a criterion was scored by both passes but at least one returned `N/A` (e.g. a `naRule` criterion like `G2`/`A4`), the merged record was pushed *without* the per-pass breakdown and *without* `singlePass`. The HTML report's パス column (`A${scoreA}/B${scoreB}` with a `·` fallback) then rendered **`A·/B·`** — visually "A./B." — as if no second opinion existed, and the markdown audit trail recorded no per-pass judgements. Both branches now attach the breakdown, so the report shows e.g. `A2/B N/A` and the audit lists both passes.
- **`aggregate.ts` `buildAudit`: `method` derivation requires both passes numeric for `mean(A,B)`/`median(A,B,C)`.** With per-pass scores now present on N/A passthroughs, the old `s.scoreB !== undefined ? "mean(A,B)"` would have mislabelled a passthrough as a numeric mean; it now reports `N/A passthrough` whenever a side is non-numeric, even though both passes ran.
- Regression: `src/__tests__/aggregate.test.ts` "both-N/A … one-N/A …" extended to assert the carried `scoreA`/`scoreB`, the absent `singlePass`, the `N/A passthrough` method, and the two recorded judgements on the one-N/A case.

#### Changed
- **`aggregate.ts` `reconcile`: reworded the merged-score `rationale` prefix to plain Japanese.** The mixed-language jargon `pass均: A=2 B=4.` / `pass median: A=1 B=3 C=3 → 3.` (half-Japanese abbreviation + English `median`, and an inconsistent `→ 結果` only on the median arm) is replaced with format-consistent phrasing using the report's own pass vocabulary: `パスA=2・パスB=4 の平均 → 3。` and `パスA=1・パスB=3・パスC=3 の中央値 → 3。` — aligned with the HTML audit-trail note (`A = パスA、B = セカンドオピニオン、C = タイブレーク`). Cosmetic — only the `rationale` string text in `scoreboard.toon` changes (no schema field, CLI flag, or score value affected); no test asserts the prefix.

### [0.4.4] — 2026-06-03

Rubric: **v3.1** (unchanged). Adds a **requirements-traceability registry** — a structured map from monosashi's own requirements / specifications / acceptance conditions to the source that implements them and the tests/fixtures that verify them, aiming at a complete spec↔code linkage. No evaluation tool CLI, TOON schema, or pipeline step changed; the addition is a new source-of-truth + build-emitted catalog doc + a **content-level** conformance guard.

#### Added
- **`src/traceability.ts`** — hand-authored typed source of truth (`TRACEABILITY: TraceItem[]`), 87 items across three layers: `requirement` (process stages S0–S5 + invariant principles — static-only, evidence≠context, multi-track, declaredType authority, N/A exclusion, verbatim scoring, radar/weight, mechanical M2, single-driver harness), `spec` (all 23 rubric criteria + tool/CLI contracts + inter-stage schemas + the 8 defence layers + agent prompt contracts), and `acceptance` (concrete pass/fail conditions each pinned to a test or eval fixture). New types `TraceLayer` / `TraceItem` in `src/types.ts`, including the **`anchors`** field — concrete exported symbols / markers / discipline keys that must appear verbatim in the item's cited sources (every item citing a `*.ts` impl now declares ≥1).
- **`src/render-traceability.ts`** — renders the matrix from `traceability.ts` + the rubric (same single-source pattern as `render-framework.ts`), now with a **照合シンボル (anchors)** column. Emitted at build into the pack catalog as **`package-meta/monosashi/traceability.md`** (a management/governance index — not shipped inside the skill bundle; tools never read it).
- **`src/__tests__/traceability-conformance.test.ts`** (source-only) — mechanically guards the registry at **content level, not name-only**: every cited `impl`/`verify` path exists *and is non-empty*, every cited `*.test.ts` contains a real `test()`/`describe()` declaration, every `*.toon` fixture parses, and every `anchors` symbol appears verbatim in the item's `impl`∪`verify` text — so a renamed function or gutted test fails the *binding*, not merely a deleted file. Graph-shape invariants (duplicate id, dangling/ill-ordered parent, uncovered rubric criterion) are **owned solely by `renderTraceability`**; the test delegates to it instead of re-implementing those assertions (removing the earlier duplication). Orphan-requirement and the documented `KNOWN_UNVERIFIED` allow-list (**currently empty**) remain test-side. The spec↔code map fails CI rather than drifting silently (the G4-Lv4 / 差分検出 discipline applied to the evaluator's own traceability data).
- **Closed two test-coverage gaps the registry surfaced** (S2): `full-plan.ts` and `cohort.ts` previously had no direct unit test. Each now exposes pure builders (`buildFullPlan`; `buildCohort` / `cohortTrackKeys` / `renderCohortMd`) split out of `main()`, matching the codebase's existing builder/IO separation — covered by new `src/__tests__/full-plan.test.ts` (all-criteria coverage, M2 excluded, `lookFor`=Lv2, no verbatim-ladder leak) and `src/__tests__/cohort.test.ts` (canonical track order, weighting inheritance, M2-independent column, null-cell rendering).

#### Changed
- **Collapsed six self-referential spec rows** (`SPEC-A2`, `SPEC-S1`, `SPEC-K1`, `SPEC-K2`, `SPEC-K3`, `SPEC-K5`) into `SPEC-RUBRIC-INTEGRITY` (spec layer 49→43, total 93→87). These criteria have **no implementation/verification path of their own** — their row mapped a rubric criterion only back to `src/rubric.ts` + `rubric.test.ts`, with the anchor being the criterion id that trivially lives in the single-source rubric — so each was a near-tautology that padded the item count and made the coverage table read denser than the actual spec↔code linkage. The six criteria stay covered via `SPEC-RUBRIC-INTEGRITY.criteria` (no-uncovered-criterion invariant intact). Criteria with a *distinct* binding are untouched: `SPEC-S2`/`S3` (acceptance child `ACC-DISCRIM-TESTED`), `SPEC-H1`/`H2` (child `ACC-HARNESS-AXIS`), `SPEC-M1`/`A3` (self-conformance verify). Motivation: keep the evaluator's own traceability data load-bearing rather than inflating coverage for its own self-score.

#### Notes
- `build-skill.mjs`: registered the new source-only test in `SOURCE_ONLY_TESTS`; `buildPackMeta` now emits `traceability.md` for the `monosashi` pack via `emitTraceability`.
- **`evals/CATALOG.md` trimmed to catalog-only content**: removed the run-time verification snapshot (「実装状況（実 spawn で検証済み）」result table), the troubleshooting findings (「実 fixture から出た発見」), the dated declaredType-authority change note, and the runner-integration PR memo (「ランナー連携」). The catalog now keeps only fixture design / `expected.toon` schema / fixture details / coverage matrix; observed results stay in each fixture's `expected.toon`. No tool, schema, or fixture changed.

### [0.4.3] — 2026-06-03

Rubric: **v3.1** (unchanged — no criterion, level, track, weight, or tie-break anchor changed). A **documentation-management / packaging reorg**: the four management & operational-rule documents are consolidated into this pack catalog, so `package-meta/monosashi/` is now the single home for the project's management and operational rules (it already owned version/governance, G3). No tool behaviour, CLI flag, TOON schema, or pipeline step changed.

#### Changed
- **Moved `coverage.md` (H1), `reliability.md` (G2), `reproducibility.md` (G5), and `threat-model.md` (H2) out of the shipped skill `docs/` into the pack catalog** (`skill-src/monosashi-eval/docs/` → `skill-src/packs/monosashi/` in source; emitted to `.claude/` & `.github/` `package-meta/monosashi/`). The skill bundle now ships only the docs a run needs in hand — `tools.md`, `schemas.md`, the rendered `framework.md`, and `example-walkthrough.md`. The build needs no change: `buildPackMeta` already `copyTree`s the whole `packs/<pack>/` dir, and `emitDocs` ships whatever remains in `docs/`.
- **Re-pathed every cross-reference** to the moved docs: the four docs' own inter-doc + framework/SKILL/src links now use the pack-catalog (built-layout) relative convention (matching this file); `SKILL.md`, `body.md`, `tools.md`, the skill `package.json`, `evals/CATALOG.md`, and the `regression.test.ts` header comment now point at `package-meta/monosashi/…`. `SKILL.md`'s reference list is split into "shipped in the bundle" vs. "management & operational rules in the pack catalog".
- The four docs' self-description updated from "reference evidence in `docs/`" to "reference evidence in the pack catalog (`package-meta/`)".

#### Notes
- **Packaging note.** Because these four docs now live in the pack catalog rather than the shipped skill bundle, an evaluation scoped to only the skill bundle will not see them. Any evaluation that needs this governance/lifecycle/operational material must include the **`package-meta/monosashi/` root** among `mono init`'s roots — as the `monosashi-conductor` *Bundle assembly* step already instructs (enumerate adjacent roots; pass any that plausibly carry governance/lifecycle/operational material). Under the v3.1 `S3`/`G5` "bundled = present inside the scored target roots" anchor, the docs are then in scope.
- Historical `docs/…` paths in older release entries below are left as-is (they record where those files lived at the time of that release).
- **Eval-asset fidelity fix (repo-only; not a toolchain change).** The behavioural-eval harness (`evals/run-eval.mjs`) had drifted from production: it invoked `select-tracks` **without** `--inventory`, so it never exercised the declared-type authority added in `0.4.2` (inventory's path-derived `guessedDeclaredType` overriding the profiler). Two single-doc fixtures (`liar-agent`, `frontmatter-only`) named their artifact `agent.md` / `triage-agent.md`, which the path convention guesses as `knowledge/doc` — so in the real `mono next` pipeline `liar-agent`'s M2 silently became **2** instead of the **0 HIGH** the fixture is the bridge test for. Fixed: `run-eval.mjs` now passes `--inventory` (mirrors `mono next`), and the two artifacts were renamed to `*.agent.md` so the path convention and frontmatter agree. M2/rubric/tool behaviour are unchanged — this only realigns the eval oracle with the shipped pipeline.

### [0.4.2] — 2026-06-01

Rubric: **v3 → v3.1**. Tie-break **anchor** clarifications only (§7 discriminators) — no criterion, level definition, track, or weight profile changed. Motivated by a cross-model reproducibility finding: scoring the monosashi bundle with two judge models (Opus 4.8 vs Sonnet 4.6) diverged on four criteria (G1/G5/S3/K4), and every divergence traced to interpretive slack in a single contested fact at the Lv3↔Lv4 boundary rather than to disagreement about the facts. The anchors now name that fact explicitly so any judge model converges on the same level.

> **Comparability note (K4 版↔API 整合).** `v3.1` changes scoring outcomes on the affected criteria, so old `v3` scoreboards are **not comparable cell-for-cell** for G1/G5/S3/K4 — they remain readable (they carry `rubricVersion: v3`) and comparable on the other 18 criteria. Flag the rubric bump in any longitudinal (S5) diff.

#### Changed
- **`src/rubric.ts` anchors (→ `scripts/rubric.toon`, embedded into `plan.toon` by `select-tracks`):**
  - **G1** — a Lv4 machine-readable contract is met when the **primary inter-stage data contracts** are runtime-validated at the boundary and hard-error on violation; a prose-only description of an **auxiliary** input path (e.g. user-supplied args) does **not** cap it. Full type-enforcement of *every* input path is not required for Lv4.
  - **G5** — lockfile / reproduce-script need only **exist in the repository**; physical inclusion inside the scored bundle roots is **not** required. **Zero runtime dependencies** (vendored, nothing to resolve) counts as full pinning.
  - **S3** — "bundled" (`同梱`) means **present inside the scored target roots**. An eval runner that lives only in the repo (outside the scored roots) does **not** satisfy Lv4 even when the fixed case-set itself is bundled → caps at Lv3.
  - **K4** — Lv4 is satisfied by **documenting** the version-sync update triggers; automated enforcement (CI etc.) is **not** a Lv4 requirement.
- **Version policy**: the *Two version axes* table now states explicitly that a **tie-break anchor (§7)** change bumps the rubric version (it can move scores), not just a criterion/level/track/weight change. The `RUBRIC.version` integrity test pins `v3.1`.

#### Notes
- `levels[]` (the verbatim 0–4 definitions rendered into `framework.md`) are **unchanged**; only the §7 `anchor` discriminators were sharpened. The pipeline, schemas, CLI flags, and weights are unchanged — this is a pure calibration clarification.

### [0.4.1] — 2026-05-31

Rubric: **v3** (unchanged). Reliability + reproducibility hardening of the deterministic toolchain (G2 / G5), no rubric or schema change.

#### Added
- **`docs/reliability.md`** — the failure-mode / degradation / recovery contract: a failure-mode table (malformed TOON, missing file, schema-invalid profile, evidence-less score, argv truncation, high-variance escalation), the fail-closed stance, and the idempotency/retry design. Documents that the toolchain makes no network calls and spawns no subprocesses, so failures are deterministic and the recovery action is "fix the named artifact + re-run", not retry-spam.
- **`docs/reproducibility.md`** — the environment / dependency / reproduce-from-checkout manifest: Node ≥ 22 (and why), **zero runtime npm dependencies** (TOON codec vendored into `scripts/toon-vendor.mjs`), `npm ci`-locked build deps, the determinism guarantee (pure scoring spine; only `runId`/`producedAt` vary — pin `--run-id` for byte-stable artifacts), and the compatibility range + prerequisite constraints (platforms, ESM-only, Node range, argv-size limit).
- **`serde.readToonFile(path)`** — a path-attributed read+parse helper: a bad read or malformed TOON now throws an `Error` naming the offending file (`malformed TOON in <path>: <cause>`), surfaced as a clean `ERR <tool>` line. Input validation on the main path.
- **`cli.runCli(tool, main)`** — wraps every producer/validator entry point so any uncaught error (`ToonDecodeError`, `ENOENT`, …) degrades to a single `ERR <tool>: <reason>` line + exit 1 instead of a raw stack trace. The throw happens during input parse, before stdout, so a failed run leaves **no partial artifact** (fail-closed).
- Source-only `serde-io.test.ts` covering `readToonFile` (round-trip, missing-file attribution, malformed-TOON attribution).

#### Changed
- All 10 producer/validator CLIs (`inventory`, `full-plan`, `select-tracks`, `validate-profile`, `validate-evidence`, `second-opinion`, `contested`, `slice-pack`, `aggregate`, `validate-pass`) now run their `main()` under `runCli` and read input via `readToonFile`. Behaviour change: malformed/missing input → clean `ERR` line + exit 1 (previously an uncaught stack trace). Exit codes and stdout are otherwise unchanged.
- Skill runtime `package.json` declares the zero-runtime-dependency design machine-readably (`"dependencies": {}` + note).

#### Fixed
- Stale toolchain version in the *Two version axes* table above (`0.3.0` → current).

### [0.4.0] — 2026-05-31

Rubric: **v3** (unchanged — only the report deliverable changed, not the criteria).

#### Added
- **HTML report deliverable (`report.mjs --html`)** — the `monosashi-conductor` now ends a run by rendering a **self-contained `eval-out/<name>/scoreboard.html`** from `scoreboard.toon` and handing the user its path. The page embeds its own CSS and an **inline SVG radar** (by-track) computed server-side — no external assets, no client JS, no network — so it opens stand-alone in any browser. It shows the KPI tiles (overall mean / weighted index / confidence split / N/A), the by-domain bars, the **M2 divergence flag** box, the `needsHumanReview` list, and the full per-criterion table (score · confidence · single/multi-pass · rationale · collapsible evidence). New module `src/report-html.ts` (`renderHtml`); `report.mjs` gains the `--html` flag alongside the existing default markdown and `--json`. A new pipeline stage **S6** (body.md / SKILL.md step 11) makes rendering + hand-off the terminal step: brief chat headline + the file path, then stop — superseding pasting the full markdown into chat.

#### Notes
- `--html` is additive; the default (markdown) and `--json` outputs are unchanged. The HTML renders purely from `scoreboard.toon` (no new inputs), so it works on any existing scoreboard.

### [0.3.0] — 2026-05-31

Rubric: **v3** (unchanged — only the inter-stage data format changed, not the criteria).

#### Changed
- **Inter-stage data format migrated from JSON to TOON** (Token-Oriented Object Notation) — the token-cost reduction. Every evaluation-time artifact a stage produces and the next stage (or a sub-agent) reads is now **TOON** (`*.toon`), ~29% smaller than the pretty JSON the tools used to emit, with lossless round-trip of every shape (verbatim multiline level ladders, code snippets full of delimiters, the `"N/A"`-string vs number-`3` distinction, sparse optional columns). The deterministic tools read+write TOON at their `main()` boundary (`src/serde.ts` → `toonParse`/`toonStringify`, which drops `undefined` like `JSON.stringify` did and keeps real `null`); the LLM sub-agents (`monosashi-surveyor`/`monosashi-profiler`/`monosashi-gatherer`/`monosashi-judge`) now emit + read TOON. Internal deep-clones and message formatting still use JSON — they are not serialization boundaries.
- **Renamed artifacts** `*.json` → `*.toon` across the pipeline and every command/example/schema in `SKILL.md`, the agent bodies, `schemas.md`, and `example-walkthrough.md` — including the build-emitted at-rest rubric reference, now `scripts/rubric.toon` (encoded by `build-skill.mjs`). The **only** file left as JSON is `package.json`.

#### Added
- **`@toon-format/toon` (v2) vendored into the shipped skill** — `build-skill.mjs` copies the single self-contained ESM file to `scripts/toon-vendor.mjs` and rewrites `serde.mjs`'s import to it, so the skill still runs `node scripts/*.mjs` with **no install / no node_modules** (dependency-free distribution preserved).
- **`src/__tests__/serde.test.ts`** — round-trip guard over the tricky shapes; ships in the bundle so `npm test` also verifies the *vendored* codec.

#### Notes
- TOON savings come from collapsing repeated object keys/braces in uniform arrays; long verbatim content (rubric `levels`, evidence `snippet`s) is unchanged, so the realised cut is the structural share (~20–30%), not more. Validator stderr **reports** are TOON too, so a stage that consumes them sees one consistent format.

### [0.2.0] — 2026-05-31

Rubric: **v3** (unchanged — criteria/levels are stable; only tooling and guidance changed).

#### Added
- **Run correlation ID + provenance** (A5 観測性 / H3 監査基盤). `inventory.mjs` mints a `runId` at S0 (or accepts `--run-id <id>`); `select-tracks.mjs` and `aggregate.mjs` thread the same id, so `inventory.json` / `plan.json` / `scoreboard.json` of one run share a `runId`. Each deterministic stage stamps a `provenance` envelope `{ runId, producedBy, toolVersion, producedAt, inputs }`.
- **Audit trail** in `aggregate.mjs` output (`audit.passes` + `audit.trail`): a per-criterion judgement-provenance log — which passes judged each criterion, by what reconciliation method, on what cited evidence — rendered by `report.mjs` as an Audit-trail table.
- **`toolVersion` on every provenance envelope** (K4 版↔API): best-effort read of the toolchain semver from `package.json`, so each artifact self-describes the version that produced it.
- **Version policy & correspondence consolidated into this file** — the rubric ↔ toolchain ↔ tool/JSON-API correspondence table, update triggers (版同期の運用方針), and governance/lifecycle/deprecation policy (G3) now live in the sections above (previously a separate `docs/versions.md`).
- **`docs/coverage.md` + `src/__tests__/regression.test.ts`** (H1 評価カバレッジ): documented coverage range / out-of-scope / observation points + update triggers, backed by a **regression hard-case set** that pins the deterministic spine end-to-end — the coverage invariant (23 criteria across M/G/A/S/H/K), M2 hard cases (liar agent / undeclared sub-component / ambiguous type), track applicability + G2 N/A gating, reconciliation (mean / median tie-break / N/A / single-pass), and the audit trail. First tests over `aggregate` (previously unpinned).
- **Misuse-example contrasts in `docs/example-walkthrough.md`** (K3 例の正しさ・自己完結性): ❌/✅ pairs for the real failure modes — large JSON inline (truncation), handing `rubric.toon` to the judge (double-read), forgetting `--superset` / `--resolve` / `--plan`, branching on output presence, averaging M2, whole-bundle scoring of heterogeneous folders.
- **Tools / least-privilege / I/O-control table in the `monosashi-conductor` agent body** (A2 ガードレール・入出力制御, A3 権限スコープ): per-tool least-privilege rationale (read-only target, `Write`/`Edit` scoped to `eval-out/` only, static-read-only bound), fail-closed input gating (the schema validators), posture-based output strictness (`external`/`internal` weighting), and "M2/needsHumanReview/low-confidence always surfaced". Kept as a compact table that doubles as a runtime cheat-sheet (single-file-artifact exception to evidence ≠ context).
- **`docs/threat-model.md`** (H2 多層防御・脅威モデル): the LLM-as-judge threat model — prompt injection via the artifact, axis-value spoofing to skew M2, evidence fabrication, score inflation, output drift, single-judge error, transport corruption, untraceable judgement, stale supporting evidence — each mapped to the **existing** defence layer(s) (L1 static-read-only, L2 schema gates, L3 evidence grounding, L4 mechanical M2, L5 normalisation, L6 redundancy, L7 transport integrity, L8 provenance/audit), with residual risks stated and a defence-layer update policy.

#### Changed
- `framework.md` §7 gains the **"証拠 ≠ 実行時コンテキスト (evidence ≠ context)"** principle: the rubric credits documentation that is *discoverable in the bundle*, not inlined into the runtime prompt — a lean prompt is not penalised, and rationale/threat-model/version docs belong in `docs/`, not in an agent's body. Includes the single-file-artifact exception and a judge note (don't reward verbose inlining; doc-gaming is caught by M2).
- `schemas.md` documents the `provenance` envelope and `audit` trail; `SKILL.md` / `body.md` note the `--run-id` thread and the audit trail (kept terse, per the evidence ≠ context principle).
- **De-pinned the rubric version tag from the runtime prompts** (K4 版↔API): the agent bodies, agent/skill `description`s, and `coverage.md` prose no longer hardcode `v3` — they refer to "the Monosashi evaluation / rubric" and let the version live in exactly one place, `RUBRIC.version` (`src/rubric.ts`), surfaced mechanically via `rubric.toon` / `plan.rubricVersion` / every report header and recorded here. A future rubric bump no longer means editing ~16 prose copies.

#### Notes
- Provenance/audit are **metadata only** — never inputs to any score. The pure scoring functions (`buildPlan` / `aggregate` / `buildAudit`) stay clock-free, so the unit suite remains deterministic. New tests cover `mintRunId` / `argRunId` / `makeProvenance` / `buildAudit`.

### [0.1.0] — initial

Rubric: **v3**.

- Deterministic toolchain: `inventory`, `full-plan`, `select-tracks` (with mechanical **M2** flag + embedded verbatim rubric slice), `second-opinion`, `contested`, `validate-profile` / `validate-evidence` / `validate-pass`, `aggregate` (radar + weighted index + two/three-pass reconciliation), `report`, `cohort`.
- LLM output-variance normalisation (`normalize`) shared by every consumer.
- Single-read S1 gate (`monosashi-surveyor` → profile + all-criteria evidence pack), with a split-mode `monosashi-profiler` + `monosashi-gatherer` alternative.
- Unit suite under `src/__tests__/` shipped into the bundle.
