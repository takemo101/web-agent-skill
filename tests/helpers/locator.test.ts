import { type Browser, type BrowserContext, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { resolveButton, resolveField, resolveLink, resolveText } from "../../src/helpers/locator.ts";

let browser: Browser;
let context: BrowserContext;
let page: Page;
let fixtureUrl: string;

beforeAll(async () => {
	fixtureUrl = new URL("../fixtures/form.html", import.meta.url).toString();
	browser = await chromium.launch();
	context = await browser.newContext();
	page = await context.newPage();
	await page.goto(fixtureUrl);
});

afterAll(async () => {
	await context?.close();
	await browser?.close();
});

describe("locator resolution", () => {
	test("resolveButton finds button by role", async () => {
		const result = await resolveButton(page, "キャンセル");

		expect(await result.locator.count()).toBe(1);
		expect(result.strategy).toBe("role:button");
	});

	test("resolveButton finds button-like link", async () => {
		const result = await resolveButton(page, "ヘルプ");

		expect(await result.locator.count()).toBe(1);
		expect(result.strategy).toBe("role:link");
	});

	test("resolveButton throws not_found for missing button", async () => {
		await expect(resolveButton(page, "存在しないボタン")).rejects.toMatchObject({
			name: "ActionError",
			failureType: "not_found",
		});
	});

	test("resolveField finds input by label", async () => {
		const result = await resolveField(page, "名前");

		expect(await result.locator.count()).toBe(1);
		expect(result.strategy).toBe("label");
	});

	test("resolveField finds input by placeholder", async () => {
		const result = await resolveField(page, "メールアドレスを入力");

		expect(await result.locator.count()).toBe(1);
		expect(result.strategy).toBe("placeholder");
	});

	test("resolveLink finds link by role", async () => {
		const result = await resolveLink(page, "ホーム");

		expect(await result.locator.count()).toBe(1);
		expect(result.strategy).toBe("role:link");
	});

	test("resolveText finds visible text", async () => {
		const result = await resolveText(page, "商品名: テスト商品");

		expect(await result.locator.count()).toBe(1);
		expect(result.strategy).toBe("text");
	});
});
