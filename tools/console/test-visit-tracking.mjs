/**
 * 访问追踪守卫：并发写入语义 + 限流淘汰 + 本地存储收敛。
 *
 * ## 守的是什么
 *
 * 这一轮把两处「看起来能用但其实有洞」的实现换掉了：
 *
 *   1. `api/clicks.js` 的写入从「无条件 put」改成 CAS + 重试。
 *      旧实现并发时静默丢一方增量，而点击量是热度排行的唯一依据 ——
 *      丢了没有任何征兆，只是排行榜长期偏低。
 *   2. 限流从 `if (size > 5000) clear()` 改成淘汰最久未活动项。
 *      旧实现里任何能构造 5000 个来源的请求者都能在触发清空时让所有 IP 计数归零。
 *   3. 本机访问记录从「overlay.visits + history.records 两份存储」收敛成一份。
 *
 * 这三件事都不是「跑起来看着对」能验证的：并发丢更新只在压力下出现、
 * clear() 只在流量大时被触发、两份存储的漂移只在特定操作序列后显现。
 * 因此用**可重复的断言**而不是手工观察。
 *
 * 运行：node tools/console/test-visit-tracking.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }

/* ============ 1. 云端写入必须走 CAS ============ */

{
  const src = read('api/clicks.js')
  // 只看代码行：注释里解释「ifMatch 是 CAS 闸门」不等于实现了它
  const code = src.split('\n').filter((l) => !/^\s*\*|^\s*\/\//.test(l)).join('\n')

  ok(/ifMatch:/.test(code), 'clicks 写入带 ifMatch（条件写，不是无条件覆盖）')
  ok(/allowOverwrite:\s*false/.test(code), '首次写入走 createOnly（并发首写不互相覆盖）')
  ok(/isPreconditionFailed/.test(code), '冲突判定按错误语义而非裸状态码猜')
  ok(/CAS_RETRIES/.test(code) && /for\s*\(\s*let\s+attempt/.test(code), '冲突后重读重算并重试')

  /*
   * 关键：重试**必须重新读**。
   * 若在循环外读一次、循环内重复用同一份快照，重试只会算出同一份过期结果，
   * 看起来有重试、实际永远失败 —— 这是最容易写错的地方。
   */
  const loopStart = src.indexOf('for (let attempt')
  const loopBody = loopStart >= 0 ? src.slice(loopStart, src.indexOf('\n  }', loopStart)) : ''
  ok(/readStoredWithEtag/.test(loopBody), '重试循环内部重新读取（不是复用循环外的旧快照）')

  // 重试用尽不能假装成功：必须是 409，而不是 200 + 旧数据
  ok(/409/.test(code) && /retryable/.test(code), '重试用尽返回 409 而非静默成功')

  // 旧的无条件覆盖写法必须彻底消失
  ok(!/await put\(PATHNAME, JSON\.stringify\(data\),\s*\{\s*access: 'private',\s*addRandomSuffix: false,\s*allowOverwrite: true,\s*contentType: 'application\/json',\s*\}\)\s*res\.status\(200\)/.test(src),
    '不再存在「无条件 put 后直接回 200」的旧写法')
}

/* ============ 1b. 清空入口必须鉴权 ============ */

{
  const src = read('api/clicks.js')
  const code = src.split('\n').filter((l) => !/^\s*\*|^\s*\/\//.test(l)).join('\n')
  ok(/req\.method === 'DELETE'/.test(code), '提供 DELETE 清空入口（否则口径错了只能手改存储）')
  ok(/checkAuthHeader/.test(code), '清空走既有鉴权（不新造机制）')
  // 鉴权检查必须早于任何写入 —— 「先清空再报错」是灾难
  const delStart = code.indexOf("req.method === 'DELETE'")
  const delBody = delStart >= 0 ? code.slice(delStart, delStart + 900) : ''
  const authAt = delBody.indexOf('checkAuthHeader')
  const putAt = delBody.indexOf('put(PATHNAME')
  ok(authAt >= 0 && putAt > authAt, '鉴权判断早于写入（匿名请求不可能清空数据）',
    `authAt=${authAt} putAt=${putAt}`)
}

/* ============ 2. 限流不能整体清空 ============ */

{
  const src = read('api/clicks.js')
  // 只在**代码行**里找 clear()，注释里说明「旧实现是 clear()」不算违规
  const codeLines = src.split('\n').filter((l) => !/^\s*\*|^\s*\/\//.test(l)).join('\n')
  ok(!/rateHits\.clear\(\)/.test(codeLines), '限流不再用 clear() 整体清空（否则谁都能重置所有人的计数）')
  ok(/evictOldest/.test(src), '容量超限时淘汰最久未活动项')
  ok(/RATE_MAX_IPS/.test(src), '容量有明确上限')
}

/* ============ 3. 本机访问记录只有一份存储 ============ */

{
  const overlay = read('src/stores/sitesOverlay.js')
  const history = read('src/stores/history.js')
  const sites = read('src/stores/sites.js')

  ok(/visits:\s*\{[^}]*count[^}]*lastAt/s.test(history) || /count:\s*prev\?\.count/.test(history),
    'history store 用 { count, lastAt } 单一结构')

  // overlay 不能再写 visits —— 否则下次启动迁移会把已删除的记录复活
  const saveFn = overlay.slice(overlay.indexOf('export function saveOverlay'))
  ok(!/visits/.test(saveFn.slice(0, 400)), 'overlay 写盘不再包含 visits（避免与 history 抢同一份数据）')

  // sites store 的 visitCounts 必须是派生（computed），不能是独立 ref
  ok(/const visitCounts = computed\(/.test(sites), 'sites store 的 visitCounts 是从 history 派生的 computed')

  // recordVisit 只写一处本机存储
  const mut = read('src/stores/sitesMutations.js')
  const rv = mut.slice(mut.indexOf('function recordVisit'))
  const rvBody = rv.slice(0, rv.indexOf('\n  }'))
  ok(/historyStore\.addRecord/.test(rvBody), 'recordVisit 写 history store')
  ok(!/visitCounts\.value\[id\]\s*=/.test(rvBody), 'recordVisit 不再直接写 visitCounts（单一存储，不双写）')
}

/* ============ 4. 迁移：旧结构必须能被读出来 ============ */

{
  const ver = read('src/utils/storeVersioning.js')
  ok(/STORE_VERSION = 3/.test(ver), 'schema 版本已升到 3')
  ok(/history:\s*\[\[2,/.test(ver), '注册了 history v2→v3 迁移')

  // 迁移函数要能处理旧 records 数组，且不因脏数据抛错
  const { decodeStored } = await import('../../src/utils/storeVersioning.js')
  const legacy = JSON.stringify({
    __navDataVersion: 2,
    data: { records: [{ siteId: 'a', timestamp: 1000 }, { siteId: 'b', timestamp: 2000 }, { siteId: 'a', timestamp: 3000 }] },
  })
  // decodeStored 需要 localStorage；用最小桩替代
  globalThis.localStorage = { getItem: () => null, setItem: () => {} }
  const migrated = decodeStored('history', legacy, {})
  ok(migrated && migrated.visits && typeof migrated.visits === 'object', '旧 records 被迁移成 visits 对象')
  ok(migrated.visits.a?.count === 2, '同一站点多条旧记录被合并计数', `实得 ${migrated.visits.a?.count}`)
  ok(migrated.visits.a?.lastAt === 3000, '同站点取最晚时间戳', `实得 ${migrated.visits.a?.lastAt}`)
  ok(migrated.visits.b?.count === 1, '单条记录保留为 count 1')

  // 脏数据不能炸
  globalThis.localStorage = { getItem: () => null, setItem: () => {} }
  const dirty = decodeStored('history', JSON.stringify({ __navDataVersion: 2, data: { records: [null, {}, { siteId: '' }] } }), {})
  ok(dirty && typeof dirty === 'object', '脏旧数据不导致迁移抛错', JSON.stringify(dirty).slice(0, 60))
}

/* ============ 5. 前端对 409 会重试，且不丢 pending ============ */

{
  const src = read('src/stores/clicks.js')
  ok(/res\.status === 409/.test(src), '前端识别 409')
  ok(/scheduleRetry/.test(src), '409 后安排重试（用户不再点击时也能补发）')

  // 非 2xx 时不能 dropSent —— 丢了就等于承认「这次点击不要了」。
  // 注意要看 **flush 里的那一个** `if (!res.ok)`（load 里也有一个，是只读路径）
  const flushStart = src.indexOf('function flush(')
  const flushSrc = flushStart >= 0 ? src.slice(flushStart, src.indexOf('async function load', flushStart)) : ''
  const block = flushSrc.slice(flushSrc.indexOf('if (!res.ok)'), flushSrc.indexOf('const j = await res.json()'))
  ok(block.length > 0, '找到 flush 的非 2xx 分支')
  // 只看代码行：注释里写着「这里没 dropSent」，直接搜整段会被自己的说明文字误伤
  const blockCode = block.split('\n').filter((l) => !/^\s*\*|^\s*\/\//.test(l)).join('\n')
  ok(!/dropSent/.test(blockCode), '非 2xx 分支不丢弃 pending 队列')
}

console.log(`\n👣 访问追踪守卫：${pass} 通过 / ${failures.length} 失败`)
if (failures.length) {
  console.log('\n失败明细：')
  for (const f of failures) console.log(`- ${f}`)
  process.exit(1)
}
console.log('  ✓ 云端 CAS 写入｜限流淘汰而非清空｜本机单一存储｜旧数据可迁移')
