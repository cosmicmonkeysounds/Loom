# Steph's laptop: whisper.cpp for the server-room terminal, off the official
# release, into %LOCALAPPDATA%\loom-whisper (never the repo). Run once:
#
#   powershell -ExecutionPolicy Bypass -File scripts\server-room\install-whisper.ps1
#
# start-whisper.ps1 runs it. The terminal only ever talks to it on 127.0.0.1.
param(
  [string]$Tag = 'b5454',
  [string]$Model = 'ggml-small.en.bin'
)
$ErrorActionPreference = 'Stop'
$home_ = Join-Path $env:LOCALAPPDATA 'loom-whisper'
$bin = Join-Path $home_ 'bin'
$models = Join-Path $home_ 'models'
New-Item -ItemType Directory -Force $bin, $models | Out-Null

$zip = Join-Path $home_ 'whisper-bin-x64.zip'
if (-not (Test-Path (Join-Path $bin 'whisper-server.exe'))) {
  & curl.exe -fsSL -o $zip "https://github.com/ggml-org/whisper.cpp/releases/download/$Tag/whisper-bin-x64.zip"
  if ($LASTEXITCODE -ne 0) { throw "couldn't download whisper.cpp $Tag" }
  Expand-Archive -Path $zip -DestinationPath $bin -Force
  # The zip nests its files in Release\.
  $nested = Join-Path $bin 'Release'
  if (Test-Path $nested) {
    Get-ChildItem $nested | Move-Item -Destination $bin -Force
    Remove-Item $nested -Recurse -Force
  }
  Remove-Item $zip -Force
}
if (-not (Test-Path (Join-Path $bin 'whisper-server.exe'))) { throw 'whisper-server.exe is not in the release' }

$file = Join-Path $models $Model
if (-not (Test-Path $file)) {
  & curl.exe -fsSL -o "$file.part" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$Model"
  if ($LASTEXITCODE -ne 0) { throw "couldn't download $Model" }
  Move-Item "$file.part" $file -Force
}
Write-Output "whisper.cpp $Tag + $Model in $home_"
