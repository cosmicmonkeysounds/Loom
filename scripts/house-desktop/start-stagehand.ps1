<#
.SYNOPSIS
    stagehand on the house PC: sync, render the SFX library, check, install
    the Task Scheduler jobs (show + lights + the audio router; -NoAudio
    leaves the router to the MacBook), show their state.

.DESCRIPTION
    Every job is `uv run stagehand tasks ...` underneath (stagehand's
    tasks.py): one task per module, \Loom\stagehand-<job>, started at this
    user's logon, no console window, logs in
    %LOCALAPPDATA%\stagehand\logs\<job>.log.

        .\start-stagehand.ps1                      # uv sync, the SFX library, check, install + start show, lights and audio
        .\start-stagehand.ps1 -NoAudio             # show and lights only: the router runs on the MacBook (the fallback)
        .\start-stagehand.ps1 -Check               # stagehand check only
        .\start-stagehand.ps1 -Status              # every task + the last log lines
        .\start-stagehand.ps1 -Restart lights      # one job
        .\start-stagehand.ps1 -Stop audio          # one job, disabled until -Restart
        .\start-stagehand.ps1 -Foreground show     # run one job in this window (Ctrl+C stops), to watch it
        .\start-stagehand.ps1 -Uninstall           # remove every job

    The real event id + mod passcode go in stagehand\trapped.house.local.yaml
    (git-ignored, shared by every machine file) - `check` flags a CHANGE-ME.
    The speaker router (audio, the MOTU 828x over ASIO) runs on this PC by
    default (2026-10-27). Never run it here AND on the MacBook: two routers
    would speak every announcement twice. -WithAudio is the default now and
    changes nothing (older notes name it).

    Before the check (not with -NoAudio or -Check) it renders the SFX
    library and the story's stand-ins into stagehand\media
    (`stagehand sounds library --story`: a file with the same bytes is not
    rewritten, and a real sound file is never replaced) and makes the empty
    soundtrack folders media\music\<act>\ for the MP3s (README section 3.4).

.PARAMETER Config
    The machine YAML (default trapped.desktop.yaml in stagehand\).
#>
[CmdletBinding()]
param(
    [string]$Config = 'trapped.desktop.yaml',
    [switch]$NoAudio,
    [switch]$WithAudio,
    [switch]$Check,
    [switch]$Status,
    [ValidateSet('show', 'lights', 'audio')][string]$Restart,
    [ValidateSet('show', 'lights', 'audio')][string]$Stop,
    [ValidateSet('show', 'lights', 'audio')][string]$Foreground,
    [switch]$Uninstall,
    [int]$Lines = 15
)

. "$PSScriptRoot\common.ps1"

$jobs = @('show', 'lights')
if (-not $NoAudio) { $jobs += 'audio' }
$only = $jobs -join ','

function Show-Status {
    Write-Step 'stagehand tasks'
    $null = Invoke-Stagehand @('tasks', 'status')
    $logDir = Join-Path $env:LOCALAPPDATA 'stagehand\logs'
    foreach ($job in @('show', 'lights', 'audio')) {
        $log = Join-Path $logDir ($job + '.log')
        if (Test-Path -LiteralPath $log) {
            Write-Host ''
            Write-Host ('-- ' + $log) -ForegroundColor Cyan
            Get-Content -LiteralPath $log -Tail $Lines -Encoding UTF8
        }
    }
}

if ($Status) { Show-Status; exit 0 }
if ($Restart) { exit (Invoke-Stagehand @('tasks', 'restart', '--job', $Restart)) }
if ($Stop) { exit (Invoke-Stagehand @('tasks', 'stop', '--job', $Stop)) }
if ($Uninstall) {
    $rc = 0
    foreach ($job in @('show', 'lights', 'audio')) { $r = Invoke-Stagehand @('tasks', 'uninstall', '--job', $job); if ($r -ne 0) { $rc = $r } }
    exit $rc
}
if ($Foreground) {
    Write-Host ('running ' + $Foreground + ' here (Ctrl+C stops it). Its task, if installed, must be stopped first: .\start-stagehand.ps1 -Stop ' + $Foreground) -ForegroundColor Yellow
    if ($Foreground -eq 'audio') { $env:SD_ENABLE_ASIO = '1' }
    exit (Invoke-Stagehand @('run', '--config', $Config, '--only', $Foreground))
}

$uv = Find-Uv
if (-not $uv) {
    Write-Host 'uv is not installed: powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex" (then open a new PowerShell)' -ForegroundColor Red
    exit 2
}

if (-not $Check) {
    Write-Step 'uv sync'
    Push-Location $script:StagehandDir
    try { & $uv sync | Out-Host; $rc = $LASTEXITCODE } finally { Pop-Location }
    if ($rc -ne 0) { Write-Host 'uv sync failed' -ForegroundColor Red; exit $rc }
}

if (-not $NoAudio -and -not $Check) {
    # The soundtrack's folders (stagehand\media\soundtrack.yaml's playlists;
    # git-ignored): made empty here so the MP3s have somewhere to go.
    $musicDir = Join-Path $script:StagehandDir 'media\music'
    foreach ($act in $script:MusicFolders) {
        $d = Join-Path $musicDir $act
        if (-not (Test-Path -LiteralPath $d)) { $null = New-Item -ItemType Directory -Path $d -Force }
    }
    Write-Step 'stagehand sounds library --story (the SFX library + the story stand-ins)'
    $rc = Invoke-Stagehand @('sounds', 'library', '--story', '--config', $Config)
    # A failed render never blocks the jobs: the router plays what is there
    # (a placeholder, or silence for a missing library loop).
    if ($rc -ne 0) { Write-Host ('sounds library failed (exit ' + $rc + '): the jobs still install; run it again by hand (README section 3.4)') -ForegroundColor Yellow }
}

Write-Step ('stagehand check --only ' + $only)
if (-not $NoAudio) { $env:SD_ENABLE_ASIO = '1' }
$rc = Invoke-Stagehand @('check', '--config', $Config, '--only', $only)
if ($rc -ne 0) {
    Write-Host ('check failed (exit ' + $rc + '): fix the config before installing the jobs') -ForegroundColor Red
    exit $rc
}
if ($Check) { exit 0 }

foreach ($job in $jobs) {
    Write-Step ('install ' + $job)
    $rc = Invoke-Stagehand @('tasks', 'install', '--job', $job, '--config', $Config)
    if ($rc -ne 0) { Write-Host ('installing ' + $job + ' failed') -ForegroundColor Red; exit $rc }
}
Start-Sleep -Seconds 5
Show-Status
exit 0
