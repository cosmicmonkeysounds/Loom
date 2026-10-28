<#
.SYNOPSIS
    The TV: Chrome in kiosk mode on the HDMI display, the living-room
    terminal (view=tv, spot desktop-tv) speaking Trabolta's lines.

.DESCRIPTION
    First time (provision + grant autoplay; no kiosk, so you can click):

        $env:LOOM_MOD_CODE = '<the mod passcode>'     # or -ModCode; never written to disk by this script
        .\tv-kiosk.ps1 -Setup

    The page stores its setup (spot, view, voice) in this Chrome profile, so
    from then on no code is needed:

        .\tv-kiosk.ps1                       # kiosk on the TV (display 2 if there are two)
        .\tv-kiosk.ps1 -Display 1            # pick the display (1 = primary)
        .\tv-kiosk.ps1 -InstallTask          # start the kiosk at every logon
        .\tv-kiosk.ps1 -Close                # close the TV's Chrome (only that profile's)

    Chrome runs with its own profile (%LOCALAPPDATA%\loom-tv), so it is a
    separate window from any everyday Chrome, and with
    --autoplay-policy=no-user-gesture-required, so it speaks with nobody
    touching it. In -Setup: check the URL resolved the TV spot, open the
    gear (hold 2 s) -> device voice: Microsoft David (or Mark) for
    Trabolta, TEST VOICE; then close and run without -Setup. M mutes the TV
    voice (Run -> Terminals shows it).

    The TV's sound (wave 38) goes to the house speakers, not the TV's own:
    Chrome's output device is the PC's line out (Settings -> System ->
    Sound -> Volume mixer; on Windows 10, App volume and device
    preferences), cabled into the 828x's rear Analog In 1, where the audio
    router routes it to every speaker and ducks the music under it. The
    TV's own volume stays down, or Trabolta plays twice. This script does
    not set the output device; Windows keeps it per program (every Chrome
    window on this PC). In the MacBook fallback the router does not route
    the TV: set Chrome back to HDMI. Turn off Windows' own sounds (Sound ->
    Sounds -> No Sounds) so no system ping ever plays in the house.
    README section 3.5.

.PARAMETER ModCode
    The mod passcode for the first provisioning (default: $env:LOOM_MOD_CODE).
    Only put in the URL Chrome opens; printed masked.
.PARAMETER Server
    The event server (default: $env:LOOM_SERVER, else https://app.mapsandducks.com).
.PARAMETER Spot
    The house-map terminal spot (default desktop-tv).
.PARAMETER Display
    1-based display number; default: the last one (the TV, when it is the
    second screen).
#>
[CmdletBinding()]
param(
    [string]$ModCode,
    [string]$Server,
    [string]$Spot = 'desktop-tv',
    [int]$Display = 0,
    [switch]$Setup,
    [switch]$InstallTask,
    [switch]$Close,
    [string]$ProfileDir = (Join-Path $env:LOCALAPPDATA 'loom-tv')
)

. "$PSScriptRoot\common.ps1"

if (-not $Server) { if ($env:LOOM_SERVER) { $Server = $env:LOOM_SERVER } else { $Server = $script:DefaultServer } }
$Server = $Server.TrimEnd('/')

function Stop-TvChrome {
    # @() round the whole pipeline: no match is an empty array (@($null) would count 1).
    $mine = @(Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine.Contains($ProfileDir) })
    foreach ($p in $mine) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    return $mine.Count
}

if ($Close) {
    $n = Stop-TvChrome
    Write-Host ('closed ' + $n + ' TV Chrome process(es)')
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
    Register-ScheduledTask -TaskName 'tv-kiosk' -TaskPath '\Loom\' -Action $action -Trigger $trigger -Settings $settings -Description 'Loom: the TV kiosk (Chrome, view=tv)' -Force | Out-Null
    Write-Host 'installed \Loom\tv-kiosk: the TV kiosk opens 20 s after every logon (no passcode stored: the Chrome profile holds the setup)'
    exit 0
}

$chrome = Find-Chrome
if (-not $chrome) {
    Write-Host 'Chrome is not installed: winget install Google.Chrome' -ForegroundColor Red
    exit 2
}

$code = Get-ModCode $ModCode
if ($code) {
    $url = $Server + '/terminal/?code=' + [uri]::EscapeDataString($code) + '&spot=' + [uri]::EscapeDataString($Spot)
    $shown = $Server + '/terminal/?code=' + (Hide-Secret $code) + '&spot=' + $Spot
} else {
    if ($Setup) { Write-Host 'No mod passcode (-ModCode or $env:LOOM_MOD_CODE): the page will ask for it, then tap the TV spot on the map.' -ForegroundColor Yellow }
    $url = $Server + '/terminal/'
    $shown = $url
}

# The display: the TV is usually the second screen; Chrome's kiosk window
# opens where its window was, so place it there first.
Add-Type -AssemblyName System.Windows.Forms
$screens = @([System.Windows.Forms.Screen]::AllScreens)
$index = $screens.Count - 1
if ($Display -gt 0) {
    if ($Display -gt $screens.Count) { Write-Host ('there are ' + $screens.Count + ' display(s); -Display ' + $Display + ' does not exist') -ForegroundColor Red; exit 2 }
    $index = $Display - 1
}
$b = $screens[$index].Bounds
Write-Host ('display ' + ($index + 1) + ' of ' + $screens.Count + ': ' + $b.Width + 'x' + $b.Height + ' at ' + $b.X + ',' + $b.Y + '  (' + $screens[$index].DeviceName + ')')

$killed = Stop-TvChrome
if ($killed -gt 0) { Start-Sleep -Seconds 2 }

$flags = @(
    '--user-data-dir="' + $ProfileDir + '"',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
    '--disable-features=Translate',
    '--autoplay-policy=no-user-gesture-required',
    ('--window-position=' + $b.X + ',' + $b.Y)
)
if (-not $Setup) { $flags += '--kiosk' }
# Start-Process joins -ArgumentList with spaces and quotes nothing, so the
# command line is built here (the profile path is quoted above, the URL here).
$cmdline = ($flags -join ' ') + ' "' + $url + '"'
Start-Process -FilePath $chrome -ArgumentList $cmdline
if ($Setup) { Write-Host ('setup window opened: ' + $shown) } else { Write-Host ('TV kiosk opened: ' + $shown + '  (Alt+F4 closes it; .\tv-kiosk.ps1 -Close)') }
exit 0
