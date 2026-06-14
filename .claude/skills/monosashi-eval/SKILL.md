---
name: monosashi-eval
description: Statically evaluate an AI agent / skill / harness / knowledge-doc artifact bundle against the Monosashi rubric, using LLM-as-judge. Use when asked to "evaluate / score / assess / 評価" a folder containing agents, skills, harnesses, prompts, or docs. Does NOT execute the target; it reads the committed artifacts (code, config, prompts, docs, tests, eval defs) and scores design/documentation evidence. Bundles deterministic tools for inventory, track selection, and aggregation; the subjective 0–4 scoring is done by the judge. Requires Node.js 22+.
license: Apache-2.0
---

# monosashi-eval

Static, evidence-based Monosashi scoring for AI artifacts (agents / skills / harnesses / knowledge-docs). LLM-as-judge reads the **committed artifact bundle** and scores it 0–4 per criterion; **the target is never executed**. Runtime metrics (success rate, latency, cost, real coverage) are explicitly out of scope (framework §1) — committed coverage/eval reports count only as *supporting* evidence. The "never executed" boundary is a capability, not just prose: the reader agents are granted no execution/spawn tool.

This skill bundles the rubric and the **deterministic** parts of the process as tools, so the judge spends its budget on the part that needs judgement: reading evidence and assigning levels.

## Core principle for this evaluation

Per the Monosashi framework, **do NOT collapse the artifact into a single "primary type + sub-component" label.** Instead, judge each capability axis independently and **apply every track that matches** (§5). Declaration-vs-reality divergence is derived **mechanically** as **M2** (`plan.m2`, computed by `select-tracks` from `declaredType` × `axes` — no LLM pass scores it) and always surfaced as an *independent flag*, never averaged away.


## The driver: `mono` (the single entrypoint — use this, not the stages directly)

**Drive the whole evaluation through one tool, `mono`.** It owns the parts that a judge should never spend tokens on — and that weaker models reliably got wrong: discovering the skill dir, minting the `eval-out/<slug>/` run dir and threading a slug through ~14 filenames, the per-stage flag grammars, the `--target` base, branching on `shouldRun`, and **writing each TOON file** (as UTF-8 — *not* via a shell `> file` redirect, which on Windows PowerShell silently emits UTF-16+BOM that the tools then reject). `mono` runs every deterministic stage in order and **stops only where a subagent must judge**, printing exactly what to spawn.

```bash
node <skill-dir>/scripts/mono.mjs init <root> [<root2> …] [--name <slug>] [--out <dir>] [--weighting internal|external] [--autonomy strict|standard|auto]
node <skill-dir>/scripts/mono.mjs next   --run <eval-out/slug>   # advance; stops at each subagent step or DONE (or terminal ABORT if a governor cap is hit)
node <skill-dir>/scripts/mono.mjs status --run <eval-out/slug>   # stage checklist
node <skill-dir>/scripts/mono.mjs cohort --dir eval-out [--md]   # combine per-artifact scoreboards
```

The loop is: **`init` once → run `mono next` → when it prints `SPAWN: <agent>`, spawn that subagent and have it write the listed absolute files → run `next` again → … → `DONE`** (it prints the `scoreboard.html` path + headline). `mono next` is idempotent/resumable (it keys off which stage files exist) and every response echoes the exact next command with absolute paths, so you never construct a path or flag yourself. See *How to run a full evaluation* below; for the pipeline overview and per-stage command reference, see [docs/tools.md](docs/tools.md).

## How to run a full evaluation

**You drive the whole run through `mono` — you never assemble a stage command, a path, a slug, a flag, or an output redirect.** `mono` owns the `eval-out/<slug>/` layout, every filename, the per-stage flags, the deterministic stage sequencing, and **writing each TOON file as UTF-8** (no shell `>` — that is the Windows UTF-16/BOM corruption this design removes). It runs the deterministic stages and stops only where a subagent must judge.

1. **`mono init`** — `node <skill-dir>/scripts/mono.mjs init <root> [<root2> …] [--name <slug>] [--out <dir>] [--weighting internal|external] [--autonomy strict|standard|auto]`. Pass the system's roots (assemble agents + skill + the governance/lifecycle root — see the conductor's *Bundle assembly*). `--weighting`: `external` (outward-facing) vs `internal` (in-house) — ask the user if unclear; it changes the single index. `--autonomy` (default `standard`) sets the **loop governor**'s structural caps — how many `next` invocations / per-stage spawns / no-progress stalls the run may take before a terminal `ABORT` (override individually with `--max-next` / `--max-attempts` / `--max-stalls`; see [reliability.md](../../package-meta/monosashi/reliability.md)). `init` resolves roots to absolute, mints the runId, creates `eval-out/<slug>/`, and prints the `next` command. **You do not need to `cd` anywhere first:** `eval-out/` is anchored to the evaluated system's repo root (the nearest `.git` ancestor of the first root), not the shell's cwd — pass `--out <dir>` to place it elsewhere (e.g. a non-git target).
2. **Loop `mono next`** — run the command `mono` printed (`node <skill-dir>/scripts/mono.mjs next --run <eval-out/slug>`). It advances the deterministic stages (S0 `inventory`+`full-plan`, S1.5 `validate-profile`, S2 `select-tracks`+mechanical `m2`, S2.6 `validate-evidence --resolve`, S3.5 `validate-pass --fix`, S3.2 `second-opinion`, S3.3/S3.6 `contested`, S4 `aggregate`, S4.5 `report --html`) and then prints **one** action:
   - **`SPAWN: <agent>`** — spawn `monosashi-surveyor` (S1, one read → `profile.toon` + `evidence.toon`) or `monosashi-judge` (a scoring pass A/B/C), give it the listed read-only inputs, and have it **write the listed absolute files with its file-create/`Write` tool — never a shell redirect**. Then run `next` again. *(Split-mode S1 alternative: spawn `monosashi-profiler` then `monosashi-gatherer` to produce the same `profile.toon` + `evidence.toon` files `mono` waits on — two reads.)*
   - **`ERR: … / NEXT: …`** — a validator gate (S1.5/S2.6/S3.5) rejected an LLM-produced file; have the named subagent **re-emit** it, then re-run `next`. Fail-closed; never bypass.
   - **`DONE:`** — `mono` prints the `scoreboard.html` path + a one-line headline (M2 flag · weighted index · `needsHumanReview`). Hand the user **that path + headline** and **stop** — don't paste the full markdown.

   The judge scores from the plan's **embedded levels** + the **evidence pack** only (no target re-read; an insufficient pack ⇒ low confidence, not a re-read), citing evidence **by `evidenceRefs` index**. `mono` decides every branch (`shouldRun` for pass B/C, A-only vs A+B+C, N/A-by-rule, M2) — you never read a TOON field to pick a path. `mono next` is idempotent/resumable; `mono status --run <dir>` shows the checklist.
3. **Multi-artifact / cohort** — run the `init` + `next` loop **per unit** into sibling `eval-out/<unit>/` dirs, then `node <skill-dir>/scripts/mono.mjs cohort --dir eval-out --md` for the artifact × track-mean table.

**Run this loop from the main conversation, spawning the judge agents (`monosashi-surveyor`, then `monosashi-judge` for passes A/B/C) directly as subagents** — at depth-1, which is allowed. **Do _not_ delegate the whole orchestration to a `monosashi-conductor` _subagent_:** on Claude Code a subagent cannot spawn subagents (the `Agent` tool is stripped from any agent that is itself a subagent), so the surveyor/judge passes would silently fail and degrade to inline, losing the model tiering. The `monosashi-conductor` agent runs this same `mono`-driven pipeline only as a **primary-agent** entrypoint — launch it with `claude --agent monosashi-conductor` (depth-0), never as a spawned subagent.

## Scoring rules (non-negotiable, §7)

- **Evidence citation is mandatory.** A score must cite at least one `evidenceRefs` index (into the pack) or one inline `{path, snippet}`; a score citing neither must be `confidence: "low"` and must not be raised. Prefer references over re-quoting snippets (the verbatim text lives in the pack).
- **Pack-only scoring (no re-read).** When an evidence pack is provided (validated complete + verbatim at S2.6), the judge scores from plan + pack **without reopening the target**. An insufficient-looking pack caps the score at low confidence (and signals a pack-quality gap) rather than licensing a re-read; reading the bundle is the no-pack fallback only. This bounds each pass's input to plan + pack.
- Quote the **verbatim level definition** (now carried in `plan.criteriaToScore[].levels`) when assigning a level, and apply the per-criterion `anchor` as the tie-break between adjacent levels.
- Mark `N/A` without hesitation when a capability axis is absent for that artifact; N/A is excluded from averages, not penalised.
- Keep temperature low. Run a full pass A, then a **targeted** independent pass B over only the criteria A was not high-confident about (`second-opinion.mjs`), and reconcile — spending the second opinion where pass-to-pass disagreement is actually likely, while high-confidence criteria stand as single (`singlePass`) judgements.

Full reference (shipped in the skill bundle): [docs/tools.md](docs/tools.md) (pipeline overview + stages), [docs/framework.template.md](docs/framework.template.md) (rubric template), [docs/schemas.md](docs/schemas.md) (TOON shapes). **Management & operational rules live in the pack catalog `package-meta/monosashi/`** (repo-level, not shipped inside the skill bundle): [coverage.md](../../package-meta/monosashi/coverage.md) (coverage + evals), [reliability.md](../../package-meta/monosashi/reliability.md) (failure modes), [reproducibility.md](../../package-meta/monosashi/reproducibility.md), [threat-model.md](../../package-meta/monosashi/threat-model.md), and [CHANGELOG.md](../../package-meta/monosashi/CHANGELOG.md) (version/governance).
