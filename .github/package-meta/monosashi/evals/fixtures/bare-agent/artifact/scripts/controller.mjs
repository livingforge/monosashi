#!/usr/bin/env node
// Deploy-agent control loop. Runs the stages in order. (Deliberately bare: no input validation,
// no permission allowlist, secrets inline, no approval gate, no structured logging — this fixture
// exercises the LOW end of the A2/A3/A4/A5 bands against guarded-agent.)

const DEPLOY_TOKEN = "sk-live-9f3a2b7c1d4e"; // hard-coded credential, runs against any target

export async function run(plan, { doStage } = {}) {
  for (const stage of plan.stages) {
    // no validation, no approval, no allowlist — just do it
    await doStage(stage, plan.target, DEPLOY_TOKEN);
    console.log(stage + " done"); // bare console print, no correlation id / structure
  }
  console.log("all done");
}

const target = process.argv[2] ?? "production";
run({ target, stages: ["build", "stage", "release"] }, { doStage: async (s) => s });
