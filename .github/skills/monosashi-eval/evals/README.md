# monosashi-eval — eval definitions

The skill's own **eval definitions** (S3 評価基準・データの定義). These are *definitions*, not
results: per [framework §1](../docs/framework.md#測定対象外別系統で補完), committed eval **results**
are reproducible-but-stale supporting evidence and are deliberately **not** shipped — but the eval
**design** (what is tested + the pass criteria) is the primary evidence, so it ships here with the
skill. monosashi-eval thus carries its own eval definition, the way a high-S3 skill should.

## Files

- **`eval_queries.json`** — **activation** eval. Queries that should trigger the skill (its
  `description` routing) and queries that should not. Tests skill discoverability — a skill with a
  weak description never fires. Guards the SKILL.md `description` (relates to K1 consumability,
  S1 interface clarity).

  The repo runner scores it with a **router proxy** — a one-shot classifier (`claude -p`, no agent)
  given the description + queries, deciding each in-scope/out-of-scope:

  ```bash
  npm run eval:queries             # == node evals/run-eval.mjs --queries
  ```

  *Proxy caveat:* this tests whether each query falls within the **description's stated scope** — a
  necessary condition for routing, but not the full multi-skill decision (the real router weighs
  every installed skill). It catches a too-narrow / too-broad / ambiguous description, which is the
  point of guarding `description`. The model is configurable via `MONOSASHI_EVAL_QUERY_MODEL`
  (default `haiku` — the classification is cheap).
- **`evals.json`** — **end-to-end behavioural** eval. Each case = an input request + assertions the
  produced **scoreboard** must satisfy (M2 flag, criterion bands, applied tracks, N/A-by-rule,
  §7 discipline). Black-box over the final output.

## Relationship to the rest of the repo

| Layer | Where | What it pins |
|---|---|---|
| Deterministic spine | `scripts/__tests__/` (shipped) | tools — exact, LLM-free (`npm test`) |
| Judge-layer fixtures (white-box) | repo `evals/fixtures/<name>/expected.toon` (not shipped) | per-stage: profile axes, plan/M2, evidence recall, score **bands**, discipline |
| Skill eval definitions (black-box) | **here** (shipped) | activation queries; end-to-end scoreboard assertions |

`evals.json` cases reuse the same fixtures (`evals/fixtures/<name>/artifact`) as the dataset — the
canonical inputs live in the repo; this file is the portable, harness-agnostic statement of the
inputs + pass criteria.

The repo runner consumes it (the runner is repo-only — it spawns `claude` and costs money — so it
is **not** bundled, only this definition is):

```bash
npm run eval:e2e                 # all cases (== node evals/run-eval.mjs --evals)
npm run eval:e2e -- liar-agent   # one case by fixture or name
```

The runner runs each case's fixture through the pipeline and asserts via the shared
`src/eval-assert.ts` (`assertEvalCase`) — the same `criterionBand` / `discipline` primitives that
score the white-box fixtures, plus `scoreboardPath` / `appliedTrack` / `naByRule`. Cases asserting
only M2 / track / N/A skip the judge (cheap profile+plan path); only `criterionBand` / `discipline`
cases run the surveyor → judge → aggregate.
