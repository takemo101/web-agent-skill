# SKILL-DESIGN — taskp スキル設計

## スキル概要

| 項目 | 値 |
|------|-----|
| スキル名 | `web-test` |
| 配置先 | `.taskp/skills/web-test/SKILL.md` |
| 実行モード | `agent`（LLM がテストスクリプトを生成・実行） |
| 使用ツール | `bash`, `read`, `write` |

## フロントマター設計

```yaml
---
name: web-test
description: サイトURLとテスト内容を自然言語で入力すると、AIがブラウザを操作してテストを実行する
mode: agent
inputs:
  - name: url
    type: text
    message: "テスト対象のサイトURLは？"
    validate: "^https?://"
  - name: test_steps
    type: textarea
    message: "テストの流れを自然言語で入力してください（例: ログインボタンをクリックして、メールアドレスを入力する）"
  - name: expected
    type: textarea
    message: "期待される結果は？（空欄の場合はテスト手順の実行成功をもって合格とします）"
    required: false
  - name: headless
    type: confirm
    message: "ヘッドレスモードで実行しますか？（Noで実際のブラウザが表示されます）"
    default: true
tools:
  - bash
  - read
  - write
---
```

## 入力設計

### url

| 項目 | 値 |
|------|-----|
| 型 | `text` |
| 必須 | はい |
| バリデーション | `^https?://` — http/https で始まること |
| 用途 | テスト対象ページの開始URL |

入力例:
- `https://example.com/login`
- `https://staging.myapp.com/dashboard`

### test_steps

| 項目 | 値 |
|------|-----|
| 型 | `textarea` |
| 必須 | はい |
| 用途 | テストの操作手順を自然言語で記述 |

入力例:
```
1. メールアドレス欄に test@example.com を入力する
2. パスワード欄に password123 を入力する
3. ログインボタンをクリックする
4. ダッシュボードが表示されるのを待つ
```

番号付きリストでも、自由文でも受け付ける。LLM が解釈して適切な Midscene API 呼び出しに変換する。

### expected

| 項目 | 値 |
|------|-----|
| 型 | `textarea` |
| 必須 | いいえ |
| 用途 | テスト合格の判定基準 |

入力例:
```
- ダッシュボード画面に遷移していること
- ユーザー名「テストユーザー」が表示されていること
- サイドバーにメニュー項目が表示されていること
```

空欄の場合は、テスト手順が最後までエラーなく実行できれば合格とする。

### headless

| 項目 | 値 |
|------|-----|
| 型 | `confirm` |
| デフォルト | `true` |
| 用途 | ブラウザの表示/非表示切替 |

- `true` — ヘッドレス（CI/定時実行向け、ブラウザ非表示）
- `false` — headed（デバッグ時、実際のブラウザが表示される）

## SKILL.md 本文設計

本文は taskp の agent モードで LLM に渡されるプロンプトとなる。以下の情報を構造的に記述する。

### 1. テスト情報セクション

変数展開でユーザー入力を埋め込む。

```markdown
## テスト対象

- **URL**: {{url}}
- **ヘッドレスモード**: {{headless}}

## テスト手順

{{test_steps}}

{{#if expected}}
## 期待される結果

{{expected}}
{{/if}}
```

### 2. 実行手順セクション

LLM に「何をすべきか」を明確に指示する。

```markdown
## 実行手順

以下の手順でテストを実行してください。

### Step 1: テストスクリプトの生成

`{{__skill_dir__}}/templates/test-runner.ts` を参考にして、上記のテスト手順を Midscene API で実装したスクリプトを `{{__cwd__}}/.taskp-tmp/test-run.ts` に生成してください。

### Step 2: スクリプトの実行

bash ツールで以下のコマンドを実行してください:

\`\`\`
npx tsx {{__cwd__}}/.taskp-tmp/test-run.ts
\`\`\`

### Step 3: 結果の報告

- テスト成功時: 「✅ テスト成功」と報告し、レポートファイルのパスを表示
- テスト失敗時: 「❌ テスト失敗」と報告し、失敗理由とレポートファイルのパスを表示
```

### 3. Midscene API リファレンスセクション

LLM が正しいコードを生成するためのガイド。

```markdown
## Midscene API リファレンス

スクリプト生成時は以下の API のみを使用してください。

### 操作系

| API | 用途 | 例 |
|-----|------|-----|
| `agent.aiAct(prompt)` | 複数ステップの操作を自動プランニング | `'検索ボックスに "iPhone" と入力して検索ボタンを押す'` |
| `agent.aiTap(target)` | 要素をクリック | `'ログインボタン'` |
| `agent.aiInput(target, {value})` | テキスト入力 | `'メールアドレス欄', {value: 'test@example.com'}` |
| `agent.aiKeyboardPress(target, {keyName})` | キー押下 | `'検索欄', {keyName: 'Enter'}` |
| `agent.aiScroll(target, opts)` | スクロール | `'商品リスト', {direction: 'down'}` |

### 検証系

| API | 用途 | 例 |
|-----|------|-----|
| `agent.aiAssert(condition)` | 条件を検証（失敗でエラー） | `'ログイン成功メッセージが表示されている'` |
| `agent.aiWaitFor(condition, opts)` | 条件成立まで待機 | `'検索結果が表示されている', {timeoutMs: 10000}` |

### データ取得系

| API | 用途 | 例 |
|-----|------|-----|
| `agent.aiQuery(schema)` | ページからデータ抽出 | `'{title: string, price: number}[]'` |
| `agent.aiBoolean(question)` | Yes/No 判定 | `'商品は在庫ありか？'` |

### 重要な注意事項

- 各 aiAct の指示は「今の画面を見ればわかる」レベルで具体的に書くこと
- 「さっきの」「それ」のような参照は使えない（各呼び出しは独立）
- ページ遷移後は aiWaitFor で遷移完了を待つこと
- aiAssert が失敗するとエラーが throw される
```

## テストランナーテンプレート

`.taskp/skills/web-test/templates/test-runner.ts` に配置する、スクリプト生成の参考テンプレート。

```typescript
import { chromium } from "playwright";
import { PlaywrightAgent } from "@midscene/web/playwright";
import "dotenv/config";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 設定
const URL = "{{URL}}";
const HEADLESS = {{HEADLESS}};

(async () => {
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 768 });
  await page.goto(URL);
  await sleep(3000); // 初期ロード待ち

  const agent = new PlaywrightAgent(page);

  try {
    // === テスト手順 ===
    // ここに Midscene API を使ったテスト手順を書く

    // === 期待結果の検証 ===
    // ここに aiAssert を使った検証を書く

    console.log("✅ テスト成功");
  } catch (error) {
    console.error("❌ テスト失敗:", (error as Error).message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
```

## マルチアクション版（v2）

将来的に以下のアクションを追加する。

```yaml
actions:
  run:
    description: テストを実行する
    inputs:
      - name: url
        type: text
        message: "テスト対象のURL"
      - name: test_steps
        type: textarea
        message: "テスト手順"
      - name: expected
        type: textarea
        message: "期待結果（空欄可）"
        required: false
      - name: headless
        type: confirm
        message: "ヘッドレスモード？"
        default: true
  report:
    description: 最新のテストレポートをブラウザで開く
    mode: template
  list:
    description: 過去のテストレポート一覧を表示する
    mode: template
```

### action:report

```bash
open $(ls -t midscene_run/report/*.html | head -1)
```

### action:list

```bash
echo "=== テストレポート一覧 ==="
ls -lt midscene_run/report/*.html 2>/dev/null || echo "レポートがありません"
```

## 実行例

### コマンド

```bash
taskp run web-test
```

### TUI での入力

```
? テスト対象のサイトURLは？
> https://example.com/login

? テストの流れを自然言語で入力してください
> 1. メールアドレスに test@example.com を入力
> 2. パスワードに password123 を入力
> 3. ログインボタンをクリック
> [Meta+Enter で確定]

? 期待される結果は？
> ダッシュボード画面に遷移し、ようこそメッセージが表示されること
> [Meta+Enter で確定]

? ヘッドレスモードで実行しますか？ [Y/n]
> Y
```

### 出力

```
🔄 テストスクリプトを生成中...
📝 .taskp-tmp/test-run.ts に書き出しました
🚀 テスト実行中...

Midscene - report file updated: midscene_run/report/abc123.html

✅ テスト成功

📊 レポート: midscene_run/report/abc123.html
```
