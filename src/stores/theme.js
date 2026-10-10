/**
 * 主题：内置 8 套 + 用户自建 + 切换策略。
 *
 * ## 行为等价（最重要的一条）
 *
 * store 初始化时**不会**主动应用任何主题。老用户升级后 `preferences.visualScheme`
 * 仍是原值，这里读它作为「当前内置主题」即可 —— 不去覆盖，外观就一帧都不会变。
 * 只有用户主动点了某个主题（或选了自建主题）才写 preferences。
 *
 * 唯一例外是**已选中自定义主题**的情况：自定义主题不存在 preferences 里，
 * 刷新后不重新应用就会退回基础方案，所以那种情况必须补一次。
 *
 * ## 自定义主题为什么存「覆盖」而不是完整快照
 *
 * 存覆盖：内置主题将来调好了（比如宣纸的底色再暖一点），用户的自建主题会跟着变好。
 * 存快照：用户的主题会僵在旧值上，且导出文件里带着一堆他没改过的字段。
 */
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { versionedPersist } from '@/utils/storeVersioning'
import { usePreferencesStore } from '@/stores/preferences'
import {
  builtinThemes, blankCustomFrom, isBuiltinId, newCustomId, normalizeCustom,
  parseThemes, schemeIdOf, serializeThemes
} from '@/utils/themeSchema'

/** 定时检查的间隔：一分钟一次足够 —— 人不会盯着 19:00:00 看它切换 */
const TICK_MS = 60_000

/** 19:00–07:00 这类跨零点区间的判定（from > to 表示跨天） */
export function inSchedule(now = new Date(), { from = '19:00', to = '07:00' } = {}) {
  const toMin = (hhmm) => {
    const [h, m] = String(hhmm || '0:0').split(':').map(n => Number(n) || 0)
    return h * 60 + m
  }
  const cur = now.getHours() * 60 + now.getMinutes()
  const f = toMin(from)
  const t = toMin(to)
  return f <= t ? (cur >= f && cur < t) : (cur >= f || cur < t)
}

/**
 * 启动时要补做哪些动作（纯函数，只做决定、不产生副作用 —— 便于单测）。
 *
 * 「为什么需要它」：pinia-plugin-persistedstate 是在 store 的 setup **返回之后**才回填
 * 持久化状态的（见 dist 里 `hydrateStore → store.$patch`，同步执行）。所以 setup 主体里
 * 直接读 `follow` / `activeId`，拿到的永远是默认值 —— 早期版本就是死在这里：
 * 「跟随系统」「日落切换」「自定义主题刷新后补应用」三条在刷新后一次都没执行过，
 * 必须等一个微任务（回填已同步完成，微任务足够，也不会多出一帧可见闪烁）才做判断。
 */
export function bootActions({ follow, activeId, customIds = [] } = {}) {
  const out = []
  if (follow === 'system') out.push('system')
  else if (follow === 'schedule') out.push('schedule')
  // 内置主题本来就存在 preferences.visualScheme 里，不补；只有自建主题需要重放
  if (activeId && !isBuiltinId(activeId) && customIds.includes(activeId)) out.push('apply')
  return out
}

export const useThemeStore = defineStore('theme', () => {
  const preferences = usePreferencesStore()

  /** 用户自建主题（存覆盖：colors / tokens 只记改过的项） */
  const customThemes = ref([])
  /** 当前主题 id。空串 = 从未主动选过，沿用 preferences 现状（行为等价的关键） */
  const activeId = ref('')
  /** manual | system | schedule */
  const follow = ref('manual')
  const schedule = ref({ from: '19:00', to: '07:00' })

  const builtins = computed(() => builtinThemes())
  const allThemes = computed(() => [...builtins.value, ...customThemes.value])

  /** 实际生效的主题 id：没主动选过就是当前视觉方案对应的那套内置主题 */
  const effectiveId = computed(() => {
    if (activeId.value) return activeId.value
    return `builtin:${preferences.visualScheme || 'apple'}`
  })

  const current = computed(() =>
    allThemes.value.find(t => t.id === effectiveId.value) || builtins.value[0]
  )
  const currentName = computed(() => current.value?.name || '苹果原生')
  const isCustomActive = computed(() => !isBuiltinId(effectiveId.value))

  /* ---------- 应用 ---------- */

  function apply(id) {
    if (!id) return
    activeId.value = id

    if (isBuiltinId(id)) {
      // 内置主题 = 现有视觉方案 + 它自带的配色与明暗，走的是现有代码路径
      preferences.setVisualScheme(schemeIdOf(id))
      return
    }

    const t = customThemes.value.find(x => x.id === id)
    if (!t) return
    // 顺序不能反：setVisualScheme 会清空令牌微调，必须让它先把基础铺好，
    // 再由 applyColors / setVisualTokens 叠上用户的覆盖。
    preferences.setVisualScheme(t.base)
    preferences.applyColors(t.colors[preferences.theme] || t.colors.light || {})
    if (t.tokens && Object.keys(t.tokens).length) preferences.setVisualTokens(t.tokens)
  }

  /** 明暗切换后，自定义主题要按新模式再落一次颜色（内置主题由 applyPreset 自己处理） */
  watch(() => preferences.theme, (mode) => {
    if (!isCustomActive.value) return
    const t = customThemes.value.find(x => x.id === effectiveId.value)
    if (t) preferences.applyColors(t.colors[mode] || t.colors.light || {})
  })

  /* ---------- 自建主题 ---------- */

  function saveCustom(theme) {
    const t = normalizeCustom(theme)
    if (!t) return { ok: false, reason: 'invalid' }
    const idx = customThemes.value.findIndex(x => x.id === t.id)
    if (idx >= 0) {
      const next = customThemes.value.slice()
      next[idx] = t
      customThemes.value = next
    } else {
      customThemes.value = [...customThemes.value, t]
    }
    apply(t.id)
    return { ok: true, id: t.id }
  }

  /** 以当前生效主题为起点复制一份可编辑的草稿 */
  function draftFromCurrent() {
    const cur = current.value
    if (isBuiltinId(cur.id)) {
      return blankCustomFrom(schemeIdOf(cur.id), `${cur.name} 的副本`)
    }
    return normalizeCustom(JSON.parse(JSON.stringify(cur)))
  }

  function renameCustom(id, name) {
    const idx = customThemes.value.findIndex(x => x.id === id)
    if (idx < 0) return { ok: false }
    const next = customThemes.value.slice()
    next[idx] = { ...next[idx], name: String(name || '').trim().slice(0, 24) || next[idx].name }
    customThemes.value = next
    return { ok: true }
  }

  function deleteCustom(id) {
    customThemes.value = customThemes.value.filter(x => x.id !== id)
    if (activeId.value === id) apply(`builtin:${preferences.visualScheme || 'apple'}`)
    return { ok: true }
  }

  function duplicateCustom(id) {
    const src = customThemes.value.find(x => x.id === id)
    if (!src) return { ok: false }
    const copy = normalizeCustom({
      ...JSON.parse(JSON.stringify(src)),
      id: newCustomId(),
      name: `${src.name} 副本`
    })
    customThemes.value = [...customThemes.value, copy]
    return { ok: true, id: copy.id }
  }

  /* ---------- 导入 / 导出 ---------- */

  function exportThemes() {
    return serializeThemes(customThemes.value)
  }

  function importThemes(text) {
    const { themes, skipped } = parseThemes(text)
    if (!themes.length) return { ok: false, skipped }
    const map = new Map(customThemes.value.map(t => [t.id, t]))
    for (const t of themes) map.set(t.id, t)
    customThemes.value = [...map.values()]
    return { ok: true, count: themes.length, skipped }
  }

  /* ---------- 切换策略 ---------- */

  function setFollow(mode) {
    follow.value = ['manual', 'system', 'schedule'].includes(mode) ? mode : 'manual'
    if (follow.value === 'system') applySystemNow()
    if (follow.value === 'schedule') applyScheduleNow()
  }

  function setSchedule(next) {
    schedule.value = { ...schedule.value, ...(next || {}) }
    if (follow.value === 'schedule') applyScheduleNow()
  }

  function applySystemNow() {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
    preferences.setTheme(dark ? 'dark' : 'light')
  }

  function applyScheduleNow() {
    preferences.setTheme(inSchedule(new Date(), schedule.value) ? 'dark' : 'light')
  }

  // 跟随系统：系统一变就跟着变。用户手动切过（toggleTheme）也能覆盖到下次系统变化。
  // 这里的回调是**事件时**读 `follow.value`，所以不受回填时序影响。
  if (typeof window !== 'undefined' && window.matchMedia) {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e) => {
      if (follow.value === 'system') preferences.setTheme(e.matches ? 'dark' : 'light')
    }
    if (mql.addEventListener) mql.addEventListener('change', onChange)
    else if (mql.addListener) mql.addListener(onChange)

    // 定时切换按分钟轮询。不做 setTimeout 精确定时：标签页休眠后定时器会被推迟，
    // 轮询反而能在唤醒的第一分钟就纠回正确状态。
    setInterval(() => {
      if (follow.value === 'schedule') applyScheduleNow()
    }, TICK_MS)
  }

  /**
   * 一次性补做启动动作。必须等持久化回填完成 —— 见 `bootActions` 的说明。
   * 放在微任务里：回填是同步的，微任务已经晚于它，又早于浏览器绘制，不会闪。
   */
  function bootstrap() {
    for (const action of bootActions({
      follow: follow.value,
      activeId: activeId.value,
      customIds: customThemes.value.map(t => t.id),
    })) {
      if (action === 'system') applySystemNow()
      else if (action === 'schedule') applyScheduleNow()
      else if (action === 'apply') apply(activeId.value)
    }
  }
  queueMicrotask(bootstrap)

  return {
    customThemes, activeId, follow, schedule,
    builtins, allThemes, effectiveId, current, currentName, isCustomActive,
    apply, saveCustom, draftFromCurrent, renameCustom, deleteCustom, duplicateCustom,
    exportThemes, importThemes, setFollow, setSchedule, inScheduleNow: applyScheduleNow,
    /** 补做启动动作；正常由 store 初始化时的微任务调用，这里暴露是为了可测与可重放 */
    bootstrap,
  }
}, {
  persist: versionedPersist('theme', ['customThemes', 'activeId', 'follow', 'schedule'])
})
