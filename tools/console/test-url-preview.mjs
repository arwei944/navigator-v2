/**
 * 网址预览纯函数：搜索框下拉里那张预览卡片的数据来源与状态判定。
 *
 * 只测纯函数 —— src/stores 与 src/services 引 @/ 别名，纯 node 加载不了。
 * 抓取本身（网络）不在这里测，那是 composable 的职责。
 */
import {
  shouldPreview, previewKeyOf, cardFromSite, cardFromMeta, resolvePreviewState,
  PREVIEW_KIND,
} from '../../src/utils/urlPreview.js'

let pass = 0
const failures = []
function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}

/* ---- 门禁：什么输入才出预览卡片 ---- */
eq(shouldPreview('https://github.com', {}), true, '像网址 → 出预览')
eq(shouldPreview('github.com', {}), true, '裸域名也算网址')
eq(shouldPreview('github', {}), false, '普通词不出预览')
eq(shouldPreview('', {}), false, '空输入不出预览')
eq(shouldPreview('https://github.com', { prefix: '>' }), false, '带命令前缀时不出预览')
eq(shouldPreview('https://github.com', { hasPage: true }), false, '二级页里不出预览')

/* ---- 缓存键：同一域名只抓一次 ---- */
eq(previewKeyOf('https://www.GitHub.com/a/b'), 'github.com', '缓存键忽略 www 与大小写')
eq(previewKeyOf('github.com'), 'github.com', '缓存键可从裸域名解析')
eq(previewKeyOf(''), '', '缓存键空值返回空串')

/* ---- 已收录站点 → 卡片 ---- */
const siteCard = cardFromSite({
  id: 'x', name: 'GitHub', url: 'www.GitHub.com', desc: '代码托管',
  color: '#111111', initial: 'G', iconUrl: 'https://github.com/favicon.ico',
})
eq(siteCard.title, 'GitHub', 'cardFromSite 透传站名')
eq(siteCard.host, 'www.GitHub.com', 'cardFromSite 展示用主机名保留原样')
eq(siteCard.desc, '代码托管', 'cardFromSite 透传描述')
eq(siteCard.iconUrl, 'https://github.com/favicon.ico', 'cardFromSite 透传图标')
eq(siteCard.source, 'site', 'cardFromSite 标记来源为本地站点')

/* ---- 抓取结果 → 卡片 ---- */
const metaCard = cardFromMeta({
  name: 'Figma', desc: '设计协作', domain: 'www.figma.com',
  color: '#a259ff', faviconUrl: 'https://www.figma.com/favicon.ico',
}, 'https://www.figma.com/x')
eq(metaCard.title, 'Figma', 'cardFromMeta 用抓到的站名')
eq(metaCard.host, 'www.figma.com', 'cardFromMeta 用响应域名作主机名')
eq(metaCard.desc, '设计协作', 'cardFromMeta 透传描述')
eq(metaCard.iconUrl, 'https://www.figma.com/favicon.ico', 'cardFromMeta 图标域名一致时保留')
eq(metaCard.initial, 'F', 'cardFromMeta 首字母取站名')
eq(metaCard.source, 'meta', 'cardFromMeta 标记来源为抓取')

const noNameCard = cardFromMeta({ domain: 'example.com' }, 'https://example.com')
eq(noNameCard.title, 'example.com', 'cardFromMeta 无站名时回落到主机名')
eq(noNameCard.initial, 'E', 'cardFromMeta 回落时首字母取主机名')

const offsiteIcon = cardFromMeta({
  name: 'X', domain: 'x.com', faviconUrl: 'https://cdn.third.com/x.ico',
}, 'https://x.com')
eq(offsiteIcon.iconUrl, '', 'cardFromMeta 图标来自第三方域名时不显示（与入库判据一致）')

eq(cardFromMeta(null, 'https://example.com').title, 'example.com', 'cardFromMeta 空响应回落到主机名')
eq(cardFromMeta({ name: 'X', domain: 'x.com' }, 'https://x.com').color !== '', true, 'cardFromMeta 无配色时派生一个')

/* ---- 状态机 ---- */
eq(resolvePreviewState({ url: '' }).kind, PREVIEW_KIND.IDLE, '无网址 → idle')

const found = resolvePreviewState({
  url: 'https://github.com', duplicate: { id: 'a', name: 'GitHub', url: 'github.com' },
})
eq(found.kind, PREVIEW_KIND.FOUND, '已收录 → found（用本地数据，不必联网）')
eq(found.card.title, 'GitHub', 'found 态卡片来自本地站点')

const loading = resolvePreviewState({ url: 'https://figma.com', loading: true })
eq(loading.kind, PREVIEW_KIND.LOADING, '抓取中 → loading')
eq(loading.card.host, 'figma.com', 'loading 态先给出主机名占位')

const ready = resolvePreviewState({ url: 'https://figma.com', meta: { name: 'Figma', domain: 'figma.com' } })
eq(ready.kind, PREVIEW_KIND.READY, '抓到 → ready')
eq(ready.card.title, 'Figma', 'ready 态卡片来自抓取结果')

const failed = resolvePreviewState({ url: 'https://nope-xyz.com', error: '抓取超时' })
eq(failed.kind, PREVIEW_KIND.ERROR, '失败 → error')
eq(failed.card.host, 'nope-xyz.com', 'error 态仍给出主机名，卡片不空')
eq(failed.message, '抓取超时', 'error 态带上失败原因')

// 已收录优先于抓取中/失败：本地有数据就不该让用户等网络
const dupWins = resolvePreviewState({
  url: 'https://github.com', duplicate: { id: 'a', name: 'GitHub', url: 'github.com' },
  loading: true, error: '抓取超时',
})
eq(dupWins.kind, PREVIEW_KIND.FOUND, '已收录时忽略抓取状态（本地数据优先）')

if (failures.length) {
  console.error(`\n❌ 网址预览测试失败 ${failures.length} 项：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 网址预览全部通过：${pass} 条断言`)
