# The whole public stack in one command, the same way every time:
#   web     https://dishy.pro   (frontend build + start, backend -Mode public, dishy tunnel)
#   app     exps://phxn89c-pzz5956-8081.exp.direct   (Expo Go through Expo's tunnel)
#
# Every service runs in its own visible PowerShell window, so closing a window
# stops that service. Nothing is reported ready until deploy-public -VerifyOnly
# and verify-expo-public both pass.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/start-public-all.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/start-public-all.ps1 -Stop
param(
  [switch]$Stop
)
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$frontendRoot = Join-Path $repoRoot 'frontend'
$mobileRoot = Join-Path $repoRoot 'mobile'

function Stop-PublicStack {
  Get-Process main, cloudflared, ngrok -ErrorAction SilentlyContinue | Stop-Process -Force
  foreach ($port in 3000, 8081) {
    Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique |
      ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
  }
  Start-Sleep 2
}

function Start-ServiceWindow([string]$title, [string]$workingDir, [string]$command) {
  $script = "`$Host.UI.RawUI.WindowTitle = '$title'; Set-Location '$workingDir'; $command"
  # Encoded, because Start-Process joins -ArgumentList with bare spaces and a
  # -Command with spaces and quotes in it arrives split apart.
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
  $window = Start-Process powershell -WorkingDirectory $workingDir -ArgumentList "-NoExit -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded" -PassThru
  Write-Host "    started  $title (window PID $($window.Id))"
}

if ($Stop) {
  Stop-PublicStack
  Write-Host 'Public web and app stopped.'
  exit 0
}

Write-Host '[A] Stopping anything left from the last run'
Stop-PublicStack

Write-Host '[B] Building the web (deploy-public -BuildOnly)'
& (Join-Path $PSScriptRoot 'deploy-public.ps1') -BuildOnly
if (-not $?) { throw 'Web build failed; nothing was started.' }

Write-Host '[C] Starting the services, one window each'
Start-ServiceWindow 'Dishy backend (public)' $repoRoot 'powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/start-backend.ps1 -Mode public'
Start-ServiceWindow 'Dishy web (public)' $frontendRoot 'npm.cmd run start:public'
Start-ServiceWindow 'Dishy tunnel (dishy.pro)' $frontendRoot 'npm.cmd run tunnel:public'
Start-ServiceWindow 'Dishy app (Expo pzz)' $mobileRoot 'npm.cmd run start:go:public'

Write-Host '[D] Checking the web'
& (Join-Path $PSScriptRoot 'deploy-public.ps1') -VerifyOnly
if (-not $?) { throw 'Web did not pass its checks; read the window titled "Dishy web (public)" and logs\frontend\current.' }

Write-Host '[E] Checking the app'
& (Join-Path $mobileRoot 'scripts\verify-expo-public.ps1')
if ($LASTEXITCODE -ne 0) { throw 'App did not pass its checks; read the window titled "Dishy app (Expo pzz)" and logs\mobile\expo.' }

Write-Host ''
Write-Host 'Everything is up:' -ForegroundColor Green
Write-Host '  web  https://dishy.pro  (api https://api.dishy.pro)'
Write-Host '  app  exps://phxn89c-pzz5956-8081.exp.direct'
Write-Host 'Stop everything: powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/start-public-all.ps1 -Stop'
