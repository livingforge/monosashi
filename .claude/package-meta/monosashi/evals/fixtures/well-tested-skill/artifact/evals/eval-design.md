# slugify — eval design

How the slugify skill is evaluated. The dataset is `cases.json`; the runner is `run.mjs`.

## Criterion

**Exact-match rate**: fraction of cases where `slugify(input) === expected`. Reported overall
**and per class** (`basic`, `punctuation`, `separators`, `unicode`, `numeric`, `edge`) so a
regression localised to one class (e.g. unicode NFKD folding) is visible, not averaged away.

## Dataset design

`cases.json` is **stratified by class** rather than random: each class targets one transform rule
(separator collapsing, diacritic folding, trim, punctuation strip, empty/degenerate input). New
rules must add a class + ≥2 cases, including the degenerate case (empty / all-punctuation).

## Pass bar

- Overall exact-match **= 100%** (the transform is deterministic; any miss is a real defect).
- No class below 100%.

## Out of scope

Latency and throughput — this is a correctness eval of a pure function, not a performance bench.
