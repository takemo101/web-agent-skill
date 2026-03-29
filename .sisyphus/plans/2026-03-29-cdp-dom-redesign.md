# CDP + DOM直接操作 アーキテクチャ再設計

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Midscene Vision LLMアプローチを廃止し、Playwright CDP接続 + ヘルパーAPI + LLMコード生成によるDOM直接操作アーキテクチャに移行する。

**Architecture:** LLM（第1層）が `createAgent(page)` で作った agent オブジェクト経由で `agent.clickButton()`, `agent.fillField()` 等を呼ぶ TypeScript コードを生成する。ヘルパー内部のアクション別ロケーター解決が実行時に正しい要素を自動特定。CDP接続により既存Chromeのセッション・Cookie・拡張機能をそのまま利用。

**Tech Stack:** Playwright (CDP), TypeScript, Bun, taskp

---

## 設計思想

### 現行 vs 新アーキテクチャ

```
【現行】taskp LLM → Midsceneスクリプト生成 → Vision LLMがスクショ画像認識して操作
【新】  taskp LLM → agent.xxxヘルパー呼び出しコード生成 → ヘルパーがDOM直接操作
```

### sitegeistから取り入れるパターン

| パターン | sitegeist | 我々の実装 |
|---------|-----------|-----------|
| DOM操作 | `browserjs(() => { ... })` via Chrome拡張 | ヘルパーAPI + `page.evaluate()` via Playwright CDP |
| ナビゲーション | Chrome Extension API | `page.goto()` (Playwright) |
| スクリーンショット | HTMLレポートのみ | `page.screenshot()` (CDP接続で使用可能) |
| エラー時の適応 | LLMとの対話ループ | taskp agentモードで失敗時のみ2回目のLLM呼び出し |

### 設計原則（Oracleレビュー反映）

1. **LLMに生のPlaywrightコードを書かせない** — ヘルパーAPIのみを使わせる
2. **page引数をprebind** — `agent.clickButton('投稿')` のように page を隠す（9Bモデル向け簡素化）
3. **アクション別のロケーター解決** — 汎用ラダーではなくボタン用・フィールド用・リンク用で異なる戦略
4. **常に新しいタブ** — `context.pages()[0]` でユーザーの既存タブをハイジャックしない
5. **`browser.disconnect()`** — `browser.close()` はユーザーのChromeを閉じてしまうため使わない
6. **失敗時のみリペアループ** — ハッピーパスは1回のLLM呼び出し。失敗時に構造化エラー → 2回目

---

## ファイル構成

### 新規作成

| ファイル | 責務 |
|---------|------|
| `src/helpers/locator.ts` | アクション別ロケーター解決（ボタン/フィールド/リンク/テキスト別の戦略） |
| `src/helpers/actions.ts` | ヘルパーAPI — `clickButton`, `fillField`, `extractText` 等 |
| `src/helpers/agent.ts` | `createAgent(page)` — page をバインドしたagentオブジェクト生成 |
| `src/helpers/errors.ts` | `ActionError` クラス — 構造化エラー（リペアループ用） |
| `src/helpers/index.ts` | エクスポートバレル |
| `src/chrome.ts` | Chrome CDPエンドポイントのプローブ + 手動起動案内 |
| `.taskp/skills/web-agent/templates/runner.ts` | 新テンプレート（CDP接続 + agent import） |
| `docs/PLAYWRIGHT-CDP.md` | 新アーキテクチャドキュメント |
| `tests/helpers/locator.test.ts` | ロケーターのテスト（HTMLフィクスチャ含む） |
| `tests/helpers/actions.test.ts` | ヘルパーAPIのテスト |
| `tests/fixtures/` | テスト用HTMLフィクスチャ（フォーム、重複ラベル、SPA等） |

### 修正

| ファイル | 変更内容 |
|---------|---------|
| `package.json` | `@midscene/web` 削除、setupスクリプト変更 |
| `.env.example` | MIDSCENE_* 全削除、CDP_ENDPOINT 追加 |
| `.taskp/skills/web-agent/SKILL.md` | agent APIリファレンス + レシピ + リペアループ手順に全面書き換え |
| `.taskp/skills/web-agent/config.json` | Midscene固有設定削除、cdpEndpoint追加 |
| `src/login.ts` | CDP接続モード追加（`browser.disconnect()` 使用） |
| `docs/ARCHITECTURE.md` | 新アーキテクチャ図に書き換え |
| `docs/SETUP.md` | Chrome CDP起動手順に書き換え |
| `docs/CONCEPT.md` | 技術スタック説明を更新 |
| `docs/SKILL-DESIGN.md` | 入力・テンプレート設計を更新 |
| `README.md` | 技術スタック、使い方を更新 |

### 削除

| ファイル | 理由 |
|---------|------|
| `.taskp/skills/web-agent/templates/agent-runner.ts` | Midscene依存 |
| `.taskp/skills/web-agent/templates/bridge-runner.ts` | Midscene Bridge Mode |
| `docs/MIDSCENE-INTEGRATION.md` | Midscene固有 |
| `docs/MODEL-STRATEGY.md` | Vision LLM選定ドキュメント（不要） |
| `midscene_run/` | Midscene出力ディレクトリ |
| `SITEGEIST_*.md` | 分析用一時ファイル |

---

## 詳細設計

### 1. アクション別ロケーター解決 (`src/helpers/locator.ts`)

**汎用ラダーではなく、アクション種別に応じた解決戦略を持つ。**

```typescript
import type { Page, Locator, Frame } from "playwright";

interface ResolveResult {
  locator: Locator;
  strategy: string;
  confidence: "high" | "medium" | "low";
}

// アクション種別に応じた解決
async function resolveButton(root: Page | Locator, description: string): Promise<ResolveResult>
// 1. getByRole('button', { name: description })
// 2. getByRole('link', { name: description })   ← ボタン風リンク
// 3. getByText(description).filter({ has: page.locator('button, [role="button"], a') })
// 4. DOMスコアリング（button/a要素のみ対象）

async function resolveField(root: Page | Locator, description: string): Promise<ResolveResult>
// 1. getByLabel(description)
// 2. getByPlaceholder(description)
// 3. getByRole('textbox', { name: description })
// 4. getByRole('combobox', { name: description })
// 5. DOMスコアリング（input/textarea/select/[contenteditable]のみ対象）

async function resolveLink(root: Page | Locator, description: string): Promise<ResolveResult>
// 1. getByRole('link', { name: description })
// 2. getByText(description).filter({ has: page.locator('a') })
// 3. DOMスコアリング（a要素のみ対象）

async function resolveText(root: Page | Locator, description: string): Promise<ResolveResult>
// 1. getByText(description)
// 2. getByLabel(description)
// 3. getByRole(description)  ← heading, etc.
// 4. DOMスコアリング（可視テキスト要素対象）
```

**重要な設計判断:**
- `root` が `Page | Locator` を受け入れる → スコーピング対応（特定セクション内のみ検索）
- 毎回フレッシュに解決（キャッシュなし）→ SPA再レンダリング対策
- iframe は v1 ではスコープ外。将来 `inFrame()` で対応可能な設計にしておく
- open shadow DOM は Playwright が自動対応。closed shadow DOM はスコープ外

### 2. エラー型 (`src/helpers/errors.ts`)

```typescript
export class ActionError extends Error {
  constructor(
    public readonly action: string,
    public readonly description: string,
    public readonly triedStrategies: string[],
    public readonly candidates: Array<{ selector: string; text: string; score: number }>,
    public readonly failureType: "not_found" | "ambiguous" | "not_actionable" | "timeout",
    public readonly currentUrl: string,
    public readonly pageTitle: string,
  ) {
    const suggestion = failureType === "ambiguous"
      ? `${candidates.length}個の候補が見つかりました: ${candidates.map(c => `"${c.text}"`).join(", ")}`
      : failureType === "not_found"
      ? `"${description}" に一致する要素が見つかりません`
      : `要素は見つかりましたが操作できません（${failureType}）`;

    super(`${action}("${description}") failed: ${suggestion}`);
    this.name = "ActionError";
  }

  toJSON() {
    return {
      action: this.action,
      description: this.description,
      triedStrategies: this.triedStrategies,
      candidates: this.candidates,
      failureType: this.failureType,
      currentUrl: this.currentUrl,
      pageTitle: this.pageTitle,
      message: this.message,
    };
  }
}
```

### 3. Agent ファクトリ (`src/helpers/agent.ts`)

**page を prebind し、LLMが書くコードをシンプルにする。**

```typescript
import type { Page, Locator } from "playwright";

export interface WebAgent {
  // --- アクション ---
  clickButton(description: string): Promise<void>;
  clickLink(description: string): Promise<void>;
  click(description: string): Promise<void>;         // 汎用クリック（タブ、メニュー、カード等）
  fillField(description: string, value: string): Promise<void>;
  selectOption(description: string, value: string): Promise<void>;
  check(description: string): Promise<void>;          // チェックボックス
  uncheck(description: string): Promise<void>;

  // --- 待機 ---
  waitForText(text: string, opts?: { timeout?: number }): Promise<void>;
  waitForUrl(pattern: string, opts?: { timeout?: number }): Promise<void>;
  waitForVisible(description: string, opts?: { timeout?: number }): Promise<void>;
  waitForHidden(description: string, opts?: { timeout?: number }): Promise<void>;

  // --- 検証 ---
  assertVisible(description: string): Promise<void>;
  assertText(description: string, expected: string): Promise<void>;

  // --- データ抽出 ---
  extractText(description: string): Promise<string>;
  extractTexts(description: string): Promise<string[]>;
  extractAttribute(description: string, attribute: string): Promise<string | null>;

  // --- スコーピング ---
  section(description: string): Promise<WebAgent>;     // 特定セクション内に限定した新agentを返す

  // --- スクリーンショット ---
  screenshot(path: string): Promise<void>;

  // --- エスケープハッチ ---
  readonly page: Page;                                  // 生のPlaywright Page
}

export function createAgent(page: Page): WebAgent;
```

**LLMが書くコード例:**
```typescript
const agent = createAgent(page);

await agent.fillField('投稿内容', '今日は気分がいいです');
await agent.clickButton('投稿');
await agent.waitForText('投稿が完了しました');
await agent.screenshot(`${SCREENSHOT_DIR}/after-post.png`);

// スコーピング（同名ボタンが複数ある場合）
const sidebar = await agent.section('サイドバー');
await sidebar.clickLink('設定');

// エスケープハッチ
const title = await agent.page.evaluate(() => document.title);
```

### 4. テンプレート (`templates/runner.ts`)

```typescript
import { mkdirSync, writeFileSync } from "fs";
import { chromium } from "playwright";
import { createAgent } from "../src/helpers/index.ts";

const TARGET_URL = "{{TARGET_URL}}";
const CDP_ENDPOINT = "{{CDP_ENDPOINT}}";
const SCREENSHOT_DIR = "{{SCREENSHOT_DIR}}";
const TIMEOUT = {{TIMEOUT}};

mkdirSync(SCREENSHOT_DIR, { recursive: true });

const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
const context = browser.contexts()[0];
const page = await context.newPage();

await page.goto(TARGET_URL, { timeout: TIMEOUT, waitUntil: "domcontentloaded" });

const agent = createAgent(page);

let exitCode = 0;
try {
  // === LLMが生成するコード ===

  await agent.screenshot(`${SCREENSHOT_DIR}/final.png`);
  console.log("✅ 操作完了");
} catch (error) {
  try {
    await agent.screenshot(`${SCREENSHOT_DIR}/error.png`);
  } catch {}

  // リペアループ用のエラーレポートを出力
  if (error && typeof (error as any).toJSON === "function") {
    const report = {
      ...(error as any).toJSON(),
      screenshot: `${SCREENSHOT_DIR}/error.png`,
      url: page.url(),
    };
    writeFileSync("results/error-report.json", JSON.stringify(report, null, 2));
    console.error("❌ 操作失敗（error-report.json に詳細を出力）:", (error as Error).message);
  } else {
    console.error("❌ 操作失敗:", (error as Error).message);
  }
  exitCode = 1;
} finally {
  await page.close();
  browser.disconnect();
  process.exit(exitCode);
}
```

**テンプレートの注意点:**
- import パスは `../src/helpers/index.ts` — `.taskp-tmp/agent-run.ts` からの相対パス
- `browser.disconnect()` — ユーザーのChromeを閉じない
- `page.close()` — 開いたタブだけ閉じる
- `context.newPage()` — 常に新しいタブを開く（既存タブをハイジャックしない）
- `error-report.json` — リペアループ用の構造化エラー出力

### 5. SKILL.md（LLMへの指示 — 核心）

```markdown
## Agent API リファレンス

`createAgent(page)` で作成した agent を使ってスクリプトを生成してください。
**生のCSSセレクタやXPathは使わないでください。** agent が内部で最適な要素を自動検出します。

### アクション

| API | 用途 | 例 |
|-----|------|-----|
| `agent.clickButton(description)` | ボタンをクリック | `agent.clickButton('投稿')` |
| `agent.clickLink(description)` | リンクをクリック | `agent.clickLink('次のページ')` |
| `agent.click(description)` | 汎用クリック | `agent.click('メニューアイコン')` |
| `agent.fillField(description, value)` | テキスト入力 | `agent.fillField('検索欄', 'キーワード')` |
| `agent.selectOption(description, value)` | 選択 | `agent.selectOption('国', '日本')` |
| `agent.check(description)` | チェック | `agent.check('利用規約に同意')` |

### 待機

| API | 用途 | 例 |
|-----|------|-----|
| `agent.waitForText(text)` | テキスト出現を待機 | `agent.waitForText('投稿完了')` |
| `agent.waitForUrl(pattern)` | URL変更を待機 | `agent.waitForUrl('/dashboard')` |
| `agent.waitForVisible(description)` | 要素表示を待機 | `agent.waitForVisible('検索結果')` |

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
| `agent.section(description)` | セクション内に限定 | `const sidebar = await agent.section('サイドバー')` |

### スクリーンショット

| API | 用途 |
|-----|------|
| `agent.screenshot(path)` | スクリーンショット保存 |

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
```

### 6. リペアループ（失敗時の自動リトライ）

SKILL.mdのStep 2実行部分に以下を追加:

```markdown
### Step 2: スクリプトの実行

`bash` ツールで実行:
```bash
bun run {{__cwd__}}/.taskp-tmp/agent-run.ts
```

**失敗時のリペアループ:**

スクリプトが失敗した場合:
1. `results/error-report.json` を `read` ツールで読む
2. `results/screenshots/error.png` を確認する
3. エラーレポートの `failureType` に応じて:
   - `not_found`: description を変更（ページ上の実際のラベルに合わせる）
   - `ambiguous`: `agent.section()` でスコープを絞る
   - `not_actionable`: `agent.waitForVisible()` を追加するか、エスケープハッチを使う
   - `timeout`: タイムアウト値を増やすか、待機条件を変更する
4. スクリプトを修正して再実行（**最大1回のリトライ**）
5. 2回目も失敗した場合はエラーを報告して停止する
```

### 7. config.json

```json
{
  "screenshotDir": "results/screenshots",
  "authDir": "auth",
  "timeout": 30000,
  "cdpEndpoint": "http://localhost:9222",
  "viewport": {
    "width": 1280,
    "height": 768
  }
}
```

### 8. .env.example

```bash
# CDP接続先（Chromeを --remote-debugging-port=9222 で起動）
CDP_ENDPOINT=http://localhost:9222
```

### 9. Chrome CDPプローブ (`src/chrome.ts`)

自動起動ではなく、**プローブ + 手動起動案内**:

```typescript
export async function ensureCdpAvailable(endpoint: string): Promise<void> {
  try {
    const res = await fetch(`${endpoint}/json/version`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const info = await res.json();
    console.log(`✅ Chrome接続: ${info.Browser}`);
  } catch {
    console.error(`❌ Chrome (CDP) に接続できません: ${endpoint}`);
    console.error(`\nChromeを以下のコマンドで起動してください:\n`);
    if (process.platform === "darwin") {
      console.error(`  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222`);
    } else {
      console.error(`  google-chrome --remote-debugging-port=9222`);
    }
    console.error(`\n起動後、再度このスクリプトを実行してください。`);
    process.exit(1);
  }
}
```

### 10. SKILL.md の入力変更

```yaml
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
```

`headless` と `bridge_mode` は削除（常にCDP接続で既存Chromeを使用）。

---

## 実装順序

### Chunk 0: CDPライフサイクル決定

- [ ] CDP接続モデルの確定: 常に`browser.disconnect()`、常に`context.newPage()`
- [ ] `src/chrome.ts` — CDPプローブ実装
- [ ] エラー型 `src/helpers/errors.ts` 実装
- [ ] smoke test: CDPプローブ→接続→新タブ→disconnect のE2E確認

### Chunk 1: ヘルパーAPI + ロケーター

- [ ] `src/helpers/locator.ts` — アクション別ロケーター解決
- [ ] `src/helpers/actions.ts` — アクション関数（内部実装）
- [ ] `src/helpers/agent.ts` — `createAgent(page)` ファクトリ
- [ ] `src/helpers/index.ts` — エクスポート
- [ ] `tests/fixtures/` — HTML フィクスチャ（フォーム、重複ラベル、SPA再レンダリング等）
- [ ] `tests/helpers/locator.test.ts` — ロケーターテスト
- [ ] `tests/helpers/actions.test.ts` — ヘルパーテスト

### Chunk 2: テンプレート + SKILL.md + リペアループ

- [ ] `templates/runner.ts` — 新テンプレート（`../src/helpers/index.ts` import）
- [ ] `SKILL.md` — 全面書き換え（agent API + レシピ + リペアループ手順）
- [ ] `config.json` — cdpEndpoint追加、Midscene設定削除
- [ ] `.env.example` — MIDSCENE_* 削除、CDP_ENDPOINT追加
- [ ] smoke test: テンプレートからスクリプト生成 → bun run → 成功

### Chunk 3: 周辺ファイル

- [ ] `package.json` — `@midscene/web` 削除
- [ ] `src/login.ts` — CDP接続モード追加（`--cdp` フラグ）

### Chunk 4: Midscene削除（Chunk 2のsmokeテスト成功後のみ）

- [ ] `templates/agent-runner.ts` — 削除
- [ ] `templates/bridge-runner.ts` — 削除
- [ ] `docs/MIDSCENE-INTEGRATION.md` — 削除
- [ ] `docs/MODEL-STRATEGY.md` — 削除
- [ ] `midscene_run/` — 削除
- [ ] `SITEGEIST_*.md` — 削除
- [ ] SKILL.mdの `headless` / `bridge_mode` 入力を削除

### Chunk 5: ドキュメント更新

- [ ] `docs/PLAYWRIGHT-CDP.md` — 新規作成
- [ ] `docs/ARCHITECTURE.md` — 新アーキテクチャ図に書き換え
- [ ] `docs/SETUP.md` — Chrome CDP起動手順に書き換え
- [ ] `docs/CONCEPT.md` — 技術スタック更新
- [ ] `docs/SKILL-DESIGN.md` — 入力・テンプレート更新
- [ ] `README.md` — 更新

### Chunk 6: 最終検証

- [ ] typecheck + lint
- [ ] 全テスト実行
- [ ] 実際のWebサイトでの動作確認テスト

---

## スコープ外（v2以降）

| 項目 | 理由 |
|------|------|
| iframe対応 (`inFrame()`) | v1ではメインフレームのみ。設計上は `root: Page | Locator | Frame` で将来対応可能 |
| closed shadow DOM | Playwrightでも対応不可。open shadow DOMは自動対応 |
| ファイルアップロード | 専用ヘルパー `uploadFile()` が必要。v1では `agent.page` エスケープハッチで対応 |
| リッチテキストエディタ | contenteditable は fillField では対応困難。v1ではエスケープハッチ |
| Skillシステム | sitegeistのドメイン別再利用パターン。v1ではスキップ |
| DOM要素サマリ（検査ヘルパー） | 失敗時にページ構造をLLMに渡す。リペアループの高度化として将来検討 |

---

## 工数見積もり

**Large (3日以上)**

- Chunk 0: 0.5日（CDPライフサイクル + プローブ）
- Chunk 1: 1-1.5日（ロケーター + ヘルパー + テスト — 最も工数がかかる部分）
- Chunk 2: 0.5日（テンプレート + SKILL.md）
- Chunk 3-5: 0.5日（削除 + ドキュメント）
- Chunk 6: 0.5日（検証）
