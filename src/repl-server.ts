import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";

import { chromium, type Page } from "playwright";

import { ActionError, createAgent, type WebAgent } from "./helpers";

interface SkillConfig {
	cdpEndpoint?: string;
	replPort?: number;
	timeout?: number;
}

interface ExecRequestBody {
	action: string;
	args?: Record<string, unknown>;
	timeoutMs?: number;
}

const CONFIG_PATH = resolve(process.cwd(), ".taskp/skills/web-agent/config.json");
const DEFAULT_CDP_ENDPOINT = "http://localhost:9222";
const DEFAULT_REPL_PORT = 3000;
const DEFAULT_ACTION_TIMEOUT_MS = 30_000;
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

function loadConfig(): SkillConfig {
	try {
		const raw = readFileSync(CONFIG_PATH, "utf-8");
		return JSON.parse(raw) as SkillConfig;
	} catch {
		return {};
	}
}

function parsePort(input: string | undefined, fallback: number): number {
	if (!input) {
		return fallback;
	}

	const parsed = Number.parseInt(input, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return fallback;
	}

	return parsed;
}

function parseTimeout(input: unknown, fallback: number): number {
	if (typeof input !== "number" || !Number.isFinite(input) || input <= 0) {
		return fallback;
	}

	return input;
}

async function getPageState(page: Page): Promise<{ url: string; title: string }> {
	return {
		url: page.url(),
		title: await page.title(),
	};
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];

	for await (const chunk of req) {
		if (typeof chunk === "string") {
			chunks.push(Buffer.from(chunk));
			continue;
		}

		chunks.push(chunk);
	}

	if (chunks.length === 0) {
		return {};
	}

	const raw = Buffer.concat(chunks).toString("utf-8");
	return JSON.parse(raw) as unknown;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
	res.statusCode = statusCode;
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify(body));
}

function toExecBody(input: unknown): ExecRequestBody {
	if (typeof input !== "object" || input === null) {
		return { action: "" };
	}

	const body = input as Record<string, unknown>;
	return {
		action: typeof body.action === "string" ? body.action : "",
		args: typeof body.args === "object" && body.args !== null ? (body.args as Record<string, unknown>) : {},
		timeoutMs: typeof body.timeoutMs === "number" ? body.timeoutMs : undefined,
	};
}

function toErrorPayload(error: unknown): Record<string, unknown> {
	if (error instanceof ActionError) {
		return error.toJSON();
	}

	if (error instanceof Error) {
		return { message: error.message };
	}

	return { message: "Unknown error" };
}

function createObserveScript(): string {
	return `(() => {
		const getVisible = (selector) => Array.from(document.querySelectorAll(selector)).filter((element) => {
			const rect = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
		});

		return {
			buttons: getVisible("button, [role='button'], input[type='submit']")
				.map((element) => element.textContent?.trim() || element.getAttribute("aria-label") || "")
				.filter(Boolean)
				.slice(0, 20),
			links: getVisible("a[href]")
				.map((element) => element.textContent?.trim() || element.getAttribute("aria-label") || "")
				.filter(Boolean)
				.slice(0, 20),
			inputs: getVisible("input, textarea, select, [contenteditable='true']")
				.map((element) => ({
					type: element.tagName.toLowerCase() === "select" ? "select" : element.getAttribute("type") || "text",
					label:
						element.getAttribute("aria-label") ||
						document.querySelector("label[for='" + element.id + "']")?.textContent?.trim() ||
						element.getAttribute("placeholder") ||
						"",
				}))
				.slice(0, 20),
			headings: getVisible("h1, h2, h3")
				.map((element) => element.textContent?.trim() || "")
				.filter(Boolean)
				.slice(0, 10),
			forms: document.querySelectorAll("form").length,
		};
	})()`;
}

const config = loadConfig();
const cdpEndpoint = process.env.CDP_ENDPOINT ?? config.cdpEndpoint ?? DEFAULT_CDP_ENDPOINT;
const port = parsePort(process.env.REPL_PORT, config.replPort ?? DEFAULT_REPL_PORT);
const defaultActionTimeoutMs = config.timeout ?? DEFAULT_ACTION_TIMEOUT_MS;

const browser = await chromium.connectOverCDP(cdpEndpoint);
const [context] = browser.contexts();

if (!context) {
	throw new Error("No browser context found via CDP");
}

const page = await context.newPage();
const rootAgent = createAgent(page);
let currentAgent: WebAgent = rootAgent;
let busy = false;
let shuttingDown = false;
let idleTimer: NodeJS.Timeout | undefined;

const shutdown = async (): Promise<void> => {
	if (shuttingDown) {
		return;
	}

	shuttingDown = true;
	if (idleTimer) {
		clearTimeout(idleTimer);
	}

	await Promise.allSettled([page.close(), browser.close()]);
	process.exit(0);
};

const resetIdleTimer = (): void => {
	if (idleTimer) {
		clearTimeout(idleTimer);
	}

	idleTimer = setTimeout(() => {
		void shutdown();
	}, IDLE_TIMEOUT_MS);
};

const runAction = async (body: ExecRequestBody): Promise<unknown> => {
	const args = body.args ?? {};
	const timeout = parseTimeout(body.timeoutMs, defaultActionTimeoutMs);

	const handlers: Record<string, () => Promise<unknown>> = {
		goto: async () => {
			await page.goto(String(args.url ?? ""), { timeout, waitUntil: "domcontentloaded" });
			return null;
		},
		clickButton: async () => currentAgent.clickButton(String(args.description ?? "")),
		clickLink: async () => currentAgent.clickLink(String(args.description ?? "")),
		click: async () => currentAgent.click(String(args.description ?? "")),
		fillField: async () => currentAgent.fillField(String(args.description ?? ""), String(args.value ?? "")),
		selectOption: async () => currentAgent.selectOption(String(args.description ?? ""), String(args.value ?? "")),
		check: async () => currentAgent.check(String(args.description ?? "")),
		uncheck: async () => currentAgent.uncheck(String(args.description ?? "")),
		waitForText: async () =>
			currentAgent.waitForText(String(args.text ?? ""), { timeout: parseTimeout(args.timeoutMs, timeout) }),
		waitForUrl: async () =>
			currentAgent.waitForUrl(String(args.pattern ?? ""), { timeout: parseTimeout(args.timeoutMs, timeout) }),
		waitForVisible: async () =>
			currentAgent.waitForVisible(String(args.description ?? ""), { timeout: parseTimeout(args.timeoutMs, timeout) }),
		waitForHidden: async () =>
			currentAgent.waitForHidden(String(args.description ?? ""), { timeout: parseTimeout(args.timeoutMs, timeout) }),
		assertVisible: async () => currentAgent.assertVisible(String(args.description ?? "")),
		assertText: async () => currentAgent.assertText(String(args.description ?? ""), String(args.expected ?? "")),
		extractText: async () => currentAgent.extractText(String(args.description ?? "")),
		extractTexts: async () => currentAgent.extractTexts(String(args.description ?? "")),
		extractAttribute: async () =>
			currentAgent.extractAttribute(String(args.description ?? ""), String(args.attribute ?? "")),
		section: async () => {
			currentAgent = await currentAgent.section(String(args.description ?? ""));
			return null;
		},
		resetSection: async () => {
			currentAgent = rootAgent;
			return null;
		},
		screenshot: async () => currentAgent.screenshot(String(args.path ?? "")),
		observe: async () => page.evaluate(createObserveScript()),
		evaluateFile: async () => {
			const code = readFileSync(String(args.path ?? ""), "utf-8");
			return page.evaluate(code);
		},
		shutdown: async () => {
			setTimeout(() => {
				void shutdown();
			}, 100);
			return "shutting down";
		},
	};

	const handler = handlers[body.action];
	if (!handler) {
		throw new Error(`Unsupported action: ${body.action}`);
	}

	return handler();
};

const server = createServer(async (req, res) => {
	resetIdleTimer();

	const startAt = Date.now();
	const method = req.method ?? "GET";
	const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `127.0.0.1:${port}`}`);

	if (method === "GET" && url.pathname === "/health") {
		sendJson(res, 200, {
			ok: true,
			busy,
			state: await getPageState(page),
		});
		return;
	}

	if (method === "POST" && url.pathname === "/shutdown") {
		sendJson(res, 200, { ok: true });
		setTimeout(() => {
			void shutdown();
		}, 100);
		return;
	}

	if (method !== "POST" || url.pathname !== "/exec") {
		sendJson(res, 404, { ok: false, error: { message: "Not found" } });
		return;
	}

	if (busy) {
		sendJson(res, 503, {
			ok: false,
			error: { message: "Server busy, try again" },
			state: await getPageState(page),
			meta: { durationMs: Date.now() - startAt },
		});
		return;
	}

	busy = true;

	try {
		const body = toExecBody(await readJsonBody(req));
		if (!body.action) {
			throw new Error("Request body must include action");
		}

		const result = await runAction(body);
		sendJson(res, 200, {
			ok: true,
			result,
			state: await getPageState(page),
			meta: { durationMs: Date.now() - startAt },
		});
	} catch (error) {
		sendJson(res, 200, {
			ok: false,
			error: toErrorPayload(error),
			state: await getPageState(page),
			meta: { durationMs: Date.now() - startAt },
		});
	} finally {
		busy = false;
	}
});

server.listen(port, "127.0.0.1", () => {
	resetIdleTimer();
	console.log(JSON.stringify({ ok: true, port }));
});

process.on("SIGINT", () => {
	void shutdown();
});

process.on("SIGTERM", () => {
	void shutdown();
});
