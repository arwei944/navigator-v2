/**
 * 实时同步内核：便利贴与站点备注共用的一套「合并 + 广播」规则。
 *
 * ## 为什么必须要有墓碑
 *
 * 备注是 LWW（最后写入者胜）合并的。如果删除就是「把条目从对象里删掉」，
 * 那么另一台设备同步时会发现自己本地有这条、远端没有 —— 按 LWW 的规则
 * 「只在远端才补进本地」不成立，于是本地那一条赢，被删掉的备注在下一轮同步后**复活**。
 * 所以删除必须留一条 `deletedAt` 的墓碑：它参与同样的时间比较，且胜出时表达「确实删了」。
 *
 * ## 冲突消解口径（三处必须一致：本地写、广播收、云端拉）
 *
 *   先比 updatedAt → 相等比 rev → 再相等取本地
 *
 * 「再相等取本地」不是偷懒：同一条备注在两个标签页被改成完全同时间戳的极端情况下，
 * 必须有一个确定的结果，否则两端会来回抖。取本地让「你正在编辑的这一端」不被打断。
 *
 * 这里的函数全是纯函数，不碰 Pinia 也不碰 DOM —— 只有 `createLiveBus` 碰
 * BroadcastChannel，且做了降级（不支持时退化成空实现）。
 */

export const LIVE_CHANNEL = 'nav-live'

/** 体量上限（字节）。客户端先自检，服务端另有 512KB 硬门禁兜底。 */
export const LIMITS = {
  SITE_NOTE_MAX: 2 * 1024,      // 单条站点备注
  SITE_NOTES_MAX: 80 * 1024,    // 站点备注总量
  NOTE_MAX: 8 * 1024,           // 单枚便利贴
  NOTES_MAX: 80 * 1024          // 便利贴总量
}

/** 墓碑保留时长：30 天后清理，否则会话快照会无限膨胀 */
export const TOMBSTONE_TTL = 30 * 24 * 3600 * 1000

/** 条目的「最后动作时间」：删除也是一次动作，所以取 updatedAt 与 deletedAt 的较大者 */
export function actionTime(e) {
  if (!e || typeof e !== 'object') return 0
  return Math.max(Number(e.updatedAt) || 0, Number(e.deletedAt) || 0)
}

/** 是否为已删除（墓碑胜出） */
export function isTombstone(e) {
  return Boolean(e && e.deletedAt && Number(e.deletedAt) >= (Number(e.updatedAt) || 0))
}

/**
 * remote 是否严格新于 local。相等**不算**新 —— 于是合并时相等取本地。
 */
export function isNewer(remote, local) {
  if (!remote) return false
  if (!local) return true
  const tr = actionTime(remote)
  const tl = actionTime(local)
  if (tr !== tl) return tr > tl
  const rr = Number(remote.rev) || 0
  const rl = Number(local.rev) || 0
  return rr > rl
}

/** 两条条目择一：先时间、再 rev、再取本地。返回原对象引用（不复制）。 */
export function mergeEntry(local, remote) {
  if (!local) return remote || null
  if (!remote) return local
  return isNewer(remote, local) ? remote : local
}

/**
 * 合并两个「id → 条目」映射。
 *
 * 幂等：同一条远端消息重复到达，第二次的 winner 与本地已是同一对象，changed 为 false。
 * 这让广播收包天然可以重复投递，不需要额外的去重表。
 *
 * @returns {{merged: Object, changed: boolean, added: string[], updated: string[]}}
 */
export function mergeMaps(local, remote) {
  const merged = { ...(local || {}) }
  const added = []
  const updated = []
  let changed = false
  for (const [key, rv] of Object.entries(remote || {})) {
    if (!rv || typeof rv !== 'object') continue
    const lv = merged[key]
    const winner = mergeEntry(lv, rv)
    if (winner === lv) continue
    merged[key] = winner
    changed = true
    ;(lv ? updated : added).push(key)
  }
  return { merged, changed, added, updated }
}

/** 清理过期墓碑。返回新对象（条目引用不变）。 */
export function pruneTombstones(map, now = Date.now(), ttl = TOMBSTONE_TTL) {
  const out = {}
  let removed = 0
  for (const [k, v] of Object.entries(map || {})) {
    if (isTombstone(v) && now - actionTime(v) > ttl) { removed++; continue }
    out[k] = v
  }
  return { map: out, removed }
}

/** 粗算对象序列化后的字节数（UTF-16 计 2 字节的近似：按字符数上界估） */
export function estimateBytes(value) {
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value)
    return s ? s.length * 2 : 0
  } catch {
    return 0
  }
}

/** 按字节上限截断字符串（按字符切，避免切出半个代理对） */
export function clampText(text, maxBytes = LIMITS.SITE_NOTE_MAX) {
  const s = String(text ?? '')
  if (estimateBytes(s) <= maxBytes) return s
  const maxChars = Math.floor(maxBytes / 2)
  return Array.from(s).slice(0, maxChars).join('')
}

/**
 * 造一条新条目。rev 自增、updatedAt 取当下 —— 这两项由内核给，不接受外部传值，
 * 否则「改了内容但时间戳没动」会让 LWW 判不出来（等于自废合并规则）。
 */
export function makeEntry(fields, prev) {
  const { rev: _r, updatedAt: _u, deletedAt: _d, ...rest } = fields || {}
  return {
    ...rest,
    rev: (Number(prev?.rev) || 0) + 1,
    updatedAt: Date.now(),
    deletedAt: null
  }
}

/** 造墓碑：保留上一版文本以便撤销，但 deletedAt 压过 updatedAt */
export function tombstone(prev) {
  return {
    ...(prev || {}),
    rev: (Number(prev?.rev) || 0) + 1,
    updatedAt: Number(prev?.updatedAt) || Date.now(),
    deletedAt: Date.now()
  }
}

/* ---------- BroadcastChannel ---------- */

let originCounter = 0

/**
 * 同浏览器内的实时通道。
 *
 * 用 BroadcastChannel 而不是 storage 事件：后者在 Safari 上会被节流，
 * 且会连带触发 pinia 持久化插件的写入，容易形成回环。
 * 不支持时返回空实现 —— 单机单标签页的功能不受任何影响。
 */
export function createLiveBus(onMessage) {
  const origin = `o${Date.now().toString(36)}${(originCounter++).toString(36)}`
  if (typeof BroadcastChannel === 'undefined') {
    return { post() {}, close() {}, get supported() { return false } }
  }
  let ch
  try {
    ch = new BroadcastChannel(LIVE_CHANNEL)
  } catch {
    return { post() {}, close() {}, get supported() { return false } }
  }
  ch.onmessage = (e) => {
    const d = e?.data
    // 忽略自己发出去的（规范上不会回发，但同页面多 store 实例时可能）
    if (!d || typeof d !== 'object' || d.origin === origin) return
    onMessage(d)
  }
  return {
    supported: true,
    origin,
    post(msg) {
      try { ch.postMessage({ ...msg, origin, at: Date.now() }) } catch { /* 通道已关闭 */ }
    },
    close() {
      try { ch.close() } catch { /* 忽略 */ }
    }
  }
}
