#!/usr/bin/env node
/**
 * 本机密钥端点（`api/_local-key.js`）的闸门自测：不联网、不起服务。
 *
 * 这个端点会**返回管理密钥明文**，所以它唯一的安全闸门 `isLocalRequest()` 必须被钉死。
 * 最要紧的一条是：**线上域名的 Host 绝不能通过** —— 否则任何人访问
 * `https://你的站点/api/_local-key` 就能拿到永久管理密钥。
 *
 * 覆盖：
 *   ① 回环 IP + 回环 Host → 放行
 *   ② 回环 IP + **线上 Host** → 拒绝（反向代理场景，本测试的核心）
 *   ③ **非回环 IP** + 回环 Host → 拒绝（Host 可以伪造，光看它不够）
 *   ④ IPv4-mapped IPv6（::ffff:127.0.0.1）与 [::1] 的形态归一
 *   ⑤ 端口、大小写、空值的处理
 */
import assert from 'node:assert/strict'
import { isLocalRequest } from '../../api/_local-key.js'

let pass = 0
let fail = 0
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass += 1 } catch (e) { console.log('  ✖ ' + name + ' — ' + e.message); fail += 1 }
}

/** 造一个最小的 req 形状 */
const req = (remoteAddress, host) => ({ socket: { remoteAddress }, headers: { host } })

/** 只替换 Host 跑一次 */
function withHost(remoteAddress, host) {
  return isLocalRequest(req(remoteAddress, host))
}

console.log('\n放行：两个条件都成立')
check('127.0.0.1 + 127.0.0.1', () => assert.equal(withHost('127.0.0.1', '127.0.0.1'), true))
check('127.0.0.1 + 127.0.0.1:4214（带端口）', () => assert.equal(withHost('127.0.0.1', '127.0.0.1:4214'), true))
check('127.0.0.1 + localhost', () => assert.equal(withHost('127.0.0.1', 'localhost'), true))
check('::1 + [::1]', () => assert.equal(withHost('::1', '[::1]'), true))
check('::ffff:127.0.0.1 + 127.0.0.1（IPv4-mapped 归一）', () => assert.equal(withHost('::ffff:127.0.0.1', '127.0.0.1'), true))
check('大小写不敏感（LOCALHOST）', () => assert.equal(withHost('127.0.0.1', 'LOCALHOST'), true))

console.log('\n拒绝：反向代理场景（本测试的核心）')
check('回环 IP + 线上域名 → 拒绝', () => {
  assert.equal(withHost('127.0.0.1', 'navigator-v2.bot-keep.xyz'), false)
})
check('回环 IP + 任意公网域名 → 拒绝', () => {
  for (const h of ['example.com', 'nav.example.org', 'myapp.vercel.app', 'localhost.example.com']) {
    assert.equal(withHost('127.0.0.1', h), false, `${h} 不该放行`)
  }
})
check('回环 IP + 空 Host → 拒绝（不猜）', () => {
  assert.equal(withHost('127.0.0.1', ''), false)
  assert.equal(withHost('127.0.0.1', undefined), false)
})

console.log('\n拒绝：来源不是回环')
check('非回环 IP + 回环 Host → 拒绝（Host 可以伪造）', () => {
  assert.equal(withHost('10.0.0.5', 'localhost'), false)
  assert.equal(withHost('172.17.0.1', '127.0.0.1'), false)
  assert.equal(withHost('192.168.1.20', 'localhost'), false)
})
check('公网 IP + 线上 Host → 拒绝', () => {
  assert.equal(withHost('203.0.113.7', 'navigator-v2.bot-keep.xyz'), false)
})
check('地址缺失 → 拒绝', () => {
  assert.equal(withHost('', 'localhost'), false)
  assert.equal(withHost(undefined, 'localhost'), false)
})
check('长得像但不相等（127.0.0.10 / sub.localhost）→ 拒绝', () => {
  assert.equal(withHost('127.0.0.10', '127.0.0.1'), false)
  assert.equal(withHost('127.0.0.1', 'sub.localhost'), false)
})

console.log('\n形状健壮性')
check('不因字段缺失而抛错（返回 false 即可）', () => {
  assert.equal(isLocalRequest({}), false)
  assert.equal(isLocalRequest({ headers: {} }), false)
  assert.equal(isLocalRequest({ socket: {} }), false)
})

console.log(`\n${fail === 0 ? '✅' : '❌'} 本机密钥闸门自测：${pass} 通过 / ${fail} 失败\n`)
process.exit(fail === 0 ? 0 : 1)
