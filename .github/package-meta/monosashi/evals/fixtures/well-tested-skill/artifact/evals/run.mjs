#!/usr/bin/env node
// Eval runner: score slugify against cases.json by exact-match rate, overall and per class
// (eval-design.md). Exit non-zero if any case misses, so it gates in CI.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { slugify } from "../scripts/slugify.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { cases } = JSON.parse(readFileSync(join(here, "cases.json"), "utf8"));

const byClass = {};
let misses = 0;
for (const c of cases) {
  const got = slugify(c.input);
  const ok = got === c.expected;
  byClass[c.class] ??= { n: 0, hit: 0 };
  byClass[c.class].n++;
  if (ok) byClass[c.class].hit++;
  else {
    misses++;
    console.error(`MISS [${c.class}] ${JSON.stringify(c.input)} → ${JSON.stringify(got)} (expected ${JSON.stringify(c.expected)})`);
  }
}
for (const [cls, s] of Object.entries(byClass)) console.log(`${cls}: ${s.hit}/${s.n}`);
console.log(`overall: ${cases.length - misses}/${cases.length}`);
process.exit(misses === 0 ? 0 : 1);
