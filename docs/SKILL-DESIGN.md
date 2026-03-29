# SKILL-DESIGN — taskp スキル設計

## スキル概要

| 項目 | 値 |
|------|-----|
| スキル名 | `web-agent` |
| 配置先 | `.taskp/skills/web-agent/SKILL.md` |
| 実行モード | `agent`（LLM が curl コマンドを発行して逐次操作） |
| 使用ツール | `bash` のみ |

## SKILL.md の構成

現在の SKILL.md は全56行のシンプルな構成。LLM がすべき手順を curl コマンド例とともに日本語で示す。

```yaml
---
name: web-agent
description: 自然言語で指示した内容をAIがブラウザで自律操作する
mode: agent
inputs:
  - name: url
    type: text
    message: "操作対象のURLは？"
    validate: "^https?://"
  - name: task
    type: textarea
    message: "やりたいことを自然言語で入力してください"
tools:
  - bash
---
```

### 設計上の選択

- **`after_command` は削除** — REPL サーバー経由の逐次実行では必要なくなった。bash ツールで任意のコマンドを実行できる
- **`read`・`write` ツールは削除** — curl だけで操作が完結するため不要
- **`bash` のみ** — REPL サーバーへの curl 呼び出しが唯一の手段

## 設定の2層構造

```
┌─────────────────────────────────────────────────────┐
│ 毎回変わるもの → inputs（TUI で入力）               │
│   url, task                                          │
├─────────────────────────────────────────────────────┤
│ 固定設定 → config.json                               │
│   screenshotDir, authDir, viewport, timeout,         │
│   cdpEndpoint, replPort, chromeProfileDir            │
└─────────────────────────────────────────────────────┘
```

## config.json 設計

```json
{
  "screenshotDir": "results/screenshots",
  "authDir": "auth",
  "timeout": 30000,
  "cdpEndpoint": "http://localhost:9222",
  "replPort": 3000,
  "chromeProfileDir": "~/chrome-automation",
  "viewport": {
    "width": 1280,
    "height": 768
  }
}
```

### 設定項目

| キー | 型 | デフォルト | 説明 |
|------|-----|-----------|------|
| `screenshotDir` | string | `"results/screenshots"` | スクリーンショット保存先 |
| `authDir` | string | `"auth"` | ログイン状態（storageState）の保存先 |
| `timeout` | number | `30000` | 操作ごとのデフォルトタイムアウト（ms） |
| `cdpEndpoint` | string | `"http://localhost:9222"` | Chrome CDP 接続先 |
| `replPort` | number | `3000` | REPL サーバーのポート番号 |
| `chromeProfileDir` | string | `"~/chrome-automation"` | Chrome 起動用プロファイルの保存先 |
| `viewport.width` | number | `1280` | ブラウザのビューポート幅 |
| `viewport.height` | number | `768` | ブラウザのビューポート高さ |

### config.json を変更する場面

```bash
# スクショ保存先を変えたい
→ "screenshotDir": "~/Dropbox/evidence"

# 重いサイトでタイムアウトする
→ "timeout": 60000

# CDP ポートを変えた場合
→ "cdpEndpoint": "http://localhost:9223"

# REPL サーバーのポートを変えた場合
→ "replPort": 3001
```

## curl ベースのワークフロー

LLM は bash ツールで curl コマンドを発行する。1操作ごとにレスポンスを確認してから次の操作を決める。

### 基本パターン

```bash
# サーバー確認
curl -s http://localhost:3000/health

# ページ移動
curl --json '{"action":"goto","args":{"url":"https://example.com"}}' \
  'http://localhost:3000/exec?session=my-session'

# ページ状態の確認
curl --json '{"action":"observe"}' \
  'http://localhost:3000/exec?session=my-session'

# フィールド入力
curl --json '{"action":"fillField","args":{"description":"メールアドレス","value":"user@example.com"}}' \
  'http://localhost:3000/exec?session=my-session'

# ボタンクリック
curl --json '{"action":"clickButton","args":{"description":"ログイン"}}' \
  'http://localhost:3000/exec?session=my-session'

# スクリーンショット
curl --json '{"action":"screenshot","args":{"path":"results/screenshots/final.png"}}' \
  'http://localhost:3000/exec?session=my-session'

# セッションを閉じてヒストリを保存
curl --json '{"action":"close"}' \
  'http://localhost:3000/exec?session=my-session'
```

### セッション ID の使い方

`?session=xxx` の `xxx` は任意の文字列。SKILL.md では `{{url}}` をデフォルトのセッション ID として使う。

```bash
# URL をそのままセッション ID にする
curl --json '...' 'http://localhost:3000/exec?session={{url}}'
```

同時に複数のセッションを持てる。セッションをまたいで操作が干渉することはない。

### レスポンスの構造

```json
{
  "ok": true,
  "result": null,
  "session": "my-session",
  "state": {
    "url": "https://example.com/dashboard",
    "title": "ダッシュボード"
  },
  "meta": {
    "durationMs": 412
  }
}
```

失敗した場合:

```json
{
  "ok": false,
  "error": {
    "action": "clickButton",
    "description": "送信する",
    "failureType": "not_found",
    "triedStrategies": ["role:button", "role:link", "text:button-like"],
    "candidates": [],
    "currentUrl": "https://example.com/form",
    "pageTitle": "お問い合わせ",
    "message": "clickButton(\"送信する\"): \"送信する\" に一致する要素なし"
  },
  "session": "my-session",
  "state": { "url": "https://example.com/form", "title": "お問い合わせ" },
  "meta": { "durationMs": 28 }
}
```

### 失敗時の対応フロー

```
1. ok: false のレスポンスを受け取る
2. observe で現在のページ状態を確認する
3. observe の結果から正しい description を特定する
4. description を修正して再試行する
```

スクリプトを書き直して再実行するのではなく、次の curl で即座に対応できる。

## 入力設計

### url

| 項目 | 値 |
|------|-----|
| 型 | `text` |
| 必須 | はい |
| バリデーション | `^https?://` |
| 用途 | 操作対象ページの開始URL |

### task

| 項目 | 値 |
|------|-----|
| 型 | `textarea` |
| 必須 | はい |
| 用途 | やりたいことを自然言語で記述 |

入力例:

```
テック系の注目記事トップ3のタイトルとURLを取得して、
各記事ページのスクリーンショットを撮る
```

```
管理画面にログインして、今月の売上データをスクショする
```

## SKILL.md 本文の手順設計

SKILL.md の本文は LLM への指示書になる。現在の構成:

### 1. サーバー確認

REPL サーバーが起動しているかを最初に確認する。未起動なら停止してユーザーに案内する。

### 2. ページ移動と observe

最初の goto の後に必ず observe を実行してページ状態を把握する。observe の結果でボタン・入力欄・リンクの正確な名前を確認してから操作に進む。

### 3. 1操作ずつ実行

各 curl のレスポンスを確認しながら進む。失敗（`ok: false`）が返ってきたら observe で現在の状態を確認してから再試行する。

### 4. 完了

最終スクリーンショットを撮ってから close でセッションを閉じる。close のレスポンスにスクリプトの保存パスが含まれる。

## リプレイ

close 時に `results/scripts/{session}.json` が保存される。このファイルを replay アクションで再実行できる。

```bash
curl --json '{"action":"replay","args":{"path":"results/scripts/my-session.json"}}' \
  'http://localhost:3000/exec?session=replay-1'
```

## 実行パターン

```bash
# 通常: TUI で url と task を入力
taskp run web-agent

# cron / CI: 全部指定、対話なし
taskp run web-agent --skip-prompt \
  --set url="https://example.com" \
  --set task="記事をスクショ"
```
