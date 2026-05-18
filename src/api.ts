import { requestUrl, RequestUrlParam, RequestUrlResponse } from "obsidian";
import {
	CreateVaultResp,
	DeltaResp,
	FileRow,
	InitResp,
	ManifestResp,
	VaultRow,
} from "./types";

export class SmplApiError extends Error {
	constructor(public status: number, message: string, public body?: unknown) {
		super(message);
		this.name = "SmplApiError";
	}
}

export class SmplApi {
	constructor(private serverUrl: string, private apiKey: string) {}

	updateCreds(serverUrl: string, apiKey: string) {
		this.serverUrl = serverUrl;
		this.apiKey = apiKey;
	}

	private url(action: string, params: Record<string, string> = {}): string {
		const base = this.serverUrl.replace(/\/+$/, "");
		const qp = new URLSearchParams({ action, ...params }).toString();
		return `${base}/api/vault.php?${qp}`;
	}

	private authHeaders(extra: Record<string, string> = {}): Record<string, string> {
		return {
			Authorization: `Bearer ${this.apiKey}`,
			Accept: "application/json",
			...extra,
		};
	}

	private async send<T>(opts: RequestUrlParam): Promise<T> {
		// Only retry methods that are safe to replay. complete is idempotent server-side.
		const params: RequestUrlParam = { ...opts, throw: false };
		const method = (opts.method ?? "GET").toUpperCase();
		const urlStr = typeof opts.url === "string" ? opts.url : "";
		const safeToRetry =
			method === "GET" || urlStr.includes("action=complete");
		const maxAttempts = safeToRetry ? 4 : 1;
		const backoffMs = [400, 1200, 3000];

		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			let resp: RequestUrlResponse;
			try {
				resp = await requestUrl(params);
			} catch (e: unknown) {
				if (attempt < maxAttempts - 1) {
					await new Promise((r) => setTimeout(r, backoffMs[attempt]));
					continue;
				}
				const msg = e instanceof Error ? e.message : String(e);
				throw new SmplApiError(0, `Network error: ${msg}`);
			}

			if (resp.status >= 200 && resp.status < 300) {
				if (!resp.text) return undefined as unknown as T;
				try {
					return resp.json as T;
				} catch {
					return undefined as unknown as T;
				}
			}

			const transient = resp.status >= 500 && resp.status < 600;
			if (transient && attempt < maxAttempts - 1) {
				// Honor Cloudflare's retryable:false signal (e.g. error 1102,
				// "worker exceeded resources") — retrying just hits the same
				// CPU/memory wall and worsens the overload.
				let retryable = true;
				try {
					const j = resp.json as
						| { retryable?: boolean; error_code?: number }
						| undefined;
					if (j && (j.retryable === false || j.error_code === 1102)) {
						retryable = false;
					}
				} catch {
					/* not JSON */
				}
				if (retryable) {
					await new Promise((r) => setTimeout(r, backoffMs[attempt]));
					continue;
				}
			}

			let bodyMsg = resp.text ?? "";
			try {
				const j = resp.json;
				if (j && typeof j === "object" && "error" in j) {
					const err = (j as { error?: unknown }).error;
					if (typeof err === "string") bodyMsg = err;
				}
			} catch {
				/* not JSON */
			}
			throw new SmplApiError(resp.status, bodyMsg || `HTTP ${resp.status}`, resp.text);
		}

		throw new SmplApiError(0, "Request failed after retries");
	}

	listVaults(): Promise<VaultRow[]> {
		return this.send<VaultRow[]>({
			url: this.url("vaults"),
			method: "GET",
			headers: this.authHeaders(),
		});
	}

	createVault(name: string): Promise<CreateVaultResp> {
		return this.send<CreateVaultResp>({
			url: this.url("create-vault"),
			method: "POST",
			headers: this.authHeaders({ "Content-Type": "application/json" }),
			body: JSON.stringify({ name }),
		});
	}

	manifest(vault: string): Promise<ManifestResp> {
		return this.send<ManifestResp>({
			url: this.url("manifest", { vault }),
			method: "GET",
			headers: this.authHeaders(),
		});
	}

	delta(vault: string, since: string): Promise<DeltaResp> {
		return this.send<DeltaResp>({
			url: this.url("delta", { vault, since }),
			method: "GET",
			headers: this.authHeaders(),
		});
	}

	init(input: {
		vault: string;
		path: string;
		sha256: string;
		size: number;
		mtime: number;
		mime: string;
	}): Promise<InitResp> {
		// Server expects mtime as ISO 8601.
		const payload = { ...input, mtime: new Date(input.mtime).toISOString() };
		return this.send<InitResp>({
			url: this.url("init"),
			method: "POST",
			headers: this.authHeaders({ "Content-Type": "application/json" }),
			body: JSON.stringify(payload),
		});
	}

	complete(id: string): Promise<FileRow> {
		return this.send<FileRow>({
			url: this.url("complete"),
			method: "POST",
			headers: this.authHeaders({ "Content-Type": "application/json" }),
			body: JSON.stringify({ id }),
		});
	}

	async uploadToR2(
		putUrl: string,
		headers: Record<string, string>,
		body: ArrayBuffer
	): Promise<void> {
		let resp: RequestUrlResponse;
		try {
			resp = await requestUrl({
				url: putUrl,
				method: "PUT",
				headers,
				body,
				throw: false,
			});
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			throw new SmplApiError(0, `R2 upload failed: ${msg}`);
		}
		if (resp.status < 200 || resp.status >= 300) {
			throw new SmplApiError(resp.status, `R2 upload failed: HTTP ${resp.status}`);
		}
	}

	async download(vault: string, path: string): Promise<ArrayBuffer> {
		// Two-step: get the presigned R2 URL, then fetch with no auth header
		// (R2 rejects Authorization alongside its query-param signature).
		const meta = await this.send<{ url: string }>({
			url: this.url("download", { vault, path }),
			method: "GET",
			headers: this.authHeaders(),
		});
		if (!meta || typeof meta.url !== "string" || !meta.url) {
			throw new SmplApiError(0, `Download failed: server did not return a URL`);
		}

		let signed: RequestUrlResponse;
		try {
			signed = await requestUrl({
				url: meta.url,
				method: "GET",
				throw: false,
			});
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			throw new SmplApiError(0, `R2 fetch failed: ${msg}`);
		}
		if (signed.status < 200 || signed.status >= 300) {
			throw new SmplApiError(signed.status, `R2 fetch failed: HTTP ${signed.status}`);
		}
		return signed.arrayBuffer;
	}

	deleteFile(vault: string, path: string): Promise<void> {
		return this.send<void>({
			url: this.url("delete"),
			method: "DELETE",
			headers: this.authHeaders({ "Content-Type": "application/json" }),
			body: JSON.stringify({ vault, path }),
		});
	}

	rename(vault: string, oldPath: string, newPath: string): Promise<void> {
		return this.send<void>({
			url: this.url("rename"),
			method: "POST",
			headers: this.authHeaders({ "Content-Type": "application/json" }),
			body: JSON.stringify({ vault, oldPath, newPath }),
		});
	}
}
