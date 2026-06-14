# 回帰評価の設計

## 目的

`config/rules.json` と `scripts/rules.mjs` の変更が既存の判定結果を変えないことを、入力と期待出力の対 (`cases.json`) で検証する。

## 実行方法

```
npm run eval
```

## 合否基準

- 各ケースで `audit()` の出力が `expected` と完全一致（`deepStrictEqual`）すること
- 全ケース成功で終了コード 0、1件でも失敗したら終了コード 1
- リリース条件: `npm test` と `npm run eval` の双方がすべて成功すること

## ケース設計

各ルール・契約に正例（該当）・負例（非該当）・境界値を割り当てる。

| ルール / 契約 | カバーするケース |
|---|---|
| R1 OUT_OF_PERIOD | sample-expenses (EXP-004), multi-reason |
| R2 INVALID_AMOUNT | invalid-amounts (0 / 負数 / 小数 / 文字列) |
| R3 RECEIPT_REQUIRED | boundary-thresholds (5000 該当 / 4999 非該当), sample-expenses (EXP-002) |
| R4 UNKNOWN_CATEGORY | sample-expenses (EXP-004), multi-reason |
| R5 ENTERTAINMENT_LIMIT | boundary-thresholds (10000 非該当 / 10001 該当), sample-expenses (EXP-003) |
| R6 POSSIBLE_DUPLICATE | duplicates (1件目非該当 / 2件目以降該当 / rejected の先行も既出扱い) |
| reasons の順序 | multi-reason (R1→R6 順) |
| V1 INVALID_REG_NUMBER | invoice-bad-reg-number, invoice-all-errors |
| V2 TAX_MISMATCH | sample-invoice-tax-mismatch (不一致), invoice-valid (一致), invoice-group-rounding (税率ごと切り捨て) |
| V3 INVALID_DUE_DATE | invoice-due-before-issue |
| V4 INVALID_TAX_RATE | invoice-bad-tax-rate |
| errors の順序 | invoice-all-errors (V1→V4 順) |
| input_error 契約 | input-error-missing-date (MISSING_FIELD) |
| summary 不変条件 | 全経費ケース (total = approved+rejected+needsReview, approvedAmount の合計) |

境界値・型異常の単体レベルの網羅は `scripts/__tests__/rules.test.mjs` が担い、本評価は入出力契約全体の回帰検知を担う。
