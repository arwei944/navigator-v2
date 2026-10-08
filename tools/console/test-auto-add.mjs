/**
 * 站点草稿工具：自动添加管道与「添加站点」弹窗共用的判据。
 * 只测纯函数 —— src/stores 与 src/services 引 @/ 别名，纯 node 加载不了。
 */
import {
  AUTO_ADD_REASON, rawHostOf, domainOf, parseAliases, findDuplicate,
  buildSiteFromDraft, preflightOf, fallbackDraftFromMeta, colorFromHost,
} from '../../src/utils/siteDraft.js'

let pass = 0
const failures = []
function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}

/* ---- 域名口径 ---- */
eq(rawHostOf('https://www.GitHub.com/a/b'), 'www.GitHub.com', 'rawHostOf 去协议去路径、保留大小写')
eq(domainOf('https://www.GitHub.com/a/b'), 'github.com', 'domainOf 小写去 www')
eq(domainOf('github.com'), 'github.com', 'domainOf 无协议可解析')
eq(domainOf(''), '', 'domainOf 空值返回空串')

/* ---- 别名归一 ---- */
const aliasOut = parseAliases('GitHub,  GitHub、github.com\n代码托管', 'GitHub', 'github.com')
eq(aliasOut.length, 1, 'parseAliases 去重并剔除站名/域名后只剩 1 条')
eq(aliasOut[0], '代码托管', 'parseAliases 保留有效别名')

/* ---- 同域去重 ---- */
const lib = [{ id: 'a', url: 'github.com' }, { id: 'b', url: 'gitlab.com' }]
eq(findDuplicate(lib, 'https://www.github.com/')?.id, 'a', 'findDuplicate 命中同域（忽略 www 与协议）')
eq(findDuplicate(lib, 'gitee.com'), null, 'findDuplicate 未收录返回 null')

/* ---- 草稿 → 站点对象（三条既有规则） ---- */
const draft = {
  form: {
    name: 'GitHub', url: 'https://www.github.com/x', desc: 'd',
    categoryId: 'c1', color: '#111111', aliases: '', purposes: ['coding'],
  },
  faviconUrl: 'https://github.com/favicon.ico',
  faviconHost: 'github.com',
}
const built = buildSiteFromDraft(draft)
eq(built.site.url, 'www.github.com', 'buildSiteFromDraft url 保留 www 与大小写、去协议去路径')
eq(built.domain, 'github.com', 'buildSiteFromDraft 返回去重域名')
eq(built.site.initial, 'G', 'buildSiteFromDraft initial 取首字符大写')
eq(built.site.iconUrl, 'https://github.com/favicon.ico', 'buildSiteFromDraft 图标域名一致时写入 iconUrl')
ok(!('aliases' in built.site), 'buildSiteFromDraft 无有效别名时不写 aliases 字段')

const otherHost = buildSiteFromDraft({ ...draft, faviconHost: 'cdn.example.com' })
ok(!('iconUrl' in otherHost.site), 'buildSiteFromDraft 图标域名不一致时不写 iconUrl')

const noName = buildSiteFromDraft({ form: { ...draft.form, name: '' } })
eq(noName.site.initial, '', 'buildSiteFromDraft 站名为空时 initial 为空串')

/* ---- 发请求前的把关：只判网址，不再管抓取结果 ---- */
eq(preflightOf({ url: '不是网址' })?.reason, AUTO_ADD_REASON.INVALID_URL, 'preflightOf 拦下不像网址的输入')
eq(preflightOf({ url: 'https://github.com' }), null, 'preflightOf 正常网址放行')
ok(!('FETCH_FAILED' in AUTO_ADD_REASON), '抓取失败已不再拦下，原因码退役')
ok(!('LOW_CONFIDENCE' in AUTO_ADD_REASON), '站名低置信已不再拦下，原因码退役')
eq(AUTO_ADD_REASON.WRITE_FAILED, 'write-failed', '保留写库失败原因码')

/* ---- 元数据 → 草稿（正常路径） ---- */
const okMeta = fallbackDraftFromMeta({
  url: 'https://www.github.com/x',
  meta: {
    name: 'GitHub', desc: 'd', categoryId: 'coding', color: '#222222',
    purposes: ['coding', 'not-a-real-purpose'], faviconUrl: 'https://github.com/f.ico', domain: 'github.com',
    confidence: { name: 'high' },
  },
  categoryId: 'coding',
})
eq(okMeta.form.name, 'GitHub', 'fallbackDraftFromMeta 透传可信站名')
eq(okMeta.form.url, 'github.com', 'fallbackDraftFromMeta 用响应域名作 url')
eq(okMeta.form.categoryId, 'coding', 'fallbackDraftFromMeta 用调用方解析出的分类')
eq(okMeta.form.purposes.length, 1, 'fallbackDraftFromMeta 用途经 normalizePurposes 过滤')
eq(okMeta.faviconHost, 'github.com', 'fallbackDraftFromMeta 记录图标来源域名')

/* ---- 抓取失败 → 域名兜底照常出草稿 ---- */
const noMeta = fallbackDraftFromMeta({ url: 'https://www.GitHub.com/x', meta: null })
eq(noMeta.form.name, 'www.GitHub.com', '抓取失败用域名兜底命名')
eq(noMeta.form.url, 'www.GitHub.com', '抓取失败仍存主机名')
eq(noMeta.form.desc, '', '抓取失败描述为空')
eq(noMeta.form.categoryId, '', '抓取失败分类由决策层决定，此处不写')
eq(noMeta.faviconUrl, '', '抓取失败不挂图标来源')
const noMetaBuilt = buildSiteFromDraft(noMeta)
ok(!('iconUrl' in noMetaBuilt.site), '图标来源域名为空时不写 iconUrl')
eq(noMetaBuilt.domain, 'github.com', '抓取失败仍算出去重域名')

/* ---- 站名不可靠 → 域名兜底命名 ---- */
const lowName = fallbackDraftFromMeta({
  url: 'https://suno.ai',
  meta: { name: 'Suno', domain: 'suno.ai', confidence: { name: 'low' } },
})
eq(lowName.form.name, 'suno.ai', '名称低置信时用域名兜底命名')
const noName2 = fallbackDraftFromMeta({
  url: 'https://suno.ai',
  meta: { name: '   ', domain: 'suno.ai' },
})
eq(noName2.form.name, 'suno.ai', '名称为空时用域名兜底命名')

/* ---- 兜底配色：同域稳定、不同域不同 ---- */
ok(/^#[0-9a-f]{6}$/.test(noMeta.form.color), '兜底色是合法十六进制色值')
eq(noMeta.form.color, fallbackDraftFromMeta({ url: 'https://www.GitHub.com/y', meta: null }).form.color,
  '同一域名每次兜底色一致')
eq(colorFromHost('a.com') === colorFromHost('b.com'), false, '不同域名兜底色不同')

if (failures.length) {
  console.error(`\n❌ 站点草稿工具测试失败 ${failures.length} 项：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 站点草稿工具全部通过：${pass} 条断言`)
