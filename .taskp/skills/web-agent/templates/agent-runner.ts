import "dotenv/config";
import { existsSync, mkdirSync } from "fs";
import { chromium } from "playwright";
import { PlaywrightAgent } from "@midscene/web/playwright";

// --- 設定 ---
const TARGET_URL = "{{TARGET_URL}}";
const HEADLESS = {{HEADLESS}};
const SCREENSHOT_DIR = "{{SCREENSHOT_DIR}}";
const AUTH_FILE = "{{AUTH_FILE}}"; // 空文字なら認証なし

// --- config.json から反映される設定 ---
const VIEWPORT_WIDTH = {{VIEWPORT_WIDTH}};
const VIEWPORT_HEIGHT = {{VIEWPORT_HEIGHT}};
const WAIT_AFTER_ACTION = {{WAIT_AFTER_ACTION}};
const REPLANNING_CYCLE_LIMIT = {{REPLANNING_CYCLE_LIMIT}};
const TIMEOUT = {{TIMEOUT}};

// --- ディレクトリ事前作成 ---
mkdirSync(SCREENSHOT_DIR, { recursive: true });

// --- ブラウザ起動 ---
const browser = await chromium.launch({
	headless: HEADLESS,
	args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

// --- 認証状態復元 ---
const contextOptions: Record<string, unknown> = {};
if (AUTH_FILE && existsSync(AUTH_FILE)) {
	contextOptions.storageState = AUTH_FILE;
}
const context = await browser.newContext(contextOptions);
const page = await context.newPage();
await page.setViewportSize({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });
await page.goto(TARGET_URL, { timeout: TIMEOUT });

// --- PlaywrightAgent 初期化 ---
const agent = new PlaywrightAgent(page, {
	generateReport: true,
	autoPrintReportMsg: true,
	waitAfterAction: WAIT_AFTER_ACTION,
	replanningCycleLimit: REPLANNING_CYCLE_LIMIT,
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
	// 途中スクリーンショット:
	//   await page.screenshot({ path: `${SCREENSHOT_DIR}/step1.png` });

	// === 最終スクリーンショット ===
	await page.screenshot({ path: `${SCREENSHOT_DIR}/final.png` });
	console.log("✅ 操作完了");
} catch (error) {
	// === エラー時もスクリーンショットを撮る ===
	try {
		await page.screenshot({ path: `${SCREENSHOT_DIR}/error.png` });
	} catch {
		// ブラウザクラッシュ等でスクショも撮れない場合は無視
	}
	console.error("❌ 操作失敗:", (error as Error).message);
	exitCode = 1;
} finally {
	await browser.close();
	process.exit(exitCode);
}
