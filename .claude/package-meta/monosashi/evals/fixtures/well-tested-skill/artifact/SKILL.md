---
name: slugify
description: A skill that turns a title string into a URL-safe slug. Deterministic string tool, with a unit-test suite and a committed eval set.
license: Apache-2.0
---

# slugify

A small reusable skill: give it a title, get back a lowercase, hyphenated, URL-safe slug.

## Interface

```bash
node scripts/slugify.mjs "Hello, World!"   # -> hello-world
```

Input: one string argument. Output: the slug on stdout.

## Quality

- **Unit tests** (`scripts/__tests__/slugify.test.mjs`, `npm test`) pin the transform incl. edge
  cases: unicode, punctuation, collapsing separators, leading/trailing hyphens, empty input.
- **Eval set** (`evals/`): `cases.json` is the labelled input→expected dataset; `eval-design.md`
  documents the scoring criterion (exact-match rate, with a per-class breakdown) and the pass bar.
