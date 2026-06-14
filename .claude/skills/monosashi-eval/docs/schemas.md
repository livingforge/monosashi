# monosashi-eval — TOON schemas

All tools read/write TOON. These are the exact shapes the tools expect. `docs/framework.md` holds the rubric text; `scripts/rubric.toon` holds it machine-readably; the pack catalog `package-meta/monosashi/CHANGELOG.md` maps the rubric version ↔ toolchain version ↔ this API and records what changed when.

> **Agents author JSON, not TOON.** The five LLM-produced artifacts — the capability **profile**, the **evidence pack**, and the **score passes** (A/B/C) — are written by the subagents as **JSON** (`profile.json`, `evidence.json`, `passA.json`, …), and `mono` converts each to canonical TOON with the vetted serializer before any deterministic stage consumes it. The **field schema is identical**; only the on-disk surface syntax differs (the shapes below are shown in TOON, the at-rest form). Authoring JSON removes the hand-formatted-TOON error class — blank lines inside arrays, unquoted `():[]` in free-prose `note`/`rationale`, indentation drift, wrong count headers — by construction, since a serializer (not the model) produces the TOON. The downstream `.toon` validators (schema/coverage/evidence) are unchanged and still run on the converted TOON.

## Capability profile (`monosashi-surveyor` S1 output → `select-tracks.mjs` input)

*(Same schema whether produced by the merged `monosashi-surveyor` or, in split-mode, by `monosashi-profiler`.)*

```toon
target: path/to/artifact
declaredType: agent
axes:
  orchestration: present | partial | absent
  encapsulation: present | partial | absent
  harness: present | partial | absent
  knowledge: primary | substantial | minor | absent
hasCodePath: true
riskSurface[1]:
  - op: "operation in a few words"
    evidence: { path: "file", lines: "42" }
    class: none | low | high
    external: true
note: "why each axis was judged so, citing files"
```

- `orchestration / encapsulation / harness`: three-valued (`present|partial|absent`).
- `knowledge`: four-valued by **role/quantity** — `K` track applies only when `primary` or `substantial` (framework §5).
- `hasCodePath`: gates `G2` (and other code-only criteria) to N/A when `false`.
- `riskSurface`: a **factual** list of the artifact's operations, each classified — `class:"high"` = an **external/irreversible side effect only** (write outside a sandbox / delete / send / network / deploy / arbitrary exec); `low` = contained/reversible; `none` = read-only. Autonomy/cost/runaway are **not** `high`. Gates **`A4`** to N/A-by-rule when the field is present with **no** high op (nothing to gate, excluded not penalised). **Omitting** the field means "not extracted" → A4 is scored anyway (the safe default), so emit it (use `[]` only when genuinely no risky op exists).
- Do **not** emit a single "primary type". Every matching track is applied by the tool.
- Gated by **`validate-profile.mjs profile.toon`** (S1.5): `target` non-empty, each axis a legal value, `hasCodePath` boolean, `declaredType` string|null, `riskSurface` (if present) a well-formed `{op, evidence:{path,lines}, class, external}` array. A typo'd axis value would skew both track selection and the mechanical M2 and a malformed `riskSurface` skews A4, so this runs before `select-tracks`.

## Track-application plan (`select-tracks.mjs` output)

```toon
target: ...
declaredType: agent
axes:
  "...": ...
hasCodePath: true
riskSurface: …            # carried through from the profile (null if not extracted); the judge
                          # scores A4 against its high ops. When no high op exists, A4 is in naByRule.
rubricVersion: v3
scale[2]:
  - level: 0
    name: Absent
    meaning: …
  - … 0..4
appliedTracks[4]: M,G,A,S
skippedTracks[1]{track,reason}:
  H,"非該当: 横断層が有または部分"
naByRule[1]{criterion,reason}:
  G2,コード経路が無いため N/A
  # A4 も riskSurface に high 操作が無ければここに入る(対外・不可逆な副作用なし → 承認設計は非該当)
m2:
  criterion: M2
  score: 0
  divergent: true
  severity: HIGH — 宣言乖離が大きい
  rationale: 宣言 'agent' に対応する軸 orchestration が absent — 実体が別物 (Lv0)
  mechanical: true
  basis:
    declaredType: agent
    onStructuralAxes[1]: encapsulation(skill)
    declaredAxis: orchestration
criteriaToScore[1]:
  - criterion: M1
    track: M
    title: …
    tags[2]: meta,docs
    levels[5]: Lv0 …,Lv1 …,Lv2 …,Lv3 …,Lv4 …
    anchor: 2=… 3=… 4=…  (tie-break discriminator)
counts:
  tracks: 4
  criteria: 17
  naByRule: 0
```

Each `criteriaToScore[]` entry now **embeds the verbatim rubric slice** (`levels[0..4]`, `tags`, `anchor`) and the plan carries the `scale`/`rubricVersion`, so the judge scores from this plan alone — it never opens `rubric.toon`. **`M2` is not in `criteriaToScore`** — it is derived mechanically here into `plan.m2` (score 0–3, capped at 3 since level 4 needs documented-composition evidence) and surfaced by `aggregate --plan`. The mechanical rule: declared axis **absent**→0, declared type **unrecognisable**→1, an **undeclared structural sub-component** (orchestration/encapsulation/harness beyond the declared one)→2, else **faithful**→3 (knowledge presence is not counted as an undeclared sub-component).

## Evidence pack (`monosashi-surveyor` S1 output → `monosashi-judge` input)

*(Produced by the merged `monosashi-surveyor` covering **all** criteria from `full-plan.toon`; in split-mode by `monosashi-gatherer` covering the applicable `plan.toon` subset.)*

```toon
target: path/to/artifact
items[1]:
  - criterion: G2
    candidates[1]:
      - path: scripts/foo.mjs
        lines: 38-41
        note: what level it bears on / supports|caps — free text, commas OK here
```
One `items[]` entry per planned criterion (**no `M2`** — it is mechanical, `plan.m2`). Each candidate cites evidence by a **1-based inclusive line range** `lines` (`"42"` or `"38-41"`) — *not* a copied snippet (§7 output-token cut: the surveyor/gatherer emit a tiny range, not a verbatim block). **Write candidates in block form (one `path:`/`lines:`/`note:` line per field), not as a comma-joined tabular row (`candidates[N]{path,lines,note}: …`):** `note` is free prose that routinely contains commas, and an unquoted comma in a tabular row is misread as a column break and fails to parse. Block form reads each `note:` to end-of-line, so commas are safe with no quoting discipline. (The deterministic re-encode at `--resolve` may re-tabularise the pack, but it quotes every field correctly — the fragility is only in hand-written packs.) Capture both supporting and refuting candidates so the scoring passes judge without each re-reading the whole target. A verbatim `snippet` is still accepted (e.g. for a synthesised citation), but `lines` is preferred. Judges cite a candidate by its **array index** (`evidenceRefs: [0, 2]`) rather than re-quoting it, so the `candidates` order is the reference — list the decisive citation first and keep positions stable.

Gated by **`validate-evidence.mjs evidence.toon plan.toon --target <dir> --superset`** (S2.6): covers **every** criterion of the (subset) plan, every candidate a non-empty `{path}` + one of `{lines, snippet}`, each `lines` range in-range (and tight — wide spans warn) in the cited file. **`--resolve <out.toon>`** reads each `lines` range back into a concrete `snippet` (kept alongside `lines`) and writes the resolved pack — run this once (safe in place: `--resolve evidence.toon`) so the judges score from text without re-reading the target. `--superset` allows the surveyor's all-criteria pack to carry extras beyond the applicable plan (warned, not failed); the surveyor *targets* exact coverage against `full-plan.toon` but **cannot run the validator itself** (it has no execution tool) — it writes the pack to satisfy the gate, and the **orchestrator** runs `validate-evidence` (the sole mechanical check).

**Opt-in S3.25 re-gather (`augment-pack.mjs`).** With `mono init --review-regather`, before pass B the `monosashi-gatherer` re-extracts evidence for **only** the review-plan criteria (→ `review-gather.toon`, gated by the same `validate-evidence --superset --resolve`), and **`augment-pack.mjs evidence.toon review-gather.toon review-plan.toon --update-master evidence.toon`** merges it into the master pack **append-only per review criterion** — existing candidates keep their array index (so pass A's `evidenceRefs` stay valid) and only de-duplicated fresh citations are appended. It rewrites the master in place and emits the **review slice** (same `EvidencePack` shape) on stdout for pass B. Because the merge is append-only, the master↔slice **index alignment** holds, so `validate-pass`/`aggregate` resolve pass B's refs against the master unchanged. Default off ⇒ the path is `slice-pack` (no master mutation).

## Review plan (`second-opinion.mjs` S3.2 output) & Tie-break plan (`contested.mjs` S3.6 output)

Both tools emit a **reduced plan** — the same shape as the full plan (slice carried), so the unchanged `monosashi-judge` + `validate-pass` consume it directly — covering only a subset of criteria:
- `second-opinion.mjs passA.toon plan.toon` → **review plan**: the criteria pass A scored at `confidence != "high"` (where pass B, the targeted second opinion, should look). Adds `reviewTargets` / `reviewDetail` and `shouldRun` (false ⇒ A was uniformly high-confidence, skip B). `--also-high` includes everything (a full pass B).
- `contested.mjs passA.toon passB.toon plan.toon` → **tie-break plan**: only the A∩B criteria whose scores differ by ≥ threshold (where pass C should look). Adds `contested` / `contestedDetail` and `shouldRun`.

Tie-break plan example covering only contested criteria:
```toon
target: ...
rubricVersion: v3
scale[1]: …
criteriaToScore[1]:
  - criterion: A1
    levels[1]: …
    anchor: …
contested[2]: A1,G5
contestedDetail[1]{criterion,passA,passB,diff}:
  A1,1,3,2
threshold: 1
shouldRun: true
counts:
  contested: 2
  criteriaInPassC: 3
```
`shouldRun:false` ⇒ nothing genuinely contested, skip the 3rd pass. The `monosashi-judge` consumes this exactly like a normal plan, producing `passC` over the contested subset.

## Criterion score (one entry per criterion, framework §7)

```toon
criterion: K1
score: 3
evidenceRefs[2]: 0,2
rationale: レベル定義の語に対応づけた理由
confidence: high | medium | low
```

Cite evidence by **`evidenceRefs`** — indices into the evidence pack's `items[criterion].candidates` — so the verbatim snippet is not re-emitted in every pass (§7 ref-token cut). When no pack was provided (tiny bundle, direct read) or to add a citation the pack lacks, use inline `"evidence": [ { "path": "SKILL.md", "lines": "42" } ]` (a `snippet` is also accepted) instead. At least one `evidenceRefs` index **or** one inline `evidence` item is required (else the score is forced to `confidence:"low"`). `score` is `0|1|2|3|4` or the string `"N/A"`. `validate-pass --evidence` resolves refs and verifies the snippet is verbatim; `aggregate --evidence` resolves them into concrete `evidence` in `mergedScores` for the report. After reconciliation, merged entries also carry `scoreA/scoreB/scoreC` and `confidenceA/confidenceB/confidenceC` for audit.

## Scoring pass (one judge pass)

```toon
target: path/to/artifact
declaredType: agent
scores[1]: "CriterionScore[] — one per criterion in criteriaToScore"
```

## Aggregate input (`aggregate.mjs`)

```toon
passA: ScorePass
passB: "ScorePass (optional, enables reconciliation)"
passC: ScorePass (optional tie-break over contested criteria)
weighting: external | internal
```
A bare `ScorePass` is also accepted and treated as `passA`. Weighting may also be passed as the 2nd CLI arg. CLI: `--passA --passB --passC --plan --evidence`. With `passC`, contested criteria use the **median of {A,B,C}**; without it, the **mean of {A,B}**. `--plan` surfaces the mechanical `m2Flag`; `--evidence` resolves each pass's `evidenceRefs` into concrete `{path, snippet}` in `mergedScores`.

## Scoreboard (`aggregate.mjs` output)

```toon
target: ...
twoPass: true
tieBreak:
  applied: true
  criteria[2]: A1,G5
reconciliation:
  comparedNumeric: 9
  exactAgreement: 0.67
  needsHumanReview: 1
  tieBroken: 2
  singlePass: 6
needsHumanReview[1]{criterion,passA,passB,passC,diff}:
  A1,1,3,2,2
scoreboard:
  radarByTrack:
    M:
      mean: 2.5
      n: 2
    G:
      mean: 2
      n: 5
  radarByDomain:
    safety:
      mean: 1.5
      n: 4
  overallMean: 2.1
  weighting: internal
  weightedIndex: 2
  confidence:
    high: 8
    medium: 5
    low: 2
  naCount: 3
  m2Flag:
    score: 0
    divergent: true
    severity: HIGH — 宣言乖離が大きい
    rationale: …
    mechanical: true
    basis:
      declaredType: agent
      onStructuralAxes[1]: encapsulation(skill)
      declaredAxis: orchestration
mergedScores[1]: "CriterionScore[]"
```

`m2Flag` is the **mechanical** M2 (copied from `plan.m2`; pass `--plan plan.toon` to `aggregate`, else it reads `"not derived"`). It is surfaced independently and never folded into `radarByTrack.M`, so declaration divergence is never hidden. The scoring passes no longer emit `M2`; a stray legacy one is ignored in the averages.

## Run provenance & audit trail

One evaluation run is one **`runId`** (correlation ID). Every *deterministic* stage tool stamps a `provenance` envelope onto its artifact, and the orchestrator threads the same **`--run-id <id>`** through them, so `inventory.toon`, `plan.toon` and `scoreboard.toon` of one run are correlatable. `inventory.mjs` **mints** a runId (`<basename>-<UTCstamp>`) at S0 when `--run-id` is absent.

```toon
runId: monosashi-conductor-20260531T120000Z
producedBy: inventory
toolVersion: 0.2.0
producedAt: "2026-05-31T12:00:00.000Z"
inputs[1]: agents/monosashi
```

`toolVersion` is the toolchain semver (best-effort from `package.json`), so each artifact self-describes the version that produced it — the machine-readable half of the rubric↔toolchain↔API correspondence in the pack catalog `package-meta/monosashi/CHANGELOG.md`.

`provenance` appears as the leading key of `inventory.toon` (alongside a top-level `runId`), `plan.toon`, and `scoreboard.toon`. It is **metadata only** — never an input to any score, and the pure scoring functions stay clock-free, so the unit tests remain deterministic.

`aggregate.mjs` also emits the **audit trail** — a traceable judgement-provenance log (which pass judged which criterion, by what reconciliation method, on what cited evidence), derived from the reconciled scores:

```toon
audit:
  passes:
    A: true
    B: true
    C: false
  trail[1]:
    - criterion: A5
      track: A
      finalScore: 2
      confidence: low
      method: "median(A,B,C) | mean(A,B) | single (A) | N/A passthrough"
      judgements[2]{pass,score,confidence}:
        A,1,medium
        B,3,medium
      evidence[1]{path,lines}:
        body.md,"3"
      needsHumanReview: true
```

`report.mjs` renders the runId header + an **Audit trail** table from these fields (M2 is excluded — its trace lives in `m2Flag.basis`). The trail mirrors `mergedScores`' `scoreA/scoreB/scoreC` + resolved evidence, projected as an explicit per-criterion provenance view so an auditor reads it directly instead of reconstructing it.
