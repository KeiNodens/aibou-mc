# One-time: create the aibou-mc bridge tokens for the Muse connection.
# Tokens are stored OUTSIDE the repo at %USERPROFILE%\.aibou-mc\
# (bridge-token.txt = user token, bridge-admin-token.txt = admin token)
# and shown once here so you can paste them into Muse's secure entry form.
# Muse never sees the tokens in chat.
# D59: management tools (approve/deny/loop_resume) require the ADMIN token.
# Give Muse the ADMIN token; the Codex runner gets the USER token only.
$ErrorActionPreference = "Stop"
$dir = Join-Path $env:USERPROFILE ".aibou-mc"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$file = Join-Path $dir "bridge-token.txt"
if (Test-Path $file) {
  $token = (Get-Content $file -Raw).Trim()
  Write-Host "Existing token found (reusing it):"
} else {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $token = -join ($bytes | ForEach-Object { $_.ToString("x2") })
  Set-Content -Path $file -Value $token -Encoding ASCII -NoNewline
  Write-Host "New token created:"
}
Write-Host ""
Write-Host $token
Write-Host ""
Write-Host "Paste this into the Muse secure form (connector: custom.aibou-mc)."
Write-Host "To rotate later: delete $file and run this script again, then re-enter in Muse."

# --- Admin token (D59) ---
$adminFile = Join-Path $dir "bridge-admin-token.txt"
if (Test-Path $adminFile) {
  $admin = (Get-Content $adminFile -Raw).Trim()
  Write-Host ""
  Write-Host "Existing ADMIN token found (reusing it):"
} else {
  $bytes2 = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes2)
  $admin = -join ($bytes2 | ForEach-Object { $_.ToString("x2") })
  Set-Content -Path $adminFile -Value $admin -Encoding ASCII -NoNewline
  Write-Host ""
  Write-Host "New ADMIN token created:"
}
Write-Host ""
Write-Host $admin
Write-Host ""
Write-Host "Paste the ADMIN token into the Muse secure form (connector: custom.aibou-mc)."
Write-Host "The user token above is for the Codex runner / other clients."
