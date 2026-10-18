/**
 * 分享目标门禁（G4 / L0-2）。
 *
 * 守两件事：
 *   ① `extractSharedUrl` 对各种真实分享填法都能取出正确的网址（各家 App 填法不同）；
 *   ② manifest 里确实声明了 share_target，且 action 指向站内已注册路由 ——
 *      声明了但路由不存在，用户在系统分享面板选完就落到 404。
 *
 * 零依赖纯 node，退出码语义：0 全过 / 1 有失败。
 */
import { readFileSync } from 'node:fs'
import { extractSharedUrl } from '../../src/utils/shareTarget.js'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

/* ---------------- ① 网址提取 ---------------- */
eq(extractSharedUrl({ url: 'https://example.com/a' }), 'https://example.com/a', 'url 参数直接采用')
eq(extractSharedUrl({ url: 'example.com' }), 'https://example.com', '裸域名补 https')
eq(extractSharedUrl({ url: 'example.com/path?q=1' }), 'https://example.com/path?q=1', '裸域名带路径保留')

// 只填 text 的分享源：正文里夹着链接
eq(extractSharedUrl({ text: '看这个 https://a.com/x 很好用' }), 'https://a.com/x', '从 text 里提取链接')
eq(extractSharedUrl({ title: 'https://b.com/title' }), 'https://b.com/title', '从 title 里提取链接')

// 末尾标点：分享正文里链接常被句号/括号包住
eq(extractSharedUrl({ text: '见 https://c.com/x。' }), 'https://c.com/x', '削掉末尾中文句号')
eq(extractSharedUrl({ text: '（https://d.com/y）' }), 'https://d.com/y', '削掉尾部括号')

// 优先级：url 参数优先于 text
eq(extractSharedUrl({ url: 'https://first.com', text: 'https://second.com' }), 'https://first.com', 'url 优先于 text')

// 取不到就返回空（由落地页给手动兜底，不编造）
eq(extractSharedUrl({ text: '没有链接的一句话' }), '', '无链接返回空串')
eq(extractSharedUrl({}), '', '空参数返回空串')
eq(extractSharedUrl(), '', '无参数不抛错')

/* ---------------- ② manifest 与路由一致 ---------------- */
{
  const vite = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf-8')
  ok(/share_target\s*:/.test(vite), 'manifest 声明了 share_target')
  ok(/action:\s*'\/share'/.test(vite), 'share_target.action 指向 /share')
  ok(/method:\s*'GET'/.test(vite), 'share_target 用 GET（零 SW 介入）')

  const router = readFileSync(new URL('../../src/router/index.js', import.meta.url), 'utf-8')
  ok(/path:\s*'\/share'/.test(router), '路由表注册了 /share（否则分享落地即 404）')
  ok(/ShareView\.vue/.test(router), '/share 指向 ShareView')
}

/* ---------------- 结果 ---------------- */
if (failures.length) {
  console.error(`\n❌ 分享目标门禁 ${failures.length} 条断言失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 分享目标门禁通过：${pass} 条断言`)
