<#
.SYNOPSIS
  将 nav 本地运维控制台注册为 Windows 服务（NSSM 托管，开机自启）。
.DESCRIPTION
  参照 TokenRhythm-Batch-Manager 的 backend\launcher\install-service.ps1 处理方式：
    - NSSM 把 node 进程托管为服务，Start=SERVICE_AUTO_START，崩溃自动重启
    - 日志走文件 + 10MB 轮转，stdout/stderr 分文件
    - 服务以「当前用户 + 密码」登录（**不是** LocalSystem），
      这样服务上下文里的 Git Credential Manager 凭据可用，控制台内 git push 才能成功
    - 控制台以 --strict-port 固定 5175，避免端口漂移导致快捷方式指向空端口
  安装完成后自动同步桌面 + 任务栏快捷方式。

  注意：所有 nssm/sc 调用都走 Invoke-Native 自己拼命令行。PowerShell 5.1 的原生参数
  传递会吞掉内嵌引号，仓库路径含空格（`C:\work\solo work\...`）时会把
  `"...\server.mjs"` 拆成 `C:\work\solo`，node 报 MODULE_NOT_FOUND。

.PARAMETER Uninstall  卸载服务（保留快捷方式与日志）
.PARAMETER Account    服务登录账户，默认 当前域\当前用户
.PARAMETER Password   账户密码；不传则交互输入，账户无密码时传空串 ''
.PARAMETER NoAccount  保持 LocalSystem（不推荐：git push 会因缺凭据失败）
.PARAMETER Port       控制台端口，默认 5175

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\console\launcher\install-service.ps1
  powershell -ExecutionPolicy Bypass -File tools\console\launcher\install-service.ps1 -Uninstall
#>
param(
  [switch]$Uninstall,
  [string]$Account,
  [string]$Password,
  [switch]$NoAccount,
  [int]$Port = 5175
)
$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot                              # tools\console\launcher
$consoleDir = Split-Path -Parent $scriptDir              # tools\console
$root = Split-Path -Parent (Split-Path -Parent $consoleDir)  # 仓库根
$serviceName = "nav-console"
$logDir = Join-Path $scriptDir "logs"

function Write-Step($m) { Write-Host "[install-service] $m" }

# ---- 提权（TRBM 同款做法）----
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "[install-service] 需要管理员权限，正在提权..." -ForegroundColor Yellow
  $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
  if ($Uninstall) { $argList += '-Uninstall' }
  if ($NoAccount) { $argList += '-NoAccount' }
  if ($Account) { $argList += @('-Account', "`"$Account`"") }
  if ($PSBoundParameters.ContainsKey('Password')) { $argList += @('-Password', "`"$Password`"") }
  if ($PSBoundParameters.ContainsKey('Port')) { $argList += @('-Port', "$Port") }
  $shell = if (Get-Command pwsh -ErrorAction SilentlyContinue) { 'pwsh' } else { 'powershell.exe' }
  Start-Process $shell -Verb RunAs -ArgumentList $argList
  exit 0
}

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

# ---- 原生调用helper：自己拼命令行，绕开 PS 5.1 的引号吞并 ----
function Invoke-Native {
  param([string]$File, [string[]]$CmdArgs)
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $File
  $psi.Arguments = (@($CmdArgs | ForEach-Object {
        if ($_ -eq '' -or $_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
      }) -join ' ')
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $o = $p.StandardOutput.ReadToEnd()
  $e = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  if ($o -and $o.Trim()) { Write-Host $o.Trim() }
  if ($e -and $e.Trim()) { Write-Host $e.Trim() -ForegroundColor DarkYellow }
  return $p.ExitCode
}

# ---- NSSM 定位（项目内置优先，其次已知位置，最后按需下载）----
$nssm = Join-Path $scriptDir "nssm\nssm.exe"
if (-not (Test-Path $nssm)) {
  $src = @(
    (Join-Path $env:ProgramW6432 "nssm\nssm.exe"),
    'C:\tools\nssm\nssm.exe'
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($src) {
    New-Item -ItemType Directory -Path (Split-Path $nssm) -Force | Out-Null
    Copy-Item $src $nssm -Force
    Write-Step "NSSM 已复制到项目: $nssm"
  }
}
if (-not (Test-Path $nssm)) {
  Write-Step "未找到 nssm.exe，正在下载 nssm 2.24 ..."
  $zip = Join-Path $env:TEMP "nssm-2.24.zip"
  $tmp = Join-Path $env:TEMP "nssm-extract"
  try {
    Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile $zip -UseBasicParsing -TimeoutSec 60
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $exe = Get-ChildItem $tmp -Filter nssm.exe -Recurse | Where-Object { $_.FullName -match 'win64' } | Select-Object -First 1
    if (-not $exe) { $exe = Get-ChildItem $tmp -Filter nssm.exe -Recurse | Select-Object -First 1 }
    New-Item -ItemType Directory -Path (Split-Path $nssm) -Force | Out-Null
    Copy-Item $exe.FullName $nssm -Force
    Write-Step "NSSM 已下载到: $nssm"
  } catch {
    throw "NSSM 获取失败（可手动下载 https://nssm.cc/ 解压 win64\nssm.exe 到 $nssm）: $($_.Exception.Message)"
  }
}
Write-Step "使用 NSSM: $nssm"

function Nssm([string[]]$CmdArgs) { Invoke-Native -File $nssm -CmdArgs $CmdArgs }

function Get-ServiceSafe([string]$Name) {
  Get-CimInstance Win32_Service -Filter "Name='$Name'" -ErrorAction SilentlyContinue
}

# ---- 卸载分支 ----
if ($Uninstall) {
  if (Get-ServiceSafe $serviceName) {
    [void](Nssm @('stop', $serviceName))
    Start-Sleep -Milliseconds 800
    [void](Nssm @('remove', $serviceName, 'confirm'))
    Write-Step "已卸载服务 $serviceName"
  } else {
    Write-Step "服务 $serviceName 不存在，无需卸载"
  }
  Write-Host "[install-service] 卸载完成（快捷方式与日志保留）。" -ForegroundColor Green
  exit 0
}

# ---- Node 定位：服务上下文没有 TRAE 的 PATH，必须用系统安装的 node ----
$node = @(
  'C:\Program Files\nodejs\node.exe',
  'C:\Program Files (x86)\nodejs\node.exe',
  (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $node) {
  $cand = (Get-Command node -ErrorAction SilentlyContinue).Source
  if ($cand -and $cand -notmatch 'TRAE SOLO') { $node = $cand }
}
if (-not $node) {
  throw "未找到系统安装的 node.exe。请先安装 Node.js（https://nodejs.org/），服务不能用编辑器内置的 node。"
}
Write-Step "使用 Node: $node"

$serverJs = Join-Path $consoleDir "server.mjs"
if (-not (Test-Path $serverJs)) { throw "未找到控制台入口: $serverJs" }

# ---- 登录账户 ----
$acct = $Account
if (-not $acct -and -not $NoAccount) { $acct = "$env:USERDOMAIN\$env:USERNAME" }
$pwd = $Password
# 用 ContainsKey 而不是判空：账户本身无密码时必须支持显式传 -Password ''（否则会误触发交互）
if ($acct -and -not $PSBoundParameters.ContainsKey('Password')) {
  Write-Host ""
  Write-Host "[install-service] 服务将以账户 $acct 登录（保证 Git 凭据可用）。" -ForegroundColor Cyan
  $sec = Read-Host "请输入该账户的 Windows 登录密码（账户无密码则直接回车）" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { $pwd = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
if ($null -eq $pwd) { $pwd = '' }

# ---- 创建/更新服务 ----
$exists = Get-ServiceSafe $serviceName
if ($exists) {
  Write-Step "服务 $serviceName 已存在，停止后更新..."
  [void](Nssm @('stop', $serviceName))
  Start-Sleep -Milliseconds 800
} else {
  Write-Step "创建服务 $serviceName ..."
  $rc = Nssm @('install', $serviceName, $node)
  if ($rc -ne 0) { throw "nssm install $serviceName 失败 (exit $rc)" }
}

$appParams = "`"$serverJs`" --port $Port --strict-port"
[void](Nssm @('set', $serviceName, 'AppDirectory', $root))
[void](Nssm @('set', $serviceName, 'AppParameters', $appParams))
[void](Nssm @('set', $serviceName, 'DisplayName', 'Nav 本地运维控制台'))
[void](Nssm @('set', $serviceName, 'Description', "nav-v2 本地运维控制台（仅监听 127.0.0.1:$Port）"))
[void](Nssm @('set', $serviceName, 'Start', 'SERVICE_AUTO_START'))
[void](Nssm @('set', $serviceName, 'AppExit', 'Default', 'Restart'))
[void](Nssm @('set', $serviceName, 'AppRestartDelay', '5000'))
[void](Nssm @('set', $serviceName, 'AppThrottle', '5000'))
[void](Nssm @('set', $serviceName, 'AppStopMethodConsole', '1500'))

$svcOut = Join-Path $logDir "svc-$serviceName.log"
$svcErr = Join-Path $logDir "svc-$serviceName.log.err"
[void](Nssm @('set', $serviceName, 'AppStdout', $svcOut))
[void](Nssm @('set', $serviceName, 'AppStderr', $svcErr))
[void](Nssm @('set', $serviceName, 'AppStdoutCreationDisposition', '4'))
[void](Nssm @('set', $serviceName, 'AppStderrCreationDisposition', '4'))
[void](Nssm @('set', $serviceName, 'AppRotateFiles', '1'))
[void](Nssm @('set', $serviceName, 'AppRotateBytes', '10485760'))
[void](Nssm @('set', $serviceName, 'AppRotateOnline', '1'))

# ObjectName 走 sc.exe：NSSM 拒绝空密码，而本机 Administrator 账户本身无密码
if ($acct) {
  $sc = Join-Path $env:SystemRoot 'System32\sc.exe'
  $rc = Invoke-Native -File $sc -CmdArgs @('config', $serviceName, 'obj=', $acct, 'password=', $pwd)
  if ($rc -ne 0) {
    Write-Host "⚠️  服务账户设置失败（exit $rc）：请确认账户名与密码（域账户写成 DOMAIN\user）。" -ForegroundColor Yellow
    Write-Host "    服务将继续以 LocalSystem 运行；控制台内 git push 可能因缺少凭据失败。" -ForegroundColor Yellow
  } else {
    Write-Step "服务登录账户: $acct"
  }
} else {
  Write-Host "⚠️  服务将以 LocalSystem 运行：控制台内的 git push 可能因缺少凭据失败。" -ForegroundColor Yellow
}

# ---- 启动并验证（用 curl.exe：PowerShell 的 Invoke-WebRequest 会走系统代理误判本地端口）----
Write-Step "启动服务..."
[void](Nssm @('start', $serviceName))

$healthy = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 1
  $code = & curl.exe -s -o NUL -w "%{http_code}" --max-time 3 "http://127.0.0.1:$Port/" 2>$null
  if ($code -eq "200") { $healthy = $true; break }
}

$svcNow = Get-ServiceSafe $serviceName
Write-Host ""
if ($healthy) {
  Write-Host "[install-service] ✅ 控制台已就绪: http://127.0.0.1:$Port" -ForegroundColor Green
} else {
  Write-Host "[install-service] ⚠️  40s 内未就绪（State=$($svcNow.State)）。日志: $svcErr" -ForegroundColor Yellow
  Write-Host "                 常见原因：端口 $Port 被占用、服务账户无法登录、.env.local 缺失。" -ForegroundColor Yellow
}
Write-Host "  服务状态 : $($svcNow.State) / $($svcNow.StartMode) / 登录账户 $($svcNow.StartName)"

# ---- 同步快捷方式 ----
$sync = Join-Path $scriptDir "sync-shortcuts.ps1"
if (Test-Path $sync) {
  & (Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe") -NoProfile -ExecutionPolicy Bypass -File $sync -RefreshExplorer
}

Write-Host ""
Write-Host "[install-service] 安装完成" -ForegroundColor Green
Write-Host "  服务名 : $serviceName  (开机自启 / 崩溃自动重启)"
Write-Host "  访问   : http://127.0.0.1:$Port"
Write-Host "  日志   : $svcOut"
Write-Host "  重启   : & '$nssm' restart $serviceName"
Write-Host "  停止   : powershell -File tools\console\launcher\stop.ps1"
Write-Host "  卸载   : powershell -File tools\console\launcher\install-service.ps1 -Uninstall"