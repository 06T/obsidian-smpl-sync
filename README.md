# SMPL Sync

Sync your Obsidian vault to [smpl.rip](https://smpl.rip) across desktop and mobile. Content-addressed storage on Cloudflare R2, end-to-end SHA-256 verification, delta-based sync.

> ## ⚠ Requires a Lifetime plan on smpl.rip
>
> SMPL Sync only works for users with the **Lifetime** plan on [smpl.rip](https://smpl.rip). Free and other plans cannot create the API key the plugin needs.
>
> 1. Sign in at [smpl.rip](https://smpl.rip) with Discord
> 2. Upgrade to **Lifetime** from [smpl.rip/dashboard](https://smpl.rip/dashboard)
> 3. Then create an API key (see [Setup](#setup) below)
>
> Every API call from the plugin re-checks your plan on the server — if your account isn't Lifetime, the plugin will surface a `403: Vault sync requires the Lifetime plan` error and refuse to sync.

## Install

### Option 1 — BRAT (recommended)

If you don't already have it, install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin from Obsidian's Community Plugins browser. Then:

1. Settings → BRAT → **Add Beta Plugin**
2. Paste `06T/obsidian-smpl-sync`
3. Enable **SMPL Sync** under Community plugins → Installed plugins

BRAT auto-updates whenever a new GitHub release is published.

### Option 2 — One-line installer

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/06T/obsidian-smpl-sync/main/install/install.sh | bash
```

**Windows (PowerShell):**
```powershell
iwr -useb https://raw.githubusercontent.com/06T/obsidian-smpl-sync/main/install/install.ps1 | iex
```

Both installers:

- Auto-detect every Obsidian vault registered on the system (no need to know paths)
- Prompt you to pick one if you have multiple
- Download `main.js`, `manifest.json`, and `SHA256SUMS.txt` from the latest GitHub release
- Verify each file's SHA-256 against the manifest before copying into your vault

### Option 3 — Manual

Download `main.js`, `manifest.json`, and `SHA256SUMS.txt` from the [latest release](https://github.com/06T/obsidian-smpl-sync/releases/latest), verify the hashes (`shasum -a 256` on macOS/Linux, `Get-FileHash` on Windows), and drop the two binaries into `<vault>/.obsidian/plugins/smpl-sync/`.

## Setup

1. **Confirm you're on the Lifetime plan.** Free/other plans can't create API keys.
2. **Generate an API key:** smpl.rip → Dashboard → API Keys → *Create new key*. Copy it immediately — it's shown once.
3. Open Obsidian → Settings → **SMPL Sync**
4. **Server URL:** `https://smpl.rip` (default)
5. **API Key:** paste the key from step 2
6. **Vault:** click *Refresh*, then pick an existing remote vault or create a new one

The plugin starts syncing automatically. The status bar at the bottom of Obsidian shows current sync state (`✓ Synced`, `⟳ Uploading`, `⚠ Error`).

If you see `403: Vault sync requires the Lifetime plan`, your account isn't on Lifetime — upgrade at [smpl.rip/dashboard](https://smpl.rip/dashboard).

## What syncs

By default:

- All `.md` files
- All attachments referenced by your notes (images, PDFs, audio, video)

By default excluded:

- `.obsidian/workspace.json` and `.obsidian/workspace-mobile.json`
- `.trash/`
- `.git/`
- `.DS_Store`, `Thumbs.db`

Override the exclusion list in plugin settings.

## Security

- API keys are stored as plaintext in `<vault>/.obsidian/plugins/smpl-sync/data.json` per Obsidian's standard plugin storage. Anyone with filesystem access to the vault directory can read the key.
- Your API key grants full read/write access to every vault you own on smpl.rip — treat it like a password.
- If you suspect a key is leaked, revoke it from your smpl.rip dashboard. Revocation propagates within ~60 seconds.
- File integrity: every upload is checksummed end-to-end. R2 rejects mismatched PUTs at upload time and the server re-verifies on completion.
- Installer downloads are verified against `SHA256SUMS.txt` from the same GitHub release before being copied into your vault.

## Development

```bash
git clone https://github.com/06T/obsidian-smpl-sync
cd obsidian-smpl-sync
npm install
npm run dev             # watch + rebuild
# or
npm run build           # production bundle + SHA256SUMS.txt
```

Install your local build into a vault for live testing:

```bash
bash install/install.sh --from-local . --vault "/path/to/vault"
```

`--from-local` skips checksum verification (since dev builds won't match a published `SHA256SUMS.txt`).

## Releases

Releases are fully automated. Every time a `v*` tag is pushed, [`.github/workflows/release.yml`](.github/workflows/release.yml) runs and:

1. Checks out the tag
2. Installs dependencies with `npm ci`
3. Builds the production bundle (`npm run build`) — produces `main.js` + `SHA256SUMS.txt`
4. Packages a zip with `main.js` + `manifest.json` (+ `styles.css` if present)
5. Creates a public GitHub Release with the tag name, attaching:
   - `main.js`
   - `manifest.json`
   - `SHA256SUMS.txt`
   - `obsidian-smpl-sync-<tag>.zip`

### Cutting a release

```bash
# 1. Bump the version. `npm version` runs version-bump.mjs which updates
#    manifest.json and versions.json (BRAT reads versions.json for compatibility).
npm version patch        # or minor / major / 1.2.3

# 2. Push the commit and the new tag.
git push && git push --tags
```

Within ~2 minutes, the release is published at `https://github.com/06T/obsidian-smpl-sync/releases/latest` and:

- BRAT users get the update on next refresh
- `curl ... install.sh | bash` users get the new version on next run
- The `latest/download/<asset>` URLs resolve to the new release

No manual upload, no manual hashing — everything's deterministic from the tag.

## License

MIT
