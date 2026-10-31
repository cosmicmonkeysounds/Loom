<#
.SYNOPSIS
    Steph's laptop: the server-room terminal. whisper.cpp, then Chrome on the
    CRT, always with the full set of keys and its own profile.

.DESCRIPTION
    First time (with a mouse: every grant is answered in this window):

        $env:LOOM_MOD_CODE = '<the mod passcode>'     # or -ModCode; never written to disk by this script
        powershell -ExecutionPolicy Bypass -File scripts\server-room\start-terminal.ps1 -Setup

    The page stores its setup in this Chrome profile, so from then on no code
    is needed:

        ...\start-terminal.ps1                  # whisper + the kiosk on the last display
        ...\start-terminal.ps1 -Display 1       # pick the display (1 = primary)
        ...\start-terminal.ps1 -InstallTask     # the same 20 s after every logon
        ...\start-terminal.ps1 -Close           # close this Chrome (only this profile's)

    Grants belong to a Chrome profile, so the everyday Chrome's don't count.
    The kiosk has no mouse to answer a prompt, so all four are made in -Setup:
    the camera, the microphone, the serial port and access to apps on this
    device. Chrome asks for that last one only once the page may reach
    whisper: on a server older than that release, run -Setup again after it.
    The page takes a link's keys only with a code (terminal/src/app.tsx), so
    the first -Setup needs the code.

.PARAMETER ModCode
    The mod passcode for the first provisioning (default: $env:LOOM_MOD_CODE).
    Only put in the URL Chrome opens; printed masked.
.PARAMETER Server
    The event server (default: $env:LOOM_SERVER, else https://app.mapsandducks.com).
.PARAMETER Display
    1-based display number; default: the last one (the CRT, when it is a
    second screen).
#>
[CmdletBinding()]
param(
    [string]$ModCode,
    [string]$Server,
    [int]$Display = 0,
    [switch]$Setup,
    [switch]$InstallTask,
    [switch]$Close,
    [string]$ProfileDir = (Join-Path $env:LOCALAPPDATA 'loom-terminal')
)

. "$PSScriptRoot\..\house-desktop\common.ps1"

if (-not $Server) { if ($env:LOOM_SERVER) { $Server = $env:LOOM_SERVER } else { $Server = $script:DefaultServer } }
$Server = $Server.TrimEnd('/')

# Keep in step with docs/trapped/kiosk.md and `kioskUrl` in scripts/show/lib/local.ts.
$keys = 'spot=server-room&door=serial&camera=user&webcam=C310&pad=1&whisper=1&crt=1'
# The terminal's WHISPER_URL, the origin the server's TERMINAL_CSP must let it fetch.
$whisperOrigin = 'http://127.0.0.1:8178'

function Stop-TerminalChrome {
    # @() round the whole pipeline: no match is an empty array (@($null) would count 1).
    $mine = @(Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine.Contains($ProfileDir) })
    foreach ($p in $mine) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    return $mine.Count
}

# Is whisper allowed by the live page? $null when the page can't be read.
function Test-PageReachesWhisper {
    try {
        $res = Invoke-WebRequest -UseBasicParsing -Uri ($Server + '/terminal/') -TimeoutSec 10
    } catch {
        return $null
    }
    $connect = @([string]$res.Headers['Content-Security-Policy'] -split ';' | Where-Object { $_.Trim() -like 'connect-src *' })
    if ($connect.Count -eq 0) { return $true }
    return ($connect[0].Trim() -split '\s+') -contains $whisperOrigin
}

if ($Close) {
    $n = Stop-TerminalChrome
    Write-Host ('closed ' + $n + ' terminal Chrome process(es); whisper keeps running (start-whisper.ps1 -Stop)')
    exit 0
}

if ($InstallTask) {
    $self = $MyInvocation.MyCommand.Path
    $arg = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $self + '"'
    if ($Display -gt 0) { $arg += ' -Display ' + $Display }
    if ($PSBoundParameters.ContainsKey('Server')) { $arg += ' -Server "' + $Server + '"' }
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User ($env:USERDOMAIN + '\' + $env:USERNAME)
    $trigger.Delay = 'PT20S'   # let the display and the network come up first
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
    Register-ScheduledTask -TaskName 'server-room-terminal' -TaskPath '\Loom\' -Action $action -Trigger $trigger -Settings $settings -Description 'Loom: whisper.cpp and the server-room terminal kiosk' -Force | Out-Null
    Write-Host 'installed \Loom\server-room-terminal: whisper and the kiosk start 20 s after every logon (no passcode stored: the Chrome profile holds the setup)'
    exit 0
}

$chrome = Find-Chrome
if (-not $chrome) {
    Write-Host 'Chrome is not installed: winget install Google.Chrome' -ForegroundColor Red
    exit 2
}

$code = Get-ModCode $ModCode
if ($Setup -and -not $code -and -not (Test-Path -LiteralPath $ProfileDir)) {
    Write-Host 'The first -Setup needs the mod passcode (-ModCode or $env:LOOM_MOD_CODE): without it the page drops the link''s keys, and spoken answers stay off.' -ForegroundColor Red
    exit 2
}
if ($code) {
    $url = $Server + '/terminal/?code=' + [uri]::EscapeDataString($code) + '&' + $keys
    $shown = $Server + '/terminal/?code=' + (Hide-Secret $code) + '&' + $keys
} else {
    $url = $Server + '/terminal/'
    $shown = $url
}

# Spoken answers wait on whisper; the choices work without it, so a failure
# here never stops the terminal.
try {
    & "$PSScriptRoot\start-whisper.ps1"
} catch {
    Write-Warn ('whisper: ' + $_.Exception.Message + ' (install-whisper.ps1; the choices still work)')
}

$reaches = Test-PageReachesWhisper
if ($null -eq $reaches) {
    Write-Warn ("couldn't read " + $Server + '/terminal/ to check it may reach whisper')
} elseif (-not $reaches) {
    Write-Warn ('the live page refuses whisper (connect-src): it needs the release from the MacBook.')
    Write-Note 'Spoken answers will say YOUR VOICE ISN''T REACHING HIM, and Chrome can''t ask for device access until then.'
}

# The kiosk's display: the CRT is the last screen. Setup stays where the mouse is.
$flags = @(
    '--user-data-dir="' + $ProfileDir + '"',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
    '--disable-features=Translate',
    '--autoplay-policy=no-user-gesture-required'
)
if (-not $Setup) {
    Add-Type -AssemblyName System.Windows.Forms
    $screens = @([System.Windows.Forms.Screen]::AllScreens)
    $index = $screens.Count - 1
    if ($Display -gt 0) {
        if ($Display -gt $screens.Count) { Write-Host ('there are ' + $screens.Count + ' display(s); -Display ' + $Display + ' does not exist') -ForegroundColor Red; exit 2 }
        $index = $Display - 1
    }
    $b = $screens[$index].Bounds
    Write-Host ('display ' + ($index + 1) + ' of ' + $screens.Count + ': ' + $b.Width + 'x' + $b.Height + ' at ' + $b.X + ',' + $b.Y + '  (' + $screens[$index].DeviceName + ')')
    $flags += ('--window-position=' + $b.X + ',' + $b.Y)
    $flags += '--kiosk'
}

$killed = Stop-TerminalChrome
if ($killed -gt 0) { Start-Sleep -Seconds 2 }

# Start-Process joins -ArgumentList with spaces and quotes nothing, so the
# command line is built here (the profile path is quoted above, the URL here).
$cmdline = ($flags -join ' ') + ' "' + $url + '"'
Start-Process -FilePath $chrome -ArgumentList $cmdline
if ($Setup) {
    Write-Host ('setup window opened: ' + $shown)
    Write-Note 'In that window:'
    Write-Note '1. Allow the camera, the microphone and access to apps on this device.'
    Write-Note '2. Hold the gear 2 s -> advanced -> door sensor -> Connect door sensor -> the Grand Central.'
    Write-Note '3. Check its no-mouse section reads: controller adapter found, whisper is listening.'
    Write-Note '4. Save, close the window, and run this script again with no switches.'
} else {
    Write-Host ('terminal kiosk opened: ' + $shown + '  (Alt+F4 closes it; start-terminal.ps1 -Close)')
}
exit 0
