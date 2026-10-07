/**
 * 站点草稿工具：自动添加管道与「添加站点」弹窗共用的判据。
 * 只测纯函数 —— src/stores 与 src/services 引 @/ 别名，纯 node 加载不了。
 */
import {
  AUTO_ADD_REASON, rawHostOf, domainOf, parseAliases, findDuplicate,
  buildSiteFromDraft, draftFromMeta, preflightOf, metaGuardrailOf,
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

/* ---- 元数据 → 草稿 ---- */
const fromMeta = draftFromMeta({
  name: 'GitHub', desc: 'd', categoryId: 'c1', color: '#222222',
  purposes: ['coding', 'not-a-real-purpose'], faviconUrl: 'https://github.com/f.ico', domain: 'github.com',
})
eq(fromMeta.form.name, 'GitHub', 'draftFromMeta 透传站名')
eq(fromMeta.form.url, 'github.com', 'draftFromMeta 用响应域名作 url')
eq(fromMeta.faviconHost, 'github.com', 'draftFromMeta 记录图标来源域名')
eq(fromMeta.form.purposes.length, 1, 'draftFromMeta 用途经 normalizePurposes 过滤')

/* ---- 发请求前的把关 ---- */
eq(preflightOf({ url: '不是网址', duplicate: null })?.reason, AUTO_ADD_REASON.INVALID_URL, 'preflightOf 拦下不像网址的输入')
eq(preflightOf({ url: 'https://github.com', duplicate: lib[0] })?.reason, AUTO_ADD_REASON.DUPLICATE, 'preflightOf 拦下已收录域名')
eq(preflightOf({ url: 'https://github.com', duplicate: null }), null, 'preflightOf 正常网址放行')

/* ---- 抓取结果的把关 ---- */
eq(metaGuardrailOf({ meta: null })?.reason, AUTO_ADD_REASON.FETCH_FAILED, 'metaGuardrailOf 抓取失败时拦下')
eq(metaGuardrailOf({ meta: { name: '  ' } })?.reason, AUTO_ADD_REASON.LOW_CONFIDENCE, 'metaGuardrailOf 站名为空时拦下')
eq(metaGuardrailOf({ meta: { name: 'GitHub', confidence: { name: 'low' } } })?.reason, AUTO_ADD_REASON.LOW_CONFIDENCE, 'metaGuardrailOf 名称低置信时拦下')
eq(metaGuardrailOf({ meta: { name: 'GitHub', confidence: { name: 'high' } } }), null, 'metaGuardrailOf 名称可信时放行')

if (failures.length) {
  console.error(`\n❌ 站点草稿工具测试失败 ${failures.length} 项：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 站点草稿工具全部通过：${pass} 条断言`)
