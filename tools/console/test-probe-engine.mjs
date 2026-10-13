#!/usr/bin/env node
/**
 * 探针注册表（热拔插）自测：不联网（除最后两条端到端跑本地回环）。
 *
 * 覆盖：
 *   ① 注册校验（缺 id / 缺 run 抛错）
 *   ② probeChain 的配置优先级与容错（换序 / 裁剪 / 全不匹配回退 / none 清空 / available 过滤）
 *   ③ **runProbe 的核心语义**：拿到 code 就停（哪怕 ERR），只有「探针不可用」才换下一个
 *   ④ 内建两探针在清单里（curl-http / fetch-http）
 *   ⑤ 端到端：curl 探针真探本地服务；fetch 探针的 SSRF 防护对内网地址生效
 *   ⑥ 回归：定性口径仍从 health-probe 导出（verdictOf / STATUS_LABEL）
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { registerProbe, listProbes, probeChain, runProbe } from '../../shared/probe-engine.mjs'
import { verdictOf, STATUS_LABEL } from '../../shared/health-probe.mjs'

let pass = 0
let fail = 0
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass += 1 } catch (e) { console.log('  ✖ ' + name + ' — ' + e.message); fail += 1 }
}
async function checkAsync(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); pass += 1 } catch (e) { console.log('  ✖ ' + name + ' — ' + e.message); fail += 1 }
}

const fake = (id, fn) => ({ id, run: fn })

/** 起一个只回 204 的本地服务 */
async function withServer(run) {
  const server = http.createServer((req, res) => { res.writeHead(204); res.end() })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  try {
    return await run(`http://127.0.0.1:${server.address().port}/`)
  } finally {
    if (server.closeAllConnections) server.closeAllConnections()
    await new Promise(r => server.close(r))
  }
}

async function main() {
  console.log('\n注册表校验')
  check('缺 id 抛错', () => { assert.throws(() => registerProbe({ run: () => ({ code: '200' }) })) })
  check('缺 run 抛错', () => { assert.throws(() => registerProbe({ id: 'x-norun' })) })

  console.log('\n链路配置（probeChain）')
  check('显式列表决定顺序（换序生效）', () => {
    assert.deepEqual(probeChain('fetch-http,curl-http').map(p => p.id), ['fetch-http', 'curl-http'])
  })
  check('裁剪：只留一个', () => {
    assert.deepEqual(probeChain('fetch-http').map(p => p.id), ['fetch-http'])
  })
  check('全不匹配回退全量（不静默清空）', () => {
    const ids = probeChain('a,b,c').map(p => p.id)
    assert.ok(ids.includes('fetch-http'), '至少应有跨平台探针')
  })
  check('none 显式清空', () => {
    assert.deepEqual(probeChain('none'), [])
    assert.deepEqual(probeChain('off'), [])
  })
  check('available 过滤生效：过滤后只剩当前环境可用的探针', () => {
    const ids = probeChain('').map(p => p.id)
    assert.ok(ids.includes('fetch-http'))
    // curl-http 只在 win32 可用；此断言对两种平台都成立
    if (process.platform !== 'win32') assert.ok(!ids.includes('curl-http'))
  })
  check('env 未设时不受影响（显式参数优先）', () => {
    const old = process.env.NAV_HEALTH_PROBES
    process.env.NAV_HEALTH_PROBES = 'fetch-http'
    assert.deepEqual(probeChain('curl-http').map(p => p.id), ['curl-http'])
    assert.deepEqual(probeChain().map(p => p.id), ['fetch-http'])
    if (old === undefined) delete process.env.NAV_HEALTH_PROBES; else process.env.NAV_HEALTH_PROBES = old
  })

  console.log('\nrunProbe 语义（与翻译/图片链的关键差别）')
  await checkAsync('拿到 code 就停 —— 哪怕是 ERR（宕机是结论，不是探针故障）', async () => {
    let secondTouched = 0
    const out = await runProbe('https://x/', {
      chain: [
        fake('a', async () => ({ code: 'ERR', ms: 5 })),
        fake('b', async () => { secondTouched += 1; return { code: '200', ms: 1 } }),
      ],
    })
    assert.equal(out.code, 'ERR')
    assert.equal(out.probe, 'a')
    assert.equal(secondTouched, 0, '不该再试第二个探针')
  })
  await checkAsync('探针声明不可用 → 换下一个', async () => {
    const out = await runProbe('https://x/', {
      chain: [
        fake('no', async () => ({ unavailable: true, reason: '没有 curl' })),
        fake('yes', async () => ({ code: '200', ms: 3 })),
      ],
    })
    assert.equal(out.probe, 'yes')
    assert.equal(out.code, '200')
  })
  await checkAsync('探针抛错 → 换下一个', async () => {
    const out = await runProbe('https://x/', {
      chain: [fake('boom', async () => { throw new Error('x') }), fake('ok', async () => ({ code: '301', ms: 2 }))],
    })
    assert.equal(out.probe, 'ok')
  })
  await checkAsync('全链不可用 → null（调用方决定兜底）', async () => {
    assert.equal(await runProbe('https://x/', { chain: [fake('a', async () => ({ unavailable: true }))] }), null)
    assert.equal(await runProbe('https://x/', { chain: [] }), null)
  })
  await checkAsync('返回形状带 probe 标识（可诊断实际用了哪个探针）', async () => {
    const out = await runProbe('https://x/', { chain: [fake('only', async () => ({ code: '404', ms: 7 }))] })
    assert.deepEqual(out, { code: '404', ms: 7, probe: 'only' })
  })

  console.log('\n内建探针清单')
  check('两个探针都在，且 curl 在前', () => {
    const ids = listProbes({ check: false }).map(p => p.id)
    assert.deepEqual(ids, ['curl-http', 'fetch-http'])
  })
  check('curl-http 的可用性与平台一致', () => {
    const curls = listProbes({ check: true }).find(p => p.id === 'curl-http')
    assert.equal(curls.available, process.platform === 'win32')
  })

  console.log('\n端到端（本地回环，不出外网）')
  await checkAsync('curl 探针真探本地服务 → 204 / verdict ok', async () => {
    const out = await withServer(url => runProbe(url, { chain: probeChain('curl-http'), timeoutS: 5, proxy: null }))
    assert.ok(out, 'curl 探针应可用')
    assert.equal(out.probe, 'curl-http')
    assert.equal(out.code, '204')
    assert.equal(verdictOf(out.code), 'ok')
  })
  await checkAsync('fetch 探针的 SSRF 防护对内网地址生效（回 BLOCKED 而非 ERR）', async () => {
    const out = await withServer(url => runProbe(url, { chain: probeChain('fetch-http'), timeoutMs: 5000 }))
    assert.ok(out, 'fetch 探针应可用')
    assert.equal(out.code, 'BLOCKED')
  })

  console.log('\n回归：定性口径不因换探针而改变')
  check('verdictOf / STATUS_LABEL 仍从 health-probe 导出', () => {
    assert.equal(verdictOf('200'), 'ok')
    assert.equal(verdictOf('403'), 'limited')
    assert.equal(verdictOf('ERR'), 'down')
    assert.ok(STATUS_LABEL && typeof STATUS_LABEL === 'object')
  })

  console.log(`\nprobe-engine 自测：${pass} 通过 / ${fail} 失败`)
  process.exitCode = fail ? 1 : 0
}

main()
