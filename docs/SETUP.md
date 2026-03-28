# SETUP — セットアップ手順（web-agent）

## 前提条件

| 要件 | バージョン | 確認コマンド |
|------|-----------|-------------|
| Bun | >= 1.2.0 | `bun --version` |
| Node.js | >= 18 | `node --version` |
| taskp | 最新 | `taskp --version` |

## 技術スタック

| 用途 | ツール | バージョン |
|------|--------|-----------|
| ランタイム | Bun | >= 1.2.0 |
| lint + format | Biome | 2.4.9 |
| 型チェック | TypeScript | 6.0.2 |
| テスト | Vitest | 4.1.2 |
| ブラウザ自動化 | Midscene.js | 1.6.0 |
| ブラウザエンジン | Playwright | 1.58.2 |

## Step 1: taskp のインストール

```bash
# taskp がまだインストールされていない場合
bun install -g github:takemo101/taskp

# パスが通っているか確認
taskp --version
```

## Step 2: プロジェクトセットアップ

```bash
cd /path/to/ai-web-tester

# taskp の初期化
taskp setup

# 依存のインストール
bun install
```

## Step 3: ブラウザのインストール

```bash
# Playwright の Chromium をインストール
npx playwright install chromium
```

## Step 4: LLM の設定

使用するモデルに応じて設定する。詳細は [MODEL-STRATEGY.md](./MODEL-STRATEGY.md) を参照。

### パターン A: 完全ローカル（無料）

```bash
# 1. Ollama のインストール
brew install ollama  # macOS
# Linux: curl -fsSL https://ollama.com/install.sh | sh

# 2. モデルのダウンロード
# 第1層: スクリプト生成用（テキストモデル）
ollama pull qwen2.5-coder:7b

# 第2層: ブラウザ操作用（Vision モデル）
ollama pull qwen2.5-vl:7b

# 3. Ollama の CORS 設定
# macOS
launchctl setenv OLLAMA_ORIGINS "*"
# Linux（.bashrc に追記）
echo 'export OLLAMA_ORIGINS="*"' >> ~/.bashrc
source ~/.bashrc

# 4. Ollama サーバーの起動確認
ollama serve  # 別ターミナルで起動（既に起動していればスキップ）
```

taskp の設定:

```toml
# .taskp/config.toml
[ai]
default_provider = "ollama"
default_model = "qwen2.5-coder:7b"

[ai.providers.ollama]
base_url = "http://localhost:11434"
```

Midscene の設定:

```bash
# .env
MIDSCENE_MODEL_NAME=qwen2.5-vl:7b
MIDSCENE_MODEL_BASE_URL=http://localhost:11434/v1
MIDSCENE_MODEL_API_KEY=ollama
MIDSCENE_MODEL_FAMILY=qwen-vl
```

### パターン B: クラウド API

```bash
# .env に APIキーを設定
ANTHROPIC_API_KEY=sk-ant-...         # 第1層: taskp Agent 用
MIDSCENE_MODEL_NAME=gemini-2.5-flash  # 第2層: Midscene 用
MIDSCENE_MODEL_API_KEY=AIza...
MIDSCENE_MODEL_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
MIDSCENE_MODEL_FAMILY=gemini
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

### パターン C: ハイブリッド

```bash
# .env
# 第2層のみクラウド（Vision は精度が重要）
MIDSCENE_MODEL_NAME=gemini-2.5-flash
MIDSCENE_MODEL_API_KEY=AIza...
MIDSCENE_MODEL_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
MIDSCENE_MODEL_FAMILY=gemini
```

```toml
# .taskp/config.toml
# 第1層はローカル（コード生成は十分）
[ai]
default_provider = "ollama"
default_model = "qwen2.5-coder:7b"

[ai.providers.ollama]
base_url = "http://localhost:11434"
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
ヘッドレスモード: Yes
```

成功すれば `results/screenshots/` にスクリーンショット、`midscene_run/report/` にHTMLレポートが生成される。

## トラブルシューティング

### Chromium が起動しない

```bash
# ブラウザを再インストール
npx playwright install chromium --with-deps
```

Linux の場合は追加の依存が必要な場合がある:

```bash
# Ubuntu/Debian
sudo apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2
```

### Ollama に接続できない

```bash
# Ollama が起動しているか確認
curl http://localhost:11434/api/tags

# 起動していなければ
ollama serve
```

### Midscene の Vision LLM がエラーになる

```bash
# モデルが Vision 対応か確認
# ❌ テキストのみモデル（動作しない）
ollama pull qwen2.5:7b

# ✅ Vision 対応モデル（正しい）
ollama pull qwen2.5-vl:7b
```

### レポートが生成されない

```bash
# midscene_run ディレクトリの権限確認
ls -la midscene_run/

# ディレクトリがなければ手動作成
mkdir -p midscene_run/report
```

### taskp Agent がスクリプト生成に失敗する

SKILL.md の Midscene API リファレンスセクションが LLM に十分なコンテキストを提供しているか確認する。モデルの品質が低い場合は、より高性能なモデルに切り替える。

```bash
# CLI オプションでモデルを一時的に変更
taskp run web-agent --model anthropic/claude-sonnet-4-20250514
```

## ディレクトリ構成（セットアップ完了後）

```
web-agent/
├── .taskp/
│   ├── config.toml                     # ✅ taskp 設定
│   └── skills/
│       └── web-agent/
│           ├── SKILL.md                # ✅ スキル定義
│           └── templates/
│               └── agent-runner.ts     # ✅ テンプレート
├── auth/                               # ログイン状態の保存先
├── results/                            # 操作結果
│   └── screenshots/                    # スクリーンショット
├── docs/                               # 設計ドキュメント
├── .env                                # ✅ 環境変数
├── .env.example                        # 環境変数テンプレート
├── package.json                        # ✅ 依存定義
├── biome.json                          # ✅ Biome 設定
├── tsconfig.json                       # ✅ TypeScript 設定
├── .gitignore
├── midscene_run/                       # Midscene 出力（gitignore）
└── .taskp-tmp/                         # 一時ファイル（gitignore）
```
