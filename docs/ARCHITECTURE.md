# ARCHITECTURE — 全体アーキテクチャ

## システム構成図

```
┌─────────────────────────────────────────────────────────────┐
│ taskp CLI                                                    │
│                                                              │
│  taskp run web-agent                                         │
│    ↓                                                         │
│  ┌──────────────────┐                                        │
│  │ SKILL.md 読み込み │ ← .taskp/skills/web-agent/SKILL.md   │
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
│  │ 生成された操作スクリプト (.taskp-tmp/)         │            │
│  │                                               │            │
│  │  import { createAgent } from '../src/helpers' │            │
│  │  const agent = createAgent(page)              │            │
│  │  await agent.fillField('検索', 'キーワード')   │            │
│  │  await agent.clickButton('検索')              │            │
│  └────────┬──────────────────────────────────────┘            │
│           │ bun run で実行                                     │
│           ↓                                                   │
│  ┌──────────────────────────────────────────────┐            │
│  │ Playwright CDP + ヘルパーAPI                   │            │
│  │                                               │            │
│  │  ┌──────────────┐    ┌────────────────────┐   │            │
│  │  │ Playwright   │───►│ ユーザーの Chrome   │   │            │
│  │  │ (CDP接続)    │    │ (CDP: port 9222)   │   │            │
│  │  └──────────────┘    └────────────────────┘   │            │
│  │                                               │            │
│  │  ヘルパーAPI操作:                             │            │
│  │  agent.clickButton() → DOM解決 → クリック     │            │
│  │  agent.fillField()   → DOM解決 → 入力         │            │
│  └────────┬──────────────────────────────────────┘            │
│           ↓                                                   │
│  ┌──────────────────────────────────────────────┐            │
│  │ 出力                                          │            │
│  │  ├── 📸 スクリーンショット (results/)          │            │
│  │  ├── 📋 エラーレポート (results/error-report.json) │       │
│  │  ├── 📝 抽出データ (stdout / ファイル)         │            │
│  │  └── 🔧 完了後コマンド実行                     │            │
│  └──────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

## アーキテクチャ概要

本ツールはLLMが1つの役割だけを担うシンプルな構造になっている。

```
taskp LLM → agent.xxxヘルパー呼び出しコード生成 → ヘルパーがDOM直接操作
```

### LLMの役割

```
taskp Agent（スクリプト生成）
  役割: ユーザーの自然言語指示 → agent ヘルパーAPI呼び出しコードに変換
  入力: 操作指示テキスト + agent API仕様（SKILL.md）
  出力: TypeScript 操作スクリプト
  モデル: テキスト生成モデル（Claude, GPT, Qwen 等）
```

旧来のVision LLMによる「スクリーンショット画像認識 → 操作」ではなく、DOM直接アクセスで要素を特定する。これによりローカルLLMでも安定して動作する。

### DOM解決の仕組み（ヘルパーAPI内部）

ヘルパーAPI（`clickButton`, `fillField` 等）はアクション種別に応じた解決戦略を持つ。

```
clickButton('投稿'):
  1. getByRole('button', { name: '投稿' })
  2. getByRole('link', { name: '投稿' })   ← ボタン風リンク
  3. DOMスコアリング（button/a要素のみ）

fillField('メールアドレス'):
  1. getByLabel('メールアドレス')
  2. getByPlaceholder('メールアドレス')
  3. getByRole('textbox', { name: 'メールアドレス' })
  4. DOMスコアリング（input/textarea/select のみ）
```

毎回フレッシュに解決するため、SPAの再レンダリング後でも正しい要素を特定できる。

## CDPライフサイクル

Playwright の `chromium.connectOverCDP()` でユーザーのChromeに接続する。

```
1. connect    → chromium.connectOverCDP(CDP_ENDPOINT)
2. newPage    → context.newPage()（既存タブをハイジャックしない）
3. goto       → page.goto(TARGET_URL)
4. operations → agent ヘルパーで操作
5. page.close → 開いたタブだけ閉じる
6. browser.disconnect → ユーザーのChromeは閉じない
```

`browser.close()` はユーザーのChromeごと閉じてしまうため、常に `browser.disconnect()` を使う。

## 処理フロー詳細

### Phase 1: 入力収集（taskp）

```
1. taskp が SKILL.md のフロントマターを解析
2. inputs 定義に従い TUI でユーザーに質問
   - url: 操作対象のURL
   - task: やりたいこと（自然言語、複数行）
   - after_command: 完了後に実行するコマンド（省略可）
3. 変数を展開し、SKILL.md の本文をプロンプトとして準備
```

### Phase 2: スクリプト生成（taskp Agent）

```
1. taskp の agent モードが LLM を呼び出し
2. LLM が操作指示を解釈し、agent ヘルパーAPIを使ったスクリプトを生成
3. bash ツールで .taskp-tmp/agent-run.ts にスクリプトを書き出し
4. bash ツールで bun run .taskp-tmp/agent-run.ts を実行
```

### Phase 3: ブラウザ操作（Playwright CDP + ヘルパーAPI）

```
1. Playwright が chromium.connectOverCDP() でChromeに接続
2. context.newPage() で新しいタブを開く
3. 指定URLに遷移
4. createAgent(page) でagentオブジェクトを作成
5. agent ヘルパーAPIで操作を実行:
   a. ヘルパーがアクション種別に応じてDOM要素を解決
   b. 解決した要素に対してPlaywrightのアクションを実行
   c. 失敗した場合は error-report.json を出力
6. 途中・最終のスクリーンショットを保存
7. データ抽出結果を出力
```

### Phase 4: リペアループ（失敗時のみ）

```
1. スクリプトが失敗した場合、results/error-report.json を確認
2. results/screenshots/error.png でスクリーンショットを確認
3. failureType に応じてスクリプトを修正:
   - not_found: descriptionを実際のラベルに修正
   - ambiguous: agent.section() でスコープを絞る
   - not_actionable: waitForVisible() を追加
   - timeout: タイムアウト値を増やす
4. スクリプトを修正して再実行（最大1回）
```

### Phase 5: 完了後処理

```
1. 最終スクリーンショットを results/screenshots/ に保存
2. after_command が指定されている場合は実行
   - 抽出データを環境変数やパイプで渡す
3. ターミナルに結果サマリを出力
```

## ディレクトリ構成

```
web-agent-skill/
├── .taskp/
│   ├── config.toml                    # taskp 設定（LLMプロバイダ等）
│   └── skills/
│       └── web-agent/
│           ├── SKILL.md               # メインスキル定義
│           ├── config.json            # 固定設定（cdpEndpoint等）
│           └── templates/
│               └── runner.ts          # 操作ランナーのテンプレート
├── src/
│   ├── helpers/
│   │   ├── locator.ts                 # アクション別DOM解決
│   │   ├── actions.ts                 # ヘルパーAPI実装
│   │   ├── agent.ts                   # createAgent(page) ファクトリ
│   │   ├── errors.ts                  # ActionError クラス
│   │   └── index.ts                   # エクスポートバレル
│   ├── chrome.ts                      # CDPプローブ + 手動起動案内
│   └── login.ts                       # ログイン状態保存
├── docs/                              # 設計ドキュメント
├── auth/                              # ログイン状態の保存先
│   └── *.json                         # Playwright storageState
├── results/                           # 操作結果
│   ├── screenshots/
│   │   └── *.png                      # スクリーンショット
│   └── error-report.json              # エラーレポート（リペアループ用）
├── .taskp-tmp/                        # 一時ファイル（gitignore）
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
| スキル実行基盤 | taskp | 最新 | 入力収集・LLM連携・実行管理が組み込み済み |
| ブラウザ接続 | Playwright CDP | 1.58.2 | 既存ChromeのCookie・セッション・拡張機能をそのまま利用 |
| ヘルパーAPI | createAgent(page) | — | DOM直接操作、Vision LLM不要、9Bモデルでも安定 |
| ランタイム | Bun | >= 1.2.0 | taskp と同一、TS直接実行、ビルド不要 |
| lint + format | Biome | 2.4.9 | Rust製で高速、1ツールで完結 |
| 型チェック | TypeScript | 6.0.2 | `--noEmit` で型チェックのみ |
| テスト | Vitest | 4.1.2 | 高速、Vite エコシステム互換 |
| LLM（スクリプト生成） | Claude / GPT / Ollama | — | taskp の agent モードが対応 |

## エラーハンドリング

| エラー種別 | 原因 | 対処 |
|-----------|------|------|
| 要素が見つからない（not_found） | descriptionがページのラベルと一致しない | error-report.json でdescriptionを確認、修正して再実行 |
| 要素が曖昧（ambiguous） | 同名要素が複数存在する | agent.section() でスコープを絞る |
| タイムアウト | ページ遷移やロードが遅い | timeout 値を増やす、waitForVisible を追加 |
| Chrome に接続できない | CDPポートが未起動 | chrome.ts のプローブが起動手順を案内 |
| LLM 接続失敗 | APIキー未設定 / サーバーダウン | エラーメッセージで設定方法を案内 |
| ログイン失敗 | Cookie 期限切れ / 2FA | storageState の再取得を案内 |
| 完了後コマンド失敗 | コマンドのパスやパーミッション | エラー出力 + 非ゼロ終了コード |
