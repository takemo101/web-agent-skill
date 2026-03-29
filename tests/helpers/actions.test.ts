import { type Browser, type BrowserContext, chromium, type Page } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { createAgent } from "../../src/helpers/agent.ts";

let browser: Browser;
let context: BrowserContext;
let page: Page;
let fixtureUrl: string;

beforeAll(async () => {
	fixtureUrl = new URL("../fixtures/form.html", import.meta.url).toString();
	browser = await chromium.launch();
	context = await browser.newContext();
	page = await context.newPage();
});

beforeEach(async () => {
	await page.goto(fixtureUrl);
});

afterAll(async () => {
	await context?.close();
	await browser?.close();
});

describe("web agent actions", () => {
	test("agent.fillField fills an input", async () => {
		const agent = createAgent(page);

		await agent.fillField("名前", "山田太郎");

		expect(await page.getByLabel("名前").inputValue()).toBe("山田太郎");
	});

	test("agent.clickButton clicks a button", async () => {
		const agent = createAgent(page);

		await agent.clickButton("キャンセル");

		expect(await page.getByText("キャンセルボタンをクリック").isVisible()).toBe(true);
	});

	test("agent.extractText gets text content", async () => {
		const agent = createAgent(page);

		const text = await agent.extractText("商品名: テスト商品");

		expect(text).toContain("商品名: テスト商品");
	});

	test("agent.extractTexts gets multiple texts", async () => {
		const agent = createAgent(page);

		const texts = await agent.extractTexts("商品情報");

		expect(texts.length).toBeGreaterThanOrEqual(2);
		expect(texts).toEqual(expect.arrayContaining(["商品名: テスト商品", "価格: ¥1,000"]));
	});

	test("agent.check checks a checkbox", async () => {
		const agent = createAgent(page);

		await agent.check("利用規約に同意");

		expect(await page.getByLabel("利用規約に同意").isChecked()).toBe(true);
	});

	test("agent.selectOption selects from dropdown", async () => {
		const agent = createAgent(page);

		await agent.selectOption("国", "日本");

		expect(await page.getByLabel("国").inputValue()).toBe("日本");
	});

	test("agent.section scopes to a section", async () => {
		const agent = createAgent(page);
		const sidebarAgent = await agent.section("サイドバー");

		await sidebarAgent.assertVisible("設定");
	});

	test("agent.section + clickLink finds the right scoped link", async () => {
		const agent = createAgent(page);
		const sidebarAgent = await agent.section("サイドバー");

		await sidebarAgent.clickLink("設定");

		expect(await page.getByText("サイドバー設定をクリック").isVisible()).toBe(true);
	});

	test("agent.assertVisible succeeds for visible element", async () => {
		const agent = createAgent(page);

		await expect(agent.assertVisible("商品名: テスト商品")).resolves.toBeUndefined();
	});

	test("agent.screenshot saves a file", async () => {
		const screenshotPath = "/tmp/web-agent-skill-action-screenshot.png";
		const agent = createAgent(page);

		const buffer = await page.screenshot({ path: screenshotPath });
		expect(buffer.byteLength).toBeGreaterThan(0);
		await agent.screenshot(screenshotPath);
	});
});
