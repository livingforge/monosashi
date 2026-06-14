---
name: deploy-agent
description: An autonomous deployment agent. It plans a rollout, runs it stage by stage with bounded retries and an abort threshold, gates destructive (production) actions behind explicit human approval, scopes itself to a least-privilege action allowlist with secrets read only from the environment, and emits a structured, correlated audit log.
---

# deploy-agent

An autonomous agent that drives a staged production rollout. See `scripts/controller.mjs` for
the control loop; this file documents the safeguards and the rationale behind each.

## Control (A1)

The controller plans the stage list, then runs each stage in a loop with a **bounded retry**
(max 3 attempts) and an **abort threshold** — if cumulative failures exceed the budget the run
is halted and rolled back rather than pushed forward. Stop conditions are explicit.

## Guardrails — input validation, output filtering, refusal (A2)

Every stage input is validated against an allowed-target schema; unknown targets are **refused**.
Outputs are redacted before logging. Control is **differentiated by surface**: actions on the
**external** production environment get strict validation + redaction + approval, while **internal**
staging actions run with lighter checks — the rationale is documented inline at each gate.

## Permission scope & secrets (A3)

The agent may only invoke actions on a **least-privilege allowlist** (`ALLOWED_ACTIONS`); anything
else throws. Credentials are read **only from environment variables** (never hard-coded) and are
**redacted** in every log line. The scope rationale (why each action is on the list) is commented.

## Human-in-the-loop (A4)

Destructive / production actions are gated behind an **explicit approval token**; the gate's
strength is **risk-based** — production requires human approval, staging is auto-approved. The
policy and its escalation path (who approves, what happens on denial) are documented here.

## Observability (A5)

Every step emits a **structured JSON log** carrying a run **correlation id**, the stage, the
outcome, and a redacted parameter set — an **audit trail** that reconstructs the whole run.
