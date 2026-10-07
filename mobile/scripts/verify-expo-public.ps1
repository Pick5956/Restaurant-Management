# Gates start-expo-public.ps1: the app is ready only when the public manifest
# answers, its bundle URL and hostUri use the tunnel host, the bundle itself
# downloads, and the backend answers. Any failure stops with the step's name.
param(
  [string]$TunnelHost = 'phxn89c-pzz5956-8081.exp.direct',
  [string]$ApiUrl = 'https://api.dishy.pro',
  [int]$WaitSeconds = 180
)
$ErrorActionPreference = 'Stop'

function Fail([string]$step, [string]$detail) {
  Write-Host "    FAIL  $step - $detail" -ForegroundColor Red
  exit 1
}

Write-Host "[1] Local Metro"
$deadline = (Get-Date).AddSeconds($WaitSeconds)
$status = ''
while ((Get-Date) -lt $deadline) {
  try {
    $probe = Invoke-WebRequest 'http://localhost:8081/status' -UseBasicParsing -TimeoutSec 5
    # Metro sends no text content type, so .Content can come back as bytes.
    $status = [System.Text.Encoding]::UTF8.GetString($probe.RawContentStream.ToArray()).Trim()
  } catch {}
  if ($status -eq 'packager-status:running') { break }
  Start-Sleep 3
}
if ($status -ne 'packager-status:running') { Fail 'local Metro' 'not running on 8081; read the newest logs\mobile\expo\*-expo-go-public.err.log' }
Write-Host "    ok  packager-status:running"

Write-Host "[2] Public manifest"
$headers = @{ 'expo-platform' = 'android'; 'accept' = 'application/expo+json,application/json' }
$manifest = $null
while ((Get-Date) -lt $deadline) {
  try {
    $response = Invoke-WebRequest "https://$TunnelHost/" -Headers $headers -UseBasicParsing -TimeoutSec 30
    $text = [System.Text.Encoding]::UTF8.GetString($response.RawContentStream.ToArray())
    $manifest = $text | ConvertFrom-Json
    break
  } catch { Start-Sleep 5 }
}
if (-not $manifest) { Fail 'manifest' "https://$TunnelHost/ did not answer 200 (tunnel down or wrong urlRandomness)" }
if ($manifest.manifest) { $manifest = $manifest.manifest }
$bundleUrl = $manifest.launchAsset.url
$hostUri = $manifest.extra.expoClient.hostUri
if (-not $bundleUrl -or -not $bundleUrl.StartsWith("https://$TunnelHost/")) { Fail 'manifest' "bundle URL is not on the tunnel: $bundleUrl" }
if ($hostUri -ne $TunnelHost) { Fail 'manifest' "hostUri is $hostUri, want $TunnelHost" }
Write-Host "    ok  manifest, bundle URL and hostUri on $TunnelHost"

Write-Host "[3] Bundle"
$bundleFile = Join-Path $env:TEMP 'expo-public-bundle.js'
try {
  Invoke-WebRequest $bundleUrl -UseBasicParsing -TimeoutSec 600 -OutFile $bundleFile
} catch { Fail 'bundle' $_.Exception.Message }
$size = (Get-Item $bundleFile).Length
$pointsAtApi = Select-String -Path $bundleFile -Pattern $ApiUrl -SimpleMatch -Quiet
Remove-Item $bundleFile -Force
if ($size -lt 1000000) { Fail 'bundle' "only $size bytes" }
if (-not $pointsAtApi) { Fail 'bundle' "does not call $ApiUrl" }
Write-Host "    ok  $size bytes, calls $ApiUrl"

Write-Host "[4] Backend"
try {
  $ready = Invoke-WebRequest "$ApiUrl/readyz" -UseBasicParsing -TimeoutSec 20
} catch { Fail 'backend' "$ApiUrl/readyz did not answer: $($_.Exception.Message)" }
Write-Host "    ok  $ApiUrl/readyz $($ready.StatusCode)"

$metro = (Get-NetTCPConnection -State Listen -LocalPort 8081).OwningProcess | Select-Object -First 1
$ngrok = (Get-Process ngrok -ErrorAction SilentlyContinue | Select-Object -First 1).Id
Write-Host ""
Write-Host "Open in Expo Go: exps://$TunnelHost" -ForegroundColor Green
Write-Host "Metro PID $metro, ngrok PID $ngrok"
Write-Host "Stop: Stop-Process -Id $metro; Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process"
