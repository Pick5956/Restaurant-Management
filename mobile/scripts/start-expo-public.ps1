# Opens the Expo Go app for outside access, the one way it is done on this PC:
# native Metro on 8081 through Expo's own tunnel, pointed at api.dishy.pro.
# The URL is always exps://phxn89c-pzz5956-8081.exp.direct because the
# tunnel's random part is pinned below. It blocks, so run it as a visible,
# stoppable task, then gate it with verify-expo-public.ps1.
param(
  [string]$UrlRandomness = 'phxn89c',
  [string]$ApiUrl = 'https://api.dishy.pro'
)
$ErrorActionPreference = 'Stop'

$mobileRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $mobileRoot
$logDir = Join-Path $repoRoot 'logs\mobile\expo'
$tempDir = 'D:\CapStone-Project\Cache\tmp'

$listener = Get-NetTCPConnection -State Listen -LocalPort 8081 -ErrorAction SilentlyContinue
if ($listener) {
  throw "Port 8081 is already taken by PID $($listener[0].OwningProcess). Stop the old Metro first."
}

# Expo builds the tunnel host from this value; left alone it gets regenerated
# and the owner's saved link stops working.
$settingsDir = Join-Path $mobileRoot '.expo'
New-Item -ItemType Directory -Force $settingsDir | Out-Null
Set-Content -Path (Join-Path $settingsDir 'settings.json') -Value "{`n  `"urlRandomness`": `"$UrlRandomness`"`n}" -Encoding ascii

New-Item -ItemType Directory -Force $logDir, $tempDir | Out-Null
$env:TEMP = $tempDir
$env:TMP = $tempDir
$env:EXPO_PUBLIC_API_URL = $ApiUrl
# Never CI: it turns off reload for the whole session.
Remove-Item Env:CI -ErrorAction SilentlyContinue

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outLog = Join-Path $logDir "$stamp-expo-go-public.out.log"
$errLog = Join-Path $logDir "$stamp-expo-go-public.err.log"
Write-Host "Starting Expo Go tunnel: exps://$($UrlRandomness.ToLower())-pzz5956-8081.exp.direct"
Write-Host "Logs: $outLog"

Set-Location $mobileRoot
# Through cmd so the logs stay plain UTF-8 text; PowerShell 5's own `>`
# writes UTF-16.
cmd.exe /c "npx.cmd expo start --go --tunnel --port 8081 > `"$outLog`" 2> `"$errLog`""
exit $LASTEXITCODE
