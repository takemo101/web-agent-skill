# MODEL-STRATEGY — LLM モデル戦略

## 2つのLLM の役割

本ツールでは LLM が2つの異なるレイヤーで使われる。それぞれ独立して設定可能。

```
┌──────────────────────────────────────────────────┐
│ 第1層: taskp Agent（スクリプト生成）               │
│                                                    │
│ 役割: 自然言語の操作指示 → Midscene API コード     │
│ 必要能力: コード生成、API仕様の理解                 │
│ Vision: 不要                                       │
│ 設定: .taskp/config.toml + SKILL.md frontmatter    │
└──────────────────────────────────────────────────┘
          ↓ 生成されたスクリプトを実行
┌──────────────────────────────────────────────────┐
│ 第2層: Midscene Vision LLM（ブラウザ自律操作）     │
│                                                    │
│ 役割: スクリーンショット → ページ理解 → 操作実行   │
│ 必要能力: 画像認識、UI理解                          │
│ Vision: 必須                                       │
│ 設定: 環境変数 or PlaywrightAgent の modelConfig    │
└──────────────────────────────────────────────────┘
```

## 第1層: taskp Agent のモデル設定

### 設定箇所

taskp の config.toml で設定する。

```toml
# .taskp/config.toml
[ai]
default_provider = "anthropic"
default_model = "claude-sonnet-4-20250514"

[ai.providers.anthropic]
api_key_env = "ANTHROPIC_API_KEY"
```

SKILL.md の frontmatter で個別に上書きも可能。

```yaml
model: anthropic/claude-sonnet-4-20250514
```

### 推奨モデル

| プロバイダ | モデル | コスト | コード生成品質 | 備考 |
|-----------|--------|--------|--------------|------|
| **Anthropic** | claude-sonnet-4 | 中 | ◎ | TypeScript生成が得意、推奨 |
| **OpenAI** | gpt-4o-mini | 低 | ○ | コスパ重視 |
| **OpenAI** | gpt-4o | 中 | ◎ | 高品質 |
| **Google** | gemini-2.5-flash | 低 | ○ | 無料枠あり |
| **Ollama** | qwen2.5-coder:7b | 無料 | △〜○ | ローカル実行、GPU推奨 |
| **Ollama** | codellama:13b | 無料 | △ | コード特化だが精度は控えめ |

### Ollama での設定

```toml
# .taskp/config.toml
[ai]
default_provider = "ollama"
default_model = "qwen2.5-coder:7b"

[ai.providers.ollama]
base_url = "http://localhost:11434"
```

```bash
# モデルのダウンロード
ollama pull qwen2.5-coder:7b
```

## 第2層: Midscene Vision LLM のモデル設定

### 設定箇所

環境変数で設定する。

```bash
# .env
MIDSCENE_MODEL_NAME="qwen2.5-vl:7b"
MIDSCENE_MODEL_BASE_URL="http://localhost:11434/v1"
MIDSCENE_MODEL_API_KEY="ollama"
MIDSCENE_MODEL_FAMILY="qwen-vl"
```

または PlaywrightAgent の `modelConfig` で設定する（環境変数より優先）。

```typescript
const agent = new PlaywrightAgent(page, {
  modelConfig: {
    MIDSCENE_MODEL_NAME: "qwen2.5-vl:7b",
    MIDSCENE_MODEL_BASE_URL: "http://localhost:11434/v1",
    MIDSCENE_MODEL_API_KEY: "ollama",
    MIDSCENE_MODEL_FAMILY: "qwen-vl",
  },
});
```

### 推奨モデル

⚠️ **Vision（画像認識）対応モデルが必須。** テキストのみのモデルでは動作しない。

| プロバイダ | モデル | コスト | Vision精度 | 備考 |
|-----------|--------|--------|-----------|------|
| **Google** | gemini-2.5-flash | 低 | ◎ | 無料枠あり、コスパ最強 |
| **OpenAI** | gpt-4o | 中 | ◎ | 最も安定 |
| **OpenAI** | gpt-4o-mini | 低 | ○ | コスパ重視 |
| **Anthropic** | claude-sonnet-4 | 中 | ◎ | 高精度 |
| **Ollama** | qwen2.5-vl:7b | 無料 | ○ | ローカル推奨、GPU必須 |
| **Ollama** | llama3.2-vision:11b | 無料 | ○ | Meta製、安定 |
| **セルフホスト** | UI-TARS 7B | 無料 | ◎ | GUI操作特化、最高精度 |

### MIDSCENE_MODEL_FAMILY の設定値

Midscene がモデルの特性を判断するために使うパラメータ。

| 値 | 対象モデル |
|-----|-----------|
| `openai` | GPT-4o, GPT-4o-mini |
| `claude` | Claude Sonnet, Claude Haiku |
| `gemini` | Gemini 2.5 Flash, Gemini Pro |
| `qwen-vl` | Qwen2.5-VL, Qwen-VL-Plus |
| `doubao` | Doubao Vision |
| `ui-tars` | UI-TARS（`MIDSCENE_USE_VLM_UI_TARS=1.0` も設定） |

### Ollama での設定

```bash
# Vision モデルのダウンロード
ollama pull qwen2.5-vl:7b

# CORS 設定（Midscene からのアクセス許可）
# macOS
launchctl setenv OLLAMA_ORIGINS "*"
# Linux
export OLLAMA_ORIGINS="*"
```

### インテント別モデル設定（上級）

Midscene は内部で3つのインテント（planning / insight / action）を持つ。それぞれに異なるモデルを設定できる。

```bash
# デフォルトモデル（全インテント）
MIDSCENE_MODEL_NAME="qwen2.5-vl:7b"
MIDSCENE_MODEL_BASE_URL="http://localhost:11434/v1"
MIDSCENE_MODEL_API_KEY="ollama"

# プランニングだけ高性能モデルを使う
MIDSCENE_PLANNING_MODEL_NAME="gpt-4o"
MIDSCENE_PLANNING_MODEL_API_KEY="sk-..."
MIDSCENE_PLANNING_MODEL_BASE_URL="https://api.openai.com/v1"
```

これにより、コストの高い推論は高品質モデル、要素認識はローカルモデルという使い分けが可能。

## コスト試算

### テスト1回あたりの目安

5ステップのテスト（ログイン → 検索 → クリック → 入力 → 検証）を想定。

#### クラウドモデルの場合

| レイヤー | 呼び出し回数 | トークン/回 | 単価 | 合計 |
|---------|-------------|------------|------|------|
| 第1層（スクリプト生成） | 1回 | ~2,000 | ~$0.003 | ~$0.003 |
| 第2層（Vision、5ステップ） | 5回 | ~3,000 | ~$0.005 | ~$0.025 |
| **合計** | | | | **~$0.03（約5円）** |

※ GPT-4o-mini 使用時の概算

#### ローカルモデルの場合

| レイヤー | コスト |
|---------|--------|
| 第1層（qwen2.5-coder:7b） | ¥0（電気代のみ） |
| 第2層（qwen2.5-vl:7b） | ¥0（電気代のみ） |
| **合計** | **¥0** |

※ GPU搭載マシン（VRAM 8GB以上）が必要

## 推奨構成

### 開発・検証時（コスパ重視）

```
第1層: Ollama / qwen2.5-coder:7b（無料）
第2層: Ollama / qwen2.5-vl:7b（無料）
```

### 本番・CI（精度重視）

```
第1層: Anthropic / claude-sonnet-4（高品質なコード生成）
第2層: Google / gemini-2.5-flash（低コスト + 高精度Vision）
```

### ハイブリッド（コスト最適化）

```
第1層: Ollama / qwen2.5-coder:7b（無料、コード生成は十分）
第2層: Google / gemini-2.5-flash（Vision は精度が重要なのでクラウド）
```
