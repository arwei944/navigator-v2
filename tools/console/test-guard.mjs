/**
 * api/metadata.js 的 SSRF 防护用例：确认内网 / 回环 / 链路本地地址一律被拒。
 * 运行：node tools/console/test-guard.mjs   （或 npm run console:test:guard）
 *
 * 这是面向公网的抓取代理，用户可指定任意 URL。不校验目标就等于把内网探测器
 * 交出去（169.254.169.254 云元数据、127.0.0.1 本机管理口）。零依赖、不联网。
 */
import { isBlockedHost } from '../../api/metadata.js'

let pass = 0
const failures = []

function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}

function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}

/* ---------------- 必须拒绝 ---------------- */

const BLOCKED = [
  'localhost', 'x.localhost',
  '127.0.0.1', '127.1.2.3', '0.0.0.0',
  '10.0.0.5', '172.16.9.9', '172.31.255.1', '192.168.1.1',
  '169.254.169.254', '100.64.0.1', '224.0.0.1',
  '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1',
  'metadata.google.internal', 'foo.local', 'bar.internal',
]
for (const h of BLOCKED) eq(isBlockedHost(h), true, `拒绝内网/本机地址 ${h}`)

/* ---------------- 必须放行 ---------------- */

const ALLOWED = ['example.com', 'chat.openai.com', '8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']
for (const h of ALLOWED) eq(isBlockedHost(h), false, `放行公网地址 ${h}`)

/* ---------------- URL 归一化 ---------------- */

// 十进制 / 十六进制写的回环地址会被 WHATWG URL 还原成点分十进制，校验才能生效
eq(isBlockedHost(new URL('http://2130706433/').hostname), true, '十进制 IP 经 URL 归一化后仍被拒')
eq(isBlockedHost(new URL('http://0x7f000001/').hostname), true, '十六进制 IP 经 URL 归一化后仍被拒')

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ ${failures.length} 条断言失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ metadata SSRF 防护全部通过：${pass} 条断言`)