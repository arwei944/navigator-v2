<#
.SYNOPSIS
  启动 nav 控制台（并确保自启任务处于启用状态）。
.DESCRIPTION
  与 stop.ps1 配对：stop 会停用计划任务（否则保活会在 5 分钟内把它拉起来），
  start 负责重新启用并立刻拉起。

.PARAMETER Port 控制台端口，默认 5175
.EXAMPLE
  powershell -File tools\console\launcher\start.ps1
#>
param([int]$Port = 5175)
$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot 'lib.ps1')

$taskName = $script:NavTaskName
$task = Get-NavTask
if ($task) {
  if ($task.State -eq 'Disabled') {
    Enable-ScheduledTask -TaskName $taskName | Out-Null
    Write-Host "[start] 已启用计划任务 $taskName" -ForegroundColor Green
  } else {
    Write-Host "[start] 计划任务 $taskName 已处于启用状态"
  }
  # 走计划任务拉起（脱离本终端句柄，避免 npm 管道卡死）
  if (Test-ConsoleHealthy -Port $Port) {
    Write-Host "[start] 控制台已在线，跳过拉起"
  } elseif (Start-NavTaskNow -Port $Port) {
    Write-Host "[start] 已由计划任务拉起"
  } else {
    Write-Host "[start] ⚠️  计划任务未能在 30s 内拉起，日志: $(Join-Path $PSScriptRoot 'logs\console.log.err')" -ForegroundColor Yellow
  }
} else {
  Write-Host "[start] 未注册计划任务；仅做一次性启动。要开机自启请跑 install-autostart.ps1" -ForegroundColor Yellow
  & (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'ensure-console.ps1') -Port $Port
}

if (Test-ConsoleHealthy -Port $Port) {
  Write-Host "[start] ✅ 控制台在线: http://127.0.0.1:$Port" -ForegroundColor Green
} else {
  Write-Host "[start] ⚠️  未就绪，日志: $(Join-Path $PSScriptRoot 'logs\console.log.err')" -ForegroundColor Yellow
}