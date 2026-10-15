param([ValidateSet('start','stop','status')][string]$Action='start')
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$workspaceRoot=Split-Path (Split-Path $projectRoot -Parent) -Parent
$runtimeRoot=Join-Path $workspaceRoot 'work'
$expected="P:\: => $runtimeRoot"
$previousEncoding=[Console]::OutputEncoding
try {
 [Console]::OutputEncoding=[Text.Encoding]::GetEncoding([Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage)
 $mapping=(& subst) | Where-Object { $_ -like 'P:*' }
} finally { [Console]::OutputEncoding=$previousEncoding }
if ($mapping -and $mapping -ne $expected) { throw 'P: is used by another directory. Do not replace it; choose another ASCII path for PostgreSQL.' }
if (-not $mapping) { & subst P: $runtimeRoot; if($LASTEXITCODE -ne 0){throw 'Unable to map ASCII development path'} }
$pgCtl='P:/postgresql/pgsql/bin/pg_ctl.exe'
if(-not (Test-Path $pgCtl) -or -not (Test-Path 'P:/platform-runtime/data/PG_VERSION')) {throw 'This helper is for the prepared local development machine only. On another machine use Docker Compose or install PostgreSQL.'}
if($Action -eq 'start') {
 & $pgCtl -D 'P:/platform-runtime/data' status *> $null
 if($LASTEXITCODE -ne 0){ & $pgCtl -D 'P:/platform-runtime/data' -l 'P:/platform-runtime/postgres.log' -o '-h 127.0.0.1 -p 55432' start }
} elseif($Action -eq 'stop') { & $pgCtl -D 'P:/platform-runtime/data' -m fast stop }
else { & $pgCtl -D 'P:/platform-runtime/data' status }
