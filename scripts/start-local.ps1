param(
    [switch]$Start,
    [switch]$Restart,
    [switch]$Status
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$logs = Join-Path $root ".runtime-logs"
New-Item -ItemType Directory -Force -Path $logs | Out-Null

$backendLog = Join-Path $logs "backend-local.log"
$frontendLog = Join-Path $logs "frontend-local.log"
$backendPidFile = Join-Path $logs "backend-window.pid"
$frontendPidFile = Join-Path $logs "frontend-window.pid"
$lastStartFile = Join-Path $logs "local-stack.last-start"
$launchCooldownSeconds = 20

function Get-LivePidFromFile {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    $raw = (Get-Content -LiteralPath $Path -ErrorAction SilentlyContinue | Select-Object -First 1)
    $pidValue = 0
    if (-not [int]::TryParse([string]$raw, [ref]$pidValue)) {
        Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
        return $null
    }
    $proc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    if ($proc) { return $pidValue }
    Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    return $null
}

function Get-PortOwners {
    param([int[]]$Ports)
    $connections = Get-NetTCPConnection -LocalPort $Ports -State Listen -ErrorAction SilentlyContinue
    if (-not $connections) { return @() }
    return @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
}

function Stop-IfRunning {
    param([int[]]$Pids)
    foreach ($pidValue in $Pids | Where-Object { $_ } | Select-Object -Unique) {
        $proc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
        if ($proc) {
            Stop-Process -Id $pidValue -Force
            Write-Host "Proceso detenido: $pidValue" -ForegroundColor Yellow
        }
    }
}

$knownPids = @(
    Get-LivePidFromFile $backendPidFile
    Get-LivePidFromFile $frontendPidFile
) | Where-Object { $_ }
$portOwners = Get-PortOwners @(4000, 4001)
$alreadyRunning = ($knownPids.Count -gt 0) -or ($portOwners.Count -gt 0)
$recentlyStarted = $false
if ((Test-Path $lastStartFile) -and -not $Restart) {
    $lastStartRaw = Get-Content -LiteralPath $lastStartFile -ErrorAction SilentlyContinue | Select-Object -First 1
    $lastStart = [datetime]::MinValue
    if ([datetime]::TryParse([string]$lastStartRaw, [ref]$lastStart)) {
        $recentlyStarted = ((Get-Date) - $lastStart).TotalSeconds -lt $launchCooldownSeconds
    }
}

if ($Status) {
    Write-Host "WP MONITOR local status" -ForegroundColor Green
    $knownLabel = if ($knownPids.Count -gt 0) { $knownPids -join ', ' } else { "none" }
    $portLabel = if ($portOwners.Count -gt 0) { $portOwners -join ', ' } else { "none" }
    Write-Host " Backend/frontend windows: $knownLabel" -ForegroundColor DarkCyan
    Write-Host " Port owners 4000/4001: $portLabel" -ForegroundColor DarkCyan
    if (Test-Path $lastStartFile) {
        Write-Host " Last start: $(Get-Content -LiteralPath $lastStartFile | Select-Object -First 1)" -ForegroundColor DarkCyan
    }
    Write-Host " Commands: pnpm run dev:local | pnpm run dev:local -- -Restart | pnpm run dev:local -- -Status" -ForegroundColor Cyan
    exit 0
}

if (-not $Start -and -not $Restart) {
    Write-Host "WP MONITOR local launcher" -ForegroundColor Green
    Write-Host ""
    Write-Host "No se inicio nada. Este script requiere una orden explicita para arrancar." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Comandos seguros:" -ForegroundColor Cyan
    Write-Host " pnpm run dev:local" -ForegroundColor Cyan
    Write-Host " pnpm run dev:local -- -Status" -ForegroundColor Cyan
    Write-Host " pnpm run dev:local -- -Restart" -ForegroundColor Cyan
    exit 0
}

if ($recentlyStarted) {
    Write-Host ""
    Write-Host "WP MONITOR fue lanzado hace menos de $launchCooldownSeconds segundos." -ForegroundColor Yellow
    Write-Host "No abri nuevas terminales para evitar arranques duplicados accidentales." -ForegroundColor Yellow
    Write-Host "Si realmente quieres forzar reinicio: pnpm run dev:local -- -Restart" -ForegroundColor Cyan
    exit 0
}

if ($alreadyRunning -and -not $Restart) {
    Write-Host ""
    Write-Host "WP MONITOR ya parece estar ejecutandose." -ForegroundColor Yellow
    if ($knownPids.Count -gt 0) {
        Write-Host " Ventanas conocidas: $($knownPids -join ', ')" -ForegroundColor DarkCyan
    }
    if ($portOwners.Count -gt 0) {
        Write-Host " Puertos 4000/4001 ocupados por: $($portOwners -join ', ')" -ForegroundColor DarkCyan
    }
    Write-Host ""
    Write-Host "No abri nuevas terminales para evitar duplicados." -ForegroundColor Yellow
    Write-Host "Usa: pnpm run dev:local -- -Restart" -ForegroundColor Cyan
    exit 0
}

if ($Restart -and $alreadyRunning) {
    Write-Host "Reiniciando WP MONITOR local..." -ForegroundColor Yellow
    Stop-IfRunning @($knownPids + $portOwners)
    Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor DarkGray
Write-Host " WP MONITOR - Local Full Stack" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor DarkGray
Write-Host " Backend : http://127.0.0.1:4000" -ForegroundColor Cyan
Write-Host " Frontend: http://127.0.0.1:4001" -ForegroundColor Cyan
Write-Host " Logs    : .runtime-logs/backend-local.log" -ForegroundColor DarkCyan
Write-Host "           .runtime-logs/frontend-local.log" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "Se abriran dos terminales visibles con nombre:" -ForegroundColor Yellow
Write-Host " - WP MONITOR Backend 4000" -ForegroundColor Yellow
Write-Host " - WP MONITOR Frontend 4001" -ForegroundColor Yellow
Write-Host ""

$nowIso = (Get-Date).ToString("o")
$nowIso | Set-Content -LiteralPath $lastStartFile

$backendCommand = @"
`$Host.UI.RawUI.WindowTitle = 'WP MONITOR Backend 4000';
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new();
Set-Location '$root';
`$env:PORT='4000';
`$env:BACKEND_PORT='4000';
Write-Host '[WP MONITOR Backend] http://127.0.0.1:4000' -ForegroundColor Green;
Write-Host '[WP MONITOR Backend] Log: $backendLog' -ForegroundColor DarkCyan;
pnpm run dev 2>&1 | Tee-Object -FilePath '$backendLog';
"@

$frontendCommand = @"
`$Host.UI.RawUI.WindowTitle = 'WP MONITOR Frontend 4001';
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new();
Set-Location '$root';
`$env:PORT='4001';
`$env:CLIENT_PORT='4001';
`$env:VITE_API_URL='http://127.0.0.1:4000';
Write-Host '[WP MONITOR Frontend] http://127.0.0.1:4001' -ForegroundColor Green;
Write-Host '[WP MONITOR Frontend] Log: $frontendLog' -ForegroundColor DarkCyan;
pnpm --dir client start 2>&1 | Tee-Object -FilePath '$frontendLog';
"@

$backendProcess = Start-Process powershell.exe -ArgumentList @("-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $backendCommand) -WorkingDirectory $root -PassThru
$backendProcess.Id | Set-Content -LiteralPath $backendPidFile
Start-Sleep -Milliseconds 600
$frontendProcess = Start-Process powershell.exe -ArgumentList @("-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $frontendCommand) -WorkingDirectory $root -PassThru
$frontendProcess.Id | Set-Content -LiteralPath $frontendPidFile

Write-Host "Arranque solicitado. Manten abiertas esas terminales para ver logs en vivo." -ForegroundColor Green
Write-Host "Para detener todo: Ctrl+C en cada terminal o cierra ambas ventanas." -ForegroundColor Yellow
Write-Host "Para reiniciar sin duplicar: pnpm run dev:local -- -Restart" -ForegroundColor Cyan
