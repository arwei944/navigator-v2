/**
 * 便利贴：贴在导航站上的随手记（域名续费日期、某站的使用心得、临时待办）。
 *
 * ## 与待办（todos）的分工
 *
 * 待办是「要做完的事」——有 done 状态、有进度条、做完就划掉；
 * 便利贴是「要常看见的信息」——有位置、有颜色、会一直在那儿。
 * 两者刻意不合并：合成一种数据会让待办多出用不上的坐标字段，
 * 也会让便利贴被迫背上「完成度」的语义。需要打通时走
 * 「便签里的清单项转成待办」这一条单向路（见 StickyNote）。
 *
 * ## 存储形态
 *
 * 内部是 `id → item` 的映射（与备注共用 noteSync 的 LWW 合并），
 * 对外暴露按 z 排序的数组 —— 渲染要顺序，合并要按 id，两件事分开。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { decodeStored, encodeStored } from '@/utils/storeVersioning'
import { safeSetItem } from '@/utils/safeStorage'
import {
  LIMITS,
  TOMBSTONE_TTL,
  clampText,
  createLiveBus,
  estimateBytes,
  isTombstone,
  makeEntry,
  mergeMaps,
  pruneTombstones,
  tombstone
} from '@/utils/noteSync'

const KEY = 'nav-notes'

/** 六色板。值是语义色名，具体色号由主题给（见 styles/main.css 的 --note-*），
 *  这里不写死 —— 深色主题下必须换成另一套，否则会出现亮黄块压在深色背景上。 */
export const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green', 'purple', 'gray']

const DEFAULT_SIZE = { w: 240, h: 180 }

function readRaw() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : ''
  } catch {
    return ''
  }
}

let bus = null
let seq = 0

function newId() {
  seq += 1
  return `n${Date.now().toString(36)}${seq.toString(36)}`
}

export const useNotesStore = defineStore('notes', () => {
  const entries = ref(decodeStored(KEY, readRaw(), {}))

  function persist() {
    safeSetItem(KEY, encodeStored(entries.value))
  }

  if (!bus) {
    bus = createLiveBus((msg) => {
      if (msg?.type !== 'notes' || !msg.entries) return
      applyRemote(msg.entries)
    })
  }

  function broadcast(changed) {
    bus?.post({ type: 'notes', entries: changed })
  }

  /* ---------- 派生 ---------- */

  /** 未删除的便签，按 z 升序（z 大的盖在上面） */
  const items = computed(() =>
    Object.values(entries.value)
      .filter(v => !isTombstone(v))
      .sort((a, b) => (Number(a.z) || 0) - (Number(b.z) || 0))
  )

  /** 钉住的便签：不进便签墙时也要常驻桌面 */
  const pinned = computed(() => items.value.filter(n => n.pinned))

  const count = computed(() => items.value.length)
  const usedBytes = computed(() => estimateBytes(entries.value))

  function maxZ() {
    let z = 0
    for (const v of Object.values(entries.value)) {
      if (isTombstone(v)) continue
      const n = Number(v.z) || 0
      if (n > z) z = n
    }
    return z
  }

  /** 便签墙打开时给新便签找一个不重叠的落点（简单的阶梯错位） */
  function nextPosition() {
    const base = items.value.length
    const step = 28
    const ox = 40 + (base % 6) * step
    const oy = 40 + (base % 6) * step
    return { x: ox, y: oy }
  }

  /* ---------- 读写 ---------- */

  /**
   * 新建便签。
   * @param {string} text 初始文本
   * @param {object} [opts] color / x / y / w / h / pinned
   */
  function create(text = '', opts = {}) {
    const id = newId()
    const pos = opts.x != null ? { x: Number(opts.x), y: Number(opts.y) } : nextPosition()
    const item = makeEntry({
      id,
      text: clampText(String(text || ''), LIMITS.NOTE_MAX),
      color: NOTE_COLORS.includes(opts.color) ? opts.color : NOTE_COLORS[0],
      x: Number.isFinite(pos.x) ? pos.x : 40,
      y: Number.isFinite(pos.y) ? pos.y : 40,
      w: Number(opts.w) || DEFAULT_SIZE.w,
      h: Number(opts.h) || DEFAULT_SIZE.h,
      z: maxZ() + 1,
      pinned: opts.pinned === true,
      collapsed: false
    })
    const trial = { ...entries.value, [id]: item }
    if (estimateBytes(trial) > LIMITS.NOTES_MAX) return { ok: false, reason: 'quota' }
    entries.value = trial
    persist()
    broadcast({ [id]: item })
    return { ok: true, id }
  }

  /** 局部更新。坐标/尺寸的改动也走这里 —— 它们同样是「要同步出去的改动」 */
  function update(id, patch) {
    const prev = entries.value[id]
    if (!prev || isTombstone(prev)) return { ok: false, reason: 'not-found' }
    const next = makeEntry({ ...prev, ...patch, id }, prev)
    if (next.text != null) next.text = clampText(String(next.text), LIMITS.NOTE_MAX)
    const trial = { ...entries.value, [id]: next }
    if (estimateBytes(trial) > LIMITS.NOTES_MAX) return { ok: false, reason: 'quota' }
    entries.value = trial
    persist()
    broadcast({ [id]: next })
    return { ok: true }
  }

  /** 拖拽结束才调用（拖动过程中只改本地 DOM，避免每帧广播） */
  function move(id, x, y) {
    return update(id, { x: Math.round(Number(x) || 0), y: Math.round(Number(y) || 0) })
  }

  function resize(id, w, h) {
    return update(id, {
      w: Math.max(180, Math.round(Number(w) || DEFAULT_SIZE.w)),
      h: Math.max(120, Math.round(Number(h) || DEFAULT_SIZE.h))
    })
  }

  function bringToFront(id) {
    const prev = entries.value[id]
    if (!prev || isTombstone(prev)) return { ok: false }
    const top = maxZ()
    if ((Number(prev.z) || 0) === top) return { ok: true }
    return update(id, { z: top + 1 })
  }

  function togglePin(id) {
    const prev = entries.value[id]
    if (!prev || isTombstone(prev)) return { ok: false }
    return update(id, { pinned: !prev.pinned })
  }

  function toggleCollapse(id) {
    const prev = entries.value[id]
    if (!prev || isTombstone(prev)) return { ok: false }
    return update(id, { collapsed: !prev.collapsed })
  }

  function setColor(id, color) {
    if (!NOTE_COLORS.includes(color)) return { ok: false, reason: 'bad-color' }
    return update(id, { color })
  }

  /** 删除留墓碑：同备注，否则旧设备一同步就把删掉的便签带回来 */
  function remove(id) {
    const prev = entries.value[id]
    if (!prev) return { ok: false, reason: 'not-found' }
    if (isTombstone(prev)) return { ok: true }
    const next = tombstone(prev)
    entries.value = { ...entries.value, [id]: next }
    persist()
    broadcast({ [id]: next })
    return { ok: true }
  }

  function restore(id) {
    const prev = entries.value[id]
    if (!prev || !isTombstone(prev)) return { ok: false, reason: 'not-deleted' }
    const next = makeEntry({ ...prev, id }, prev)
    entries.value = { ...entries.value, [id]: next }
    persist()
    broadcast({ [id]: next })
    return { ok: true }
  }

  /* ---------- 同步 ---------- */

  function applyRemote(incoming) {
    const { merged, changed } = mergeMaps(entries.value, incoming)
    if (!changed) return { changed: false }
    entries.value = merged
    persist()
    return { changed: true }
  }

  function exportSnapshot() {
    return entries.value
  }

  function prune(now = Date.now()) {
    const { map, removed } = pruneTombstones(entries.value, now, TOMBSTONE_TTL)
    if (removed) {
      entries.value = map
      persist()
    }
    return removed
  }

  /** 清空全部（含墓碑）—— 设置里的「清理便利贴」用它，不是日常删除路径 */
  function clearAll() {
    entries.value = {}
    persist()
    broadcast({})
  }

  prune()

  return {
    entries, items, pinned, count, usedBytes,
    create, update, move, resize, bringToFront, togglePin, toggleCollapse, setColor,
    remove, restore, applyRemote, exportSnapshot, prune, clearAll,
    NOTE_COLORS
  }
})
