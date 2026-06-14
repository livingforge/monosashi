---
name: agent-guard
description: A cross-cutting harness that wraps other agents. It applies a common evaluation suite across a set of target agents, enforces a layered defence based on a documented threat model, and supplies correlation-id + audit logging to every wrapped run.
license: Apache-2.0
---

# agent-guard

A **harness**: it does not do a task itself — it **wraps other agents** and applies evaluation,
guardrails, and observability across all of them uniformly. See `harness.mjs` and `threat-model.md`.

## Evaluation coverage (H1)

`harness.mjs` applies one **common check suite** to every target agent in a registry, organised
**by dimension** (correctness / safety / format-adherence) so per-dimension coverage is traceable.
The dimension list + which agents are covered is the coverage surface.

## Layered defence / threat model (H2)

`threat-model.md` enumerates the threats (prompt injection, scope escape, privilege escalation).
The harness defends in **multiple layers** keyed to that model — an input sanitiser, an action
allowlist, and an output policy filter — each annotated with the threat it addresses.

## Observability basis (H3)

The harness injects a **correlation id** into every wrapped run and emits a structured **audit
log** (which agent, which check, outcome) — a cross-cutting observability substrate the wrapped
agents inherit rather than each implementing their own.
