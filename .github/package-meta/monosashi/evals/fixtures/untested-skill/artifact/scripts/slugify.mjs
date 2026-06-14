#!/usr/bin/env node
// Turn a title into a URL-safe slug. Pure string transform; no tests, no eval definition ship
// with this skill (deliberately — this fixture exercises the S2/S3 low band).

export function slugify(title) {
  return String(title)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

const arg = process.argv[2];
if (arg === undefined) {
  console.error("usage: slugify.mjs <title>");
  process.exit(2);
}
process.stdout.write(slugify(arg));
