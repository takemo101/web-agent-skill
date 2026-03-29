const DEFAULT_ENDPOINT = "http://localhost:9222";

interface ChromeVersionInfo {
	Browser: string;
	"Protocol-Version": string;
	"V8-Version": string;
	"WebKit-Version": string;
}

export async function ensureCdpAvailable(endpoint = DEFAULT_ENDPOINT): Promise<ChromeVersionInfo> {
	try {
		const res = await fetch(`${endpoint}/json/version`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const info = (await res.json()) as ChromeVersionInfo;
		console.log(`✅ Chrome接続: ${info.Browser}`);
		return info;
	} catch {
		console.error(`❌ Chrome (CDP) に接続できません: ${endpoint}\n`);

		if (process.platform === "darwin") {
			console.error(
				"Chromeを以下のコマンドで起動してください:\n\n" +
					"  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222\n",
			);
		} else if (process.platform === "win32") {
			console.error(
				"Chromeを以下のコマンドで起動してください:\n\n" +
					'  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222\n',
			);
		} else {
			console.error("Chromeを以下のコマンドで起動してください:\n\n  google-chrome --remote-debugging-port=9222\n");
		}

		console.error("起動後、再度このスクリプトを実行してください。");
		process.exit(1);
	}
}
