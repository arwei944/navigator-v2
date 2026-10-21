/**
 * 版本号递增门禁：发布脚本会在构建前调用它，错了会把线上版本写乱。
 */
import assert from 'node:assert/strict'
import { parseVersion, bumpVersion } from '../../shared/version-bump.mjs'

let pass = 0
let fail = 0
function ok(name, fn) {
  try { fn(); pass += 1; console.log(`  ✓ ${name}`) }
  catch (e) { fail += 1; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

console.log('版本号递增')

ok('解析三段 semver', () => {
  assert.deepEqual(parseVersion('3.1.0'), { major: 3, minor: 1, patch: 0 })
  assert.deepEqual(parseVersion('0.0.1'), { major: 0, minor: 0, patch: 1 })
})

ok('允许预发布 / 构建后缀', () => {
  assert.deepEqual(parseVersion('3.1.0-beta.2'), { major: 3, minor: 1, patch: 0 })
  assert.deepEqual(parseVersion('3.1.0+build.7'), { major: 3, minor: 1, patch: 0 })
})

ok('无法识别的版本返回 null，不编造', () => {
  assert.equal(parseVersion('3.1'), null)
  assert.equal(parseVersion('v3.1.0'), null)
  assert.equal(parseVersion(''), null)
  assert.equal(parseVersion(null), null)
})

ok('patch +1', () => {
  assert.equal(bumpVersion('3.1.0', 'patch'), '3.1.1')
  assert.equal(bumpVersion('3.1.9', 'patch'), '3.1.10')
})

ok('minor +1 并清零 patch', () => {
  assert.equal(bumpVersion('3.1.4', 'minor'), '3.2.0')
})

ok('major +1 并清零', () => {
  assert.equal(bumpVersion('3.1.4', 'major'), '4.0.0')
})

ok('默认按 patch 递增', () => {
  assert.equal(bumpVersion('1.2.3'), '1.2.4')
})

ok('带后缀的版本递增后回到干净三段', () => {
  assert.equal(bumpVersion('1.2.3-beta.1', 'patch'), '1.2.4')
})

ok('非法版本返回 null', () => {
  assert.equal(bumpVersion('abc'), null)
  assert.equal(bumpVersion('1.2', 'minor'), null)
})

ok('不修改输入', () => {
  const input = '3.1.0'
  bumpVersion(input, 'major')
  assert.equal(input, '3.1.0')
})

console.log(`\n结果：${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)