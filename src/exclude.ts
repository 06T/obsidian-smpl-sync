/**
 * Simple glob matcher. Supports:
 *   - literal segments
 *   - trailing '/' to match the folder and everything under it
 *   - '*' (any chars within a single path segment)
 *   - '**' (any sub-path, any depth)
 *
 * Inputs are normalized: backslashes → forward slashes.
 */

function normalize(p: string): string {
	return p.replace(/\\/g, "/").replace(/^\/+/, "");
}

function globToRegex(pattern: string): RegExp {
	const p = normalize(pattern.trim());
	if (!p) return /(?!)/; // never matches
	const folderOnly = p.endsWith("/");
	const body = folderOnly ? p.slice(0, -1) : p;

	let re = "";
	let i = 0;
	while (i < body.length) {
		const c = body[i];
		if (c === "*" && body[i + 1] === "*") {
			re += ".*";
			i += 2;
			if (body[i] === "/") i++;
		} else if (c === "*") {
			re += "[^/]*";
			i++;
		} else if (/[.+^$|()\[\]{}\\]/.test(c)) {
			re += "\\" + c;
			i++;
		} else if (c === "?") {
			re += "[^/]";
			i++;
		} else {
			re += c;
			i++;
		}
	}

	if (folderOnly) {
		// match the folder itself, OR any descendant
		return new RegExp("^" + re + "(/.*)?$");
	}
	// also allow matching a directory prefix (so a literal dir excludes its contents)
	return new RegExp("^" + re + "(/.*)?$");
}

export class ExcludeMatcher {
	private regexes: RegExp[];

	constructor(globText: string) {
		this.regexes = globText
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter((l) => l.length > 0 && !l.startsWith("#"))
			.map(globToRegex);
	}

	isExcluded(path: string): boolean {
		const p = normalize(path);
		for (const re of this.regexes) {
			if (re.test(p)) return true;
		}
		return false;
	}
}
