import type { Locator, Page } from "playwright";

import { ActionError, type FailureType } from "./errors";

export interface ResolveResult {
	locator: Locator;
	strategy: string;
	confidence: "high" | "medium" | "low";
}

interface Strategy {
	name: string;
	confidence: ResolveResult["confidence"];
	builder: () => Locator;
}

interface AmbiguousMatch {
	strategy: string;
	locator: Locator;
	count: number;
}

function isPage(root: Page | Locator): root is Page {
	return typeof (root as Page).url === "function" && typeof (root as Page).title === "function";
}

async function getRootMetadata(root: Page | Locator): Promise<{ currentUrl: string; pageTitle: string }> {
	if (!isPage(root)) {
		return { currentUrl: "", pageTitle: "" };
	}

	return {
		currentUrl: root.url(),
		pageTitle: await root.title(),
	};
}

async function collectCandidates(locator: Locator, strategy: string, count: number) {
	const limit = Math.min(count, 5);
	const candidates: Array<{ selector: string; text: string; score: number }> = [];

	for (let index = 0; index < limit; index++) {
		const item = locator.nth(index);
		const text = (await item.innerText().catch(() => "")).trim();
		candidates.push({ selector: strategy, text, score: 0 });
	}

	return candidates;
}

async function throwActionError(
	root: Page | Locator,
	action: string,
	description: string,
	triedStrategies: string[],
	failureType: FailureType,
	ambiguous: AmbiguousMatch | null,
): Promise<never> {
	const { currentUrl, pageTitle } = await getRootMetadata(root);
	const candidates = ambiguous ? await collectCandidates(ambiguous.locator, ambiguous.strategy, ambiguous.count) : [];

	throw new ActionError(action, description, triedStrategies, candidates, failureType, currentUrl, pageTitle);
}

async function resolveByStrategies(
	root: Page | Locator,
	action: string,
	description: string,
	strategies: Strategy[],
): Promise<ResolveResult> {
	const triedStrategies: string[] = [];
	let ambiguous: AmbiguousMatch | null = null;

	for (const strategy of strategies) {
		triedStrategies.push(strategy.name);
		const locator = strategy.builder();
		const count = await locator.count();

		if (count === 1) {
			return {
				locator,
				strategy: strategy.name,
				confidence: strategy.confidence,
			};
		}

		if (count > 1) {
			ambiguous = {
				strategy: strategy.name,
				locator,
				count,
			};
		}
	}

	if (ambiguous) {
		return throwActionError(root, action, description, triedStrategies, "ambiguous", ambiguous);
	}

	return throwActionError(root, action, description, triedStrategies, "not_found", null);
}

export async function resolveButton(root: Page | Locator, description: string): Promise<ResolveResult> {
	return resolveByStrategies(root, "resolveButton", description, [
		{
			name: "role:button",
			confidence: "high",
			builder: () => root.getByRole("button", { name: description }),
		},
		{
			name: "role:link",
			confidence: "medium",
			builder: () => root.getByRole("link", { name: description }),
		},
		{
			name: "text:button-like",
			confidence: "low",
			builder: () => root.locator("button, a, [role='button']").filter({ hasText: description }),
		},
	]);
}

export async function resolveField(root: Page | Locator, description: string): Promise<ResolveResult> {
	return resolveByStrategies(root, "resolveField", description, [
		{
			name: "label",
			confidence: "high",
			builder: () => root.getByLabel(description),
		},
		{
			name: "placeholder",
			confidence: "medium",
			builder: () => root.getByPlaceholder(description),
		},
		{
			name: "role:textbox",
			confidence: "high",
			builder: () => root.getByRole("textbox", { name: description }),
		},
		{
			name: "role:combobox",
			confidence: "high",
			builder: () => root.getByRole("combobox", { name: description }),
		},
		{
			name: "role:spinbutton",
			confidence: "high",
			builder: () => root.getByRole("spinbutton", { name: description }),
		},
	]);
}

export async function resolveLink(root: Page | Locator, description: string): Promise<ResolveResult> {
	return resolveByStrategies(root, "resolveLink", description, [
		{
			name: "role:link",
			confidence: "high",
			builder: () => root.getByRole("link", { name: description }),
		},
		{
			name: "text:anchor",
			confidence: "medium",
			builder: () => root.locator("a").filter({ hasText: description }),
		},
	]);
}

export async function resolveText(root: Page | Locator, description: string): Promise<ResolveResult> {
	return resolveByStrategies(root, "resolveText", description, [
		{
			name: "text",
			confidence: "high",
			builder: () => root.getByText(description, { exact: false }),
		},
		{
			name: "label",
			confidence: "medium",
			builder: () => root.getByLabel(description),
		},
		{
			name: "role:heading",
			confidence: "medium",
			builder: () => root.getByRole("heading", { name: description }),
		},
	]);
}
