# Reliability — failure modes, degradation & recovery

How the deterministic toolchain behaves when something goes wrong: what each failure mode *is*,
how the tool **degrades** instead of crashing, which failures are **recoverable** (and how), and
which are **terminal** (and what the operator must do). This is the reliability contract behind
the `OK`/`ERR` two-channel convention described in [SKILL.md](../../skills/monosashi-eval/SKILL.md) and
[framework.md](../../skills/monosashi-eval/docs/framework.md) §3.

The governing stance is **fail-closed**: a stage either produces a schema-valid artifact and exits
`0`, or it produces **no artifact**, prints one `ERR <tool>: <reason>` line, and exits non-zero.
A partial or ambiguous result is never emitted — the pipeline halts at the first failing gate
rather than scoring on bad data.

## Why the run is driven through `mono` (the hand-assembly failure class it removes)

Before `mono`, the orchestrator assembled every stage command by hand: it discovered the skill dir,
minted a slug and threaded it through ~14 filenames, built per-stage flag grammars, picked the right
`--target`, branched on `shouldRun` read out of a TOON file, and **redirected each tool's stdout to a
file with a shell `> file`**. That last step is the dangerous one: on Windows PowerShell a `>` redirect
writes **UTF-16 + BOM**, which the UTF-8-only tools then reject — a silent, shell-dependent TOON
corruption. Each of those steps was a place a weaker model could break the run. `mono` removes the
whole class: it self-resolves the skill dir, owns the `eval-out/<slug>/` layout and every filename and
flag, **writes each TOON file itself as UTF-8 (no shell redirect anywhere)**, runs the deterministic
stages in order, and stops only where a subagent must judge — so the orchestrator never constructs a
path, a flag, a slug, or a redirect.

## Input validation & exception handling on the main path

Every producer/validator entry point runs under `runCli(tool, main)` ([`cli.ts`](../../../src/cli.ts)):
any throw on the main path — malformed TOON (`ToonDecodeError`), a missing/unreadable input file
(`ENOENT`), a bad CLI shape — is caught and re-emitted as a single `ERR <tool>: <reason>` line +
exit `1`, **never a raw multi-line stack trace**. File reads go through `readToonFile(path)`
([`serde.ts`](../../../src/serde.ts)), which attributes the failure to the offending artifact,
e.g.:

```
ERR validate-evidence: malformed TOON in evidence.toon: Line 5: Expected 3 tabular row values, but got 6
```

so "no stdout" always means a clean `OK`/`ERR`, and a failure points straight at the file to fix.
The LLM-produced artifacts (profile / evidence pack / passes) are additionally schema-checked by
the three validator gates (S1.5 / S2.6 / S3.5) before any consumer reads them.

## Failure-mode table

| Failure mode | Where it surfaces | Handling | Recoverable? |
|---|---|---|---|
| Malformed TOON (bad indent, wrong tabular arity, e.g. an unescaped comma in a `note`) | any tool reading `.toon` | `runCli` → `ERR <tool>: malformed TOON in <path>: <cause>`, exit 1; no output written | **Yes** — fix/re-emit the named file and re-run the stage |
| Missing / unreadable input file | any tool | `ERR <tool>: cannot read <path>: <cause>`, exit 1 | **Yes** — supply the file and re-run |
| Unreadable directory during inventory walk | `inventory` | the entry is **skipped** (the `walk` generator returns on `readdirSync` failure) and enumeration continues — graceful degradation, not a crash | **Yes** — partial inventory is still valid; fix permissions to include the dir |
| Cosmetic LLM output drift (`"Present"` vs `present`, `"3"` vs `3`, `"N/A"`/`na`, `"High"`) | profiles, passes, packs | `normalize.mjs` canonicalises **before** any consumer; each change logged as a `normalised <path>: <from> → <to>` warning | **Yes**, automatically |
| Uninterpretable value (score `"five"`, out-of-range `7`, illegal axis) | normalize → validator | left **raw** (never silently clamped) so the validator gate **fails loudly** | **Yes** — re-emit the artifact; the gate names the field |
| Evidence-less score | `validate-pass --fix` | the score is forced to `confidence:"low"` (§7) and **not** raised; flagged | **Yes**, automatically (degraded confidence, not a hard stop) |
| Incomplete evidence pack (a `plan` criterion uncovered) | `validate-evidence` (S2.6) | **hard error**, exit 1 — pack must cover every criterion | **Yes** — surveyor re-emits the missing criterion |
| Out-of-range / over-wide line ref | `validate-evidence` | warning; `--resolve` auto-tightens an over-wide span to `MAX_SPAN` lines | **Yes**, automatically |
| Schema-invalid profile (illegal axis, non-boolean `hasCodePath`) | `validate-profile` (S1.5) | hard error, exit 1 — a typo'd axis would skew track selection **and** M2 | **Yes** — re-emit the profile |
| Oversized inline argument (large TOON passed as a CLI arg) | OS `argv` limit | **terminal for that invocation** — the OS truncates `argv` silently | **Mitigated by design**: always pass large TOON via **files**, never inline (see `aggregate` S4 note) |
| Judge/surveyor disagreement (high variance) | `aggregate` | surfaced as `needsHumanReview` (range ≥2 across passes) — **never averaged away** | **Escalation**, not an error — a human resolves it |
| Runaway loop (an artifact never gets produced, or a gate/spawn spins) | `mono next` loop governor | **terminal `ABORT`, exit 1** — once `nextInvocations`, per-stage spawn count, or consecutive no-progress `stalls` exceed the autonomy caps, `mono` refuses to advance/spawn | **No, by design** — needs human review or a fresh `init` with a higher `--autonomy` / `--max-*` |

## Degradation, retry & idempotency (design)

- **Degradation.** A failure narrows scope rather than corrupting output: a bad input fails its
  own stage closed (no artifact), an unreadable directory is skipped, cosmetic drift is absorbed,
  an evidence-less score is demoted to low confidence. The radar excludes `N/A` rather than
  penalising it; an insufficient evidence pack **caps** a score at low confidence rather than
  licensing a target re-read.
- **Idempotency.** Re-running any stage on the same inputs is safe and overwrites in place — the
  in-place rewrites (`validate-evidence --resolve evidence.toon`, `validate-pass --fix passA.toon`)
  are designed to be repeatable, and the producers are pure functions of their input. Given a
  pinned `--run-id`, a re-run is **byte-stable** except the provenance `producedAt` timestamp (a
  retry therefore costs nothing and cannot diverge — see [reproducibility.md](./reproducibility.md)).
- **Retry guidance.** Failures here are deterministic, not transient: the toolchain makes **no
  network calls and spawns no subprocesses**, so blindly re-running an identical failing command
  reproduces the identical failure. The recovery action is to **fix the named artifact** (or have
  the agent re-emit it), then re-run — not to retry-spam. A delayed or empty tool result is
  *pending*, not failed; branch on the **exit code + the `OK`/`ERR` line**, never on silence.

## Loop governor — structural runaway prevention

`mono next` is the **only** way the pipeline advances or spawns a subagent, so the loop is bounded
**there, in code** — not by a prose "don't retry-spam" rule the orchestrator could ignore. The run
manifest carries a `governor` (counters) and `caps` (ceilings); every `next` increments the
invocation count and a no-progress `stalls` counter (the set of stage files is unchanged since the
last call), every `spawn` increments a per-stage attempt count, and the pure `governorCheck` halts
the run with a terminal `ABORT` (exit 1) the moment any ceiling is exceeded. Because `mono` then
refuses to print a `SPAWN`/advance, a rule-ignoring orchestrator **cannot** loop past the cap —
the bound is mechanical. (The cap logic is `governorCheck` in `mono.ts`, pinned by
`scripts/__tests__/mono-governor.test.mjs`.)

The bound is an **external parameter**, set at `init` and recorded in the manifest:

| `--autonomy` | `maxNext` | `maxAttemptsPerStage` | `maxStalls` |
|---|---|---|---|
| `strict` | 15 | 1 | 1 |
| `standard` (default) | 40 | 3 | 3 |
| `auto` | 80 | 6 | 5 |

Individual ceilings override the preset: `--max-next N`, `--max-attempts N`, `--max-stalls N`. A
normal run spends ~5–6 `next` invocations and spawns each stage once, so even `strict` clears the
happy path with headroom; the caps only bite on a genuine runaway. An `ABORT` is distinct from a
gate `ERR/NEXT` (a recoverable re-emit): re-running `next` will **not** advance it — the run needs
human review, or a fresh `init` with a higher autonomy / raised ceiling.

## Terminal (unrecoverable-within-the-run) cases

These cannot be auto-repaired; the run **stops** and the operator acts:

1. **A hard validator error that `--fix` cannot normalise** (missing/extra criteria, a score that
   is neither `0–4` nor `N/A`): the producing agent must **re-emit** that artifact. The pipeline
   does not proceed to aggregation on a structurally invalid pass.
2. **A profile whose axes are internally inconsistent with the inventory** (e.g. `hasCodePath`
   contradicting the file signals): re-run S1; do not hand it to `select-tracks`, since it drives
   both track selection and the mechanical M2.
3. **Truncated inline TOON** (argv limit): re-invoke passing the data **by file**. The truncation
   is silent at the OS layer, so the rule is preventative — the tools document file-based input
   for every large artifact.

In all three, the correct outcome is a **halted run with a clear `ERR` line**, not a scoreboard
built on incomplete data — exactly what "fail-closed" buys.
