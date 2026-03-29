# SKILL-DESIGN — taskp スキル設計

## スキル概要

| 項目 | 値 |
|------|-----|
| スキル名 | `web-agent` |
| 配置先 | `.taskp/skills/web-agent/SKILL.md` |
| 実行モード | `agent`（LLM が操作スクリプトを生成・実行） |
| 使用ツール | `bash`, `read`, `write` |

## 設定の3層構造

スキルの設定値は役割に応じて3つの場所に分離する。

```
┌─────────────────────────────────────────────────────┐
│ 毎回変わるもの → inputs（TUI で入力）               │
│   url, task, after_command                           │
├─────────────────────────────────────────────────────┤
│ 固定設定 → config.json（context で読み込み）         │
│   screenshotDir, authDir, viewport, timeout,         │
│   cdpEndpoint 等                                     │
├─────────────────────────────────────────────────────┤
│ 機密情報 → .env（環境変数）                          │
│   APIキー等                                          │
└─────────────────────────────────────────────────────┘
```

### なぜ分離するか

| 設定値 | inputs | config.json | .env |
|--------|:---:|:---:|:---:|
| 毎回変わる（url, task） | ✅ | — | — |
| プロジェクト固有の固定値 | — | ✅ | — |
| 機密情報（APIキー） | — | — | ✅ |
| git 管理 | ✅ | ✅ | ❌ |
| cron で上書き | `--set` | — | 環境変数 |

## フロントマター設計

```yaml
---
name: web-agent
description: 自然言語で指示した内容をAIがブラウザで自律操作する
mode: agent
inputs:
  # --- 毎回入力するもの ---
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
  # --- 固定設定を読み込み ---
  - type: file
    path: "{{__skill_dir__}}/config.json"
tools:
  - bash
  - read
  - write
---
```

## config.json 設計

スキルディレクトリに配置する固定設定。`context` で SKILL.md に自動読み込みされ、LLM が参照する。

```
.taskp/skills/web-agent/
├── SKILL.md
├── config.json          ← 固定設定
└── templates/
    └── runner.ts
```

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

### 設定項目

| キー | 型 | デフォルト | 説明 |
|------|-----|-----------|------|
| `screenshotDir` | string | `"results/screenshots"` | スクリーンショット保存先 |
| `authDir` | string | `"auth"` | ログイン状態（storageState）の保存先 |
| `timeout` | number | `30000` | 操作全体のタイムアウト（ms） |
| `cdpEndpoint` | string | `"http://localhost:9222"` | Chrome CDP 接続先 |
| `viewport.width` | number | `1280` | ブラウザのビューポート幅 |
| `viewport.height` | number | `768` | ブラウザのビューポート高さ |

### config.json を変更する場面

```bash
# スクショ保存先を変えたい
→ "screenshotDir": "~/Dropbox/evidence"

# モバイルサイトをテストしたい
→ "viewport": { "width": 375, "height": 812 }

# 重いサイトでタイムアウトする
→ "timeout": 60000

# CDPポートを変えた場合
→ "cdpEndpoint": "http://localhost:9223"
```

## 入力設計

### url

| 項目 | 値 |
|------|-----|
| 型 | `text` |
| 必須 | はい |
| バリデーション | `^https?://` — http/https で始まること |
| 用途 | 操作対象ページの開始URL |

### task

| 項目 | 値 |
|------|-----|
| 型 | `textarea` |
| 必須 | はい |
| 用途 | やりたいことを自然言語で記述 |

入力例:
```
テック系の注目記事トップ3のタイトルとURLを取得して、
各記事ページのスクリーンショットを撮る
```

```
管理画面にログインして、今月の売上データを取得する。
ダッシュボードのスクショも撮っておく
```

```
投稿フォームに「本日のビルド完了しました」と入力して送信する
```

### after_command

| 項目 | 値 |
|------|-----|
| 型 | `text` |
| 必須 | いいえ |
| 用途 | 操作完了後に実行するシェルコマンド |

入力例:
```
slack-notify.sh
python analyze.py --data results/data.json
echo "完了: $(date)" >> log/history.txt
cp results/screenshots/*.png ~/Dropbox/evidence/
```

空欄の場合はコマンド実行をスキップする。

### 実行パターン

```bash
# 通常: TUI で url と task を入力、他はデフォルト
taskp run web-agent

# cron / CI: 全部指定、対話なし
taskp run web-agent --skip-prompt \
  --set url="https://example.com" \
  --set task="記事をスクショ" \
  --set after_command="slack-notify.sh"
```

## SKILL.md 本文設計

### 1. 操作情報セクション

```markdown
## 操作対象

- **URL**: {{url}}

## やりたいこと

{{task}}

{{#if after_command}}
## 完了後コマンド

操作が完了したら以下のコマンドを実行してください:

\`\`\`
{{after_command}}
\`\`\`
{{/if}}
```

### 2. 実行手順セクション

```markdown
## 実行手順

### Step 1: 操作スクリプトの生成

`{{__skill_dir__}}/templates/runner.ts` を参考にして、上記の操作内容を agent ヘルパーAPIで実装したスクリプトを `{{__cwd__}}/.taskp-tmp/agent-run.ts` に生成してください。

### Step 2: スクリプトの実行

bash ツールで以下のコマンドを実行してください:

\`\`\`
bun run {{__cwd__}}/.taskp-tmp/agent-run.ts
\`\`\`

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

### Step 3: 完了後コマンドの実行

スクリプトが正常終了した場合、after_command が指定されていれば実行してください。
スクリプトの stdout に出力されたデータは、完了後コマンドにパイプで渡せます。

### Step 4: 結果の報告

以下を報告してください:
- 実行した操作の概要
- 保存されたスクリーンショットのパス
- 完了後コマンドの実行結果（該当する場合）
```

### 3. Agent API リファレンスセクション

```markdown
## Agent API リファレンス

`createAgent(page)` で作成した agent を使ってスクリプトを生成してください。
**生のCSSセレクタやXPathは使わないでください。** agent が内部で最適な要素を自動検出します。

詳細なAPIリファレンスは [docs/PLAYWRIGHT-CDP.md](../docs/PLAYWRIGHT-CDP.md) を参照してください。
```

## テンプレート設計

`runner.ts` — CDPで接続し、agentヘルパーを使う標準テンプレート。

```
.taskp/skills/web-agent/templates/
└── runner.ts    ← 唯一のテンプレート
```

テンプレートの構造:

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

**テンプレートの重要なポイント:**

- `browser.disconnect()` — ユーザーのChromeを閉じない（`browser.close()` は使わない）
- `page.close()` — 開いたタブだけ閉じる
- `context.newPage()` — 常に新しいタブを開く（既存タブをハイジャックしない）
- `error-report.json` — リペアループ用の構造化エラー出力

## スクリプト生成時のルール

Agent がスクリプトを生成する際、以下を守ること:

1. **スクリーンショットは `results/screenshots/` に保存**する
2. **最終状態のスクリーンショットは必ず撮る**（成功・失敗どちらでも）
3. **抽出データは `console.log` で stdout に出力**する（JSON 推奨）
4. **完了後コマンドが指定されている場合は操作完了後に bash で実行**する
5. **ディレクトリは `mkdirSync` で事前作成**する
6. **生のCSSセレクタやXPathは使わない** — agent ヘルパーAPIを使う

## ターミナル出力フォーマット

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ 操作完了
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

URL:    https://news.example.com
操作:   テック系注目記事トップ3を取得

実行内容:
  1. ✅ トップページ表示         (2.1s)
  2. ✅ テックカテゴリに移動     (1.5s)
  3. ✅ 記事3件のスクショ撮影    (4.2s)

📸 スクリーンショット:
   results/screenshots/article-1.png
   results/screenshots/article-2.png
   results/screenshots/article-3.png
   results/screenshots/final.png

🔧 完了後コマンド実行: slack-notify.sh
   → 正常終了 (exit 0)
```

## マルチアクション版（v2）

```yaml
actions:
  run:
    description: ブラウザ操作を実行する
    inputs:
      - name: url
        type: text
        message: "操作対象のURL"
      - name: task
        type: textarea
        message: "やりたいこと"
      - name: after_command
        type: text
        message: "完了後コマンド（空欄可）"
        required: false
  login:
    description: サイトにログインしてセッションを保存する
    mode: agent
    inputs:
      - name: url
        type: text
        message: "ログインページのURL"
      - name: site_name
        type: text
        message: "サイト名（保存用）"
  report:
    description: 最新のレポートをブラウザで開く
    mode: template
  screenshot:
    description: 最新のスクリーンショットを開く
    mode: template
```

### action:login

headed モードでブラウザを開き、ユーザーが手動でログイン → Cookie を保存。

```typescript
// headed モードで起動（ユーザーが操作する）
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(url);

console.log("ブラウザでログインしてください...");
console.log("ログイン完了後、ターミナルで Enter を押してください");

// ユーザーの入力を待つ
await new Promise((resolve) => process.stdin.once("data", resolve));

// セッション保存
await context.storageState({ path: `auth/${siteName}.json` });
console.log(`✅ セッション保存: auth/${siteName}.json`);
```

## 実行例

### コマンド

```bash
taskp run web-agent
```

### TUI での入力

```
? 操作対象のURLは？
> https://news.ycombinator.com

? やりたいことを自然言語で入力してください
> トップページの記事タイトルとポイント数を上位5件取得して、
> 各記事のスクリーンショットを撮る
> [Meta+Enter で確定]

? 完了後に実行するコマンドは？（空欄でスキップ）
> echo "$(cat results/data/articles.json)" | jq .
```

### 出力

```
🔄 操作スクリプトを生成中...
📝 .taskp-tmp/agent-run.ts に書き出しました
🚀 実行中...

✅ 操作完了

📸 スクリーンショット:
   results/screenshots/article-1.png
   results/screenshots/article-2.png
   results/screenshots/article-3.png
   results/screenshots/article-4.png
   results/screenshots/article-5.png
   results/screenshots/final.png

🔧 完了後コマンド実行:
[
  {"title": "Show HN: ...", "points": 342},
  {"title": "Ask HN: ...", "points": 285},
  ...
]
```

### 定期実行（cron）

```bash
# 毎朝9時に記事チェック
0 9 * * * cd /path/to/project && taskp run web-agent --skip-prompt \
  --set url="https://news.ycombinator.com" \
  --set task="トップ5記事のタイトルとURLを取得してスクショ" \
  --set after_command="slack-notify.sh"
```
