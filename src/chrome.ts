import { spawn } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { homedir } from "node:os";

const DEFAULT_ENDPOINT = "http://localhost:9222";
const DEFAULT_PROFILE_DIR = `${homedir()}/chrome-automation`;

const CHROME_SOURCE_PROFILES: Record<string, string> = {
	darwin: `${homedir()}/Library/Application Support/Google/Chrome`,
	linux: `${homedir()}/.config/google-chrome`,
	win32: `${homedir()}\\AppData\\Local\\Google\\Chrome\\User Data`,
};

const CHROME_PATHS: Record<string, string> = {
	darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	linux: "google-chrome",
	win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
};

interface ChromeVersionInfo {
	Browser: string;
	"Protocol-Version": string;
	"V8-Version": string;
	"WebKit-Version": string;
}

function resolveProfileDir(profileDir: string): string {
	return profileDir.replace(/^~/, homedir());
}

function copyProfileIfNeeded(profileDir: string): void {
	if (existsSync(profileDir)) return;

	const sourceProfile = CHROME_SOURCE_PROFILES[process.platform];
	if (!sourceProfile || !existsSync(sourceProfile)) {
		console.log(`📁 新規プロファイル作成: ${profileDir}`);
		return;
	}

	console.log("📋 Chromeプロファイルをコピー中...");
	cpSync(sourceProfile, profileDir, { recursive: true });
	console.log(`✅ コピー完了: ${profileDir}`);
}

export async function ensureCdpAvailable(endpoint = DEFAULT_ENDPOINT): Promise<ChromeVersionInfo> {
	try {
		const res = await fetch(`${endpoint}/json/version`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const info = (await res.json()) as ChromeVersionInfo;
		console.log(`✅ Chrome接続: ${info.Browser}`);
		return info;
	} catch {
		console.error(`❌ Chrome (CDP) に接続できません: ${endpoint}`);
		console.error("\nbun run chrome で起動してください。\n");
		process.exit(1);
	}
}

export function launchChrome(profileDir = DEFAULT_PROFILE_DIR, port = 9222): void {
	const resolved = resolveProfileDir(profileDir);
	const chromePath = CHROME_PATHS[process.platform];

	if (!chromePath) {
		console.error(`❌ 未対応のプラットフォーム: ${process.platform}`);
		process.exit(1);
	}

	copyProfileIfNeeded(resolved);

	const child = spawn(chromePath, [`--remote-debugging-port=${port}`, `--user-data-dir=${resolved}`], {
		detached: true,
		stdio: "ignore",
	});
	child.unref();

	console.log(`🚀 Chrome起動: port=${port}, profile=${resolved}`);
	console.log("   CDP接続準備が完了するまで数秒お待ちください。");
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const profileDir = process.argv[2] || DEFAULT_PROFILE_DIR;
	launchChrome(profileDir);
}
