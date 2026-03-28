# MIDSCENE-INTEGRATION — Midscene.js 統合設計

## 概要

[Midscene.js](https://github.com/web-infra-dev/midscene) は Vision LLM ベースのUI自動化ライブラリ。スクリーンショットからページを理解し、自然言語の指示で自律的にブラウザを操作する。

本ツールでは **Direct Integration（スクリプト直接実行）** を採用する。

## 依存パッケージ

```json
{
  "devDependencies": {
    "@midscene/web": "1.6.0",
    "@playwright/test": "1.58.2",
    "playwright": "1.58.2"
  }
}
```

## 自律操作の仕組み

### aiAct の内部ループ

`aiAct()` は1回の呼び出しで複数ステップを自律実行する。

```
aiAct("記事を開いてコメント欄に感想を書いて投稿する")
  ↓
  1. 📸 スクリーンショット撮影
  2. 🧠 Vision LLM「記事リンクが見える → クリック」
  3. 🖱️ クリック実行
  4. 📸 スクリーンショット撮影
  5. 🧠 Vision LLM「記事が表示された → コメント欄を探す」
  6. ⌨️ コメント欄にテキスト入力
  7. 📸 スクリーンショット撮影
  8. 🧠 Vision LLM「投稿ボタンが見える → クリック」
  9. 🖱️ クリック実行
  10. 🧠 Vision LLM「投稿完了 → タスク終了」
```

- 最大 20 サイクル（`replanningCycleLimit` で変更可能）
- 毎サイクルでスクリーンショットを撮影・分析
- LLM が「完了した」と判断するか、上限に達するまで繰り返す

### aiAct vs Instant Action の使い分け

| 方式 | API | 適用場面 |
|------|-----|---------|
| **Auto Planning** | `aiAct(prompt)` | 複雑な操作フロー、探索的な操作 |
| **Instant Action** | `aiTap()`, `aiInput()` 等 | 確実に1つの操作を実行したい場合 |

```typescript
// Auto Planning: 複雑なフローを丸投げ
await agent.aiAct("検索して最初の結果を開いてブックマークする");

// Instant Action: 1つずつ確実に
await agent.aiInput("検索欄", { value: "キーワード" });
await agent.aiTap("検索ボタン");
await agent.aiTap("最初の検索結果");
await agent.aiTap("ブックマークアイコン");
```

スクリプト生成時は、操作が単純な場合は Instant Action、複雑な場合は aiAct を使う。

## PlaywrightAgent の初期化

### 基本パターン

```typescript
import { chromium } from "playwright";
import { PlaywrightAgent } from "@midscene/web/playwright";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

const page = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 768 });
await page.goto("https://example.com");

const agent = new PlaywrightAgent(page);
```

### ログイン状態復元パターン

```typescript
const context = await browser.newContext({
  storageState: "auth/example.json",  // 保存済みの Cookie/LocalStorage
});
const page = await context.newPage();
```

### オプション

```typescript
const agent = new PlaywrightAgent(page, {
  generateReport: true,              // HTMLレポート生成
  autoPrintReportMsg: true,          // レポートパスを stdout に出力
  replanningCycleLimit: 20,          // 自律操作の最大サイクル数
  waitAfterAction: 500,              // 各操作後の待機（ms）
  aiActContext: "日本語サイト",       // 全操作に付与する背景知識
  screenshotShrinkFactor: 1,         // スクリーンショット縮小率（1=等倍）

  // ローカルLLM設定
  modelConfig: {
    MIDSCENE_MODEL_NAME: "qwen2.5-vl:7b",
    MIDSCENE_MODEL_BASE_URL: "http://localhost:11434/v1",
    MIDSCENE_MODEL_API_KEY: "ollama",
  },
});
```

## スクリーンショット設計

### 2種類のスクリーンショット

```
1. Midscene 自動撮影（HTMLレポート内）
   - 各 aiAct / aiTap 等の操作前後に自動撮影
   - HTMLレポートに全ステップ分が埋め込まれる
   - 追加コード不要

2. Playwright 個別撮影（results/screenshots/）
   - 任意のタイミングで明示的に撮影
   - 単体PNGファイルとして保存
   - エビデンス添付、共有、後続処理に使用
```

### 撮影パターン

```typescript
import { mkdirSync } from "fs";

const dir = "results/screenshots";
mkdirSync(dir, { recursive: true });

// 途中の特定画面をスクショ
await agent.aiAct("ダッシュボードを開く");
await page.screenshot({ path: `${dir}/dashboard.png` });

// 複数ページを順番にスクショ
const urls = ["https://a.com", "https://b.com"];
for (let i = 0; i < urls.length; i++) {
  await page.goto(urls[i]);
  await page.screenshot({ path: `${dir}/page-${i + 1}.png` });
}

// 最終状態（必須）
await page.screenshot({ path: `${dir}/final.png` });
```

### スクリーンショットオプション

```typescript
// ビューポート内のみ（デフォルト）
await page.screenshot({ path: "results/screenshots/view.png" });

// ページ全体（長いページ向け）
await page.screenshot({ path: "results/screenshots/full.png", fullPage: true });

// 特定領域
await page.screenshot({
  path: "results/screenshots/area.png",
  clip: { x: 0, y: 0, width: 800, height: 600 },
});
```

## データ抽出と後続処理への連携

### aiQuery でデータ抽出

```typescript
// 構造化データの抽出
const articles = await agent.aiQuery(
  "{title: string, url: string, points: number}[], 記事の一覧"
);

// JSON で stdout に出力 → 完了後コマンドに渡せる
console.log(JSON.stringify(articles, null, 2));

// ファイルに保存
import { writeFileSync } from "fs";
writeFileSync("results/data/articles.json", JSON.stringify(articles, null, 2));
```

### 完了後コマンドへのデータ連携

```typescript
// stdout に出力したデータは、完了後コマンドにパイプで渡せる
// 例: taskp Agent が以下を実行
//   bun run .taskp-tmp/agent-run.ts | slack-notify.sh
```

## ログイン状態の管理

### 初回: 手動ログインして保存

```typescript
const browser = await chromium.launch({ headless: false }); // headed
const context = await browser.newContext();
const page = await context.newPage();
await page.goto("https://example.com/login");

// ユーザーが手動でログイン...
// ログイン完了後:
await context.storageState({ path: "auth/example.json" });
```

### 以降: 状態復元で自動操作

```typescript
const context = await browser.newContext({
  storageState: "auth/example.json",
});
const page = await context.newPage();
// → ログイン済みの状態で操作開始
```

### Cookie 期限切れの検知

```typescript
const isLoggedIn = await agent.aiBoolean("ログイン済みか？");
if (!isLoggedIn) {
  console.error("❌ ログインセッションが期限切れです");
  console.error("   taskp run web-agent:login で再ログインしてください");
  process.exit(1);
}
```

## 制限事項

| 制限 | 説明 | 対策 |
|------|------|------|
| コンテキスト非維持 | 各API呼び出し間で前の操作を覚えていない | 指示を具体的に、aiAct でまとめる |
| Vision モデル依存 | テキストのみモデルでは動作しない | Vision モデル必須 |
| CAPTCHA | 自動突破は困難 | 手動ログインで回避 |
| 2要素認証 | TOTP 以外は自動化困難 | storageState で回避 |
| ネイティブダイアログ | alert/confirm の操作は不可 | Playwright の dialog イベント |
| アンチボット | SNS等で検出されるリスク | レート制限遵守、自社サイト推奨 |
| 処理速度 | 毎ステップでスクショ + LLM呼び出し | ステップを最小限に |
