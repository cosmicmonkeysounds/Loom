<#
.SYNOPSIS
    The house lights in one command: are they well, hand them to the
    Zigbee2MQTT dashboard, take them back, or reset the whole chain.

.DESCRIPTION
    From this folder, in any PowerShell:

        .\lights-reset.ps1            # is the chain well? (changes nothing)
        .\lights-reset.ps1 -Hold      # stop the lights job: the dashboard's changes stick
        .\lights-reset.ps1 -Release   # the job again: it plays the story's look
        .\lights-reset.ps1 -Reset     # restart Zigbee2MQTT, then the job, then check

    Why -Hold: a looping look (the screensaver, every 5 s) overwrites whatever
    the dashboard set. Nothing plays and no cue reaches a bulb while held, so
    always -Release after; the status below says HELD in red until you do.

    -Reset is safe with a show running: bulbs keep what they show while
    Zigbee2MQTT restarts (about 15 s) and the job plays the story's look when
    it is back. It reloads no event and touches no phone. With -Broker (an
    elevated PowerShell) it restarts Mosquitto first.

.PARAMETER Hold
    Stop the lights job until -Release.
.PARAMETER Release
    Start the lights job again.
.PARAMETER Reset
    Restart Zigbee2MQTT and the lights job, then check.
.PARAMETER Broker
    With -Reset: restart Mosquitto too (needs an elevated PowerShell).
#>
[CmdletBinding()]
param(
    [switch]$Hold,
    [switch]$Release,
    [switch]$Reset,
    [switch]$Broker
)

. "$PSScriptRoot\common.ps1"

$Z2mTask = 'Loom\zigbee2mqtt'

function Wait-Z2m([int]$Seconds) {
    $until = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $until) {
        $ms = Test-Z2mHealth 3
        if ($ms -ge 0) { return $ms }
        Start-Sleep -Seconds 2
    }
    return -1
}

function Show-Chain {
    Write-Step 'the lights chain'
    if (Test-Port '127.0.0.1' 1883) { Write-Ok 'Mosquitto answers on :1883' } else { Write-Bad 'Mosquitto does not answer on :1883 (elevated: .\lights-reset.ps1 -Reset -Broker)' }
    $ms = Test-Z2mHealth 5
    if ($ms -ge 0) { Write-Ok ('Zigbee2MQTT answers its health check (' + $ms + ' ms)') }
    elseif ($ms -eq -2) { Write-Warn 'no mosquitto_rr: cannot ask Zigbee2MQTT' }
    else { Write-Bad 'Zigbee2MQTT does not answer its health check: .\lights-reset.ps1 -Reset' }
    $job = Get-ScheduledTask -TaskPath '\Loom\' -TaskName 'stagehand-lights' -ErrorAction SilentlyContinue
    if (-not $job) { Write-Bad 'no \Loom\stagehand-lights task: .\start-stagehand.ps1' }
    elseif ($job.State -eq 'Disabled') { Write-Bad 'HELD: the lights job is stopped, no look or cue reaches a bulb: .\lights-reset.ps1 -Release' }
    elseif ($job.State -eq 'Running') { Write-Ok 'the lights job is running' }
    else { Write-Warn ('the lights job is ' + $job.State + ': its keep-alive starts it within a minute') }
    $stats = Get-LightsStats
    if ($null -eq $stats) { Write-Warn 'no health/lights/stats yet' }
    else {
        Write-Note ('look ' + $stats.last_look + ', ' + $stats.devices + ' Zigbee devices, Z2M ' + $stats.z2m + ', restarted by the job ' + $stats.z2m_restarts + ' time(s)')
        if (@($stats.dark).Count -gt 0) { Write-Warn ('not answering Zigbee: ' + (@($stats.dark) -join ', ') + ' (power? a wall switch?)') }
        else { Write-Ok 'every paced bulb answers' }
    }
}

if ($Hold) {
    $rc = Invoke-Stagehand @('tasks', 'stop', '--job', 'lights')
    Write-Host 'HELD: the dashboard is yours (http://localhost:8080). No look or cue reaches a bulb until .\lights-reset.ps1 -Release' -ForegroundColor Yellow
    exit $rc
}

if ($Release) {
    $rc = Invoke-Stagehand @('tasks', 'restart', '--job', 'lights')
    Start-Sleep -Seconds 8
    Show-Chain
    if ($rc -ne 0) { exit $rc }
    if ($script:Failures -gt 0) { exit 1 }
    exit 0
}

if ($Reset) {
    if ($Broker) {
        Assert-Admin 'restarting the Mosquitto service'
        Write-Step 'Mosquitto'
        Restart-Service mosquitto
        Start-Sleep -Seconds 3
    }
    Write-Step 'Zigbee2MQTT'
    schtasks /End /TN $Z2mTask | Out-Null
    Start-Sleep -Seconds 2
    schtasks /Run /TN $Z2mTask | Out-Null
    $ms = Wait-Z2m 60
    if ($ms -ge 0) { Write-Ok ('back, answering in ' + $ms + ' ms') } else { Write-Bad 'not back after 60 s: see C:\zigbee2mqtt\data\log, and is the stick on its COM port? (.\zigbee2mqtt.ps1 -Check)' }
    Write-Step 'the lights job'
    $null = Invoke-Stagehand @('tasks', 'restart', '--job', 'lights')
    Start-Sleep -Seconds 8
}

Show-Chain
if ($script:Failures -gt 0) { exit 1 }
exit 0
