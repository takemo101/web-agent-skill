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
  - name: after_command
    type: text
    message: "完了後に実行するコマンドは？（空欄でスキップ）"
    required: false
context:
  - type: file
    path: "{{__skill_dir__}}/config.json"
tools:
  - bash
  - read
  - write
---

## 操作対象

URL: {{url}}

## やりたいこと

{{task}}

## 実行手順

### Step 1: APIリファレンスを読む

read ツールで以下のファイルを読み、使えるアクションを把握する:

```
{{__skill_dir__}}/api-reference.md
```

### Step 2: REPLサーバー起動

```bash
npx tsx {{__cwd__}}/src/repl-server.ts &
sleep 3
curl -s http://localhost:3000/health
```

`{"ok":true}` が返れば準備完了。

### Step 3: ページ移動と観察

```bash
curl --json '{"action":"goto","args":{"url":"操作対象のURL"}}' http://localhost:3000/exec
curl --json '{"action":"observe"}' http://localhost:3000/exec
```

observe結果のボタン・入力欄・リンクを確認してから操作を開始する。

### Step 4: 操作（1つずつ実行、結果を見て次を決める）

**curl で1操作ずつ実行。スクリプトファイルは生成しない。**

失敗時: description を変えて再試行。3回失敗したら observe で状態確認。

### Step 5: 完了

```bash
curl --json '{"action":"screenshot","args":{"path":"results/screenshots/final.png"}}' http://localhost:3000/exec
curl --json '{"action":"shutdown"}' http://localhost:3000/exec
```
