# Start the aibou-mc bridge for Muse operation:
# - BRIDGE_TOKEN from setup-token.ps1 (Bearer auth on /mcp and /inject)
# - RUNNER=off so the Codex runner does not also answer in-game chat
# Keep this window open while playing with Muse. Ctrl+C stops the bridge.
$ErrorActionPreference = "Stop"
$file = Join-Path $env:USERPROFILE ".aibou-mc\bridge-token.txt"
if (-not (Test-Path $file)) { throw "No token file. Run setup-token.ps1 first." }
$env:BRIDGE_TOKEN = (Get-Content $file -Raw).Trim()
$env:RUNNER = "off"
Set-Location C:\dev\minecrafttogether\bridge
npm run build
node dist/index.js
