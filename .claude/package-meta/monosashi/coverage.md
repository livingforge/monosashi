# monosashi-eval — evaluation coverage & regression policy

What this harness evaluates, what it deliberately does **not**, how the **regression set** guards the parts that can be pinned, and when to extend coverage.

Per [evidence ≠ context](../../skills/monosashi-eval/docs/framework.md#証拠--実行時コンテキストevidence--context), this is reference evidence in the pack catalog (`package-meta/`), not runtime prompt.

## Coverage range — what is scored

Static, evidence-based 0–4 scoring across **6 tracks / 23 criteria** (per the rubric — see [framework.md](../../skills/monosashi-eval/docs/framework.md)):

| Track | Criteria | Covers |
|---|---|---|
| **M** メタ整合 | M1, **M2** | self-identification; declaration↔reality (M2 is **mechanical**, `plan.m2`) |
| **G** 共通 | G1–G5 | interface contract, robustness, governance, docs, reproducibility |
| **A** エージェント | A1–A5 | orchestration, guardrails, permission scope, human-in-loop, observability |
| **S** スキル | S1–S3 | encapsulation, test design, eval definition |
| **H** ハーネス | H1–H3 | evaluation-coverage design, layered defence/threat model, observability/audit基盤 |
| **K** 知識/doc | K1–K5 | agent-consumability, surface coverage, example correctness, version freshness, machine-readable structure |

Applicability is mechanical (`select-tracks`, framework §5): only matching tracks score; rule-based N/A (e.g. **G2** when `hasCodePath=false`) is excluded, not penalised. A single index is a **weighted** view (`internal`/`external` posture); the primary signal is the per-track + per-domain **radar**. **M2 is always an independent flag**, never averaged in.

**Observation points** the harness supplies: a run correlation `runId` on every deterministic artifact, a provenance envelope (`producedBy`/`toolVersion`/`producedAt`/`inputs`), and an **audit trail** (per-criterion: which passes judged it, by what reconciliation method, on what evidence — artifact shape in [schemas.md](../../skills/monosashi-eval/docs/schemas.md) §Run provenance).

## Out of coverage (by design)

- **Runtime behaviour**: success/failure rate, latency, cost, real coverage %, actual test pass/fail, live hallucination/safety rates (framework §1 測定対象外). Committed coverage/eval reports count only as *supporting* evidence.
- **Shadow artifacts** not present in the S0 inventory — coverage is only as complete as the bundle handed in.
- **Actual runtime autonomy** — track membership is a static estimate from code/prompt structure, not observed control flow.
- **Cross-artifact system behaviour** beyond each artifact's own files (cohort mode aggregates per-artifact scores; it does not model their interaction).

## Regression set — what is pinned, and how the non-deterministic layer is guarded

The **deterministic spine** is pinned by the unit + regression suites (`src/__tests__/`, shipped to `scripts/__tests__/`, run by `npm test`). The regression set (`regression.test.ts`) holds **hard / tricky cases** end-to-end:

- **Coverage invariant**: the exact track set + per-track criteria counts (23 total) — a silently dropped criterion fails the suite.
- **M2 hard cases**: a "liar" agent (declared agent, orchestration absent → M2=0 HIGH), an undeclared sub-component (→ M2=2 LOW), an ambiguous type (→ M2=1), a faithful composite (→ M2 ≤ as-derived).
- **Track applicability + N/A**: composite multi-axis artifacts; G2 N/A toggling on `hasCodePath`.
- **Reconciliation hard cases**: high A/B disagreement → `needsHumanReview`; A/B/C tie-break → **median**; N/A passthrough; one-sided N/A divergence; single-pass (B-skipped) criteria.
- **Audit trail**: method (`mean(A,B)` / `median(A,B,C)` / `single (A)` / `N/A passthrough`), per-pass judgements, review flag, M2 excluded.

**Doc↔code consistency is itself pinned (差分検出).** `doc-tools-conformance.test.mjs` ships *inside the bundle* and asserts every `scripts/<tool>.mjs` named in [tools.md](../../skills/monosashi-eval/docs/tools.md) is actually present, so renaming or dropping a deterministic stage without updating the reference doc fails the suite rather than letting the documentation drift from the code. The cross-tree half — the agent roster and per-agent model tier in `SKILL.md` ⇄ each agent manifest — is the source-only `doc-conformance.test.ts` (it reads `skill-src/agents/`, so it runs in the repo build, not the shipped bundle). Together they give a mechanical doc↔code consistency guard (差分検出); separately, `self-conformance.test.ts` checks the least-privilege tool grants against each agent's self-description. (Both are the kind of evidence G4 and M1 look at — the level is for the judge to assign, not for this doc to claim.)

The **LLM scoring layer is not deterministic**, so the deterministic suite above cannot pin the judge's scores by exact match. It is guarded on two fronts instead. *Runtime guards* bound variance and reject malformed output — output-variance **normalisation** (`normalize`), three **schema validators** (profile / evidence / pass), **two/three-pass reconciliation** with confidence, and mandatory evidence citation (framework §7); the deterministic regression set above guards everything *downstream* of the judge so a judge's drift cannot silently corrupt aggregation. *Behavioural regression* — a band-based golden set (next section) — checks the judge's actual scores against per-criterion tolerance ranges rather than exact values.

## Eval definitions (evals/)

Alongside the unit + regression suite, the skill ships its own **eval definitions** (`evals/`) that
pin the LLM-layer contract — the non-deterministic part the regression fixtures cannot reach:

- **Activation eval** — guards the `description` field: asserts the skill is triggered by the right
  classes of user request and *not* triggered by unrelated ones. If the description drifts, the eval
  catches mis-activation before a user does.
- **End-to-end behavioural eval** — runs the full pipeline over a reference bundle and asserts
  structural/policy invariants of the produced scoreboard: M2 flag present, `needsHumanReview` items
  surfaced, no silent N/A collapse, evidence citations present. It does not fix numeric scores (those
  are LLM-judged and vary), only the invariants.

Eval-def schemas and authoring conventions: `evals/README.md`.

## Behavioural-eval golden set (`evals/fixtures/`)

Distinct from both the deterministic suite (`src/__tests__/`) and the eval definitions above (`eval_queries.json` / `evals.json`), a **golden-fixture set** under `evals/fixtures/` exercises the LLM-judge layer the deterministic suite cannot reach. Each fixture pairs a small artifact bundle with an `expected.toon` oracle; `evals/run-eval.mjs` spawns the live profiler / surveyor / judge over it and, per the measurement principles in the sibling [`evals/CATALOG.md`](./evals/CATALOG.md), checks:

- **profiler → select-tracks** — the capability axes, `declaredType`, and the derived `plan` (`appliedTracks` / `naByRule` / `m2`) match expectation (deterministic once the profile is fixed);
- **judge** — each pinned criterion's reconciled score lies within a **tolerance band** (`[min..max]`, absorbing the ±1 of legitimate judge variance), not an exact value;
- **discipline (§7)** — no judge pass emits M2, an uncited score is `confidence:low`, and a scoring-injection fixture does not raise any score.

It spawns live agents, so it is non-deterministic and runs under `npm run eval`, separate from the deterministic `npm test`. The set and its `CATALOG.md` index are emitted into this catalog at `package-meta/monosashi/evals/` as reference evidence; the runner ships **neutralised** (commented out) and the scoring-injection fixture's live payload is **kept repo-only** (its slot in the distributed pack holds an `OMITTED.md` note) — see [threat-model.md](./threat-model.md) T11.

## Update triggers (更新方針)

Add or update a regression case when you:

- **fix a bug** in any deterministic tool → add the failing case as a fixture first (red), then fix (green);
- **add/change a criterion, track, level, or weight** → update the coverage invariant + add a hard case exercising it, and follow the rubric-version trigger in the pack catalog `package-meta/monosashi/CHANGELOG.md`;
- **change a reconciliation / M2 / N/A rule** → add the boundary case that distinguishes old from new behaviour;
- **add an observation point** (provenance/audit field) → assert it is stamped.

Rule of thumb: **every behaviour this doc claims is covered must have a test that fails if it regresses.** A claim here without a guarding test is a coverage gap — close it or delete the claim.
