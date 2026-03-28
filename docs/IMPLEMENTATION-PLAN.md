# IMPLEMENTATION-PLAN — 実装計画

## 実装順序

依存関係を考慮し、以下の順で実装する。

```
#1 プロジェクト基盤セットアップ
 ↓
#2 テンプレートスクリプト（agent-runner.ts）
 ↓
#3 SKILL.md + config.json 作成
 ↓
#4 example.com で動作確認
 ↓
#5 ログイン状態管理（storageState）
 ↓
#6 マルチアクション化（v2: login / report / screenshot）
```

## Issue 一覧

| # | タイトル | 依存 | 優先度 |
|---|---------|------|:---:|
| 1 | プロジェクト基盤セットアップ | なし | 高 |
| 2 | テンプレートスクリプト作成 | #1 | 高 |
| 3 | SKILL.md + config.json 作成 | #2 | 高 |
| 4 | example.com で E2E 動作確認 | #3 | 高 |
| 5 | ログイン状態管理 | #4 | 中 |
| 6 | マルチアクション化 | #5 | 中 |
