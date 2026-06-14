# Changelog

## [2.0.0] - 2026-06-10

### Changed
- 判定をプロンプト推論から `scripts/audit.mjs` の決定的実行に変更
- 閾値・有効カテゴリ・reason / error コードを `config/rules.json` に外部化
- 入出力契約を JSON Schema（`schemas/`）として機械可読化し、判定前の境界検証を追加

### Added
- 入力エラー契約（`input_error`: PARSE_ERROR / UNKNOWN_INPUT_TYPE / MISSING_FIELD / INVALID_TYPE）
- 構造化監査ログ（JSONL、`--log` オプション）
- 単体テスト（`scripts/__tests__/`）と回帰評価（`evals/cases.json` + `evals/run.mjs`）
- バージョン・コード整合の機械検証（`scripts/__tests__/consistency.test.mjs`）
- 適用範囲外・既知の制限、境界の明確化、正しい例と誤用例の文書化
- 所有者・版数の frontmatter 宣言と本変更履歴

## [1.0.0]

- 初版（プロンプト定義のみ。スクリプト実行禁止の制約下で判定ルール・評価手順・出力フォーマットを定義）
