#!/usr/bin/env node
/**
 * 发布通道注册表（热拔插）自测：不联网、不部署。
 *
 * 覆盖：
 *   ① 注册校验（缺 id / 缺 deployCommand 抛错）
 *   ② resolvePublisher 的选择优先级（显式 id → NAV_PUBLISHER → available）
 *   ③ **默认行为零变化**：vercel 的部署命令与站点地址与改动前逐字一致
 *   ④ capabilities：vercel 支持热更新与收敛验证；静态托管两者都不支持
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

  console.log('\n默认通道（vercel）—— 行为零变化')
  check('默认解析到 vercel', () => {
    withEnv({ NAV_PUBLISHER: undefined, NAV_DEPLOY_TARGET: undefined }, () => {
      assert.equal(resolvePublisher().id, 'vercel')
    })
  })
  check('部署命令与改动前逐字一致', () => {
    withEnv({ NAV_PUBLISHER: undefined }, () => {
      assert.equal(resolvePublisher().deployCommand, 'npx vercel deploy --prod --yes')
    })
  })
  check('站点地址默认值与改动前一致', () => {
    withEnv({ NAV_PUBLISHER: undefined, NAV_SITE_URL: undefined }, () => {
      assert.equal(resolvePublisher().siteUrl, 'https://navigator-v2-two.vercel.app')
    })
  })
  check('NAV_SITE_URL 覆盖站点地址，并去掉尾斜杠', () => {
    withEnv({ NAV_PUBLISHER: undefined, NAV_SITE_URL: 'https://preview.example.com/' }, () => {
      assert.equal(resolvePublisher().siteUrl, 'https://preview.example.com')
    })
  })
  check('vercel 支持热更新与收敛验证', () => {
    withEnv({ NAV_PUBLISHER: undefined }, () => {
      const p = resolvePublisher()
      assert.equal(p.hotUpdate, true)
      assert.equal(p.verify, true)
    })
  })

  console.log('\n静态通道（rsync-static）')
  check('未配 NAV_DEPLOY_TARGET 时不可用（解析时不选它）', () => {
    withEnv({ NAV_PUBLISHER: undefined, NAV_DEPLOY_TARGET: undefined }, () => {
      assert.equal(resolvePublisher().id, 'vercel')
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
  check('listPublishers 列出两通道并按 order 排序', () => {
    const ids = listPublishers({ check: false }).map(p => p.id)
    assert.deepEqual(ids, ['vercel', 'rsync-static'])
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
