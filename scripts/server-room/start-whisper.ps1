# Steph's laptop: runs whisper.cpp on 127.0.0.1:8178 for the server-room
# terminal (`&whisper=1`). Safe to run twice. Install it first with
# install-whisper.ps1.
#
#   powershell -ExecutionPolicy Bypass -File scripts\server-room\start-whisper.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\server-room\start-whisper.ps1 -Stop
param(
  [int]$Port = 8178,
  [string]$Model = 'ggml-small.en.bin',
  [int]$Threads = 8,
  [switch]$Stop
)
$ErrorActionPreference = 'Stop'
$home_ = Join-Path $env:LOCALAPPDATA 'loom-whisper'
$exe = Join-Path $home_ 'bin\whisper-server.exe'

$running = Get-Process whisper-server -ErrorAction SilentlyContinue
if ($Stop) {
  if ($running) { $running | Stop-Process -Confirm:$false }
  Write-Output 'whisper stopped'
  return
}
if ($running) {
  Write-Output "whisper already running (pid $($running.Id -join ', '))"
  return
}
if (-not (Test-Path $exe)) { throw 'whisper is not installed: run install-whisper.ps1' }

$log = Join-Path $home_ 'whisper.log'
$args_ = @('-m', (Join-Path $home_ "models\$Model"), '-l', 'en', '-t', $Threads, '--host', '127.0.0.1', '--port', $Port, '--public', (Join-Path $home_ 'bin'))
Start-Process -FilePath $exe -ArgumentList $args_ -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError "$log.err" | Out-Null

# The model takes a moment to load: answer only once it does.
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2 | Out-Null
    Write-Output "whisper ready on 127.0.0.1:$Port"
    return
  } catch {
    if (-not (Get-Process whisper-server -ErrorAction SilentlyContinue)) { throw "whisper exited: see $log.err" }
  }
}
throw "whisper did not answer on port ${Port}: see $log.err"
