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
  - mcp:playwriter
---

URL: {{url}}
タスク: {{task}}

## 手順

### 1. ページに移動してスナップショットを取得

```javascript
await page.goto("{{url}}"); await snapshot({ page })
```

snapshotの結果でページ上の要素（aria-ref）を確認してから操作を開始する。

### 2. 操作（1つずつ実行）

snapshotで確認したaria-refを使って操作する。1操作ずつexecuteを呼ぶこと。

```javascript
await page.locator('aria-ref=e3').fill('テキスト')
```

```javascript
await page.locator('aria-ref=e7').click()
```

操作後にページが変わったらsnapshotを再取得:
```javascript
await snapshot({ page })
```

### 3. スクリーンショット

操作の確認用（ラベル付き、AI向け）:
```javascript
await screenshotWithAccessibilityLabels({ page })
```

保存用（ラベルなし、人間向け）:
```javascript
await page.screenshot({ path: 'screenshot.png' })
```

### 4. データ抽出

```javascript
const data = await page.evaluate(() => document.title); console.log(data)
```

### ルール

- 1回のexecuteに複雑なスクリプトを書かない。1操作ずつ実行する
- snapshot()で要素を確認してからaria-refで操作する
- 失敗したらsnapshotを再取得して別のaria-refを試す
- screenshotWithAccessibilityLabelsでスクショを撮る（page.screenshotではない）
