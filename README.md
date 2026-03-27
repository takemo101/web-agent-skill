# ai-web-tester

AIによる自然言語Webテスト実行ツール。

サイトURLとテスト内容を自然言語で入力すると、AIがブラウザを操作してテストを実行し、スクリーンショット付きのレポートを生成する。[taskp](https://github.com/takemo101/taskp) のスキルとして動作する。

## 特徴

- **自然言語でテスト記述** — 「ログインボタンをクリックして、メールアドレスを入力する」
- **スクリーンショット付きレポート** — 各ステップの画面を自動記録
- **ローカルLLM対応** — Ollama で完全無料実行可能
- **ヘッドレス/headed切替** — CI実行もデバッグも対応
- **taskp スキル** — 既存の taskp エコシステムに統合

## クイックスタート

```bash
# 依存インストール
npm install
npx playwright install chromium

# LLM設定（.env を編集）
cp .env.example .env

# 実行
taskp run web-test
```

## 使い方

```bash
taskp run web-test
```

対話式で以下を入力：

1. **テスト対象URL** — `https://example.com/login`
2. **テスト手順** — 自然言語で操作手順を記述
3. **期待結果** — テスト合格の判定基準（省略可）
4. **ヘッドレスモード** — Yes/No

実行後、`midscene_run/report/` にHTMLレポートが生成される。

## 技術スタック

| コンポーネント | 技術 |
|---------------|------|
| スキル実行基盤 | [taskp](https://github.com/takemo101/taskp) |
| ブラウザ自動化 | [Midscene.js](https://github.com/web-infra-dev/midscene) |
| ブラウザエンジン | [Playwright](https://playwright.dev/) (Chromium) |
| LLM（スクリプト生成） | Claude / GPT / Ollama |
| LLM（Vision） | Qwen2.5-VL / GPT-4o / Gemini |

## ドキュメント

詳細な設計ドキュメントは [docs/](./docs/) を参照。

| ドキュメント | 内容 |
|-------------|------|
| [CONCEPT.md](./docs/CONCEPT.md) | プロジェクトの目的・背景 |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 全体アーキテクチャ |
| [SKILL-DESIGN.md](./docs/SKILL-DESIGN.md) | taskp スキル設計 |
| [MIDSCENE-INTEGRATION.md](./docs/MIDSCENE-INTEGRATION.md) | Midscene.js 統合 |
| [MODEL-STRATEGY.md](./docs/MODEL-STRATEGY.md) | LLM モデル戦略 |
| [SETUP.md](./docs/SETUP.md) | セットアップ手順 |

## ライセンス

MIT
