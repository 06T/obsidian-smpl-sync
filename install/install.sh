#!/usr/bin/env bash
# SMPL Sync — Obsidian plugin installer (macOS + Linux)
#
#   curl -fsSL https://smpl.rip/install.sh | bash
#
# Flags:
#   --vault PATH          install into a specific vault (skips picker)
#   --from-local PATH     copy main.js/manifest.json from a local checkout
#                         instead of downloading
#   --release URL_BASE    base URL to download from (default: smpl.rip)

set -euo pipefail

PLUGIN_ID="smpl-sync"
PLUGIN_NAME="SMPL Sync"
DEFAULT_RELEASE="https://smpl.rip/plugins/${PLUGIN_ID}/latest"

VAULT_ARG=""
FROM_LOCAL=""
RELEASE="${DEFAULT_RELEASE}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --vault) VAULT_ARG="$2"; shift 2 ;;
    --from-local) FROM_LOCAL="$2"; shift 2 ;;
    --release) RELEASE="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# //;s/^#//'
      exit 0 ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
dim()  { printf '\033[2m%s\033[0m\n' "$1"; }
red()  { printf '\033[31m%s\033[0m\n' "$1" >&2; }

# 1. Find Obsidian config
case "$(uname -s)" in
  Darwin) CFG="$HOME/Library/Application Support/obsidian/obsidian.json" ;;
  Linux)  CFG="${XDG_CONFIG_HOME:-$HOME/.config}/obsidian/obsidian.json" ;;
  *)      red "Unsupported OS: $(uname -s). Use install.ps1 on Windows."; exit 1 ;;
esac

if [[ ! -f "$CFG" ]]; then
  red "Obsidian config not found at: $CFG"
  red "Open Obsidian once (create or open a vault), then re-run this script."
  exit 1
fi

# 2. Pick vault
if [[ -n "$VAULT_ARG" ]]; then
  VAULT="$VAULT_ARG"
else
  # Parse vaults via python3 (preinstalled on macOS; common on Linux).
  mapfile -t VAULTS < <(python3 - <<PY
import json, sys
with open(r"""$CFG""") as f: d = json.load(f)
for v in d.get("vaults", {}).values():
    p = v.get("path","")
    if p: print(p)
PY
  )

  if [[ ${#VAULTS[@]} -eq 0 ]]; then
    red "No vaults registered in Obsidian. Open Obsidian and create or open a vault first."
    exit 1
  fi

  if [[ ${#VAULTS[@]} -eq 1 ]]; then
    VAULT="${VAULTS[0]}"
    bold "Installing into the only vault found:"
    echo "  $VAULT"
  else
    bold "Pick a vault:"
    for i in "${!VAULTS[@]}"; do
      printf "  %d) %s\n" "$((i+1))" "${VAULTS[$i]}"
    done
    read -rp "Number: " choice
    if ! [[ "$choice" =~ ^[0-9]+$ ]] || (( choice < 1 || choice > ${#VAULTS[@]} )); then
      red "Invalid selection."; exit 1
    fi
    VAULT="${VAULTS[$((choice-1))]}"
  fi
fi

if [[ ! -d "$VAULT" ]]; then
  red "Vault path does not exist: $VAULT"; exit 1
fi

DEST="$VAULT/.obsidian/plugins/$PLUGIN_ID"
mkdir -p "$DEST"

# Pick a sha256 tool. macOS ships `shasum`; most Linux ships `sha256sum`.
if command -v shasum >/dev/null 2>&1; then
  SHA_CMD="shasum -a 256"
elif command -v sha256sum >/dev/null 2>&1; then
  SHA_CMD="sha256sum"
else
  SHA_CMD=""
fi

# Compute sha256 hex of $1 to stdout. Empty string if no tool available.
sha256_of() {
  if [[ -z "$SHA_CMD" ]]; then echo ""; return; fi
  # shellcheck disable=SC2086
  $SHA_CMD "$1" | awk '{print $1}'
}

# 3. Fetch plugin files
if [[ -n "$FROM_LOCAL" ]]; then
  bold "Copying from local build: $FROM_LOCAL"
  for f in main.js manifest.json; do
    if [[ ! -f "$FROM_LOCAL/$f" ]]; then
      red "Missing $FROM_LOCAL/$f. Run 'npm run build' first."; exit 1
    fi
    cp "$FROM_LOCAL/$f" "$DEST/$f"
  done
  if [[ -f "$FROM_LOCAL/styles.css" ]]; then
    cp "$FROM_LOCAL/styles.css" "$DEST/styles.css"
  fi
  # SMPL-VS-003: --from-local is developer mode; skip SHA verification because
  # local builds aren't expected to match the published SHA256SUMS.txt.
else
  bold "Downloading from $RELEASE"
  TMPDIR_DL="$(mktemp -d)"
  trap 'rm -rf "$TMPDIR_DL"' EXIT

  if [[ -z "$SHA_CMD" ]]; then
    red "Refusing to install: no sha256 tool found (need 'shasum' or 'sha256sum')."
    exit 1
  fi

  # SMPL-VS-003: download SHA256SUMS.txt first, then verify each artifact.
  if ! curl -fsSL "$RELEASE/SHA256SUMS.txt" -o "$TMPDIR_DL/SHA256SUMS.txt"; then
    red "Failed to download $RELEASE/SHA256SUMS.txt — refusing to install unverified files."
    exit 1
  fi

  for f in main.js manifest.json; do
    if ! curl -fsSL "$RELEASE/$f" -o "$TMPDIR_DL/$f"; then
      red "Failed to download $RELEASE/$f"; exit 1
    fi
    expected="$(awk -v target="$f" '$2 == target { print $1 }' "$TMPDIR_DL/SHA256SUMS.txt")"
    if [[ -z "$expected" ]]; then
      red "SHA256SUMS.txt does not list '$f'. Refusing to install."
      exit 1
    fi
    actual="$(sha256_of "$TMPDIR_DL/$f")"
    if [[ "$expected" != "$actual" ]]; then
      red "Checksum mismatch for $f."
      red "  expected: $expected"
      red "  actual:   $actual"
      rm -f "$TMPDIR_DL/main.js" "$TMPDIR_DL/manifest.json" "$TMPDIR_DL/SHA256SUMS.txt"
      exit 1
    fi
  done

  # Verified — copy into place.
  cp "$TMPDIR_DL/main.js" "$DEST/main.js"
  cp "$TMPDIR_DL/manifest.json" "$DEST/manifest.json"

  # styles.css is optional. Only fetch it if it's listed in SHA256SUMS.txt —
  # otherwise smpl.rip's SPA fallback returns 200 with HTML, which curl would
  # cheerfully save as styles.css. Check first, then verify like the others.
  if awk '$2 == "styles.css"' "$TMPDIR_DL/SHA256SUMS.txt" | grep -q .; then
    if curl -fsSL "$RELEASE/styles.css" -o "$TMPDIR_DL/styles.css"; then
      expected="$(awk -v target="styles.css" '$2 == target { print $1 }' "$TMPDIR_DL/SHA256SUMS.txt")"
      actual="$(sha256_of "$TMPDIR_DL/styles.css")"
      if [[ "$expected" == "$actual" ]]; then
        cp "$TMPDIR_DL/styles.css" "$DEST/styles.css"
      else
        red "Checksum mismatch for styles.css — skipping"
      fi
    fi
  fi
fi

bold "✓ Installed $PLUGIN_NAME at:"
echo "  $DEST"
echo
dim  "Next steps in Obsidian:"
echo "  1. Reload Obsidian (Cmd+R / Ctrl+R) or restart it"
echo "  2. Settings → Community plugins → enable community plugins if not already"
echo "  3. Find '$PLUGIN_NAME' under 'Installed plugins' and toggle it on"
echo "  4. Settings → $PLUGIN_NAME → paste API key from https://smpl.rip"
