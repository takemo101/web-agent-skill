# SETUP — セットアップ手順

## 前提条件

| 要件 | バージョン | 確認コマンド |
|------|-----------|-------------|
| Bun | >= 1.2.0 | `bun --version` |
| Node.js | >= 18 | `node --version` |
| taskp | 最新 | `taskp --version` |
| Google Chrome | 最新 | — |

## 技術スタック

| 用途 | ツール | バージョン |
|------|--------|-----------|
| Chrome 起動 | Bun + src/chrome.ts | — |
| REPL サーバー | npx tsx | 4.21.0 |
| ブラウザ接続 | Playwright CDP | 1.58.2 |
| lint + format | Biome | 2.4.9 |
| 型チェック | TypeScript | 6.0.2 |
| テスト | Vitest | 4.1.2 |

## Step 1: taskp のインストール

```bash
# taskp がまだインストールされていない場合
bun install -g github:takemo101/taskp

# パスが通っているか確認
taskp --version
```

## Step 2: 依存のインストール

```bash
cd /path/to/web-agent-skill

# npm パッケージ（Playwright 含む）をインストール
bun install

# Playwright 用の Chromium をダウンロード（内部テスト用）
bun run setup
```

`bun run setup` は `npx playwright install chromium` を実行する。REPL サーバーが Chrome に CDP 接続するために Playwright のパッケージが必要だが、実際のブラウザにはユーザーの Chrome を使う。

## Step 3: Chrome を起動する

```bash
# ターミナル1
bun run chrome
```

このコマンドが自動的に以下を行う:

1. `~/chrome-automation` が存在しなければ、現在の Chrome プロファイルをコピー
2. `--remote-debugging-port=9222 --user-data-dir=~/chrome-automation` で Chrome を起動

### Chrome 136+ について

Chrome 136 以降、デフォルトプロファイルに `--remote-debugging-port` を付けて起動することが制限された。`bun run chrome` はプロファイルをコピーして別のディレクトリから起動することでこれを回避する。

コピーされるのは初回のみ。2回目以降は `~/chrome-automation` がそのまま使われる。

### 起動確認

```bash
curl http://localhost:9222/json/version
# → {"Browser":"Chrome/...","Protocol-Version":"..."} が返れば OK
```

### 注意事項

- Chrome が既に起動していても問題ない。`bun run chrome` は新しいプロセスを起動する
- `~/chrome-automation` のプロファイルは最初のコピー時点のものなので、その後のログイン状態とは別になる
- CDP 接続ポートのデフォルトは 9222。変更する場合は `config.json` の `cdpEndpoint` も合わせる

## Step 4: REPL サーバーを起動する

```bash
# ターミナル2（Chrome とは別のターミナル）
npm run repl
```

`npm run repl` は内部で `npx tsx src/repl-server.ts` を実行する。起動すると以下が表示される:

```
{"ok":true,"port":3000}
```

### 起動確認

```bash
curl http://localhost:3000/health
# → {"ok":true,"sessions":[]} が返れば OK
```

### Bun ではなく npx tsx を使う理由

Playwright の CDP 接続は WebSocket を使う。Bun の WebSocket 実装と Playwright の相性問題があり、`bun run` では動作しない。REPL サーバーは `npx tsx` で実行する必要がある。

## Step 5: LLM の設定

使用するモデルを `.taskp/config.toml` で設定する。

### パターン A: 完全ローカル（無料）

#### 1. Ollama のインストール

```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh
```

#### 2. モデルのダウンロード

```bash
# テキスト生成モデル（推奨）
ollama pull qwen2.5-coder:7b    # ~4.7GB
```

| モデル | サイズ | 品質 | 速度 |
|--------|--------|:---:|:---:|
| `qwen2.5-coder:7b`（推奨） | 4.7GB | ○ | ◎ |
| `qwen2.5-coder:14b` | 9GB | ◎ | ○ |
| `deepseek-coder-v2:16b` | 9GB | ◎ | ○ |

#### 3. taskp Agent の設定

```toml
# .taskp/config.toml
[ai]
default_provider = "ollama"
default_model = "qwen2.5-coder:7b"

[ai.providers.ollama]
base_url = "http://localhost:11434/v1"
```

### パターン B: クラウド API

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
```

```toml
# .taskp/config.toml
[ai]
default_provider = "anthropic"
default_model = "claude-sonnet-4-20250514"

[ai.providers.anthropic]
api_key_env = "ANTHROPIC_API_KEY"
```

## Step 6: 動作確認

3つのターミナルがすべて起動していることを確認してから実行する。

```bash
# ターミナル3
taskp run web-agent
```

入力例:

```
URL: https://example.com
やりたいこと: ページのタイトルをスクショして保存する
```

`results/screenshots/` にスクリーンショットが生成されれば成功。

## コード品質チェック

```bash
# lint + format チェック
bun run check

# 自動修正
bun run check:fix

# 型チェック
bun run typecheck

# テスト
bun run test

# 全部まとめて
bun run verify
```

## トラブルシューティング

### Chrome に接続できない

```bash
# CDP エンドポイントの応答確認
curl http://localhost:9222/json/version
```

応答しない場合は `bun run chrome` を再実行する。

### REPL サーバーが起動しない

```bash
# ポート 3000 が使われていないか確認
lsof -i :3000

# 使われていれば既存プロセスを終了
kill -9 <PID>

# 再起動
npm run repl
```

REPL サーバーは起動時に既存の `/shutdown` エンドポイントを呼んで自動的に終了させる。手動で終了させる必要はないことが多い。

### 要素が見つからない（not_found エラー）

REPL サーバーのレスポンスに `failureType` と `triedStrategies` が含まれる。先に `observe` アクションで正しい要素名を確認する。

```bash
curl --json '{"action":"observe"}' 'http://localhost:3000/exec?session=debug'
```

返ってきた `buttons`・`inputs`・`links` の中から正確なラベルを使う。

### Ollama に接続できない

```bash
# 起動確認
curl http://localhost:11434/api/tags

# 起動していなければ
ollama serve
```

## ディレクトリ構成（セットアップ完了後）

```
web-agent-skill/
├── .taskp/
│   ├── config.toml                     # taskp 設定
│   └── skills/
│       └── web-agent/
│           ├── SKILL.md                # スキル定義
│           └── config.json             # 固定設定
├── src/
│   ├── repl-server.ts                  # REPL HTTP サーバー
│   ├── chrome.ts                       # Chrome 起動スクリプト
│   ├── login.ts                        # ログイン状態保存
│   └── helpers/                        # ヘルパーAPI
├── auth/                               # ログイン状態の保存先
├── results/
│   ├── screenshots/                    # スクリーンショット
│   └── scripts/                        # セッション別ヒストリ
├── docs/
├── .env                                # 環境変数
├── package.json
└── tsconfig.json
```
