<#
  quest-win.ps1 -- the Windows companion to tools/quest.sh (which needs a Mac /
  rsync). Stages the project into build\stage, adds the OpenXR vendors plugin,
  bakes a per-station config\station.json + the build stamp, and exports the
  Quest APK (release by default) with the release keystore.

  Everything it writes lives in the git-ignored build\ (plus, once, a release
  keystore under %USERPROFILE%\.config\loom, the same place quest.sh keeps it).
  The working project and test\run.sh never see the vendors plugin, the baked
  station.json or the build stamp.

  Usage:
    tools\quest-win.ps1 -Station vr-1 -Code PASS [-Name "Headset 1"]
                        [-Server https://app.mapsandducks.com]
                        [-Graphics low|medium|high] [-DebugBuild]
    tools\quest-win.ps1 -Station vr-2 -Code PASS -Graphics high      # release
    tools\quest-win.ps1 -DebugBuild                                  # plain debug, no bake
    tools\quest-win.ps1 -Station vr-2 -Code PASS -Install -Launch    # build, sideload, start
    tools\quest-win.ps1 -InstallOnly -Station vr-2 -Serial 2G0Y...   # re-sideload the last build

  -Install sideloads onto the one connected headset (-Serial picks one when
  several are plugged in; `adb devices` lists them). A headset holding a
  copy signed with another key (a debug build) refuses the update: -Replace
  uninstalls it first, which wipes the headset's own setup -- the baked
  station config covers that. -Launch starts the game afterwards.

  Env fallbacks: JAVA_HOME, ANDROID_HOME, GODOT_PATH (the editor exe; the
  _console.exe beside it is used for headless output), LOOM_MOD_CODE (the
  passcode when -Code is omitted).

  After it builds (without -Install):  tools\quest-win.ps1 -InstallOnly ...
#>
[CmdletBinding()]
param(
  [string]$Station = "",
  [string]$Code = $env:LOOM_MOD_CODE,
  [string]$Name = "",
  [string]$Server = "https://app.mapsandducks.com",
  [ValidateSet("", "low", "medium", "high")]
  [string]$Graphics = "",
  [switch]$DebugBuild,
  [string]$Godot = "",
  [switch]$Install,
  [switch]$InstallOnly,
  [switch]$Replace,
  [switch]$Launch,
  [string]$Serial = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot      # ...\reinstall\vr
$Build = Join-Path $ProjectRoot "build"
$Stage = Join-Path $Build "stage"
$Cache = Join-Path $Build "cache"
$Preset = "Quest"
$VendorsVersion = "5.1.0-stable"
$VendorsSha = "6a838dbdf4115549e4511ebee0da9a5dcc8f9f6258d4cc2f2ee57a907a3e2911"
$VendorsUrl = "https://github.com/GodotVR/godot_openxr_vendors/releases/download/$VendorsVersion/godotopenxrvendorsaddon.zip"
$KeyDir = Join-Path $env:USERPROFILE ".config\loom"
$ReleaseKeystore = Join-Path $KeyDir "reinstall-release.keystore"
$ReleaseEnv = Join-Path $KeyDir "reinstall-release.env"

function Die($m) { Write-Error "quest-win: $m"; exit 1 }
function Say($m) { Write-Host $m }
# UTF-8 without a BOM: a leading BOM breaks Godot's JSON parser. quest.sh writes none.
function Write-Utf8NoBom($path, $text) {
  [IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding $false))
}

# -- toolchain discovery ----------------------------------------------------
if (-not $env:JAVA_HOME -or -not (Test-Path (Join-Path $env:JAVA_HOME "bin\java.exe"))) {
  Die "JAVA_HOME is not a JDK ('$($env:JAVA_HOME)'). Set it to the JDK 17 home."
}
if (-not $env:ANDROID_HOME -or -not (Test-Path (Join-Path $env:ANDROID_HOME "platform-tools"))) {
  Die "ANDROID_HOME is not an SDK ('$($env:ANDROID_HOME)'). Set it to the Android SDK root."
}
$JavaHome = $env:JAVA_HOME
$AndroidHome = $env:ANDROID_HOME

if (-not $Godot) {
  # prefer the console build (prints to the terminal) beside GODOT_PATH
  if ($env:GODOT_PATH) {
    $cons = [IO.Path]::Combine((Split-Path -Parent $env:GODOT_PATH), "Godot_console.exe")
    if (Test-Path $cons) { $Godot = $cons } else { $Godot = $env:GODOT_PATH }
  }
}
if (-not $Godot -or -not (Test-Path $Godot)) {
  Die "no Godot exe (pass -Godot, or set GODOT_PATH). Expected the 4.7 Windows build."
}

# -- validation (mirrors quest.sh) ------------------------------------------
function Default-Name($s) { if ($s -match '^vr-([0-9]+)$') { "Headset $($Matches[1])" } else { $s } }

if ($Station) {
  if ($Station -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$') { Die "bad station id '$Station' (e.g. vr-1)" }
  if (-not $Code -and -not $InstallOnly) { Die "-Station needs -Code (or LOOM_MOD_CODE): the mod passcode baked in" }
  if (-not $Name) { $Name = Default-Name $Station }
  if ($Server -notmatch '^https://') {
    Write-Warning "$Server is not HTTPS; Android refuses cleartext http, so this APK will not reach it"
  }
}
if ($Graphics -and -not $Station) { Die "-Graphics needs -Station (it is baked into the station's config)" }
$Package = "com.mapsandducks.reinstall"
$Adb = Join-Path $AndroidHome "platform-tools\adb.exe"

function Apk-Name {
  $n = "reinstall-vr"
  if ($Station) { $n = "$n-$Station" }
  if ($DebugBuild) { $n = "$n-debug" }
  "$n.apk"
}

# -- sideload ---------------------------------------------------------------
function Adb { if ($Serial) { & $Adb -s $Serial @args } else { & $Adb @args } }
function Install-Apk($apk) {
  if (-not (Test-Path $Adb)) { Die "no adb at $Adb" }
  $devs = @(& $Adb devices | Select-String "	device$" | ForEach-Object { ($_ -split "	")[0] })
  if ($devs.Count -eq 0) { Die "no headset on adb (USB plugged in, developer mode on, 'Allow USB debugging' accepted in the headset?)" }
  if (-not $Serial -and $devs.Count -gt 1) { Die "several headsets on adb ($($devs -join ', ')): pick one with -Serial" }
  Say "-- install $apk"
  $res = (Adb install -r $apk 2>&1 | Out-String)
  if ($res -match "INSTALL_FAILED_UPDATE_INCOMPATIBLE") {
    if (-not $Replace) { Die "the headset's copy is signed with another key (a debug build?). Re-run with -Replace to uninstall it first (wipes its own setup; the baked config covers it)." }
    Say "  the headset's copy has another signature: uninstalling it first"
    Adb uninstall $Package | Out-Null
    $res = (Adb install $apk 2>&1 | Out-String)
  }
  if ($res -notmatch "Success") { Die "install failed: $($res.Trim())" }
  Say "  installed"
  if ($Launch) {
    Adb shell am start -n "$Package/com.godot.game.GodotAppLauncher" | Out-Null
    Say "  launched (wake a controller if the headset asks for one)"
  }
}

# -- the OpenXR vendors plugin ----------------------------------------------
function Ensure-Vendors($destAddons) {
  $zip = Join-Path $Cache "godotopenxrvendorsaddon-$VendorsVersion.zip"
  if (-not (Test-Path $zip)) {
    New-Item -ItemType Directory -Force -Path $Cache | Out-Null
    Say "-- fetching vendors $VendorsVersion"
    Invoke-WebRequest -Uri $VendorsUrl -OutFile "$zip.part"
    $got = (Get-FileHash "$zip.part" -Algorithm SHA256).Hash.ToLower()
    if ($got -ne $VendorsSha) { Remove-Item "$zip.part"; Die "vendors zip checksum mismatch ($got)" }
    Move-Item "$zip.part" $zip
  }
  $unzip = Join-Path $Build "vendors-unzip"
  if (Test-Path $unzip) { Remove-Item -Recurse -Force $unzip }
  Expand-Archive -Path $zip -DestinationPath $unzip -Force
  New-Item -ItemType Directory -Force -Path $destAddons | Out-Null
  $src = Join-Path $unzip "asset\addons\godotopenxrvendors"
  Copy-Item -Recurse -Force $src (Join-Path $destAddons "godotopenxrvendors")
  Remove-Item -Recurse -Force $unzip
}

if ($InstallOnly) {
  $apk = Join-Path $Build (Apk-Name)
  if (-not (Test-Path $apk)) { Die "no $apk to install -- build it first" }
  Install-Apk $apk
  exit 0
}

# -- stage ------------------------------------------------------------------
Say "-- staging into $Stage"
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null
# robocopy mirrors; /XD excludes dirs, /XF excludes files. Exit codes under 8 are success.
$rcArgs = @($ProjectRoot, $Stage, "/MIR", "/NFL", "/NDL", "/NJH", "/NJS", "/NP",
            "/XD", $Build, (Join-Path $ProjectRoot ".godot"), (Join-Path $ProjectRoot "android"),
                   (Join-Path $ProjectRoot "addons"),
            "/XF", "*.import")
& robocopy @rcArgs | Out-Null
if ($LASTEXITCODE -ge 8) { Die "robocopy failed (exit $LASTEXITCODE)" }
$global:LASTEXITCODE = 0

Ensure-Vendors (Join-Path $Stage "addons")

# bake station.json (same shape quest.sh writes) -- staging copy only
if ($Station) {
  $st = [ordered]@{ server = $Server; code = $Code; station = $Station; name = $Name }
  if ($Graphics) { $st["graphics"] = $Graphics }
  Write-Utf8NoBom (Join-Path $Stage "config\station.json") ($st | ConvertTo-Json)
  $extra = ""; if ($Graphics) { $extra = " / $Graphics" }
  Say "  baked: $Station / $Name / $Server$extra"
}

# the lobby's build stamp (config\build.json): short sha, "+" when the tree is dirty
$sha = (& git -C $ProjectRoot rev-parse --short HEAD 2>$null)
if (-not $sha) { $sha = "unknown" }
elseif (& git -C $ProjectRoot status --porcelain -- . 2>$null) { $sha = "$sha+" }
$when = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mmZ")
Write-Utf8NoBom (Join-Path $Stage "config\build.json") ([ordered]@{ build = $sha; at = $when } | ConvertTo-Json)

# -- keystore ---------------------------------------------------------------
$env:JAVA_HOME = $JavaHome
$env:ANDROID_HOME = $AndroidHome
if ($DebugBuild) {
  $dbg = Join-Path $env:APPDATA "Godot\keystores\debug.keystore"
  if (-not (Test-Path $dbg)) { Die "no debug keystore at $dbg -- open Godot once or run the setup step" }
  $env:GODOT_ANDROID_KEYSTORE_DEBUG_PATH = $dbg
  $env:GODOT_ANDROID_KEYSTORE_DEBUG_USER = "androiddebugkey"
  $env:GODOT_ANDROID_KEYSTORE_DEBUG_PASSWORD = "android"
} else {
  if (-not (Test-Path $ReleaseKeystore) -or -not (Test-Path $ReleaseEnv)) {
    Say "-- creating a release keystore at $ReleaseKeystore"
    New-Item -ItemType Directory -Force -Path $KeyDir | Out-Null
    $bytes = New-Object byte[] 24; (New-Object Random).NextBytes($bytes)
    $alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    $pass = -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
    & (Join-Path $JavaHome "bin\keytool.exe") -genkeypair -keystore $ReleaseKeystore `
      -storepass $pass -keypass $pass -alias reinstall -keyalg RSA -keysize 2048 `
      -validity 10000 -dname "CN=Reinstallation,O=Maps and Ducks,C=US"
    if ($LASTEXITCODE -ne 0) { Die "keytool failed" }
    @(
      "GODOT_ANDROID_KEYSTORE_RELEASE_PATH=$ReleaseKeystore"
      "GODOT_ANDROID_KEYSTORE_RELEASE_USER=reinstall"
      "GODOT_ANDROID_KEYSTORE_RELEASE_PASSWORD=$pass"
    ) | Set-Content -Encoding ascii $ReleaseEnv
    Say "  created $ReleaseKeystore -- back it up; an update must be signed with the same key"
  }
  foreach ($line in Get-Content $ReleaseEnv) {
    if ($line -match '^([^=]+)=(.*)$') { Set-Item "env:$($Matches[1])" $Matches[2] }
  }
}

# -- export -----------------------------------------------------------------
$out = Join-Path $Build (Apk-Name)
if (Test-Path $out) { Remove-Item -Force $out }

Say "-- import (registers the vendors GDExtension)"
& $Godot --headless --path $Stage --import
Say "-- export $Preset -> $out"
$mode = if ($DebugBuild) { "--export-debug" } else { "--export-release" }
# the staged copy has no android\build template (excluded) -> install it on first export
# Godot 4.7 on Windows often never exits after a finished export, so wait for
# the APK to land and settle, then stop that Godot (its own pid, nothing else).
$godotArgs = @("--headless", "--path", "`"$Stage`"", "--install-android-build-template", $mode, $Preset, "`"$out`"")
$proc = Start-Process -FilePath $Godot -ArgumentList $godotArgs -NoNewWindow -PassThru
$deadline = (Get-Date).AddMinutes(15)
$lastSize = -1
while (-not $proc.HasExited -and (Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 5
  if (Test-Path $out) {
    $len = (Get-Item $out).Length
    if ($len -gt 0 -and $len -eq $lastSize) { Start-Sleep -Seconds 5; break }
    $lastSize = $len
  }
}
if (-not $proc.HasExited) {
  if (-not (Test-Path $out)) { Stop-Process -Id $proc.Id -Force; Die "export timed out with no APK" }
  Say "  the APK is written; stopping Godot (it does not exit on its own after an export)"
  Stop-Process -Id $proc.Id -Force
}
if (-not (Test-Path $out)) { Die "export produced no APK -- scroll up for Godot's error" }

$size = "{0:N0} MB" -f ((Get-Item $out).Length / 1MB)
Say ""
Say "built $out ($size)"
if ($Station) { Say "baked: $Station / $Name / $Server" }
if ($Install) { Install-Apk $out } else { Say "next: tools\quest-win.ps1 -InstallOnly$(if ($Station) { " -Station $Station" }) (or: adb install -r `"$out`")" }
