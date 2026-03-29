# PLAYWRIGHT-CDP — Playwright CDP + ヘルパーAPI

## CDP とは何か

CDP（Chrome DevTools Protocol）は、ChromeブラウザをプログラムからコントロールするためのAPI。ブラウザの開発者ツールを使うときに内部で動いているのがこれ。

`--remote-debugging-port=9222` でChromeを起動すると、外部プログラムがCDPを通じてそのChromeを操作できるようになる。

### なぜCDPを使うのか

| アプローチ | 特徴 |
|-----------|------|
| Playwright が新しいChromiumを起動 | ログイン不要のサイトには便利。ただしCookieなし |
| **Playwright CDP（本ツール）** | 既存Chromeに接続。ログイン済み、Cookie・セッション・拡張機能をそのまま使える |

普段使っているChromeにログインしたまま操作できるため、storageStateの管理が不要。

## REPL サーバーと CDP

REPL サーバー（`src/repl-server.ts`）は起動時に CDP で Chrome に接続する。

```typescript
const browser = await chromium.connectOverCDP(cdpEndpoint);
const [context] = browser.contexts();
```

セッションごとに新しいタブを作成し、そのタブに `createAgent(page)` をバインドする。

```typescript
async function getOrCreateSession(id: string): Promise<Session> {
  const page = await context.newPage();
  const rootAgent = createAgent(page);
  const session = { id, page, rootAgent, currentAgent: rootAgent, ... };
  sessions.set(id, session);
  return session;
}
```

こうすることで、複数のセッションが同時に別々のタブで動ける。

## ヘルパーAPI（createAgent）

### 概要

`createAgent(page)` は Playwright の `Page` オブジェクトを受け取り、自然言語で要素を指定できる `WebAgent` オブジェクトを返す。

```typescript
import { createAgent } from "../src/helpers/index.ts";

const agent = createAgent(page);

// CSSセレクタを書く必要がない
await agent.fillField('メールアドレス', 'user@example.com');
await agent.clickButton('ログイン');
await agent.waitForText('ダッシュボード');
```

REPL サーバー経由で使う場合は、LLM が curl でアクション名と引数を送るだけでよい。

### page を prebind する設計の意図

LLM が発行する curl コマンドをシンプルに保つため、`page` 引数は `createAgent()` の時点でバインドされる。アクション名と自然言語の description だけで操作が完結する。

## ロケーター解決戦略

ヘルパーAPI の内部では、アクション種別ごとに異なる解決戦略を使う。汎用的な「なんでも試す」ラダーではなく、ボタン専用・フィールド専用・リンク専用の戦略がある。

### ボタン（clickButton）

```
1. getByRole('button', { name: description })
2. getByRole('link', { name: description })   ← ボタン風リンク対応
3. button/a/[role='button'] 要素のテキストフィルタ
```

### フィールド（fillField）

```
1. getByLabel(description)
2. getByPlaceholder(description)
3. getByRole('textbox', { name: description })
4. getByRole('combobox', { name: description })
5. getByRole('spinbutton', { name: description })
```

### リンク（clickLink）

```
1. getByRole('link', { name: description })
2. a 要素のテキストフィルタ
```

### テキスト検索（extractText, waitForVisible 等）

```
1. getByText(description, { exact: false })
2. getByLabel(description)
3. getByRole('heading', { name: description })
```

### 設計上の重要な判断

- **毎回フレッシュに解決** — キャッシュなし。SPAが再レンダリングしても正しい要素を取得できる
- **`root` に `Page | Locator` を受け入れる** — `section` アクションでスコープを絞ることが可能
- **iframeは v1 スコープ外** — 将来の拡張で対応予定

## step-by-step 実行と適応的な失敗対応

従来の「スクリプト生成 → 一括実行 → 失敗時リペアループ」とは異なり、現在は1操作ごとにレスポンスを確認する。

### 通常フロー

```
LLM が curl 送信 → REPL サーバーが実行 → レスポンス確認 → 次の curl へ
```

### 失敗時の対応

```
ok: false のレスポンス → observe で現在の状態を確認 → description を修正 → 再送信
```

スクリプト全体を修正して再実行するのではなく、次のリクエストで即座に対応できる。これにより「最大1回のリトライ」という制約がなくなり、LLM が自由に判断できる。

### ActionError のレスポンス

ヘルパーAPI が要素の特定に失敗すると `ActionError` になる。REPL サーバーはこれを JSON に変換する。

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
  }
}
```

### failureType ごとの対応

| failureType | 意味 | 対処 |
|-------------|------|------|
| `not_found` | descriptionに一致する要素がない | observe で正しいラベルを確認して再試行 |
| `ambiguous` | 同名要素が複数ある | `section` アクションでスコープを絞る |
| `not_actionable` | 要素は見つかったが操作不可 | `waitForVisible` を先に実行する |
| `timeout` | タイムアウト | `timeoutMs` を増やす |

## APIリファレンス

### アクション

| アクション | 用途 | 引数 |
|------------|------|------|
| `clickButton` | ボタンをクリック | `description` |
| `clickLink` | リンクをクリック | `description` |
| `click` | 汎用クリック（タブ、メニュー等） | `description` |
| `fillField` | テキスト入力 | `description`, `value` |
| `selectOption` | セレクトボックス選択 | `description`, `value` |
| `check` | チェックボックスをオン | `description` |
| `uncheck` | チェックボックスをオフ | `description` |

### 待機

| アクション | 用途 | 引数 |
|------------|------|------|
| `waitForText` | テキスト出現を待機 | `text`, `timeoutMs` |
| `waitForUrl` | URL変更を待機 | `pattern`, `timeoutMs` |
| `waitForVisible` | 要素表示を待機 | `description`, `timeoutMs` |
| `waitForHidden` | 要素非表示を待機 | `description`, `timeoutMs` |

### 検証

| アクション | 用途 | 引数 |
|------------|------|------|
| `assertVisible` | 要素が表示されているか確認 | `description` |
| `assertText` | テキスト一致を確認 | `description`, `expected` |

### データ抽出

| アクション | 用途 | 引数 |
|------------|------|------|
| `extractText` | テキスト取得 | `description` |
| `extractTexts` | 複数テキスト取得 | `description` |
| `extractAttribute` | 属性取得 | `description`, `attribute` |

### スコーピング

| アクション | 用途 | 引数 |
|------------|------|------|
| `section` | 特定セクション内に限定した操作コンテキストに切り替え | `description` |
| `resetSection` | スコープをページ全体に戻す | なし |

スコーピングは同名要素が複数存在する場合に使う。

```bash
# ヘッダーの「設定」リンクをクリック（フッターの「設定」と区別）
curl --json '{"action":"section","args":{"description":"ヘッダー"}}' \
  'http://localhost:3000/exec?session=s'
curl --json '{"action":"clickLink","args":{"description":"設定"}}' \
  'http://localhost:3000/exec?session=s'
curl --json '{"action":"resetSection"}' \
  'http://localhost:3000/exec?session=s'
```

### その他

| アクション | 用途 | 引数 |
|------------|------|------|
| `goto` | ページ移動 | `url`, `timeoutMs` |
| `observe` | ページ状態の取得 | なし |
| `screenshot` | スクリーンショット保存 | `path` |
| `evaluateFile` | ファイルの JS を evaluate | `path` |
| `close` | セッションを閉じてヒストリを保存 | なし |
| `replay` | 保存済みスクリプトを再実行 | `path` |

## セッション管理の詳細

### セッションの状態

```typescript
interface Session {
  id: string;
  page: Page;           // このセッション専用のタブ
  rootAgent: WebAgent;  // ページ全体のエージェント
  currentAgent: WebAgent; // section 後は絞り込まれたエージェント
  busy: boolean;        // 同時リクエスト防止
  history: RecordedAction[]; // 再実行用ヒストリ
  failed: boolean;      // エラー発生フラグ（close 時に保存スキップ）
}
```

### ヒストリに記録されないアクション

`observe` と `close` はヒストリに記録されない。replay 時に不要だから。

### close 時の保存

```
close → failed が false かつ history が空でない
      → results/scripts/{sessionId}.json に保存
      → レスポンスに保存パスを含む
```

## HTTP エンドポイント

| メソッド | パス | 役割 |
|---------|------|------|
| `GET` | `/health` | サーバー状態と現在のセッション一覧 |
| `POST` | `/exec?session=xxx` | アクション実行 |
| `POST` | `/shutdown` | サーバー停止 |

### /exec のリクエスト形式

```json
{
  "action": "アクション名",
  "args": {
    "description": "要素の説明",
    "value": "入力値"
  },
  "timeoutMs": 30000
}
```

### /exec のレスポンス形式

```json
{
  "ok": true,
  "result": null,
  "session": "session-id",
  "state": {
    "url": "https://example.com",
    "title": "ページタイトル"
  },
  "meta": {
    "durationMs": 312
  }
}
```
