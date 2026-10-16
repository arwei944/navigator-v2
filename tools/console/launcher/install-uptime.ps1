<#
.SYNOPSIS
  注册「本站可用性监测」计划任务：每 N 分钟探一次线上的 navigator-v2，掉线区间落盘。

.DESCRIPTION
  为什么是计划任务而不是常驻进程：
    · 与 nav-console 同一套理由 —— 本机 Administrator 账户没有密码，Windows 拒绝空密码
      账户做服务登录（1069 logon failure），所以用「登录自启 + 定时触发」代替服务；
    · 每次只探一次就退出（--samples 1），是幂等的观测动作，不需要看门狗守着；
    · 常驻进程反而更脆：崩了没人拉起，而计划任务由系统负责重来。

  每次执行 = 一次探测 + 一行 JSONL，落在 data/uptime.jsonl（该目录已 gitignore）。

  采样分辨率等于触发间隔：默认 5 分钟，所以掉线的起止时刻精度是 ±5 分钟。
  要做到更细就调小 -Interval（代价是日志长得更快，模块内部有 4 MiB 上限自动裁剪）。

.PARAMETER Interval  触发间隔（分钟），默认 5
.PARAMETER Uninstall 移除计划任务
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\console\launcher\install-uptime.ps1
  powershell -ExecutionPolicy Bypass -File tools\console\launcher\install-uptime.ps1 -Interval 2
  powershell -ExecutionPolicy Bypass -File tools\console\launcher\install-uptime.ps1 -Uninstall
#>
param(
  [int]$Interval = 5,
  [switch]$Uninstall
)
$ErrorActionPreference = "Stop"
$TaskName = "nav-uptime"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$Cli = Join-Path $Root "tools\cli\nav.mjs"

if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "已移除计划任务 $TaskName" -ForegroundColor Green
  } else {
    Write-Host "计划任务 $TaskName 本来就不存在" -ForegroundColor Yellow
  }
  return
}

if (-not (Test-Path $Cli)) { throw "找不到 CLI：$Cli" }
$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) { throw "PATH 里找不到 node，先确保 node 可用再注册任务" }

$action = New-ScheduledTaskAction -Execute $Node `
  -Argument "`"$Cli`" uptime watch --samples 1" `
  -WorkingDirectory $Root

# 登录即跑一次（catch 上一次关机期间的状态），之后按间隔重复
$triggers = @(
  (New-ScheduledTaskTrigger -AtLogOn),
  (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes $Interval))
)

# IgnoreNew：上一次还没探完就跳过这一轮，避免掉线时（单次最长 12s 超时）堆叠实例
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
  -Hidden

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings `
  -Description "探测 navigator-v2 线上可用性，掉线区间写入 data/uptime.jsonl（每 $Interval 分钟一次）" `
  -Force | Out-Null

Write-Host "已注册计划任务 $TaskName" -ForegroundColor Green
Write-Host "  执行：$Node `"$Cli`" uptime watch --samples 1"
Write-Host "  间隔：每 $Interval 分钟 + 登录时一次"
Write-Host "  日志：$Root\data\uptime.jsonl"
Write-Host ""
Write-Host "立即跑一次：  schtasks /Run /TN $TaskName"
Write-Host "看报告：      node tools/cli/nav.mjs uptime report --hours 24 --pretty"
Write-Host "移除：        powershell -ExecutionPolicy Bypass -File tools\console\launcher\install-uptime.ps1 -Uninstall"
