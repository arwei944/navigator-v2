<#
.SYNOPSIS
  确保 nav 控制台在运行（幂等）。
.DESCRIPTION
  由计划任务 nav-console 调用（登录触发 + 每 5 分钟兜底）。刻意做成一次性且幂等：
  健康时零成本退出；发现没在跑才拉起。这样「保活」不需要常驻进程，
  也不会出现「手动 stop 后又被拉起」以外的副作用（stop.ps1 会同时停用任务）。

.PARAMETER Port  控制台端口，默认 5175
.PARAMETER Quiet 健康时不打印
.EXAMPLE
  powershell -File tools\console\launcher\ensure-console.ps1
#>
param(
  [int]$Port = 5175,
  [switch]$Quiet
)
$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot 'lib.ps1')

$root = Get-RepoRoot
$logDir = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

if (Test-PortListening -Port $Port) {
  if (Test-ConsoleHealthy -Port $Port) {
    if (-not $Quiet) { Write-Host "[ensure] 控制台在线 (:$Port)，无需处理" }
    exit 0
  }
  # 端口被别的进程占着但探活失败：不抢端口，避免误杀用户的东西
  $hp = Get-PortListener -Port $Port
  $hpTxt = if ($hp) { 'PID ' + ($hp -join ',') } else { 'PID 未知' }
  Write-Host "[ensure] 端口 $Port 被 $hpTxt 占用但探活失败，跳过"
  exit 1
}

$node = Get-ConsoleNode
$serverJs = Join-Path $root 'tools\console\server.mjs'
if (-not (Test-Path $serverJs)) { Write-Host "[ensure] 缺少入口: $serverJs"; exit 1 }

# 单引号包住含空格的脚本路径；Start-Process -WindowStyle Hidden 会把它原样拼进命令行
$argLine = '"{0}" --port {1} --strict-port' -f $serverJs, $Port
$outLog = Join-Path $logDir 'console.log'
$errLog = Join-Path $logDir 'console.log.err'

Start-Process -WindowStyle Hidden -FilePath $node -ArgumentList $argLine -WorkingDirectory $root `
  -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog | Out-Null

# 先等端口在听（TcpClient 探测 0.04s），再验 HTTP —— 端口未起时不做慢的 curl 探测
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  if ((Test-PortListening -Port $Port) -and (Test-ConsoleHealthy -Port $Port)) {
    Write-Host "[ensure] 已拉起控制台 http://127.0.0.1:$Port"
    exit 0
  }
}
Write-Host "[ensure] 拉起后 20s 内未就绪，请查看 $errLog"
exit 1