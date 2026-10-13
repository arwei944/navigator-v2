#!/usr/bin/env node
/**
 * 图片提供者注册表（热拔插）自测：不联网。
 *
 * 覆盖：
 *   ① 注册表校验（缺 id / 缺 fetch / 非法 kind 一律抛，不静默收下坏 provider）
 *   ② imageChain 的配置优先级与容错（换序 / 裁剪 / 全不匹配回退全量 / none 清空 / kind 隔离）
 *   ③ resolveImage 的回退语义（首个成功即停 / 抛错换下一个 / 全失败回 null / 绝不抛）
 *   ④ 内建 favicon 三源的默认顺序，以及 cover 默认链**不含** favicon-as-cover（行为零变化）
 *   ⑤ 纯函数：格式探测、data: 解析、占位图识别、icon 声明抽取与排序、属性解析
 *   ⑥ 端到端（假 fetchBuf）：页面链失败时真的落到 /favicon.ico
 */
import assert from 'node:assert/strict'
import {
  registerImageProvider, listImageProviders, imageChain, resolveImage,
  detectExt, toAbsolute, decodeDataUri, isPlaceholderIcon, extractIconLinks, attrValue,
  normalizeHost, normalizeSiteUrl, downloadImage,
} from '../../shared/image-engine.mjs'
// 副作用 import：封面 provider（og-image）在它加载时注册（与 translate.mjs 注册内建译厂同理）
import '../../shared/cover-source.mjs'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

let pass = 0
let fail = 0
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass += 1 } catch (e) { console.log('  ✖ ' + name + ' — ' + e.message); fail += 1 }
}
async function checkAsync(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); pass += 1 } catch (e) { console.log('  ✖ ' + name + ' — ' + e.message); fail += 1 }
}

/** 造一个只满足 resolveImage 需要的假 provider（只用 id 与 fetch） */
const fake = (id, fn) => ({ id, fetch: fn })

async function main() {
  console.log('\n注册表校验')
  check('缺 id 抛错', () => { assert.throws(() => registerImageProvider({ kind: 'favicon', fetch: () => null })) })
  check('缺 fetch 抛错', () => { assert.throws(() => registerImageProvider({ id: 'x-nofetch', kind: 'favicon' })) })
  check('非法 kind 抛错', () => { assert.throws(() => registerImageProvider({ id: 'x-badkind', kind: 'avatar', fetch: () => null })) })

  console.log('\n链路配置（imageChain）')
  check('显式列表决定顺序（换序生效）', () => {
    const ids = imageChain('favicon', 'favicon-im,page-links').map(p => p.id)
    assert.deepEqual(ids, ['favicon-im', 'page-links'])
  })
  check('裁剪：只留一个', () => {
    const ids = imageChain('favicon', 'favicon-ico').map(p => p.id)
    assert.deepEqual(ids, ['favicon-ico'])
  })
  check('全不匹配回退全量（配置事故不静默失效）', () => {
    const ids = imageChain('favicon', 'a,b,c').map(p => p.id)
    assert.ok(ids.includes('page-links') && ids.includes('favicon-ico') && ids.includes('favicon-im'))
  })
  check('none 显式清空', () => {
    assert.deepEqual(imageChain('favicon', 'none'), [])
    assert.deepEqual(imageChain('favicon', 'off'), [])
  })
  check('kind 隔离：favicon 链不含 cover provider', () => {
    const ids = imageChain('favicon', '').map(p => p.id)
    assert.ok(!ids.includes('og-image'))
  })
  check('内建 favicon 三源按 order 排列', () => {
    const ids = imageChain('favicon', '').map(p => p.id)
    assert.deepEqual(ids.slice(0, 3), ['page-links', 'favicon-ico', 'favicon-im'])
  })
  check('cover 默认链只含 og-image（favicon-as-cover 默认关闭，行为零变化）', () => {
    const ids = imageChain('cover', '').map(p => p.id)
    assert.deepEqual(ids, ['og-image'])
  })
  check('env 未设时不受影响（显式参数优先）', () => {
    const old = process.env.NAV_ICON_PROVIDERS
    process.env.NAV_ICON_PROVIDERS = 'favicon-im'
    assert.deepEqual(imageChain('favicon', 'page-links').map(p => p.id), ['page-links'])
    assert.deepEqual(imageChain('favicon').map(p => p.id), ['favicon-im'])
    if (old === undefined) delete process.env.NAV_ICON_PROVIDERS; else process.env.NAV_ICON_PROVIDERS = old
  })

  console.log('\n回退语义（resolveImage）')
  await checkAsync('首个成功即返回，不再试后面的', async () => {
    let touched = 0
    const out = await resolveImage({ url: 'x' }, {
      chain: [
        fake('first', async () => { touched += 1; return { buf: PNG, ext: 'png' } }),
        fake('second', async () => { touched += 10; return { buf: PNG, ext: 'png' } }),
      ],
    })
    assert.equal(out.provider, 'first')
    assert.equal(touched, 1)
  })
  await checkAsync('抛错的 provider 被跳过，落到下一个', async () => {
    const out = await resolveImage({ url: 'x' }, {
      chain: [
        fake('boom', async () => { throw new Error('boom') }),
        fake('ok', async () => ({ buf: PNG, ext: 'png' })),
      ],
    })
    assert.equal(out.provider, 'ok')
  })
  await checkAsync('返回 null 的 provider 被跳过', async () => {
    const out = await resolveImage({ url: 'x' }, {
      chain: [fake('empty', async () => null), fake('ok', async () => ({ buf: PNG, ext: 'png' }))],
    })
    assert.equal(out.provider, 'ok')
  })
  await checkAsync('返回空 Buffer 视为失败', async () => {
    const out = await resolveImage({ url: 'x' }, {
      chain: [fake('zerolen', async () => ({ buf: Buffer.alloc(0), ext: 'png' })), fake('ok', async () => ({ buf: PNG, ext: 'png' }))],
    })
    assert.equal(out.provider, 'ok')
  })
  await checkAsync('全链失败 → null，绝不抛', async () => {
    const out = await resolveImage({ url: 'x' }, {
      chain: [fake('a', async () => { throw new Error('a') }), fake('b', async () => null)],
    })
    assert.equal(out, null)
  })
  await checkAsync('空链 → null', async () => {
    assert.equal(await resolveImage({ url: 'x' }, { chain: [] }), null)
  })

  console.log('\n端到端（假 fetchBuf，验证真的落到第二源）')
  await checkAsync('页面无 icon 声明 → 落到 /favicon.ico', async () => {
    const seen = []
    const ctx = {
      fetchBuf: async (url) => {
        seen.push(url)
        if (url.endsWith('/favicon.ico')) return PNG
        return Buffer.from('<html><head><title>无图标</title></head></html>')
      },
    }
    const chain = imageChain('favicon', 'page-links,favicon-ico')
    const out = await resolveImage({ url: 'example.com' }, { kind: 'favicon', chain, ctx })
    assert.equal(out.provider, 'favicon-ico')
    assert.ok(seen.some(u => u.endsWith('/favicon.ico')), '应请求过 /favicon.ico')
  })
  await checkAsync('页面有 icon 声明 → 第一源即命中', async () => {
    const ctx = {
      fetchBuf: async (url) => (url.endsWith('logo.png') ? PNG : Buffer.from('<html><head><link rel="icon" href="/logo.png"></head></html>')),
    }
    const chain = imageChain('favicon', 'page-links,favicon-ico')
    const out = await resolveImage({ url: 'https://example.com/' }, { kind: 'favicon', chain, ctx })
    assert.equal(out.provider, 'page-links')
  })
  await checkAsync('内联 data: 图标可解（不经过 fetchBuf）', async () => {
    const dataUri = 'data:image/png;base64,' + PNG.toString('base64')
    const ctx = { fetchBuf: async () => { throw new Error('不该走网络') } }
    const chain = imageChain('favicon', 'page-links')
    const out = await resolveImage({ url: 'https://example.com/' }, {
      chain: [fake('inline', async (_s, c) => downloadImage(dataUri, c))],
      ctx,
    })
    assert.equal(out.ext, 'png')
  })
  await checkAsync('封面：从页面取 og:image 并下载（假 fetchCapped，出网走 ctx）', async () => {
    const seen = []
    const ctx = {
      fetchCapped: async (url) => {
        seen.push(url)
        if (url.endsWith('/og.png')) return { status: 200, headers: { 'content-type': 'image/png' }, body: PNG }
        return {
          status: 200,
          headers: { 'content-type': 'text/html' },
          body: Buffer.from('<html><head><meta property="og:image" content="/og.png"></head></html>'),
        }
      },
      extByMime: { 'image/png': '.png' },
      debug: {},
    }
    const out = await resolveImage({ url: 'https://example.com/' }, {
      kind: 'cover', chain: imageChain('cover', 'og-image'), ctx,
    })
    assert.equal(out.provider, 'og-image')
    assert.equal(out.ext, 'png')
    assert.ok(seen.some(u => u.endsWith('/og.png')), '应下载过 og:image 指向的图')
  })
  await checkAsync('封面：缺 ctx.fetchCapped 时抛错被吞 → 回 null（不炸调用方）', async () => {
    const out = await resolveImage({ url: 'https://example.com/' }, {
      kind: 'cover', chain: imageChain('cover', 'og-image'), ctx: {},
    })
    assert.equal(out, null)
  })

  console.log('\n格式探测（magic bytes）')
  check('PNG / ICO / JPEG / WEBP / GIF / AVIF 识别', () => {
    assert.equal(detectExt(PNG), 'png')
    assert.equal(detectExt(Buffer.from([0x00, 0x00, 0x01, 0x00])), 'ico')
    assert.equal(detectExt(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpg')
    assert.equal(detectExt(Buffer.from('RIFF....WEBPVP8 ')), 'webp')
    assert.equal(detectExt(Buffer.from('GIF89a')), 'gif')
    assert.equal(detectExt(Buffer.from('\x00\x00\x00\x1cftypavif')), 'avif')
  })
  check('SVG 文本识别 + 未知格式回 bin', () => {
    assert.equal(detectExt(Buffer.from('<?xml version="1.0"?><svg/>')), 'svg')
    assert.equal(detectExt(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])), 'bin')
  })

  console.log('\ndata: 与属性解析')
  check('抑制型 data: 视为未声明', () => {
    assert.equal(toAbsolute('data:,', 'https://x/'), null)
    assert.equal(toAbsolute('data:image/png;base64,', 'https://x/'), null)
  })
  check('真内联图片原样保留', () => {
    const u = 'data:image/svg+xml,%3Csvg%3E'
    assert.equal(toAbsolute(u, 'https://x/'), u)
  })
  check('相对地址按 base 解析', () => {
    assert.equal(toAbsolute('/a.png', 'https://x/y/z'), 'https://x/a.png')
    assert.equal(toAbsolute('nope', 'not-a-url'), null)
  })
  check('decodeDataUri 支持 base64 与 URI 编码', () => {
    assert.equal(decodeDataUri('data:image/png;base64,' + Buffer.from('hi').toString('base64')).toString(), 'hi')
    assert.equal(decodeDataUri('data:image/svg+xml,%3Csvg%3E').toString(), '<svg>')
    assert.equal(decodeDataUri('nope'), null)
  })
  check('占位图标被识别（favicon.im 的灰色 f）', () => {
    const placeholder = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#808080"/><text x="1">f</text></svg>')
    assert.equal(isPlaceholderIcon(placeholder), true)
    assert.equal(isPlaceholderIcon(PNG), false)
  })
  check('attrValue 能取到含单引号的内联 SVG href（引号配对，非 [^"\']+）', () => {
    const tag = `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E">`
    assert.equal(attrValue(tag, 'href'), "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E")
  })

  console.log('\nicon 声明抽取与排序')
  check('apple-touch-icon 优先于普通 icon', () => {
    const html = '<link rel="icon" href="/a.png" sizes="16x16"><link rel="apple-touch-icon" href="/b.png" sizes="180x180">'
    const links = extractIconLinks(html, 'https://x/')
    assert.equal(links.length, 2)
    assert.equal(links[0].url, 'https://x/b.png')
  })
  check('非 icon 的 link 不会被收进来', () => {
    const html = '<link rel="stylesheet" href="/s.css"><link rel="manifest" href="/m.json">'
    assert.equal(extractIconLinks(html, 'https://x/').length, 0)
  })

  console.log('\n地址规范化')
  check('normalizeSiteUrl 补协议', () => {
    assert.equal(normalizeSiteUrl('example.com'), 'https://example.com')
    assert.equal(normalizeSiteUrl('http://a.b/c'), 'http://a.b/c')
  })
  check('normalizeHost 去协议/路径/www', () => {
    assert.equal(normalizeHost('https://www.example.com/a/b?c=1'), 'example.com')
  })

  console.log('\n清单投影')
  check('listImageProviders 按 kind 过滤且含内建项', () => {
    const fav = listImageProviders({ kind: 'favicon', check: false }).map(p => p.id)
    const cov = listImageProviders({ kind: 'cover', check: false }).map(p => p.id)
    assert.ok(fav.includes('page-links') && fav.includes('favicon-ico') && fav.includes('favicon-im'))
    assert.ok(cov.includes('og-image'))
    assert.ok(!cov.includes('page-links'))
  })

  console.log(`\nimage-engine 自测：${pass} 通过 / ${fail} 失败`)
  process.exit(fail ? 1 : 0)
}

main()
