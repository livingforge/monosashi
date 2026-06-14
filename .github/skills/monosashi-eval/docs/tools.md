# Tool reference — the deterministic stages

`mono` runs every stage below, in order, and owns every filename, flag, and redirect — **you do not
invoke these by hand**. This file is the at-rest reference for *what each stage's command, flags, and
output fields are*, for debugging or the manual inline-pipeline path. The orchestration contract (the
`init` → `mono next` loop) lives in [SKILL.md](../SKILL.md); the TOON shapes in
[schemas.md](schemas.md); the rubric template in [framework.template.md](framework.template.md).

All tools read/write **TOON** (`.toon`) files. `<skill-dir>` is the directory containing `SKILL.md`.
Per the **outcome convention**: the exit code is the gate (`0` ok, non-zero fail, `2` usage), the
`OK`/`ERR <tool>: …` line goes to **stderr**, and **stdout** is reserved for the TOON data
(producers) or the formatted report (`report`/`cohort`) — so a redirected `> out.toon` stays pure.
A validator that prints no stdout but exits `0` with an `OK …` line **succeeded** — a
delayed/empty result is *pending*, not failed; branch on the exit code rather than re-firing the call.

## Pipeline overview — mechanical vs judged (framework §3)

The full pipeline in stage order. `mono` drives all deterministic stages automatically and stops only
where a subagent must judge — **never invoke these stages by hand**.

| Stage | What | How |
|---|---|---|
| S0 Inventory | gather the bundle + declared label; emit the full-criteria list (`full-plan.mjs`) | **tool** `inventory.mjs` + `full-plan.mjs` |
| S1 Read once | **one read** of the bundle → capability profile (axes + `declaredType`) **and** the all-criteria `{path, lines, note}` evidence pack | **judge** (`monosashi-surveyor`), grounded in inventory signals |
| S1.5 Validate profile | schema-check the profile before it drives track selection / M2 | **tool** `validate-profile.mjs` |
| S2 Track select | which tracks/criteria apply, which are N/A by rule; **embeds the verbatim rubric slice (levels + anchors) into the plan**; **derives the mechanical M2 flag (`plan.m2`)** | **tool** `select-tracks.mjs` |
| S2.6 Validate + resolve pack | pack covers the (subset) plan; each `lines` range resolves; `--resolve` reads ranges back into snippets (precondition for ref-only scoring) | **tool** `validate-evidence.mjs --superset --resolve` |
| S3 Score A | 0–4 per applicable criterion, from the evidence pack + embedded slice, with evidence + confidence | **judge** (`monosashi-judge`), one full pass (validated at the S3.5 gate) |
| S3.2 Second-opinion select | reduce to the criteria A was not high-confident about | **tool** `second-opinion.mjs` |
| S3.25 Re-gather *(opt-in)* | with `--review-regather`: re-extract evidence for ONLY the review criteria, then augment the master pack so pass B sees what the first sweep missed | **judge** (`monosashi-gatherer`) + **tool** `validate-evidence.mjs --resolve` + `augment-pack.mjs` |
| S3.3 Score B | independent re-score of just that subset | **judge** (`monosashi-judge`), targeted pass (skip if A all-high) |
| S3.6 Tie-break | re-score only the contested overlap (pass A/B differ ≥1); median of {A,B,C} | **tool** `contested.mjs` + 1 more `monosashi-judge` pass |
| S4 Aggregate | radar by track/domain, weighted index, M2 flag, reconcile (mean/median; singlePass) | **tool** `aggregate.mjs` |
| S5 Longitudinal | re-run over time, track the curve | re-apply + diff (manual) |

The tool-to-output summary (what each deterministic stage produces):

| Stage | Tool | What it produces |
|---|---|---|
| S0 | `inventory` + `full-plan` | file facts + **signals** (`hasCodePath`, `hasTests`, …); the lightweight all-criteria list the surveyor gathers evidence against |
| S2 | `select-tracks` | the application plan (`appliedTracks` / `criteriaToScore` with embedded verbatim rubric slice / `naByRule`) **and** the mechanical **M2** flag (`plan.m2`) |
| S1.5 · S2.6 · S3.5 | `validate-profile` · `validate-evidence` · `validate-pass` | **fail-closed gates** — exits non-zero on a malformed/incomplete LLM artifact; `--resolve` reads line-ranges → snippets, `--fix` demotes evidence-less scores to low confidence |
| S3.2 · S3.6 | `second-opinion` · `contested` | reduced plans + a `shouldRun` flag — B over A's non-high-confidence criteria, C over A/B disagreements (≥ threshold) |
| S3.25 *(opt-in)* | `augment-pack` | with `--review-regather`: appends a targeted re-gathered pack into the master (append-only ⇒ pass A's refs stay valid) and emits the review slice pass B scores from |
| S4 | `aggregate` | the scoreboard: per-track/-domain **radar** (N/A excluded), optional weighted index, the **M2 flag** surfaced separately, reconciliation (mean/median; `needsHumanReview` for range ≥2) |
| S4.5 | `report` · `cohort` | the deliverable `scoreboard.html` (also `--json` / markdown); `cohort` combines several scoreboards into an artifact × track-mean table |

**S1 is a mandatory gate — never jump to S3 without it.** The bundle is read **once** at S1:
`monosashi-surveyor` emits both the profile and the all-criteria evidence pack, so no later stage
re-reads the artifact. The plan from S2 carries the verbatim level text + tie-break anchors, so judges
never open `rubric.toon`; the pack lets the passes score without re-reading the target.

**`mono` decides every branch** (`shouldRun` for B/C, N/A-by-rule, M2) — you never read a TOON
field to choose a path. **Two gotchas, only if you hand-run a stage directly:** don't pass a large
combined TOON as one positional arg to `aggregate` (the OS arg-length limit truncates it — use
`--passA/--passB` files), and never hand-extract the scoreboard's nested keys (`report` formats them).

## 1. Inventory (S0)
```bash
node scripts/inventory.mjs <targetDir> > inventory.toon
```
Walks the target, categorises files (code/config/doc/test/eval/data), and emits **signals**
(`hasCodePath`, `hasTests`, `hasEval`, `hasFrontmatter`, …) plus any frontmatter `name`/`description`
and a guessed declared type. It also emits **`outlines`** — a per-markdown heading map
(`{path, headings:[{line, depth, heading}]}`, fenced-code-aware) that is the surveyor/gatherer's
**read-map**: it lets the single sweep *locate* candidate sections (e.g. a 誤用例/対比 section for
K3) directly instead of relying on scrolling. These are *facts*, not a classification.

**Also at S0:** `node scripts/full-plan.mjs > full-plan.toon` emits **every** rubric criterion (no
profile, no M2) as a **lightweight** entry — `{criterion, title, tags, lookFor}`, *without* the
verbatim `levels`/`anchor` (those are the judge's, embedded later into `plan.toon` by
`select-tracks`). `lookFor` names **both the floor and the climbing discriminators** — `存在:` (the
capability is present, ≈Lv2) **plus** `加点:`/`網羅:` (what the upper rungs look like, e.g. 誤用例・
対比, 版整合のコピー動作網羅) — so the surveyor hunts for **ceiling** evidence too, not just "it
exists"; it carries **no level number** (the judge owns the 0–4 mapping). This is the input
`monosashi-surveyor` gathers all-criteria evidence against before tracks are known; keeping it slim
cuts the surveyor's reference tokens.

## 2. Select tracks (S2)
```bash
node scripts/select-tracks.mjs profile.toon > plan.toon
```
Input is the **capability profile** the profiler produced (schema in [schemas.md](schemas.md)). Output
is the deterministic application plan: `appliedTracks`, `criteriaToScore`, `naByRule` (e.g. G2 N/A when
no code path), `skippedTracks`, and **`m2`** — the mechanical declaration↔reality flag derived here
from `declaredType` × `axes` (so no LLM pass scores M2). **Each `criteriaToScore[]` entry embeds the
verbatim `levels[0..4]`, `tags`, and a tie-break `anchor`, and the plan carries the 0–4 `scale`** — so
the judge scores from the plan alone and never opens `rubric.toon`. The Stage-2 applicability table is
applied exactly; the judge does not decide track membership.

`scripts/rubric.toon` is the full machine-readable rubric (level definitions verbatim) + weight
profiles. Judges no longer need it — `select-tracks` already copies the relevant level text into the
plan — but it remains the at-rest reference and the source for the embedded slice.

## 3. Second-opinion selector (S3.2)
```bash
node scripts/second-opinion.mjs passA.toon plan.toon > review-plan.toon
```
From a **full pass A** + the plan, emits a reduced **plan** (same shape, slice carried) covering only
the criteria A scored at `confidence != "high"` — where a second pass earns its tokens. Pass B
re-scores just that subset; the high-confidence remainder keeps A's single judgement. `shouldRun:false`
(A uniformly high-confidence) ⇒ skip B, aggregate from A alone. `--also-high` restores a full
independent pass B.

### 3.5 Re-gather + augment (S3.25, opt-in `--review-regather`)
```bash
node scripts/augment-pack.mjs evidence.toon review-gather.toon review-plan.toon --update-master evidence.toon > review-evidence.toon
```
**Off by default.** With `mono init --review-regather`, before pass B the `monosashi-gatherer` re-reads
the bundle for **only** the second-opinion criteria (a fresh, targeted extraction), the re-gathered
pack passes the same S2.6 gate (`validate-evidence --resolve`), then `augment-pack` merges it into the
master. The merge is **append-only per review criterion** — existing candidates keep their positions
(so pass A's `evidenceRefs` stay valid) and only de-duplicated fresh citations (same path + lines/
snippet are dropped) are appended. It writes the augmented master back in place (`--update-master`, so
`validate-pass:B`/`aggregate` resolve B's refs at stable indices) and emits the review slice on stdout.
The rationale: a second-opinion disagreement caused by *missing evidence* (the single S1 sweep didn't
cite the deciding line) — not by judgement — is a false low pass B cannot fix while pack-only. Pass A
stays pack-only; the **judge still never re-reads** (extraction stays the gatherer's job, §7).

## 4. Contested selector (S3.6)
```bash
node scripts/contested.mjs passA.toon passB.toon plan.toon --threshold 1 > tiebreak-plan.toon
```
Emits a reduced **plan** (same shape, slice carried) covering only criteria whose pass-A/pass-B scores
differ by ≥ threshold (it compares the A∩B overlap, so single-judgement criteria are untouched).
`shouldRun` says whether a 3rd judge pass is worth it; if `false`, skip straight to aggregate with A+B.
(M2 is mechanical — `plan.m2` — so it is never part of the tie-break.)

## 5. Validation gates (S1.5 / S2.6 / S3.5)
```bash
node scripts/validate-profile.mjs  profile.toon                                                                  # S1.5
node scripts/validate-evidence.mjs evidence.toon plan.toon --target <dir> [--superset] [--resolve <out.toon>]    # S2.6
node scripts/validate-pass.mjs     passA.toon    plan.toon --target <dir> [--evidence evidence.toon] [--fix <out>] # S3.5
```
Each is a **fail-closed gate** on the corresponding LLM-produced artifact (profile / evidence pack /
score pass): a malformed or incomplete artifact **exits non-zero** and stops the run before any tool
consumes it. The subagents have no execution tool, so they emit to *satisfy* these gates and re-emit on
an `ERR`. Carry-forward flags: **`--resolve`** (S2.6) reads each `lines` range back into a `snippet`
(safe in place: `--resolve evidence.toon`) so judges score from text without re-reading; **`--fix`**
(S3.5) demotes an evidence-less non-N/A score to `confidence:"low"`; **`--superset`** lets the
all-criteria surveyor pack validate against the *subset* `plan.toon` (extra criteria → warning, not
error). For the score pass, an **out-of-plan** criterion (one not in `plan.criteriaToScore`, or an
`naByRule` criterion scored with a number) is likewise a warning — `--fix` **drops** it from the pass
so the gate self-heals; only a **missing** criterion (and bad score/confidence/dangling ref) is a hard
error. On a hard error `mono` asks the judge for a **patch** — only the flagged criteria, written to
`passX.patch.json` — which it merges into the existing pass by criterion id (the patch entry wins for
an id already present, logged), so a re-emit never re-sends the whole pass. What each gate checks
field-by-field — and how LLM output drift / path 揺れ is normalised + snapped before it — is covered in
[schemas.md](schemas.md) and [threat-model.md](../../../package-meta/monosashi/threat-model.md) T3/T5.

## 6. Aggregate (S4)
```bash
node scripts/aggregate.mjs --passA passA.toon --passB passB.toon [--passC passC.toon] --plan plan.toon --evidence evidence.toon --weighting internal > scoreboard.toon
```
Prefer the `--passA/--passB` form (separate files); a single combined `input.toon` positional or stdin
(`- internal`) also works. **Do not** pass large combined TOON as one positional arg — the OS
arg-length limit can truncate it. Input is one to three scoring passes (`{ passA, passB?, passC?,
weighting? }`, schema in [schemas.md](schemas.md)). Pass **`--plan plan.toon`** so the mechanical **M2
flag** (`plan.m2`) is surfaced, and **`--evidence evidence.toon`** so the passes' `evidenceRefs` are
resolved into concrete `{path, snippet}` in `mergedScores` (self-contained report; passes stayed
token-cheap citing only indices). Output: per-track + per-domain **radar** means (N/A excluded),
optional **weighted single index** (`external` = safety/observability/governance heavy; `internal` =
structure/reusability/reliability heavy), the **M2 flag** surfaced separately, and reconciliation: with
A+B the merged score is their mean; **add `--passC` (the tie-break pass) and each contested criterion
becomes the median of {A,B,C}**. `needsHumanReview` flags criteria whose range across the available
passes is still ≥2; `reconciliation.tieBroken` counts median-resolved criteria; `reconciliation.singlePass`
counts criteria judged by A alone (high-confidence, no second opinion — each marked `singlePass:true`);
merged entries keep `scoreA/scoreB/scoreC/confidence*` for audit. Omit `--passB` when S3.2 said
`shouldRun:false` (A-only run).

## 7. Report & cohort (S4.5)
```bash
node scripts/report.mjs scoreboard.toon            # markdown: radar → M2 → weighted index → reconciliation → per-criterion
node scripts/report.mjs scoreboard.toon --json     # flat BoardSummary (stable shape) for programmatic use
node scripts/report.mjs scoreboard.toon --html > scoreboard.html   # the deliverable: self-contained HTML report (radar SVG + tables)
node scripts/cohort.mjs --dir eval-out > eval-out/cohort-summary.toon   # combine eval-out/*/scoreboard.toon
node scripts/cohort.mjs --dir eval-out --md                             # markdown artifact × track-mean table
```
Deterministic formatters so the scoreboard is never hand-extracted — its keys nest
(`reconciliation`/`needsHumanReview`/`mergedScores` top-level; `radarByTrack`/`radarByDomain`/`m2Flag`
under `.scoreboard`), and re-deriving them inline is where formatting bugs crept in. `report.mjs`
formats one scoreboard; `cohort.mjs` combines several (positional paths or `--dir` to glob). Pure
formatting — no LLM, no re-reading the target.
