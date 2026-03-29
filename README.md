# web-agent-skill

AIによる汎用ブラウザ操作エージェント。[taskp](https://github.com/takemo101/taskp) スキル。

自然言語で「やりたいこと」を指示すると、AIが [Playwriter](https://github.com/remorses/playwriter) MCP経由でブラウザを自律操作する。普段使いのChromeをそのまま操作するため、ログイン済みのサービスをそのまま利用できる。

## 特徴

- **既存Chromeをそのまま操作** — Cookie・ログイン状態・拡張機能がそのまま使える
- **1操作ずつ逐次実行** — LLMがPlaywriterのexecuteツールで1操作ずつ実行し、結果を見て次を判断
- **A11yスナップショット** — アクセシビリティツリーでページ構造を把握（スクショ不要で軽量）
- **aria-refによる要素指定** — Vimium風のラベルで要素を正確に操作
- **Playwriter MCP** — taskpのMCPクライアント機能で直接ツール呼び出し

## ユースケース

```bash
# SNSに投稿
taskp run web-agent
  URL: https://x.com
  やること: 「今日も頑張ります」と投稿する

# 管理画面のスクショ
taskp run web-agent
  URL: https://admin.example.com/dashboard
  やること: 今月の売上ダッシュボードのスクリーンショットを撮る

# データ抽出
taskp run web-agent
  URL: https://news.example.com
  やること: テック系注目記事トップ3のタイトルを取得する
```

## セットアップ

### 1. Playwriter Chrome拡張をインストール

[Chrome Web Store](https://chromewebstore.google.com/detail/playwriter-mcp/jfeammnjpkecdekppnclgkkffahnhfhe) からインストール

### 2. Chrome上で拡張を有効化

操作したいタブでPlaywriter拡張アイコンをクリック（緑色になれば接続完了）

### 3. スキルを実行

```bash
taskp run web-agent
```

## 仕組み

```
taskp CLI（LLMエージェント）
  ↓ mcp:playwriter（executeツール呼び出し）
Playwriter MCPサーバー（stdioトランスポート）
  ↓ Chrome拡張（chrome.debugger API）
Chrome（ユーザーの既存ブラウザ）
```

LLMはPlaywriterの `execute` ツールでPlaywrightコードを1操作ずつ実行する。`snapshot()` でページのA11yツリーを取得し、`aria-ref` で要素を特定してから操作するため、失敗に即座に対応できる。

## 技術スタック

| コンポーネント | 技術 |
|---------------|------|
| スキル実行基盤 | [taskp](https://github.com/takemo101/taskp) |
| ブラウザ操作 | [Playwriter](https://github.com/remorses/playwriter) MCP |
| ブラウザ接続 | Chrome拡張（chrome.debugger API） |
| ページ解析 | A11yスナップショット + aria-ref |
| lint + format | [Biome](https://biomejs.dev/) |

## 前提条件

- [taskp](https://github.com/takemo101/taskp)（MCPクライアント対応版）
- Chrome + [Playwriter拡張](https://chromewebstore.google.com/detail/playwriter-mcp/jfeammnjpkecdekppnclgkkffahnhfhe)
- Node.js 18+

## ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [CONCEPT.md](./docs/CONCEPT.md) | プロジェクトの目的・背景 |
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 全体アーキテクチャ |
| [SKILL-DESIGN.md](./docs/SKILL-DESIGN.md) | taskp スキル設計 |
| [SETUP.md](./docs/SETUP.md) | セットアップ手順 |
| [NEXT-PROJECT.md](./docs/NEXT-PROJECT.md) | 次期プロジェクト構想 |

## ライセンス

MIT
