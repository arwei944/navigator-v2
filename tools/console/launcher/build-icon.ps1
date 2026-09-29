<#
.SYNOPSIS
  由 app-icon.svg 生成多尺寸 app.ico（快捷方式图标）。
.DESCRIPTION
  图标唯一真相源是 tools/console/ui/app-icon.svg —— 同一份 SVG 既作为控制台页面的
  favicon（Chrome app 窗口的任务栏图标取自它），又在这里渲染成 app.ico
  （桌面 / 任务栏快捷方式的图标）。改图标只改 SVG，两处自动同源。

  流程：render-icon.mjs 用本机 Chrome 无头渲染各尺寸 PNG（矢量直出，小尺寸不糊）
        → make-icon.mjs 打包成多尺寸 ICO。

.PARAMETER Svg   源 SVG（默认 tools\console\ui\app-icon.svg）
.PARAMETER Sizes 目标尺寸，逗号分隔（ICO 目录项上限 256）
.EXAMPLE
  powershell -File tools\console\launcher\build-icon.ps1
#>
param(
  [string]$Svg = (Join-Path $PSScriptRoot '..\ui\app-icon.svg'),
  [string]$Sizes = '16,24,32,48,64,128,256'
)
$ErrorActionPreference = "Stop"

if (-not (Test-Path $Svg)) { throw "未找到源 SVG: $Svg" }
$svg = (Resolve-Path $Svg).Path
$ico = Join-Path $PSScriptRoot 'app.ico'

$renderer = Join-Path $PSScriptRoot 'render-icon.mjs'
$packer = Join-Path $PSScriptRoot 'make-icon.mjs'

& node $renderer $svg $PSScriptRoot $Sizes
if ($LASTEXITCODE -ne 0) { throw "render-icon.mjs 失败" }

$pngs = @($Sizes.Split(',') | ForEach-Object { Join-Path $PSScriptRoot ("icon-{0}.png" -f $_.Trim()) })
$missing = @($pngs | Where-Object { -not (Test-Path $_) })
if ($missing.Count) { throw "缺少渲染产物: $($missing -join ', ')" }

& node $packer $ico @pngs
if ($LASTEXITCODE -ne 0) { throw "make-icon.mjs 失败" }

Write-Host "[build-icon] ✅ app.ico 就绪（$Sizes）" -ForegroundColor Green