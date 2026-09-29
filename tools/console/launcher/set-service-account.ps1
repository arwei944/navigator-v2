<#
.SYNOPSIS
  重新绑定 nav-console 服务的登录账户（不重装服务）。
.DESCRIPTION
  服务以「当前用户 + 密码」登录时，一旦 Windows 登录密码变更，服务会因登录失败而起不来。
  此时不必重装，跑本脚本重新写入凭据即可。

.PARAMETER Account   目标账户，默认 当前域\当前用户
.PARAMETER Password  账户密码；不传则交互输入
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\console\launcher\set-service-account.ps1
#>
param(
  [string]$Account,
  [string]$Password
)
$ErrorActionPreference = "Stop"

$serviceName = "nav-console"
$scriptDir = $PSScriptRoot
$nssm = Join-Path $scriptDir "nssm\nssm.exe"

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "[set-account] 需要管理员权限，正在提权..." -ForegroundColor Yellow
  $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
  if ($Account) { $argList += @('-Account', "`"$Account`"") }
  if ($Password) { $argList += @('-Password', "`"$Password`"") }
  $shell = if (Get-Command pwsh -ErrorAction SilentlyContinue) { 'pwsh' } else { 'powershell.exe' }
  Start-Process $shell -Verb RunAs -ArgumentList $argList
  exit 0
}

if (-not (Test-Path $nssm)) { throw "未找到 $nssm，请先运行 install-service.ps1" }
if (-not (Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue)) {
  throw "服务 $serviceName 未安装，请先运行 install-service.ps1"
}

$acct = if ($Account) { $Account } else { "$env:USERDOMAIN\$env:USERNAME" }
if (-not $Password) {
  $sec = Read-Host "请输入账户 $acct 的 Windows 登录密码" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { $Password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
if (-not $Password) { throw "密码为空，已中止" }

& $nssm set $serviceName ObjectName $acct $Password
if ($LASTEXITCODE -ne 0) { throw "写入服务账户失败，请确认账户名与密码" }
Write-Host "[set-account] 已更新服务登录账户: $acct" -ForegroundColor Green

& $nssm restart $serviceName 2>&1 | Out-Null
Start-Sleep -Seconds 2

$healthy = $false
for ($i = 0; $i -lt 30; $i++) {
  $code = & curl.exe -s -o NUL -w "%{http_code}" --max-time 3 "http://127.0.0.1:5175/" 2>$null
  if ($code -eq "200") { $healthy = $true; break }
  Start-Sleep -Seconds 1
}
if ($healthy) { Write-Host "[set-account] ✅ 服务已重启并就绪: http://127.0.0.1:5175" -ForegroundColor Green }
else { Write-Host "[set-account] ⚠️  重启后未就绪，请查看日志: $(Join-Path $scriptDir 'logs\svc-nav-console.log.err')" -ForegroundColor Yellow }