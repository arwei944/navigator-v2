<#
.SYNOPSIS
  同步 nav 控制台快捷方式：桌面 + 任务栏固定（两者内容一致）。
.DESCRIPTION
  参照 TokenRhythm-Batch-Manager 的 sync-shortcuts.ps1 处理方式：
  快捷方式固定指向 Chrome app 模式 http://127.0.0.1:5175 —— 控制台由 nav-console
  服务常驻（开机自启），所以点击即开，无需先起服务。
  任务栏固定项写在 User Pinned\TaskBar 目录；从无到有时需重启 explorer 才可见。

.PARAMETER Port            控制台端口，默认 5175（须与服务一致）
.PARAMETER RefreshExplorer 任务栏固定项新建时重启 explorer 使其立刻出现
.EXAMPLE
  powershell -File tools\console\launcher\sync-shortcuts.ps1 -RefreshExplorer
#>
param(
  [int]$Port = 5175,
  [switch]$RefreshExplorer
)
$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $scriptDir))
$icon = Join-Path $scriptDir "app.ico"
$url = "http://127.0.0.1:$Port"
$name = "Nav 控制台.lnk"

$chrome = @(
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $chrome) { throw "未找到 Chrome（Chrome app 模式快捷方式依赖 chrome.exe）" }

function Sync-Link([string]$lnkPath) {
  $ws = New-Object -ComObject WScript.Shell
  $sc = $ws.CreateShortcut($lnkPath)
  $sc.TargetPath = $chrome
  $sc.Arguments = "--app=$url"
  $sc.WorkingDirectory = $root
  $sc.Description = "nav 本地运维控制台"
  if (Test-Path $icon) { $sc.IconLocation = "$icon,0" }
  $sc.Save()
  Write-Host "[sync-shortcuts] OK: $lnkPath" -ForegroundColor Green
}

# ---- 桌面（当前用户）----
$desktop = [Environment]::GetFolderPath('Desktop')
if ($desktop -and (Test-Path $desktop)) {
  Sync-Link (Join-Path $desktop $name)
} else {
  Write-Host "[sync-shortcuts] WARNING: 未找到桌面目录" -ForegroundColor Yellow
}

# ---- 任务栏固定 ----
$taskbarDir = Join-Path $env:APPDATA "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
if (Test-Path $taskbarDir) {
  $tbLnk = Join-Path $taskbarDir $name
  $existed = Test-Path $tbLnk
  Sync-Link $tbLnk
  if (-not $existed) { $script:taskbarCreated = $true }
} else {
  Write-Host "[sync-shortcuts] WARNING: 任务栏固定目录不存在: $taskbarDir" -ForegroundColor Yellow
}

if ($RefreshExplorer -and $script:taskbarCreated) {
  Write-Host "[sync-shortcuts] 重启 explorer 刷新任务栏..." -ForegroundColor Yellow
  Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 800
  Start-Process explorer | Out-Null
}

if (-not (Test-Path $icon)) {
  Write-Host "[sync-shortcuts] 提示: 缺少图标 $icon，快捷方式将使用 Chrome 默认图标。" -ForegroundColor Yellow
}
Write-Host "[sync-shortcuts] 完成"