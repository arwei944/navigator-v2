/**
 * 离线编辑队列（F8）。
 *
 * ## 它解决什么
 *
 * 编辑是**本地优先**的（overlay 层持久化在 localStorage），所以断网照样能改。
 * 但「断网期间改了什么」在恢复后没有留痕 —— 用户忘了发布，两台设备就长期不一致。
 * 本模块把「离线期间发生过哪些待同步编辑」记下来：恢复在线时能给出一句明确的
 * 「离线期间有 N 处改动尚未同步」，而不是静默地什么都不说。
 *
 * ## 与 noteSync 的分工（不重复造轮子）
 *
 * 冲突消解（LWW + rev + 墓碑 + 本地优先）已经在 `utils/noteSync.js` 里定义好了，
 * 且注释明确要求「本地写 / 广播收 / 云端拉三处口径一致」。本模块**不碰**冲突规则，
 * 只管「离线期间把待同步的事实排进队列、恢复后清账」这一件事。
 *
 * ## 设计要点
 *
 *   · 持久化：刷新 / 关页不丢；
 *   · 合并去重：同 kind + 同 siteId 的重复编辑只留最新一条（把同一个站改十遍只需同步一次）；
 *   · 上限：长期离线也不至于无限增长，超限丢最旧的；
 *   · 纯逻辑 + localStorage，不碰 Pinia / DOM，可被直接断言。
 *
 * ## 重放（`replayOffline`）：幂等 / 可丢弃 / 冲突可回溯
 *
 * 恢复在线后按 `at` 升序逐条重放，**只有 push 成功才把该条移出队列**。
 *   · 幂等：本项目推送的是**当前完整快照**（本地优先，见 liveSync），
 *     而服务端 `/api/session` 是字段级浅合并 + 条目级 LWW —— 同一条重放两次结果不变。
 *     所以「不敢丢弃队列」的代价仅是重复推一次同样的快照，不会造成数据错乱。
 *   · 可丢弃：失败次数达到 `maxAttempts` 的条目会被移出并**记进 `dropped`**（带最后一次错误），
 *     避免一条永远推不上去的脏记录把整条队列卡死。
 *   · 冲突可回溯：`dropped` / `kept` 都带原始 `kind/siteId/at/attempts`，
 *     调用方（或排查的人）据此可知「哪条、什么时候、为什么没同步上去」。
 *
 * 为什么不是「按字段重放」：编辑走的是本地 overlay + 整快照推送，队列记的是
 * 「离线期间有过哪些待同步动作」而非「某个字段的新值」。硬做字段级重放会与
 * LWW 合并规则打架，反而制造第二套真相。
 */

import { safeSetItem, safeRemoveItem } from './safeStorage.js'

const KEY = 'nav-offline-edits'

/** 队列上限：超出的丢最旧，防止长期离线无限膨胀 */
export const OFFLINE_MAX = 300

function normalizeOp(op) {
  if (!op || typeof op !== 'object') return null
  const kind = String(op.kind || '').trim()
  if (!kind) return null
  const out = {
    kind,
    siteId: op.siteId != null ? String(op.siteId) : '',
    at: Number(op.at) || 0,
  }
  // 重放失败计数要跟着条目走，否则「可丢弃」永远等不到 maxAttempts
  if (op.attempts) out.attempts = Number(op.attempts) || 0
  return out
}

function sameOp(a, b) {
  return a.kind === b.kind && String(a.siteId || '') === String(b.siteId || '')
}

function readRaw() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw.map(normalizeOp).filter(Boolean)
  } catch {
    // 坏数据（手改过 / 旧格式）当作没有，绝不因它让编辑流程崩掉
    return []
  }
}

function write(list) {
  safeSetItem(KEY, JSON.stringify(list))  // 隐私模式 / 配额满：失败仅告警，内存态仍正确
}

/** 读取队列（最新在后）。任何情况下返回数组，不抛 */
export function loadOffline() {
  return readRaw()
}

/**
 * 入队一条离线编辑；同 kind + 同 siteId 的旧记录被合并掉。
 * @param {{kind:string, siteId?:string, at?:number}} op
 * @returns {Array} 入队后的队列
 */
export function enqueueEdit(op) {
  const o = normalizeOp(op)
  if (!o) return readRaw()
  const queue = readRaw().filter(x => !sameOp(x, o))
  queue.push(o)
  const trimmed = queue.length > OFFLINE_MAX ? queue.slice(queue.length - OFFLINE_MAX) : queue
  write(trimmed)
  return trimmed
}

/** 清空队列（同步成功后调用） */
export function clearOffline() {
  safeRemoveItem(KEY)
  return []
}

/**
 * 重放队列：按 `at` 升序逐条调用 `push(op)`，**只有成功才移出队列**。
 *
 * @param {object} o
 * @param {(op:object)=>Promise<void>|void} o.push 单条重放动作（抛错视为失败）
 * @param {()=>boolean} [o.canSend] 可发送判定（离线 / 无 key / 冷却中 → false）；false 时**不消耗队列**
 * @param {number} [o.maxAttempts] 单条失败上限，达到即丢弃并记入 dropped
 * @returns {Promise<{replayed:number, kept:number, dropped:Array, deferred:boolean}>}
 *   deferred=true 表示本次没发（离线/不可发送），队列原样保留，不算失败
 */
export async function replayOffline({ push, canSend = () => true, maxAttempts = 5 } = {}) {
  const queue = readRaw()
  if (typeof push !== 'function' || !canSend()) {
    return { replayed: 0, kept: queue.length, dropped: [], deferred: true }
  }
  const kept = []
  const dropped = []
  let replayed = 0
  // 稳定按时间升序：离线期间的改动本就有先后，重放顺序不该随机
  const ordered = [...queue].sort((a, b) => a.at - b.at)
  for (const op of ordered) {
    try {
      await push(op)
      replayed++
    } catch (e) {
      const attempts = (Number(op.attempts) || 0) + 1
      const rec = { ...op, attempts }
      if (attempts >= maxAttempts) dropped.push({ ...rec, error: String(e?.message || e) })
      else kept.push(rec)
    }
  }
  write(kept)
  return { replayed, kept: kept.length, dropped, deferred: false }
}

/** 给 UI 的一句话摘要；队列为空时返回空串 */
export function offlineSummary(ops) {
  const n = Array.isArray(ops) ? ops.length : 0
  if (!n) return ''
  return `离线期间有 ${n} 处改动尚未同步`
}
