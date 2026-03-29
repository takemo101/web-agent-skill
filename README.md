# web-agent-skill

AIによる汎用ブラウザ操作エージェント。taskp スキル。

自然言語で「やりたいこと」を指示すると、AIがcurlで1操作ずつ REPL サーバーに送り、ブラウザを自律操作する。[taskp](https://github.com/takemo101/taskp) のスキルとして動作する。

## 特徴

- **1操作ずつ逐次実行** — LLM が curl でアクションを送り、レスポンスを確認しながら次の操作を決定
- **DOM直接操作** — ヘルパーAPIがDOM要素を自動特定、CSSセレクタ不要
- **セッション管理** — 複数セッションを同時実行、各セッションで独立したタブを管理
- **ヒストリとリプレイ** — 成功した操作を JSON で保存し、`replay` アクションで再実行
- **既存Chromeを使用** — CDP接続でログイン済みのセッション・Cookieをそのまま利用
- **Chrome 136+ 対応** — プロファイルコピーで自動的に起動制限を回避
- **ローカルLLM対応** — Ollama で完全無料実行可能（Vision LLM不要）

## ユースケース

```bash
# 記事をチェックしてスクショ
taskp run web-agent
  URL: https://news.example.com
  やること: テック系注目記事トップ3のスクショを撮る

# 管理画面のデータ取得
taskp run web-agent
  URL: https://admin.example.com
  やること: 今月の売上データを取得してスクショ

# 定期的な投稿
taskp run web-agent
  URL: https://sns.example.com
  やること: 「本日のビルド完了しました」と投稿する
```

## クイックスタート

```bash
# Step 1: 依存インストール
bun install && bun run setup

# Step 2: Chrome を CDP モードで起動（ターミナル1）
bun run chrome

# Step 3: REPL サーバーを起動（ターミナル2）
npm run repl

# Step 4: スキルを実行（ターミナル3）
taskp run web-agent
```

## 仕組み

```
taskp CLI（LLMエージェント）
  ↓ curl --json POST /exec?session=xxx
REPL サーバー（localhost:3000）
  ↓ Playwright CDP
Chrome（localhost:9222、ユーザープロファイルのコピー）
```

LLM は `bash` ツールで curl を発行する。各操作のレスポンスを確認してから次の動作を決定するため、失敗に即座に対応できる。

## 技術スタック

| コンポーネント | 技術 |
|---------------|------|
| スキル実行基盤 | [taskp](https://github.com/takemo101/taskp) |
| REPL サーバー | npx tsx src/repl-server.ts |
| ブラウザ接続 | [Playwright](https://playwright.dev/) CDP |
| ヘルパーAPI | createAgent(page) — DOM直接操作 |
| Chrome 起動 | bun run src/chrome.ts |
| lint + format | [Biome](https://biomejs.dev/) 2.4.9 |
| 型チェック | TypeScript 6.0.2 |
| テスト | [Vitest](https://vitest.dev/) 4.1.2 |

## ドキュメント

詳細な設計ドキュメントは [docs/](./docs/) を参照。

| ドキュメント | 内容 |
|-------------|------|
| [CONCEPT.md](./docs/CONCEPT.md) | プロジェクトの目的・背景 |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 全体アーキテクチャ |
| [SKILL-DESIGN.md](./docs/SKILL-DESIGN.md) | taskp スキル設計 |
| [PLAYWRIGHT-CDP.md](./docs/PLAYWRIGHT-CDP.md) | Playwright CDP + ヘルパーAPI |
| [SETUP.md](./docs/SETUP.md) | セットアップ手順 |

## ライセンス

MIT
