#!/usr/bin/env node
/**
 * 开发流水线自测：纯函数为主，不联网、不起子进程。
 *
 * 覆盖：
 *   ① 步骤定义完整（10 步、key 唯一、顺序即流程）
 *   ② planSteps 的三态：pending / 按选项 skipped
 *   ③ 跳过只影响对应步骤，不误伤别的
 *   ④ **日志标记 → 步骤推进**（这条最要紧）：deploy.mjs 的 `· xxx` 行必须被认出来 ——
 *      万一那边改了字样，这里立刻红，而不是流水线静默地不再推进步骤
 *   ⑤ preflight 的形状与阻塞项
 */
import assert from 'node:assert/strict'
import { planSteps, isSkipped, markerKeyOf, STEP_DEFS, preflight } from './lib/release.mjs'

let pass = 0
let fail = 0
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass += 1 } catch (e) { console.log('  ✖ ' + name + ' — ' + e.message); fail += 1 }
}
async function checkAsync(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); pass += 1 } catch (e) { console.log('  ✖ ' + name + ' — ' + e.message); fail += 1 }
}

const KEYS = ['check', 'test', 'commit', 'push', 'build', 'gate', 'pack', 'upload', 'restart', 'verify']

async function main() {
  console.log('\n步骤定义')
  check('恰好 10 步且顺序即流程', () => {
    assert.deepEqual(STEP_DEFS.map(s => s.key), KEYS)
  })
  check('key 不重复', () => {
    assert.equal(new Set(STEP_DEFS.map(s => s.key)).size, STEP_DEFS.length)
  })
  check('每步都有 label 与 role', () => {
    for (const s of STEP_DEFS) {
      assert.ok(s.label, `${s.key} 缺 label`)
      assert.ok(s.role, `${s.key} 缺 role`)
    }
  })
  check('可跳过的步骤才带 flag（commit 刻意不带 —— 它按有无改动运行时判断）', () => {
    const withFlag = STEP_DEFS.filter(s => s.flag).map(s => s.key)
    assert.deepEqual(withFlag.sort(), ['build', 'push', 'test'])
    assert.ok(!STEP_DEFS.find(s => s.key === 'commit').flag)
  })

  console.log('\n计划的三态')
  check('默认：全部 pending，没有任何 skipped', () => {
    const steps = planSteps()
    assert.equal(steps.length, 10)
    assert.ok(steps.every(s => s.status === 'pending'), JSON.stringify(steps.map(s => [s.key, s.status])))
  })
  check('skipTest → test 标 skipped，且 note 说明是哪个开关', () => {
    const s = planSteps({ skipTest: true }).find(x => x.key === 'test')
    assert.equal(s.status, 'skipped')
    assert.match(s.note, /--skip-test/)
    assert.ok(planSteps({ skipTest: true }).find(x => x.key === 'push').status === 'pending')
  })
  check('noPush → push 标 skipped', () => {
    const steps = planSteps({ noPush: true })
    assert.equal(steps.find(x => x.key === 'push').status, 'skipped')
    assert.equal(steps.find(x => x.key === 'test').status, 'pending')
  })
  check('skipBuild → build 标 skipped', () => {
    const steps = planSteps({ skipBuild: true })
    assert.equal(steps.find(x => x.key === 'build').status, 'skipped')
    assert.match(steps.find(x => x.key === 'build').note, /--skip-build/)
  })
  check('三个开关可同时生效，其余步骤不受影响', () => {
    const steps = planSteps({ skipTest: true, noPush: true, skipBuild: true })
    const skipped = steps.filter(s => s.status === 'skipped').map(s => s.key).sort()
    assert.deepEqual(skipped, ['build', 'push', 'test'])
    assert.ok(steps.filter(s => s.status === 'pending').length === 7)
  })
  check('isSkipped 与计划一致', () => {
    assert.equal(isSkipped('test', { skipTest: true }), true)
    assert.equal(isSkipped('test', {}), false)
    assert.equal(isSkipped('gate', { skipTest: true }), false, 'gate 不可跳过')
    assert.equal(isSkipped('不存在的步骤', { skipTest: true }), false)
  })

  console.log('\n日志标记 → 步骤推进（防日志格式漂移）')
  check('真实日志行都能认出来', () => {
    const cases = [
      ['· 构建产物', 'build', false],
      ['\n· 发布门禁', 'gate', false],
      ['\n· 打包', 'pack', false],
      ['\n· 上传分片', 'upload', false],
      ['\n· 触发容器解压', 'restart', false],
      ['\n· 等待线上就绪并验证版本', 'verify', false],
      ['· 跳过构建（复用现有 dist）', 'build', true],
    ]
    for (const [line, key, skip] of cases) {
      const m = markerKeyOf(line)
      assert.ok(m, `没认出：${JSON.stringify(line)}`)
      assert.equal(m.key, key, `${line} 认成了 ${m.key}，应为 ${key}`)
      assert.equal(m.skip, skip, `${line} 的 skip 标记不对`)
    }
  })
  check('无关日志返回 null（不能把普通输出当成步骤推进）', () => {
    for (const line of ['$ tar -cf app.tar -C stage .', '包体 8.65 MiB', '  ✓ a.paa', '切成 3 片：a.paa 3.50M', '', '   ']) {
      assert.equal(markerKeyOf(line), null, `不该认：${JSON.stringify(line)}`)
    }
  })
  check('容易混淆的相邻标记各归各位', () => {
    assert.equal(markerKeyOf('· 打包').key, 'pack')
    assert.equal(markerKeyOf('· 上传分片').key, 'upload')
    assert.equal(markerKeyOf('· 触发容器解压').key, 'restart')
  })
  check('标记覆盖面完整 —— 部署段 6 个步骤都有对应标记', () => {
    const covered = new Set(['build', 'gate', 'pack', 'upload', 'restart', 'verify'].map(k => markerKeyOf(
      { build: '· 构建产物', gate: '· 发布门禁', pack: '· 打包', upload: '· 上传分片', restart: '· 触发容器解压', verify: '· 等待线上就绪并验证版本' }[k],
    )?.key))
    assert.deepEqual([...covered].sort(), ['build', 'gate', 'pack', 'restart', 'upload', 'verify'])
  })

  console.log('\n预检（preflight）')
  await checkAsync('返回计划 / 阻塞项 / 事实三部分，形状稳定', async () => {
    const p = await preflight({ skipTest: true })
    assert.deepEqual(p.steps.map(s => s.key), KEYS)
    assert.equal(p.steps.find(s => s.key === 'test').status, 'skipped')
    assert.ok(Array.isArray(p.blockers), 'blockers 必须是数组')
    assert.ok(Array.isArray(p.plan) && p.plan.length >= 6, 'plan 至少 6 行')
    for (const f of ['branch', 'dirty', 'staged', 'ahead']) {
      assert.ok(f in p.facts, `facts 缺 ${f}`)
    }
  })
  await checkAsync('在真仓库里能读到分支与领先数（不是空壳）', async () => {
    const p = await preflight()
    assert.ok(p.facts.branch, '读不到分支 —— git 状态解析可能坏了')
    assert.ok(p.facts.ahead >= 0)
  })
  await checkAsync('阻塞项文案可读（有则必须是字符串，不是 undefined）', async () => {
    const p = await preflight()
    for (const b of p.blockers) {
      assert.equal(typeof b, 'string')
      assert.ok(b.length > 4, `阻塞项文案太短：${b}`)
      assert.ok(!/undefined|NaN/.test(b), `文案里有 undefined/NaN：${b}`)
    }
  })

  console.log(`\n${fail === 0 ? '✅' : '❌'} 通过 ${pass} / 失败 ${fail}\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(e => { console.error('FATAL', e); process.exit(2) })
