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

{% if after_command %}
## 完了後コマンド

全操作が完了したら、最後に以下のコマンドを実行してください:

```bash
{{after_command}}
```
{% endif %}

## 実行手順

### Step 1: REPLサーバーの起動

bash ツールでサーバーをバックグラウンド起動し、準備できているか確認する:

```bash
npx tsx {{__cwd__}}/src/repl-server.ts &
sleep 3
curl -s http://localhost:3000/health
```

`{"ok":true}` が返ればサーバー準備完了。エラーが返った場合、またはChromeが起動していない場合は次を実行してから再試行:

```bash
bun run chrome
```

### Step 2: ページ移動と観察

まずページに移動し、何があるかを確認する:

```bash
curl --json '{"action":"goto","args":{"url":"操作対象のURL"}}' http://localhost:3000/exec
curl --json '{"action":"observe"}' http://localhost:3000/exec
```

observe の結果にはボタン・リンク・入力欄・見出しの一覧が含まれる。これを見てから操作を開始すること。

### Step 3: 操作実行（ループ）

**1操作ずつ curl で実行する。結果の `ok` を確認してから次を決める。スクリプトファイルを生成しないこと。**

操作例:

```bash
# テキスト入力
curl --json '{"action":"fillField","args":{"description":"検索欄","value":"キーワード"}}' http://localhost:3000/exec

# ボタンクリック
curl --json '{"action":"clickButton","args":{"description":"検索"}}' http://localhost:3000/exec

# スクリーンショット
curl --json '{"action":"screenshot","args":{"path":"results/screenshots/step1.png"}}' http://localhost:3000/exec
```

**失敗時の対応:**

- `not_found` → description を変えて再試行。必要なら `observe` で要素名を確認する
- `ambiguous` → `section` で範囲を絞ってから再試行
- `timeout` → `waitForVisible` を先に実行してから再試行
- 3回失敗したら `observe` で改めてページ状態を確認し、アプローチを変える

### Step 4: 完了

操作が終わったら最終スクリーンショットを撮り、サーバーを停止する:

```bash
curl --json '{"action":"screenshot","args":{"path":"results/screenshots/final.png"}}' http://localhost:3000/exec
curl --json '{"action":"shutdown"}' http://localhost:3000/exec
```

---

## スキル設定

config.json の内容:

| キー | 説明 | デフォルト |
|------|------|-----------|
| `cdpEndpoint` | CDP接続先 | `http://localhost:9222` |
| `replPort` | REPLサーバーのポート | `3000` |
| `timeout` | アクションのタイムアウト（ms） | `30000` |
| `screenshotDir` | スクリーンショット保存先 | `results/screenshots` |
| `viewport.width` | ブラウザ幅 | `1280` |
| `viewport.height` | ブラウザ高さ | `768` |

---

## アクション一覧

すべてのアクションは `POST /exec` に `{"action":"...", "args":{...}}` の形式で送る。

### ナビゲーション

| action | args | 例 |
|--------|------|-----|
| `goto` | `{ url }` | `curl --json '{"action":"goto","args":{"url":"https://example.com"}}' http://localhost:3000/exec` |

レスポンス例:
```json
{"ok":true,"result":null,"state":{"url":"https://example.com","title":"Example"},"meta":{"durationMs":312}}
```

### 操作

| action | args | 説明 |
|--------|------|------|
| `clickButton` | `{ description }` | ボタンをクリック |
| `clickLink` | `{ description }` | リンクをクリック |
| `click` | `{ description }` | 汎用クリック（ボタン・リンク以外も対象） |
| `fillField` | `{ description, value }` | テキスト入力欄に値を入力 |
| `selectOption` | `{ description, value }` | ドロップダウンで値を選択 |
| `check` | `{ description }` | チェックボックスをONにする |
| `uncheck` | `{ description }` | チェックボックスをOFFにする |

例:
```bash
curl --json '{"action":"clickButton","args":{"description":"送信"}}' http://localhost:3000/exec
curl --json '{"action":"fillField","args":{"description":"メールアドレス","value":"user@example.com"}}' http://localhost:3000/exec
curl --json '{"action":"selectOption","args":{"description":"カテゴリ","value":"技術"}}' http://localhost:3000/exec
```

### 待機

| action | args | 説明 |
|--------|------|------|
| `waitForText` | `{ text, timeoutMs? }` | 指定テキストが画面に出るまで待つ |
| `waitForUrl` | `{ pattern, timeoutMs? }` | URLが変わるまで待つ |
| `waitForVisible` | `{ description, timeoutMs? }` | 要素が表示されるまで待つ |
| `waitForHidden` | `{ description, timeoutMs? }` | 要素が消えるまで待つ |

例:
```bash
curl --json '{"action":"waitForText","args":{"text":"投稿完了"}}' http://localhost:3000/exec
curl --json '{"action":"waitForUrl","args":{"pattern":"/dashboard"}}' http://localhost:3000/exec
curl --json '{"action":"waitForVisible","args":{"description":"送信ボタン","timeoutMs":5000}}' http://localhost:3000/exec
```

### 検証

| action | args | 説明 |
|--------|------|------|
| `assertVisible` | `{ description }` | 要素が表示されているか確認 |
| `assertText` | `{ description, expected }` | 要素のテキストが一致するか確認 |

例:
```bash
curl --json '{"action":"assertVisible","args":{"description":"成功メッセージ"}}' http://localhost:3000/exec
curl --json '{"action":"assertText","args":{"description":"ステータス","expected":"公開済み"}}' http://localhost:3000/exec
```

### テキスト取得

| action | args | 説明 |
|--------|------|------|
| `extractText` | `{ description }` | 要素のテキストを1件取得 |
| `extractTexts` | `{ description }` | 複数要素のテキストをリストで取得 |
| `extractAttribute` | `{ description, attribute }` | 要素の属性値を取得 |

例:
```bash
curl --json '{"action":"extractText","args":{"description":"エラーメッセージ"}}' http://localhost:3000/exec
curl --json '{"action":"extractTexts","args":{"description":"検索結果の件名"}}' http://localhost:3000/exec
curl --json '{"action":"extractAttribute","args":{"description":"プロフィール画像","attribute":"src"}}' http://localhost:3000/exec
```

レスポンス例（extractTexts）:
```json
{"ok":true,"result":["件名A","件名B","件名C"],"state":{"url":"https://example.com/results","title":"検索結果"},"meta":{"durationMs":89}}
```

### スコーピング

特定のセクション内だけで操作したい場合に使う。同じ名前のボタンが複数ある時に特に有効。

| action | args | 説明 |
|--------|------|------|
| `section` | `{ description }` | 以降の操作を指定セクション内に限定 |
| `resetSection` | `{}` | スコーピングを解除し、ページ全体を対象に戻す |

例:
```bash
curl --json '{"action":"section","args":{"description":"コメント欄"}}' http://localhost:3000/exec
curl --json '{"action":"fillField","args":{"description":"入力欄","value":"コメント内容"}}' http://localhost:3000/exec
curl --json '{"action":"clickButton","args":{"description":"投稿"}}' http://localhost:3000/exec
curl --json '{"action":"resetSection"}' http://localhost:3000/exec
```

### 観察・スクリーンショット

| action | args | 説明 |
|--------|------|------|
| `observe` | `{}` | ページ上のインタラクティブ要素を一覧取得 |
| `screenshot` | `{ path }` | スクリーンショットを保存 |

### エスケープハッチ

| action | args | 説明 |
|--------|------|------|
| `evaluateFile` | `{ path }` | JSファイルを読み込んで実行 |

### 制御

| action | args | 説明 |
|--------|------|------|
| `shutdown` | `{}` | サーバーを停止する |

---

## observe の使い方

observe はページに今どんな要素があるかを取得するアクション。

**必ず最初の操作前に observe を実行すること。** ページの構造を知らずに操作しようとすると `not_found` エラーになりやすい。

```bash
curl --json '{"action":"observe"}' http://localhost:3000/exec
```

レスポンス例:
```json
{
  "ok": true,
  "result": {
    "url": "https://example.com/login",
    "title": "ログイン",
    "buttons": ["ログイン", "パスワードを忘れた場合"],
    "links": ["新規登録", "ヘルプ"],
    "inputs": [
      {"type": "email", "label": "メールアドレス"},
      {"type": "password", "label": "パスワード"}
    ],
    "headings": ["ログイン"],
    "forms": 1
  },
  "state": {"url": "https://example.com/login", "title": "ログイン"}
}
```

この結果を見て:

- `buttons` の中から操作したいボタン名を確認する
- `inputs` の中から入力欄の `label` を description として使う
- `links` の中からクリックしたいリンク名を確認する

**予期しないエラーが続く場合も observe を実行して、ページが期待通りの状態かを確認する。**

---

## エスケープハッチ（evaluateFile）

通常のアクションで対応できない複雑なデータ取得や操作は、JSファイルを書いて実行する。

**Step 1: write ツールでJSファイルを作成する**

```javascript
// .taskp-tmp/extract.js
Array.from(document.querySelectorAll('table tbody tr')).map(row => ({
  name: row.cells[0]?.textContent?.trim(),
  price: row.cells[1]?.textContent?.trim(),
  stock: row.cells[2]?.textContent?.trim(),
}))
```

**Step 2: curl でファイルを実行する**

```bash
curl --json '{"action":"evaluateFile","args":{"path":".taskp-tmp/extract.js"}}' http://localhost:3000/exec
```

レスポンス例:
```json
{"ok":true,"result":[{"name":"商品A","price":"1000円","stock":"在庫あり"}],"state":{"url":"...","title":"..."},"meta":{"durationMs":45}}
```

インラインでJSを書こうとするとシェルエスケープが複雑になる。ファイルに分けることで確実に実行できる。

---

## レシピ（使用例）

### フォーム投稿

```bash
# 1. ページ移動
curl --json '{"action":"goto","args":{"url":"https://example.com/contact"}}' http://localhost:3000/exec

# 2. 何があるか確認
curl --json '{"action":"observe"}' http://localhost:3000/exec

# 3. 各フィールドに入力
curl --json '{"action":"fillField","args":{"description":"お名前","value":"山田太郎"}}' http://localhost:3000/exec
curl --json '{"action":"fillField","args":{"description":"メールアドレス","value":"yamada@example.com"}}' http://localhost:3000/exec
curl --json '{"action":"fillField","args":{"description":"お問い合わせ内容","value":"製品について確認したいことがあります"}}' http://localhost:3000/exec

# 4. 送信
curl --json '{"action":"clickButton","args":{"description":"送信"}}' http://localhost:3000/exec

# 5. 完了を待つ
curl --json '{"action":"waitForText","args":{"text":"送信完了"}}' http://localhost:3000/exec

# 6. スクリーンショット
curl --json '{"action":"screenshot","args":{"path":"results/screenshots/contact-done.png"}}' http://localhost:3000/exec
```

### 検索 + データ抽出

```bash
# 1. ページ移動
curl --json '{"action":"goto","args":{"url":"https://example.com/search"}}' http://localhost:3000/exec

# 2. 観察
curl --json '{"action":"observe"}' http://localhost:3000/exec

# 3. 検索実行
curl --json '{"action":"fillField","args":{"description":"検索欄","value":"TypeScript"}}' http://localhost:3000/exec
curl --json '{"action":"clickButton","args":{"description":"検索"}}' http://localhost:3000/exec

# 4. 結果が出るまで待つ
curl --json '{"action":"waitForVisible","args":{"description":"検索結果"}}' http://localhost:3000/exec

# 5. タイトル一覧を取得
curl --json '{"action":"extractTexts","args":{"description":"検索結果のタイトル"}}' http://localhost:3000/exec

# 6. スクリーンショット
curl --json '{"action":"screenshot","args":{"path":"results/screenshots/search-results.png"}}' http://localhost:3000/exec
```

### スコーピング

同じ名前のボタンが複数ある場合など、操作範囲を絞りたい時:

```bash
# 1. ページ移動と観察
curl --json '{"action":"goto","args":{"url":"https://example.com/posts"}}' http://localhost:3000/exec
curl --json '{"action":"observe"}' http://localhost:3000/exec

# 2. 特定の記事カードにスコープを絞る
curl --json '{"action":"section","args":{"description":"最新の記事カード"}}' http://localhost:3000/exec

# 3. そのカード内のリンクをクリック
curl --json '{"action":"clickLink","args":{"description":"続きを読む"}}' http://localhost:3000/exec

# 4. スコーピング解除
curl --json '{"action":"resetSection"}' http://localhost:3000/exec

# 5. ページ全体に戻って観察
curl --json '{"action":"observe"}' http://localhost:3000/exec
```

---

## 認証

CDPモードは既存のChromeセッションに接続する。ログイン済みのCookieやセッションをそのまま使えるため、認証情報をスキルに渡す必要がない。

Chromeが起動していない場合:

```bash
bun run chrome
```

これにより、`~/chrome-automation` のプロファイルをコピーしてCDPポート9222で起動する。通常のChromeでログインしてあれば、セッションがそのまま引き継がれる。
