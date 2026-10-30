<#
.SYNOPSIS
    Zigbee2MQTT on the house PC: find the CC2652P's COM port, write the
    first config, run it at boot, check it.

.DESCRIPTION
    Install once (Node 20 / 22 LTS and Git for Windows first:
    winget install OpenJS.NodeJS.LTS Git.Git):

        git clone --depth 1 https://github.com/Koenkk/zigbee2mqtt.git C:\zigbee2mqtt
        cd C:\zigbee2mqtt; corepack enable; pnpm install --frozen-lockfile; pnpm run build

    Then, from this folder:

        .\zigbee2mqtt.ps1 -Ports                    # which COMn the CP2102N is
        .\zigbee2mqtt.ps1 -WriteConfig -Port COM5   # first install only (never over a data\ that exists)
        .\zigbee2mqtt.ps1 -Start                    # once by hand: wait for "Zigbee2MQTT started!", Ctrl+C
        .\zigbee2mqtt.ps1 -InstallTask              # elevated: runs at boot, before anyone signs in
        .\zigbee2mqtt.ps1 -Check                    # the port, the task, bridge/state online, :8080
        .\zigbee2mqtt.ps1 -Restart                  # end and start the task, as the lights job does when Z2M stalls

    The task runs `node index.js` in the Zigbee2MQTT folder as this user
    ("whether signed in or not", no window), starts at boot and is kept
    alive by a one-minute repeating trigger. It runs the real node.exe, never
    nvm's shim: ending the task ends only the process it started, so behind a
    shim the real Z2M would live on, holding the COM port, in a session this
    user's normal windows cannot kill. Z2M logs to
    <dir>\data\log\. The scripts\house-macbook\zigbee.md runbook's steps 5-9
    (the lights job before pairing, pairing server_room_rgb,
    power_on_behavior: on, the map, the backup of data\) apply unchanged;
    only the port and the service differ on Windows.

.PARAMETER Dir
    The Zigbee2MQTT checkout (default C:\zigbee2mqtt).
.PARAMETER Port
    -WriteConfig: the COM port (e.g. COM5).
#>
[CmdletBinding()]
param(
    [switch]$Ports,
    [switch]$WriteConfig,
    [string]$Port,
    [switch]$Start,
    [switch]$InstallTask,
    [switch]$RemoveTask,
    [switch]$Check,
    [switch]$Restart,
    [string]$Dir = 'C:\zigbee2mqtt'
)

. "$PSScriptRoot\common.ps1"

$TaskName = 'zigbee2mqtt'
$TaskPath = '\Loom\'
$ConfigFile = Join-Path $Dir 'data\configuration.yaml'

function Show-Ports {
    $found = @(Get-SerialPorts)
    if ($found.Count -eq 0) {
        Write-Host 'no COM port at all: plug the stick in (a USB 2.0 extension cable, away from USB 3 and the Wi-Fi router); if Device Manager shows it under "Other devices", install the Silicon Labs CP210x VCP driver'
        return
    }
    foreach ($p in $found) {
        $tag = ''
        if ($p.Name -match 'CP210|Silicon Labs') { $tag = '   <- the CC2652P stick (CP2102N)' }
        Write-Host ('{0,-6} {1}{2}' -f $p.Port, $p.Name, $tag)
    }
}

function Get-ConfiguredPort {
    if (-not (Test-Path -LiteralPath $ConfigFile)) { return $null }
    $m = Select-String -LiteralPath $ConfigFile -Pattern '^\s*port:\s*[''"]?(COM\d+|\\\\\.\\COM\d+)' | Select-Object -First 1
    if ($m) { return ($m.Matches[0].Groups[1].Value -replace '^\\\\\.\\', '') }
    return $null
}

function Test-Z2m {
    Write-Step 'Zigbee2MQTT'
    if (-not (Test-Path -LiteralPath (Join-Path $Dir 'index.js'))) { Write-Bad ('no Zigbee2MQTT in ' + $Dir + ' (see the install lines in this script''s help)'); return }
    $cfgPort = Get-ConfiguredPort
    if (-not $cfgPort) {
        Write-Bad ($ConfigFile + ' names no COMn serial.port (.\zigbee2mqtt.ps1 -WriteConfig -Port COMn on a first install)')
    } else {
        $present = @(Get-SerialPorts | Where-Object { $_.Port -eq $cfgPort })
        if ($present.Count -gt 0) { Write-Ok ('serial.port ' + $cfgPort + ' is present (' + $present[0].Name + ')') } else { Write-Bad ('serial.port ' + $cfgPort + ' is not plugged in now: .\zigbee2mqtt.ps1 -Ports (a stick moved to another port gets another COMn)') }
    }
    if ((Test-Path -LiteralPath $ConfigFile) -and (Select-String -LiteralPath $ConfigFile -Pattern 'GENERATE' -Quiet)) {
        Write-Warn 'configuration.yaml still says GENERATE: Z2M has never started with it (the network keys are made on the first start; back up data\ after)'
    }
    $state = Get-Retained 'zigbee2mqtt/bridge/state' 3
    $online = ($null -ne $state) -and (($state -join ' ') -match 'online')
    $task = Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue
    if ($task) {
        if ($task.State -eq 'Running') { Write-Ok 'task \Loom\zigbee2mqtt running' }
        elseif ($online) { Write-Bad ('task \Loom\zigbee2mqtt is ' + $task.State + ' but Zigbee2MQTT is online: another copy (a -Start window?) holds the COM port. Stop it (Ctrl+C) and the task takes over within a minute') }
        else { Write-Bad ('task \Loom\zigbee2mqtt is ' + $task.State + ': Start-ScheduledTask -TaskPath \Loom\ -TaskName zigbee2mqtt, then see ' + (Join-Path $Dir 'data\log')) }
        if ($task.Actions[0].Execute -match '\\nvm\\\.nodejs\\') { Write-Bad 'the task runs nvm''s node shim: the lights job cannot restart a stalled Z2M (elevated: .\zigbee2mqtt.ps1 -InstallTask)' }
    } else {
        Write-Warn 'no \Loom\zigbee2mqtt task: it will not start at boot (.\zigbee2mqtt.ps1 -InstallTask, elevated)'
    }
    if ($null -eq $state) {
        Write-Warn 'mosquitto_sub not found: cannot read zigbee2mqtt/bridge/state'
    } elseif ($online) {
        Write-Ok 'zigbee2mqtt/bridge/state online'
    } else {
        Write-Bad ('zigbee2mqtt/bridge/state is not online (' + (($state -join ' ').Trim()) + '): see ' + (Join-Path $Dir 'data\log'))
    }
    if (Test-Port '127.0.0.1' 8080) { Write-Ok 'frontend http://127.0.0.1:8080 answers' } else { Write-Warn 'frontend :8080 does not answer' }
}

if ($Ports) { Show-Ports; exit 0 }

if ($WriteConfig) {
    if (-not $Port -or $Port -notmatch '^COM\d+$') { Write-Host '-WriteConfig needs -Port COMn (.\zigbee2mqtt.ps1 -Ports lists them)' -ForegroundColor Red; exit 2 }
    if (Test-Path -LiteralPath $ConfigFile) {
        Write-Host ($ConfigFile + ' exists: it holds the network keys, so it is never overwritten. Edit serial.port in it by hand if the COM port changed.') -ForegroundColor Yellow
        exit 1
    }
    New-Item -ItemType Directory -Force -Path (Split-Path $ConfigFile) | Out-Null
    $text = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'zigbee2mqtt-configuration.example.yaml') -Raw).Replace('@COM_PORT@', $Port)
    Write-Utf8NoBom $ConfigFile $text
    Write-Host ('wrote ' + $ConfigFile + ' (serial.port ' + $Port + '). Now .\zigbee2mqtt.ps1 -Start once, then back up data\ (never commit it).')
    exit 0
}

if ($Start) {
    $node = Find-Exe 'node' @((Join-Path $env:ProgramFiles 'nodejs\node.exe'))
    if (-not $node) { Write-Host 'node is not installed: winget install OpenJS.NodeJS.LTS' -ForegroundColor Red; exit 2 }
    $task = Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue
    if ($task -and $task.State -eq 'Running') { Write-Host 'the \Loom\zigbee2mqtt task is running: two copies would fight over the COM port. Stop-ScheduledTask -TaskPath \Loom\ -TaskName zigbee2mqtt first.' -ForegroundColor Red; exit 1 }
    Push-Location $Dir
    try { & $node index.js } finally { Pop-Location }
    exit $LASTEXITCODE
}

if ($InstallTask) {
    Assert-Admin 'a task that runs at boot, whether anyone is signed in or not'
    $node = Find-Exe 'node' @((Join-Path $env:ProgramFiles 'nodejs\node.exe'))
    if (-not $node) { Write-Host 'node is not installed: winget install OpenJS.NodeJS.LTS' -ForegroundColor Red; exit 2 }
    if (-not (Test-Path -LiteralPath $ConfigFile)) { Write-Host ('no ' + $ConfigFile + ' yet: -WriteConfig (or copy the old data\) and -Start once first') -ForegroundColor Red; exit 2 }
    # nvm's shim only starts the real node: the task must hold the real one.
    Push-Location $Dir
    try { $real = (& $node -p 'process.execPath').Trim() } finally { Pop-Location }
    if (-not (Test-Path -LiteralPath $real)) { Write-Host ('node did not name its own path (' + $real + ')') -ForegroundColor Red; exit 2 }
    Stop-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
    # A copy the old task's shim left behind, or a -Start window: it holds the COM port.
    $copy = Get-NetTCPConnection -State Listen -LocalPort 8080 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($copy) {
        Write-Host ('stopping the Zigbee2MQTT already on :8080 (pid ' + $copy.OwningProcess + ')')
        Stop-Process -Id $copy.OwningProcess -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
    $action = New-ScheduledTaskAction -Execute $real -Argument 'index.js' -WorkingDirectory $Dir
    $triggers = @()
    $triggers += New-ScheduledTaskTrigger -AtStartup
    # The keep-alive: ignored while it runs (IgnoreNew), it restarts Z2M within
    # a minute of dying. An explicit duration: older Windows 10 builds refuse
    # an open-ended one.
    $triggers += New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
    $principal = New-ScheduledTaskPrincipal -UserId ($env:USERDOMAIN + '\' + $env:USERNAME) -LogonType S4U -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Description 'Zigbee2MQTT (Loom house rig): the CC2652P coordinator' -Force | Out-Null
    Start-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName
    Write-Host 'installed and started \Loom\zigbee2mqtt (at boot, no window; logs in data\log)'
    Start-Sleep -Seconds 8
    Test-Z2m
    if ($script:Failures -gt 0) { exit 1 }
    exit 0
}

if ($RemoveTask) {
    Assert-Admin 'removing a scheduled task'
    Stop-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host 'removed \Loom\zigbee2mqtt'
    exit 0
}

if ($Restart) {
    Stop-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Start-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName
    Write-Host 'restarted \Loom\zigbee2mqtt'
    Start-Sleep -Seconds 15
    Test-Z2m
    if ($script:Failures -gt 0) { exit 1 }
    exit 0
}

if ($Check) {
    Test-Z2m
    if ($script:Failures -gt 0) { exit 1 }
    exit 0
}

Get-Help $MyInvocation.MyCommand.Path
