# SMPL Sync - Obsidian plugin installer (Windows)
#
#   iwr -useb https://raw.githubusercontent.com/06T/obsidian-smpl-sync/main/install/install.ps1 | iex
#
# Or download and run with:
#   powershell -ExecutionPolicy Bypass -File install.ps1
#
# Flags:
#   -Vault PATH          Install into a specific vault (skips picker)
#   -FromLocal PATH      Copy main.js/manifest.json from a local checkout
#   -Release URL_BASE    Base URL to download from
#                        (default: latest GitHub release assets)

[CmdletBinding()]
param(
    [string]$Vault,
    [string]$FromLocal,
    [string]$Release = "https://github.com/06T/obsidian-smpl-sync/releases/latest/download"
)

$ErrorActionPreference = "Stop"
$PluginId = "smpl-sync"
$PluginName = "SMPL Sync"

function Write-Bold($msg) { Write-Host $msg -ForegroundColor White }
function Write-Dim($msg)  { Write-Host $msg -ForegroundColor DarkGray }
function Write-Err($msg)  { Write-Host $msg -ForegroundColor Red }

$cfg = Join-Path $env:APPDATA "obsidian\obsidian.json"
if (-not (Test-Path $cfg)) {
    Write-Err "Obsidian config not found at: $cfg"
    Write-Err "Open Obsidian once (create or open a vault), then re-run this script."
    exit 1
}

if (-not $Vault) {
    $config = Get-Content $cfg -Raw | ConvertFrom-Json
    $vaults = @()
    if ($config.vaults) {
        foreach ($prop in $config.vaults.PSObject.Properties) {
            $p = $prop.Value.path
            if ($p) { $vaults += $p }
        }
    }

    if ($vaults.Count -eq 0) {
        Write-Err "No vaults registered in Obsidian. Open Obsidian and create or open a vault first."
        exit 1
    }

    if ($vaults.Count -eq 1) {
        $Vault = $vaults[0]
        Write-Bold "Installing into the only vault found:"
        Write-Host "  $Vault"
    } else {
        Write-Bold "Pick a vault:"
        for ($i = 0; $i -lt $vaults.Count; $i++) {
            Write-Host ("  {0}) {1}" -f ($i + 1), $vaults[$i])
        }
        $choice = Read-Host "Number"
        if (-not ($choice -match '^\d+$') -or [int]$choice -lt 1 -or [int]$choice -gt $vaults.Count) {
            Write-Err "Invalid selection."
            exit 1
        }
        $Vault = $vaults[[int]$choice - 1]
    }
}

if (-not (Test-Path $Vault)) {
    Write-Err "Vault path does not exist: $Vault"
    exit 1
}

$dest = Join-Path $Vault ".obsidian\plugins\$PluginId"
New-Item -ItemType Directory -Force -Path $dest | Out-Null

if ($FromLocal) {
    Write-Bold "Copying from local build: $FromLocal"
    foreach ($f in @("main.js", "manifest.json")) {
        $src = Join-Path $FromLocal $f
        if (-not (Test-Path $src)) {
            Write-Err "Missing $src. Run 'npm run build' first."
            exit 1
        }
        Copy-Item $src (Join-Path $dest $f) -Force
    }
    $css = Join-Path $FromLocal "styles.css"
    if (Test-Path $css) {
        Copy-Item $css (Join-Path $dest "styles.css") -Force
    }
} else {
    Write-Bold "Downloading from $Release"
    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    try {
        $sumsPath = Join-Path $tmp "SHA256SUMS.txt"
        try {
            Invoke-WebRequest -Uri "$Release/SHA256SUMS.txt" -OutFile $sumsPath -UseBasicParsing -ErrorAction Stop
        } catch {
            Write-Err "Failed to download $Release/SHA256SUMS.txt - refusing to install unverified files."
            exit 1
        }

        $expectedMap = @{}
        foreach ($line in Get-Content $sumsPath) {
            $line = $line.Trim()
            if ($line -eq "") { continue }
            $parts = $line -split '\s+', 2
            if ($parts.Count -eq 2) {
                $expectedMap[$parts[1]] = $parts[0].ToLower()
            }
        }

        foreach ($f in @("main.js", "manifest.json")) {
            $dl = Join-Path $tmp $f
            try {
                Invoke-WebRequest -Uri "$Release/$f" -OutFile $dl -UseBasicParsing -ErrorAction Stop
            } catch {
                Write-Err "Failed to download $Release/$f"
                exit 1
            }
            if (-not $expectedMap.ContainsKey($f)) {
                Write-Err "SHA256SUMS.txt does not list '$f'. Refusing to install."
                exit 1
            }
            $expected = $expectedMap[$f]
            $actual = (Get-FileHash -Algorithm SHA256 -Path $dl).Hash.ToLower()
            if ($expected -ne $actual) {
                Write-Err "Checksum mismatch for ${f}:"
                Write-Err "  expected: $expected"
                Write-Err "  actual:   $actual"
                Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $tmp "main.js")
                Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $tmp "manifest.json")
                exit 1
            }
        }

        Copy-Item (Join-Path $tmp "main.js") (Join-Path $dest "main.js") -Force
        Copy-Item (Join-Path $tmp "manifest.json") (Join-Path $dest "manifest.json") -Force

        if ($expectedMap.ContainsKey("styles.css")) {
            $cssDl = Join-Path $tmp "styles.css"
            try {
                Invoke-WebRequest -Uri "$Release/styles.css" -OutFile $cssDl -UseBasicParsing -ErrorAction Stop
                $expectedCss = $expectedMap["styles.css"]
                $actualCss = (Get-FileHash -Algorithm SHA256 -Path $cssDl).Hash.ToLower()
                if ($expectedCss -eq $actualCss) {
                    Copy-Item $cssDl (Join-Path $dest "styles.css") -Force
                } else {
                    Write-Err "Checksum mismatch for styles.css - skipping"
                }
            } catch {
                # styles.css fetch failed; optional, ignore.
            }
        }
    } finally {
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp
    }
}

Write-Bold ""
Write-Bold "Installed $PluginName at:"
Write-Host "  $dest"
Write-Host ""
Write-Dim "Next steps in Obsidian:"
Write-Host "  1. Reload Obsidian (Ctrl+R) or restart it"
Write-Host "  2. Settings -> Community plugins -> enable community plugins if not already"
Write-Host "  3. Find '$PluginName' under 'Installed plugins' and toggle it on"
Write-Host "  4. Settings -> $PluginName -> paste API key from https://smpl.rip"
