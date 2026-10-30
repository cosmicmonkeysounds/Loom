<#
.SYNOPSIS
    The TIDAL app for the house soundtrack: started so the audio router can
    drive it (wave 52).

.DESCRIPTION
    The router plays the acts from John's TIDAL playlists. It opens a playlist,
    presses Play, skips and pauses through the app's debug port, and hears the
    app through VoiceMeeter (stagehand/src/stagehand/audio/tidal.py, README
    section 3.7). Started any other way the app has no port, the router says
    "does not answer", and each act plays its fallback folder, or nothing.

        .\tidal.ps1                  # (re)start TIDAL with the port, minimized
        .\tidal.ps1 -Show            # the same with its window open
        .\tidal.ps1 -Check           # is it up, on the port, on the right device
        .\tidal.ps1 -InstallTask     # start it 30 s after every sign-in
        .\tidal.ps1 -Close           # stop TIDAL

    The port is on loopback only. It uses -disable-auto-update: the router
    finds the app's buttons by name, so the version that was rehearsed is the
    version that plays. Restarting stops whatever TIDAL is playing.

    Sign in to TIDAL once by hand. The app keeps its Sound output choice;
    the router puts it back on VoiceMeeter Aux Input if it has moved.

.PARAMETER Port
    The debug port (default 9333; the same as audio.tidal.port).
.PARAMETER Show
    Leave the window open instead of minimized.
.PARAMETER Check
    Report only; change nothing.
.PARAMETER InstallTask
    Register \Loom\tidal to start TIDAL 30 s after sign-in.
.PARAMETER Close
    Stop TIDAL and its player.
#>
[CmdletBinding()]
param(
    [int]$Port = 9333,
    [switch]$Show,
    [switch]$Check,
    [switch]$InstallTask,
    [switch]$Close
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"

function Find-TidalExe {
    # Squirrel keeps old versions beside the new one: the newest app-<version>.
    $root = Join-Path $env:LOCALAPPDATA 'TIDAL'
    $dirs = @(Get-ChildItem -LiteralPath $root -Directory -Filter 'app-*' -ErrorAction SilentlyContinue |
        Sort-Object { [version]($_.Name -replace '^app-', '') } -Descending)
    foreach ($d in $dirs) {
        $exe = Join-Path $d.FullName 'TIDAL.exe'
        if (Test-Path -LiteralPath $exe) { return $exe }
    }
    return $null
}

function Stop-Tidal {
    Get-Process -Name 'TIDAL', 'TIDALPlayer' -ErrorAction SilentlyContinue | Stop-Process -Force
}

if ($Close) {
    Stop-Tidal
    Write-Host 'TIDAL stopped'
    return
}

if ($Check) {
    Write-Step 'The TIDAL app'
    $running = @(Get-CimInstance Win32_Process -Filter "Name = 'TIDAL.exe'" -ErrorAction SilentlyContinue)
    if ($running.Count -eq 0) { Write-Bad 'TIDAL is not running: .\tidal.ps1' }
    elseif (Test-Port '127.0.0.1' $Port) { Write-Ok ('TIDAL answers on 127.0.0.1:' + $Port) }
    else { Write-Bad ('TIDAL runs without its port: .\tidal.ps1 restarts it') }
    if (@($running | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('-disable-auto-update') }).Count -eq 0 -and $running.Count -gt 0) {
        Write-Warn 'TIDAL can update itself: .\tidal.ps1 restarts it with updates off'
    }
    if (@(Get-Process -Name 'voicemeeter*' -ErrorAction SilentlyContinue).Count -eq 0) { Write-Bad 'VoiceMeeter is not running: its cable passes nothing' }
    else { Write-Ok 'VoiceMeeter runs' }
    Write-Note 'by hand: VoiceMeeter''s AUX strip on B2 only (every A button off) (README section 3.7)'
    return
}

$exe = Find-TidalExe
if ($null -eq $exe) { throw 'TIDAL is not installed for this user (no %LOCALAPPDATA%\TIDAL\app-*)' }

if ($InstallTask) {
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $PSCommandPath + '" -Port ' + $Port)
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User ($env:USERDOMAIN + '\' + $env:USERNAME)
    $trigger.Delay = 'PT30S'   # let VoiceMeeter and the network come up first
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
    Register-ScheduledTask -TaskName 'tidal' -TaskPath '\Loom\' -Action $action -Trigger $trigger -Settings $settings -Description 'Loom: the TIDAL app with its debug port' -Force | Out-Null
    Write-Host 'installed \Loom\tidal: TIDAL starts 30 s after every sign-in'
    return
}

Stop-Tidal
Start-Sleep -Seconds 2
$arguments = @(('--remote-debugging-port=' + $Port), '-disable-auto-update')
if (-not $Show) { $arguments += '-minimized' }
Start-Process -FilePath $exe -ArgumentList $arguments | Out-Null
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Port '127.0.0.1' $Port) {
        Write-Host ('TIDAL is up on 127.0.0.1:' + $Port + ' (' + (Split-Path -Leaf (Split-Path -Parent $exe)) + ')')
        return
    }
}
throw ('TIDAL started, but nothing answers on port ' + $Port)
