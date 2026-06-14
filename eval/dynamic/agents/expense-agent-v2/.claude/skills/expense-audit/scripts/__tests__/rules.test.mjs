import test from 'node:test';
import assert from 'node:assert/strict';
import { audit, detectType, config } from '../rules.mjs';

const expenseInput = (items) => ({ employee: { id: 'E001' }, period: '2026-05', items });
const expenseItem = (overrides) => ({ id: 'EXP-T', date: '2026-05-10', category: '交通費', amount: 1000, receipt: true, ...overrides });
const invoiceInput = (overrides) => ({
  invoiceId: 'INV-T',
  issuer: { name: 'テスト', registrationNumber: 'T1234567890123' },
  issueDate: '2026-05-01',
  dueDate: '2026-05-31',
  lines: [{ description: 'L1', quantity: 1, unitPrice: 1000, taxRate: 0.1 }],
  totals: { taxExcluded: 1000, tax: 100, taxIncluded: 1100 },
  ...overrides,
});
const judge = (item) => audit(expenseInput([item])).results[0];

test('detectType', () => {
  assert.equal(detectType({ items: [] }), 'expense');
  assert.equal(detectType({ lines: [], invoiceId: 'X' }), 'invoice');
  assert.equal(detectType({ lines: [] }), null);
  assert.equal(detectType([]), null);
  assert.equal(detectType(null), null);
});

test('R1 OUT_OF_PERIOD', () => {
  assert.deepEqual(judge(expenseItem({ date: '2026-04-30' })), { id: 'EXP-T', status: 'rejected', reasons: ['OUT_OF_PERIOD'] });
  assert.equal(judge(expenseItem({ date: '2026-05-31' })).status, 'approved');
});

test('R2 INVALID_AMOUNT', () => {
  for (const amount of [0, -500, 1.5, '1200']) {
    assert.deepEqual(judge(expenseItem({ amount })).reasons, ['INVALID_AMOUNT']);
  }
  assert.equal(judge(expenseItem({ amount: 1 })).status, 'approved');
});

test('R3 boundary at 5000', () => {
  assert.deepEqual(judge(expenseItem({ amount: 5000, receipt: false })).reasons, ['RECEIPT_REQUIRED']);
  assert.equal(judge(expenseItem({ amount: 4999, receipt: false })).status, 'approved');
  assert.equal(judge(expenseItem({ amount: 5000, receipt: true })).status, 'approved');
});

test('R3 evaluated for non-integer numeric amount', () => {
  assert.deepEqual(judge(expenseItem({ amount: 5000.5, receipt: false })).reasons, ['INVALID_AMOUNT', 'RECEIPT_REQUIRED']);
});

test('missing receipt treated as false', () => {
  const item = expenseItem({ amount: 5000 });
  delete item.receipt;
  assert.deepEqual(judge(item).reasons, ['RECEIPT_REQUIRED']);
});

test('R4 UNKNOWN_CATEGORY', () => {
  assert.deepEqual(judge(expenseItem({ category: '雑費' })).reasons, ['UNKNOWN_CATEGORY']);
  for (const category of config.expense.validCategories) {
    assert.equal(judge(expenseItem({ category })).reasons.includes('UNKNOWN_CATEGORY'), false);
  }
});

test('R5 boundary at 10000', () => {
  assert.equal(judge(expenseItem({ category: '交際費', amount: 10000 })).status, 'approved');
  assert.deepEqual(judge(expenseItem({ category: '交際費', amount: 10001 })), { id: 'EXP-T', status: 'needs_review', reasons: ['ENTERTAINMENT_LIMIT'] });
});

test('R6 flags second and later occurrences only', () => {
  const result = audit(expenseInput([
    expenseItem({ id: 'A' }),
    expenseItem({ id: 'B' }),
    expenseItem({ id: 'C' }),
    expenseItem({ id: 'D', amount: 2000 }),
  ]));
  assert.deepEqual(result.results.map((r) => r.status), ['approved', 'needs_review', 'needs_review', 'approved']);
});

test('R6 counts rejected predecessors as seen', () => {
  const result = audit(expenseInput([
    expenseItem({ id: 'A', amount: 6000, receipt: false }),
    expenseItem({ id: 'B', amount: 6000, receipt: true }),
  ]));
  assert.deepEqual(result.results[1], { id: 'B', status: 'needs_review', reasons: ['POSSIBLE_DUPLICATE'] });
});

test('reasons preserve R1..R6 order', () => {
  const result = judge(expenseItem({ date: '2026-04-01', category: '雑費', amount: 0, receipt: false }));
  assert.deepEqual(result.reasons, ['OUT_OF_PERIOD', 'INVALID_AMOUNT', 'UNKNOWN_CATEGORY']);
});

test('summary invariants', () => {
  const result = audit(expenseInput([
    expenseItem({ id: 'A' }),
    expenseItem({ id: 'B', amount: 6000, receipt: false }),
    expenseItem({ id: 'C', category: '交際費', amount: 20000 }),
  ]));
  assert.equal(result.summary.total, 3);
  assert.equal(result.summary.approved + result.summary.rejected + result.summary.needsReview, result.summary.total);
  assert.equal(result.summary.approvedAmount, 1000);
  assert.equal(result.results.length, 3);
});

test('V1 registration number format', () => {
  const expectErrors = (registrationNumber, errors) =>
    assert.deepEqual(audit(invoiceInput({ issuer: { name: 'X', registrationNumber } })).errors, errors);
  expectErrors('T1234567890123', []);
  expectErrors('T123456789012', ['INVALID_REG_NUMBER']);
  expectErrors('T12345678901234', ['INVALID_REG_NUMBER']);
  expectErrors('t1234567890123', ['INVALID_REG_NUMBER']);
  expectErrors('T12345678901a3', ['INVALID_REG_NUMBER']);
});

test('V2 rounds per tax-rate group, not per line', () => {
  const result = audit(invoiceInput({
    lines: [
      { description: 'L1', quantity: 1, unitPrice: 833, taxRate: 0.08 },
      { description: 'L2', quantity: 1, unitPrice: 833, taxRate: 0.08 },
    ],
    totals: { taxExcluded: 1666, tax: 133, taxIncluded: 1799 },
  }));
  assert.deepEqual(result, { type: 'invoice_validation_result', invoiceId: 'INV-T', valid: true, errors: [] });
});

test('V2 mismatch in any of the three checks', () => {
  assert.deepEqual(audit(invoiceInput({ totals: { taxExcluded: 999, tax: 100, taxIncluded: 1100 } })).errors, ['TAX_MISMATCH']);
  assert.deepEqual(audit(invoiceInput({ totals: { taxExcluded: 1000, tax: 99, taxIncluded: 1099 } })).errors, ['TAX_MISMATCH']);
  assert.deepEqual(audit(invoiceInput({ totals: { taxExcluded: 1000, tax: 100, taxIncluded: 1101 } })).errors, ['TAX_MISMATCH']);
});

test('V3 due date before issue date', () => {
  assert.deepEqual(audit(invoiceInput({ dueDate: '2026-04-30' })).errors, ['INVALID_DUE_DATE']);
  assert.deepEqual(audit(invoiceInput({ dueDate: '2026-05-01' })).errors, []);
});

test('V4 disallowed tax rate', () => {
  const result = audit(invoiceInput({
    lines: [{ description: 'L1', quantity: 1, unitPrice: 1000, taxRate: 0.05 }],
    totals: { taxExcluded: 1000, tax: 50, taxIncluded: 1050 },
  }));
  assert.deepEqual(result.errors, ['INVALID_TAX_RATE']);
});

test('input_error on missing field', () => {
  const result = audit(expenseInput([{ id: 'X', category: '交通費', amount: 100 }]));
  assert.equal(result.type, 'input_error');
  assert.deepEqual(result.errors.map((e) => [e.path, e.code]), [['items[0].date', 'MISSING_FIELD']]);
});

test('input_error on invalid types', () => {
  const result = audit({
    employee: { id: 'E1' },
    period: '2026/05',
    items: [{ id: 1, date: '2026-05-01', category: '交通費', amount: 100, receipt: 'yes' }],
  });
  assert.equal(result.type, 'input_error');
  assert.deepEqual(result.errors.map((e) => [e.path, e.code]), [
    ['period', 'INVALID_TYPE'],
    ['items[0].id', 'INVALID_TYPE'],
    ['items[0].receipt', 'INVALID_TYPE'],
  ]);
});

test('input_error on unknown input type', () => {
  const result = audit({ foo: 1 });
  assert.equal(result.type, 'input_error');
  assert.deepEqual(result.errors.map((e) => e.code), ['UNKNOWN_INPUT_TYPE']);
});
