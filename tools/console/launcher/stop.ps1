<#
.SYNOPSIS
  停止 nav 控制台。
.DESCRIPTION
  默认会**同时停用自启计划任务** —— 否则 5 分钟后的保活会把它又拉起来，
  「停了又活」会很困惑。重新启用请跑 start.ps1。
  服务（若曾用 install-service.ps1 装过）也一并停止。

.PARAMETER Port    控制台端口，默认 5175
.PARAMETER KeepAuto 保留自启任务启用状态（只停当前进程，下次保活会拉起）
.EXAMPLE
  powershell -File tools\console\launcher\stop.ps1
#>
param(
  [int]$Port = 5175,
  [switch]$KeepAuto
)
$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot 'lib.ps1')

$taskName = $script:NavTaskName
$serviceName = 'nav-console'
$didSomething = $false

# ---- 计划任务 ----
$task = Get-NavTask
if ($task -and -not $KeepAuto) {
  if ($task.State -ne 'Disabled') {
    Disable-ScheduledTask -TaskName $taskName | Out-Null
    Write-Host "[stop] 已停用计划任务 $taskName（防保活复活；用 start.ps1 重新启用）" -ForegroundColor Green
  } else {
    Write-Host "[stop] 计划任务 $taskName 已是停用状态"
  }
  $didSomething = $true
}

# ---- 旧的服务（若存在）----
if (Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue) {
  $nssm = Join-Path $PSScriptRoot 'nssm\nssm.exe'
  if (Test-Path $nssm) { [void](Invoke-Native $nssm @('stop', $serviceName)) }
  else { Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue }
  Write-Host "[stop] 已停止服务 $serviceName" -ForegroundColor Green
  $didSomething = $true
}

# ---- 占用端口的进程 ----
$conn = Get-PortListener -Port $Port
if ($conn) {
  $pid0 = $conn[0]
  $proc = Get-Process -Id $pid0 -ErrorAction SilentlyContinue
  Write-Host "[stop] 端口 $Port 被 PID $pid0 ($($proc.ProcessName)) 占用，清理..." -ForegroundColor Yellow
  & taskkill /PID $pid0 /T /F 2>$null | Out-Null
  Start-Sleep -Milliseconds 600
  if (Test-PortListening -Port $Port) {
    Write-Host "[stop] ⚠️  端口 $Port 仍未释放" -ForegroundColor Yellow
  } else {
    Write-Host "[stop] 端口 $Port 已释放" -ForegroundColor Green
  }
  $didSomething = $true
}

if (-not $didSomething) { Write-Host "[stop] 任务/服务未注册且端口 $Port 空闲，无需处理" }