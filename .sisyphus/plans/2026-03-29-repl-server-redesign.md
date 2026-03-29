# REPLサーバー アーキテクチャ再設計

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1回スクリプト生成 + 1回実行のアーキテクチャを廃止し、常駐REPLサーバー + LLMがステップバイステップで操作するアーキテクチャに移行する。sitegeistの「観察→判断→操作→観察」ループを実現。

**Architecture:** HTTPサーバーがPlaywright CDP接続とWebAgentを保持し、`POST /exec` でアクションを1つずつ受け取って実行、結果を返す。taskpのLLMは `bash` ツールで `curl` を使ってサーバーに指示を送り、結果を見てから次のアクションを決定する。

**Tech Stack:** Bun HTTP server, Playwright (CDP), TypeScript, taskp (agent mode)

---

## 設計思想

### 現行 vs 新アーキテクチャ

```
【現行】LLM → スクリプト全体を生成 → 1回実行 → 失敗したらリトライ1回
【新】  LLM → REPLサーバー起動 → curl で1操作ずつ実行 → 結果を見て次を判断 → 繰り返し
```

### sitegeistとの対応

| sitegeist | 我々の新設計 |
|-----------|-------------|
| Chrome拡張内 Agent ループ | taskp agent mode + bash/curl |
| `browserjs(() => ...)` | `curl POST /exec {"action":"evaluate","code":"..."}` |
| `navigate({url:...})` | `curl POST /exec {"action":"goto","url":"..."}` |
| LLMがツール結果を見て次を決定 | LLMがcurl結果を見て次のcurlを決定 |
| 20-50 tool calls/task | taskp agentの制限次第（十分多い） |

---

## REPLサーバー設計

### トランスポート

- **HTTP JSON** on `127.0.0.1:3000`
- LLMは `curl --json '{"action":"..."}' http://localhost:3000/exec` で操作
- リクエストは直列処理（同時リクエスト拒否）

### エンドポイント

| エンドポイント | 用途 |
|--------------|------|
| `POST /exec` | アクション実行（メイン） |
| `GET /health` | サーバー稼働確認 |
| `POST /shutdown` | サーバー停止 |

### /exec リクエスト形式

```json
{
  "action": "clickButton",
  "args": { "description": "投稿" },
  "timeoutMs": 10000
}
```

### アクション一覧

| action | args | 説明 |
|--------|------|------|
| `goto` | `{ url }` | ページ遷移 |
| `clickButton` | `{ description }` | ボタンクリック |
| `clickLink` | `{ description }` | リンククリック |
| `click` | `{ description }` | 汎用クリック |
| `fillField` | `{ description, value }` | テキスト入力 |
| `selectOption` | `{ description, value }` | セレクト選択 |
| `check` | `{ description }` | チェックボックスON |
| `uncheck` | `{ description }` | チェックボックスOFF |
| `waitForText` | `{ text, timeoutMs? }` | テキスト出現待機 |
| `waitForUrl` | `{ pattern, timeoutMs? }` | URL変更待機 |
| `waitForVisible` | `{ description, timeoutMs? }` | 要素表示待機 |
| `waitForHidden` | `{ description, timeoutMs? }` | 要素非表示待機 |
| `assertVisible` | `{ description }` | 要素表示検証 |
| `assertText` | `{ description, expected }` | テキスト検証 |
| `extractText` | `{ description }` | テキスト取得 |
| `extractTexts` | `{ description }` | 複数テキスト取得 |
| `extractAttribute` | `{ description, attribute }` | 属性取得 |
| `section` | `{ description }` | スコーピング（以降の操作をセクション内に限定） |
| `resetSection` | `{}` | スコーピング解除 |
| `screenshot` | `{ path }` | スクリーンショット |
| `observe` | `{}` | ページの現在状態を取得（URL, タイトル, 主要なインタラクティブ要素の概要） |
| `evaluateFile` | `{ path }` | JSファイルを読み込んで実行（エスケープハッチ） |
| `shutdown` | `{}` | サーバー停止 |

### /exec レスポンス形式

**成功時:**
```json
{
  "ok": true,
  "result": "投稿完了メッセージ",
  "state": { "url": "https://x.com/home", "title": "X" },
  "meta": { "durationMs": 234 }
}
```

**失敗時:**
```json
{
  "ok": false,
  "error": {
    "action": "clickButton",
    "description": "投稿",
    "failureType": "not_found",
    "triedStrategies": ["role:button", "role:link", "text"],
    "candidates": [],
    "message": "\"投稿\" に一致する要素なし"
  },
  "state": { "url": "https://x.com/home", "title": "X" },
  "meta": { "durationMs": 1502 }
}
```

**常にstate（url + title）を返す。** LLMが最低限のページ状態を把握できる。

### observe アクション

ページの現在状態を詳細に取得する。LLMが「今のページに何があるか」を知りたい時に使う。

```json
// リクエスト
{ "action": "observe" }

// レスポンス
{
  "ok": true,
  "result": {
    "url": "https://x.com/home",
    "title": "X",
    "buttons": ["Post", "Reply", "Repost", "Like"],
    "links": ["Home", "Explore", "Notifications", "Messages", "Profile"],
    "inputs": [{ "type": "textbox", "label": "What is happening?!", "placeholder": "" }],
    "headings": ["Home"],
    "forms": 1
  },
  "state": { "url": "https://x.com/home", "title": "X" }
}
```

### サーバーライフサイクル

1. **起動**: SKILL.mdのStep 1でLLMが `bash` で起動。バックグラウンドデーモン化。
2. **稼働**: curl呼び出しの間ずっとCDP接続とagentを保持
3. **停止**: タスク完了時にLLMが `POST /shutdown` を送信。アイドル15分でも自動停止。
4. **クラッシュ対策**: `/health` でサーバー生存確認。応答なければ再起動。

### evaluateFile（エスケープハッチ）

インラインJSではなく、**ファイルに書いて実行**する方式。シェルエスケープ地獄を回避。

```bash
# LLMがファイルを書く
write .taskp-tmp/extract.js:
  Array.from(document.querySelectorAll('table tr')).map(r => ({
    name: r.cells[0]?.textContent,
    price: r.cells[1]?.textContent
  }))

# ファイルを実行
curl --json '{"action":"evaluateFile","args":{"path":".taskp-tmp/extract.js"}}' http://localhost:3000/exec
```

---

## SKILL.md（新設計）

LLMへの指示の核心部分:

```markdown
## 実行手順

### Step 1: REPLサーバーの起動

bash ツールで起動:
```bash
npx tsx {{__cwd__}}/src/repl-server.ts &
sleep 3
curl -s http://localhost:3000/health
```

`{"ok":true}` が返ればサーバー準備完了。

### Step 2: ページ観察 → 操作 → 確認のループ

**1操作ずつ実行してください。結果を確認してから次の操作を決めてください。**

まずページに移動して観察する:
```bash
curl --json '{"action":"goto","args":{"url":"URL"}}' http://localhost:3000/exec
curl --json '{"action":"observe"}' http://localhost:3000/exec
```

observe の結果を見て、ページにどんなボタン・入力欄・リンクがあるか確認してから操作する:
```bash
curl --json '{"action":"fillField","args":{"description":"検索欄","value":"キーワード"}}' http://localhost:3000/exec
```

結果の `ok` を確認。失敗した場合:
- `not_found` → description を変えて再試行
- `ambiguous` → section で範囲を絞ってから再試行
- `timeout` → waitForVisible を先に実行してから再試行

**重要: スクリプトファイルを生成しないでください。curl で直接操作してください。**

### Step 3: 完了・停止

操作が終わったら:
```bash
curl --json '{"action":"shutdown"}' http://localhost:3000/exec
```
```

---

## ファイル構成

### 新規作成

| ファイル | 責務 |
|---------|------|
| `src/repl-server.ts` | HTTPサーバー本体 — CDP接続、agent保持、/exec処理 |

### 修正

| ファイル | 変更内容 |
|---------|---------|
| `.taskp/skills/web-agent/SKILL.md` | ステップバイステップcurl方式に全面書き換え |
| `.taskp/skills/web-agent/config.json` | `replPort: 3000` 追加 |
| `package.json` | `"repl": "npx tsx src/repl-server.ts"` スクリプト追加 |

### 保持（変更なし）

| ファイル | 理由 |
|---------|------|
| `src/helpers/locator.ts` | そのまま使用 |
| `src/helpers/actions.ts` | そのまま使用 |
| `src/helpers/agent.ts` | そのまま使用 |
| `src/helpers/errors.ts` | そのまま使用 |
| `src/chrome.ts` | そのまま使用 |
| `tests/` | そのまま使用 |

### 削除

| ファイル | 理由 |
|---------|------|
| `.taskp/skills/web-agent/templates/runner.ts` | スクリプト生成方式は廃止 |

---

## 実装順序

### Chunk 1: REPLサーバー実装

- [ ] `src/repl-server.ts` — HTTPサーバー + CDP接続 + アクションディスパッチ
- [ ] observe アクション実装（ページのインタラクティブ要素一覧取得）
- [ ] evaluateFile アクション実装
- [ ] section / resetSection アクション実装
- [ ] /health + /shutdown エンドポイント
- [ ] アイドルタイムアウト（15分）
- [ ] 手動テスト: `bun run chrome && npx tsx src/repl-server.ts` → curl で操作

### Chunk 2: SKILL.md + config

- [ ] SKILL.md 全面書き換え（ステップバイステップcurl方式）
- [ ] config.json に `replPort` 追加
- [ ] package.json に `repl` スクリプト追加
- [ ] templates/runner.ts 削除

### Chunk 3: テスト + 検証

- [ ] REPLサーバーのユニットテスト
- [ ] typecheck + lint
- [ ] 実際のWebサイトでの動作確認

---

## 工数見積もり

- Chunk 1: 0.5-1日（REPLサーバー本体）
- Chunk 2: 0.5日（SKILL.md書き換え）
- Chunk 3: 0.5日（テスト・検証）
