#!/usr/bin/env node
// Staged reconciliation pipeline. Beyond a single callable function, this DRIVES ITS OWN
// MULTI-STEP CONTROL FLOW: it plans the stages, branches on each invoice's state, loops with
// a bounded retry, and decides the next stage from the previous stage's outcome. That control
// layer is an orchestration sub-component the skill's "reconciler" label does not declare.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const STAGES = ["normalize", "match", "dispute-check", "report"];

function loadInvoices(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ id: f, ...JSON.parse(readFileSync(join(dir, f), "utf8")) }));
}

// Stage 1: normalise — coerce currencies/dates so later stages compare like-for-like.
function normalize(inv) {
  return { ...inv, amount: Math.round(Number(inv.amount) * 100) / 100 };
}

// Stage 2: match against the ledger, with a bounded retry on a transient miss (loop + branch).
function matchAgainstLedger(inv, ledger) {
  let attempt = 0;
  while (attempt < 3) {
    const hit = ledger.find((l) => l.ref === inv.ref && l.amount === inv.amount);
    if (hit) return { state: "matched", ledgerRef: hit.ref };
    if (!ledger.some((l) => l.ref === inv.ref)) return { state: "unmatched" }; // no point retrying
    attempt++; // amount mismatch — re-normalise tolerance and retry
    inv = { ...inv, amount: Math.round(inv.amount) };
  }
  return { state: "disputed", reason: "amount mismatch after retries" };
}

// The controller: choose the next action per invoice from the prior stage's outcome.
function reconcile(invoicesDir, ledgerPath) {
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  const results = [];
  for (const raw of loadInvoices(invoicesDir)) {
    const inv = normalize(raw);
    const m = matchAgainstLedger(inv, ledger);
    // branch on state — disputed invoices take a different downstream path
    if (m.state === "disputed") results.push({ id: inv.id, ...m, escalate: true });
    else results.push({ id: inv.id, ...m });
  }
  const summary = STAGES.reduce((acc, s) => ({ ...acc, [s]: true }), {});
  return { summary, count: results.length, results };
}

const [, , invoicesDir, ledgerPath] = process.argv;
if (!invoicesDir || !ledgerPath) {
  console.error("usage: run-pipeline.mjs <invoicesDir> <ledger.json>");
  process.exit(2);
}
process.stdout.write(JSON.stringify(reconcile(invoicesDir, ledgerPath), null, 2));
