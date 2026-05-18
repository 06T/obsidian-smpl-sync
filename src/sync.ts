import { App, Notice, normalizePath } from "obsidian";
import { SmplApi, SmplApiError } from "./api";
import { ExcludeMatcher } from "./exclude";
import { sha256 } from "./hash";
import { detectMime } from "./mime";
import {
	DeltaResp,
	FileRow,
	LocalFileState,
	PersistedState,
	SmplSettings,
} from "./types";

export interface SyncDeps {
	app: App;
	api: SmplApi;
	settings: SmplSettings;
	state: PersistedState;
	saveState: () => Promise<void>;
	exclude: ExcludeMatcher;
	onStatusSyncing: (pending: number) => void;
	onStatusOk: () => void;
	onStatusError: (msg: string) => void;
}

const MAX_BACKOFF_MS = 5 * 60 * 1000;

export class SyncEngine {
	private pollHandle: number | null = null;
	private inflight = false;
	private retryDelay = 2000;

	constructor(private d: SyncDeps) {}

	updateDeps(patch: Partial<SyncDeps>) {
		this.d = { ...this.d, ...patch };
	}

	private get vault() {
		return this.d.settings.vaultId;
	}

	private isConfigured(): boolean {
		return !!(this.d.settings.apiKey && this.d.settings.vaultId);
	}

	async initialSync(): Promise<void> {
		if (!this.isConfigured()) return;
		this.d.onStatusSyncing(0);
		try {
			const manifest = await this.d.api.manifest(this.vault);
			const remoteByPath = new Map<string, FileRow>();
			for (const f of manifest.files) remoteByPath.set(f.path, f);

			// Local files (Markdown + everything else): iterate all vault files
			const allLocal = this.d.app.vault.getFiles();
			const localPaths = new Set<string>();
			for (const tf of allLocal) localPaths.add(tf.path);

			let processed = 0;
			const total = remoteByPath.size + localPaths.size;
			this.d.onStatusSyncing(total);

			// Remote → local pulls
			for (const [path, remote] of remoteByPath) {
				if (this.d.exclude.isExcluded(path)) {
					processed++;
					this.d.onStatusSyncing(Math.max(0, total - processed));
					continue;
				}
				try {
					if (!localPaths.has(path)) {
						await this.pullFile(remote);
					} else {
						// Both sides have it — compare
						const buf = await this.d.app.vault.adapter.readBinary(path);
						const localSha = await sha256(buf);
						if (localSha !== remote.sha256) {
							const stat = await this.d.app.vault.adapter.stat(path);
							const localMtime = stat?.mtime ?? 0;
							const knownRemoteAt = this.d.state.files[path]?.remoteUpdatedAt;
							if (knownRemoteAt && remote.updatedAt === knownRemoteAt) {
								// remote unchanged since we last knew → local is newer
								await this.pushFile(path);
							} else if (localMtime > new Date(remote.updatedAt).getTime()) {
								await this.conflictAndOverwrite(path, remote);
							} else {
								await this.pullFile(remote);
							}
						} else {
							this.d.state.files[path] = {
								sha: localSha,
								mtime: (await this.d.app.vault.adapter.stat(path))?.mtime ?? 0,
								remoteUpdatedAt: remote.updatedAt,
							};
						}
					}
				} catch (e) {
					this.reportError(e);
				}
				processed++;
				this.d.onStatusSyncing(Math.max(0, total - processed));
			}

			// Local → remote pushes (files not on remote)
			for (const path of localPaths) {
				if (remoteByPath.has(path)) continue;
				if (this.d.exclude.isExcluded(path)) continue;
				try {
					await this.pushFile(path);
				} catch (e) {
					this.reportError(e);
				}
			}

			this.d.state.lastSyncIso = new Date().toISOString();
			await this.d.saveState();
			this.d.onStatusOk();
		} catch (e) {
			this.reportError(e);
		}
	}

	private async conflictAndOverwrite(path: string, remote: FileRow): Promise<void> {
		const iso = new Date().toISOString().replace(/[:.]/g, "-");
		const dot = path.lastIndexOf(".");
		const slash = path.lastIndexOf("/");
		const stem = dot > slash ? path.slice(0, dot) : path;
		const ext = dot > slash ? path.slice(dot) : "";
		const renamedPath = normalizePath(`${stem} (conflict ${iso})${ext}`);
		try {
			const buf = await this.d.app.vault.adapter.readBinary(path);
			await this.d.app.vault.adapter.writeBinary(renamedPath, buf);
			new Notice(`SMPL: conflict — kept local as ${renamedPath}`);
		} catch (e) {
			console.error("smpl-sync: failed to write conflict copy", e);
		}
		await this.pullFile(remote);
	}

	async pushFile(path: string): Promise<void> {
		if (!this.isConfigured()) return;
		if (this.d.exclude.isExcluded(path)) return;
		const adapter = this.d.app.vault.adapter;
		if (!(await adapter.exists(path))) return;
		const buf = await adapter.readBinary(path);
		const stat = await adapter.stat(path);
		const mtime = stat?.mtime ?? Date.now();
		const sha = await sha256(buf);
		const mime = detectMime(path);

		const init = await this.d.api.init({
			vault: this.vault,
			path,
			sha256: sha,
			size: buf.byteLength,
			mtime,
			mime,
		});

		let finalRow: FileRow | undefined;
		if ("skip" in init && init.skip) {
			this.d.state.files[path] = {
				sha,
				mtime,
				remoteUpdatedAt:
					this.d.state.files[path]?.remoteUpdatedAt ?? new Date().toISOString(),
			};
		} else {
			// init.headers includes the signed x-amz-checksum-sha256 — forward verbatim.
			const uploadHeaders = init.headers ?? {};
			const hasChecksumHeader = Object.keys(uploadHeaders).some(
				(k) => k.toLowerCase() === "x-amz-checksum-sha256"
			);
			if (!hasChecksumHeader) {
				console.warn("smpl-sync: init.headers missing x-amz-checksum-sha256");
			}
			await this.d.api.uploadToR2(init.putUrl, uploadHeaders, buf);
			finalRow = await this.d.api.complete(init.id);
			this.d.state.files[path] = {
				sha,
				mtime,
				remoteUpdatedAt: finalRow?.updatedAt ?? new Date().toISOString(),
			};
		}
		await this.d.saveState();
	}

	async pullFile(remote: FileRow): Promise<void> {
		if (!this.isConfigured()) return;
		if (this.d.exclude.isExcluded(remote.path)) return;
		const adapter = this.d.app.vault.adapter;

		// Conflict check: if local exists with a different sha and is newer than our recorded remote
		if (await adapter.exists(remote.path)) {
			const buf = await adapter.readBinary(remote.path);
			const localSha = await sha256(buf);
			if (localSha === remote.sha256) {
				this.d.state.files[remote.path] = {
					sha: localSha,
					mtime: (await adapter.stat(remote.path))?.mtime ?? 0,
					remoteUpdatedAt: remote.updatedAt,
				};
				await this.d.saveState();
				return;
			}
			const stat = await adapter.stat(remote.path);
			const localMtime = stat?.mtime ?? 0;
			const knownRemoteAt = this.d.state.files[remote.path]?.remoteUpdatedAt;
			if (knownRemoteAt && remote.updatedAt === knownRemoteAt && localMtime > 0) {
				// We've seen this remote version; local diverged. Push our copy instead.
				await this.pushFile(remote.path);
				return;
			}
			if (localMtime > new Date(remote.updatedAt).getTime()) {
				await this.conflictAndOverwrite(remote.path, remote);
				return;
			}
		}

		const data = await this.d.api.download(this.vault, remote.path);
		// Ensure parent folder exists
		const slash = remote.path.lastIndexOf("/");
		if (slash > 0) {
			const dir = remote.path.slice(0, slash);
			if (!(await adapter.exists(dir))) {
				try {
					await adapter.mkdir(dir);
				} catch {
					// ignore — adapter may auto-create
				}
			}
		}
		await adapter.writeBinary(remote.path, data);
		const stat = await adapter.stat(remote.path);
		this.d.state.files[remote.path] = {
			sha: remote.sha256,
			mtime: stat?.mtime ?? Date.now(),
			remoteUpdatedAt: remote.updatedAt,
		};
		await this.d.saveState();
	}

	async deleteRemote(path: string): Promise<void> {
		if (!this.isConfigured()) return;
		if (this.d.exclude.isExcluded(path)) return;
		await this.d.api.deleteFile(this.vault, path);
		delete this.d.state.files[path];
		await this.d.saveState();
	}

	async renameRemote(oldPath: string, newPath: string): Promise<void> {
		if (!this.isConfigured()) return;
		if (this.d.exclude.isExcluded(oldPath) && this.d.exclude.isExcluded(newPath)) return;
		await this.d.api.rename(this.vault, oldPath, newPath);
		const prev = this.d.state.files[oldPath];
		if (prev) {
			this.d.state.files[newPath] = prev;
			delete this.d.state.files[oldPath];
		}
		await this.d.saveState();
	}

	async applyDelta(resp: DeltaResp): Promise<void> {
		for (const f of resp.changed) {
			if (this.d.exclude.isExcluded(f.path)) continue;
			try {
				await this.pullFile(f);
			} catch (e) {
				this.reportError(e);
			}
		}
		for (const d of resp.deleted) {
			if (this.d.exclude.isExcluded(d.path)) continue;
			try {
				const adapter = this.d.app.vault.adapter;
				if (await adapter.exists(d.path)) {
					await adapter.remove(d.path);
				}
				delete this.d.state.files[d.path];
			} catch (e) {
				this.reportError(e);
			}
		}
		this.d.state.lastSyncIso = resp.now;
		await this.d.saveState();
	}

	startPolling() {
		this.stopPolling();
		const ms = Math.max(5, this.d.settings.syncIntervalSec) * 1000;
		const tick = async () => {
			if (this.inflight) return;
			if (!this.isConfigured()) return;
			this.inflight = true;
			try {
				const since = this.d.state.lastSyncIso ?? "1970-01-01T00:00:00Z";
				const resp = await this.d.api.delta(this.vault, since);
				await this.applyDelta(resp);
				this.d.onStatusOk();
				this.retryDelay = 2000;
			} catch (e) {
				this.reportError(e);
				this.retryDelay = Math.min(MAX_BACKOFF_MS, this.retryDelay * 2);
			} finally {
				this.inflight = false;
			}
		};
		this.pollHandle = window.setInterval(tick, ms);
	}

	stopPolling() {
		if (this.pollHandle !== null) {
			window.clearInterval(this.pollHandle);
			this.pollHandle = null;
		}
	}

	private reportError(e: unknown) {
		let msg: string;
		if (e instanceof SmplApiError) {
			if (e.status === 403) {
				msg = "API key invalid or Lifetime plan required";
			} else if (e.status === 413) {
				msg = "Storage quota exceeded";
			} else if (e.status === 0) {
				msg = `Network: ${e.message}`;
			} else {
				msg = `HTTP ${e.status}: ${e.message}`;
			}
		} else {
			msg = e instanceof Error ? e.message : String(e);
		}
		new Notice(`SMPL: ${msg}`);
		this.d.onStatusError(msg);
		console.error("smpl-sync:", e);
	}

	getLocalState(path: string): LocalFileState | undefined {
		return this.d.state.files[path];
	}
}
