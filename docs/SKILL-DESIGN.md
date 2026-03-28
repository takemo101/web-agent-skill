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
│ たまに変えるもの → inputs + default（--set で上書き）│
│   headless                                           │
├─────────────────────────────────────────────────────┤
│ 固定設定 → config.json（context で読み込み）         │
│   screenshotDir, authDir, viewport, timeout 等       │
├─────────────────────────────────────────────────────┤
│ 機密情報 → .env（環境変数）                          │
│   MIDSCENE_MODEL_NAME, API キー等                    │
└─────────────────────────────────────────────────────┘
```

### なぜ分離するか

| 設定値 | inputs | config.json | .env |
|--------|:---:|:---:|:---:|
| 毎回変わる（url, task） | ✅ | — | — |
| デフォルトで十分（headless） | ✅ default | — | — |
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
  # --- たまに変えるもの（デフォルトあり）---
  - name: headless
    type: confirm
    message: "ヘッドレスモードで実行しますか？（Noで実際のブラウザが表示されます）"
    default: true
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
    └── agent-runner.ts
```

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
  "replanningCycleLimit": 20
}
```

### 設定項目

| キー | 型 | デフォルト | 説明 |
|------|-----|-----------|------|
| `screenshotDir` | string | `"results/screenshots"` | スクリーンショット保存先 |
| `authDir` | string | `"auth"` | ログイン状態（storageState）の保存先 |
| `timeout` | number | `30000` | 操作全体のタイムアウト（ms） |
| `viewport.width` | number | `1280` | ブラウザのビューポート幅 |
| `viewport.height` | number | `768` | ブラウザのビューポート高さ |
| `waitAfterAction` | number | `500` | 各操作後の待機時間（ms） |
| `replanningCycleLimit` | number | `20` | aiAct の自律操作最大サイクル数 |

### config.json を変更する場面

```bash
# スクショ保存先を変えたい
→ "screenshotDir": "~/Dropbox/evidence"

# モバイルサイトをテストしたい
→ "viewport": { "width": 375, "height": 812 }

# 重いサイトでタイムアウトする
→ "timeout": 60000

# 複雑な操作が途中で止まる
→ "replanningCycleLimit": 40
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

### headless

| 項目 | 値 |
|------|-----|
| 型 | `confirm` |
| デフォルト | `true` |
| 用途 | ブラウザの表示/非表示切替 |

### 実行パターン

```bash
# 通常: TUI で url と task を入力、他はデフォルト
taskp run web-agent

# cron / CI: 全部指定、対話なし
taskp run web-agent --skip-prompt \
  --set url="https://example.com" \
  --set task="記事をスクショ" \
  --set after_command="slack-notify.sh"

# デバッグ: headed モードで実行
taskp run web-agent --set headless=false
```

## SKILL.md 本文設計

### 1. 操作情報セクション

```markdown
## 操作対象

- **URL**: {{url}}
- **ヘッドレスモード**: {{headless}}

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

`{{__skill_dir__}}/templates/agent-runner.ts` を参考にして、上記の操作内容を Midscene API で実装したスクリプトを `{{__cwd__}}/.taskp-tmp/agent-run.ts` に生成してください。

### Step 2: スクリプトの実行

bash ツールで以下のコマンドを実行してください:

\`\`\`
bun run {{__cwd__}}/.taskp-tmp/agent-run.ts
\`\`\`

### Step 3: 完了後コマンドの実行

スクリプトが正常終了した場合、after_command が指定されていれば実行してください。
スクリプトの stdout に出力されたデータは、完了後コマンドにパイプで渡せます。

### Step 4: 結果の報告

以下を報告してください:
- 実行した操作の概要
- 保存されたスクリーンショットのパス
- HTMLレポートのパス
- 完了後コマンドの実行結果（該当する場合）
```

### 3. Midscene API リファレンスセクション

```markdown
## Midscene API リファレンス

### 自律操作（Auto Planning）

| API | 用途 | 例 |
|-----|------|-----|
| `agent.aiAct(prompt)` | 複雑な操作を自律的に実行 | `'記事を開いてコメントを書いて投稿する'` |
| `agent.ai(prompt)` | aiAct の短縮形 | `'ログインボタンを押す'` |

aiAct は内部でループを回し、毎回スクリーンショットを撮って次の操作を判断する。
1つの aiAct に複数ステップの指示を含めてよい。

### 直接操作（Instant Action）

| API | 用途 | 例 |
|-----|------|-----|
| `agent.aiTap(target)` | 要素をクリック | `'投稿ボタン'` |
| `agent.aiInput(target, {value})` | テキスト入力 | `'検索欄', {value: 'キーワード'}` |
| `agent.aiKeyboardPress(target, {keyName})` | キー押下 | `'入力欄', {keyName: 'Enter'}` |
| `agent.aiScroll(target, opts)` | スクロール | `'記事一覧', {direction: 'down'}` |

### データ取得

| API | 用途 | 例 |
|-----|------|-----|
| `agent.aiQuery(schema)` | ページからデータ抽出 | `'{title: string, url: string}[]'` |
| `agent.aiBoolean(question)` | Yes/No 判定 | `'ログイン済みか？'` |
| `agent.aiString(question)` | テキスト取得 | `'ページタイトルは？'` |

### 待機・確認

| API | 用途 | 例 |
|-----|------|-----|
| `agent.aiWaitFor(condition, opts)` | 条件成立まで待機 | `'ページが読み込まれた', {timeoutMs: 10000}` |
| `agent.aiAssert(condition)` | 条件を検証 | `'投稿完了メッセージが表示されている'` |

### スクリーンショット（Playwright）

| API | 用途 |
|-----|------|
| `await page.screenshot({path: '...', fullPage: false})` | ビューポート内をキャプチャ |
| `await page.screenshot({path: '...', fullPage: true})` | ページ全体をキャプチャ |

### 重要な注意事項

- aiAct は「今の画面を見て判断する」ため、前の操作を覚えていない
- 「さっきの」「それ」のような指示語は使えない
- ページ遷移後は aiWaitFor で遷移完了を待つこと
- スクリーンショットは `results/screenshots/` に保存すること
- 抽出データは console.log で stdout に出力すること
```

## レポート・スクリーンショット出力設計

### 出力一覧

| 出力 | 生成元 | 保存先 | 用途 |
|------|--------|--------|------|
| HTMLレポート | Midscene 自動 | `midscene_run/report/*.html` | 全ステップのスクリーンショット + 操作内容 |
| スクリーンショット | Playwright 個別撮影 | `results/screenshots/*.png` | エビデンス、共有、後続処理 |
| 抽出データ | stdout / ファイル | `results/data/` | 完了後コマンドへの入力 |

### スクリプト生成時のルール

Agent がスクリプトを生成する際、以下を守ること:

1. **スクリーンショットは `results/screenshots/` に保存**する
2. **最終状態のスクリーンショットは必ず撮る**（成功・失敗どちらでも）
3. **抽出データは `console.log` で stdout に出力**する（JSON 推奨）
4. **完了後コマンドが指定されている場合は操作完了後に bash で実行**する
5. **ディレクトリは `mkdirSync` で事前作成**する

```typescript
import { mkdirSync } from "fs";

mkdirSync("results/screenshots", { recursive: true });

try {
  // ... 操作 ...

  // 最終スクリーンショット
  await page.screenshot({ path: "results/screenshots/final.png" });
  console.log("✅ 操作完了");
} catch (error) {
  await page.screenshot({ path: "results/screenshots/error.png" });
  console.error("❌ 操作失敗:", (error as Error).message);
  process.exit(1);
} finally {
  await browser.close();
}
```

### ターミナル出力フォーマット

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

📊 HTMLレポート:
   midscene_run/report/abc123.html

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
      - name: headless
        type: confirm
        message: "ヘッドレスモード？"
        default: true
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

? ヘッドレスモードで実行しますか？ [Y/n]
> Y
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

📊 HTMLレポート: midscene_run/report/abc123.html

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
  --set after_command="slack-notify.sh" \
  --set headless=true
```
