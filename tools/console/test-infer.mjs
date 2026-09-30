/**
 * shared/site-infer.mjs 用例：全部用内联 fixture，不联网、零依赖。
 * 运行：node tools/console/test-infer.mjs   （或 npm run console:test:infer）
 */
import {
  inferSite, pickName, pickDesc, pickFavicon, pickFaviconPrefer, inferCategory, inferColor,
  normalizeColor, hashColor, domainTokens, decodeHtmlBytes, looksBlocked, metaContent,
  manifestHref, manifestThemeColor,
  BLOCKED_WARNING,
} from '../../shared/site-infer.mjs'

let pass = 0
const failures = []

function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}

function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}

/* ---------------- fixtures ---------------- */

const F = {
  og: `<!doctype html><html><head>
    <meta property="og:site_name" content="OpenAI">
    <meta property="og:title" content="ChatGPT - 免费 AI 对话助手">
    <meta name="description" content="ChatGPT 帮你写作、编程、翻译与问答，打开即用的 AI 助手。">
    <meta name="theme-color" content="#10a37f">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  </head><body></body></html>`,

  paragraph: `<!doctype html><html><head><title>OpenRouter</title></head>
    <body><p>OpenRouter 提供一个统一接口，把请求路由到多家大模型供应商，按量计费。</p></body></html>`,

  bare: `<!doctype html><html><head><title>Tapeout</title></head><body></body></html>`,

  blocked: `<!doctype html><html><head><title>Just a moment...</title></head>
    <body><div id="cf-browser-verification">Enable JavaScript and cookies to continue</div></body></html>`,

  // 带 meta description 的挑战页：description 是拦截文案，看着像正经描述，最容易被采信
  blockedMeta: `<!doctype html><html><head><title>Just a moment...</title>
    <meta name="description" content="Enable JavaScript and cookies to continue">
  </head><body><div id="cf-browser-verification">Checking your browser before accessing</div></body></html>`,

  inlineIcon: `<!doctype html><html><head><title>Inline</title>
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E">
  </head><body></body></html>`,

  suppressedIcon: `<!doctype html><html><head><title>Suppressed</title>
    <link rel="icon" href="data:,">
  </head><body></body></html>`,

  whiteTheme: `<!doctype html><html><head><title>Whitey</title>
    <meta name="theme-color" content="#ffffff">
    <meta name="description" content="一个把 theme-color 声明成纯白的站点，不能拿白色当卡片底色。">
  </head><body></body></html>`,

  nameAsDesc: `<!doctype html><html><head><title>Dupe</title>
    <meta name="description" content="Dupe">
    <meta name="keywords" content="去中心化交易所聚合器，跨链兑换与流动性路由">
  </head><body></body></html>`,

  // 品牌色只写在 manifest 里：页面 <head> 无 meta theme-color，只能靠抓 manifest 拿到
  manifestPage: `<!doctype html><html><head><title>Benchly</title>
    <link rel="manifest" href="/manifest.webmanifest">
  </head><body></body></html>`,
  manifestPageAbs: `<!doctype html><html><head><title>Benchly</title>
    <link rel="manifest" href="https://cdn.example.com/app.webmanifest">
  </head><body></body></html>`,
  manifestData: `<!doctype html><html><head><title>Benchly</title>
    <link rel="manifest" href="data:application/json,%7B%7D">
  </head><body></body></html>`,

  // 按配色方案声明多条 theme-color：两条都不可用（白/近黑），只取第一条会拿到白色
  themeMulti: `<!doctype html><html><head><title>Multi</title>
    <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="#0a0b0d" media="(prefers-color-scheme: dark)">
  </head><body></body></html>`,
  // 第一条不可用、第二条才是品牌色：应取到第二条
  themeSecondUsable: `<!doctype html><html><head><title>Multi2</title>
    <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="#10a37f" media="(prefers-color-scheme: dark)">
  </head><body></body></html>`,

  // 错误页：<title> 语法正常、长度也像品牌名，但描述的是「页面不存在」
  errTitle: `<!doctype html><html><head><title>404 Not Found</title></head><body></body></html>`,

  // 同一份 meta，只是书写顺序颠倒：取值不应再受文档顺序影响
  descOrderA: `<!doctype html><html><head><title>Order</title>
    <meta property="og:description" content="社交分享用的短标语。">
    <meta name="description" content="页面摘要写得详细得多，用来验证取值不再由文档顺序决定。">
  </head><body></body></html>`,
  descOrderB: `<!doctype html><html><head><title>Order</title>
    <meta name="description" content="页面摘要写得详细得多，用来验证取值不再由文档顺序决定。">
    <meta property="og:description" content="社交分享用的短标语。">
  </head><body></body></html>`,

  // 子页 + 主域名首页：收录的永远是主域名，站点级元信息应以主域名为准
  subPage: `<!doctype html><html><head>
    <title>Windows 代理客户端推荐与对比：51 款工具 | 华润赢</title>
    <meta property="og:site_name" content="华润赢·翻墙应用商店">
    <meta name="description" content="浏览并比较 51 款 Windows 代理客户端，其中 40 款开源。">
  </head><body></body></html>`,
  subRoot: `<!doctype html><html><head>
    <title>华润赢 · 翻墙应用商店与代理客户端大全</title>
    <meta property="og:site_name" content="华润赢">
    <meta name="description" content="华润赢代理客户端大全收录 166 款 Android、iOS、Windows、macOS、Linux 工具，可按平台与内核比较。">
    <meta name="theme-color" content="#a855f7">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  </head><body></body></html>`,
}

// 分类表是「白名单」：推断出的分类必须登记在这里才会被采纳（防止写进脏 categoryId）。
// cex 必须登记，否则 c7 用例会因分类未登记而被丢弃，测不出中文词匹配逻辑。
const CATEGORY_META = {
  aiapi: { label: 'AI API 平台', color: '#2563eb' },
  dex: { label: '去中心化交易所 DEX', color: '#ff007a' },
  data: { label: '数据与研究', color: '#3861fb' },
  cex: { label: '交易所 CEX', color: '#f0b90b' },
  learning: { label: '学习与前沿', color: '#ef4444' },
  airdrop: { label: '空投/Airdrop', color: '#ff6a00' },
  domain: { label: '域名服务', color: '#8b5cf6' },
  proxy: { label: '代理/VPN', color: '#a855f7' },
  cloud: { label: '云服务器/VPS', color: '#3b82f6' },
}

/* ---------------- 名称 ---------------- */

const n1 = pickName(F.og, 'chat.openai.com')
eq(n1.name, 'OpenAI', 'og:site_name 优先于带标语的长标题')
eq(n1.confidence, 'high', 'og:site_name 命中域名品牌词 → high')

const n2 = pickName(F.bare, 'tapeout.link')
eq(n2.name, 'Tapeout', '标题可用时取标题')
eq(n2.confidence, 'high', '标题与域名品牌词精确一致 → high')

const n3 = pickName('<html></html>', 'app.qfex.com')
eq(n3.name, 'Qfex', '无任何标题时退回域名主体并首字母大写')
eq(n3.confidence, 'low', '域名兜底 → low')

const n4 = pickName(F.blocked, 'protected.example.com', { skipTitle: true })
eq(n4.name, 'Protected', '挑战页跳过 <title>，退回域名取名')

// 错误页 <title> 语法正常、长度也像品牌名（"404 Not Found"），不加过滤会被当成好候选写进卡片
const nErr = pickName(F.errTitle, 'errpage.xyz')
eq(nErr.name, 'Errpage', '错误页标题被剔除，退回域名取名')
eq(nErr.source, 'domain', '错误页标题不进入候选，来源为 domain')
const nOk = pickName('<title>Proxy404</title>', 'proxy404.example')
eq(nOk.name, 'Proxy404', '数字粘在词上的站名（Proxy404）不被状态码规则误伤')

/* ---------------- 描述 ---------------- */

eq(pickDesc(F.og, { name: 'OpenAI', host: 'chat.openai.com' }).source, 'meta', 'meta description 首选')
eq(pickDesc(F.paragraph, { name: 'OpenRouter', host: 'openrouter.ai' }).source, 'paragraph', '无 meta 时取正文首段')
eq(pickDesc(F.bare, { name: 'Tapeout', host: 'tapeout.link' }).source, 'generated', '全无描述时走生成兜底')
eq(pickDesc(F.nameAsDesc, { name: 'Dupe', host: 'dupe.example' }).source, 'keywords', '描述与站名相同时降级到 keywords')

const dGenerated = pickDesc(F.bare, { name: 'Tapeout', host: 'tapeout.link', categoryLabel: '设计灵感' })
ok(dGenerated.desc.length > 0, '生成兜底描述非空（addSite 要求 desc 必填）')
ok(dGenerated.desc.includes('Tapeout'), '生成兜底描述包含站名')

// 挑战页的 meta description 是 "Enable JavaScript and cookies to continue" 这类拦截文案，
// 看着像正经描述，采信它就是写脏数据 —— blocked 时必须短路到生成兜底
const dBlockedOff = pickDesc(F.blockedMeta, { name: 'Protected', host: 'protected.example.com' })
eq(dBlockedOff.source, 'meta', '对照：未标记 blocked 时会采信挑战页的 meta 描述')
const dBlocked = pickDesc(F.blockedMeta, { name: 'Protected', host: 'protected.example.com', blocked: true })
eq(dBlocked.source, 'generated', 'blocked 时短路到生成兜底，不采信挑战页描述')
ok(!/enable javascript/i.test(dBlocked.desc), 'blocked 生成的描述不含拦截页文案')
ok(BLOCKED_WARNING.length > 0 && BLOCKED_WARNING.includes('复核'), 'BLOCKED_WARNING 文案可导出且要求复核')

// 同一份 meta 只调换书写顺序：取值应固定按 description > og:description，且同组取最长，
// 不再由「文档里谁先出现」决定（否则社交分享短标语会盖掉信息量更大的页面摘要）
const dOrderA = pickDesc(F.descOrderA, { name: 'Order' })
const dOrderB = pickDesc(F.descOrderB, { name: 'Order' })
eq(dOrderA.desc, dOrderB.desc, '描述取值不受 meta 标签书写顺序影响')
eq(dOrderA.desc, '页面摘要写得详细得多，用来验证取值不再由文档顺序决定。', 'description 优先于 og:description')

/* ---------------- 图标 ---------------- */

eq(pickFavicon(F.og, 'https://chat.openai.com/'), 'https://chat.openai.com/apple-touch-icon.png', 'apple-touch-icon 优先')
eq(pickFavicon(F.inlineIcon, 'https://inline.example/'), "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E", '内联 data:image 原样返回')
eq(pickFavicon(F.suppressedIcon, 'https://sup.example/'), 'https://sup.example/favicon.ico', 'data:, 视为未声明，回退 /favicon.ico')
eq(pickFavicon('<html></html>', 'https://none.example/'), 'https://none.example/favicon.ico', '完全无声明时回退 /favicon.ico')

// 多页取图标：pickFavicon 永远返回兜底 /favicon.ico，所以「有没有声明」要靠「是否等于兜底」判断，
// 否则子页没声明时根页声明的 apple-touch-icon 永远轮不到
eq(pickFaviconPrefer([F.bare, F.og], 'https://chat.openai.com/'), 'https://chat.openai.com/apple-touch-icon.png', '子页未声明图标时回退根页声明的图标')
eq(pickFaviconPrefer([F.og, F.bare], 'https://chat.openai.com/'), 'https://chat.openai.com/apple-touch-icon.png', '子页声明了图标则优先用子页的')
eq(pickFaviconPrefer([F.bare, F.bare], 'https://bare.example/'), 'https://bare.example/favicon.ico', '两页都无声明时回退 /favicon.ico')

/* ---------------- 配色 ---------------- */

eq(normalizeColor('#10A37F'), '#10a37f', '十六进制归一化为小写')
eq(normalizeColor('#fff'), '', '近白色被弃用')
eq(normalizeColor('#000'), '', '近黑色被弃用')
eq(normalizeColor('rgb(16, 163, 127)'), '#10a37f', 'rgb() 转十六进制')
eq(normalizeColor('rgba(0,0,0,0)'), '', '全透明被弃用')
eq(normalizeColor('not-a-color'), '', '非法值返回空')
ok(/^#[0-9a-f]{6}$/.test(hashColor('example.com')), '散列色格式正确')
eq(hashColor('example.com'), hashColor('example.com'), '散列色对同一域名稳定')

eq(inferColor({ themeColor: '#10a37f', categoryColor: '#2563eb', seed: 'x' }).source, 'meta', 'theme-color 优先于分类色')
eq(inferColor({ themeColor: '#ffffff', categoryColor: '#2563eb', seed: 'x' }).color, '#2563eb', '白色 theme-color 弃用后回退分类色')
eq(inferColor({ categoryColor: '', seed: 'x' }).source, 'hash', '无任何线索时用散列色')

/* ---------------- manifest 取色 ---------------- */

eq(manifestHref(F.manifestPage, 'https://benchly.example/'), 'https://benchly.example/manifest.webmanifest', '定位并解析相对 manifest 地址')
eq(manifestHref(F.manifestPageAbs, 'https://benchly.example/'), 'https://cdn.example.com/app.webmanifest', '保留 manifest 的绝对地址')
eq(manifestHref(F.manifestData, 'https://benchly.example/'), '', 'data: 形式的 manifest 被忽略')
eq(manifestHref(F.bare, 'https://bare.example/'), '', '未声明 manifest 时返回空')

eq(manifestThemeColor('{"theme_color":"#7a2e1f"}'), '#7a2e1f', '解析 manifest theme_color')
eq(manifestThemeColor('{"name":"x"}'), '', 'manifest 无 theme_color 时返回空')
eq(manifestThemeColor('<html>not json</html>'), '', 'manifest 非 JSON 时返回空')
eq(manifestThemeColor(''), '', '空 manifest 返回空')

// meta theme-color 仍是第一优先；只有它缺失（或为白色被弃用）时才轮到 manifest
eq(inferColor({ manifestTheme: '#7a2e1f', categoryColor: '#2563eb', seed: 'x' }).source, 'manifest', '无 meta theme-color 时用 manifest 主题色')
eq(inferColor({ themeColor: '#10a37f', manifestTheme: '#7a2e1f', categoryColor: '#2563eb', seed: 'x' }).color, '#10a37f', 'meta theme-color 优先于 manifest')
eq(inferColor({ themeColor: '#ffffff', manifestTheme: '#7a2e1f', categoryColor: '#2563eb', seed: 'x' }).color, '#7a2e1f', '白色 meta theme-color 弃用后回退 manifest 主题色')
eq(inferColor({ manifestTheme: '#7a2e1f', tileColor: '#1a1a1a', categoryColor: '#2563eb', seed: 'x' }).color, '#7a2e1f', 'manifest 主题色优先于 msapplication tile 色')
eq(inferColor({ manifestTheme: '#ffffff', categoryColor: '#2563eb', seed: 'x' }).color, '#2563eb', '白色 manifest 主题色同样被弃用，回退分类色')

/* ---------------- 分类 ---------------- */

eq(domainTokens('chat.openai.com').join(','), 'chat,openai', '域名拆词去掉 TLD')
eq(domainTokens('www.qfex.com').join(','), 'qfex', '去掉 www 前缀')
eq(domainTokens('example.co.uk').join(','), 'example', '识别 co.uk 这类二级后缀')

const EXISTING = [
  { id: 'dx1', name: 'Uniswap', url: 'uniswap.org', categoryId: 'dex' },
  { id: 'aiapi9', name: 'DeepSeek', url: 'deepseek.com', categoryId: 'aiapi' },
]

const c1 = inferCategory({ name: 'Something', domain: 'app.uniswap.org' }, EXISTING, CATEGORY_META)
eq(c1.categoryId, 'dex', '同族域名命中已有站点分类')
eq(c1.confidence, 'high', '同族域名 → high')

const c2 = inferCategory({ name: 'DeepSeek Chat', domain: 'chat.deepseek.com' }, EXISTING, CATEGORY_META)
eq(c2.categoryId, 'aiapi', '品牌词/同族域名命中 AI API 平台')

const c3 = inferCategory({ name: 'ChatGPT', desc: '免费 AI 对话助手', domain: 'chat.openai.com' }, [], CATEGORY_META)
eq(c3.categoryId, 'aiapi', '纯关键词命中')

const c4 = inferCategory({ name: 'Mystery', desc: '一个没什么线索的站点', domain: 'mystery-xyz.example' }, [], CATEGORY_META, { fallback: 'data' })
eq(c4.categoryId, 'data', '无信号时走调用方给的兜底分类')
eq(c4.confidence, 'low', '无信号 → low')

const c5 = inferCategory({ name: 'Legacy', domain: 'app.legacy.example' }, [{ id: 'z1', name: 'Legacy', url: 'legacy.example', categoryId: 'gone' }], CATEGORY_META)
eq(c5.categoryId, '', '推断到未登记分类时丢弃，不写进脏数据')

// 站名/域名里不能带品牌词，否则 aiapi 会因品牌命中而胜出，测不出「account 未参与匹配」这件事
const c6 = inferCategory({ name: 'Assistant Hub', desc: 'Sign in to your account to continue using the assistant', domain: 'assistant-hub.example' }, [], CATEGORY_META)
eq(c6.categoryId, '', '描述里的通用英文词 account 不参与 ASCII 关键词匹配')

const c7 = inferCategory({ name: '某某平台', desc: '全球领先的数字货币交易平台，支持现货与合约', domain: 'abc-xyz.example' }, [], CATEGORY_META)
eq(c7.categoryId, 'cex', '描述里的中文定性词「交易所/平台」可以参与匹配')

const c8 = inferCategory({ name: 'Chat App', domain: 'chat.example.com' }, [{ id: 's1', name: 'ChatGPT', url: 'chat.openai.com', categoryId: 'starter' }], CATEGORY_META)
eq(c8.categoryId, '', 'chat 不因被 chatgpt 包含而误继承 ChatGPT 的分类')

// 同分平局按 CATEGORY_HINTS 声明顺序，不再按字母序（'airdrop' < 'learning' 会错选空投）
const c9 = inferCategory({ name: 'Learn & Earn', domain: 'learn-earn.example' }, [], CATEGORY_META)
eq(c9.categoryId, 'learning', '同分平局按声明顺序：learning 先于 airdrop')

// 品牌词权重高于泛词：域名含 cloudflare 是「域名服务」，不该被判成「云服务器」
const c10 = inferCategory({ name: 'Cloudflare', domain: 'cloudflare.com' }, [], CATEGORY_META)
eq(c10.categoryId, 'domain', '品牌词命中（cloudflare）压过泛词 cloud')

// 中文泛词必须是词组：'多节点部署' 不该命中 '节点订阅'，否则任何提「节点」的站点都会变代理
const c11 = inferCategory({ name: '工具箱', desc: '支持浏览器扩展与多节点部署，提升效率', domain: 'toolbox-xyz.example' }, [], CATEGORY_META)
eq(c11.categoryId, '', '中文泛词按词组匹配，不因裸词「节点/浏览器」误判')

/* ---------------- 端到端 ---------------- */

const e1 = inferSite({ html: F.og, url: 'https://chat.openai.com', existingSites: [], categoryMeta: CATEGORY_META })
eq(e1.name, 'OpenAI', '端到端：站名')
eq(e1.desc, 'ChatGPT 帮你写作、编程、翻译与问答，打开即用的 AI 助手。', '端到端：描述')
eq(e1.color, '#10a37f', '端到端：配色')
eq(e1.domain, 'chat.openai.com', '端到端：域名去 www')
eq(e1.categoryId, 'aiapi', '端到端：分类')
eq(e1.categoryLabel, 'AI API 平台', '端到端：分类中文名')
eq(e1.faviconUrl, 'https://chat.openai.com/apple-touch-icon.png', '端到端：图标')
eq(e1.blocked, false, '端到端：非挑战页')
ok(e1.name && e1.desc && e1.color && e1.categoryId, '端到端：只给网址即产出全部必填字段')

const e2 = inferSite({ html: F.blocked, url: 'protected.example.com', categoryMeta: CATEGORY_META })
eq(e2.blocked, true, '端到端：识别反爬挑战页')
ok(e2.name !== 'Just a moment...', '端到端：挑战页不把 "Just a moment..." 当站名')

const e2b = inferSite({ html: F.blockedMeta, url: 'protected2.example', categoryMeta: CATEGORY_META })
eq(e2b.blocked, true, '端到端：带 meta description 的挑战页同样被识别')
eq(e2b.sources.desc, 'generated', '端到端：挑战页描述走生成兜底')
ok(!/enable javascript/i.test(e2b.desc), '端到端：挑战页描述不含拦截文案')

const e3 = inferSite({ html: F.whiteTheme, url: 'whitey.example', categoryMeta: CATEGORY_META, fallbackCategory: 'data' })
eq(e3.color, '#3861fb', '端到端：白色主题色回退到分类色')
eq(e3.categoryId, 'data', '端到端：无信号走兜底分类')
eq(e3.scope.desc, 'page', '端到端：未传根页时字段来源标记为子页')

// 页面无 meta theme-color、品牌色只在 manifest 里（调用方抓 manifest 后传入 theme_color）
const eManifest = inferSite({ html: F.manifestPage, manifestTheme: '#7a2e1f', url: 'https://benchly.example/', categoryMeta: CATEGORY_META })
eq(eManifest.color, '#7a2e1f', '端到端：manifest 主题色落库为卡片主色')
eq(eManifest.sources.color, 'manifest', '端到端：配色来源标记为 manifest')
eq(eManifest.confidence.color, 'high', '端到端：manifest 主题色置信度为 high')

// 贴子页时补抓主域名首页：收录的永远是主域名，站点级元信息应以主域名为准，
// 否则 /platform/windows 会把整站描述写成「51 款 Windows 客户端」，而卡片链接指向主域名
const eSub = inferSite({ html: F.subPage, rootHtml: F.subRoot, url: 'https://huarun.win/platform/windows', categoryMeta: CATEGORY_META })
eq(eSub.name, '华润赢', '端到端：站名取根页 og:site_name（非子页长标题）')
eq(eSub.scope.name, 'root', '端到端：站名来源标记为根页')
eq(eSub.desc, '华润赢代理客户端大全收录 166 款 Android、iOS、Windows、macOS、Linux 工具，可按平台与内核比较。', '端到端：描述取根页整站口径而非子页窄化描述')
eq(eSub.scope.desc, 'root', '端到端：描述来源标记为根页')
eq(eSub.faviconUrl, 'https://huarun.win/apple-touch-icon.png', '端到端：子页未声明图标时回退根页声明的图标')

// 只有「所有页都被拦截」才算被拦截：根页挑战页、子页正常时手上仍有真实内容
const eMix = inferSite({ html: F.og, rootHtml: F.blocked, url: 'https://chat.openai.com', categoryMeta: CATEGORY_META })
eq(eMix.blocked, false, '端到端：仅根页被拦截时不判整体 blocked')
eq(eMix.name, 'OpenAI', '端到端：根页被拦截时改用子页取名')

/* ---------------- 抓不到页面时沿用已收录站名 ---------------- */

const KNOWN = [{ id: 's1', name: 'ChatGPT', url: 'chat.openai.com', categoryId: 'aiapi' }]

const k1 = inferSite({ html: '', url: 'https://chat.openai.com', existingSites: KNOWN, categoryMeta: CATEGORY_META })
eq(k1.name, 'ChatGPT', '抓不到页面时沿用已收录的同域名站名（而非拼成 Openai）')
eq(k1.sources.name, 'known', '来源标注为 known')
eq(k1.confidence.name, 'high', '精确同域名沿用 → high')
ok(k1.desc.includes('ChatGPT'), '描述兜底也用上了沿用的站名')

const k2 = inferSite({ html: '', url: 'https://app.uniswap.org', existingSites: [{ id: 'dx1', name: 'Uniswap', url: 'uniswap.org', categoryId: 'dex' }], categoryMeta: CATEGORY_META })
eq(k2.name, 'Uniswap', '同族域名沿用已收录站名')
eq(k2.confidence.name, 'medium', '同族域名沿用 → medium（不如精确同域名确定）')

const k3 = inferSite({ html: F.bare, url: 'https://tapeout.link', existingSites: KNOWN, categoryMeta: CATEGORY_META })
eq(k3.name, 'Tapeout', '有可用标题时不被已收录站名覆盖')

/* ---------------- 编码 ---------------- */

eq(decodeHtmlBytes(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4])), '中文', 'gb18030 字节正确回退解码')
eq(decodeHtmlBytes(new TextEncoder().encode('<title>中文</title>')), '<title>中文</title>', 'UTF-8 原样解码')

/* ---------------- 杂项 ---------------- */

eq(metaContent('<meta content="x" name="description">', ['description']), 'x', '兼容 content 写在 name 之前的页面')
ok(looksBlocked('Checking your browser before accessing'), '识别 Cloudflare 拦截页')
ok(!looksBlocked('<html><title>正常站点</title></html>'), '正常页不误判')

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ ${failures.length} 条断言失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ site-infer 全部通过：${pass} 条断言`)