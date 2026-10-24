<#
.SYNOPSIS
    The house PC's show-night check: power, broker, Zigbee, stagehand,
    the server, the TV kiosk - then `showctl preflight desktop` when the
    repo has it.

.DESCRIPTION
        .\preflight.ps1                 # everything (exit 1 on any FAIL)
        .\preflight.ps1 -WithAudio      # also the router + the MOTU (when it runs on this PC)
        .\preflight.ps1 -FixPower       # set sleep / screen-off / hibernate to never on AC first

    Nothing here changes the show: it reads services, ports, retained MQTT
    health topics, the scheduled tasks and GET /api/health. The
    `showctl preflight desktop` step (scripts\show\showctl.ps1, the show's
    own diagnostic CLI) asks the event server about this machine's
    terminal and jobs; it needs $env:LOOM_MOD_CODE (a mod passcode) and is
    skipped, with a note, when the repo or Node has no showctl.

.PARAMETER Server
    The event server (default: $env:LOOM_SERVER, else https://app.mapsandducks.com).
#>
[CmdletBinding()]
param(
    [switch]$WithAudio,
    [switch]$FixPower,
    [string]$Server,
    [string]$Config = 'trapped.desktop.yaml'
)

. "$PSScriptRoot\common.ps1"

if (-not $Server) { if ($env:LOOM_SERVER) { $Server = $env:LOOM_SERVER } else { $Server = $script:DefaultServer } }
$Server = $Server.TrimEnd('/')

# -- power ------------------------------------------------------------------

function Get-PowerIndex([string]$Sub, [string]$Setting) {
    $out = & powercfg /q SCHEME_CURRENT $Sub $Setting 2>$null
    $line = @($out | Where-Object { $_ -match 'Current AC Power Setting Index' }) | Select-Object -First 1
    if ($line -and $line -match '0x([0-9a-fA-F]+)') { return [Convert]::ToInt32($Matches[1], 16) }
    return $null
}

Write-Step 'Power (the TV and the jobs must never sleep)'
if ($FixPower) {
    & powercfg /change standby-timeout-ac 0
    & powercfg /change monitor-timeout-ac 0
    & powercfg /change hibernate-timeout-ac 0
    Write-Note 'set: sleep, screen off and hibernate never (on AC)'
}
foreach ($pair in @(@('SUB_SLEEP', 'STANDBYIDLE', 'sleep'), @('SUB_VIDEO', 'VIDEOIDLE', 'screen off'), @('SUB_SLEEP', 'HIBERNATEIDLE', 'hibernate'))) {
    $v = Get-PowerIndex $pair[0] $pair[1]
    if ($null -eq $v) { Write-Warn ('could not read the ' + $pair[2] + ' timeout (powercfg)') }
    elseif ($v -eq 0) { Write-Ok ($pair[2] + ': never') }
    else { Write-Bad ($pair[2] + ' after ' + $v + ' s on AC: .\preflight.ps1 -FixPower') }
}
$wu = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings' -ErrorAction SilentlyContinue
$until = $null
if ($wu -and ($wu.PSObject.Properties.Name -contains 'PauseUpdatesExpiryTime')) { $until = $wu.PauseUpdatesExpiryTime }
if ($until) { Write-Ok ('Windows Update paused until ' + $until) } else { Write-Warn 'Windows Update is not paused: Settings -> Windows Update -> Pause (past Nov 1), or a reboot may land mid-show' }
$auto = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' -ErrorAction SilentlyContinue
if ($auto -and ($auto.PSObject.Properties.Name -contains 'AutoAdminLogon') -and $auto.AutoAdminLogon -eq '1') { Write-Ok 'signs in by itself after a power cut (AutoAdminLogon)' } else { Write-Warn 'no automatic sign-in: after a power cut the stagehand jobs wait for someone to sign in (Sysinternals Autologon)' }

# -- the broker + Zigbee ----------------------------------------------------

& "$PSScriptRoot\setup-mosquitto.ps1" -Check | Out-Host
if ($LASTEXITCODE -ne 0) { $script:Failures++ }
& "$PSScriptRoot\zigbee2mqtt.ps1" -Check | Out-Host
if ($LASTEXITCODE -ne 0) { $script:Failures++ }

# -- stagehand ------------------------------------------------------------------

Write-Step 'stagehand'
$jobs = @('show', 'lights')
if ($WithAudio) { $jobs += 'audio'; $env:SD_ENABLE_ASIO = '1' }
$rc = Invoke-Stagehand @('check', '--config', $Config, '--only', ($jobs -join ','))
if ($rc -eq 0) { Write-Ok ('stagehand check --only ' + ($jobs -join ',')) } else { Write-Bad ('stagehand check failed (exit ' + $rc + ')') }
$null = Invoke-Stagehand @('tasks', 'status')
$health = Get-Retained 'health/#' 3
if ($null -eq $health) {
    Write-Warn 'mosquitto_sub not found: cannot read the health topics'
} else {
    # show = health/stagehand; lights = health/lights; the router = health/audio (wherever it runs).
    foreach ($pair in @(@('health/stagehand', 'show'), @('health/lights', 'lights'), @('health/audio', 'the router'))) {
        $line = @($health | Where-Object { $_ -like ($pair[0] + ' *') }) | Select-Object -First 1
        if ($line -and $line -match ' online') { Write-Ok ($pair[0] + ' online (' + $pair[1] + ')') }
        elseif ($line) { Write-Bad ($line + '  (' + $pair[1] + ')') }
        elseif ($pair[0] -eq 'health/audio' -and -not $WithAudio) { Write-Warn 'health/audio: nothing retained - is the router up on the MacBook (dialling this broker on :1884)? No router, no announcements' }
        else { Write-Bad ($pair[0] + ': nothing retained - is the ' + $pair[1] + ' job running?') }
    }
}

if ($WithAudio) {
    Write-Step 'The MOTU through ASIO'
    $listing = ''
    $uv = Find-Uv
    if ($uv) {
        Push-Location $script:StagehandDir
        try { $listing = (& $uv run python -m sounddevice 2>$null) -join "`n" } finally { Pop-Location }
    }
    if ($listing -match 'ASIO') { Write-Ok 'PortAudio sees an ASIO device'; ($listing -split "`n" | Where-Object { $_ -match 'ASIO' }) | ForEach-Object { Write-Note $_ } }
    else { Write-Bad 'no ASIO device: install MOTU''s Windows driver, or run the router on the MacBook (trapped.macbook.yaml)' }
}

# -- the server + the TV --------------------------------------------------------

Write-Step 'The event server'
try {
    $h = Invoke-RestMethod -Uri ($Server + '/api/health') -TimeoutSec 10
    Write-Ok ($Server + '/api/health answers (' + ($h | ConvertTo-Json -Compress -Depth 3) + ')')
} catch {
    Write-Bad ($Server + '/api/health: ' + $_.Exception.Message)
}

Write-Step 'The TV kiosk'
$tv = @(Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains('loom-tv') })
if ($tv.Count -eq 0) { Write-Bad 'the TV Chrome is not running: .\tv-kiosk.ps1' }
elseif (@($tv | Where-Object { $_.CommandLine.Contains('--kiosk') }).Count -gt 0) { Write-Ok 'the TV Chrome runs in kiosk mode' }
else { Write-Warn 'the TV Chrome runs, but not in kiosk mode (still -Setup?)' }
Write-Note 'by hand: Run -> Terminals shows TV live; the TV voice unmuted (M); Do not disturb on; Windows system sounds off'

# -- showctl ------------------------------------------------------------------

Write-Step 'showctl preflight desktop'
$showctl = Join-Path $script:LoomRoot 'scripts\show\showctl.ps1'
if (-not (Test-Path -LiteralPath $showctl)) {
    Write-Note 'no scripts\show\showctl.ps1 in this checkout: skipped'
} elseif (-not (Find-Exe 'node')) {
    Write-Warn 'Node is not installed (showctl needs Node 22.6+): winget install OpenJS.NodeJS.LTS'
} elseif (-not $env:LOOM_MOD_CODE) {
    Write-Warn 'LOOM_MOD_CODE is not set: showctl skipped ($env:LOOM_MOD_CODE = ''<mod passcode>'' in this window)'
} else {
    if (-not $env:LOOM_SERVER) { $env:LOOM_SERVER = $Server }
    & $showctl preflight desktop | Out-Host
    if ($LASTEXITCODE -ne 0) { Write-Bad ('showctl preflight desktop failed (exit ' + $LASTEXITCODE + ')') } else { Write-Ok 'showctl preflight desktop' }
}

Write-Host ''
if ($script:Failures -gt 0) {
    Write-Host ('PREFLIGHT: ' + $script:Failures + ' FAIL, ' + $script:Warnings + ' warning(s)') -ForegroundColor Red
    exit 1
}
Write-Host ('PREFLIGHT: OK, ' + $script:Warnings + ' warning(s)') -ForegroundColor Green
exit 0
