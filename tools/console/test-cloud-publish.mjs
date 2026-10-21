/**
 * 发布模式的门禁：默认必须安全，实时模式必须同时满足「已登录 / 有草稿 / 不在发布中」。
 */
import assert from 'node:assert/strict'
import {
  PUBLISH_MODE, parsePublishMode, shouldAutoPublish, publishSummary,
} from '../../shared/cloud-publish.mjs'

let pass = 0
let fail = 0
function ok(name, fn) {
  try { fn(); pass += 1; console.log(`  ✓ ${name}`) }
  catch (e) { fail += 1; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

console.log('发布模式')

ok('无法识别的值一律回到手动（安全默认）', () => {
  assert.equal(parsePublishMode(''), PUBLISH_MODE.MANUAL)
  assert.equal(parsePublishMode('auto'), PUBLISH_MODE.MANUAL)
  assert.equal(parsePublishMode(null), PUBLISH_MODE.MANUAL)
  assert.equal(parsePublishMode(undefined), PUBLISH_MODE.MANUAL)
})

ok('只有 realtime 被识别为实时', () => {
  assert.equal(parsePublishMode('realtime'), PUBLISH_MODE.REALTIME)
  assert.equal(parsePublishMode('REALTIME'), PUBLISH_MODE.MANUAL)
})

ok('手动模式从不自动发布', () => {
  const r = shouldAutoPublish({ mode: 'manual', hasKey: true, hasChanges: true })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'manual')
})

ok('实时模式需要管理凭据', () => {
  const r = shouldAutoPublish({ mode: 'realtime', hasKey: false, hasChanges: true })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'no-key')
})

ok('实时模式没有草稿时不发请求', () => {
  const r = shouldAutoPublish({ mode: 'realtime', hasKey: true, hasChanges: false })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'no-changes')
})

ok('发布中不重入', () => {
  const r = shouldAutoPublish({ mode: 'realtime', hasKey: true, hasChanges: true, busy: true })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'busy')
})

ok('条件齐全时才自动发布', () => {
  const r = shouldAutoPublish({ mode: 'realtime', hasKey: true, hasChanges: true })
  assert.equal(r.ok, true)
})

ok('摘要区分手动与实时', () => {
  assert.match(publishSummary({ version: 4, sites: 224, mode: 'realtime' }), /实时发布 · v4 · 224 站点/)
  assert.match(publishSummary({ version: 4, sites: 224, mode: 'manual' }), /手动发布 · v4 · 224 站点/)
})

console.log(`\n结果：${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)