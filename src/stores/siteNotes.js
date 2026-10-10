/**
 * 站点备注：附在某个站点上的个人批注（「免费额度每月 50 次」「要挂代理」）。
 *
 * ## 它为什么不放在站点表里
 *
 * 站点表（`sites.json`）是**公共**数据，一次发布就会整份覆盖。备注写进去有两个后果：
 * 一是别人看得到你的批注，二是每次发布都可能被冲掉。所以备注留在本地 + 会话同步，
 * 与站点热更新彻底解耦（见 `services/session.js`）。
 *
 * ## 300 张卡的性能口径
 *
 * 卡片只订阅 `marks`（一个 Set）与 `pinnedSummaries`（一个 Map），**不**去读
 * `entries[site.id]` —— 后者会在 300 张卡上各建一条深层依赖，备注一改要重算 300 次。
 * 摘要在写入时就截断算好，渲染阶段不做字符串处理。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { decodeStored, encodeStored } from '@/utils/storeVersioning'
import { safeSetItem } from '@/utils/safeStorage'
import { setNoteProvider } from '@/utils/search'
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

const KEY = 'nav-site-notes'
/** 卡片上露出的摘要长度（中文按字符算） */
const SUMMARY_LEN = 40

function readRaw() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : ''
  } catch {
    return ''
  }
}

/** 模块级单例通道：store 是单例，通道也只该有一条 */
let bus = null

export const useSiteNotesStore = defineStore('siteNotes', () => {
  const entries = ref(decodeStored(KEY, readRaw(), {}))

  function persist() {
    safeSetItem(KEY, encodeStored(entries.value))
  }

  if (!bus) {
    bus = createLiveBus((msg) => {
      if (msg?.type !== 'siteNotes' || !msg.entries) return
      applyRemote(msg.entries)
    })
  }

  /** 广播本次改动（只发涉及的条目，不发全表） */
  function broadcast(changed) {
    bus?.post({ type: 'siteNotes', entries: changed })
  }

  /* ---------- 派生 ---------- */

  /** 去掉墓碑后的可见备注 */
  const visible = computed(() => {
    const out = {}
    for (const [k, v] of Object.entries(entries.value)) {
      if (!isTombstone(v)) out[k] = v
    }
    return out
  })

  /** 有备注的站点 id 集合 —— 卡片只做 marks.has(id) */
  const marks = computed(() => new Set(Object.keys(visible.value)))

  /** 钉住的备注摘要，写入时已截断 */
  const pinnedSummaries = computed(() => {
    const out = new Map()
    for (const [k, v] of Object.entries(visible.value)) {
      if (!v.pinned) continue
      const text = String(v.text || '').replace(/\s+/g, ' ').trim()
      out.set(k, Array.from(text).slice(0, SUMMARY_LEN).join('') + (Array.from(text).length > SUMMARY_LEN ? '…' : ''))
    }
    return out
  })

  /** 供检索内核使用：id → 小写备注文本。检索命中档位见 utils/search.js */
  const searchText = computed(() => {
    const out = new Map()
    for (const [k, v] of Object.entries(visible.value)) {
      const t = String(v.text || '').trim()
      if (t) out.set(k, t.toLowerCase())
    }
    return out
  })

  /** 已用体量（字节，粗算）。UI 用来在逼近上限时提示 */
  const usedBytes = computed(() => estimateBytes(entries.value))

  /* ---------- 读写 ---------- */

  function textOf(siteId) {
    const e = visible.value[siteId]
    return e ? String(e.text || '') : ''
  }

  function has(siteId) {
    return Boolean(visible.value[siteId])
  }

  function isPinned(siteId) {
    return Boolean(visible.value[siteId]?.pinned)
  }

  /**
   * 写一条备注。空文本等于删除（否则会留下一堆看不见的空条目占配额）。
   * @returns {{ok: boolean, reason?: string}}
   */
  function setText(siteId, text) {
    if (!siteId) return { ok: false, reason: 'no-id' }
    const trimmed = String(text ?? '').trim()
    if (!trimmed) return remove(siteId)

    const clamped = clampText(trimmed, LIMITS.SITE_NOTE_MAX)
    const prev = entries.value[siteId]
    const next = makeEntry(
      { text: clamped, pinned: prev?.pinned === true },
      prev
    )
    // 配额：先算上这条会不会超；超了就拒绝本次写入，而不是把老的挤掉
    const trial = { ...entries.value, [siteId]: next }
    if (estimateBytes(trial) > LIMITS.SITE_NOTES_MAX) {
      return { ok: false, reason: 'quota' }
    }
    entries.value = trial
    persist()
    broadcast({ [siteId]: next })
    return { ok: true, truncated: clamped !== trimmed }
  }

  /** 删除：留墓碑，不直接删键 —— 否则旧设备一同步就会把它复活回来 */
  function remove(siteId) {
    const prev = entries.value[siteId]
    if (!prev) return { ok: false, reason: 'not-found' }
    if (isTombstone(prev)) return { ok: true }
    const next = tombstone(prev)
    entries.value = { ...entries.value, [siteId]: next }
    persist()
    broadcast({ [siteId]: next })
    return { ok: true }
  }

  /** 撤销删除：把墓碑的 deletedAt 抹掉，文本沿用墓碑里保留的那一版 */
  function restore(siteId) {
    const prev = entries.value[siteId]
    if (!prev || !isTombstone(prev)) return { ok: false, reason: 'not-deleted' }
    const next = makeEntry({ text: prev.text || '', pinned: prev.pinned === true }, prev)
    entries.value = { ...entries.value, [siteId]: next }
    persist()
    broadcast({ [siteId]: next })
    return { ok: true }
  }

  function togglePin(siteId) {
    const prev = visible.value[siteId]
    if (!prev) return { ok: false, reason: 'not-found' }
    const next = makeEntry({ text: prev.text || '', pinned: !prev.pinned }, prev)
    entries.value = { ...entries.value, [siteId]: next }
    persist()
    broadcast({ [siteId]: next })
    return { ok: true, pinned: next.pinned }
  }

  /* ---------- 同步 ---------- */

  /** 合入远端条目（广播或云端快照），幂等 */
  function applyRemote(incoming) {
    const { merged, changed } = mergeMaps(entries.value, incoming)
    if (!changed) return { changed: false }
    entries.value = merged
    persist()
    return { changed: true }
  }

  /** 交给 /api/session 的快照：带墓碑一起走，删除才能传播到别的设备 */
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

  // 检索内核要能读到备注，但 search.js 是纯函数不依赖 Pinia —— 由这里注入一个惰性取值函数。
  // 传入的是 computed 的 getter，所以「备注改了」会让依赖检索结果的 computed 自动重算。
  setNoteProvider(() => searchText.value)

  prune()

  return {
    entries, visible, marks, pinnedSummaries, searchText, usedBytes,
    textOf, has, isPinned, setText, remove, restore, togglePin,
    applyRemote, exportSnapshot, prune
  }
})
