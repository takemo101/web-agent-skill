import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

// --- 設定読み込み ---
const CONFIG_PATH = ".taskp/skills/web-agent/config.json";

interface Config {
	authDir: string;
	timeout: number;
}

function loadConfig(): Config {
	const defaults: Config = { authDir: "auth", timeout: 30000 };
	if (!existsSync(CONFIG_PATH)) {
		return defaults;
	}
	const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Partial<Config>;
	return { ...defaults, ...raw };
}

// --- 引数バリデーション ---
const url = process.argv[2];
const siteName = process.argv[3];

if (!url || !siteName) {
	console.error("Usage: bun run src/login.ts <url> <site-name>");
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
const authDir = config.authDir;

// --- ブラウザ起動 ---
mkdirSync(authDir, { recursive: true });

const browser = await chromium.launch({ headless: false });
try {
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(url, { timeout: config.timeout });

	console.log("🔑 ブラウザでログインしてください...");
	console.log("   ログイン完了後、ターミナルで Enter を押してください");

	await new Promise<void>((resolve) => {
		process.stdin.once("data", () => resolve());
	});

	const outputPath = resolve(`${authDir}/${siteName}.json`);
	await context.storageState({ path: outputPath });
	console.log(`✅ セッション保存: ${authDir}/${siteName}.json`);
} finally {
	await browser.close();
}
