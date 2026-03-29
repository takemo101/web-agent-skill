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

URL: {{url}}
タスク: {{task}}

## 手順

### 1. サーバー確認

```bash
curl -s http://localhost:3000/health
```

`{"ok":true}` なら次へ。エラーなら「REPLサーバーが起動していません。`npx tsx src/repl-server.ts` を別ターミナルで起動してください」と案内して停止。

### 2. ページ移動と観察

```bash
curl --json '{"action":"goto","args":{"url":"{{url}}"}}' http://localhost:3000/exec
curl --json '{"action":"observe"}' http://localhost:3000/exec
```

observeの結果でボタン・入力欄・リンク名を確認する。

### 3. 操作（1つずつ実行）

```bash
curl --json '{"action":"fillField","args":{"description":"入力欄名","value":"値"}}' http://localhost:3000/exec
curl --json '{"action":"clickButton","args":{"description":"ボタン名"}}' http://localhost:3000/exec
curl --json '{"action":"screenshot","args":{"path":"results/screenshots/step.png"}}' http://localhost:3000/exec
```

使えるaction: goto, clickButton, clickLink, click, fillField, selectOption, check, uncheck, waitForText, waitForUrl, waitForVisible, extractText, extractTexts, observe, screenshot, shutdown

失敗時はdescriptionを変えて再試行。observeで正しい名前を確認。

### 4. 完了

```bash
curl --json '{"action":"screenshot","args":{"path":"results/screenshots/final.png"}}' http://localhost:3000/exec
curl --json '{"action":"shutdown"}' http://localhost:3000/exec
```
