#!/usr/bin/env node
/**
 * 发布通道注册表（热拔插）自测：不联网、不部署。
 *
 * 覆盖：
 *   ① 注册校验（缺 id / 缺 deployCommand 抛错）
 *   ② resolvePublisher 的选择优先级（显式 id → NAV_PUBLISHER → available）
 *   ③ **默认通道 = 线上实际所在**：botkeep 排最前，站点地址与部署脚本都对得上
 *      （防「默认落回旧平台 → 整条数据链路静默打到没人维护的站点」）
 *   ④ capabilities：botkeep / workbuddy / vercel 支持热更新与收敛验证；静态托管两者都不支持
 *   ⑤ NAV_SITE_URL 覆盖站点地址（并去掉尾斜杠）
 *   ⑥ 静态通道的命令拼接（NAV_DEPLOY_TARGET 未配时不可用）
 *   ⑦ publish.mjs 确实已改为经注册表取通道（源码断言，防止「加了抽象但没接」）
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerPublisher, listPublishers, resolvePublisher } from '../../shared/publisher.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PUBLISH_SCRIPT = path.join(HERE, '..', '..', 'scripts', 'publish.mjs')
const GATE_SCRIPT = path.join(HERE, '..', '..', 'scripts', 'deploy-cloud.mjs')
const CLOUD_LIB = path.join(HERE, 'lib', 'cloud.mjs')

let pass = 0
let fail = 0
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass += 1 } catch (e) { console.log('  ✖ ' + name + ' — ' + e.message); fail += 1 }
}

/** 临时设环境变量跑一段 */
function withEnv(vars, fn) {
  const olds = {}
  for (const [k, v] of Object.entries(vars)) {
    olds[k] = process.env[k]
    if (v === undefined) delete process.env[k]; else process.env[k] = v
  }
  try { return fn() } finally {
    for (const [k, v] of Object.entries(olds)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v
    }
  }
}

function main() {
  console.log('\n注册表校验')
  check('缺 id 抛错', () => { assert.throws(() => registerPublisher({ deployCommand: 'x' })) })
  check('缺 deployCommand 抛错', () => { assert.throws(() => registerPublisher({ id: 'x-nocmd' })) })

  console.log('\n默认通道（botkeep）—— 线上实际所在的自有服务器')
  check('默认解析到 botkeep', () => {
    withEnv({ NAV_PUBLISHER: undefined, NAV_DEPLOY_TARGET: undefined }, () => {
      assert.equal(resolvePublisher().id, 'botkeep')
    })
  })
  check('站点地址指向自有服务器', () => {
    withEnv({ NAV_PUBLISHER: undefined, NAV_SITE_URL: undefined }, () => {
      assert.equal(resolvePublisher().siteUrl, 'https://navigator-v2.bot-keep.xyz')
    })
  })
  check('部署命令指向 BotKeep 发布脚本', () => {
    withEnv({ NAV_PUBLISHER: undefined }, () => {
      assert.equal(resolvePublisher().deployCommand, 'node scripts/deploy-botkeep.mjs')
    })
  })
  /**
   * 防漂移：默认通道决定 SITE_URL，而 SITE_URL 喂给云端读取 / 热更新 / 收敛验证。
   * 一旦默认落回旧平台，**整条数据链路会静默地打到一个已经没人维护的站点上**
   * （2026-10-16 之前就是这样：默认是 workbuddy，而线上早已迁到自有服务器）。
   */
  check('默认通道必须是线上实际所在的那一个（防「通道指到旧平台」复发）', () => {
    withEnv({ NAV_PUBLISHER: undefined, NAV_SITE_URL: undefined, NAV_DEPLOY_TARGET: undefined }, () => {
      const p = resolvePublisher()
      assert.equal(p.id, 'botkeep', '默认通道不是线上实际所在的通道')
      assert.match(p.siteUrl, /bot-keep\.xyz$/, '站点地址应指向自有服务器')
    })
  })
  check('部署命令指向的脚本真实存在（防止通道写了个不存在的命令）', () => {
    withEnv({ NAV_PUBLISHER: undefined }, () => {
      const rel = resolvePublisher().deployCommand.replace(/^node\s+/, '')
      assert.ok(fs.existsSync(path.join(HERE, '..', '..', rel)), `找不到 ${rel}`)
    })
  })
  /**
   * 这条钉的是 2026-10-14 的事故：线上跑着 19 小时前的旧产物，期间修好的缺陷
   * 在用户面前仍是坏的。产物门禁必须真的会比对源码与产物的时间，否则等于没有。
   */
  check('产物门禁脚本存在，且真的比对源码/产物时间', () => {
    const src = fs.readFileSync(GATE_SCRIPT, 'utf8')
    assert.ok(src.includes('newestSourceMtime'), '应有源码最新时间计算')
    assert.ok(src.includes('newest > oldest'), '产物落后源码时必须判定为不可发')
    assert.ok(src.includes('process.exit(1)'), '不可发时必须非零退出（中止发布）')
  })
  check('NAV_SITE_URL 覆盖站点地址，并去掉尾斜杠', () => {
    withEnv({ NAV_PUBLISHER: undefined, NAV_SITE_URL: 'https://preview.example.com/' }, () => {
      assert.equal(resolvePublisher().siteUrl, 'https://preview.example.com')
    })
  })
  check('默认通道（botkeep）支持热更新与收敛验证', () => {
    withEnv({ NAV_PUBLISHER: undefined }, () => {
      const p = resolvePublisher()
      assert.equal(p.hotUpdate, true)
      assert.equal(p.verify, true)
    })
  })
  check('保留的 workbuddy / vercel 通道仍在，且都声称支持热更新', () => {
    for (const id of ['workbuddy', 'vercel']) {
      withEnv({ NAV_PUBLISHER: id }, () => {
        const p = resolvePublisher()
        assert.equal(p.id, id)
        assert.equal(p.hotUpdate, true, `${id} 应支持热更新`)
      })
    }
  })

  console.log('\n保留通道（vercel）—— 换默认不改它的行为')
  check('显式 vercel 的部署命令与迁移前逐字一致', () => {
    withEnv({ NAV_PUBLISHER: 'vercel' }, () => {
      assert.equal(resolvePublisher().deployCommand, 'npx vercel deploy --prod --yes')
    })
  })
  check('显式 vercel 的站点地址与迁移前逐字一致', () => {
    withEnv({ NAV_PUBLISHER: 'vercel', NAV_SITE_URL: undefined }, () => {
      assert.equal(resolvePublisher().siteUrl, 'https://navigator-v2-two.vercel.app')
    })
  })

  console.log('\n静态通道（rsync-static）')
  check('未配 NAV_DEPLOY_TARGET 时不可用（解析时不选它）', () => {
    withEnv({ NAV_PUBLISHER: undefined, NAV_DEPLOY_TARGET: undefined }, () => {
      assert.equal(resolvePublisher().id, 'botkeep')
      const rsync = listPublishers({ check: true }).find(p => p.id === 'rsync-static')
      assert.equal(rsync.available, false)
    })
  })
  check('配置后可用，且命令按目标拼接', () => {
    withEnv({ NAV_PUBLISHER: 'rsync-static', NAV_DEPLOY_TARGET: 'user@host:/var/www/nav', NAV_DEPLOY_SRC: 'dist/' }, () => {
      const p = resolvePublisher()
      assert.equal(p.id, 'rsync-static')
      assert.equal(p.deployCommand, 'rsync -az --delete dist/ user@host:/var/www/nav')
    })
  })
  check('静态通道如实声明「不支持热更新 / 不支持收敛验证」', () => {
    withEnv({ NAV_PUBLISHER: 'rsync-static', NAV_DEPLOY_TARGET: '/srv/www' }, () => {
      const p = resolvePublisher()
      assert.equal(p.hotUpdate, false)
      assert.equal(p.verify, false)
    })
  })
  check('显式 id 优先于 env', () => {
    withEnv({ NAV_PUBLISHER: 'rsync-static', NAV_DEPLOY_TARGET: '/srv/www' }, () => {
      assert.equal(resolvePublisher('vercel').id, 'vercel')
    })
  })

  console.log('\n清单与接入')
  check('listPublishers 列出四通道并按 order 排序（botkeep 在最前）', () => {
    const ids = listPublishers({ check: false }).map(p => p.id)
    assert.deepEqual(ids, ['botkeep', 'workbuddy', 'vercel', 'rsync-static'])
  })
  /**
   * 2026-10-11 的教训：控制台所有云端操作打的都是这个硬编码域名，平台一停，
   * 同步/快照/门禁全部打到一具尸体上，报错还长得像网络问题。地址必须走通道。
   */
  check('cloud.mjs 经注册表取站点地址（不再硬编码域名）', () => {
    const src = fs.readFileSync(CLOUD_LIB, 'utf8')
    assert.ok(src.includes('resolvePublisher'), '应 import 并调用 resolvePublisher')
    assert.ok(!src.includes("'https://navigator-v2-two.vercel.app'"), '不应再硬编码站点地址')
  })
  check('publish.mjs 确实改为经注册表取通道（防止「加了抽象但没接」）', () => {
    const src = fs.readFileSync(PUBLISH_SCRIPT, 'utf8')
    assert.ok(src.includes('resolvePublisher'), '应 import 并调用 resolvePublisher')
    assert.ok(src.includes('publisher.deployCommand'), '部署步骤应使用通道给出的命令')
    assert.ok(!src.includes("shell('npx vercel deploy --prod --yes')"), '不应再硬编码部署命令')
    assert.ok(!src.includes("const SITE_URL = 'https://navigator-v2-two.vercel.app'"), '不应再硬编码站点地址')
  })

  console.log(`\npublisher 自测：${pass} 通过 / ${fail} 失败`)
  process.exitCode = fail ? 1 : 0
}

main()
