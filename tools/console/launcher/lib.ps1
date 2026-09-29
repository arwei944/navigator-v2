<#
  launcher 共享工具。
  被 ensure-console / install-autostart / start / stop / sync-shortcuts 等脚本点源引入。
#>

# 仓库根：本文件位于 tools\console\launcher
function Get-RepoRoot { Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) }

# 服务/计划任务上下文没有 TRAE 的 PATH，必须用系统安装的 node
function Get-ConsoleNode {
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
    throw '未找到系统安装的 node.exe。请先安装 Node.js（https://nodejs.org/）；计划任务不能用编辑器内置的 node。'
  }
  return $node
}

# 健康探测一律用 curl.exe：Invoke-WebRequest 会走系统代理，本地端口会误判超时
function Test-ConsoleHealthy([int]$Port = 5175) {
  $code = & curl.exe -s -o NUL -w "%{http_code}" --max-time 3 "http://127.0.0.1:$Port/" 2>$null
  return ($code -eq '200')
}

# 端口占用探测一律走 netstat：Get-NetTCPConnection 走 CIM，本机实测 34~40s，
# 而 netstat 只要 0.4s —— 保活脚本卡 35 秒才拉起控制台就是它干的。
function Get-PortListener([int]$Port) {
  $pids = @()
  foreach ($row in (netstat -ano | Select-String -Pattern (':{0}\s' -f $Port))) {
    $cols = $row.ToString().Trim() -split '\s+'
    if ($cols.Length -ge 5 -and $cols[-2] -eq 'LISTENING') { $pids += [int]$cols[-1] }
  }
  return ($pids | Select-Object -Unique)
}

# 最轻的一次性端口探测（TCP 连接 ~0.04s）：只回答「有没有人在听」
function Test-PortListening([int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try { $client.Connect('127.0.0.1', $Port); return $true }
  catch { return $false }
  finally { $client.Close() }
}

# 自己拼命令行调用原生程序：PS 5.1 传参会吞掉内嵌引号，
# 仓库路径含空格（C:\work\solo work\...）时会把 "…\server.mjs" 拆成 C:\work\solo
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

# 计划任务名（登录自启 + 保活，同一任务的两个触发器）
$script:NavTaskName = 'nav-console'

function Get-NavTask { Get-ScheduledTask -TaskName $script:NavTaskName -ErrorAction SilentlyContinue }

# 让计划任务立刻跑一次，并等控制台就绪。
# 为什么不直接 Start-Process 拉起：node 会继承调用方的 stdout 管道句柄，
# 在 `pnpm run console:start` 这种「管道 stdio」场景下 npm 永远等不到 EOF —— 表现为命令卡死
# （任务计划服务派生进程则完全脱离本终端句柄）。ensure-console.ps1 里的 Start-Process
# 只用于任务上下文（那里没有 npm 管道）。
function Start-NavTaskNow([int]$Port = 5175, [int]$TimeoutSec = 30) {
  & schtasks /run /tn $script:NavTaskName 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { return $false }
  for ($i = 0; $i -lt ($TimeoutSec * 2); $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-ConsoleHealthy -Port $Port) { return $true }
  }
  return $false
}