import { App, ButtonComponent, DropdownComponent, Modal, Notice, PluginSettingTab, Setting } from "obsidian";
import type SmplSyncPlugin from "../main";
import { VaultRow } from "./types";

export class SmplSettingTab extends PluginSettingTab {
	private vaultDropdown?: DropdownComponent;
	private cachedVaults: VaultRow[] = [];

	constructor(app: App, private plugin: SmplSyncPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "SMPL Sync" });

		new Setting(containerEl)
			.setName("Server URL")
			.setDesc("Base URL of your smpl.rip server. Default is https://smpl.rip.")
			.addText((t) =>
				t
					.setPlaceholder("https://smpl.rip")
					.setValue(this.plugin.settings.serverUrl)
					.onChange(async (v) => {
						this.plugin.settings.serverUrl = v.trim() || "https://smpl.rip";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("API key")
			.setDesc('Format "<id>.<secret>". Available in your smpl.rip dashboard.')
			.addText((t) => {
				t.inputEl.type = "password";
				t.setPlaceholder("xxxxxxxx.yyyyyyyy")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (v) => {
						this.plugin.settings.apiKey = v.trim();
						await this.plugin.saveSettings();
					});
			});

		const vaultSetting = new Setting(containerEl)
			.setName("Vault")
			.setDesc("Remote vault to sync this Obsidian vault into.");

		vaultSetting.addDropdown((dd) => {
			this.vaultDropdown = dd;
			this.rebuildVaultDropdown();
			dd.onChange(async (v) => {
				this.plugin.settings.vaultId = v;
				const row = this.cachedVaults.find((r) => r.id === v);
				this.plugin.settings.vaultName = row?.name ?? "";
				await this.plugin.saveSettings();
			});
		});

		vaultSetting.addButton((b: ButtonComponent) => {
			b.setButtonText("Refresh").onClick(async () => {
				await this.refreshVaults();
			});
		});

		vaultSetting.addButton((b: ButtonComponent) => {
			b.setButtonText("Create new").onClick(() => {
				new CreateVaultModal(this.app, async (name) => {
					try {
						const created = await this.plugin.api.createVault(name);
						this.plugin.settings.vaultId = created.id;
						this.plugin.settings.vaultName = created.name;
						await this.plugin.saveSettings();
						await this.refreshVaults();
						new Notice(`SMPL: created vault "${created.name}"`);
					} catch (e) {
						new Notice(
							`SMPL: failed to create vault — ${
								e instanceof Error ? e.message : String(e)
							}`
						);
					}
				}).open();
			});
		});

		new Setting(containerEl)
			.setName("Sync interval (seconds)")
			.setDesc("How often to poll the server for remote changes. Minimum 5.")
			.addText((t) =>
				t
					.setValue(String(this.plugin.settings.syncIntervalSec))
					.onChange(async (v) => {
						const n = Math.max(5, Math.floor(Number(v) || 60));
						this.plugin.settings.syncIntervalSec = n;
						await this.plugin.saveSettings();
						this.plugin.restartPolling();
					})
			);

		new Setting(containerEl)
			.setName("Watcher debounce (ms)")
			.setDesc("Wait this long after the last edit before uploading a file.")
			.addText((t) =>
				t
					.setValue(String(this.plugin.settings.debounceMs))
					.onChange(async (v) => {
						const n = Math.max(0, Math.floor(Number(v) || 2000));
						this.plugin.settings.debounceMs = n;
						await this.plugin.saveSettings();
						this.plugin.updateWatcherDebounce();
					})
			);

		new Setting(containerEl)
			.setName("Exclude patterns")
			.setDesc(
				"One glob per line. Trailing '/' = folder. '*' = within a segment. '**' = any depth."
			)
			.addTextArea((t) => {
				t.inputEl.rows = 8;
				t.inputEl.style.width = "100%";
				t.setValue(this.plugin.settings.excludeGlobs).onChange(async (v) => {
					this.plugin.settings.excludeGlobs = v;
					await this.plugin.saveSettings();
					this.plugin.rebuildExcludeMatcher();
				});
			});

		new Setting(containerEl)
			.setName("Run initial sync now")
			.setDesc("Pull manifest and reconcile with this Obsidian vault.")
			.addButton((b) =>
				b.setButtonText("Sync now").onClick(async () => {
					await this.plugin.runInitialSync();
				})
			);
	}

	private rebuildVaultDropdown() {
		const dd = this.vaultDropdown;
		if (!dd) return;
		dd.selectEl.empty();
		if (this.cachedVaults.length === 0) {
			dd.addOption("", "(click Refresh)");
		} else {
			dd.addOption("", "— select a vault —");
			for (const v of this.cachedVaults) dd.addOption(v.id, v.name);
		}
		dd.setValue(this.plugin.settings.vaultId);
	}

	private async refreshVaults() {
		try {
			this.cachedVaults = await this.plugin.api.listVaults();
			this.rebuildVaultDropdown();
		} catch (e) {
			new Notice(
				`SMPL: failed to list vaults — ${e instanceof Error ? e.message : String(e)}`
			);
		}
	}
}

class CreateVaultModal extends Modal {
	private name = "";
	constructor(app: App, private onSubmit: (name: string) => void | Promise<void>) {
		super(app);
	}
	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Create new SMPL vault" });
		new Setting(contentEl).setName("Name").addText((t) =>
			t.setPlaceholder("My Notes").onChange((v) => (this.name = v.trim()))
		);
		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText("Create")
					.setCta()
					.onClick(async () => {
						if (!this.name) {
							new Notice("Please enter a name.");
							return;
						}
						this.close();
						await this.onSubmit(this.name);
					})
			)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
	}
	onClose() {
		this.contentEl.empty();
	}
}
