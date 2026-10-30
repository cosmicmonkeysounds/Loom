# Shared helpers for the house PC scripts (John's Desktop, Windows).
# Dot-source it:  . "$PSScriptRoot\common.ps1"
#
# Windows PowerShell 5.1 syntax only (no ?? / ?. / && / || / ternaries):
# a stock Windows 10 / 11 has 5.1, not pwsh 7. Keep every .ps1 here ASCII:
# 5.1 reads a BOM-less script in the ANSI code page, so a stray em dash
# would turn into mojibake inside a string.

# The repo checkout this script sits in (scripts\house-desktop\..\..).
$script:LoomRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$script:StagehandDir = Join-Path $script:LoomRoot 'stagehand'
$script:MosquittoDir = 'C:\Program Files\mosquitto'
$script:DefaultServer = 'https://app.mapsandducks.com'
# The soundtrack's playlist folders under stagehand\media\music\ (keep in
# step with stagehand\media\soundtrack.yaml; the Fan Closet's loop is in
# media\library\ambient\, rendered by `stagehand sounds library`).
$script:MusicFolders = @('act-1', 'act-2', 'act-3', 'ceremony', 'afterparty')
$script:MusicExtensions = @('.mp3', '.wav', '.flac', '.ogg', '.aiff', '.aif')

# stagehand's emoji log lines and its UTF-8 YAML must survive the console.
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'

# PowerShell 5.1 on .NET 4.x may still offer only TLS 1.0 / 1.1 by default;
# the event server (Caddy) wants 1.2.
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }

$script:Failures = 0
$script:Warnings = 0

function Write-Ok([string]$Text) { Write-Host ('  OK    ' + $Text) -ForegroundColor Green }
function Write-Bad([string]$Text) { $script:Failures++; Write-Host ('  FAIL  ' + $Text) -ForegroundColor Red }
function Write-Warn([string]$Text) { $script:Warnings++; Write-Host ('  WARN  ' + $Text) -ForegroundColor Yellow }
function Write-Note([string]$Text) { Write-Host ('        ' + $Text) -ForegroundColor Gray }
function Write-Step([string]$Text) { Write-Host ''; Write-Host ('== ' + $Text) -ForegroundColor Cyan }

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-Admin([string]$Why) {
    if (-not (Test-Admin)) {
        Write-Host ("This needs an elevated PowerShell (" + $Why + "): right-click PowerShell -> Run as administrator.") -ForegroundColor Red
        exit 2
    }
}

# The first existing path of $Candidates, else the command on PATH, else $null.
function Find-Exe([string]$Name, [string[]]$Candidates = @()) {
    foreach ($c in $Candidates) {
        if ($c -and (Test-Path -LiteralPath $c)) { return $c }
    }
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { return $cmd.Source }
    return $null
}

function Find-Uv {
    return Find-Exe 'uv' @((Join-Path $env:USERPROFILE '.local\bin\uv.exe'), (Join-Path $env:USERPROFILE '.cargo\bin\uv.exe'))
}

function Find-Chrome {
    $c = @()
    if ($env:ProgramFiles) { $c += (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe') }
    if (${env:ProgramFiles(x86)}) { $c += (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe') }
    if ($env:LOCALAPPDATA) { $c += (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe') }
    return Find-Exe 'chrome' $c
}

function Find-Mosquitto([string]$Tool = 'mosquitto') {
    return Find-Exe $Tool @((Join-Path $script:MosquittoDir ($Tool + '.exe')))
}

# A TCP connect within $TimeoutMs (Test-NetConnection is slow and chatty).
function Test-Port([string]$HostName, [int]$Port, [int]$TimeoutMs = 1500) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $ar = $client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $ar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) { return $false }
        $client.EndConnect($ar)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

# This PC's LAN IPv4 addresses (no loopback, no link-local). Call it as
# @(Get-LanAddresses): an empty answer unrolls to $null.
function Get-LanAddresses {
    $all = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }
    return @($all | ForEach-Object { $_.IPAddress })
}

# UTF-8 without a BOM: Set-Content -Encoding UTF8 writes a BOM in 5.1, and
# mosquitto reads a BOM as part of its first config keyword.
function Write-Utf8NoBom([string]$Path, [string]$Text) {
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Text, $enc)
}

# Every serial port Windows knows; call it as @(Get-SerialPorts). The
# CC2652P's CP2102N shows as "Silicon Labs CP210x USB to UART Bridge (COM5)"
# (the M4 is on Steph's laptop, never here).
function Get-SerialPorts {
    $rows = Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '\((COM\d+)\)' }
    $out = @()
    foreach ($r in $rows) {
        if ($r.Name -match '\((COM\d+)\)') {
            $out += New-Object PSObject -Property @{ Port = $Matches[1]; Name = $r.Name; Status = $r.Status }
        }
    }
    return $out
}

# Run stagehand through uv from the stagehand folder. Returns the exit code.
function Invoke-Stagehand([string[]]$Arguments) {
    $uv = Find-Uv
    if (-not $uv) {
        Write-Bad 'uv is not installed: powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"'
        return 127
    }
    Push-Location $script:StagehandDir
    try {
        # Out-Host: a native command's output inside a function would
        # otherwise become the function's return value.
        & $uv run stagehand @Arguments | Out-Host
        return $LASTEXITCODE
    } finally {
        Pop-Location
    }
}

# Retained MQTT messages under $Topic on the loopback broker, as
# "topic payload" lines (mosquitto_sub -v, waiting at most $Seconds).
function Get-Retained([string]$Topic, [int]$Seconds = 3) {
    $sub = Find-Mosquitto 'mosquitto_sub'
    if (-not $sub) { return $null }
    $lines = & $sub -h 127.0.0.1 -p 1883 -t $Topic -v -W $Seconds --retained-only 2>$null
    # The comma keeps an empty / one-line answer an array (PowerShell
    # unrolls a function's output, so @() alone would come back as $null).
    return ,@($lines)
}

# Zigbee2MQTT's own health_check, round trip: milliseconds, -1 when it stays
# silent for $Seconds, -2 with no mosquitto_rr. A process that is up and a
# retained "online" prove nothing: only this says it still answers. The
# deadline is ours: mosquitto_rr's -W does not bound a request nobody answers.
function Test-Z2mHealth([int]$Seconds = 5) {
    $rr = Find-Mosquitto 'mosquitto_rr'
    if (-not $rr) { return -2 }
    $out = [IO.Path]::GetTempFileName()
    $err = [IO.Path]::GetTempFileName()
    try {
        $clock = [Diagnostics.Stopwatch]::StartNew()
        $p = Start-Process -FilePath $rr -ArgumentList @('-h', '127.0.0.1', '-p', '1883', '-t', 'zigbee2mqtt/bridge/request/health_check', '-e', 'zigbee2mqtt/bridge/response/health_check', '-m', '{}') -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
        if (-not $p.WaitForExit($Seconds * 1000)) {
            try { $p.Kill() } catch { }
            return -1
        }
        $ms = [int]$clock.ElapsedMilliseconds
        if ((Get-Content -LiteralPath $out -Raw) -match 'status') { return $ms }
        return -1
    } finally {
        Remove-Item -LiteralPath $out, $err -ErrorAction SilentlyContinue
    }
}

# The lights job's retained stats as an object, or $null.
function Get-LightsStats {
    $lines = Get-Retained 'health/lights/stats' 2
    if ($null -eq $lines -or $lines.Count -eq 0 -or -not $lines[0]) { return $null }
    try { return (($lines[0] -split ' ', 2)[1] | ConvertFrom-Json) } catch { return $null }
}

# The mod passcode for a URL or a CLI call: the parameter, else LOOM_MOD_CODE.
# Never printed in full.
function Get-ModCode([string]$Given) {
    if ($Given) { return $Given }
    if ($env:LOOM_MOD_CODE) { return $env:LOOM_MOD_CODE }
    return $null
}

function Hide-Secret([string]$Text) {
    if (-not $Text) { return '(none)' }
    return '********'
}
