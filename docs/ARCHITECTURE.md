# ARCHITECTURE — 全体アーキテクチャ

## システム構成図

```
taskp CLI（LLMエージェント）
  ↓ curl --json POST /exec?session=xxx
REPL サーバー（localhost:3000）
  ↓ Playwright CDP
Chrome（localhost:9222、ユーザープロファイルのコピー）
```

### 起動構成（3プロセス）

```
ターミナル1: bun run chrome
  → ~/chrome-automation にプロファイルをコピー
  → Chrome を --remote-debugging-port=9222 で起動

ターミナル2: npm run repl
  → npx tsx src/repl-server.ts を起動
  → localhost:3000 でリクエスト待機

ターミナル3: taskp run web-agent
  → LLM が curl コマンドを1つずつ発行
  → REPL サーバーが Playwright で操作を実行
```

## アーキテクチャ概要

LLM はスクリプトを生成せず、`curl --json` で操作を1つずつ REPL サーバーに送る。

```
taskp LLM → curl → REPL サーバー → Playwright CDP → Chrome
```

### LLMの役割

```
taskp Agent（逐次操作）
  役割: 自然言語指示 → curl コマンドとして1操作ずつ発行
  入力: 操作指示テキスト + SKILL.md の手順
  出力: curl --json コマンド列
  モデル: テキスト生成モデル（Claude, GPT, Ollama 等）
```

旧来の「LLM がスクリプト全体を生成して bun run で実行」ではなく、1操作ごとにレスポンスを確認しながら次の操作を決定する。これにより、失敗があっても即座に対応できる。

## セッション管理

REPL サーバーはセッション単位でタブを管理する。

```
POST /exec?session=my-task
  → sessions マップに "my-task" が存在しなければ
  → context.newPage() で新しいタブを作成
  → Session { id, page, rootAgent, currentAgent, busy, history, failed }
  → sessions.set("my-task", session)
```

### セッションの特性

- **独立性** — セッションごとに別のタブ。同時に複数セッションを実行できる
- **busy フラグ** — 1セッションに同時リクエストが来た場合は 503 を返す
- **ヒストリ** — observe と close 以外の操作をすべて記録する
- **failed フラグ** — エラーが起きたセッションは close 時にスクリプトを保存しない

## アクション一覧

| アクション | 役割 | 引数 |
|------------|------|------|
| `goto` | ページ移動 | `url` |
| `observe` | ページ状態の取得（ボタン・入力欄・リンク名） | なし |
| `clickButton` | ボタンをクリック | `description` |
| `clickLink` | リンクをクリック | `description` |
| `click` | 汎用クリック | `description` |
| `fillField` | テキスト入力 | `description`, `value` |
| `selectOption` | セレクトボックス選択 | `description`, `value` |
| `check` | チェックボックスをオン | `description` |
| `uncheck` | チェックボックスをオフ | `description` |
| `waitForText` | テキスト出現を待機 | `text`, `timeoutMs` |
| `waitForUrl` | URL 変更を待機 | `pattern`, `timeoutMs` |
| `waitForVisible` | 要素表示を待機 | `description`, `timeoutMs` |
| `waitForHidden` | 要素非表示を待機 | `description`, `timeoutMs` |
| `assertVisible` | 要素が表示されているか確認 | `description` |
| `assertText` | テキスト一致を確認 | `description`, `expected` |
| `extractText` | テキスト取得 | `description` |
| `extractTexts` | 複数テキスト取得 | `description` |
| `extractAttribute` | 属性取得 | `description`, `attribute` |
| `section` | スコープを特定セクションに絞る | `description` |
| `resetSection` | スコープをルートに戻す | なし |
| `screenshot` | スクリーンショット保存 | `path` |
| `evaluateFile` | ファイルの JS を evaluate | `path` |
| `close` | セッションを閉じてスクリプトを保存 | なし |
| `replay` | 保存済みスクリプトを再実行 | `path` |

## observe アクション

操作前にページの状態を把握するためのアクション。DOM を直接評価し、可視要素の一覧を返す。

```json
{
  "buttons": ["ログイン", "新規登録", "送信"],
  "links": ["ホーム", "設定", "ログアウト"],
  "inputs": [
    { "type": "email", "label": "メールアドレス" },
    { "type": "password", "label": "パスワード" }
  ],
  "headings": ["ログイン", "アカウント管理"],
  "forms": 1
}
```

observe は history に記録されない。スクリプト再現に不要なため。

## ヒストリ保存とリプレイ

### close アクション時の保存

```
セッション close
  → session.failed が false かつ session.history.length > 0 なら
  → results/scripts/{sessionId}.json に保存
```

保存フォーマット:

```json
{
  "session": "my-task",
  "actions": [
    { "action": "goto", "args": { "url": "https://example.com" } },
    { "action": "fillField", "args": { "description": "メールアドレス", "value": "user@example.com" } },
    { "action": "clickButton", "args": { "description": "ログイン" } }
  ]
}
```

### replay アクション

保存済みスクリプトをそのまま再実行する。

```bash
curl --json '{"action":"replay","args":{"path":"results/scripts/my-task.json"}}' \
  'http://localhost:3000/exec?session=replay-1'
```

途中でエラーが起きた場合は、そこで停止して結果を返す。

## CDPライフサイクル

```
1. connect     → chromium.connectOverCDP(cdpEndpoint)
2. newPage     → context.newPage()（既存タブをハイジャックしない）
3. goto        → page.goto(url, { waitUntil: "domcontentloaded" })
4. operations  → WebAgent ヘルパーで操作
5. page.close  → 開いたタブだけ閉じる
6. browser.close → REPL サーバー終了時（Chrome プロセスは独立しているので影響なし）
```

`browser.close()` はローカルで起動した Playwright 管理の Chromium に使うもの。CDP 接続の場合は `browser.close()` で CDP セッションが終わるだけで、Chrome プロセス自体には影響しない。

## アイドルタイムアウト

REPL サーバーはリクエストが来るたびにタイマーをリセットする。15分間リクエストがなければ自動的にシャットダウンする。

## Chrome 136+ のプロファイルコピー回避策

Chrome 136 以降、デフォルトプロファイルへの `--remote-debugging-port` が制限された。`bun run chrome` はこれを回避するため、起動前にプロファイルを `~/chrome-automation` にコピーする。

```
コピー元（プラットフォーム別）:
  macOS:   ~/Library/Application Support/Google/Chrome
  Linux:   ~/.config/google-chrome
  Windows: ~/AppData/Local/Google/Chrome/User Data

コピー先: ~/chrome-automation（初回のみ）
```

コピー済みのプロファイルが存在する場合はスキップする。

## Bun 非対応と npx tsx の使用理由

Playwright の CDP 接続は WebSocket を使う。Bun の WebSocket 実装と Playwright の相性問題があり、`bun run` では正常に動作しない。そのため REPL サーバーは `npx tsx` で実行する。

```
npm run repl → npx tsx src/repl-server.ts
```

Chrome 起動スクリプト（`src/chrome.ts`）は Playwright を使わないため、`bun run chrome` で問題なく動く。

## エラーハンドリング

### ActionError の構造

ヘルパーAPI が要素の特定に失敗すると `ActionError` をスローする。REPL サーバーはこれを JSON に変換してレスポンスに含める。

```json
{
  "ok": false,
  "error": {
    "action": "clickButton",
    "description": "投稿する",
    "failureType": "not_found",
    "triedStrategies": ["role:button", "role:link", "text:button-like"],
    "candidates": [],
    "currentUrl": "https://example.com/compose",
    "pageTitle": "新規投稿",
    "message": "clickButton(\"投稿する\"): \"投稿する\" に一致する要素なし"
  },
  "session": "my-task",
  "state": { "url": "https://example.com/compose", "title": "新規投稿" },
  "meta": { "durationMs": 312 }
}
```

LLM はこのレスポンスを見て、`description` を変更して再試行するか、先に `observe` で正しい要素名を確認する。

### failureType ごとの対応

| failureType | 意味 | LLM の対処 |
|-------------|------|-----------|
| `not_found` | descriptionに一致する要素がない | observe で正しいラベルを確認して再試行 |
| `ambiguous` | 同名要素が複数ある | `section` アクションでスコープを絞る |
| `not_actionable` | 要素は見つかったが操作不可 | `waitForVisible` を先に実行する |
| `timeout` | タイムアウト | `timeoutMs` を増やす |

## ディレクトリ構成

```
web-agent-skill/
├── .taskp/
│   ├── config.toml                    # taskp 設定（LLMプロバイダ等）
│   └── skills/
│       └── web-agent/
│           ├── SKILL.md               # スキル定義（curl ベース）
│           └── config.json            # 固定設定（cdpEndpoint, replPort 等）
├── src/
│   ├── helpers/
│   │   ├── locator.ts                 # アクション別DOM解決
│   │   ├── actions.ts                 # ヘルパーAPI実装
│   │   ├── agent.ts                   # createAgent(page) ファクトリ
│   │   ├── errors.ts                  # ActionError クラス
│   │   └── index.ts                   # エクスポートバレル
│   ├── repl-server.ts                 # REPL HTTP サーバー（メインランタイム）
│   ├── chrome.ts                      # Chrome 起動（プロファイルコピー込み）
│   └── login.ts                       # ログイン状態保存
├── docs/                              # 設計ドキュメント
├── auth/                              # ログイン状態の保存先
│   └── *.json                         # Playwright storageState
├── results/                           # 操作結果
│   ├── screenshots/
│   │   └── *.png                      # スクリーンショット
│   └── scripts/
│       └── *.json                     # セッション別ヒストリ（replay 用）
├── .env                               # 環境変数（APIキー等）
├── .env.example                       # 環境変数テンプレート
├── package.json
├── biome.json
├── tsconfig.json
└── README.md
```

## 技術選定

| 要素 | 選定 | バージョン | 理由 |
|------|------|-----------|------|
| スキル実行基盤 | taskp | 最新 | 入力収集・LLM連携・実行管理が組み込み済み |
| REPL サーバー | Node.js http + npx tsx | — | Playwright CDP の WebSocket 互換性のため Bun 非対応 |
| ブラウザ接続 | Playwright CDP | 1.58.2 | 既存ChromeのCookie・セッション・拡張機能をそのまま利用 |
| ヘルパーAPI | createAgent(page) | — | DOM直接操作、Vision LLM不要 |
| Chrome 起動 | Bun + src/chrome.ts | — | プロファイルコピーと CDP 起動を自動化 |
| lint + format | Biome | 2.4.9 | Rust製で高速、1ツールで完結 |
| 型チェック | TypeScript | 6.0.2 | `--noEmit` で型チェックのみ |
| テスト | Vitest | 4.1.2 | 高速、Vite エコシステム互換 |
