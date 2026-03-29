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

# Web Agent — ブラウザ自律操作

## 操作対象

- **URL**: {{url}}

## やりたいこと

{{task}}

{{#if after_command}}
## 完了後コマンド

操作が完了したら以下のコマンドを実行してください:

```
{{after_command}}
```
{{/if}}

## 実行手順

### Step 1: 操作スクリプトの生成

まず `bash` ツールで出力先ディレクトリを作成してください:

```bash
mkdir -p {{__cwd__}}/.taskp-tmp
```

次に、`read` ツールでテンプレートを読み込んでください:

```
{{__skill_dir__}}/templates/runner.ts
```

テンプレートを元に、操作内容を実装したスクリプトを `{{__cwd__}}/.taskp-tmp/agent-run.ts` に `write` ツールで生成してください。

**テンプレートのプレースホルダーを埋める:**

| プレースホルダー | 値 |
|----------------|-----|
| `\{{TARGET_URL}}` | {{url}} |
| `\{{CDP_ENDPOINT}}` | config.json の `cdpEndpoint` |
| `\{{SCREENSHOT_DIR}}` | config.json の `screenshotDir` |
| `\{{TIMEOUT}}` | config.json の `timeout` |

**スクリプト生成ルール:**

- `createAgent(page)` で agent を作り、`agent.xxx()` でDOM操作する
- 生のCSSセレクタやXPathは使わない（agent が内部で自動検出する）
- 抽出データは `console.log` で JSON 出力する
- `bun run` で実行する（`tsx` ではない）
- import パスは `../src/helpers/index.ts`（`.taskp-tmp/agent-run.ts` からの相対パス）
- `finally` ブロックで `page.close()` → `browser.close()` → `process.exit(exitCode)` を必ず呼ぶ
- `waitForNavigation` は使わない。代わりに `waitForUrl` または `waitForText` を使う

### Step 2: スクリプトの実行

`bash` ツールで以下のコマンドを実行してください:

```bash
bun run {{__cwd__}}/.taskp-tmp/agent-run.ts
```

> `tsx` ではなく `bun run` を使うこと

**失敗時のリペアループ:**

スクリプトが失敗した場合:

1. `read` ツールで `results/error-report.json` を読む
2. エラーレポートの `failureType` に応じてスクリプトを修正する:
   - `not_found`: `description` を変更（ページ上の実際のラベルに合わせる）
   - `ambiguous`: `agent.section()` でスコープを絞る
   - `not_actionable`: `agent.waitForVisible()` を追加するか、エスケープハッチを使う
   - `timeout`: タイムアウト値を増やすか、待機条件を変更する
3. 修正したスクリプトを再実行する（**最大1回のリトライ**）
4. 2回目も失敗した場合はエラーを報告して停止する

### Step 3: 完了後コマンドの実行

スクリプトが正常終了した場合、`after_command` が指定されていれば `bash` ツールで実行してください。スクリプトの stdout に出力されたデータは、完了後コマンドにパイプで渡せます。

### Step 4: 結果の報告

以下を報告してください:

- 実行した操作の概要
- 保存されたスクリーンショットのパス
- 抽出データの内容（該当する場合）
- 完了後コマンドの実行結果（該当する場合）

## スキル設定

config.json の内容が context で自動挿入されています。スクリプト生成時にこれらの設定値を使用してください。

| キー | 説明 |
|------|------|
| `screenshotDir` | スクリーンショット保存先 |
| `authDir` | ログイン状態（storageState）の保存先 |
| `timeout` | 操作全体のタイムアウト（ms） |
| `cdpEndpoint` | Chrome CDP接続先（例: `http://localhost:9222`） |
| `viewport.width` / `viewport.height` | ブラウザのビューポートサイズ |

## Agent API リファレンス

`createAgent(page)` で作成した agent を使ってスクリプトを生成してください。**生のCSSセレクタやXPathは使わないでください。** agent が内部で最適な要素を自動検出します。

### アクション

| API | 用途 | 例 |
|-----|------|-----|
| `agent.clickButton(description)` | ボタンをクリック | `agent.clickButton('投稿')` |
| `agent.clickLink(description)` | リンクをクリック | `agent.clickLink('次のページ')` |
| `agent.click(description)` | 汎用クリック（タブ、メニュー、カード等） | `agent.click('メニューアイコン')` |
| `agent.fillField(description, value)` | テキスト入力 | `agent.fillField('検索欄', 'キーワード')` |
| `agent.selectOption(description, value)` | 選択 | `agent.selectOption('国', '日本')` |
| `agent.check(description)` | チェックボックスをオン | `agent.check('利用規約に同意')` |
| `agent.uncheck(description)` | チェックボックスをオフ | `agent.uncheck('メール通知')` |

### 待機

| API | 用途 | 例 |
|-----|------|-----|
| `agent.waitForText(text)` | テキスト出現を待機 | `agent.waitForText('投稿完了')` |
| `agent.waitForUrl(pattern)` | URL変更を待機 | `agent.waitForUrl('/dashboard')` |
| `agent.waitForVisible(description)` | 要素の表示を待機 | `agent.waitForVisible('検索結果')` |
| `agent.waitForHidden(description)` | 要素の非表示を待機 | `agent.waitForHidden('ローディング')` |

### 検証

| API | 用途 | 例 |
|-----|------|-----|
| `agent.assertVisible(description)` | 要素が表示されているか | `agent.assertVisible('ログアウト')` |
| `agent.assertText(description, expected)` | テキスト一致を検証 | `agent.assertText('価格', '¥1,000')` |

### データ抽出

| API | 用途 | 例 |
|-----|------|-----|
| `agent.extractText(description)` | テキスト取得 | `agent.extractText('商品名')` |
| `agent.extractTexts(description)` | 複数テキスト取得 | `agent.extractTexts('記事タイトル')` |
| `agent.extractAttribute(description, attr)` | 属性取得 | `agent.extractAttribute('プロフィール画像', 'src')` |

### スコーピング（同名要素が複数ある場合）

| API | 用途 | 例 |
|-----|------|-----|
| `agent.section(description)` | セクション内に限定した新 agent を返す | `const sidebar = await agent.section('サイドバー')` |

### スクリーンショット

| API | 用途 |
|-----|------|
| `agent.screenshot(path)` | スクリーンショットを保存 |

### エスケープハッチ（最終手段のみ）

| API | 用途 |
|-----|------|
| `agent.page.evaluate(() => { ... })` | 任意のDOM操作 |
| `agent.page.locator(selector)` | CSSセレクタで要素取得 |

## レシピ（使用例）

### レシピ1: フォーム投稿

```typescript
await agent.fillField('タイトル', '新しい記事');
await agent.fillField('本文', '記事の内容です');
await agent.clickButton('投稿');
await agent.waitForText('投稿が完了しました');
await agent.screenshot(`${SCREENSHOT_DIR}/posted.png`);
```

### レシピ2: 検索 + データ抽出

```typescript
await agent.fillField('検索', 'Playwright');
await agent.clickButton('検索');
await agent.waitForVisible('検索結果');
const titles = await agent.extractTexts('検索結果のタイトル');
console.log(JSON.stringify(titles, null, 2));
```

### レシピ3: ログイン確認 + ナビゲーション

```typescript
const isLoggedIn = await agent.page.evaluate(() =>
  !!document.querySelector('[data-testid="user-menu"]')
);
if (!isLoggedIn) {
  console.error('❌ ログインされていません');
  process.exit(1);
}
await agent.clickLink('ダッシュボード');
await agent.waitForUrl('/dashboard');
```

### レシピ4: スコーピング（重複ラベル対応）

```typescript
const header = await agent.section('ヘッダー');
await header.clickLink('設定');

const main = await agent.section('メインコンテンツ');
const title = await main.extractText('タイトル');
```

### レシピ5: テーブルデータ抽出

```typescript
const data = await agent.page.evaluate(() =>
  Array.from(document.querySelectorAll('table tbody tr')).map(row => ({
    name: row.cells[0]?.textContent?.trim(),
    price: row.cells[1]?.textContent?.trim(),
  }))
);
console.log(JSON.stringify(data, null, 2));
```

## 認証

CDP接続モードでは、起動済みの Chrome ブラウザをそのまま操作します。Chrome にログイン済みであれば、追加の認証設定は不要です。

### storageState による認証（フォールバック）

CDP が使えない環境や別セッションが必要な場合は、storageState を使います。

**ログイン状態の保存:**

```bash
bun run src/login.ts <url> <site-name>
```

headed モードでブラウザが開くので、手動でログインしてから Enter を押してください。`auth/<site-name>.json` にセッションが保存されます。

**スクリプトでの使用:**

操作対象の URL のホスト名から site-name を導出し、`auth/` ディレクトリに対応する JSON ファイルが存在する場合は `browser.newContext({ storageState: AUTH_FILE })` で復元してください。

例:
- `https://github.com/...` → `auth/github.json` があれば `AUTH_FILE = "auth/github.json"`
- `https://admin.example.com/dashboard` → `auth/admin.example.com.json`
- 認証不要 or ファイルなし → storageState の設定をスキップ

## リペアループ（失敗時の自動リトライ）

スクリプトが失敗すると `results/error-report.json` に構造化エラーが出力されます。

**error-report.json の構造:**

```json
{
  "action": "clickButton",
  "description": "投稿",
  "failureType": "not_found",
  "triedStrategies": ["getByRole('button')", "getByText()"],
  "candidates": [],
  "currentUrl": "https://example.com/editor",
  "pageTitle": "記事編集",
  "message": "clickButton(\"投稿\") failed: \"投稿\" に一致する要素が見つかりません"
}
```

**failureType 別の対処:**

| failureType | 原因 | 対処 |
|-------------|------|------|
| `not_found` | description がページ上のラベルと一致しない | description を実際のボタン文字に変更 |
| `ambiguous` | 同名要素が複数ある | `agent.section()` でスコープを絞る |
| `not_actionable` | 要素が非表示または無効 | `agent.waitForVisible()` を前に追加する |
| `timeout` | 処理が遅い、またはSPAのレンダリング待ち | `waitForText` / `waitForUrl` を追加する |

**リトライは最大1回**。2回目も失敗した場合はエラーを報告して停止してください。
