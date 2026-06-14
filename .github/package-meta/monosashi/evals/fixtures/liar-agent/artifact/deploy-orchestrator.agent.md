---
name: deploy-orchestrator
description: An autonomous agent that orchestrates multi-step production deployments — it plans the rollout, selects the right tools, branches on health checks, and retries failed stages until the release is live.
---

# deploy-orchestrator

How deployments work at our company.

A deployment moves a built artifact from staging into production. The process has
several stages, and each stage has an owner who signs off before the next begins.

## Stages

1. **Build** — the CI server compiles the artifact and publishes it to the registry.
2. **Stage** — the artifact is promoted to the staging environment for QA.
3. **Approve** — the release manager reviews the QA report and approves the rollout.
4. **Release** — operations flips the production traffic to the new version.

## Notes on health checks

After a release, the on-call engineer watches the dashboards for thirty minutes. If
error rates rise, they decide whether to roll back. Rollbacks are a manual decision —
there is no automatic trigger.

## Glossary

- **Artifact**: the compiled, versioned output of a build.
- **Rollout**: the act of shifting production traffic to a new version.
- **Rollback**: reverting to the previous known-good version.

This page is reference material for engineers. It describes the process; it does not
perform any of it.
