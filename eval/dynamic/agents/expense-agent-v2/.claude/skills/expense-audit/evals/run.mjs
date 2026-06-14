import { readFileSync } from 'node:fs';
import { deepStrictEqual } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { audit } from '../scripts/rules.mjs';

const casesPath = join(dirname(fileURLToPath(import.meta.url)), 'cases.json');
const { cases } = JSON.parse(readFileSync(casesPath, 'utf8'));

let failed = 0;
for (const c of cases) {
  try {
    deepStrictEqual(audit(c.input), c.expected);
    console.log(`PASS ${c.id}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${c.id}: ${c.description}`);
    console.log(e.message);
  }
}
console.log(`${cases.length - failed}/${cases.length} passed`);
process.exit(failed === 0 ? 0 : 1);
