# web-agent-skill

AIによる汎用ブラウザ操作エージェント。taskp スキル。

自然言語で「やりたいこと」を指示すると、AIがブラウザを自律操作し、スクリーンショット撮影やデータ取得を行い、完了後に指定コマンドを実行する。[taskp](https://github.com/takemo101/taskp) のスキルとして動作する。

## 特徴

- **自然言語で操作指示** — 「記事を開いてスクショを撮って」「フォームに入力して送信して」
- **DOM直接操作** — ヘルパーAPIがDOM要素を自動特定、CSSセレクタ不要
- **既存Chromeを使用** — CDP接続でログイン済みのセッション・Cookieをそのまま利用
- **スクリーンショット撮影** — 任意のタイミングで画面をキャプチャ
- **完了後コマンド実行** — 操作結果を後続のスクリプトやツールに連携
- **ローカルLLM対応** — Ollama で完全無料実行可能（Vision LLM不要）
- **定期実行対応** — cron / CI と組み合わせて自動化

## ユースケース

```bash
# 記事をチェックしてスクショ → Slack通知
taskp run web-agent
  URL: https://news.example.com
  やること: テック系注目記事トップ3のスクショを撮る
  完了後: slack-notify.sh

# 管理画面のデータ取得 → 分析スクリプト実行
taskp run web-agent
  URL: https://admin.example.com
  やること: 今月の売上データを取得してスクショ
  完了後: python analyze.py

# 定期的な投稿
taskp run web-agent
  URL: https://sns.example.com
  やること: 「本日のビルド完了しました」と投稿する
  完了後: echo "投稿完了" >> log/history.txt
```

## クイックスタート

```bash
# 依存インストール
bun install
bun run setup

# Chrome を CDP モードで起動（macOS）
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# LLM設定（.env を編集）
cp .env.example .env

# 実行
taskp run web-agent
```

## 技術スタック

| コンポーネント | 技術 |
|---------------|------|
| スキル実行基盤 | [taskp](https://github.com/takemo101/taskp) |
| ブラウザ接続 | [Playwright](https://playwright.dev/) CDP |
| ヘルパーAPI | createAgent(page) — DOM直接操作 |
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
