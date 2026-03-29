# SETUP — セットアップ手順（web-agent-skill）

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
| ランタイム | Bun | >= 1.2.0 |
| lint + format | Biome | 2.4.9 |
| 型チェック | TypeScript | 6.0.2 |
| テスト | Vitest | 4.1.2 |
| ブラウザ接続 | Playwright CDP | 1.58.2 |

## Step 1: taskp のインストール

```bash
# taskp がまだインストールされていない場合
bun install -g github:takemo101/taskp

# パスが通っているか確認
taskp --version
```

## Step 2: プロジェクトセットアップ

```bash
cd /path/to/web-agent-skill

# taskp の初期化
taskp setup

# 依存のインストール
bun install
```

## Step 3: Chrome を CDP モードで起動

CDP（Chrome DevTools Protocol）経由で既存のChromeに接続する。これにより、ログイン済みのセッション・Cookie・Chrome拡張機能をそのまま利用できる。

### macOS

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

### Linux

```bash
google-chrome --remote-debugging-port=9222
```

### 接続確認

```bash
# CDPエンドポイントが応答するか確認
curl http://localhost:9222/json/version
# → {"Browser":"Chrome/...","WebKit-Version":"..."} が返れば OK
```

### 注意事項

- すでにChromeが起動している場合は、一度すべてのウィンドウを閉じてから上記コマンドで起動する
- `--remote-debugging-port=9222` はデフォルト設定。`config.json` の `cdpEndpoint` と合わせること
- Chromeを閉じると接続が切れる。自動化実行中はChromeを維持しておく

## Step 4: LLM の設定

使用するモデルに応じて設定する。スクリプト生成用のLLM（第1層）のみ設定すればよい。

### パターン A: 完全ローカル（無料）

#### 1. Ollama のインストール

```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh
```

#### 2. モデルのダウンロード

スクリプト生成用のテキストモデルだけあればよい。

```bash
# スクリプト生成用（テキストモデル）
ollama pull qwen2.5-coder:7b    # ~4.7GB
```

##### モデルの選択肢

| モデル | サイズ | 品質 | 速度 |
|--------|--------|:---:|:---:|
| `qwen2.5-coder:7b`（推奨） | 4.7GB | ○ | ◎ |
| `qwen2.5-coder:14b` | 9GB | ◎ | ○ |
| `deepseek-coder-v2:16b` | 9GB | ◎ | ○ |
| `codellama:7b` | 3.8GB | △ | ◎ |

#### 3. Ollama の起動確認

```bash
# 起動（バックグラウンド or 別ターミナル）
ollama serve

# 動作確認
curl http://localhost:11434/api/tags
# → ダウンロード済みモデル一覧が表示される
```

#### 4. taskp Agent の設定

```toml
# .taskp/config.toml
[ai]
default_provider = "ollama"
default_model = "qwen2.5-coder:7b"

[ai.providers.ollama]
base_url = "http://localhost:11434/v1"  # /v1 が必要（OpenAI互換エンドポイント）
```

#### 5. ローカル動作確認

```bash
# テキスト生成の確認
ollama run qwen2.5-coder:7b "console.log('hello') の TypeScript コードを書いて"

# 全体の確認
taskp run web-agent
```

#### ハードウェア要件

| 項目 | 最低 | 推奨 |
|------|------|------|
| RAM | 8GB | 16GB |
| VRAM（GPU） | 4GB | 6GB+ |
| ストレージ | 5GB 空き | 10GB 空き |

- **Apple Silicon Mac**: Metal で高速に動作（M1 以降推奨）
- **NVIDIA GPU**: CUDA で高速（RTX 3060 以上推奨）
- **CPU のみ**: 動作するが遅い（1スクリプト生成に 10〜30秒）

### パターン B: クラウド API

```bash
# .env に APIキーを設定
ANTHROPIC_API_KEY=sk-ant-...
```

taskp の設定:

```toml
# .taskp/config.toml
[ai]
default_provider = "anthropic"
default_model = "claude-sonnet-4-20250514"

[ai.providers.anthropic]
api_key_env = "ANTHROPIC_API_KEY"
```

## Step 5: コード品質チェック

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

## Step 6: 動作確認

```bash
# スキル一覧に web-agent が表示されることを確認
taskp list

# 実行（example.com で簡易テスト）
taskp run web-agent
```

入力例:
```
URL: https://example.com
やりたいこと: ページのタイトルと本文の内容を取得してスクショを撮る
完了後コマンド: （空欄）
```

成功すれば `results/screenshots/` にスクリーンショットが生成される。

## トラブルシューティング

### Chrome に接続できない

```bash
# CDPエンドポイントの応答確認
curl http://localhost:9222/json/version

# 応答しない場合: Chromeを閉じて CDP モードで再起動
# macOS:
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

すでに通常モードでChromeが起動している場合、そのプロセスにはCDPが有効になっていない。一度すべてのChromeウィンドウを閉じること。

### Ollama に接続できない

```bash
# Ollama が起動しているか確認
curl http://localhost:11434/api/tags

# 起動していなければ
ollama serve
```

Docker 内から Ollama に接続する場合:

```bash
# localhost ではなく host.docker.internal を使う
# .taskp/config.toml の base_url を変更:
base_url = "http://host.docker.internal:11434/v1"
```

### taskp Agent がスクリプト生成に失敗する

ローカルLLM の品質が不足している可能性。以下を試す:

```bash
# 1. より大きなモデルに切り替え
ollama pull qwen2.5-coder:14b
# → .taskp/config.toml の default_model を変更

# 2. 一時的にクラウドモデルを使用
taskp run web-agent --model anthropic/claude-sonnet-4-20250514

# 3. Ollama のコンテキストウィンドウを拡大
# Modelfile を作成:
#   FROM qwen2.5-coder:7b
#   PARAMETER num_ctx 32768
# → ollama create qwen2.5-coder-32k -f Modelfile
```

### 要素が見つからない（not_found エラー）

```bash
# results/error-report.json を確認
cat results/error-report.json

# error.png でスクリーンショットを確認
open results/screenshots/error.png
```

`error-report.json` の `failureType` と `candidates` を見て、descriptionをページ上の実際のラベルに合わせて修正する。

## ディレクトリ構成（セットアップ完了後）

```
web-agent-skill/
├── .taskp/
│   ├── config.toml                     # ✅ taskp 設定
│   └── skills/
│       └── web-agent/
│           ├── SKILL.md                # ✅ スキル定義
│           ├── config.json             # ✅ 固定設定
│           └── templates/
│               └── runner.ts           # ✅ テンプレート
├── src/
│   └── helpers/                        # ✅ ヘルパーAPI
├── auth/                               # ログイン状態の保存先
├── results/                            # 操作結果
│   └── screenshots/                    # スクリーンショット
├── docs/                               # 設計ドキュメント
├── .env                                # ✅ 環境変数
├── .env.example                        # 環境変数テンプレート
├── package.json                        # ✅ 依存定義
├── biome.json                          # ✅ Biome 設定
├── tsconfig.json                       # ✅ TypeScript 設定
└── .gitignore
```
