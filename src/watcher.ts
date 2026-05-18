import { App, EventRef, TAbstractFile, TFile } from "obsidian";
import { ExcludeMatcher } from "./exclude";
import { SyncEngine } from "./sync";

type Task =
	| { kind: "push"; path: string }
	| { kind: "delete"; path: string }
	| { kind: "rename"; oldPath: string; newPath: string };

export class VaultWatcher {
	private refs: EventRef[] = [];
	private timers = new Map<string, number>();
	private pending = new Map<string, Task>();
	private flushing = false;

	constructor(
		private app: App,
		private engine: SyncEngine,
		private exclude: ExcludeMatcher,
		private debounceMs: number,
		private onStatusSyncing: (n: number) => void,
		private onStatusOk: () => void
	) {}

	start() {
		const v = this.app.vault;
		this.refs.push(
			v.on("create", (f) => this.onChange(f, "push")),
			v.on("modify", (f) => this.onChange(f, "push")),
			v.on("delete", (f) => this.enqueueDelete(f.path)),
			v.on("rename", (f, oldPath) => this.enqueueRename(oldPath, f.path))
		);
	}

	stop() {
		const v = this.app.vault;
		for (const r of this.refs) v.offref(r);
		this.refs = [];
		for (const t of this.timers.values()) window.clearTimeout(t);
		this.timers.clear();
		this.pending.clear();
	}

	updateDebounce(ms: number) {
		this.debounceMs = ms;
	}

	private onChange(f: TAbstractFile, _kind: "push") {
		if (!(f instanceof TFile)) return;
		if (this.exclude.isExcluded(f.path)) return;
		this.enqueue(f.path, { kind: "push", path: f.path });
	}

	private enqueueDelete(path: string) {
		if (this.exclude.isExcluded(path)) return;
		this.enqueue(path, { kind: "delete", path });
	}

	private enqueueRename(oldPath: string, newPath: string) {
		// If both excluded, skip; otherwise let server handle as rename.
		if (this.exclude.isExcluded(oldPath) && this.exclude.isExcluded(newPath)) return;
		this.enqueue(newPath, { kind: "rename", oldPath, newPath });
	}

	private enqueue(key: string, task: Task) {
		this.pending.set(key, task);
		const prev = this.timers.get(key);
		if (prev !== undefined) window.clearTimeout(prev);
		const handle = window.setTimeout(() => {
			this.timers.delete(key);
			void this.flush();
		}, this.debounceMs);
		this.timers.set(key, handle);
	}

	private async flush() {
		if (this.flushing) return;
		this.flushing = true;
		try {
			while (this.pending.size > 0) {
				this.onStatusSyncing(this.pending.size);
				const [k, task] = this.pending.entries().next().value as [string, Task];
				this.pending.delete(k);
				try {
					if (task.kind === "push") {
						await this.engine.pushFile(task.path);
					} else if (task.kind === "delete") {
						await this.engine.deleteRemote(task.path);
					} else {
						await this.engine.renameRemote(task.oldPath, task.newPath);
					}
				} catch (e) {
					console.error("smpl-sync watcher flush error:", e);
				}
			}
			this.onStatusOk();
		} finally {
			this.flushing = false;
		}
	}
}
