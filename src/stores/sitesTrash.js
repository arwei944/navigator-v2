/**
 * 回收站治理：保留期 / 条数 / 字节三道闸 + 恢复前校验。
 *
 * ## 为什么需要治理
 *
 * 此前只写不治，300 站全删会往 localStorage 堆 150 KB+，是配额异常的历史诱因
 * （配额打满时连覆盖层都写不进去）。
 *
 * ## 什么时候治理
 *
 * **只在有回收站写入时**（删除 / 批量删除 / 恢复 / 彻底删除 / 清空），没有常驻定时器 ——
 * 一个每 N 秒跑一次的清理器本身就是性能负担，而回收站只在用户动手时才变，
 * 挂在写入路径上已经够了。
 *
 * ## 三道闸的顺序
 *
 * 按「便宜的先来」：保留期（一次 filter）→ 条数上限（一次排序）→ 字节上限
 * （超限才逐条淘汰）。字节上限放最后且自带提前退出：正常使用几乎不会走到 while 循环。
 *
 * ## 为什么从 store 抽出来
 *
 * 这三个函数是纯数据变换（输入数组、输出新数组或布尔），只依赖编码函数。
 * 抽出来后可以在 Node 里直接构造「300 条超长描述」验证字节闸，不必建 Pinia。
 */
import { encodeStored } from '../utils/storeVersioning.js'
import { safeSetItem } from '../utils/safeStorage.js'
import { hostOf } from '../../shared/host.mjs'

export const TRASH_KEY = 'nav-sites-trash'

/* 取值理由：200 条够覆盖「误删一批」的典型场景；256 KB 是单键在 5 MB 配额里
 * 不至于把覆盖层挤掉的上限；30 天与「回收站该有的记忆长度」一致。 */
export const TRASH_MAX_ITEMS = 200
export const TRASH_MAX_BYTES = 256 * 1024
export const TRASH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/** 最旧一条的下标（deletedAt 最小）。无合法时间戳的条目视为「年龄未知」，排在最后。 */
export function oldestTrashIndex(trash) {
  let idx = 0
  let oldest = Infinity
  for (let i = 0; i < trash.length; i++) {
    const t = Number(trash[i]?.deletedAt)
    const v = Number.isFinite(t) && t > 0 ? t : Infinity
    if (v < oldest) {
      oldest = v
      idx = i
    }
  }
  return idx
}

/**
 * 按保留期与条数上限裁剪回收站，返回裁剪后的新数组（不改入参）。
 * @returns {{list: any[], changed: boolean}}
 */
export function pruneTrash(trash, now = Date.now()) {
  if (!trash.length) return { list: trash, changed: false }
  let changed = false
  let list = trash

  // 1) 保留期：30 天前的条目自动清掉。没有合法 deletedAt 的不清（无法判定年龄，宁可留着）
  const kept = list.filter((s) => {
    const t = Number(s?.deletedAt)
    return !(Number.isFinite(t) && t > 0) || now - t <= TRASH_MAX_AGE_MS
  })
  if (kept.length !== list.length) {
    list = kept
    changed = true
  }

  // 2) 条数上限：超出时淘汰最旧的，但**保持其余条目的原有顺序**（回收站是按删除先后读的）
  if (list.length > TRASH_MAX_ITEMS) {
    const keep = new Set(
      [...list]
        .sort((a, b) => (Number(b?.deletedAt) || 0) - (Number(a?.deletedAt) || 0))
        .slice(0, TRASH_MAX_ITEMS)
        .map((s) => s.id),
    )
    list = list.filter((s) => keep.has(s.id))
    changed = true
  }

  return { list, changed }
}

/** 恢复前的完整性校验：返回 '' 表示通过，否则返回可展示的原因。 */
export function validateTrashSite(s) {
  if (!s || typeof s !== 'object') return '记录已损坏'
  if (typeof s.id !== 'string' || !s.id.trim()) return '缺少站点 id'
  if (typeof s.name !== 'string' || !s.name.trim()) return '缺少站点名称'
  if (typeof s.url !== 'string' || !s.url.trim()) return '缺少站点地址'
  // 域名解析不出来 = 恢复后既打不开、又会污染列表（空 host 在去重/图谱里是脏输入）
  if (!hostOf(s.url)) return `站点地址无法解析出域名（${s.url}）`
  return ''
}

/**
 * 落盘：先跑保留期与条数闸，再在字节超限时从最旧继续淘汰。
 * @returns {{list: any[], bytes: number}} 裁剪后的列表与最终 payload 长度
 */
export function persistTrash(trash) {
  const pruned = pruneTrash(trash)
  let list = pruned.list
  let payload = encodeStored(list)

  // 3) 字节上限：条数闸放过去了但总量仍超标（个别条目描述特别长）时，从最旧继续淘汰
  while (payload.length > TRASH_MAX_BYTES && list.length > 1) {
    list = list.filter((_, i) => i !== oldestTrashIndex(list))
    payload = encodeStored(list)
  }

  safeSetItem(TRASH_KEY, payload)
  return { list, bytes: payload.length }
}

/** 读盘（只丢「非对象」项，字段级完整性留到恢复时逐条校验） */
export function loadTrash(decodeStored) {
  const stored = decodeStored(TRASH_KEY, localStorage.getItem(TRASH_KEY), [])
  return Array.isArray(stored) ? stored.filter((s) => s && typeof s === 'object') : []
}
