import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const CONFIG_PATH = ".taskp/skills/web-agent/config.json";

interface Config {
	authDir: string;
	timeout: number;
	cdpEndpoint: string;
}

function loadConfig(): Config {
	const defaults: Config = { authDir: "auth", timeout: 30000, cdpEndpoint: "http://localhost:9222" };
	if (!existsSync(CONFIG_PATH)) {
		return defaults;
	}
	const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Partial<Config>;
	return { ...defaults, ...raw };
}

const useCdp = process.argv.includes("--cdp");
const args = process.argv.filter((a) => a !== "--cdp");
const url = args[2];
const siteName = args[3];

if (!url || !siteName) {
	console.error("Usage: bun run src/login.ts [--cdp] <url> <site-name>");
	process.exit(1);
}

if (!/^https?:\/\//.test(url)) {
	console.error("Error: URL は http:// または https:// で始まる必要があります");
	process.exit(1);
}

if (/[/\\]/.test(siteName)) {
	console.error("Error: site-name にパス区切り文字（/ \\）は使用できません");
	process.exit(1);
}

const config = loadConfig();
mkdirSync(config.authDir, { recursive: true });

if (useCdp) {
	const browser = await chromium.connectOverCDP(config.cdpEndpoint);
	const context = browser.contexts()[0];
	const page = await context.newPage();
	try {
		await page.goto(url, { timeout: config.timeout });

		console.log("🔑 Chromeでログインしてください...");
		console.log("   ログイン完了後、ターミナルで Enter を押してください");

		await new Promise<void>((r) => {
			process.stdin.once("data", () => r());
		});

		const outputPath = resolve(`${config.authDir}/${siteName}.json`);
		await context.storageState({ path: outputPath });
		console.log(`✅ セッション保存: ${config.authDir}/${siteName}.json`);
	} finally {
		await page.close();
		await browser.close();
	}
} else {
	const browser = await chromium.launch({ headless: false });
	try {
		const context = await browser.newContext();
		const page = await context.newPage();
		await page.goto(url, { timeout: config.timeout });

		console.log("🔑 ブラウザでログインしてください...");
		console.log("   ログイン完了後、ターミナルで Enter を押してください");

		await new Promise<void>((r) => {
			process.stdin.once("data", () => r());
		});

		const outputPath = resolve(`${config.authDir}/${siteName}.json`);
		await context.storageState({ path: outputPath });
		console.log(`✅ セッション保存: ${config.authDir}/${siteName}.json`);
	} finally {
		await browser.close();
	}
}
