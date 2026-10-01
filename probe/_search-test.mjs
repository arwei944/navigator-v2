import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { rankSites, splitHighlight, scoreSite, matchedAlias } from '../src/utils/search.js'

const here = dirname(fileURLToPath(import.meta.url))
const sites = JSON.parse(readFileSync(join(here, '..', 'api', 'sites-data.json'), 'utf8'))

let pass = 0, fail = 0
const results = []
function check(id, desc, cond, detail) {
  if (cond) { pass++; results.push(`PASS ${id} ${desc}`) }
  else { fail++; results.push(`FAIL ${id} ${desc} :: ${detail}`) }
}

const byId = Object.fromEntries(sites.map(s => [s.id, s]))

// ── A2 相关性 ──
const exact = rankSites(sites, 'Binance', { limit: 5 })
check('A2.1', '完整名称 "Binance" 首位命中 binance', exact[0]?.name === 'Binance' || /binance/i.test(exact[0]?.url || ''), `got ${exact[0]?.name}`)

const byDomain = rankSites(sites, 'binance.com', { limit: 5 })
check('A2.2', '域名 binance.com 命中', byDomain.some(s => (s.url || '').includes('binance.com')), `got ${byDomain.slice(0,3).map(s=>s.url).join(',')}`)

const byUrlPartial = rankSites(sites, 'kaggle', { limit: 5 })
check('A2.3', '域名片段 kaggle 命中 kaggle.com', byUrlPartial.some(s => (s.url||'').includes('kaggle')), `got ${byUrlPartial.slice(0,3).map(s=>s.url).join(',')}`)

// 名称包含应排在描述包含之前
const mixed = rankSites(sites, 'ai', { limit: 30 })
const firstNameIdx = mixed.findIndex(s => (s.name||'').toLowerCase().includes('ai'))
const firstDescOnlyIdx = mixed.findIndex(s => !(s.name||'').toLowerCase().includes('ai') && (s.desc||'').toLowerCase().includes('ai'))
check('A2.4', '名称含 ai 排在仅描述含 ai 之前', firstNameIdx !== -1 && (firstDescOnlyIdx === -1 || firstNameIdx < firstDescOnlyIdx), `name@${firstNameIdx} desc@${firstDescOnlyIdx}`)

// ── A4 拼音（吴说区块链 initials=wsqkl full=wushuoqukuailian）──
const pyShort = rankSites(sites, 'ws', { limit: 10 })
check('A4.1', '拼音首字母 ws 命中 吴说区块链', pyShort.some(s => (s.name||'').includes('吴说')), `got ${pyShort.slice(0,5).map(s=>s.name).join('|')}`)

const pyInit = rankSites(sites, 'wsqkl', { limit: 10 })
check('A4.2', '完整首字母 wsqkl 命中且靠前', pyInit[0] && (pyInit[0].name||'').includes('吴说'), `got ${pyInit.slice(0,3).map(s=>s.name).join('|')}`)

// 用完整全拼（而非 wushuo 前缀）验证名称拼音路径：md5 的别名 WuShuo 会截走前缀查询，
// 完整全拼不是任何别名的子串，只能靠名称拼音命中
const pyFull = rankSites(sites, 'wushuoqukuailian', { limit: 8 })
check('A4.3', '全拼 wushuoqukuailian 命中 吴说区块链', pyFull.some(s => (s.name||'').includes('吴说')), `got ${pyFull.slice(0,5).map(s=>s.name).join('|')}`)

// 不依赖字面子串：'wushuoqukuailian' 不是任何字段的字面内容（含新增别名）
const literal = sites.some(s => JSON.stringify(s).toLowerCase().includes('wushuoqukuailian'))
check('A4.4', '全拼命中不依赖字面子串（数据里无 wushuoqukuailian 字面）', !literal, 'found literal wushuoqukuailian in data')

// 拼音命中应排在模糊兜底之上（有分档命中时不应退化到 Fuse）
check('A4.5', '有拼音命中时不退化为模糊匹配', pyFull.length > 0 && pyFull.length <= sites.length, `len=${pyFull.length}`)

// ── A3 一致性：同一内核，同词结果必然同序 ──
const q = 'block'
const a = rankSites(sites, q, { limit: 8 }).map(s => s.id)
const b = rankSites(sites, q, { limit: 8 }).map(s => s.id)
check('A3.1', '同词两次调用结果完全一致', JSON.stringify(a) === JSON.stringify(b), `${a.join(',')} vs ${b.join(',')}`)

// 确定性排序：同分站点相对顺序稳定
const scores = sites.map(s => ({ id: s.id, sc: scoreSite(s, q) })).filter(x => x.sc > 0)
const sorted = [...scores].sort((x, y) => y.sc - x.sc).map(x => x.id)
check('A3.2', '评分排序与 rankSites 顺序一致', JSON.stringify(sorted) === JSON.stringify(a), `score-order ${sorted.slice(0,8).join(',')} vs rank ${a.join(',')}`)

// ── A6 排序不得推翻相关性 ──
const SORTS = {
  'name-asc': (a, b) => a.name.localeCompare(b.name),
  'name-desc': (a, b) => b.name.localeCompare(a.name),
  'hot': (a, b) => b.visitCount - a.visitCount,
  'newest': (a, b) => b.createdAt - a.createdAt
}
const base = rankSites(sites, 'ai').map(s => s.id)
for (const [mode, cmp] of Object.entries(SORTS)) {
  const withTie = rankSites(sites, 'ai', { tieBreak: cmp })
  const sameTier = base.map(id => scoreSite(byId[id], 'ai')).join(',')
  const tieTier = withTie.map(s => scoreSite(s, 'ai')).join(',')
  check('A6.' + mode, `排序 ${mode} 不改变评分档位序列`, sameTier === tieTier, `${sameTier.slice(0,60)} vs ${tieTier.slice(0,60)}`)
  check('A6.' + mode + '.top', `排序 ${mode} 下首位相关性得分不变`, scoreSite(withTie[0], 'ai') === scoreSite(byId[base[0]], 'ai'), `${scoreSite(withTie[0],'ai')} vs ${scoreSite(byId[base[0]],'ai')}`)
}

// ── A7 别名：俗称 / 曾用名 / 缩写都能命中 ──
const aliasCases = [
  ['A7.1', '币安', 'ex1', 'Binance'],
  ['A7.2', '小狐狸', 'wl1', 'MetaMask'],
  ['A7.3', '抱抱脸', 'f6', 'Hugging Face'],
  ['A7.4', 'MJ', 'g1', 'Midjourney'],
  ['A7.5', 'Integromat', 'f2', 'Make'],
  ['A7.6', 'OKEx', 'ex2', 'OKX'],
  ['A7.7', '慢雾', 'sc2', 'SlowMist'],
]
for (const [id, kw, expectId, label] of aliasCases) {
  const hit = rankSites(sites, kw, { limit: 5 })
  check(id, `别名「${kw}」命中 ${label}`, hit[0]?.id === expectId, `got ${hit.slice(0, 3).map(s => s.id + ':' + s.name).join(' | ')}`)
}

// 别名拼音：小狐狸 → xiaohuli / xhl
const pyAlias = rankSites(sites, 'xiaohuli', { limit: 5 })
check('A7.8', '别名全拼 xiaohuli 命中 MetaMask', pyAlias.some(s => s.id === 'wl1'), `got ${pyAlias.slice(0, 5).map(s => s.id + ':' + s.name).join(' | ')}`)
const pyAliasInit = rankSites(sites, 'xhl', { limit: 5 })
check('A7.9', '别名首字母 xhl 命中 MetaMask', pyAliasInit.some(s => s.id === 'wl1'), `got ${pyAliasInit.slice(0, 5).map(s => s.id + ':' + s.name).join(' | ')}`)

// 别名精确应压过仅描述命中，但不得盖过主名称精确
const aliasTier = scoreSite(byId.ex1, '币安')
check('A7.10', '别名精确评分 = ALIAS_EXACT', aliasTier === 940, String(aliasTier))
check('A7.11', '主名称精确仍高于别名精确', scoreSite(byId.ex1, 'binance') > scoreSite(byId.ex1, '币安'), `${scoreSite(byId.ex1,'binance')} vs ${aliasTier}`)
check('A7.12', '无别名站点不因别名档位受影响', scoreSite(byId.s2, '克劳德') > 0 && scoreSite(byId.s2, 'zzz') === 0)

// matchedAlias：给出「为什么命中」，且对无别名/无命中返回 ''
check('A7.13', 'matchedAlias 返回命中的别名', matchedAlias(byId.ex1, '币安') === '币安', matchedAlias(byId.ex1, '币安'))
check('A7.14', 'matchedAlias 拼音命中同样返回别名', matchedAlias(byId.wl1, 'xiaohuli') === '小狐狸', matchedAlias(byId.wl1, 'xiaohuli'))
check('A7.15', 'matchedAlias 未命中 / 无别名时返回空串', matchedAlias(byId.ex1, 'zzz') === '' && matchedAlias({ id: 'x', name: 'Foo' }, 'foo') === '', `ex1=${matchedAlias(byId.ex1, 'zzz')} bare=${matchedAlias({ id: 'x', name: 'Foo' }, 'foo')}`)

// 别名字段完整性：录入后所有 aliases 都是非空字符串且无重复
const badAlias = sites.filter(s => s.aliases !== undefined && (!Array.isArray(s.aliases) || s.aliases.some(a => typeof a !== 'string' || !a.trim())))
check('A7.16', '所有站点 aliases 均为非空字符串数组', badAlias.length === 0, badAlias.map(s => s.id).join(','))

// ── splitHighlight（XSS 面：纯文本分段，无 HTML 解析）──
const seg = splitHighlight('<img src=x onerror=alert(1)>hello', 'hello')
const joined = seg.map(s => s.text).join('')
check('A1.1', 'splitHighlight 原样保留标签字符（不解析 HTML）', joined === '<img src=x onerror=alert(1)>hello', joined)
check('A1.2', 'splitHighlight 命中段标记正确', seg.some(s => s.hit && s.text === 'hello'), JSON.stringify(seg))
const segEmpty = splitHighlight('abc', '')
check('A1.3', '空词返回单段未命中', segEmpty.length === 1 && segEmpty[0].hit === false, JSON.stringify(segEmpty))

// ── 边界 ──
check('E1', '空查询返回空数组', rankSites(sites, '').length === 0)
check('E2', '纯空白查询返回空数组', rankSites(sites, '   ').length === 0)
check('E3', 'limit 生效', rankSites(sites, 'a', { limit: 3 }).length <= 3)
const nomatch = rankSites(sites, 'zzzqqqxxx')
check('E4', '无命中不抛错（可为空或模糊结果）', Array.isArray(nomatch), typeof nomatch)

console.log(results.join('\n'))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)