import { readFileSync, writeFileSync } from 'node:fs';
import { audit, ERROR_MESSAGES } from './rules.mjs';

function parseArgs(argv) {
  const args = { input: null, logPath: null, outPath: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--log') args.logPath = argv[++i];
    else if (argv[i] === '--out') args.outPath = argv[++i];
    else args.input = argv[i];
  }
  return args;
}

const { input, logPath, outPath } = parseArgs(process.argv.slice(2));
const records = [];
const log = (record) => records.push({ ts: new Date().toISOString(), ...record });
const source = input ?? 'stdin';
const raw = input ? readFileSync(input, 'utf8') : readFileSync(0, 'utf8');

let result;
try {
  const data = JSON.parse(raw);
  log({ event: 'start', source });
  result = audit(data, log);
} catch (e) {
  if (!(e instanceof SyntaxError)) throw e;
  log({ event: 'start', source });
  result = { type: 'input_error', errors: [{ path: '$', code: 'PARSE_ERROR', message: ERROR_MESSAGES.PARSE_ERROR }] };
}
log({ event: 'done', resultType: result.type });

const jsonl = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
if (logPath) writeFileSync(logPath, jsonl);
else process.stderr.write(jsonl);

const out = JSON.stringify(result, null, 2) + '\n';
if (outPath) writeFileSync(outPath, out);
else process.stdout.write(out);
process.exit(result.type === 'input_error' ? 1 : 0);
