#!/usr/bin/env node
/**
 * 插件目录（统一注册表视图）自测：不联网。
 *
 * 覆盖：
 *   ① 9 个引擎组齐备，且形状归一（providers / current / available 一个都不少）
 *   ② 注册链加载完整 —— translate 的内建译厂、image 的封面 provider 不能缺项
 *   ③ 链式组的 current.mode 三态（default / custom / off）随配置变化
 *   ④ site-store 必须是 locked 且 writable:false（数据安全单点，不许在面板改）
 *   ⑤ 覆盖层白名单：NAV_SITE_STORE 与白名单外的键一律拒绝
 *   ⑥ 覆盖层值校验：非法字符 / 超长一律拒绝
 *   ⑦ applyOverrides 写入 process.env 后**立刻**影响引擎解析（热拔插的真凭实据）
 */
import assert from 'node:assert/strict'
import {
  pluginGroups, sanitizeOverrides, applyOverrides, currentOverrides, WRITABLE_ENVS,
} from '../../shared/plugin-registry.mjs'
import { resolveEngineId } from '../../shared/site-engine.mjs'

let pass = 0
let fail = 0
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass += 1 } catch (e) { console.log('  ✖ ' + name + ' — ' + e.message); fail += 1 }
}
async function checkAsync(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); pass += 1 } catch (e) { console.log('  ✖ ' + name + ' — ' + e.message); fail += 1 }
}

/** 临时改环境变量跑一段（同步或异步皆可），随后原样恢复 */
async function withEnv(pairs, fn) {
  const saved = {}
  for (const k of Object.keys(pairs)) saved[k] = process.env[k]
  for (const [k, v] of Object.entries(pairs)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v
  }
  try { return await fn() } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v
    }
  }
}

const EXPECTED_IDS = [
  'site-engine', 'translate-engine', 'llm-engine', 'image-engine', 'cover-source',
  'probe-engine', 'category-source', 'site-store', 'publisher',
]

async function main() {
  console.log('\n插件目录：形状与完整性')
  const groups = await pluginGroups({ check: false })
  const byId = new Map(groups.map(g => [g.id, g]))

  check('9 个引擎组全部出现', () => {
    assert.deepEqual(groups.map(g => g.id).sort(), [...EXPECTED_IDS].sort())
  })
  check('每组的公共字段齐备', () => {
    for (const g of groups) {
      for (const f of ['id', 'label', 'role', 'strategy', 'env', 'hot', 'writable']) {
        assert.ok(g[f] !== undefined, `${g.id} 缺字段 ${f}`)
      }
      assert.ok(Array.isArray(g.providers), `${g.id}.providers 必须是数组`)
      assert.ok(g.current && typeof g.current === 'object', `${g.id}.current 必须是对象`)
      assert.equal(typeof g.available, 'boolean', `${g.id}.available 必须是布尔`)
    }
  })
  check('每个 provider 都带 selected/active 两个判定位', () => {
    for (const g of groups) {
      for (const p of g.providers) {
        assert.equal(typeof p.selected, 'boolean', `${g.id}/${p.id} 缺 selected`)
        assert.equal(typeof p.active, 'boolean', `${g.id}/${p.id} 缺 active`)
      }
    }
  })

  console.log('\n注册链加载完整性（少 import 一个就静默缺项）')
  check('翻译链含内建两引擎（由 translate.mjs 注册，非自注册）', () => {
    const ids = byId.get('translate-engine').providers.map(p => p.id)
    assert.ok(ids.includes('mymemory'), '缺 mymemory —— translate.mjs 没被加载')
    assert.ok(ids.includes('google'), '缺 google —— translate.mjs 没被加载')
  })
  check('封面链含 og:image provider（由 cover-source.mjs 注册，非自注册）', () => {
    const ids = byId.get('cover-source').providers.map(p => p.id)
    assert.ok(ids.length >= 1, '封面链为空 —— cover-source.mjs 没被加载')
  })
  check('图标链含三个内置提供者', () => {
    const ids = byId.get('image-engine').providers.map(p => p.id)
    for (const id of ['page-links', 'favicon-ico', 'favicon-im']) {
      assert.ok(ids.includes(id), `图标链缺 ${id}`)
    }
  })
  check('探针链与分类链非空', () => {
    assert.ok(byId.get('probe-engine').providers.length >= 1)
    assert.ok(byId.get('category-source').providers.length >= 1)
  })

  console.log('\n链式组的三态（未配置 / 自定义 / 关闭）')
  await checkAsync('未配置 → mode=default，label 指明是默认全量', async () => {
    await withEnv({ NAV_TRANSLATE_ENGINES: undefined }, async () => {
      const gs = await pluginGroups({ check: false })
      const g = gs.find(x => x.id === 'translate-engine')
      assert.equal(g.current.mode, 'default')
      assert.match(g.current.label, /默认/)
    })
  })
  await checkAsync('自定义列表 → mode=custom，ids 反映实际链', async () => {
    await withEnv({ NAV_ICON_PROVIDERS: 'favicon-ico' }, async () => {
      const gs = await pluginGroups({ check: false })
      const g = gs.find(x => x.id === 'image-engine')
      assert.equal(g.current.mode, 'custom')
      assert.ok(g.current.ids.includes('favicon-ico'))
      assert.ok(!g.current.ids.includes('page-links'), '未列出的 provider 不该在链里')
    })
  })
  await checkAsync('none → mode=off，链为空', async () => {
    await withEnv({ NAV_ICON_PROVIDERS: 'none' }, async () => {
      const gs = await pluginGroups({ check: false })
      const g = gs.find(x => x.id === 'image-engine')
      assert.equal(g.current.mode, 'off')
      assert.equal(g.current.ids.length, 0)
    })
  })

  console.log('\n站点存储：锁定只读（数据安全单点）')
  check('strategy=locked 且 writable=false', () => {
    const g = byId.get('site-store')
    assert.equal(g.strategy, 'locked')
    assert.equal(g.writable, false)
    assert.equal(g.hot, false)
    assert.match(g.note, /数据安全|覆盖/)
  })

  console.log('\n覆盖层：白名单与值校验')
  check('NAV_SITE_STORE 被明确拒绝（附原因）', () => {
    const r = sanitizeOverrides({ NAV_SITE_STORE: 'fs' })
    assert.deepEqual(r.ok, {})
    assert.equal(r.rejected.length, 1)
    assert.match(r.rejected[0].reason, /数据安全/)
  })
  check('白名单外的键被拒绝', () => {
    const r = sanitizeOverrides({ SOME_RANDOM_VAR: 'x' })
    assert.deepEqual(r.ok, {})
    assert.equal(r.rejected.length, 1)
  })
  check('合法键被接受', () => {
    const r = sanitizeOverrides({ NAV_SITE_ENGINE: 'native', NAV_TRANSLATE_ENGINES: 'mymemory,google' })
    assert.deepEqual(r.ok, { NAV_SITE_ENGINE: 'native', NAV_TRANSLATE_ENGINES: 'mymemory,google' })
    assert.equal(r.rejected.length, 0)
  })
  check('空值 = 清除该项（保留在 ok 里，值为空串），不算错误', () => {
    const r = sanitizeOverrides({ NAV_SITE_ENGINE: '   ' })
    assert.deepEqual(r.ok, { NAV_SITE_ENGINE: '' })
    assert.equal(r.rejected.length, 0)
  })
  check('非法字符被拒绝（防注入）', () => {
    const r = sanitizeOverrides({ NAV_SITE_ENGINE: 'native; rm -rf /' })
    assert.deepEqual(r.ok, {})
    assert.equal(r.rejected.length, 1)
    assert.match(r.rejected[0].reason, /非法字符/)
  })
  check('超长值被拒绝', () => {
    const r = sanitizeOverrides({ NAV_TRANSLATE_ENGINES: 'a'.repeat(300) })
    assert.deepEqual(r.ok, {})
    assert.equal(r.rejected.length, 1)
  })
  check('非对象输入不炸', () => {
    assert.deepEqual(sanitizeOverrides(null).ok, {})
    assert.deepEqual(sanitizeOverrides('x').ok, {})
  })

  console.log('\n覆盖层：写入即生效（热拔插的真凭实据）')
  await checkAsync('applyOverrides 后引擎解析立刻反映新配置', async () => {
    await withEnv({ NAV_SITE_ENGINE: undefined }, () => {
      assert.equal(resolveEngineId(), 'auto', '前置：未配置时应为 auto')
      const applied = applyOverrides({ NAV_SITE_ENGINE: 'native' })
      assert.deepEqual(applied, ['NAV_SITE_ENGINE'])
      assert.equal(resolveEngineId(), 'native', '写入后必须立刻生效 —— 否则「热拔插」是假的')
    })
    assert.equal(resolveEngineId(), 'auto', '恢复后应回到未配置态')
  })
  check('applyOverrides 拒绝白名单外的键（即使绕过 sanitize）', () => {
    const applied = applyOverrides({ NAV_SITE_STORE: 'fs' })
    assert.deepEqual(applied, [])
    assert.equal(process.env.NAV_SITE_STORE, undefined)
  })
  await checkAsync('applyOverrides 空值 = 删除该变量', async () => {
    await withEnv({ NAV_PUBLISHER: 'vercel' }, () => {
      applyOverrides({ NAV_PUBLISHER: '' })
      assert.equal(process.env.NAV_PUBLISHER, undefined)
    })
  })
  await checkAsync('currentOverrides 只回显非空的白名单变量', async () => {
    await withEnv({ NAV_SITE_ENGINE: 'native', NAV_PUBLISHER: undefined }, () => {
      const cur = currentOverrides()
      assert.equal(cur.NAV_SITE_ENGINE, 'native')
      assert.ok(!('NAV_PUBLISHER' in cur))
      assert.ok(!('NAV_SITE_STORE' in cur), 'NAV_SITE_STORE 不在白名单，不该回显')
    })
  })
  check('WRITABLE_ENVS 确实不含 NAV_SITE_STORE', () => {
    assert.ok(!WRITABLE_ENVS.has('NAV_SITE_STORE'))
  })

  console.log(`\n${fail === 0 ? '✅' : '❌'} 通过 ${pass} / 失败 ${fail}\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(e => { console.error('FATAL', e); process.exit(2) })
