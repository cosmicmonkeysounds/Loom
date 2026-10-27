<#
.SYNOPSIS
    Mosquitto on the house PC: anonymous on 127.0.0.1:1883, password-only
    `props` on the LAN at :1884, the Windows service on, the firewall open
    for 1884 only.

.DESCRIPTION
    Once, from an elevated PowerShell (Run as administrator):

        winget install EclipseFoundation.Mosquitto      # if it isn't installed
        .\setup-mosquitto.ps1                           # asks for the props password

    It writes mosquitto.conf (this folder's template) into the install
    folder, where the Windows service reads it, keeps the installer's
    original as mosquitto.conf.orig, makes the password file
    C:\ProgramData\mosquitto\passwd (asks twice for the password, only if
    there is none yet or -ResetPassword), sets the service to Automatic,
    restarts it and opens TCP 1884 on the Private / Domain firewall
    profiles (1883 never leaves this PC). Then it runs the check.

        .\setup-mosquitto.ps1 -Check                    # no admin needed

    The same props password goes into each WLED controller (Config ->
    Sync Interfaces -> MQTT) and, only for the MacBook router fallback,
    the MacBook's stagehand\trapped.macbook.local.yaml
    (audio: { mqtt: { password } }). Never in a tracked file.

.PARAMETER Check
    Only check: the service, both listeners, 1883 refused from the LAN.
.PARAMETER ResetPassword
    Make a new password file even if one exists (every client must change).
.PARAMETER User
    The LAN listener's user (default props).
.PARAMETER DataDir
    Where the password file lives (default C:\ProgramData\mosquitto).
.PARAMETER SetPrivate
    Mark the house Wi-Fi / Ethernet network Private: the firewall rule for
    1884 never applies on a Public network.
#>
[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$ResetPassword,
    [string]$User = 'props',
    [string]$DataDir = 'C:\ProgramData\mosquitto',
    [switch]$SetPrivate
)

. "$PSScriptRoot\common.ps1"

$RuleName = 'Loom Mosquitto props (TCP 1884)'

function Test-Broker {
    Write-Step 'Mosquitto'
    $svc = Get-Service mosquitto -ErrorAction SilentlyContinue
    if (-not $svc) {
        Write-Bad 'no "mosquitto" service: winget install EclipseFoundation.Mosquitto, then .\setup-mosquitto.ps1'
        return
    }
    if ($svc.Status -eq 'Running') { Write-Ok ('service running (' + $svc.StartType + ')') } else { Write-Bad ('service ' + $svc.Status + ': Start-Service mosquitto (elevated)') }
    if ($svc.StartType -ne 'Automatic') { Write-Warn 'service is not Automatic: it will not come back after a reboot' }

    $conf = Join-Path $script:MosquittoDir 'mosquitto.conf'
    if ((Test-Path -LiteralPath $conf) -and ((Get-Content -LiteralPath $conf -Raw) -match '(?m)^listener 1884')) {
        Write-Ok ('config ' + $conf + ' has both listeners')
    } else {
        Write-Bad ('config ' + $conf + ' is not the house one: run .\setup-mosquitto.ps1 elevated')
    }

    if (Test-Port '127.0.0.1' 1883) { Write-Ok '127.0.0.1:1883 (anonymous, this PC) answers' } else { Write-Bad '127.0.0.1:1883 does not answer' }
    $lan = @(Get-LanAddresses)
    if ($lan.Count -eq 0) { Write-Warn 'no LAN IPv4 address: is the PC on the house network?' }
    foreach ($ip in $lan) {
        if (Test-Port $ip 1884) { Write-Ok ($ip + ':1884 (props, the LAN) answers') } else { Write-Bad ($ip + ':1884 does not answer') }
        if (Test-Port $ip 1883 800) { Write-Bad ($ip + ':1883 answers on the LAN: anyone on the Wi-Fi could publish show/announce') } else { Write-Ok ($ip + ':1883 refused from the LAN') }
    }
    if ($lan -notcontains '192.168.8.10') {
        Write-Warn 'this PC is not 192.168.8.10 (the house DHCP reservation the WLED controllers and trapped.macbook.yaml dial): move the reservation to this PC, or change the MacBook overlay''s audio.mqtt.host'
    }

    $profiles = Get-NetConnectionProfile -ErrorAction SilentlyContinue
    foreach ($p in $profiles) {
        if ($p.NetworkCategory -eq 'Public') { Write-Warn ('network "' + $p.Name + '" is Public: the 1884 rule does not apply there (.\setup-mosquitto.ps1 -SetPrivate)') }
    }
    $rule = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
    if ($rule) { Write-Ok 'firewall rule for 1884 present' } else { Write-Warn 'no firewall rule for 1884: run .\setup-mosquitto.ps1 elevated' }
}

if ($Check) {
    Test-Broker
    if ($script:Failures -gt 0) { exit 1 }
    exit 0
}

Assert-Admin 'it writes into Program Files, restarts a service and opens a firewall port'

$broker = Find-Mosquitto 'mosquitto'
$passwdExe = Find-Mosquitto 'mosquitto_passwd'
if (-not $broker -or -not $passwdExe) {
    Write-Host 'Mosquitto is not installed: winget install EclipseFoundation.Mosquitto (then run this again)' -ForegroundColor Red
    exit 2
}

if ($SetPrivate) {
    Get-NetConnectionProfile | Where-Object { $_.NetworkCategory -eq 'Public' } | ForEach-Object {
        Set-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -NetworkCategory Private
        Write-Host ('network "' + $_.Name + '" is Private now')
    }
}

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$passwd = Join-Path $DataDir 'passwd'
if ($ResetPassword -or -not (Test-Path -LiteralPath $passwd)) {
    Write-Host ('The LAN listener''s password for user "' + $User + '" (it goes into trapped.macbook.local.yaml and the WLED controllers):')
    & $passwdExe -c $passwd $User
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'mosquitto_passwd failed' -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host ('keeping the password file ' + $passwd + ' (-ResetPassword makes a new one)')
}

$conf = Join-Path $script:MosquittoDir 'mosquitto.conf'
$orig = $conf + '.orig'
if ((Test-Path -LiteralPath $conf) -and -not (Test-Path -LiteralPath $orig)) {
    Copy-Item -LiteralPath $conf -Destination $orig
    Write-Host ('kept the installer''s config as ' + $orig)
}
$template = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'mosquitto.conf') -Raw
# mosquitto takes forward slashes on Windows, and never a quoted path.
Write-Utf8NoBom $conf ($template.Replace('@PASSWORD_FILE@', $passwd.Replace('\', '/')))
Write-Host ('wrote ' + $conf)

Set-Service mosquitto -StartupType Automatic
Restart-Service mosquitto
Start-Sleep -Seconds 2

$existing = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
if ($existing) { $existing | Remove-NetFirewallRule }
New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Protocol TCP -LocalPort 1884 -Action Allow -Profile Private, Domain | Out-Null
Write-Host 'firewall: TCP 1884 open on the Private / Domain profiles (1883 stays on this PC)'

Test-Broker
if ($script:Failures -gt 0) { exit 1 }
exit 0
