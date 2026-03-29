# PLAYWRIGHT-CDP — Playwright CDP + ヘルパーAPI

## CDP とは何か

CDP（Chrome DevTools Protocol）は、ChromeブラウザをプログラムからコントロールするためのAPI。
普段、ブラウザの開発者ツールを使ってコンソールを操作したり、ネットワークタブを見たりするとき、内部ではCDPが動いている。

`--remote-debugging-port=9222` でChromeを起動すると、外部プログラムがCDPを通じてそのChromeを操作できるようになる。

### なぜCDPを使うのか

| アプローチ | 特徴 |
|-----------|------|
| Playwright が新しいChromiumを起動 | ログイン不要のサイトには便利。ただしCookieなし |
| **Playwright CDP（本ツール）** | 既存Chromeに接続。ログイン済み、Cookie・セッション・拡張機能をそのまま使える |

普段使っているChromeにログインしたまま操作できるため、storageStateの管理が不要。

## ヘルパーAPI（createAgent）

### 概要

`createAgent(page)` はPlaywrightの `Page` オブジェクトを受け取り、自然言語で要素を指定できる `WebAgent` オブジェクトを返す。

```typescript
import { createAgent } from "../src/helpers/index.ts";

const agent = createAgent(page);

// CSSセレクタを書く必要がない
await agent.fillField('メールアドレス', 'user@example.com');
await agent.clickButton('ログイン');
await agent.waitForText('ダッシュボード');
```

### page を prebind する設計の意図

LLMが生成するコードをシンプルにするため、`page` 引数は `createAgent()` の時点でバインドされる。

```typescript
// LLMが書くコード（pageを意識しない）
const agent = createAgent(page);
await agent.clickButton('投稿');

// vs 生のPlaywright（LLMが覚えるべきAPIが多い）
const button = await page.getByRole('button', { name: '投稿' });
await button.click();
```

9Bクラスのローカルモデルでも安定してコードを生成できる。

## ロケーター解決戦略

ヘルパーAPIの内部では、アクション種別ごとに異なる解決戦略を使う。汎用的な「なんでも試す」ラダーではなく、ボタン専用・フィールド専用・リンク専用の戦略がある。

### ボタン（clickButton）

```
1. getByRole('button', { name: description })
2. getByRole('link', { name: description })   ← ボタン風リンク対応
3. DOMスコアリング（button/a要素のみ対象）
```

### フィールド（fillField）

```
1. getByLabel(description)
2. getByPlaceholder(description)
3. getByRole('textbox', { name: description })
4. getByRole('combobox', { name: description })
5. DOMスコアリング（input/textarea/select/[contenteditable] のみ対象）
```

### リンク（clickLink）

```
1. getByRole('link', { name: description })
2. getByText(description).filter({ has: page.locator('a') })
3. DOMスコアリング（a要素のみ対象）
```

### テキスト検索（extractText, waitForText）

```
1. getByText(description)
2. getByLabel(description)
3. getByRole(description)   ← heading, status 等
4. DOMスコアリング（可視テキスト要素対象）
```

### 設計上の重要な判断

- **毎回フレッシュに解決** — キャッシュなし。SPAが再レンダリングしても正しい要素を取得できる
- **`root` に `Page | Locator` を受け入れる** — `agent.section()` でスコープを絞ることが可能
- **iframeは v1 スコープ外** — 将来 `inFrame()` で対応予定

## リペアループの仕組み

### 通常フロー（ハッピーパス）

```
LLM がスクリプト生成 → bun run → 成功 → 終了
```

1回のLLM呼び出しで完了。

### 失敗時のフロー

```
bun run → 失敗 → error-report.json 出力 → LLMが修正 → 再実行（1回のみ）
```

スクリプトが `ActionError` で失敗した場合、構造化エラーを `results/error-report.json` に出力する。

### error-report.json の構造

```json
{
  "action": "clickButton",
  "description": "投稿する",
  "failureType": "not_found",
  "triedStrategies": ["getByRole('button')", "getByRole('link')", "domScoring"],
  "candidates": [],
  "currentUrl": "https://example.com/compose",
  "pageTitle": "新規投稿",
  "message": "clickButton(\"投稿する\") failed: \"投稿する\" に一致する要素が見つかりません",
  "screenshot": "results/screenshots/error.png",
  "url": "https://example.com/compose"
}
```

### failureType ごとの修正方針

| failureType | 意味 | 修正方針 |
|-------------|------|---------|
| `not_found` | descriptionに一致する要素がない | ページ上の実際のラベルに合わせてdescriptionを変更 |
| `ambiguous` | 同名要素が複数ある | `agent.section()` でスコープを絞る |
| `not_actionable` | 要素は見つかったが操作できない | `waitForVisible()` を追加、またはエスケープハッチ |
| `timeout` | タイムアウト | タイムアウト値を増やす、または待機条件を変更 |

## APIリファレンス

### アクション

| API | 用途 | 例 |
|-----|------|-----|
| `agent.clickButton(description)` | ボタンをクリック | `agent.clickButton('投稿')` |
| `agent.clickLink(description)` | リンクをクリック | `agent.clickLink('次のページ')` |
| `agent.click(description)` | 汎用クリック（タブ、メニュー等） | `agent.click('メニューアイコン')` |
| `agent.fillField(description, value)` | テキスト入力 | `agent.fillField('検索欄', 'キーワード')` |
| `agent.selectOption(description, value)` | セレクトボックス | `agent.selectOption('国', '日本')` |
| `agent.check(description)` | チェックボックスをオン | `agent.check('利用規約に同意')` |
| `agent.uncheck(description)` | チェックボックスをオフ | `agent.uncheck('メール通知')` |

### 待機

| API | 用途 | 例 |
|-----|------|-----|
| `agent.waitForText(text)` | テキスト出現を待機 | `agent.waitForText('投稿完了')` |
| `agent.waitForUrl(pattern)` | URL変更を待機 | `agent.waitForUrl('/dashboard')` |
| `agent.waitForVisible(description)` | 要素表示を待機 | `agent.waitForVisible('検索結果')` |
| `agent.waitForHidden(description)` | 要素非表示を待機 | `agent.waitForHidden('ローディング')` |

### 検証

| API | 用途 | 例 |
|-----|------|-----|
| `agent.assertVisible(description)` | 要素が表示されているか確認 | `agent.assertVisible('ログアウト')` |
| `agent.assertText(description, expected)` | テキスト一致を確認 | `agent.assertText('価格', '¥1,000')` |

### データ抽出

| API | 用途 | 例 |
|-----|------|-----|
| `agent.extractText(description)` | テキスト取得 | `agent.extractText('商品名')` |
| `agent.extractTexts(description)` | 複数テキスト取得 | `agent.extractTexts('記事タイトル')` |
| `agent.extractAttribute(description, attr)` | 属性取得 | `agent.extractAttribute('プロフィール画像', 'src')` |

### スコーピング

| API | 用途 | 例 |
|-----|------|-----|
| `agent.section(description)` | 特定セクション内に限定した新agentを返す | `const sidebar = await agent.section('サイドバー')` |

スコーピングは同名要素が複数存在する場合に使う。

```typescript
// ヘッダーの「設定」リンクをクリック（フッターの「設定」と区別）
const header = await agent.section('ヘッダー');
await header.clickLink('設定');
```

### スクリーンショット

| API | 用途 |
|-----|------|
| `agent.screenshot(path)` | スクリーンショットを保存 |

### エスケープハッチ

ヘルパーAPIで対応できない場合の最終手段。

| API | 用途 |
|-----|------|
| `agent.page.evaluate(() => { ... })` | 任意のDOM操作・データ取得 |
| `agent.page.locator(selector)` | CSSセレクタで要素を取得 |

```typescript
// ページタイトルを取得
const title = await agent.page.evaluate(() => document.title);

// テーブルデータを一括取得
const rows = await agent.page.evaluate(() =>
  Array.from(document.querySelectorAll('table tbody tr')).map(row => ({
    name: row.cells[0]?.textContent?.trim(),
    value: row.cells[1]?.textContent?.trim(),
  }))
);
```

詳細なレシピは `.taskp/skills/web-agent/SKILL.md` を参照。

## 旧アーキテクチャとの比較

| 項目 | 旧（Midscene） | 新（Playwright CDP + ヘルパーAPI） |
|------|--------------|----------------------------------|
| 要素特定 | Vision LLM がスクリーンショットを画像認識 | DOM直接アクセス（アクション別ロケーター解決） |
| 必要なLLM | 2層（コード生成 + Vision） | 1層（コード生成のみ） |
| ブラウザ起動 | Playwright が新しいChromiumを起動 | 既存ChromeにCDP接続 |
| ログイン状態 | storageStateで管理 | Chromeのセッションをそのまま利用 |
| エラー情報 | Midscene HTMLレポート | error-report.json（構造化JSON） |
| ローカルLLM | Vision対応モデル必須（7B以上推奨） | テキストモデルのみで動作（7Bで十分） |
| 速度 | スクリーンショット撮影 + Vision LLM推論が毎ステップ | DOM操作のみ、Vision推論なし |
