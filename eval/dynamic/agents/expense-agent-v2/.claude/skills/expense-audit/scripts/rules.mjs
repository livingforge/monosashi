import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const skillRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export const config = JSON.parse(readFileSync(join(skillRoot, 'config', 'rules.json'), 'utf8'));

export const ERROR_MESSAGES = {
  PARSE_ERROR: 'JSONとしてパースできません',
  UNKNOWN_INPUT_TYPE: '入力種別を判別できません（items または lines+invoiceId が必要です）',
  MISSING_FIELD: '必須フィールドが欠落しています',
  INVALID_TYPE: 'フィールドの型または形式が不正です',
};

const err = (path, code) => ({ path, code, message: ERROR_MESSAGES[code] });

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function detectType(data) {
  if (isPlainObject(data)) {
    if ('items' in data) return 'expense';
    if ('lines' in data && 'invoiceId' in data) return 'invoice';
  }
  return null;
}

export function validateExpenseInput(data) {
  const errors = [];
  if (data.employee === undefined) errors.push(err('employee', 'MISSING_FIELD'));
  else if (!isPlainObject(data.employee)) errors.push(err('employee', 'INVALID_TYPE'));
  else if (data.employee.id === undefined) errors.push(err('employee.id', 'MISSING_FIELD'));
  else if (typeof data.employee.id !== 'string') errors.push(err('employee.id', 'INVALID_TYPE'));
  if (data.period === undefined) errors.push(err('period', 'MISSING_FIELD'));
  else if (typeof data.period !== 'string' || !/^\d{4}-\d{2}$/.test(data.period)) errors.push(err('period', 'INVALID_TYPE'));
  if (!Array.isArray(data.items)) errors.push(err('items', data.items === undefined ? 'MISSING_FIELD' : 'INVALID_TYPE'));
  else data.items.forEach((item, i) => {
    if (!isPlainObject(item)) {
      errors.push(err(`items[${i}]`, 'INVALID_TYPE'));
      return;
    }
    for (const key of ['id', 'date', 'category']) {
      if (item[key] === undefined) errors.push(err(`items[${i}].${key}`, 'MISSING_FIELD'));
      else if (typeof item[key] !== 'string') errors.push(err(`items[${i}].${key}`, 'INVALID_TYPE'));
    }
    if (item.amount === undefined) errors.push(err(`items[${i}].amount`, 'MISSING_FIELD'));
    if (item.receipt !== undefined && typeof item.receipt !== 'boolean') errors.push(err(`items[${i}].receipt`, 'INVALID_TYPE'));
  });
  return errors;
}

export function validateInvoiceInput(data) {
  const errors = [];
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (data.invoiceId === undefined) errors.push(err('invoiceId', 'MISSING_FIELD'));
  else if (typeof data.invoiceId !== 'string') errors.push(err('invoiceId', 'INVALID_TYPE'));
  if (data.issuer === undefined) errors.push(err('issuer', 'MISSING_FIELD'));
  else if (!isPlainObject(data.issuer)) errors.push(err('issuer', 'INVALID_TYPE'));
  else if (data.issuer.registrationNumber === undefined) errors.push(err('issuer.registrationNumber', 'MISSING_FIELD'));
  else if (typeof data.issuer.registrationNumber !== 'string') errors.push(err('issuer.registrationNumber', 'INVALID_TYPE'));
  for (const key of ['issueDate', 'dueDate']) {
    if (data[key] === undefined) errors.push(err(key, 'MISSING_FIELD'));
    else if (typeof data[key] !== 'string' || !dateRe.test(data[key])) errors.push(err(key, 'INVALID_TYPE'));
  }
  if (data.lines === undefined) errors.push(err('lines', 'MISSING_FIELD'));
  else if (!Array.isArray(data.lines) || data.lines.length === 0) errors.push(err('lines', 'INVALID_TYPE'));
  else data.lines.forEach((line, i) => {
    if (!isPlainObject(line)) {
      errors.push(err(`lines[${i}]`, 'INVALID_TYPE'));
      return;
    }
    if (line.quantity === undefined) errors.push(err(`lines[${i}].quantity`, 'MISSING_FIELD'));
    else if (!Number.isInteger(line.quantity) || line.quantity < 1) errors.push(err(`lines[${i}].quantity`, 'INVALID_TYPE'));
    if (line.unitPrice === undefined) errors.push(err(`lines[${i}].unitPrice`, 'MISSING_FIELD'));
    else if (!Number.isInteger(line.unitPrice) || line.unitPrice < 0) errors.push(err(`lines[${i}].unitPrice`, 'INVALID_TYPE'));
    if (line.taxRate === undefined) errors.push(err(`lines[${i}].taxRate`, 'MISSING_FIELD'));
    else if (typeof line.taxRate !== 'number') errors.push(err(`lines[${i}].taxRate`, 'INVALID_TYPE'));
  });
  if (data.totals === undefined) errors.push(err('totals', 'MISSING_FIELD'));
  else if (!isPlainObject(data.totals)) errors.push(err('totals', 'INVALID_TYPE'));
  else for (const key of ['taxExcluded', 'tax', 'taxIncluded']) {
    if (data.totals[key] === undefined) errors.push(err(`totals.${key}`, 'MISSING_FIELD'));
    else if (!Number.isInteger(data.totals[key])) errors.push(err(`totals.${key}`, 'INVALID_TYPE'));
  }
  return errors;
}

export function auditExpenses(data, log = () => {}) {
  const cfg = config.expense;
  const seen = new Set();
  const results = [];
  let approved = 0;
  let rejected = 0;
  let needsReview = 0;
  let approvedAmount = 0;
  for (const item of data.items) {
    const amount = item.amount;
    const isNumber = typeof amount === 'number';
    const isValidAmount = Number.isInteger(amount) && amount > 0;
    const receipt = item.receipt === true;
    const dupKey = JSON.stringify([item.date, item.category, amount]);
    const matched = {
      R1: item.date.slice(0, 7) !== data.period,
      R2: !isValidAmount,
      R3: isNumber && amount >= cfg.receiptRequiredMin && !receipt,
      R4: !cfg.validCategories.includes(item.category),
      R5: item.category === cfg.entertainmentCategory && isNumber && amount > cfg.entertainmentLimit,
      R6: seen.has(dupKey),
    };
    seen.add(dupKey);
    const reasons = [];
    let status = 'approved';
    for (const [rule, def] of Object.entries(cfg.rules)) {
      if (!matched[rule]) continue;
      reasons.push(def.code);
      if (def.severity === 'rejected') status = 'rejected';
      else if (status !== 'rejected') status = 'needs_review';
    }
    if (status === 'approved') {
      approved++;
      approvedAmount += amount;
    } else if (status === 'rejected') rejected++;
    else needsReview++;
    results.push({ id: item.id, status, reasons });
    log({ event: 'rule_eval', target: item.id, matched, status, reasons });
  }
  return {
    type: 'expense_report_result',
    employeeId: data.employee.id,
    period: data.period,
    summary: { total: data.items.length, approved, rejected, needsReview, approvedAmount },
    results,
  };
}

export function auditInvoice(data, log = () => {}) {
  const cfg = config.invoice;
  const lineSum = data.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const byRate = new Map();
  for (const line of data.lines) {
    byRate.set(line.taxRate, (byRate.get(line.taxRate) ?? 0) + line.quantity * line.unitPrice);
  }
  let computedTax = 0;
  for (const [rate, sum] of byRate) {
    computedTax += Math.floor((sum * Math.round(rate * 1000)) / 1000);
  }
  const taxChecks = {
    taxExcluded: lineSum === data.totals.taxExcluded,
    tax: computedTax === data.totals.tax,
    taxIncluded: data.totals.taxExcluded + data.totals.tax === data.totals.taxIncluded,
  };
  log({ event: 'tax_check', lineSum, computedTax, declared: data.totals, checks: taxChecks });
  const matched = {
    V1: !new RegExp(cfg.registrationNumberPattern).test(data.issuer.registrationNumber),
    V2: !(taxChecks.taxExcluded && taxChecks.tax && taxChecks.taxIncluded),
    V3: data.dueDate < data.issueDate,
    V4: data.lines.some((line) => !cfg.allowedTaxRates.includes(line.taxRate)),
  };
  const errors = Object.entries(cfg.rules)
    .filter(([rule]) => matched[rule])
    .map(([, def]) => def.code);
  log({ event: 'rule_eval', target: data.invoiceId, matched, errors });
  return {
    type: 'invoice_validation_result',
    invoiceId: data.invoiceId,
    valid: errors.length === 0,
    errors,
  };
}

export function audit(data, log = () => {}) {
  const inputType = detectType(data);
  if (inputType === null) return { type: 'input_error', errors: [err('$', 'UNKNOWN_INPUT_TYPE')] };
  const errors = inputType === 'expense' ? validateExpenseInput(data) : validateInvoiceInput(data);
  if (errors.length > 0) return { type: 'input_error', errors };
  return inputType === 'expense' ? auditExpenses(data, log) : auditInvoice(data, log);
}
