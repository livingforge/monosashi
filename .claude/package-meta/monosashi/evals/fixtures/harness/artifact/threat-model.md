# agent-guard — threat model

The threats the harness defends against, and the layer that addresses each. The defence is
**layered**: a request must clear all applicable layers, so one bypass does not defeat the guard.

| Threat | Layer | Mechanism (harness.mjs) |
|---|---|---|
| **Prompt injection** ("ignore previous instructions") | 1 — input sanitiser | `sanitiseInput` neutralises override phrases before the agent sees them |
| **Scope escape** (agent invokes an unintended action) | 2 — action allowlist | `ALLOWLIST` rejects any action outside read/summarise/classify |
| **Privilege escalation / secret leak** | 3 — output policy filter | `outputPolicy` redacts credential-shaped tokens from output |

## Coverage & update policy

Each layer maps to a row above; adding a threat requires adding a layer **and** a row here. The
check suite (`CHECK_SUITE`) is the regression set — a new failure class becomes a new dimension.
Reviewed each release; see the registry for which agents are currently wrapped.
