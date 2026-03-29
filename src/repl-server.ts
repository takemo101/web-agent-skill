import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

interface RecordedAction {
	action: string;
	args?: Record<string, unknown>;
}

interface Session {
	id: string;
	page: Page;
	rootAgent: WebAgent;
	currentAgent: WebAgent;
	busy: boolean;
	history: RecordedAction[];
	failed: boolean;
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
	if (!input) return fallback;
	const parsed = Number.parseInt(input, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseTimeout(input: unknown, fallback: number): number {
	return typeof input === "number" && Number.isFinite(input) && input > 0 ? input : fallback;
}

async function getPageState(page: Page): Promise<{ url: string; title: string }> {
	try {
		return { url: page.url(), title: await page.title() };
	} catch {
		return { url: "unknown", title: "unknown" };
	}
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
	}
	if (chunks.length === 0) return {};
	return JSON.parse(Buffer.concat(chunks).toString("utf-8")) as unknown;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
	res.statusCode = statusCode;
	res.setHeader("Content-Type", "application/json");
	res.end(JSON.stringify(body));
}

function toExecBody(input: unknown): ExecRequestBody {
	if (typeof input !== "object" || input === null) return { action: "" };
	const body = input as Record<string, unknown>;
	return {
		action: typeof body.action === "string" ? body.action : "",
		args: typeof body.args === "object" && body.args !== null ? (body.args as Record<string, unknown>) : {},
		timeoutMs: typeof body.timeoutMs === "number" ? body.timeoutMs : undefined,
	};
}

function toErrorPayload(error: unknown): Record<string, unknown> {
	if (error instanceof ActionError) return error.toJSON();
	if (error instanceof Error) return { message: error.message };
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
				.map((el) => el.textContent?.trim() || el.getAttribute("aria-label") || "").filter(Boolean).slice(0, 20),
			links: getVisible("a[href]")
				.map((el) => el.textContent?.trim() || el.getAttribute("aria-label") || "").filter(Boolean).slice(0, 20),
			inputs: getVisible("input, textarea, select, [contenteditable='true']")
				.map((el) => ({
					type: el.tagName.toLowerCase() === "select" ? "select" : el.getAttribute("type") || "text",
					label: el.getAttribute("aria-label")
						|| document.querySelector("label[for='" + el.id + "']")?.textContent?.trim()
						|| el.getAttribute("placeholder") || "",
				})).slice(0, 20),
			headings: getVisible("h1, h2, h3")
				.map((el) => el.textContent?.trim() || "").filter(Boolean).slice(0, 10),
			forms: document.querySelectorAll("form").length,
		};
	})()`;
}

const config = loadConfig();
const cdpEndpoint = process.env.CDP_ENDPOINT ?? config.cdpEndpoint ?? DEFAULT_CDP_ENDPOINT;
const port = parsePort(process.env.REPL_PORT, config.replPort ?? DEFAULT_REPL_PORT);
const defaultActionTimeoutMs = config.timeout ?? DEFAULT_ACTION_TIMEOUT_MS;

async function tryShutdownExisting(): Promise<void> {
	try {
		const res = await fetch(`http://127.0.0.1:${port}/shutdown`, { method: "POST", signal: AbortSignal.timeout(2000) });
		if (res.ok) await new Promise((r) => setTimeout(r, 1000));
	} catch {
		// no existing server
	}
}

await tryShutdownExisting();

const browser = await chromium.connectOverCDP(cdpEndpoint);
const [context] = browser.contexts();
if (!context) throw new Error("No browser context found via CDP");

const sessions = new Map<string, Session>();
let shuttingDown = false;
let idleTimer: NodeJS.Timeout | undefined;

async function getOrCreateSession(id: string): Promise<Session> {
	const existing = sessions.get(id);
	if (existing) return existing;

	const page = await context.newPage();
	const rootAgent = createAgent(page);
	const session: Session = { id, page, rootAgent, currentAgent: rootAgent, busy: false, history: [], failed: false };
	sessions.set(id, session);
	return session;
}

const SCRIPTS_DIR = resolve(process.cwd(), "results/scripts");

function saveSessionScript(session: Session): string | null {
	if (session.failed || session.history.length === 0) return null;

	mkdirSync(SCRIPTS_DIR, { recursive: true });
	const safeName = session.id.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
	const filename = `${safeName}.json`;
	const filepath = resolve(SCRIPTS_DIR, filename);
	writeFileSync(filepath, JSON.stringify({ session: session.id, actions: session.history }, null, 2));
	return filepath;
}

async function destroySession(id: string): Promise<string | null> {
	const session = sessions.get(id);
	if (!session) return null;

	const savedPath = saveSessionScript(session);
	sessions.delete(id);
	await session.page.close().catch(() => {});
	return savedPath;
}

const shutdownServer = async (): Promise<void> => {
	if (shuttingDown) return;
	shuttingDown = true;
	if (idleTimer) clearTimeout(idleTimer);

	const closePromises = Array.from(sessions.values()).map((s) => s.page.close().catch(() => {}));
	await Promise.allSettled(closePromises);
	await browser.close().catch(() => {});
	process.exit(0);
};

const resetIdleTimer = (): void => {
	if (idleTimer) clearTimeout(idleTimer);
	idleTimer = setTimeout(() => void shutdownServer(), IDLE_TIMEOUT_MS);
};

function buildRunAction(session: Session) {
	return async (body: ExecRequestBody): Promise<unknown> => {
		const args = body.args ?? {};
		const timeout = parseTimeout(body.timeoutMs, defaultActionTimeoutMs);
		const { page } = session;

		const handlers: Record<string, () => Promise<unknown>> = {
			goto: async () => {
				await page.goto(String(args.url ?? ""), { timeout, waitUntil: "domcontentloaded" });
				return null;
			},
			clickButton: async () => session.currentAgent.clickButton(String(args.description ?? "")),
			clickLink: async () => session.currentAgent.clickLink(String(args.description ?? "")),
			click: async () => session.currentAgent.click(String(args.description ?? "")),
			fillField: async () => session.currentAgent.fillField(String(args.description ?? ""), String(args.value ?? "")),
			selectOption: async () =>
				session.currentAgent.selectOption(String(args.description ?? ""), String(args.value ?? "")),
			check: async () => session.currentAgent.check(String(args.description ?? "")),
			uncheck: async () => session.currentAgent.uncheck(String(args.description ?? "")),
			waitForText: async () =>
				session.currentAgent.waitForText(String(args.text ?? ""), {
					timeout: parseTimeout(args.timeoutMs, timeout),
				}),
			waitForUrl: async () =>
				session.currentAgent.waitForUrl(String(args.pattern ?? ""), {
					timeout: parseTimeout(args.timeoutMs, timeout),
				}),
			waitForVisible: async () =>
				session.currentAgent.waitForVisible(String(args.description ?? ""), {
					timeout: parseTimeout(args.timeoutMs, timeout),
				}),
			waitForHidden: async () =>
				session.currentAgent.waitForHidden(String(args.description ?? ""), {
					timeout: parseTimeout(args.timeoutMs, timeout),
				}),
			assertVisible: async () => session.currentAgent.assertVisible(String(args.description ?? "")),
			assertText: async () =>
				session.currentAgent.assertText(String(args.description ?? ""), String(args.expected ?? "")),
			extractText: async () => session.currentAgent.extractText(String(args.description ?? "")),
			extractTexts: async () => session.currentAgent.extractTexts(String(args.description ?? "")),
			extractAttribute: async () =>
				session.currentAgent.extractAttribute(String(args.description ?? ""), String(args.attribute ?? "")),
			section: async () => {
				session.currentAgent = await session.currentAgent.section(String(args.description ?? ""));
				return null;
			},
			resetSection: async () => {
				session.currentAgent = session.rootAgent;
				return null;
			},
			screenshot: async () => session.currentAgent.screenshot(String(args.path ?? "")),
			observe: async () => page.evaluate(createObserveScript()),
			evaluateFile: async () => {
				const code = readFileSync(String(args.path ?? ""), "utf-8");
				return page.evaluate(code);
			},
			close: async () => {
				const savedPath = await destroySession(session.id);
				return savedPath ? { closed: true, script: savedPath } : { closed: true, script: null };
			},
			replay: async () => {
				const scriptPath = String(args.path ?? "");
				const raw = JSON.parse(readFileSync(scriptPath, "utf-8")) as { actions: RecordedAction[] };
				const results: Array<{ action: string; ok: boolean; error?: string }> = [];

				for (const recorded of raw.actions) {
					try {
						const stepRunner = buildRunAction(session);
						await stepRunner({ action: recorded.action, args: recorded.args });
						results.push({ action: recorded.action, ok: true });
					} catch (e) {
						results.push({ action: recorded.action, ok: false, error: e instanceof Error ? e.message : "unknown" });
						break;
					}
				}

				return { replayed: results.length, total: raw.actions.length, results };
			},
		};

		const handler = handlers[body.action];
		if (!handler) throw new Error(`Unsupported action: ${body.action}`);
		return handler();
	};
}

const server = createServer(async (req, res) => {
	resetIdleTimer();
	const startAt = Date.now();
	const method = req.method ?? "GET";
	const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `127.0.0.1:${port}`}`);

	if (method === "GET" && url.pathname === "/health") {
		const sessionList = Array.from(sessions.keys());
		sendJson(res, 200, { ok: true, sessions: sessionList });
		return;
	}

	if (method === "POST" && url.pathname === "/shutdown") {
		sendJson(res, 200, { ok: true });
		setTimeout(() => void shutdownServer(), 100);
		return;
	}

	if (method !== "POST" || url.pathname !== "/exec") {
		sendJson(res, 404, { ok: false, error: { message: "Not found" } });
		return;
	}

	const sessionId = url.searchParams.get("session") ?? "default";
	const session = await getOrCreateSession(sessionId);

	if (session.busy) {
		sendJson(res, 503, {
			ok: false,
			error: { message: "Session busy, try again" },
			session: sessionId,
			state: await getPageState(session.page),
			meta: { durationMs: Date.now() - startAt },
		});
		return;
	}

	session.busy = true;

	try {
		const body = toExecBody(await readJsonBody(req));
		if (!body.action) throw new Error("Request body must include action");

		const runAction = buildRunAction(session);
		const result = await runAction(body);

		const recordable = body.action !== "observe" && body.action !== "close";
		if (recordable) {
			session.history.push({
				action: body.action,
				...(body.args && Object.keys(body.args).length > 0 ? { args: body.args } : {}),
			});
		}

		const state = sessions.has(sessionId) ? await getPageState(session.page) : { url: "closed", title: "closed" };
		sendJson(res, 200, { ok: true, result, session: sessionId, state, meta: { durationMs: Date.now() - startAt } });
	} catch (error) {
		session.failed = true;
		const state = sessions.has(sessionId) ? await getPageState(session.page) : { url: "closed", title: "closed" };
		sendJson(res, 200, {
			ok: false,
			error: toErrorPayload(error),
			session: sessionId,
			state,
			meta: { durationMs: Date.now() - startAt },
		});
	} finally {
		if (sessions.has(sessionId)) session.busy = false;
	}
});

server.listen(port, "127.0.0.1", () => {
	resetIdleTimer();
	console.log(JSON.stringify({ ok: true, port }));
});

process.on("SIGINT", () => void shutdownServer());
process.on("SIGTERM", () => void shutdownServer());
