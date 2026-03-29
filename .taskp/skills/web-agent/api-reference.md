# REPLサーバー APIリファレンス

すべて `curl --json '{"action":"...","args":{...}}' http://localhost:3000/exec` で実行。

## アクション一覧

### ナビゲーション
| action | args | 説明 |
|--------|------|------|
| `goto` | `{ "url": "..." }` | ページ遷移 |

### 操作
| action | args | 説明 |
|--------|------|------|
| `clickButton` | `{ "description": "..." }` | ボタンクリック |
| `clickLink` | `{ "description": "..." }` | リンククリック |
| `click` | `{ "description": "..." }` | 汎用クリック |
| `fillField` | `{ "description": "...", "value": "..." }` | テキスト入力 |
| `selectOption` | `{ "description": "...", "value": "..." }` | 選択 |
| `check` | `{ "description": "..." }` | チェックON |
| `uncheck` | `{ "description": "..." }` | チェックOFF |

### 待機
| action | args | 説明 |
|--------|------|------|
| `waitForText` | `{ "text": "..." }` | テキスト出現待ち |
| `waitForUrl` | `{ "pattern": "..." }` | URL変更待ち |
| `waitForVisible` | `{ "description": "..." }` | 要素表示待ち |
| `waitForHidden` | `{ "description": "..." }` | 要素非表示待ち |

### 検証
| action | args | 説明 |
|--------|------|------|
| `assertVisible` | `{ "description": "..." }` | 表示確認 |
| `assertText` | `{ "description": "...", "expected": "..." }` | テキスト一致確認 |

### 抽出
| action | args | 説明 |
|--------|------|------|
| `extractText` | `{ "description": "..." }` | テキスト1件取得 |
| `extractTexts` | `{ "description": "..." }` | テキスト複数取得 |
| `extractAttribute` | `{ "description": "...", "attribute": "..." }` | 属性取得 |

### スコーピング
| action | args | 説明 |
|--------|------|------|
| `section` | `{ "description": "..." }` | 操作範囲を限定 |
| `resetSection` | `{}` | 範囲限定を解除 |

### 観察・スクリーンショット
| action | args | 説明 |
|--------|------|------|
| `observe` | `{}` | ページのボタン・入力欄・リンク一覧取得 |
| `screenshot` | `{ "path": "..." }` | スクリーンショット保存 |

### エスケープハッチ
| action | args | 説明 |
|--------|------|------|
| `evaluateFile` | `{ "path": "..." }` | JSファイル実行 |

### 制御
| action | args | 説明 |
|--------|------|------|
| `shutdown` | `{}` | サーバー停止 |

## レスポンス形式

成功: `{"ok":true,"result":...,"state":{"url":"...","title":"..."},"meta":{"durationMs":...}}`
失敗: `{"ok":false,"error":{"failureType":"not_found|ambiguous|timeout","message":"..."},"state":{...}}`

## observe レスポンス例

```json
{
  "ok": true,
  "result": {
    "buttons": ["ログイン", "送信"],
    "links": ["ホーム", "設定"],
    "inputs": [{"type": "email", "label": "メール"}, {"type": "password", "label": "パスワード"}],
    "headings": ["ログイン"],
    "forms": 1
  }
}
```

## 失敗時の対応

- `not_found` → description を変更。observe で正しい名前を確認
- `ambiguous` → section で範囲を絞る
- `timeout` → waitForVisible を先に実行

## レシピ: フォーム投稿

```bash
curl --json '{"action":"goto","args":{"url":"https://example.com/contact"}}' http://localhost:3000/exec
curl --json '{"action":"observe"}' http://localhost:3000/exec
curl --json '{"action":"fillField","args":{"description":"お名前","value":"山田太郎"}}' http://localhost:3000/exec
curl --json '{"action":"fillField","args":{"description":"メール","value":"yamada@example.com"}}' http://localhost:3000/exec
curl --json '{"action":"clickButton","args":{"description":"送信"}}' http://localhost:3000/exec
curl --json '{"action":"waitForText","args":{"text":"送信完了"}}' http://localhost:3000/exec
curl --json '{"action":"screenshot","args":{"path":"results/screenshots/done.png"}}' http://localhost:3000/exec
```
