# SETUP — セットアップ手順（web-agent-skill）

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

#### 1. Ollama のインストール

```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh
```

#### 2. モデルのダウンロード

2つのモデルが必要。第1層（コード生成）と第2層（Vision）で役割が異なる。

```bash
# 第1層: スクリプト生成用（テキストモデル）
ollama pull qwen2.5-coder:7b    # ~4.7GB

# 第2層: ブラウザ操作用（Vision モデル）⚠️ 必ず Vision 対応モデル
ollama pull qwen2.5-vl:7b       # ~4.7GB
```

**⚠️ 第2層は Vision 対応モデルが必須。** `qwen2.5:7b`（テキストのみ）では動作しません。

##### モデルの選択肢

第1層（コード生成）:

| モデル | サイズ | 品質 | 速度 |
|--------|--------|:---:|:---:|
| `qwen2.5-coder:7b`（推奨） | 4.7GB | ○ | ◎ |
| `qwen2.5-coder:14b` | 9GB | ◎ | ○ |
| `deepseek-coder-v2:16b` | 9GB | ◎ | ○ |
| `codellama:7b` | 3.8GB | △ | ◎ |

第2層（Vision、ブラウザ操作）:

| モデル | サイズ | 精度 | 速度 |
|--------|--------|:---:|:---:|
| `qwen2.5-vl:7b`（推奨） | 4.7GB | ○ | ◎ |
| `llama3.2-vision:11b` | 6.7GB | ○ | ○ |
| `qwen2.5-vl:32b` | 19GB | ◎ | △ |

#### 3. Ollama の CORS 設定

Midscene からの API アクセスに必要。

```bash
# macOS
launchctl setenv OLLAMA_ORIGINS "*"
# → Ollama アプリを再起動

# Linux（.bashrc に追記）
echo 'export OLLAMA_ORIGINS="*"' >> ~/.bashrc
source ~/.bashrc
# → ollama serve を再起動
```

#### 4. Ollama の起動確認

```bash
# 起動（バックグラウンド or 別ターミナル）
ollama serve

# 動作確認
curl http://localhost:11434/api/tags
# → ダウンロード済みモデル一覧が表示される

# モデル一覧確認
ollama list
# NAME                 ID            SIZE
# qwen2.5-coder:7b     ...           4.7 GB
# qwen2.5-vl:7b        ...           4.7 GB
```

#### 5. 第1層の設定（taskp Agent）

```toml
# .taskp/config.toml
[ai]
default_provider = "ollama"
default_model = "qwen2.5-coder:7b"

[ai.providers.ollama]
base_url = "http://localhost:11434"
```

#### 6. 第2層の設定（Midscene Vision LLM）

```bash
# .env
MIDSCENE_MODEL_NAME=qwen2.5-vl:7b
MIDSCENE_MODEL_BASE_URL=http://localhost:11434/v1
MIDSCENE_MODEL_API_KEY=ollama
MIDSCENE_MODEL_FAMILY=qwen-vl
```

#### 7. ローカル動作確認

```bash
# 第1層の確認（テキスト生成）
ollama run qwen2.5-coder:7b "console.log('hello') の TypeScript コードを書いて"

# 第2層の確認（API互換エンドポイント）
curl http://localhost:11434/v1/models

# 全体の確認
taskp run web-agent
```

#### ハードウェア要件

| 項目 | 最低 | 推奨 |
|------|------|------|
| RAM | 16GB | 32GB |
| VRAM（GPU） | 6GB | 8GB+ |
| ストレージ | 10GB 空き | 20GB 空き |

- **Apple Silicon Mac**: Metal で高速に動作（M1 以降推奨）
- **NVIDIA GPU**: CUDA で高速（RTX 3060 以上推奨）
- **CPU のみ**: 動作するが非常に遅い（1ステップ 30〜60秒）

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

Docker 内から Ollama に接続する場合:

```bash
# localhost ではなく host.docker.internal を使う
MIDSCENE_MODEL_BASE_URL=http://host.docker.internal:11434/v1
```

### Midscene が 403 Forbidden を返す

Ollama の CORS 設定が未反映。

```bash
# macOS: 設定後に Ollama アプリを再起動
launchctl setenv OLLAMA_ORIGINS "*"
# → メニューバーの Ollama アイコンから Quit → 再起動

# Linux: 設定後に ollama serve を再起動
export OLLAMA_ORIGINS="*"
ollama serve
```

### Midscene の Vision LLM がエラーになる

```bash
# ❌ テキストのみモデル（動作しない）
ollama pull qwen2.5:7b

# ✅ Vision 対応モデル（正しい）
ollama pull qwen2.5-vl:7b
```

MIDSCENE_MODEL_FAMILY の設定も確認:

| モデル | MIDSCENE_MODEL_FAMILY |
|--------|----------------------|
| qwen2.5-vl | `qwen-vl` |
| llama3.2-vision | `openai` |

### 操作が非常に遅い

```bash
# GPU が使われているか確認（NVIDIA）
nvidia-smi

# Apple Silicon の場合は自動で Metal を使用
# → 7B モデルなら 1ステップ 3〜10秒が目安

# CPU のみの場合は小さいモデルに切り替え
ollama pull qwen2.5-vl:3b    # より軽量
```

### レポートが生成されない

```bash
# midscene_run ディレクトリの権限確認
ls -la midscene_run/

# ディレクトリがなければ手動作成
mkdir -p midscene_run/report
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

## ディレクトリ構成（セットアップ完了後）

```
web-agent-skill/
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
