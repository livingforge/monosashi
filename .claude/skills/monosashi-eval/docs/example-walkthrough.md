# monosashi-eval — worked example

This reproduces the framework's §9 applied example: a single file that documents a custom
library's usage but is *declared* "custom agent". It shows the mechanical tools in the loop.

## S0 — inventory

```bash
node scripts/inventory.mjs ./my-agent > inventory.toon
node scripts/full-plan.mjs > full-plan.toon   # all criteria, embedded slices
```
Suppose the target is one `my-agent.md` with no code. Inventory reports
`signals.hasCodePath = false`, `hasTests = false`, one doc file, `guessedDeclaredType: "agent"`.

## S1 — read once (judge → `monosashi-surveyor`)

`monosashi-surveyor` reads the file + inventory + full-plan **once**, and from that single read **authors JSON** — both `profile.json` (axes) and `evidence.json` (candidates for *all* criteria). `mono` then converts each to the canonical `profile.toon` / `evidence.toon` the deterministic stages consume: the field schema is identical, only the surface syntax differs, which removes the hand-formatted-TOON error class by construction (see `docs/schemas.md`). The profile the surveyor writes:

```json
{
  "target": "./my-agent",
  "declaredType": "agent",
  "axes": {
    "orchestration": "absent",
    "encapsulation": "partial",
    "harness": "absent",
    "knowledge": "primary"
  },
  "hasCodePath": false,
  "riskSurface": [],
  "note": "No control flow / tool selection (orchestration absent). Reusable usage notes only (encapsulation partial, description-only). Pure prose, knowledge primary. Declared 'agent' but no orchestration -> expect low M2."
}
```
`riskSurface: []` records "read-only, no risky op found" (→ A4 N/A-by-rule — emitted, not omitted); `mono` serialises this JSON to the at-rest `profile.toon` that `select-tracks` reads below.

## S2 — select tracks (tool)

```bash
node scripts/select-tracks.mjs profile.toon
```
Yields `appliedTracks: ["M","G","S","K"]` (A skipped: orchestration absent). `partial` encapsulation counts as **on** for the S track (`select-tracks` treats `present`/`partial` alike), so S applies here; `naByRule` includes `G2` because `hasCodePath:false`. A/H criteria are skipped entirely.

> The §9 example treats it as essentially knowledge-only. If you judge encapsulation `absent`, S drops out and you score only M + G(−G2) + K, matching the framework's "M + G + K, A/S/H mostly N/A".

The plan that `select-tracks` emits **embeds the verbatim level text + a tie-break `anchor`** in each `criteriaToScore[]` entry (and the `scale` at top level), so the downstream judges read the plan alone — not `rubric.toon`. `criteriaToScore` is the applicable **subset** of the surveyor's all-criteria pack.

## S2.6 — validate the pack against the plan (tool)

```bash
node scripts/validate-evidence.mjs evidence.toon plan.toon --target ./my-agent --superset
```
The pack `monosashi-surveyor` already wrote covers *all* criteria; `--superset` lets it carry extras beyond this artifact's applicable subset (warned, not failed) while still requiring every plan criterion to be present and every snippet verbatim. The scoring passes then cite those candidates by index, judging from the pack without re-reading the file.

## S3 — score pass A (full), then a targeted pass B (judge)

Pass A scores **all** of `criteriaToScore`: quote the verbatim level from the plan's embedded `levels` (apply the `anchor` between adjacent levels) and cite evidence — starting from the evidence pack. Like the surveyor, the judge **authors JSON** (`passA.json`) and `mono` converts it to the canonical `passA.toon` that `aggregate` consumes (same for `passB`/`passC`). Example for K1:

```json
{
  "criterion": "K1",
  "score": 2,
  "evidenceRefs": [0],
  "rationale": "主要手順が一意に解釈でき必須ルールが明示 (Lv2) だが、落とし穴・禁止事項の明示 (Lv3) はない。",
  "confidence": "high"
}
```

`evidenceRefs: [0]` points at candidate 0 of K1 in the evidence pack (e.g. `{path: "my-agent.md:12", snippet: "## Usage\n1. Call foo(x)…"}`) — the pass cites it by index instead of re-quoting it. `aggregate --evidence` resolves it back into a concrete `{path, snippet}` in the scoreboard. (Without a pack, inline `evidence` candidates instead.)

**M2 is not scored here** — it was already derived mechanically by `select-tracks` into `plan.m2`. For this artifact (declared `agent`, `orchestration: absent`) the rule gives:

```toon
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
```

The scoring passes therefore contain **no `M2` entry**; `aggregate --plan plan.toon` copies `plan.m2` straight into `scoreboard.m2Flag`.

## S3.2 / S3.3 — targeted second opinion (tool + 1 partial pass)

```bash
node scripts/second-opinion.mjs passA.toon plan.toon > review-plan.toon
```
`review-plan.toon` covers only the criteria pass A scored at `confidence != "high"` (here K1 was `high`, so it is **not** re-scored — it stands as a `singlePass` judgement). If `shouldRun`, run `monosashi-judge` once more over `review-plan.toon` → `passB.toon`; otherwise skip B and aggregate from A alone.

## S3.6 — tie-break the contested criteria (tool + 1 pass)

```bash
node scripts/contested.mjs passA.toon passB.toon plan.toon --threshold 1 > tiebreak-plan.toon
```
If `shouldRun` is true, run `monosashi-judge` once more over `tiebreak-plan.toon` → `passC.toon`; otherwise skip to S4 with A+B.

## S4 — aggregate (tool)

```bash
node scripts/aggregate.mjs --passA passA.toon --passB passB.toon --passC passC.toon --plan plan.toon --evidence evidence.toon --weighting external > scoreboard.toon
```
Use the `--passA/--passB[/--passC]` form (separate files) — never paste a large TOON blob inline (the OS arg-length limit truncates it). Pass **`--plan plan.toon`** so the mechanical `m2Flag` is surfaced, and **`--evidence evidence.toon`** so the passes' `evidenceRefs` resolve into concrete `{path, snippet}` in `mergedScores`. With `passC`, contested criteria become the **median of {A,B,C}**. The scoreboard shows the K-track radar (the real strength), the M/G means, and — critically — the **`m2Flag` with `severity: HIGH`** kept out of the averages. Report the radar, not a single blended number; lead with the M2 divergence.

## Common pitfalls — 誤用例と正例の対比

Each is a real failure mode the tools/flags guard against. ❌ = misuse (what goes wrong), ✅ = the correct invocation.

- **Large data inline → silent truncation.**
  ❌ `aggregate.mjs "$(cat passA.toon)" …` — the OS arg-length limit truncates the blob and you get an **empty/partial scoreboard with no error**.
  ✅ `aggregate.mjs --passA passA.toon --passB passB.toon …` — every stage passes its data **by file path**.
- **Handing `rubric.toon` to the judge → double-read / token waste.**
  ❌ giving `monosashi-judge` the full `rubric.toon` "so it can quote levels".
  ✅ score from `plan.toon` alone — `select-tracks` already **embeds the verbatim `levels[0..4]` + `anchor`** per criterion; `rubric.toon` is the at-rest reference only.
- **Forgetting `--superset` when validating the surveyor's pack.**
  ❌ `validate-evidence.mjs evidence.toon plan.toon --target <dir>` — the surveyor's pack covers **all** criteria while the plan is the applicable **subset**, so the extras are flagged as **hard errors** and the gate fails spuriously.
  ✅ add `--superset` (extras → warning, not error). Omit it only for an exact-coverage check against `full-plan.toon`.
- **Forgetting `--resolve` at S2.6 → judge re-reads the target.**
  ❌ validating the pack without resolving — the judges then have only line ranges and must **reopen the artifact** (defeats the single-read design).
  ✅ `validate-evidence.mjs … --target <dir> --resolve evidence.toon` (safe in place) so ranges become snippets the passes judge from.
- **Forgetting `--plan` on aggregate → M2 disappears.**
  ❌ `aggregate.mjs --passA … --passB …` with no `--plan` — `m2Flag` reads **`"not derived"`** and the declaration↔reality divergence is silently absent.
  ✅ always pass `--plan plan.toon` (and `--evidence evidence.toon` so `mergedScores` carry resolved citations).
- **Branching on output presence → mistaking latency for failure.**
  ❌ "no stdout, so it failed" → retry-spam.
  ✅ branch on the **exit code + the `OK/ERR` line**; a validator that prints nothing but exits `0` with `OK …` **succeeded** (a delayed result is *pending*, not failed).
- **Averaging M2 into the track means → hiding divergence.**
  ❌ folding `m2Flag` into the M-track radar.
  ✅ M2 is **always an independent flag**, never averaged (framework §6).
- **Whole-bundle scoring of a heterogeneous folder → masked per-artifact gaps.**
  ❌ scoring a folder of mixed agents+skills as one unit — one missing test file zeroes S2 for the **whole** cohort.
  ✅ when `inventory.multiArtifact` is true, prefer **per-artifact / cohort** scoring (confirm scope with the user).
