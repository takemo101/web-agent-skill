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
  - name: headless
    type: confirm
    message: "ヘッドレスモードで実行しますか？（Noで実際のブラウザが表示されます）"
    default: true
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
- **ヘッドレスモード**: {{headless}}

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

次に `{{__skill_dir__}}/templates/agent-runner.ts` を `read` ツールで読み込み、テンプレートを参考にして上記の操作内容を Midscene API で実装したスクリプトを `{{__cwd__}}/.taskp-tmp/agent-run.ts` に `write` ツールで生成してください。

**スクリプト生成時の重要ルール:**

- スクリーンショットは config.json の `screenshotDir` に保存する
- 最終スクリーンショットは必ず撮る（成功・失敗どちらでも）
- 抽出データは `console.log` で stdout に JSON 出力する（JSON 推奨）
- `bun run` でスクリプト実行する（tsx ではなく bun）
- aiAct の指示は「今の画面を見ればわかる」レベルで具体的に書く（「さっきの」「それ」のような指示語は使えない）
- `authDir` 配下にサイト名の JSON ファイル（例: `auth/example.json`）が存在する場合は `storageState` として使用する

### 認証（ログイン状態の管理）

#### storageState による自動復元

`auth/<site-name>.json` に保存された Cookie / LocalStorage は、スクリプト実行時に自動的に復元されます。テンプレート（`agent-runner.ts`）は `AUTH_FILE` が指定され、かつファイルが存在する場合に `browser.newContext({ storageState: AUTH_FILE })` で復元します。

#### ログイン状態の保存方法

```bash
bun run src/login.ts <url> <site-name>
```

headed モードでブラウザが開くので、手動でログインしてからターミナルで Enter を押してください。`auth/<site-name>.json` にセッションが保存されます。

#### スクリプト生成時の AUTH_FILE 設定

操作対象の URL のホスト名から site-name を導出し、`auth/` ディレクトリに対応する JSON ファイルが存在する場合は `AUTH_FILE` にそのパスを設定してください。存在しない場合は空文字 `""` を設定してください。

例:
- `https://github.com/...` → `auth/github.json` があれば `AUTH_FILE = "auth/github.json"`
- `https://admin.example.com/dashboard` → `auth/admin.example.com.json` があれば `AUTH_FILE = "auth/admin.example.com.json"`
- 認証不要 or ファイルなし → `AUTH_FILE = ""`

#### ログイン状態の有効期限検知

認証が必要なサイトを操作するスクリプトでは、操作開始前にログイン状態を確認してください:

```typescript
const isLoggedIn = await agent.aiBoolean("ログイン済みか？");
if (!isLoggedIn) {
	console.error("❌ セッション期限切れ: bun run src/login.ts <url> <site-name> で再ログイン");
	process.exit(1);
}
```

### Step 2: スクリプトの実行

`bash` ツールで以下のコマンドを実行してください:

```bash
bun run {{__cwd__}}/.taskp-tmp/agent-run.ts
```

> ⚠️ `tsx` ではなく `bun run` を使用すること

### Step 3: 完了後コマンドの実行

スクリプトが正常終了した場合、`after_command` が指定されていれば `bash` ツールで実行してください。
スクリプトの stdout に出力されたデータは、完了後コマンドにパイプで渡せます。

### Step 4: 結果の報告

以下を報告してください:

- 実行した操作の概要
- 保存されたスクリーンショットのパス
- HTMLレポートのパス（`midscene_run/report/` 内）
- 抽出データの内容（該当する場合）
- 完了後コマンドの実行結果（該当する場合）

## スキル設定

config.json の内容が context で自動挿入されています。スクリプト生成時にこれらの設定値を使用してください。

| キー | 説明 |
|------|------|
| `screenshotDir` | スクリーンショット保存先 |
| `authDir` | ログイン状態（storageState）の保存先 |
| `timeout` | 操作全体のタイムアウト（ms） |
| `viewport.width` / `viewport.height` | ブラウザのビューポートサイズ |
| `waitAfterAction` | 各操作後の待機時間（ms） |
| `replanningCycleLimit` | aiAct の自律操作最大サイクル数 |

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
- ページ遷移後は `aiWaitFor` で遷移完了を待つこと
- スクリーンショットは config.json の `screenshotDir` に保存すること
- 抽出データは `console.log` で stdout に出力すること（JSON 推奨）
