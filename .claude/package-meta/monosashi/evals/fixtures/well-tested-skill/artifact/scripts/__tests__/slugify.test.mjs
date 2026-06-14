// Unit tests for slugify — node:test, no external deps. Covers the transform's edge cases so a
// regression in normalisation/collapsing fails loudly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../slugify.mjs";

test("lowercases and hyphenates words", () => {
  assert.equal(slugify("Hello World"), "hello-world");
});

test("strips punctuation", () => {
  assert.equal(slugify("Hello, World!"), "hello-world");
});

test("collapses repeated separators", () => {
  assert.equal(slugify("a   b___c"), "a-b-c");
});

test("trims leading/trailing separators", () => {
  assert.equal(slugify("  --Hello--  "), "hello");
});

test("drops diacritics via NFKD", () => {
  assert.equal(slugify("Café Crème"), "cafe-creme");
});

test("empty input → empty slug", () => {
  assert.equal(slugify(""), "");
});

test("numbers are preserved", () => {
  assert.equal(slugify("Top 10 Tips"), "top-10-tips");
});
