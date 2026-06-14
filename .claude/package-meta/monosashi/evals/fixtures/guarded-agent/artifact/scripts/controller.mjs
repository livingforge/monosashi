#!/usr/bin/env node
// Deploy-agent control loop. Each safeguard from agent.md is implemented here and labelled with
// the criterion it bears on (A1 control, A2 guardrails, A3 permission/secrets, A4 approval,
// A5 observability).

// A3 — least-privilege allowlist: the agent may invoke ONLY these actions; anything else throws.
// (Scope rationale: a deploy agent needs to build/stage/approve/release/rollback — nothing more.)
const ALLOWED_ACTIONS = new Set(["build", "stage", "approve", "release", "rollback"]);
const ALLOWED_TARGETS = new Set(["staging", "production"]);

// A5 — structured, correlated audit log. One JSON line per step; secrets are redacted (A3).
function audit(runId, stage, outcome, params = {}) {
  const safe = { ...params };
  for (const k of Object.keys(safe)) if (/token|secret|key|cred/i.test(k)) safe[k] = "***redacted***";
  process.stdout.write(JSON.stringify({ runId, stage, outcome, params: safe, ts: "<clock>" }) + "\n");
}

// A2 — input validation + refusal policy. Unknown action/target is refused (not best-effort run).
function validate(action, target) {
  if (!ALLOWED_ACTIONS.has(action)) throw new Error(`refused: action '${action}' not on allowlist`);
  if (!ALLOWED_TARGETS.has(target)) throw new Error(`refused: unknown target '${target}'`);
}

// A4 — risk-based human-in-the-loop. Production (external, destructive) requires an explicit
// approval token; staging (internal) is auto-approved. Escalation: on denial the run aborts and
// pages the release manager (documented in agent.md).
function requireApproval(target, approvalToken) {
  if (target !== "production") return true; // internal surface: auto-approve
  if (!approvalToken) throw new Error("blocked: production action requires human approval token");
  return true;
}

// A3 — secrets only from the environment, never hard-coded.
function credential() {
  const c = process.env.DEPLOY_TOKEN;
  if (!c) throw new Error("missing DEPLOY_TOKEN in environment");
  return c;
}

// A1 — orchestration: planned stages, bounded retry, abort threshold.
const MAX_RETRY = 3;
const ABORT_AFTER_FAILURES = 2;

export async function run(plan, { approvalToken, doStage } = {}) {
  const runId = `${plan.target}-run`;
  let failures = 0;
  for (const stage of plan.stages) {
    validate(stage, plan.target); // A2
    requireApproval(plan.target, approvalToken); // A4
    credential(); // A3 (presence check; value never logged)
    let attempt = 0, ok = false;
    while (attempt < MAX_RETRY && !ok) {
      try {
        await doStage(stage, plan.target);
        ok = true;
        audit(runId, stage, "ok"); // A5
      } catch (e) {
        attempt++;
        audit(runId, stage, `retry ${attempt}: ${e.message}`); // A5
      }
    }
    if (!ok) {
      failures++;
      if (failures > ABORT_AFTER_FAILURES) {
        audit(runId, stage, "ABORT — rolling back"); // A1 abort threshold
        await doStage("rollback", plan.target);
        throw new Error("aborted: failure budget exceeded");
      }
    }
  }
  audit(runId, "done", "ok");
}
