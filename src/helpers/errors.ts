export type FailureType = "not_found" | "ambiguous" | "not_actionable" | "timeout";

interface Candidate {
	selector: string;
	text: string;
	score: number;
}

export class ActionError extends Error {
	readonly name = "ActionError";

	constructor(
		readonly action: string,
		readonly description: string,
		readonly triedStrategies: string[],
		readonly candidates: Candidate[],
		readonly failureType: FailureType,
		readonly currentUrl: string,
		readonly pageTitle: string,
	) {
		const suggestion =
			failureType === "ambiguous"
				? `${candidates.length}個の候補: ${candidates.map((c) => `"${c.text}"`).join(", ")}`
				: failureType === "not_found"
					? `"${description}" に一致する要素なし`
					: failureType === "timeout"
						? `"${description}" のタイムアウト`
						: `要素は見つかったが操作不可（${failureType}）`;

		super(`${action}("${description}"): ${suggestion}`);
	}

	toJSON() {
		return {
			action: this.action,
			description: this.description,
			triedStrategies: this.triedStrategies,
			candidates: this.candidates,
			failureType: this.failureType,
			currentUrl: this.currentUrl,
			pageTitle: this.pageTitle,
			message: this.message,
		};
	}
}
