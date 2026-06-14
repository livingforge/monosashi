---
name: invoice-reconciler
description: A skill that reconciles a batch of invoices against ledger entries. Call it with a folder of invoices; it returns a reconciliation report. Bundles a deterministic matching tool.
license: Apache-2.0
---

# invoice-reconciler

A reusable skill: hand it a directory of invoice JSON files and a ledger export, and it
returns a reconciliation report (matched / unmatched / disputed). The matching logic ships
as a tool so the result is deterministic.

## Interface

```bash
node scripts/run-pipeline.mjs <invoicesDir> <ledger.json> > report.json
```

Input: a folder of `*.json` invoices + a ledger export. Output: a `report.json` with one
entry per invoice and a summary. Exit 0 on success, non-zero on a malformed input.

See `scripts/run-pipeline.mjs` for the staged matching pipeline.
