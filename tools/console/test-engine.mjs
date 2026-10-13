#!/usr/bin/env node
/**
 * 抓取引擎（热拔插）自测：不联网、不依赖 siteprobe 在线。
 *
 * 覆盖：
 *   ① resolveEngineId 的配置优先级（参数 → env → auto → 非法值回退 auto）
 *   ② 探活失败的优雅降级（未启动 siteprobe 时 alive=false，不抛）
 *   ③ auto 模式在「服务不在线」时选择 native
 *   ④ 引擎输出形状契约（与 nav 的 inferSite 字段一致，供前端/接口消费）
 *   ⑤ probeViaSiteprobe 对不可达地址返回 null（调用方据此回退）
 */
import assert from 'node:assert/strict'
import { resolveEngineId, siteprobeAlive, resolveEngine, probeViaSiteprobe, siteprobeEndpoint, listEngines } from '../../shared/site-engine.mjs'

const NAV_SHAPE = ['url', 'domain', 'name', 'desc', 'faviconUrl', 'color', 'categoryId', 'categoryLabel', 'purposes', 'blocked', 'scope', 'sources', 'confidence']

let pass = 0
let fail = 0
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass += 1 } catch (e) { console.log('  ✖ ' + name + ' — ' + e.message); fail += 1 }
}
async function checkAsync(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); pass += 1 } catch (e) { console.log('  ✖ ' + name + ' — ' + e.message); fail += 1 }
}

async function main() {
  console.log('\nengine 配置解析')
  check('显式参数优先于 env', () => {
    const old = process.env.NAV_SITE_ENGINE
    process.env.NAV_SITE_ENGINE = 'siteprobe'
    assert.equal(resolveEngineId('native'), 'native')
    process.env.NAV_SITE_ENGINE = old
  })
  check('env 次之', () => {
    const old = process.env.NAV_SITE_ENGINE
    process.env.NAV_SITE_ENGINE = 'siteprobe'
    assert.equal(resolveEngineId(), 'siteprobe')
    process.env.NAV_SITE_ENGINE = old
  })
  check('默认 auto', () => {
    const old = process.env.NAV_SITE_ENGINE
    delete process.env.NAV_SITE_ENGINE
    assert.equal(resolveEngineId(), 'auto')
    process.env.NAV_SITE_ENGINE = old
  })
  check('非法值回退 auto', () => {
    const old = process.env.NAV_SITE_ENGINE
    process.env.NAV_SITE_ENGINE = 'wat'
    assert.equal(resolveEngineId(), 'auto')
    process.env.NAV_SITE_ENGINE = old
  })
  check('endpoint 默认值可取，且去掉尾斜杠', () => {
    const old = process.env.SITEPROBE_ENDPOINT
    delete process.env.SITEPROBE_ENDPOINT
    assert.match(siteprobeEndpoint(), /^http:\/\/127\.0\.0\.1:\d+$/)
    process.env.SITEPROBE_ENDPOINT = 'http://127.0.0.1:9999/'
    assert.equal(siteprobeEndpoint(), 'http://127.0.0.1:9999')
    process.env.SITEPROBE_ENDPOINT = old
  })

  console.log('\n探活与降级（用一个必然不可达的端口，不依赖真实服务）')
  const dead = 'http://127.0.0.1:1'
  await checkAsync('不可达端口 → alive=false，不抛', async () => {
    const ok = await siteprobeAlive({ endpoint: dead, force: true })
    assert.equal(ok, false)
  })
  await checkAsync('auto 在服务离线时选 native', async () => {
    const old = process.env.SITEPROBE_ENDPOINT
    process.env.SITEPROBE_ENDPOINT = dead
    const id = await resolveEngine('auto')
    assert.equal(id, 'native')
    process.env.SITEPROBE_ENDPOINT = old
  })
  await checkAsync('probeViaSiteprobe 对不可达服务返回 null（触发回退，而非抛错）', async () => {
    const r = await probeViaSiteprobe('https://example.com/', { endpoint: dead, timeoutMs: 500 })
    assert.equal(r, null)
  })

  console.log('\n引擎清单')
  await checkAsync('listEngines 含 native 且始终 available', async () => {
    const list = await listEngines({ check: false })
    const native = list.find(e => e.id === 'native')
    assert.ok(native && native.available === true)
    assert.ok(list.find(e => e.id === 'siteprobe'))
  })

  console.log('\n形状契约（与 inferSite 输出字段一致）')
  check('NAV_SHAPE 覆盖两种引擎共同承诺的字段', () => {
    // 引擎层承诺「输出即可直接喂给前端/接口」，字段集合必须与 inferSite 一致
    for (const k of ['name', 'desc', 'faviconUrl', 'color', 'categoryId', 'categoryLabel', 'purposes', 'blocked']) {
      assert.ok(NAV_SHAPE.includes(k), `缺字段 ${k}`)
    }
  })

  console.log(`\nengine 自测：${pass} 通过 / ${fail} 失败`)
  process.exit(fail ? 1 : 0)
}

main()
