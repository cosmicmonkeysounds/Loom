<#
.SYNOPSIS
    The lights fire drill: really breaks each link of the chain and checks
    that it comes back by itself. Every drill prints PASS or FAIL.

.DESCRIPTION
    Never during a show: the house lights jump. From this folder:

        .\lights-drill.ps1                  # flood + job + z2m (any PowerShell)
        .\lights-drill.ps1 -Elevated        # also stall + broker (an elevated PowerShell)
        .\lights-drill.ps1 -Bulb living_2   # a bulb loses power (you flip it)
        .\lights-drill.ps1 -Stick           # the Zigbee stick is pulled (you pull it)

    The drills:

        flood   the fastest look (lights_rave) on every bulb for 45 s: Z2M must
                keep answering, nothing may fail, nothing may pile up
        job     the lights job is killed: its keep-alive brings it back
        z2m     Zigbee2MQTT is killed: its keep-alive brings it back and the
                job plays the story's look again
        stall   Zigbee2MQTT is frozen, alive but silent (last night's failure):
                the job must notice and restart it, unaided
        broker  Mosquitto restarts: Z2M and the job reconnect
        bulb    a bulb loses power: it goes dark, the rest carry on, and it
                takes the look back when it returns
        stick   the coordinator is pulled and put back

    The end always puts the job back on the story's look, pass or fail.

.PARAMETER Elevated
    Add the stall and broker drills (needs an elevated PowerShell).
.PARAMETER Bulb
    The Zigbee name of a bulb you can power off by hand (living_2).
.PARAMETER Stick
    Add the stick drill.
.PARAMETER Only
    Run only these automatic drills: flood, job, z2m, stall, broker.
.PARAMETER Config
    The machine YAML (default trapped.desktop.yaml in stagehand\).
#>
[CmdletBinding()]
param(
    [switch]$Elevated,
    [string]$Bulb,
    [switch]$Stick,
    [ValidateSet('flood', 'job', 'z2m', 'stall', 'broker')][string[]]$Only,
    [string]$Config = 'trapped.desktop.yaml'
)

. "$PSScriptRoot\common.ps1"

$Z2mTask = 'Loom\zigbee2mqtt'
$JobTask = 'Loom\stagehand-lights'
$LightsLog = Join-Path $env:LOCALAPPDATA 'stagehand\logs\lights.log'
$script:Results = @()

function Add-Result([string]$Name, [bool]$Passed, [string]$Detail) {
    $word = 'FAIL'
    if ($Passed) { $word = 'PASS' }
    $script:Results += ('{0,-7} {1}  {2}' -f $Name, $word, $Detail)
    if ($Passed) { Write-Ok ($Name + ': ' + $Detail) } else { Write-Bad ($Name + ': ' + $Detail) }
}

function Wait-For([scriptblock]$Test, [int]$Seconds) {
    $clock = [Diagnostics.Stopwatch]::StartNew()
    while ($clock.Elapsed.TotalSeconds -lt $Seconds) {
        if (& $Test) { return [int]$clock.Elapsed.TotalSeconds }
        Start-Sleep -Seconds 2
    }
    return -1
}

function Get-LogLines {
    if (-not (Test-Path -LiteralPath $LightsLog)) { return @() }
    return @(Get-Content -LiteralPath $LightsLog -Encoding UTF8)
}

function Test-LogSince([int]$From, [string]$Pattern) {
    return [bool](@(Get-LogLines | Select-Object -Skip $From) -match $Pattern)
}

function Get-Z2mLog {
    $dir = Get-ChildItem 'C:\zigbee2mqtt\data\log' -Directory | Sort-Object Name -Descending | Select-Object -First 1
    return (Join-Path $dir.FullName 'log.log')
}

function Get-Z2mFailures {
    return @(Select-String -LiteralPath (Get-Z2mLog) -Pattern "Publish '.*failed" -ErrorAction SilentlyContinue).Count
}

function Test-JobOnline {
    $lines = Get-Retained 'health/lights' 2
    return ($null -ne $lines) -and (($lines -join ' ') -match 'online')
}

function Restore-Look {
    # The catch-up on the job's start is the story's own answer.
    $null = Invoke-Stagehand @('tasks', 'restart', '--job', 'lights')
    $null = Wait-For { Test-JobOnline } 30
}

function Drill-Flood {
    Write-Step 'flood: the fastest look on every bulb for 45 s'
    $before = Get-Z2mFailures
    $null = Invoke-Stagehand @('lights', 'test', 'lights_rave', '--config', $Config)
    $worst = 0; $silent = 0; $piled = 0
    $clock = [Diagnostics.Stopwatch]::StartNew()
    while ($clock.Elapsed.TotalSeconds -lt 45) {
        $ms = Test-Z2mHealth 5
        if ($ms -lt 0) { $silent++ } elseif ($ms -gt $worst) { $worst = $ms }
        $stats = Get-LightsStats
        if ($stats -and ($stats.waiting -gt $piled)) { $piled = [int]$stats.waiting }
        Start-Sleep -Seconds 3
    }
    $stats = Get-LightsStats
    $fails = (Get-Z2mFailures) - $before
    $held = 0
    if ($stats) { $held = $stats.superseded }
    Add-Result 'flood' (($silent -eq 0) -and ($fails -eq 0)) ('Z2M silent ' + $silent + ' time(s), slowest answer ' + $worst + ' ms, ' + $fails + ' failed commands, ' + $held + ' stale states never sent, at most ' + $piled + ' bulbs waiting')
    Restore-Look
}

function Drill-Job {
    Write-Step 'job: kill the lights job'
    schtasks /End /TN $JobTask | Out-Null
    $down = Wait-For { -not (Test-JobOnline) } 15
    $back = Wait-For { Test-JobOnline } 100
    Add-Result 'job' (($down -ge 0) -and ($back -ge 0)) ('came back after ' + $back + ' s (the keep-alive: within a minute)')
}

function Drill-Z2m {
    Write-Step 'z2m: kill Zigbee2MQTT'
    $from = (Get-LogLines).Count
    schtasks /End /TN $Z2mTask | Out-Null
    $down = Wait-For { (Test-Z2mHealth 2) -lt 0 } 15
    $back = Wait-For { (Test-Z2mHealth 3) -ge 0 } 100
    $look = Wait-For { Test-LogSince $from 'catch-up z2m' } 30
    Add-Result 'z2m' (($down -ge 0) -and ($back -ge 0) -and ($look -ge 0)) ('answering again after ' + $back + ' s, the look replayed: ' + ($look -ge 0))
}

function Set-ProcessFrozen([int]$ProcessId, [bool]$Frozen) {
    if (-not ('LoomDrill.Nt' -as [type])) {
        Add-Type -Namespace LoomDrill -Name Nt -MemberDefinition @'
[DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h);
[DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);
'@
    }
    $p = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $p) { return $false }
    if ($Frozen) { return ([LoomDrill.Nt]::NtSuspendProcess($p.Handle) -eq 0) }
    return ([LoomDrill.Nt]::NtResumeProcess($p.Handle) -eq 0)
}

function Drill-Stall {
    Write-Step 'stall: freeze Zigbee2MQTT (alive, port open, silent)'
    $owner = (Get-NetTCPConnection -State Listen -LocalPort 8080 -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
    if (-not $owner) { Add-Result 'stall' $false 'no Zigbee2MQTT on :8080'; return }
    $from = (Get-LogLines).Count
    $stats = Get-LightsStats
    $restarts = 0
    if ($stats) { $restarts = [int]$stats.z2m_restarts }
    if (-not (Set-ProcessFrozen $owner $true)) { Add-Result 'stall' $false 'could not freeze it'; return }
    try {
        $seen = Wait-For { Test-LogSince $from 'has not answered' } 110
        $back = Wait-For { (Test-Z2mHealth 3) -ge 0 } 60
        $look = Wait-For { Test-LogSince $from 'catch-up z2m' } 30
        $stats = Get-LightsStats
        $count = -1
        if ($stats) { $count = [int]$stats.z2m_restarts }
        Add-Result 'stall' (($seen -ge 0) -and ($back -ge 0) -and ($look -ge 0)) ('noticed after ' + $seen + ' s, answering ' + $back + ' s later, the look replayed: ' + ($look -ge 0) + ', restarts ' + $restarts + ' -> ' + $count)
    } finally {
        if (Get-Process -Id $owner -ErrorAction SilentlyContinue) { $null = Set-ProcessFrozen $owner $false }
    }
}

function Drill-Broker {
    Write-Step 'broker: restart Mosquitto'
    Restart-Service mosquitto
    $z2m = Wait-For { (Test-Z2mHealth 3) -ge 0 } 60
    $job = Wait-For { Test-JobOnline } 30
    Add-Result 'broker' (($z2m -ge 0) -and ($job -ge 0)) ('Z2M answering after ' + $z2m + ' s, the job online after ' + $job + ' s more')
}

function Drill-Bulb([string]$Name) {
    Write-Step ('bulb: ' + $Name + ' loses power')
    $null = Read-Host ('Cut the power to ' + $Name + ' (wall switch or unscrew it), then press Enter')
    $dark = Wait-For { $s = Get-LightsStats; $s -and (@($s.dark) -contains $Name) } 90
    $alive = Test-Z2mHealth 5
    $null = Read-Host ('Now give ' + $Name + ' its power back, then press Enter')
    $back = Wait-For { $s = Get-LightsStats; $s -and -not (@($s.dark) -contains $Name) } 120
    Add-Result 'bulb' (($dark -ge 0) -and ($alive -ge 0) -and ($back -ge 0)) ('dark after ' + $dark + ' s, Z2M answering meanwhile in ' + $alive + ' ms, back ' + $back + ' s after power')
}

function Drill-Stick {
    Write-Step 'stick: the coordinator is pulled'
    $null = Read-Host 'Pull the Zigbee stick out of its USB port, then press Enter'
    Start-Sleep -Seconds 10
    $null = Read-Host 'Put the stick back in the same port, then press Enter'
    $back = Wait-For { (Test-Z2mHealth 3) -ge 0 } 150
    Add-Result 'stick' ($back -ge 0) ('answering ' + $back + ' s after it went back')
}

if ($Elevated) { Assert-Admin 'freezing Zigbee2MQTT and restarting the Mosquitto service' }
$drills = @('flood', 'job', 'z2m')
if ($Elevated) { $drills += @('stall', 'broker') }
if ($Only) { $drills = $Only }
if ($Bulb -or $Stick) { if (-not $Only -and -not $Elevated) { $drills = @() } }

Write-Step 'before: the chain must be well'
$ms = Test-Z2mHealth 5
if ($ms -lt 0) { Write-Host 'Zigbee2MQTT does not answer: .\lights-reset.ps1 -Reset first' -ForegroundColor Red; exit 2 }
if (-not (Test-JobOnline)) { Write-Host 'the lights job is not online: .\lights-reset.ps1 -Release first' -ForegroundColor Red; exit 2 }
Write-Ok ('Zigbee2MQTT answers in ' + $ms + ' ms and the lights job is online')

try {
    foreach ($d in $drills) {
        switch ($d) {
            'flood' { Drill-Flood }
            'job' { Drill-Job }
            'z2m' { Drill-Z2m }
            'stall' { Drill-Stall }
            'broker' { Drill-Broker }
        }
    }
    if ($Bulb) { Drill-Bulb $Bulb }
    if ($Stick) { Drill-Stick }
} finally {
    Write-Step 'after: the story''s look'
    Restore-Look
}

Write-Step 'the drill'
$script:Results | ForEach-Object { Write-Host $_ }
if ($script:Failures -gt 0) { exit 1 }
exit 0
