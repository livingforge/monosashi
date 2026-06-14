import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from '../rules.mjs';

const skillRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => readFileSync(join(skillRoot, ...parts), 'utf8');

test('version is consistent across artifacts', () => {
  const pkg = JSON.parse(read('package.json'));
  const skillVersion = read('SKILL.md').match(/^version:\s*(\S+)$/m)[1];
  const changelogVersion = read('CHANGELOG.md').match(/^## \[(\d+\.\d+\.\d+)\]/m)[1];
  const evalVersion = JSON.parse(read('evals', 'cases.json')).version;
  assert.equal(config.version, pkg.version);
  assert.equal(skillVersion, pkg.version);
  assert.equal(changelogVersion, pkg.version);
  assert.equal(evalVersion, pkg.version);
});

test('schema files are valid JSON with $schema and $id', () => {
  const files = readdirSync(join(skillRoot, 'schemas'));
  assert.equal(files.length, 5);
  for (const file of files) {
    const schema = JSON.parse(read('schemas', file));
    assert.ok(schema.$schema, file);
    assert.ok(schema.$id, file);
  }
});

test('SKILL.md documents every rule code in config', () => {
  const doc = read('SKILL.md');
  const codes = [
    ...Object.values(config.expense.rules).map((r) => r.code),
    ...Object.values(config.invoice.rules).map((r) => r.code),
  ];
  for (const code of codes) assert.ok(doc.includes(code), code);
});

test('result schemas enumerate the same codes as config', () => {
  const expenseSchema = JSON.parse(read('schemas', 'expense-result.schema.json'));
  const invoiceSchema = JSON.parse(read('schemas', 'invoice-result.schema.json'));
  assert.deepEqual(
    expenseSchema.properties.results.items.properties.reasons.items.enum,
    Object.values(config.expense.rules).map((r) => r.code),
  );
  assert.deepEqual(
    invoiceSchema.properties.errors.items.enum,
    Object.values(config.invoice.rules).map((r) => r.code),
  );
});

test('SKILL.md documents config thresholds and categories', () => {
  const doc = read('SKILL.md');
  assert.ok(doc.includes(String(config.expense.receiptRequiredMin)));
  assert.ok(doc.includes(String(config.expense.entertainmentLimit)));
  for (const category of config.expense.validCategories) assert.ok(doc.includes(category), category);
});
