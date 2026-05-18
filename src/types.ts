export interface VaultRow {
	id: string;
	name: string;
	createdAt: string;
	updatedAt?: string;
}

export interface FileRow {
	id: string;
	path: string;
	sha256: string;
	size: number;
	mime: string;
	mtime: number;
	updatedAt: string;
}

export interface ManifestResp {
	vault: string;
	files: FileRow[];
}

export interface DeletedRow {
	path: string;
	deletedAt: string;
}

export interface DeltaResp {
	now: string;
	changed: FileRow[];
	deleted: DeletedRow[];
}

export interface InitSkipResp {
	skip: true;
	id: string;
	path: string;
}

export interface InitUploadResp {
	skip?: false;
	id: string;
	putUrl: string;
	headers: Record<string, string>;
	expiresIn: number;
}

export type InitResp = InitSkipResp | InitUploadResp;

export interface CreateVaultResp {
	id: string;
	name: string;
	createdAt: string;
}

export interface LocalFileState {
	sha: string;
	mtime: number;
	remoteUpdatedAt: string;
}

export interface PersistedState {
	files: Record<string, LocalFileState>;
	lastSyncIso: string | null;
}

export interface SmplSettings {
	serverUrl: string;
	apiKey: string;
	vaultId: string;
	vaultName: string;
	syncIntervalSec: number;
	debounceMs: number;
	excludeGlobs: string;
}

export const DEFAULT_SETTINGS: SmplSettings = {
	serverUrl: "https://smpl.rip",
	apiKey: "",
	vaultId: "",
	vaultName: "",
	syncIntervalSec: 60,
	debounceMs: 2000,
	excludeGlobs: [
		".obsidian/workspace.json",
		".obsidian/workspace-mobile.json",
		".trash/",
		".git/",
		".DS_Store",
		"Thumbs.db",
	].join("\n"),
};
