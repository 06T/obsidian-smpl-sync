import { App, setTooltip } from "obsidian";

export type StatusState =
	| { kind: "idle" }
	| { kind: "syncing"; pending: number }
	| { kind: "ok"; at: number }
	| { kind: "error"; message: string };

export class StatusBar {
	private el: HTMLElement;
	private state: StatusState = { kind: "idle" };
	private tickHandle: number | null = null;

	constructor(el: HTMLElement, private app: App, private openSettings: () => void) {
		this.el = el;
		this.el.addClass("mod-clickable");
		this.el.style.cursor = "pointer";
		this.el.addEventListener("click", () => this.openSettings());
		this.render();
		// re-render every 5s so "Xs ago" stays fresh
		this.tickHandle = window.setInterval(() => this.render(), 5000);
	}

	setIdle() {
		this.state = { kind: "idle" };
		this.render();
	}

	setSyncing(pending: number) {
		this.state = { kind: "syncing", pending };
		this.render();
	}

	setOk() {
		this.state = { kind: "ok", at: Date.now() };
		this.render();
	}

	setError(message: string) {
		this.state = { kind: "error", message };
		this.render();
	}

	private render() {
		switch (this.state.kind) {
			case "idle":
				this.el.setText("SMPL: idle");
				setTooltip(this.el, "SMPL Sync is idle. Click to open settings.");
				break;
			case "syncing":
				this.el.setText(`SMPL: ↻ ${this.state.pending}`);
				setTooltip(this.el, `Syncing ${this.state.pending} file(s)…`);
				break;
			case "ok": {
				const secs = Math.max(0, Math.floor((Date.now() - this.state.at) / 1000));
				this.el.setText(`SMPL: ✓ ${secs}s ago`);
				setTooltip(this.el, "Last sync succeeded. Click to open settings.");
				break;
			}
			case "error":
				this.el.setText("SMPL: ⚠ error");
				setTooltip(this.el, this.state.message);
				break;
		}
	}

	destroy() {
		if (this.tickHandle !== null) {
			window.clearInterval(this.tickHandle);
			this.tickHandle = null;
		}
	}
}
