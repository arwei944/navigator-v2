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
 */

const KEY = 'nav-offline-edits'

/** 队列上限：超出的丢最旧，防止长期离线无限膨胀 */
export const OFFLINE_MAX = 300

function normalizeOp(op) {
  if (!op || typeof op !== 'object') return null
  const kind = String(op.kind || '').trim()
  if (!kind) return null
  return {
    kind,
    siteId: op.siteId != null ? String(op.siteId) : '',
    at: Number(op.at) || 0,
  }
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
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* 隐私模式 / 配额满：不记也能用 */ }
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
  try { localStorage.removeItem(KEY) } catch { /* 忽略 */ }
  return []
}

/** 给 UI 的一句话摘要；队列为空时返回空串 */
export function offlineSummary(ops) {
  const n = Array.isArray(ops) ? ops.length : 0
  if (!n) return ''
  return `离线期间有 ${n} 处改动尚未同步`
}
