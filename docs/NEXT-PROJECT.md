# 次期プロジェクト構想 — YAML駆動ブラウザタスクランナー

## 概要

YAMLファイルに自然言語で操作タスクを複数定義し、pi-agent-core + Playwriter MCPで実行するブラウザ自動化ツール。成功した操作はPlaywrightコードとしてキャッシュし、次回以降はAIなしで高速実行する。

## アーキテクチャ

```
┌─────────────────────────────────────────────────────┐
│ YAML タスク定義                                      │
│   tasks/daily-check.yaml                             │
│     - name: "X.comに挨拶を投稿"                      │
│       url: https://x.com                             │
│       task: "今日は気分がいいです と投稿する"          │
│     - name: "ダッシュボードのスクショ"                 │
│       url: https://admin.example.com                 │
│       task: "売上ダッシュボードのスクリーンショットを撮る" │
├─────────────────────────────────────────────────────┤
│ タスクランナー                                       │
│                                                      │
│   初回実行（キャッシュなし）:                          │
│     pi-agent-core → Playwriter MCP → Chrome          │
│     ↓ 成功                                           │
│     Playwrightコードをキャッシュに保存                 │
│                                                      │
│   2回目以降（キャッシュあり）:                         │
│     キャッシュしたPlaywrightコード → Chrome            │
│     AIなし、高速、確定的                               │
│     ↓ 失敗（UIが変わった等）                          │
│     キャッシュを破棄 → 初回フローにフォールバック       │
└─────────────────────────────────────────────────────┘
```

## 技術スタック

| コンポーネント | 技術 | 役割 |
|---------------|------|------|
| エージェント | [@mariozechner/pi-agent-core](https://www.npmjs.com/package/@mariozechner/pi-agent-core) | LLMとのReActループ、ツール実行管理 |
| LLMプロバイダ | [@mariozechner/pi-ai](https://www.npmjs.com/package/@mariozechner/pi-ai) | Claude/GPT/Gemini/Ollama統一API |
| ブラウザ操作 | [Playwriter](https://github.com/remorses/playwriter) MCP | Chrome拡張経由のブラウザ制御 |
| タスク定義 | YAML | 自然言語によるタスク記述 |
| キャッシュ | Playwrightコード（.ts/.js） | 成功した操作の再利用 |

## YAML タスク定義フォーマット

```yaml
# tasks/daily-check.yaml
name: 日次チェック
schedule: "0 9 * * *"  # cron式（任意）

tasks:
  - name: X.comに挨拶を投稿
    url: https://x.com
    task: |
      「今日も頑張ります」と投稿する
    screenshot: true
    on_success: echo "投稿完了"

  - name: ダッシュボードのスクショ
    url: https://admin.example.com/dashboard
    task: |
      今月の売上データが表示されるまで待ち、
      スクリーンショットを撮る
    screenshot: true
    on_success: slack-notify.sh

  - name: メール確認
    url: https://mail.google.com
    task: |
      未読メールの件名を5件取得する
    extract: true
    on_success: echo "{{result}}"
```

## キャッシュの仕組み

### 初回実行（AI駆動）

```
1. YAMLからタスクを読み込み
2. pi-agent-coreのAgentを起動
3. AgentがPlaywriter MCPのexecuteツールを使って操作
4. 各ステップのPlaywrightコードを記録
5. 全ステップ成功 → キャッシュファイルに保存
```

### キャッシュファイル

```typescript
// .cache/x-com-に挨拶を投稿.ts
// Generated: 2026-03-29T10:00:00Z
// Task: X.comに挨拶を投稿
// Source: tasks/daily-check.yaml

export async function execute(page: Page) {
  await page.goto("https://x.com");
  await page.locator('aria-ref=e3').click();  // テキスト入力欄
  await page.locator('aria-ref=e3').fill("今日も頑張ります");
  await page.locator('aria-ref=e7').click();  // 投稿ボタン
  await page.waitForSelector('[data-testid="toast"]');
  await page.screenshot({ path: "results/screenshots/x-post.png" });
}
```

### 2回目以降（キャッシュ実行）

```
1. キャッシュファイルが存在するか確認
2. 存在 → Playwrightコードを直接実行（AIなし、高速）
3. 成功 → 完了
4. 失敗 → キャッシュを破棄 → AI駆動フローにフォールバック → 新しいキャッシュを保存
```

### キャッシュの無効化

- **手動**: `runner cache clear --task "X.comに挨拶を投稿"`
- **自動**: キャッシュ実行が失敗した時
- **TTL**: 設定可能な有効期限（デフォルト: 無期限）
- **YAML変更**: タスクのtask内容が変わったらキャッシュ無効化

## CLIイメージ

```bash
# タスクファイル実行（キャッシュがあればAIなし）
runner run tasks/daily-check.yaml

# 特定タスクのみ実行
runner run tasks/daily-check.yaml --task "X.comに挨拶を投稿"

# キャッシュを無視してAI駆動で実行
runner run tasks/daily-check.yaml --no-cache

# キャッシュ一覧
runner cache list

# キャッシュクリア
runner cache clear --all

# cron登録
runner schedule tasks/daily-check.yaml
```

## pi-agent-core統合イメージ

```typescript
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

// Playwriter MCPクライアント接続
const mcpClient = new Client({ name: "task-runner" });
await mcpClient.connect(transport);

// pi-agent-coreのツールとしてPlaywriterのexecuteをラップ
const executeTool = {
  name: "browser_execute",
  description: "ブラウザ上でPlaywrightコードを実行する",
  parameters: Type.Object({
    code: Type.String({ description: "Playwright code" }),
  }),
  execute: async (toolCallId, { code }) => {
    const result = await mcpClient.callTool({ name: "execute", arguments: { code } });
    // 成功したコードを記録
    codeHistory.push(code);
    return { content: [{ type: "text", text: result.content[0].text }] };
  },
};

const agent = new Agent({
  initialState: {
    systemPrompt: "ブラウザ操作アシスタント。Playwrightコードを使って操作する。",
    model: getModel("anthropic", "claude-sonnet-4-20250514"),
    tools: [executeTool],
  },
  toolExecution: "sequential",
});

// タスク実行
await agent.prompt(task.task);

// 全ステップ成功 → キャッシュ保存
if (!agent.state.error) {
  saveCache(task.name, codeHistory);
}
```

## sitegeistとの差別化

| | sitegeist | 本プロジェクト |
|---|---|---|
| 実行形態 | Chrome拡張（対話型） | CLI（バッチ実行） |
| タスク定義 | チャットで都度指示 | YAML定義で再利用 |
| 学習 | Skillシステム | **Playwrightコードキャッシュ** |
| 定時実行 | 不可 | cron対応 |
| 複数タスク | 1つずつ | YAMLで複数一括 |

## スコープ

### v1
- [ ] YAMLタスク定義パーサー
- [ ] pi-agent-core + Playwriter MCP統合
- [ ] タスク実行ループ
- [ ] Playwrightコードキャッシュ（保存・読み込み・実行）
- [ ] キャッシュ失敗時のフォールバック
- [ ] CLIインターフェース（run, cache list, cache clear）

### v2
- [ ] cron/スケジューラ統合
- [ ] 実行結果のレポート（HTML）
- [ ] Slack/Discord通知
- [ ] UIテスト向け機能（アサーション、差分検出）
- [ ] キャッシュのバージョン管理
- [ ] MCP対応（本ツール自体をMCPサーバーとして公開）
