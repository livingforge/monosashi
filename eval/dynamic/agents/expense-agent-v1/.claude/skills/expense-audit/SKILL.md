---
name: expense-audit
description: 経費明細 (expenses.json) の承認判定ルールと請求書 (invoice.json) のインボイス検証ルール。経費精算・経費チェック・請求書検証を行うときに使う。判定ルール・評価手順・出力フォーマットを定義する。
---

# 経費精算・請求書検証ルール

入力JSONを以下のルールで判定し、結果JSONを出力する。ルールの解釈を変えたり、独自の判断基準を追加したりしてはいけない。

入力種別の判別: `items` キーがあれば経費明細、`lines` と `invoiceId` があれば請求書。

入力がJSONとしてパースできない、または判定に必要なフィールドが欠けている場合は、判定せずにその箇所を報告する。欠落フィールドを推測で補完しない。ただし `receipt` の欠落は false（領収書なし）として扱う。

# 経費明細の判定ルール

`category` の有効値: `交通費` `会議費` `交際費` `消耗品費` `通信費` `旅費宿泊費`

各 item を R1→R6 の順に評価し、該当したルールの reason コードをすべて `reasons` に列挙する（R1→R6 の順を保つ）。

| ルール | 条件 | 区分 | reason コード |
|---|---|---|---|
| R1 | `date` の先頭7文字（YYYY-MM）が `period` と不一致 | rejected | `OUT_OF_PERIOD` |
| R2 | `amount` が正の整数でない（0以下・小数・数値以外） | rejected | `INVALID_AMOUNT` |
| R3 | `amount` が 5000 以上 かつ `receipt` が false | rejected | `RECEIPT_REQUIRED` |
| R4 | `category` が有効値リストにない | rejected | `UNKNOWN_CATEGORY` |
| R5 | `category` が `交際費` かつ `amount` が 10000 を超える（10000ちょうどは非該当） | needs_review | `ENTERTAINMENT_LIMIT` |
| R6 | 同一の `date`+`category`+`amount` の組がそれ以前の item に存在する（2件目以降のみ該当。1件目は該当しない） | needs_review | `POSSIBLE_DUPLICATE` |

status の決定:
- rejected 区分（R1〜R4）に1つでも該当 → `rejected`
- rejected 区分に該当せず、needs_review 区分（R5〜R6）に該当 → `needs_review`
- どれにも該当しない → `approved`（`reasons` は空配列）

## 評価手順（必ずこの形で作業する）

出力前に、全 item の作業表を作る。各行に id / date / category / amount / receipt と R1〜R6 の該当判定（○/×）を書き出し、そこから status と reasons を導く。R6 は上から順に見て、同じ `date`+`category`+`amount` の組が前の行に出ていたかを確認する（status に関係なく、出現していれば既出とみなす）。

`approvedAmount` は status が `approved` の item の `amount` を1件ずつ列挙して合計し、足し算を一度検算する。

## 経費判定結果の出力フォーマット

```json
{
  "type": "expense_report_result",
  "employeeId": "E001",
  "period": "2026-05",
  "summary": {
    "total": 5,
    "approved": 3,
    "rejected": 1,
    "needsReview": 1,
    "approvedAmount": 12340
  },
  "results": [
    { "id": "EXP-001", "status": "approved", "reasons": [] },
    { "id": "EXP-002", "status": "rejected", "reasons": ["RECEIPT_REQUIRED"] }
  ]
}
```

- `results` は入力 items と同順・同数
- `summary.total` は items の件数、`approved`+`rejected`+`needsReview` = `total` になることを確認する

# 請求書の検証ルール

該当する違反コードをすべて `errors` に列挙する（V1→V4 の順）。

| ルール | 条件 | error コード |
|---|---|---|
| V1 | `issuer.registrationNumber` が「`T` + 数字13桁」の形式でない（合計14文字。桁数・先頭文字・数字以外の混入をすべて確認） | `INVALID_REG_NUMBER` |
| V2 | 税額の不一致（下記の検証手順のいずれか1つでも不一致） | `TAX_MISMATCH` |
| V3 | `dueDate` が `issueDate` より前の日付 | `INVALID_DUE_DATE` |
| V4 | いずれかの line の `taxRate` が 0.10 / 0.08 のどちらでもない | `INVALID_TAX_RATE` |

## V2 の検証手順（必ずこの順で計算過程を書き出す）

1. 各 line について `quantity × unitPrice` を計算して税抜額を出し、全 line の合計が `totals.taxExcluded` と一致するか確認する。
2. line を `taxRate` ごとにグループ化し、税率ごとの税抜合計を出す。各グループで「税抜合計 × 税率」を計算し、**円未満を切り捨て**てから全グループ分を合算する。これが `totals.tax` と一致するか確認する。line ごとに税額を計算してはいけない（必ず税率ごとの合計に対して切り捨てる）。
3. `totals.taxExcluded + totals.tax` が `totals.taxIncluded` と一致するか確認する。

1〜3 のどれか1つでも不一致なら `errors` に `TAX_MISMATCH` を1つだけ入れる（複数個所が不一致でも1つ）。

`errors` が空なら `"valid": true`、1つでもあれば `"valid": false`。

## 請求書検証結果の出力フォーマット

```json
{
  "type": "invoice_validation_result",
  "invoiceId": "INV-2026-001",
  "valid": false,
  "errors": ["TAX_MISMATCH"]
}
```

# 禁止事項

- 判定結果や金額の改変、ルールにない独自判断の追加
- 計算過程を省略してまとめて判定すること
