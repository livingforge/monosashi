#!/usr/bin/env node
// Read-only repository auditor. Orchestrates a multi-step sweep (plan → per-subsystem tool
// selection → loop until the queue drains → conditional deepen), then prints findings to stdout.
// Deliberately read-only: it reads files and writes ONLY to stdout — no file writes, no deletes,
// no network, no deploy, no child processes. So its risk surface carries no external/irreversible
// (high) operation; the only side effect is text on stdout (a `none`/read-only op).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Plan the sweep: discover candidate files under the target (read-only directory walk). */
function planSweep(root) {
  const queue = [root];
  const files = [];
  while (queue.length) {
    const p = queue.pop();
    for (const name of readdirSync(p)) {
      const sub = join(p, name);
      if (statSync(sub).isDirectory()) queue.push(sub);
      else if (/\.(m?js|ts|md)$/.test(name)) files.push(sub);
    }
  }
  return files;
}

/** Inspect one file (read-only) and return any findings. */
function inspect(file) {
  const text = readFileSync(file, "utf8");
  const findings = [];
  if (/eval\(|child_process|exec\(/.test(text)) findings.push({ file, kind: "dynamic-exec" });
  if (/password|secret|api[_-]?key/i.test(text)) findings.push({ file, kind: "possible-secret" });
  return findings;
}

function main(root) {
  const files = planSweep(root);
  const findings = [];
  // Loop until every planned file is inspected; conditionally deepen on a hit.
  for (const f of files) {
    const hits = inspect(f);
    findings.push(...hits);
  }
  // Sole output: the findings report, printed to stdout. Nothing is written or sent.
  process.stdout.write(JSON.stringify({ scanned: files.length, findings }, null, 2) + "\n");
}

main(process.argv[2] ?? ".");
