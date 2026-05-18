const MIME_MAP: Record<string, string> = {
	md: "text/markdown",
	txt: "text/plain",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	pdf: "application/pdf",
	mp3: "audio/mpeg",
	mp4: "video/mp4",
	mov: "video/quicktime",
	wav: "audio/wav",
	ogg: "audio/ogg",
	webm: "video/webm",
	csv: "text/csv",
	json: "application/json",
};

export function detectMime(path: string): string {
	const idx = path.lastIndexOf(".");
	if (idx < 0) return "application/octet-stream";
	const ext = path.slice(idx + 1).toLowerCase();
	return MIME_MAP[ext] ?? "application/octet-stream";
}
