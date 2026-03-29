import type { Locator, Page } from "playwright";

import { ActionError } from "./errors";
import { resolveButton, resolveField, resolveLink, resolveText } from "./locator";

export async function clickButton(root: Page | Locator, description: string): Promise<void> {
	const result = await resolveButton(root, description);
	await result.locator.click();
}

export async function clickLink(root: Page | Locator, description: string): Promise<void> {
	const result = await resolveLink(root, description);
	await result.locator.click();
}

export async function click(root: Page | Locator, description: string): Promise<void> {
	try {
		await clickButton(root, description);
		return;
	} catch (error) {
		if (!(error instanceof ActionError) || error.failureType !== "not_found") {
			throw error;
		}
	}

	try {
		await clickLink(root, description);
		return;
	} catch (error) {
		if (!(error instanceof ActionError) || error.failureType !== "not_found") {
			throw error;
		}
	}

	const result = await resolveText(root, description);
	await result.locator.click();
}

export async function fillField(root: Page | Locator, description: string, value: string): Promise<void> {
	const result = await resolveField(root, description);
	const tagName = await result.locator.evaluate((element) => element.tagName.toLowerCase());

	if (tagName === "select") {
		await result.locator.selectOption(value);
		return;
	}

	await result.locator.fill(value);
}

export async function selectOption(root: Page | Locator, description: string, value: string): Promise<void> {
	const result = await resolveField(root, description);
	await result.locator.selectOption(value);
}

export async function checkBox(root: Page | Locator, description: string): Promise<void> {
	const result = await resolveField(root, description);
	await result.locator.check();
}

export async function uncheckBox(root: Page | Locator, description: string): Promise<void> {
	const result = await resolveField(root, description);
	await result.locator.uncheck();
}

async function readText(locator: Locator): Promise<string> {
	const tagName = await locator.evaluate((element) => element.tagName.toLowerCase());

	if (tagName === "input" || tagName === "textarea" || tagName === "select") {
		return locator.inputValue();
	}

	const text = await locator.textContent();
	return text?.trim() ?? "";
}

export async function extractText(root: Page | Locator, description: string): Promise<string> {
	const result = await resolveText(root, description);
	return readText(result.locator);
}

export async function extractTexts(root: Page | Locator, description: string): Promise<string[]> {
	const result = await resolveText(root, description);
	const container = result.locator.locator(
		"xpath=ancestor-or-self::*[self::section or self::article or self::aside or self::nav or self::main or self::form][1]",
	);
	const target = (await container.count()) > 0 ? container.first() : result.locator;
	const rawText = await target.innerText();

	return rawText
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

export async function extractAttribute(
	root: Page | Locator,
	description: string,
	attribute: string,
): Promise<string | null> {
	const result = await resolveText(root, description);
	return result.locator.getAttribute(attribute);
}
