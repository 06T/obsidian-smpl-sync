import { Plugin } from "obsidian";
import { SmplApi } from "./src/api";
import { ExcludeMatcher } from "./src/exclude";
import { SmplSettingTab } from "./src/settings";
import { StatusBar } from "./src/status";
import { SyncEngine } from "./src/sync";
import { DEFAULT_SETTINGS, PersistedState, SmplSettings } from "./src/types";
import { VaultWatcher } from "./src/watcher";

interface SavedData {
	settings?: Partial<SmplSettings>;
	state?: Partial<PersistedState>;
}

const EMPTY_STATE: PersistedState = { files: {}, lastSyncIso: null };

export default class SmplSyncPlugin extends Plugin {
	settings!: SmplSettings;
	state!: PersistedState;
	api!: SmplApi;
	private exclude!: ExcludeMatcher;
	private engine!: SyncEngine;
	private watcher!: VaultWatcher;
	private statusBar!: StatusBar;

	async onload() {
		await this.loadSettingsAndState();

		this.api = new SmplApi(this.settings.serverUrl, this.settings.apiKey);
		this.exclude = new ExcludeMatcher(this.settings.excludeGlobs);

		const statusEl = this.addStatusBarItem();
		this.statusBar = new StatusBar(statusEl, this.app, () => {
			// Open settings tab for this plugin
			// @ts-ignore — open() is on Setting which is part of the public app shape
			this.app.setting?.open?.();
			// @ts-ignore
			this.app.setting?.openTabById?.(this.manifest.id);
		});

		this.engine = new SyncEngine({
			app: this.app,
			api: this.api,
			settings: this.settings,
			state: this.state,
			saveState: () => this.saveAll(),
			exclude: this.exclude,
			onStatusSyncing: (n) => this.statusBar.setSyncing(n),
			onStatusOk: () => this.statusBar.setOk(),
			onStatusError: (m) => this.statusBar.setError(m),
		});

		this.watcher = new VaultWatcher(
			this.app,
			this.engine,
			this.exclude,
			this.settings.debounceMs,
			(n) => this.statusBar.setSyncing(n),
			() => this.statusBar.setOk()
		);

		this.addSettingTab(new SmplSettingTab(this.app, this));

		this.addCommand({
			id: "smpl-sync-now",
			name: "Run initial sync",
			callback: () => void this.runInitialSync(),
		});

		this.app.workspace.onLayoutReady(() => {
			this.watcher.start();
			if (this.settings.apiKey && this.settings.vaultId) {
				void this.runInitialSync().then(() => this.engine.startPolling());
			}
		});
	}

	onunload() {
		this.watcher?.stop();
		this.engine?.stopPolling();
		this.statusBar?.destroy();
	}

	async loadSettingsAndState() {
		const raw = ((await this.loadData()) as SavedData) ?? {};
		this.settings = { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) };
		this.state = {
			files: raw.state?.files ?? {},
			lastSyncIso: raw.state?.lastSyncIso ?? null,
		};
	}

	private async saveAll() {
		const payload: SavedData = { settings: this.settings, state: this.state };
		await this.saveData(payload);
	}

	async saveSettings() {
		this.api.updateCreds(this.settings.serverUrl, this.settings.apiKey);
		await this.saveAll();
	}

	rebuildExcludeMatcher() {
		this.exclude = new ExcludeMatcher(this.settings.excludeGlobs);
		this.engine.updateDeps({ exclude: this.exclude });
		// watcher holds a reference; recreate it cleanly
		this.watcher.stop();
		this.watcher = new VaultWatcher(
			this.app,
			this.engine,
			this.exclude,
			this.settings.debounceMs,
			(n) => this.statusBar.setSyncing(n),
			() => this.statusBar.setOk()
		);
		this.watcher.start();
	}

	updateWatcherDebounce() {
		this.watcher.updateDebounce(this.settings.debounceMs);
	}

	restartPolling() {
		this.engine.stopPolling();
		if (this.settings.apiKey && this.settings.vaultId) {
			this.engine.startPolling();
		}
	}

	async runInitialSync() {
		if (!this.settings.apiKey || !this.settings.vaultId) return;
		await this.engine.initialSync();
		this.engine.stopPolling();
		this.engine.startPolling();
	}

	resetLocalState() {
		this.state = { ...EMPTY_STATE };
		void this.saveAll();
	}
}
