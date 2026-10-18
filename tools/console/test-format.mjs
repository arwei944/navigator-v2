#!/usr/bin/env node
/**
 * 格式化门禁：时间 / 字节 / 时长 / 耗时的展示实现只许住在 `shared/format.mjs`
 * （前端经 `src/utils/format.js` 转发，控制台与 CLI 直接取）。
 *
 * 背景：这些实现曾散落在 11+ 个组件里各写一份 —— `fmt(ts)` 逐字相同的就有 4 份，
 * 另有 2 份同族却漏了非法输入护栏，加上 6 处内联（构建时间 / 体检时间 / 同步时间）。
 * 改一处格式要翻遍 admin 面板，新写的总会漏点护栏。
 *
 * 守两条不变量：
 *   1. `format.js` 导出完整函数集（防误删 / 误改签名）；
 *   2. `src/` 内不再出现「另一份实现」的指纹（防复发）。
 *
 * 刻意不在指纹内的：
 *   - `total.toLocaleString('zh-CN')` —— 数字千分位，不是时间格式化；
 *   - `fmtVal`（预检字段值可读化）—— 数组/布尔/空值的展示规则，与通用格式化无关。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
let pass = 0
const failures = []
function ok(cond, label, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${label}${extra ? ` → ${extra}` : ''}`) }
  else { failures.push(`${label}${extra ? ` — ${extra}` : ''}`); console.log(`  ❌ ${label}${extra ? ` → ${extra}` : ''}`) }
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(vue|js|mjs)$/.test(e.name)) out.push(p)
  }
  return out
}

const rel = (f) => f.replace(/\\/g, '/').replace(ROOT.replace(/\\/g, '/'), '')

console.log('── 格式化函数唯一入口 ──')

const implPath = join(ROOT, 'shared', 'format.mjs')
const fwdPath = join(ROOT, 'src', 'utils', 'format.js')
if (!existsSync(implPath)) {
  ok(false, 'shared/format.mjs（唯一实现）存在', '缺实现')
} else {
  ok(existsSync(fwdPath) && /from\s+['"]\.\.\/\.\.\/shared\/format\.mjs['"]/.test(readFileSync(fwdPath, 'utf8')),
    'src/utils/format.js 转发到 shared/format.mjs（前端入口）')

  // 1. 导出完整函数集
  const src = readFileSync(implPath, 'utf8')
  const EXPORTS = [
    'fmtDateTime', 'fmtDateTimeSec', 'fmtDateTimeShort', 'fmtDateTimeCompact',
    'fmtClockTime', 'fmtRelative', 'fmtBytes', 'fmtDurationZh', 'fmtMillis',
  ]
  const missing = EXPORTS.filter((f) => !new RegExp(`export function ${f}\\b`).test(src))
  ok(missing.length === 0, `shared/format.mjs 导出 ${EXPORTS.length} 个格式化函数`,
    missing.length ? `缺 ${missing.join(' ')}` : '')

  // 2. src/ 与 tools/ 的运行代码里不得再有另一份实现
  // 扫描范围刻意排除了 test-*.mjs（断言里的字面量不是实现）与 shared/（那是实现处）。
  const SCAN_DIRS = ['src', 'tools/console/ui', 'tools/console/lib', 'tools/cli/commands']
  const WHITELIST = new Set([
    'src/utils/bgmScore.js',            // fmtClock：mm:ss 音乐播放进度，test-bgm 的契约
    'tools/console/ui/deploypanel.js',  // ago()：部署距今，round 取整且无 30 天上限，与 fmtRelative 不同
  ])
  const FINGERPRINTS = [
    [/new Date\([^)]*\)\.toLocaleString/g, '内联 Date.toLocaleString → 走 fmtDateTime 系列'],
    [/toLocaleString\(\s*'zh-CN',\s*\{\s*hour12/g, '内联 24h 本地化 → 走 fmtDateTimeSec / fmtDateTimeCompact'],
    [/toLocaleDateString\(/g, '内联 toLocaleDateString → 走 fmtRelative 的 fallback'],
    [/分钟前|小时前/g, '内联相对时间文案 → 走 fmtRelative'],
    [/toFixed\(1\)\}\s*KB|toFixed\(1\)\s*\+\s*' KB'/g, '内联字节拼接 → 走 fmtBytes'],
    // fmtVal 是预检字段值可读化（数组/布尔/空值），与通用格式化无关，刻意放行
    [/function\s+(fmt(?!Val\b)\w*|kb|sec|formatTime|formatDate)\s*\(/g, '新定义本地格式化函数 → shared/format.mjs 已有'],
  ]
  const hits = []
  for (const dir of SCAN_DIRS) {
    for (const f of walk(join(ROOT, dir))) {
      const r = rel(f)
      if (WHITELIST.has(r) || /[/\\]test-/.test(f) || r.endsWith('src/utils/format.js')) continue
      const s = readFileSync(f, 'utf8')
      for (const [re, why] of FINGERPRINTS) {
        for (const m of s.matchAll(re)) hits.push(`${r}: ${m[0].slice(0, 50)} ← ${why}`)
      }
    }
  }
  ok(hits.length === 0, 'src/ 与 tools/ 运行代码内无散落的格式化实现指纹',
    hits.length ? `\n      ${hits.join('\n      ')}` : '')

  // 3. 三方都有引用（不是建了没人用）
  const frontRefs = walk(join(ROOT, 'src'))
    .filter((f) => !rel(f).endsWith('src/utils/format.js'))
    .filter((f) => /from\s+['"]@\/utils\/format['"]/.test(readFileSync(f, 'utf8')))
  ok(frontRefs.length >= 10, '前端有 ≥10 个模块从 @/utils/format 取', `实得 ${frontRefs.length}`)

  const toolRefs = SCAN_DIRS.slice(1)
    .flatMap((d) => walk(join(ROOT, d)))
    .filter((f) => !/[/\\]test-/.test(f))
    .filter((f) => /from\s+['"](\/shared\/format\.mjs|.*\.\.\/\.\.\/\.\.\/shared\/format\.mjs)['"]/.test(readFileSync(f, 'utf8')))
  ok(toolRefs.length >= 8, '控制台 / CLI 有 ≥8 处从 shared/format.mjs 取', `实得 ${toolRefs.length}`)

  // 4. 契约文档写明了入口（改格式的人找得到真值在哪）
  const contract = join(ROOT, 'docs', 'VISUAL.md')
  ok(existsSync(contract) && /shared\/format\.mjs/.test(readFileSync(contract, 'utf8')),
    'docs/VISUAL.md 写明了展示格式的真值来源')
}

if (failures.length) {
  console.error(`\n❌ 格式化门禁 ${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.forEach((f) => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 格式化门禁通过：${pass} 条断言`)
