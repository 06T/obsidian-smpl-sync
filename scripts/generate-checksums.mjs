// SMPL-VS-003: emit SHA256SUMS.txt over the release artifacts so the installers
// can verify what they download. Run automatically after `npm run build`.
// File is named with a .txt extension so Cloudflare Pages serves it as a
// static asset; extension-less filenames fall through to the SPA Function and
// return a 404 HTML page.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const files = ["main.js", "manifest.json"];
const lines = files.map((f) => {
	const h = createHash("sha256").update(readFileSync(f)).digest("hex");
	return `${h}  ${f}`;
});
writeFileSync("SHA256SUMS.txt", lines.join("\n") + "\n");
console.log("Wrote SHA256SUMS.txt:\n" + lines.join("\n"));
