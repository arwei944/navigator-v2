<#
.SYNOPSIS
  注册 nav 控制台「登录自启 + 保活」计划任务，并同步桌面/任务栏快捷方式。
.DESCRIPTION
  为什么不是 Windows 服务：本机 Administrator 账户**没有密码**，而 Windows 拒绝
  空密码账户做服务登录（sc start 报 1069 logon failure，即便已授予
  SeServiceLogonRight）。而控制台只监听 127.0.0.1 —— 登录前根本没人能用它，
  所以「登录自启」与「开机自启」在可用性上等价，且以交互用户身份运行能让
  控制台里的 git push 用上 Git Credential Manager 已存的凭据。

  任务 nav-console 挂两个触发器：
    - AtLogOn      ：登录即起
    - 每 5 分钟     ：兜底保活（调 ensure-console.ps1，健康时零成本退出）
  动作是幂等的 ensure-console.ps1，所以不需要常驻看门狗进程。

  想改回真正的服务（需要给账户设密码）：tools\console\launcher\install-service.ps1

.PARAMETER Port      控制台端口，默认 5175
.PARAMETER Uninstall 移除计划任务（保留快捷方式）
.PARAMETER Interval  保活间隔（分钟），默认 5
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\console\launcher\install-autostart.ps1
  powershell -ExecutionPolicy Bypass -File tools\console\launcher\install-autostart.ps1 -Uninstall
#>
param(
  [int]$Port = 5175,
  [int]$Interval = 5,
  [switch]$Uninstall
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot 'lib.ps1')

$taskName = $script:NavTaskName
$userId = "$env:USERDOMAIN\$env:USERNAME"

if ($Uninstall) {
  if (Get-NavTask) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "[autostart] 已移除计划任务 $taskName" -ForegroundColor Green
  } else {
    Write-Host "[autostart] 计划任务 $taskName 不存在，无需移除"
  }
  Write-Host "[autostart] 提示：如果之前装过同名服务，用 install-service.ps1 -Uninstall 清掉。"
  exit 0
}

# 同名服务与计划任务会互相抢 5175，先探测提醒
if (Get-CimInstance Win32_Service -Filter "Name='$taskName'" -ErrorAction SilentlyContinue) {
  Write-Host "⚠️  检测到同名 Windows 服务 $taskName，它和计划任务会抢 5175 端口。" -ForegroundColor Yellow
  Write-Host "    建议先卸载：tools\console\launcher\install-service.ps1 -Uninstall" -ForegroundColor Yellow
}

$node = Get-ConsoleNode
$ensure = Join-Path $PSScriptRoot 'ensure-console.ps1'
if (-not (Test-Path $ensure)) { throw "缺少 $ensure" }

$pwshExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$action = New-ScheduledTaskAction -Execute $pwshExe `
  -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Port {1} -Quiet' -f $ensure, $Port) `
  -WorkingDirectory (Get-RepoRoot)

$logon = New-ScheduledTaskTrigger -AtLogOn -User $userId
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).Date.AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $Interval) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)

$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($logon, $repeat) `
  -Settings $settings -Principal $principal -Force `
  -Description "nav-v2 本地运维控制台：登录自启 + 每 $Interval 分钟保活（仅监听 127.0.0.1:$Port）" | Out-Null

Write-Host "[autostart] ✅ 已注册计划任务 $taskName（登录自启 + 每 $Interval 分钟保活）" -ForegroundColor Green

# ---- 立即拉起一次，省得等到下次登录 ----
# 必须走计划任务：直接调 ensure-console.ps1 会让 node 继承本终端的 stdout 管道，
# 在 `pnpm run console:autostart` 下 npm 等不到 EOF，命令卡死且后面的快捷方式同步走不到。
if (Test-ConsoleHealthy -Port $Port) {
  Write-Host "[autostart] 控制台已在线"
} elseif (Start-NavTaskNow -Port $Port) {
  Write-Host "[autostart] 已由计划任务拉起控制台" -ForegroundColor Green
} else {
  Write-Host "[autostart] ⚠️  计划任务未能在 30s 内拉起，日志: $(Join-Path $PSScriptRoot 'logs\console.log.err')" -ForegroundColor Yellow
}

# ---- 同步快捷方式 ----
$sync = Join-Path $PSScriptRoot 'sync-shortcuts.ps1'
if (Test-Path $sync) { & $sync -Port $Port -RefreshExplorer }

$t = Get-NavTask
Write-Host ""
Write-Host "[autostart] 任务状态 : $($t.State) / 触发器 $($t.Triggers.Count) 个 / 运行身份 $($t.Principal.UserId)"
Write-Host "  立即启动 : powershell -File tools\console\launcher\start.ps1"
Write-Host "  临时停止 : powershell -File tools\console\launcher\stop.ps1   (会同时停用任务，防保活复活)"
Write-Host "  彻底移除 : powershell -File tools\console\launcher\install-autostart.ps1 -Uninstall"