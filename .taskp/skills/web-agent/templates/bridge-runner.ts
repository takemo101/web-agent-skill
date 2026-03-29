import "dotenv/config";
import { AgentOverChromeBridge } from "@midscene/web/bridge-mode";

// --- 設定 ---
const TARGET_URL = "{{TARGET_URL}}";

// --- config.json から反映される設定 ---
const WAIT_AFTER_ACTION = {{WAIT_AFTER_ACTION}};
const REPLANNING_CYCLE_LIMIT = {{REPLANNING_CYCLE_LIMIT}};
const TIMEOUT = {{TIMEOUT}};

// --- Bridge Mode 接続 ---
const agent = new AgentOverChromeBridge({
	generateReport: true,
	autoPrintReportMsg: true,
	waitAfterAction: WAIT_AFTER_ACTION,
	replanningCycleLimit: REPLANNING_CYCLE_LIMIT,
});

let exitCode = 0;
try {
	await agent.connectNewTabWithUrl(TARGET_URL, { timeout: TIMEOUT });

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
	// ⚠️ Bridge Mode ではスクリーンショットは Midscene HTMLレポートに自動保存されます
	// ⚠️ page.screenshot() は使用できません（Playwright Page オブジェクトがないため）

	console.log("✅ 操作完了");
} catch (error) {
	console.error("❌ 操作失敗:", (error as Error).message);
	exitCode = 1;
} finally {
	try {
		await agent.destroy();
	} catch {
		// Chrome切断等でdestroy失敗してもprocess.exitを保証
	}
	process.exit(exitCode);
}
