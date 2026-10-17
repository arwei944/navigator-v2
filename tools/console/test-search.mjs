/**
 * 检索内核用例（F2）：别名扩充（域名主体）/ 命中位置×频次排序 / 搜索历史。
 *
 * 零依赖、不联网、不碰 DOM —— localStorage 用内存桩替掉，因为搜索历史模块就活在那里。
 * 断言集中在**可解释性**上：域名别名要能命中且能被解释；排序细化只能动「同档位内部」，
 * 不许翻越相关性档位；历史要去重、置顶、限长，且不记命令前缀。
 *
 * 运行：node tools/console/test-search.mjs
 */
import { hostMainOf, matchQuality, rankSites, scoreSite, SCORE } from '../../src/utils/search.js'
import { clearSearchHistory, HISTORY_MAX, loadSearchHistory, rememberSearch } from '../../src/utils/searchHistory.js'

let pass = 0
const failures = []

function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}

/* ---------------- localStorage 内存桩（搜索历史用） ---------------- */
const mem = new Map()
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
}

/* ---------------- 别名扩充：域名主体可命中 ---------------- */
{
  const site = { id: 'g1', name: '代码托管', url: 'https://www.github.com', desc: '托管平台' }
  // name/desc 都不含 github，只有域名含 —— 命中只能来自域名主体档
  eq(scoreSite(site, 'github'), SCORE.HOST_EXACT, '域名主体（去 www）走独立档 HOST_EXACT')
  ok(scoreSite(site, 'github') < SCORE.NAME_INCLUDES, '域名档低于名称包含，不喧宾夺主')
  ok(matchQuality(site, 'github').hits > 0, '域名命中计入命中频次')

  const ip = { id: 'ip', name: '本地服务', url: 'http://127.0.0.1:3000', desc: '' }
  eq(hostMainOf(ip.url), '', 'IP 首段为纯数字，不作别名')
  eq(hostMainOf('https://www.github.com/a/b'), 'github', '去 www / 协议 / 路径，取主体')
  eq(hostMainOf('https://a.io'), '', '单字符主体不作别名')
}

/* ---------------- 命中位置 × 频次：只在同档位内部生效 ---------------- */
{
  // 两条都命中 NAME_INCLUDES（名称包含），但 A 的命中位置更靠前
  const A = { id: 'A', name: 'xpipe tools', url: 'https://a.example.com', desc: '' }   // 'pipe' 在下标 1
  const B = { id: 'B', name: 'leadpipe', url: 'https://b.example.com', desc: '' }      // 'pipe' 在下标 4
  const ranked = rankSites([B, A], 'pipe')
  eq(ranked[0]?.id, 'A', '同档位内命中位置更靠前的排前')
  eq(scoreSite(A, 'pipe'), scoreSite(B, 'pipe'), '两者确属同一评分档位（否则测的不是档位内细化）')

  // 多条命中字段（名称 + 别名同时命中）应比只命中名称的更靠前
  const C = { id: 'C', name: 'Alpha', url: 'https://c.example.com', desc: '', aliases: ['alpha'] }
  const D = { id: 'D', name: 'Alpha', url: 'https://d.example.com', desc: '' }
  const r2 = rankSites([D, C], 'alpha')
  eq(r2[0]?.id, 'C', '命中字段更多（名称 + 别名）的排前')

  // 档位不可被次级键翻越：名称包含永远压过描述包含
  const strong = { id: 's', name: 'full text search', url: 'https://s.example.com', desc: '' }
  const weak = { id: 'w', name: '别的', url: 'https://w.example.com', desc: 'search 相关' }
  eq(rankSites([weak, strong], 'search')[0]?.id, 's', '次级排序不会让描述命中翻越名称命中')
  ok(scoreSite(strong, 'search') === SCORE.NAME_INCLUDES, '名称包含档位值未被改动')
}

/* ---------------- 搜索历史：去重 / 置顶 / 限长 / 不记前缀 ---------------- */
{
  clearSearchHistory()
  eq(loadSearchHistory().length, 0, '初始为空')

  rememberSearch('github')
  eq(JSON.stringify(loadSearchHistory()), JSON.stringify(['github']), '记一条')

  rememberSearch('GITHUB') // 大小写不敏感去重
  eq(JSON.stringify(loadSearchHistory()), JSON.stringify(['GITHUB']), '大小写不敏感去重且置顶为新值')

  rememberSearch('figma')
  eq(loadSearchHistory()[0], 'figma', '新搜索置顶')

  rememberSearch('>命令') // 命令前缀不记
  eq(loadSearchHistory().includes('>命令'), false, '命令前缀输入不进历史')
  rememberSearch('@某人')
  eq(loadSearchHistory().includes('@某人'), false, '@/ 前缀输入不进历史')
  rememberSearch('   ') // 空白不记
  eq(loadSearchHistory().length, 2, '空白输入不产生记录')

  for (let i = 0; i < 20; i++) rememberSearch('q' + i)
  eq(loadSearchHistory().length, HISTORY_MAX, `历史长度封顶 ${HISTORY_MAX} 条`)

  eq(clearSearchHistory().length, 0, '清空返回空数组')
  eq(loadSearchHistory().length, 0, '清空后读回为空')
}

/* ---------------- 报告 ---------------- */
console.log(`\n检索内核用例（F2）：${pass} 通过，${failures.length} 失败`)
if (failures.length) {
  for (const f of failures) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('  ✓ 全部通过')
