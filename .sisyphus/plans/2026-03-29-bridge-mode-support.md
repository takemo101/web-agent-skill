# Bridge Mode Support Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Midscene Bridge Mode support so the agent can control the user's existing desktop Chrome (with login sessions, cookies, extensions intact) instead of launching a separate Chromium instance.

**Architecture:** Add a `bridge_mode` toggle to the skill inputs and config. When enabled, the agent-runner template uses `AgentOverChromeBridge` (from `@midscene/web/bridge-mode`) instead of `PlaywrightAgent`. The existing Playwright mode remains the default. Bridge Mode requires a Midscene Chrome extension installed in the user's browser.

**Tech Stack:** Midscene.js 1.6.0 (`AgentOverChromeBridge`), taskp, TypeScript, Bun

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `.taskp/skills/web-agent/config.json` | Modify | Add `bridgeMode: false` default |
| `.taskp/skills/web-agent/templates/agent-runner.ts` | Modify | Add Bridge Mode conditional branch |
| `.taskp/skills/web-agent/templates/bridge-runner.ts` | Create | Bridge Mode specific runner template |
| `.taskp/skills/web-agent/SKILL.md` | Modify | Add `bridge_mode` input + Bridge Mode docs |
| `docs/ARCHITECTURE.md` | Modify | Add Bridge Mode to system diagram and flow |
| `docs/MIDSCENE-INTEGRATION.md` | Modify | Add Bridge Mode API section |
| `docs/SETUP.md` | Modify | Add Chrome extension setup instructions |

**Design decision: separate template file (`bridge-runner.ts`) instead of conditional in `agent-runner.ts`.**

Rationale: The two modes have fundamentally different lifecycles (Playwright: launch browser → create context → new page → goto URL vs Bridge: connect to existing Chrome tab via extension). Mixing them in one template with conditionals would make the template harder for the LLM (taskp agent) to understand and adapt. Separate templates keep each clean and focused. The SKILL.md will instruct the LLM which template to use based on the `bridge_mode` input.

---

## Chunk 1: Config & Bridge Runner Template

### Task 1: Add bridgeMode to config.json

**Files:**
- Modify: `.taskp/skills/web-agent/config.json`

- [ ] **Step 1: Add bridgeMode field**

```json
{
  "screenshotDir": "results/screenshots",
  "authDir": "auth",
  "timeout": 30000,
  "viewport": {
    "width": 1280,
    "height": 768
  },
  "waitAfterAction": 500,
  "replanningCycleLimit": 20,
  "bridgeMode": false
}
```

- [ ] **Step 2: Verify JSON is valid**

Run: `bun -e "console.log(JSON.parse(require('fs').readFileSync('.taskp/skills/web-agent/config.json','utf-8')))"`
Expected: Object printed without error

---

### Task 2: Create bridge-runner.ts template

**Files:**
- Create: `.taskp/skills/web-agent/templates/bridge-runner.ts`

- [ ] **Step 1: Create the Bridge Mode runner template**

```typescript
import "dotenv/config";
import { mkdirSync } from "fs";
import { AgentOverChromeBridge } from "@midscene/web/bridge-mode";

// --- 設定 ---
const TARGET_URL = "{{TARGET_URL}}";
const SCREENSHOT_DIR = "{{SCREENSHOT_DIR}}";

// --- config.json から反映される設定 ---
const WAIT_AFTER_ACTION = {{WAIT_AFTER_ACTION}};
const REPLANNING_CYCLE_LIMIT = {{REPLANNING_CYCLE_LIMIT}};

// --- ディレクトリ事前作成 ---
mkdirSync(SCREENSHOT_DIR, { recursive: true });

// --- Bridge Mode 接続 ---
const agent = new AgentOverChromeBridge({
	closeNewTabsAfterDisconnect: false,
});

await agent.connectNewTabWithUrl(TARGET_URL, {
	waitAfterConnected: WAIT_AFTER_ACTION,
});

let exitCode = 0;
try {
	// === 操作 ===
	// ここに LLM がユーザーの指示に応じた操作手順を書く
	//
	// 自律操作:
	//   await agent.aiAct("記事一覧からトップ3のタイトルを取得する");
	//
	// 直接操作:
	//   await agent.aiTap("検索ボタン");
	//   await agent.aiInput("検索欄", { value: "キーワード" });
	//   await agent.aiScroll("記事一覧", { direction: "down" });
	//   await agent.aiKeyboardPress("入力欄", { keyName: "Enter" });
	//
	// データ抽出:
	//   const data = await agent.aiQuery("{title: string, url: string}[]");
	//   console.log(JSON.stringify(data, null, 2));
	//
	// 待機・確認:
	//   await agent.aiWaitFor("ページが読み込まれた", { timeoutMs: 10000 });
	//   await agent.aiAssert("投稿完了メッセージが表示されている");
	//
	// ⚠️ Bridge Mode ではスクリーンショットは Midscene HTMLレポートに自動保存されます
	// ⚠️ page.screenshot() は使用できません（Playwright Page オブジェクトがないため）

	console.log("✅ 操作完了");
} catch (error) {
	console.error("❌ 操作失敗:", (error as Error).message);
	exitCode = 1;
} finally {
	await agent.destroy();
	process.exit(exitCode);
}
```

Key differences from agent-runner.ts:
- No `chromium.launch()` — connects to existing Chrome via extension
- No `storageState` — user's Chrome already has sessions
- No `HEADLESS` — always uses the user's visible Chrome
- No `AUTH_FILE` — not needed
- No `page.screenshot()` — not available in Bridge Mode (relies on Midscene HTML report)
- No `VIEWPORT_WIDTH/HEIGHT` — uses Chrome's current window size
- Uses `agent.destroy()` instead of `browser.close()`
- `process.exit()` in finally — same pattern to prevent Midscene timer hang

- [ ] **Step 2: Verify template has no syntax errors (as standalone check)**

Run: `bun -e "import('fs').then(f => { const c = f.readFileSync('.taskp/skills/web-agent/templates/bridge-runner.ts', 'utf-8'); console.log('Lines:', c.split('\\n').length); console.log('Has AgentOverChromeBridge:', c.includes('AgentOverChromeBridge')); console.log('Has destroy:', c.includes('agent.destroy()')); })"`
Expected: Lines count, true, true

---

## Chunk 2: SKILL.md Updates

### Task 3: Add bridge_mode input and Bridge Mode documentation to SKILL.md

**Files:**
- Modify: `.taskp/skills/web-agent/SKILL.md`

- [ ] **Step 1: Add bridge_mode input to frontmatter**

Add after the `headless` input:

```yaml
  - name: bridge_mode
    type: confirm
    message: "Bridge Modeで実行しますか？（既存のChromeブラウザを操作します。Chrome拡張のインストールが必要）"
    default: false
```

- [ ] **Step 2: Add bridge_mode to操作対象 section**

Update the 操作対象 section to include:

```markdown
## 操作対象

- **URL**: {{url}}
- **Bridge Mode**: {{bridge_mode}}
{{#unless bridge_mode}}
- **ヘッドレスモード**: {{headless}}
{{/unless}}
```

- [ ] **Step 3: Update Step 1 to handle Bridge Mode template selection**

In the 実行手順 > Step 1 section, add Bridge Mode branching instruction. After the line about reading the template, add:

```markdown
**テンプレート選択:**

- **Bridge Mode（`bridge_mode` = true）の場合**: `{{__skill_dir__}}/templates/bridge-runner.ts` を使用
- **通常モード（`bridge_mode` = false）の場合**: `{{__skill_dir__}}/templates/agent-runner.ts` を使用
```

- [ ] **Step 4: Add Bridge Mode specific rules**

Add after the existing スクリプト生成時の重要ルール section:

```markdown
**Bridge Mode 固有のルール:**

- `page.screenshot()` は**使用不可**（Playwright Page オブジェクトが存在しない）
- スクリーンショットは Midscene の HTMLレポートに自動保存される
- `storageState` の設定は**不要**（ユーザーの Chrome のセッションがそのまま使える）
- `headless` 設定は**無視される**（常にユーザーの Chrome を使用）
- `viewport` 設定は**無視される**（Chrome の現在のウィンドウサイズを使用）
- 終了時は `agent.destroy()` でブリッジを切断する（`browser.close()` ではない）
```

- [ ] **Step 5: Add Bridge Mode section to 認証 area**

Add after the existing 認証 section:

```markdown
#### Bridge Mode での認証

Bridge Mode では、ユーザーが普段使っている Chrome ブラウザをそのまま操作するため、**ログイン状態がそのまま使えます**。`storageState` の保存・復元は不要です。

⚠️ Chrome にログイン済みであることを前提に操作スクリプトを生成してください。
```

- [ ] **Step 6: Add Bridge Mode API reference**

Add a new section after the existing Midscene API リファレンス:

```markdown
## Bridge Mode API リファレンス

Bridge Mode では `PlaywrightAgent` の代わりに `AgentOverChromeBridge` を使用する。
AI操作系メソッド（aiAct, aiTap, aiInput, aiQuery 等）は共通。

### Bridge Mode 固有メソッド

| API | 用途 |
|-----|------|
| `agent.connectNewTabWithUrl(url)` | 新しいタブで URL を開いて接続 |
| `agent.connectCurrentTab()` | 現在アクティブなタブに接続 |
| `agent.destroy()` | ブリッジ切断（必須） |

### Bridge Mode で使えない API

| API | 理由 | 代替 |
|-----|------|------|
| `page.screenshot()` | Page オブジェクトなし | Midscene HTMLレポート |
| `page.goto()` | Page オブジェクトなし | `agent.connectNewTabWithUrl(url)` |
| `page.setViewportSize()` | Chrome のウィンドウを直接制御 | なし（Chrome 側で調整） |
```

- [ ] **Step 7: Verify SKILL.md is well-formed**

Run: `bun -e "const c = require('fs').readFileSync('.taskp/skills/web-agent/SKILL.md','utf-8'); const fm = c.split('---'); console.log('Frontmatter sections:', fm.length >= 3 ? 'OK' : 'BROKEN'); console.log('Has bridge_mode input:', c.includes('bridge_mode')); console.log('Has bridge-runner ref:', c.includes('bridge-runner.ts'));"`
Expected: OK, true, true

---

## Chunk 3: Documentation Updates

### Task 4: Update ARCHITECTURE.md

**Files:**
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Add Bridge Mode to system diagram**

After the existing system diagram (line ~50), add:

```markdown
### Bridge Mode 構成図

```
┌─────────────────────────────────────────────────────────────┐
│ taskp CLI                                                    │
│                                                              │
│  taskp run web-agent --set bridge_mode=true                  │
│    ↓                                                         │
│  ┌──────────────────┐                                        │
│  │ SKILL.md 読み込み │ ← bridge-runner.ts テンプレート使用    │
│  └────────┬─────────┘                                        │
│           ↓                                                   │
│  ┌──────────────────────────────────────────────┐            │
│  │ AgentOverChromeBridge                         │            │
│  │                                               │            │
│  │  ┌────────────────┐    ┌──────────────────┐   │            │
│  │  │ Bridge Server   │◄──►│ Chrome 拡張機能   │   │            │
│  │  │ (localhost:3766)│    │ (Midscene ext)   │   │            │
│  │  └────────────────┘    └──────────────────┘   │            │
│  │         ↕                      ↕               │            │
│  │  ┌────────────────────────────────────────┐   │            │
│  │  │ ユーザーの Chrome ブラウザ               │   │            │
│  │  │ (ログイン済み、Cookie あり、拡張機能あり) │   │            │
│  │  └────────────────────────────────────────┘   │            │
│  │                                               │            │
│  │  自律操作ループ（通常モードと同じ）:           │            │
│  │  📸スクショ → 🧠判断 → ⌨️操作 → 📸スクショ... │            │
│  └──────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────┘
```
```

- [ ] **Step 2: Add Bridge Mode to processing flow section**

Add after the existing Phase 3:

```markdown
### Bridge Mode での処理フロー差分

| フェーズ | 通常モード | Bridge Mode |
|---------|-----------|-------------|
| ブラウザ起動 | Playwright が Chromium を起動 | 既存の Chrome に接続（Chrome 拡張経由） |
| 認証 | storageState で復元 | 不要（Chrome のセッションを使用） |
| ページ遷移 | `page.goto(url)` | `agent.connectNewTabWithUrl(url)` |
| スクリーンショット | `page.screenshot()` + Midscene レポート | Midscene レポートのみ |
| 終了 | `browser.close()` | `agent.destroy()` |
```

---

### Task 5: Update MIDSCENE-INTEGRATION.md

**Files:**
- Modify: `docs/MIDSCENE-INTEGRATION.md`

- [ ] **Step 1: Add Bridge Mode section**

Add before the 制限事項 section (before line 232):

```markdown
## Bridge Mode（Chrome 拡張接続）

### 概要

Bridge Mode は Midscene v1.6 で追加された機能で、Chrome 拡張機能を介してユーザーのデスクトップ Chrome を直接操作する。Playwright で新規ブラウザを起動する代わりに、既存の Chrome のセッション（Cookie、ログイン状態、拡張機能）をそのまま利用できる。

### 基本パターン

```typescript
import { AgentOverChromeBridge } from "@midscene/web/bridge-mode";

const agent = new AgentOverChromeBridge();
await agent.connectNewTabWithUrl("https://example.com");

// AI操作は PlaywrightAgent と同じ API
await agent.aiAct("記事を開いてスクショを撮る");
const data = await agent.aiQuery("{title: string}[]");

await agent.destroy();
```

### PlaywrightAgent との比較

| 項目 | PlaywrightAgent | AgentOverChromeBridge |
|------|----------------|----------------------|
| ブラウザ | Playwright 管理の Chromium | ユーザーの Chrome |
| Cookie/セッション | storageState で復元 | そのまま使える |
| 拡張機能 | 使えない | 使える |
| headless | 可 | 不可（常に visible） |
| page.screenshot() | 可 | 不可 |
| viewport 制御 | 可 | 不可 |
| 前提条件 | Playwright install | Chrome 拡張インストール |

### 制限事項（Bridge Mode 固有）

| 制限 | 説明 |
|------|------|
| page オブジェクトなし | Playwright の Page API は使用不可 |
| viewport 固定 | Chrome のウィンドウサイズに依存 |
| headless 不可 | 常にユーザーの Chrome を使用 |
| 無視されるオプション | userAgent, viewportWidth, viewportHeight, deviceScaleFactor, waitForNetworkIdle, cookie |
```

---

### Task 6: Update SETUP.md

**Files:**
- Modify: `docs/SETUP.md`

- [ ] **Step 1: Add Bridge Mode setup section**

Add after Step 3 (ブラウザのインストール):

```markdown
## Step 3b: Bridge Mode のセットアップ（任意）

Bridge Mode を使用すると、普段使っている Chrome ブラウザをそのまま AI で操作できます（ログイン状態、Cookie、拡張機能がそのまま利用可能）。

### 1. Chrome 拡張機能のインストール

Midscene Chrome 拡張をインストールします:

1. Chrome で [Midscene Chrome Extension](https://chromewebstore.google.com/detail/midscene/...) を開く
2. 「Chrome に追加」をクリック

### 2. 動作確認

```bash
taskp run web-agent --set bridge_mode=true --set url="https://example.com" --set task="ページタイトルを取得する"
```

Chrome で新しいタブが開き、AI が操作を実行します。

### 注意事項

- Bridge Mode 実行中は Chrome を手動操作しないでください
- Chrome を閉じると Bridge 接続が切れます
- Step 3 の Playwright Chromium インストールは Bridge Mode では不要ですが、通常モードと併用する場合はインストールしておくことを推奨します
```

---

## Chunk 4: Verification

### Task 7: Final verification

- [ ] **Step 1: Run lint check**

Run: `bun run check`
Expected: No errors

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No errors (templates are in .taskp which is excluded from tsconfig)

- [ ] **Step 3: Run tests**

Run: `bun run test`
Expected: All tests pass (no existing tests should break)

- [ ] **Step 4: Verify all modified files are consistent**

Run manual review:
- config.json has `bridgeMode` field
- SKILL.md frontmatter has `bridge_mode` input
- SKILL.md references `bridge-runner.ts`
- `bridge-runner.ts` exists and uses `AgentOverChromeBridge`
- Docs reference Bridge Mode consistently
