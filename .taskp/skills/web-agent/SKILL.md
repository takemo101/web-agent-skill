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
hooks:
  before: "$TASKP_SKILL_DIR/scripts/chrome.sh"
  after: "$TASKP_SKILL_DIR/scripts/cleanup.sh"
tools:
  - mcp:playwriter
---

URL: {{url}}
タスク: {{task}}

## 手順

### 1. ページに移動してスナップショットを取得

```javascript
await page.goto("{{url}}", { waitUntil: "domcontentloaded" });
await snapshot({ page });
```

snapshotの結果でページ上の要素（aria-ref）を確認してから操作を開始する。

### 2. スナップショットのスコープを絞る（トークン節約）

ページ全体のsnapshotが大きい場合、locatorでスコープを絞る：

```javascript
// メインコンテンツだけ取得（サイドバー・ヘッダー・フッターを除外）
await snapshot({ locator: page.locator("main") });
```

```javascript
// 特定のフォームやダイアログだけ取得
await snapshot({ locator: page.locator('[role="dialog"]') });
await snapshot({ locator: page.locator("form") });
```

```javascript
// キーワードで要素をフィルタリング（最初の10件を返す）
await snapshot({ page, search: /button|submit|login/i });
```

2回目以降のsnapshotは自動的に差分だけ返す（`showDiffSinceLastCall`がデフォルトで有効）。
変更がなければ「No changes since last snapshot」と返るので、トークンを無駄にしない。

### 3. 操作（1つずつ実行）

snapshotで確認したaria-refやlocatorを使って操作する。1操作ずつexecuteを呼ぶこと。

```javascript
await page.locator("aria-ref=e3").fill("テキスト");
```

```javascript
await page.locator("aria-ref=e7").click();
```

操作後はsnapshotで結果を確認（スコープを絞ること）：

```javascript
await snapshot({ locator: page.locator("main") });
```

### 4. スクリーンショット

```javascript
await page.screenshot({ path: "screenshot.png", scale: "css" });
```

`screenshotWithAccessibilityLabels()` は使わない（矢印やラベルが入るため）。
ページの状態確認には `snapshot()` を使うこと。

### 5. データ抽出

DOMから必要なデータだけをevaluateで取得する（snapshot不要）：

```javascript
const data = await page.evaluate(() => ({
  title: document.title,
  links: Array.from(document.querySelectorAll("a")).map(a => ({ text: a.textContent, href: a.href }))
}));
console.log(JSON.stringify(data, null, 2));
```

### ルール

- 1回のexecuteに複雑なスクリプトを書かない。1操作ずつ実行する
- **snapshotはスコープを絞る**：`snapshot({ locator: page.locator("main") })` を優先。ページ全体の `snapshot({ page })` はトークンを大量消費するので初回のみ
- snapshot()で要素を確認してからaria-refで操作する
- 失敗したらsnapshotを再取得して別のaria-refを試す
- データ取得には `page.evaluate()` を使い、必要な情報だけ返す
- スクリーンショットは `page.screenshot({ scale: "css" })` を使う。`screenshotWithAccessibilityLabels()` は使わない

### 6. 再利用関数をstateに保存する（複数操作の効率化）

同じサイトで繰り返す操作は、stateにヘルパー関数を定義して再利用する：

```javascript
state.helpers = {
  getProducts: async () => page.evaluate(() =>
    Array.from(document.querySelectorAll(".product")).map(p => ({
      name: p.querySelector("h2")?.textContent,
      price: p.querySelector(".price")?.textContent
    }))
  ),
  search: async (query) => {
    await page.locator('input[name="q"]').fill(query);
    await page.locator('button[type="submit"]').click();
  }
};
```

以降は1行で呼べる（トークン節約）：

```javascript
await state.helpers.search("AI agent");
console.log(JSON.stringify(await state.helpers.getProducts(), null, 2));
```
