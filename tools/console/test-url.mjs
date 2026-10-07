/**
 * src/utils/url.js 用例：零依赖、不联网。
 *
 * 这里的核心不变式是：搜索框判断「这个域名是否已收录」与弹窗的重复校验
 * 必须得到同一个 host —— 否则用户会在搜索框看到「添加站点」，
 * 点进去却被弹窗拦下来说「该域名已收录」。
 * 运行：node tools/console/test-url.mjs
 */
import { normalizeUrl, hostOf, looksLikeUrl } from '../../src/utils/url.js'

let pass = 0
const failures = []

function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}

/* ---------------- normalizeUrl ---------------- */

eq(normalizeUrl('chat.openai.com'), 'https://chat.openai.com', '裸域名补上 https')
eq(normalizeUrl('https://a.com'), 'https://a.com', '已有协议不重复补')
eq(normalizeUrl('http://a.com'), 'http://a.com', 'http 协议保留')
eq(normalizeUrl('  spaced.com  '), 'https://spaced.com', '首尾空白被裁掉')
eq(normalizeUrl(''), '', '空串返回空串')
eq(normalizeUrl('   '), '', '纯空白返回空串')
eq(normalizeUrl(null), '', 'null 返回空串（不抛错）')
eq(normalizeUrl(undefined), '', 'undefined 返回空串（不抛错）')

/* ---------------- hostOf ---------------- */

eq(hostOf('chat.openai.com'), 'chat.openai.com', '裸域名取到自身')
eq(hostOf('https://www.example.com/path?x=1'), 'example.com', '去 www、丢路径与查询串')
eq(hostOf('WWW.Example.COM'), 'example.com', '大小写归一到小写')
eq(hostOf('example.io:8080/path'), 'example.io', '端口被丢掉')
eq(hostOf('192.168.1.1'), '192.168.1.1', 'IP 直连可取到 host')
eq(hostOf(''), '', '空串返回空串')
eq(hostOf('not a url'), '', '含空格的非法输入返回空串（不抛错）')
eq(hostOf(null), '', 'null 返回空串（不抛错）')

// 关键不变式：贴整条网址与贴裸域名，必须归到同一个 host
const forms = ['example.com', 'https://example.com', 'https://www.example.com', 'WWW.EXAMPLE.COM/a/b?c=1']
eq(new Set(forms.map(hostOf)).size, 1, '同一站点的各种写法归一到同一个 host')
eq(hostOf(forms[0]), 'example.com', '归一结果就是站点库里存的 url 形态')

// 站点库里存的是去协议、去 www 的形态，粘贴整条网址也要能对上
const stored = 'chat.openai.com'
eq(hostOf('https://chat.openai.com/c/abc'), hostOf(stored), '粘贴子页网址仍能命中已收录的主域名')

/* ---------------- looksLikeUrl ---------------- */

const yes = [
  'chat.openai.com',
  'www.example.com',
  'sub.domain.co.uk',
  'example.io:8080/path',
  'https://chat.openai.com/foo?x=1',
  'HTTP://EXAMPLE.COM',
  'a-b.example.com',
  'x1.example2.com',
]
for (const s of yes) ok(looksLikeUrl(s), `识别为网址：${s}`)

const no = [
  'chatgpt',
  '某某工具',
  'openai 中文',
  'a.b',
  '1.2',
  'example.c',
  '',
  '   ',
  'exa_mple.com',
  '-bad.com',
  'bad-.com',
  'example.com/path with space',
  '例子.中国',
]
for (const s of no) ok(!looksLikeUrl(s), `不识别为网址：${s || '(空串)'}`)

// 空格是「还在打字」的信号，不能一有空格就跳出添加入口
ok(!looksLikeUrl('chat. openai.com'), '域名中间有空格不识别')

eq(looksLikeUrl(null), false, 'null 返回 false（不抛错）')
eq(looksLikeUrl(undefined), false, 'undefined 返回 false（不抛错）')
eq(looksLikeUrl(123), false, '非字符串返回 false（不抛错）')

// 识别为网址的输入，必须能取出 host —— 否则「添加站点」会带着一个取不到域名的值打开弹窗
for (const s of yes) ok(hostOf(s) !== '', `识别为网址的输入都能取出 host：${s}`)

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ ${failures.length} 条断言失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 网址工具全部通过：${pass} 条断言`)