---
name: slugify
description: A skill that turns a title string into a URL-safe slug. Deterministic string tool.
license: Apache-2.0
---

# slugify

A small reusable skill: give it a title, get back a lowercase, hyphenated, URL-safe slug.

## Interface

```bash
node scripts/slugify.mjs "Hello, World!"   # -> hello-world
```

Input: one string argument. Output: the slug on stdout. Exit 0 always.
