import type { Locator, Page } from "playwright";

import {
	checkBox,
	click,
	clickButton,
	clickLink,
	extractAttribute,
	extractText,
	extractTexts,
	fillField,
	selectOption,
	uncheckBox,
} from "./actions";
import { resolveText } from "./locator";

export interface WebAgent {
	clickButton(description: string): Promise<void>;
	clickLink(description: string): Promise<void>;
	click(description: string): Promise<void>;
	fillField(description: string, value: string): Promise<void>;
	selectOption(description: string, value: string): Promise<void>;
	check(description: string): Promise<void>;
	uncheck(description: string): Promise<void>;
	waitForText(text: string, opts?: { timeout?: number }): Promise<void>;
	waitForUrl(pattern: string, opts?: { timeout?: number }): Promise<void>;
	waitForVisible(description: string, opts?: { timeout?: number }): Promise<void>;
	waitForHidden(description: string, opts?: { timeout?: number }): Promise<void>;
	assertVisible(description: string): Promise<void>;
	assertText(description: string, expected: string): Promise<void>;
	extractText(description: string): Promise<string>;
	extractTexts(description: string): Promise<string[]>;
	extractAttribute(description: string, attribute: string): Promise<string | null>;
	section(description: string): Promise<WebAgent>;
	screenshot(path: string): Promise<void>;
	readonly page: Page;
}

function isPage(root: Page | Locator): root is Page {
	return typeof (root as Page).url === "function" && typeof (root as Page).title === "function";
}

function assertPage(input: Page | undefined): Page {
	if (!input) {
		throw new Error("A Page instance is required when creating an agent from Locator.");
	}

	return input;
}

export function createAgent(page: Page): WebAgent;
export function createAgent(pageOrLocator: Page | Locator, page?: Page): WebAgent;
export function createAgent(pageOrLocator: Page | Locator, page?: Page): WebAgent {
	const root = pageOrLocator;
	const boundPage = isPage(root) ? root : assertPage(page);

	return {
		page: boundPage,

		async clickButton(description: string): Promise<void> {
			await clickButton(root, description);
		},

		async clickLink(description: string): Promise<void> {
			await clickLink(root, description);
		},

		async click(description: string): Promise<void> {
			await click(root, description);
		},

		async fillField(description: string, value: string): Promise<void> {
			await fillField(root, description, value);
		},

		async selectOption(description: string, value: string): Promise<void> {
			await selectOption(root, description, value);
		},

		async check(description: string): Promise<void> {
			await checkBox(root, description);
		},

		async uncheck(description: string): Promise<void> {
			await uncheckBox(root, description);
		},

		async waitForText(text: string, opts?: { timeout?: number }): Promise<void> {
			await boundPage.getByText(text).waitFor({ timeout: opts?.timeout });
		},

		async waitForUrl(pattern: string, opts?: { timeout?: number }): Promise<void> {
			await boundPage.waitForURL(pattern, { timeout: opts?.timeout });
		},

		async waitForVisible(description: string, opts?: { timeout?: number }): Promise<void> {
			const result = await resolveText(root, description);
			await result.locator.waitFor({ state: "visible", timeout: opts?.timeout });
		},

		async waitForHidden(description: string, opts?: { timeout?: number }): Promise<void> {
			const result = await resolveText(root, description);
			await result.locator.waitFor({ state: "hidden", timeout: opts?.timeout });
		},

		async assertVisible(description: string): Promise<void> {
			const result = await resolveText(root, description);
			if (!(await result.locator.isVisible())) {
				throw new Error(`Expected "${description}" to be visible.`);
			}
		},

		async assertText(description: string, expected: string): Promise<void> {
			const actual = await extractText(root, description);
			if (actual !== expected) {
				throw new Error(`Expected "${description}" to equal "${expected}", got "${actual}".`);
			}
		},

		async extractText(description: string): Promise<string> {
			return extractText(root, description);
		},

		async extractTexts(description: string): Promise<string[]> {
			return extractTexts(root, description);
		},

		async extractAttribute(description: string, attribute: string): Promise<string | null> {
			return extractAttribute(root, description, attribute);
		},

		async section(description: string): Promise<WebAgent> {
			const result = await resolveText(root, description);
			const sectionRoot = result.locator.locator(
				"xpath=ancestor-or-self::*[self::section or self::article or self::aside or self::nav][1]",
			);

			if ((await sectionRoot.count()) === 0) {
				return createAgent(result.locator, boundPage);
			}

			return createAgent(sectionRoot.first(), boundPage);
		},

		async screenshot(path: string): Promise<void> {
			await boundPage.screenshot({ path });
		},
	};
}
