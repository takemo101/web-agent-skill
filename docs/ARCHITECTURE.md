# ARCHITECTURE — 全体アーキテクチャ

## システム構成図

```
┌─────────────────────────────────────────────────────────────┐
│ taskp CLI                                                    │
│                                                              │
│  taskp run web-test                                          │
│    ↓                                                         │
│  ┌──────────────────┐                                        │
│  │ SKILL.md 読み込み │ ← .taskp/skills/web-test/SKILL.md    │
│  │ + inputs 収集     │                                        │
│  └────────┬─────────┘                                        │
│           ↓                                                   │
│  ┌──────────────────┐    ┌──────────────────────────┐        │
│  │ taskp Agent      │───►│ LLM（スクリプト生成用）   │        │
│  │ (mode: agent)    │◄───│ Claude / GPT / Ollama    │        │
│  └────────┬─────────┘    └──────────────────────────┘        │
│           │ bash ツールで実行                                  │
│           ↓                                                   │
│  ┌──────────────────────────────────────────────┐            │
│  │ 生成されたテストスクリプト (.taskp-tmp/)       │            │
│  │                                               │            │
│  │  import { PlaywrightAgent } from '@midscene'  │            │
│  │  await agent.aiAct('ログインボタンを押す')      │            │
│  │  await agent.aiAssert('ダッシュボードが...')    │            │
│  └────────┬──────────────────────────────────────┘            │
│           │ npx tsx で実行                                     │
│           ↓                                                   │
│  ┌──────────────────────────────────────────────┐            │
│  │ Midscene.js + Playwright                      │            │
│  │                                               │            │
│  │  ┌────────────┐    ┌────────────────────┐     │            │
│  │  │ Playwright │───►│ Chromium ブラウザ    │     │            │
│  │  │ (制御)     │    │ (ヘッドレス/headed) │     │            │
│  │  └────────────┘    └────────────────────┘     │            │
│  │                                               │            │
│  │  ┌────────────┐    ┌────────────────────┐     │            │
│  │  │ Vision LLM │◄───│ スクリーンショット   │     │            │
│  │  │ (要素認識) │───►│ → 操作座標特定      │     │            │
│  │  └────────────┘    └────────────────────┘     │            │
│  └────────┬──────────────────────────────────────┘            │
│           ↓                                                   │
│  ┌──────────────────────────────────────────────┐            │
│  │ 出力                                          │            │
│  │  ├── 📊 HTMLレポート（Midscene自動生成）       │            │
│  │  │     └── 各ステップのスクリーンショット      │            │
│  │  ├── ✅/❌ テスト結果（stdout）               │            │
│  │  └── 📁 midscene_run/report/*.html            │            │
│  └──────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

## LLM の2層構造

本ツールではLLMが2つの異なる役割で使われる。これが重要なアーキテクチャ上の特徴。

```
第1層: taskp Agent（スクリプト生成）
  役割: ユーザーの自然言語テスト手順 → Midscene API コードに変換
  入力: テスト手順テキスト + Midscene API仕様
  出力: TypeScript テストスクリプト
  モデル: テキスト生成モデル（Claude, GPT, Qwen 等）

第2層: Midscene Vision LLM（ブラウザ操作）
  役割: スクリーンショットから要素を認識し、操作座標を特定
  入力: ページのスクリーンショット + 操作指示
  出力: クリック座標 / 入力対象の要素位置
  モデル: Vision モデル（Qwen2.5-VL, GPT-4o, Gemini, UI-TARS 等）
```

### なぜ2層必要か

| | 第1層（taskp） | 第2層（Midscene） |
|---|---|---|
| **タイミング** | テスト実行前（1回） | テスト実行中（毎ステップ） |
| **入力** | テキストのみ | スクリーンショット（画像） |
| **必要な能力** | コード生成 | 画像認識 + UI理解 |
| **コスト** | 低い（1回の呼び出し） | 高い（ステップ数 × 呼び出し） |
| **代替手段** | テンプレートで代替可能 | 代替不可（Midscene の核心） |

### コスト最適化のポイント

第1層は将来的にテンプレート化で LLM 呼び出しを省略できる可能性がある（後述の「テンプレートモード」参照）。

## 処理フロー詳細

### Phase 1: 入力収集（taskp）

```
1. taskp が SKILL.md のフロントマターを解析
2. inputs 定義に従い TUI でユーザーに質問
   - url: テスト対象URL
   - test_steps: テスト手順（自然言語、複数行）
   - expected: 期待結果（省略可）
   - headless: ヘッドレスモード切替
3. 変数を展開し、SKILL.md の本文をプロンプトとして準備
```

### Phase 2: スクリプト生成（taskp Agent）

```
1. taskp の agent モードが LLM を呼び出し
2. LLM がテスト手順を解釈し、Midscene API を使ったスクリプトを生成
3. bash ツールで .taskp-tmp/test-run.ts にスクリプトを書き出し
4. bash ツールで npx tsx .taskp-tmp/test-run.ts を実行
```

### Phase 3: テスト実行（Midscene + Playwright）

```
1. Playwright が Chromium を起動（ヘッドレス or headed）
2. 指定URLに遷移
3. PlaywrightAgent を初期化
4. 各テストステップを順次実行:
   a. スクリーンショットを撮影
   b. Vision LLM に送信して要素を認識
   c. 操作を実行（クリック、入力、スクロール等）
   d. 結果をスクリーンショットで記録
5. aiAssert で期待結果を検証
6. 成功/失敗を出力
```

### Phase 4: レポート出力（Midscene）

```
1. Midscene が自動的に HTMLレポートを生成
   - パス: midscene_run/report/<id>.html
   - 内容: 各ステップのスクリーンショット + 操作内容 + 結果
2. taskp Agent が stdout にレポートパスを出力
3. ユーザーがブラウザでレポートを閲覧
```

## ディレクトリ構成

```
ai-web-tester/
├── .taskp/
│   ├── config.toml                    # taskp 設定（LLMプロバイダ等）
│   └── skills/
│       └── web-test/
│           ├── SKILL.md               # メインスキル定義
│           └── templates/
│               └── test-runner.ts     # テストランナーのテンプレート
├── src/                               # ヘルパースクリプト
├── docs/                              # 設計ドキュメント
│   ├── README.md
│   ├── CONCEPT.md
│   ├── ARCHITECTURE.md
│   ├── SKILL-DESIGN.md
│   ├── MIDSCENE-INTEGRATION.md
│   ├── MODEL-STRATEGY.md
│   └── SETUP.md
├── results/                           # テスト結果
│   └── screenshots/
│       └── final.png                  # 最終スクリーンショット
├── midscene_run/                      # Midscene 自動生成（gitignore）
│   └── report/
│       └── *.html                     # 全ステップのスクリーンショット入りレポート
├── .taskp-tmp/                        # 一時ファイル（gitignore）
│   └── test-run.ts
├── .env                               # 環境変数（APIキー等）
├── .env.example                       # 環境変数テンプレート
├── package.json                       # 依存定義
├── biome.json                         # Biome 設定
├── tsconfig.json                      # TypeScript 設定
├── .gitignore
└── README.md
```

## 技術選定

| 要素 | 選定 | バージョン | 理由 |
|------|------|-----------|------|
| スキル実行基盤 | taskp | 最新 | 既存ツール活用、入力収集・LLM連携が組み込み済み |
| ブラウザ自動化 | Midscene.js | 1.6.0 | Vision LLM ベース、自然言語操作、レポート自動生成 |
| ブラウザエンジン | Playwright | 1.58.2 | Midscene の推奨、ヘッドレス対応、安定性 |
| ランタイム | Bun | >= 1.2.0 | taskp と同一ランタイム、TS直接実行、ビルド不要 |
| lint + format | Biome | 2.4.9 | ESLint + Prettier を1ツールに統合、Rust製で高速 |
| 型チェック | TypeScript | 6.0.2 | `--noEmit` で型チェックのみ使用 |
| テスト | Vitest | 4.1.2 | 高速、Vite エコシステム互換 |
| LLM（スクリプト生成） | Claude / GPT / Ollama | — | taskp の agent モードが対応 |
| LLM（Vision） | Qwen2.5-VL / GPT-4o / Gemini | — | Midscene が対応、ローカルLLM可 |

## エラーハンドリング

### テスト実行時のエラー

| エラー種別 | 原因 | 対処 |
|-----------|------|------|
| 要素が見つからない | Vision LLM が要素を認識できない | エラーメッセージ + スクリーンショットをレポートに記録 |
| タイムアウト | ページ遷移やロードが遅い | aiWaitFor でタイムアウト設定、デフォルト30秒 |
| aiAssert 失敗 | 期待結果と実際の状態が不一致 | 失敗時のスクリーンショットをレポートに記録 |
| ブラウザ起動失敗 | Chromium 未インストール | セットアップ手順でインストールを案内 |
| LLM 接続失敗 | APIキー未設定/サーバーダウン | エラーメッセージで設定方法を案内 |

### スクリプト生成時のエラー

| エラー種別 | 原因 | 対処 |
|-----------|------|------|
| 構文エラー | LLM が不正なコードを生成 | taskp Agent が修正を試みる（最大3回リトライ） |
| API誤用 | 存在しない Midscene API を呼び出し | SKILL.md 内の API仕様で制約 |

## 将来的な拡張ポイント

### テンプレートモードへの移行

頻繁に実行するテストパターンが安定したら、agent モードからtemplateモードに移行できる。

```markdown
# template モード版
mode: template

## テスト実行

\`\`\`bash
npx tsx {{__skill_dir__}}/templates/test-runner.ts \
  --url "{{url}}" \
  --steps "{{test_steps}}" \
  --expected "{{expected}}" \
  --headless {{headless}}
\`\`\`
```

これにより第1層のLLM呼び出しが不要になり、コスト・速度の両方が改善する。

### Bridge Mode 統合

対話的な探索が必要な場合は、Midscene の Bridge Mode と組み合わせて、既存ブラウザのログイン状態を活用する拡張も可能。
