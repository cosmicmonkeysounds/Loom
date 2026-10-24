# showctl on Windows (PowerShell 5.1+) — show-night diagnostics (see README.md here).
#   .\scripts\show\showctl.ps1 preflight desktop
#   $env:LOOM_MOD_CODE = '<mod passcode>'; .\scripts\show\showctl.ps1 doctor --watch 15
# If scripts are blocked: powershell -ExecutionPolicy Bypass -File scripts\show\showctl.ps1 doctor
# Needs Node 22.6 or newer (winget install OpenJS.NodeJS.LTS).
$ErrorActionPreference = 'Stop'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  # Not Write-Error: under 'Stop' it is terminating, and the exit code would be 1.
  [Console]::Error.WriteLine('showctl: node not found - install Node 22.6 or newer (winget install OpenJS.NodeJS.LTS)')
  exit 2
}
# Emoji and box characters print right in the console.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$script = Join-Path $PSScriptRoot 'showctl.ts'
& $node.Source --experimental-strip-types --no-warnings $script @args
exit $LASTEXITCODE
