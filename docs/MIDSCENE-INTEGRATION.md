# MIDSCENE-INTEGRATION — Midscene.js 統合設計

## Midscene.js の概要

[Midscene.js](https://github.com/web-infra-dev/midscene) は Vision LLM ベースのUI自動化ライブラリ。スクリーンショットから要素を認識し、自然言語の指示でブラウザを操作する。

### 本ツールでの利用方式

**Direct Integration（スクリプト直接実行）** を採用する。

```typescript
import { chromium } from "playwright";
import { PlaywrightAgent } from "@midscene/web/playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const agent = new PlaywrightAgent(page);

await agent.aiAct("ログインボタンをクリックする");
```

Bridge Mode（Chrome拡張経由）は v1 では対象外とする。

## 依存パッケージ

```json
{
  "devDependencies": {
    "@midscene/web": "^1.0.0",
    "playwright": "^1.50.0",
    "@playwright/test": "^1.50.0",
    "tsx": "^4.0.0",
    "dotenv": "^16.0.0"
  }
}
```

## PlaywrightAgent の初期化パターン

### 基本パターン

```typescript
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

const page = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 768 });
await page.goto("https://example.com");

const agent = new PlaywrightAgent(page);
```

### オプション付きパターン

```typescript
const agent = new PlaywrightAgent(page, {
  // レポート生成
  generateReport: true,
  autoPrintReportMsg: true,

  // Midscene のリプランニング上限
  replanningCycleLimit: 20,

  // 各操作後の待機時間（ms）
  waitAfterAction: 500,

  // 共通の背景知識（全 aiAct に自動付与）
  aiActContext: "日本語のサイトです。UIは日本語で表示されています。",

  // スクリーンショットの縮小率（トークン節約）
  screenshotShrinkFactor: 1,

  // モデル設定（環境変数の代わりにコードで指定する場合）
  modelConfig: {
    MIDSCENE_MODEL_NAME: "qwen2.5-vl:7b",
    MIDSCENE_MODEL_BASE_URL: "http://localhost:11434/v1",
    MIDSCENE_MODEL_API_KEY: "ollama",
  },
});
```

## API 利用設計

### テスト手順の変換ルール

taskp Agent が自然言語テスト手順を Midscene API に変換する際のルール。

#### 操作の変換

| 自然言語パターン | 変換先 API | 理由 |
|-----------------|-----------|------|
| 「〇〇をクリック」「〇〇を押す」「〇〇をタップ」 | `aiTap(target)` | 単一要素のクリックは aiTap が高速 |
| 「〇〇に△△を入力」「〇〇に△△と書く」 | `aiInput(target, {value})` | テキスト入力は aiInput |
| 「Enter を押す」「Tab を押す」 | `aiKeyboardPress(target, {keyName})` | 特定キーの押下 |
| 「下にスクロール」「ページ末尾まで」 | `aiScroll(target, opts)` | スクロール操作 |
| 「検索して最初の結果を開く」（複合操作） | `aiAct(prompt)` | 複数ステップの自動プランニング |

#### 検証の変換

| 自然言語パターン | 変換先 API |
|-----------------|-----------|
| 「〇〇が表示されていること」「〇〇があること」 | `aiAssert(condition)` |
| 「〇〇が表示されるまで待つ」 | `aiWaitFor(condition, {timeoutMs})` |
| 「〇〇のテキストを取得」「〇〇のデータを抽出」 | `aiQuery(schema)` |

#### 使い分けの原則

```
単一のアクション → Instant Action API（aiTap, aiInput 等）
  - 高速、確実
  - 例: aiTap('ログインボタン')

複合的なフロー → Auto Planning API（aiAct）
  - LLM がステップを分解して実行
  - 例: aiAct('検索ボックスに "iPhone" と入力して検索し、最初の結果をクリック')
```

### ページ遷移の扱い

Midscene はページ遷移を検出しないため、明示的な待機が必要。

```typescript
// ❌ 遷移直後に操作（失敗する可能性）
await agent.aiTap("送信ボタン");
await agent.aiAssert("完了画面が表示されている");

// ✅ 遷移完了を待ってから操作
await agent.aiTap("送信ボタン");
await agent.aiWaitFor("ページ遷移が完了している", { timeoutMs: 10000 });
await agent.aiAssert("完了画面が表示されている");
```

### エラーハンドリング

```typescript
try {
  await agent.aiAct("ログインフォームに入力して送信する");
  await agent.aiAssert("ダッシュボードが表示されている");
  console.log("✅ テスト成功");
} catch (error) {
  // aiAssert 失敗 or 要素が見つからない
  console.error("❌ テスト失敗:", (error as Error).message);
  process.exit(1);
} finally {
  // レポートは自動生成済み（成功・失敗どちらでも）
  await browser.close();
}
```

Midscene は失敗時もレポートにスクリーンショットを記録する。エラー箇所が視覚的に確認できる。

## レポート・スクリーンショット設計

本ツールは2種類のスクリーンショットを出力する。

### 出力の全体像

```
テスト実行
  ↓
┌──────────────────────────────────────────────────┐
│ Midscene 自動生成                                 │
│  - 各ステップのスクリーンショット（操作前後）       │
│  - 操作内容・結果・エラー詳細                      │
│  → midscene_run/report/<id>.html                  │
└──────────────────────────────────────────────────┘
  ↓
┌──────────────────────────────────────────────────┐
│ Playwright 個別撮影                               │
│  - テスト完了時点の最終画面（成功・失敗どちらでも）│
│  → results/screenshots/final.png                  │
└──────────────────────────────────────────────────┘
  ↓
┌──────────────────────────────────────────────────┐
│ ターミナル出力                                    │
│  - ステップごとの ✅/❌ 結果                      │
│  - スクリーンショットとレポートのファイルパス       │
└──────────────────────────────────────────────────┘
```

### 1. Midscene 自動生成レポート（HTMLレポート）

Midscene は実行ごとに HTMLレポートを `midscene_run/report/` に自動生成する。追加コード不要。

```
midscene_run/
└── report/
    ├── abc123.html     # 最新の実行結果
    └── def456.html     # 過去の実行結果
```

#### レポートの内容（ステップごと）

| 情報 | 説明 |
|------|------|
| 📸 スクリーンショット | 各操作の前後のページ画面 |
| 🔍 操作内容 | どのAPIを何の引数で呼んだか |
| ✅/❌ ステータス | 成功 or 失敗 |
| ⏱ 実行時間 | 各ステップの所要時間 |
| 💬 エラー詳細 | 失敗時のエラーメッセージ・スタックトレース |

#### レポート形式オプション

```typescript
const agent = new PlaywrightAgent(page, {
  // デフォルト: 全画像を base64 で HTML に埋め込み（1ファイル完結）
  outputFormat: "single-html",

  // 大量テスト時: 画像を外部ファイルとして保存（軽量）
  // outputFormat: "html-and-external-assets",
});
```

### 2. 最終スクリーンショット（個別PNG）

テスト完了時点のページ画面を **Playwright で個別に撮影**して保存する。Midscene のレポートとは別に、単体ファイルとして使える。

#### 保存先

```
results/
└── screenshots/
    └── final.png
```

#### 撮影コード

テストスクリプトの `finally` ブロックで撮影する。成功時も失敗時も撮影される。

```typescript
import { mkdirSync } from "fs";

const screenshotDir = "results/screenshots";
mkdirSync(screenshotDir, { recursive: true });

try {
  // テストステップ実行
  await agent.aiAct("...");
  await agent.aiAssert("...");

  // 成功時の最終スクリーンショット
  await page.screenshot({
    path: `${screenshotDir}/final.png`,
    fullPage: false,
  });
} catch (error) {
  // 失敗時のスクリーンショット（エラー発生時点の画面）
  await page.screenshot({
    path: `${screenshotDir}/final.png`,
    fullPage: false,
  });
  throw error;
} finally {
  await browser.close();
}
```

#### 用途

| 用途 | 説明 |
|------|------|
| エビデンスとしての添付 | Slack/Discord/Issue に画像を直接貼れる |
| 差分検出 | 前回のスクリーンショットと目視比較 |
| CI アーティファクト | GitHub Actions の Artifacts に保存 |
| 簡易確認 | HTMLレポートを開かずに結果を確認 |

### 3. ターミナル出力

テスト実行後にターミナルに出力される結果サマリ。TUI では画像表示ができないため、テキスト結果 + ファイルパスを出力する。

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ テスト成功 (3/3 ステップ完了)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

URL:    https://example.com/login
時間:   8.3秒

ステップ:
  1. ✅ メールアドレス入力        (1.2s)
  2. ✅ パスワード入力            (0.9s)
  3. ✅ ログインボタンクリック     (2.1s)

📸 最終スクリーンショット: results/screenshots/final.png
📊 HTMLレポート: midscene_run/report/abc123.html
```

### スクリーンショット品質

```typescript
const agent = new PlaywrightAgent(page, {
  // デフォルト: 等倍（高品質）
  screenshotShrinkFactor: 1,

  // トークン節約: 1/2 に縮小（品質とコストのバランス）
  // screenshotShrinkFactor: 2,
});
```

### 最終スクリーンショットの Playwright オプション

```typescript
await page.screenshot({
  path: "results/screenshots/final.png",
  fullPage: false,       // ビューポート内のみ（デフォルト）
  // fullPage: true,     // ページ全体（長いページ向け）
  // clip: { x: 0, y: 0, width: 800, height: 600 }, // 領域指定
});
```

## 認証が必要なサイトへの対応

### Storage State 方式（推奨）

Playwright の Storage State 機能で Cookie/LocalStorage を保存・復元する。

```typescript
// 初回: headed モードで手動ログイン → 状態保存
const context = await browser.newContext();
const page = await context.newPage();
await page.goto("https://example.com/login");
// ... 手動でログイン ...
await context.storageState({ path: "auth/state.json" });

// 以降: 状態を復元してテスト実行
const context = await browser.newContext({
  storageState: "auth/state.json",
});
```

### テスト内ログイン方式

テスト手順の冒頭にログイン操作を含める。

```
テスト手順:
1. メールアドレスに test@example.com を入力
2. パスワードに password123 を入力
3. ログインボタンをクリック
4. ダッシュボードが表示されるまで待つ
5. （ここから本来のテスト）
```

v1 ではこちらの方式を推奨（シンプルなため）。

## 制限事項

### Midscene の制限

| 制限 | 説明 | 対策 |
|------|------|------|
| コンテキスト非維持 | 各API呼び出しは独立（前の操作を覚えていない） | 指示を具体的に書く |
| Vision モデル依存 | テキストのみモデルでは精度が低い | Qwen2.5-VL 等の Vision モデルを使用 |
| 処理速度 | 毎ステップでスクリーンショット + LLM呼び出し | ステップを最小限に |
| ネイティブダイアログ | alert/confirm/prompt の操作不可 | Playwright の dialog イベントで対処 |
| ファイルダウンロード | ダウンロード検証は困難 | Playwright の download イベントで対処 |

### ローカルLLM の制限

| 制限 | 説明 | 対策 |
|------|------|------|
| 精度 | クラウドモデル（GPT-4o等）より低い場合がある | deepLocate オプションで精度向上 |
| 速度 | GPU 性能に依存（CPU のみだと非常に遅い） | GPU 搭載マシン推奨 |
| VRAM | 7B モデルで ~6GB VRAM 必要 | 量子化モデル（Q4等）を使用 |
