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
	//
	// フォーム操作:
	//   await agent.fillField('検索欄', 'キーワード');
	//   await agent.clickButton('検索');
	//
	// ナビゲーション:
	//   await agent.clickLink('次のページ');
	//   await agent.waitForUrl('/results');
	//
	// データ抽出:
	//   const title = await agent.extractText('ページタイトル');
	//   const items = await agent.page.evaluate(() =>
	//     Array.from(document.querySelectorAll('.item')).map(el => el.textContent)
	//   );
	//   console.log(JSON.stringify(items, null, 2));
	//
	// 検証:
	//   await agent.assertVisible('投稿完了メッセージ');
	//   await agent.waitForText('投稿が完了しました');
	//
	// スコーピング:
	//   const sidebar = await agent.section('サイドバー');
	//   await sidebar.clickLink('設定');
	//
	// スクリーンショット:
	//   await agent.screenshot(`${SCREENSHOT_DIR}/step1.png`);

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
	await browser.close();
	process.exit(exitCode);
}
