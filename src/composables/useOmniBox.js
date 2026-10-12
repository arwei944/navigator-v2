/**
 * 全能框内核：查询解析 → 结果计算 → 分组 → 键盘导航 → 执行。
 *
 * 顶部搜索框（inline）与 Ctrl+K 浮层（palette）共用这一份，因此同一个关键词
 * 在两个入口得到的结果必然一致。两者的差别只有两点：
 *   1. 分组顺序 —— inline 站点优先（它是搜索框），palette 命令优先（它是命令面板）；
 *   2. 空输入默认视图 —— inline 不展开以免遮挡网格，palette 给「最近 + 常用」。
 *
 * 页面栈：root → siteActions(site)。Tab 进、退格/Esc 出。
 * 采用「对象在前」而非 `>命令 <站点名>`：按键更少，也不必在命令和站点名之间切换心智。
 */
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { usePreferencesStore } from '@/stores/preferences'
import { useFavoritesStore } from '@/stores/favorites'
import { useHistoryStore } from '@/stores/history'
import { useSidebarStore } from '@/stores/sidebar'
import { useToastStore } from '@/stores/toast'
import { useOmniStore } from '@/stores/omni'
import { buildCommands } from '@/utils/commands'
import { matchPhrase, describePhrase, PHRASE_MIN } from '@/utils/commandPhrases'
import { useUndoActions } from '@/composables/useUndoActions'
import { rankSites, matchAny, scoreText, scoreSite, clickTier } from '@/utils/search'
import { looksLikeUrl, hostOf } from '@/utils/url'
import { openInNewTab } from '@/utils/open'
import { useNotesStore } from '@/stores/notes'
import { useSiteNotesStore } from '@/stores/siteNotes'
import { useClicksStore } from '@/stores/clicks'
import { PURPOSE_TAGS } from '../../shared/purposes.mjs'

/** 分组顺序：inline 站点优先，palette 命令优先 */
const ORDER = {
  inline: ['site', 'page', 'view', 'action', 'domain', 'category', 'purpose', 'external'],
  palette: ['page', 'view', 'action', 'site', 'domain', 'category', 'purpose', 'external']
}

const GROUP_LABEL = {
  page: '页面',
  view: '视图',
  action: '操作',
  site: '站点',
  domain: '方向',
  category: '分类',
  purpose: '用途',
  external: '站外',
  recent: '最近访问',
  common: '常用命令',
  siteAction: '站点操作',
  phrase: '理解'
}

/** 前缀语义：> 只命令，@ 只站点，/ 只页面 */
const PREFIX = { '>': 'command', '@': 'site', '/': 'page' }

const SITE_LIMIT = 8

/**
 * 命令相关度：标题与手写关键词同权，副标题降权一半。
 * 不降权的话「设置」的副标题里出现「主题」两个字，就会盖过「切换主题」本身 ——
 * 副标题是解释文案，不该和命令名平起平坐。
 */
const SUB_WEIGHT = 0.5
function commandScore(c, q) {
  const main = matchAny([c.title, ...(c.keywords || [])], q)
  const sub = scoreText(c.subtitle || '', q) * SUB_WEIGHT
  return Math.max(main, sub)
}

export function useOmniBox({ mode = 'inline', onDone } = {}) {
  const router = useRouter()
  const sites = useSitesStore()
  const categories = useCategoriesStore()
  const preferences = usePreferencesStore()
  const favorites = useFavoritesStore()
  const history = useHistoryStore()
  const sidebar = useSidebarStore()
  const toast = useToastStore()
  const omni = useOmniStore()
  const notes = useNotesStore()
  const siteNotes = useSiteNotesStore()
  const clicks = useClicksStore()
  // 「撤销上一步」命令：撤销按钮的逻辑复用 useUndoActions，命令表只拿一个回调
  const { undoLast } = useUndoActions()

  /**
   * 中文别名表按需取。
   *
   * 它是纯数据（`utils/phraseAliases.js`，2.5 KiB 中文串），首屏**渲染**一次都用不到 ——
   * 压在入口里却会把 600 KiB 首屏预算吃满。所以拆成独立 chunk，由本函数动态取。
   * 取法是「挂载即发起」而不是「等 idle」：这是一次独立 chunk 拉取，不阻塞渲染，
   * 而别名表没到时「打中文出不来理解项」是**不确定**的行为 —— 宁可多发一个 2.5 KiB
   * 请求（在入口已下载完之后，与关键路径无争），也不让首发体验时好时坏。
   * 两个外壳共用同一份 ref，所以只拉一次。
   */
  const phraseAliases = ref({})
  let aliasesLoading = false
  async function loadPhraseAliases() {
    if (aliasesLoading || Object.keys(phraseAliases.value).length) return
    aliasesLoading = true
    try {
      const m = await import('@/utils/phraseAliases')
      phraseAliases.value = m.PHRASE_ALIASES || {}
    } catch {
      // 拉不到就退化成「只有标题 / 特征名两级匹配」——比抛出去炸掉整个搜索框好
    } finally {
      aliasesLoading = false
    }
  }
  const raw = ref('')
  const selectedIndex = ref(0)
  // 页面栈：null = root；否则为 { site }
  const page = ref(null)

  /** 打开站点的唯一口径：与卡片点击完全一致（新窗口 + 记访问 + 记历史） */
  function openSite(site) {
    openInNewTab('https://' + site.url)
    sites.recordVisit(site.id)
    history.addRecord(site.id)
  }

  const ctx = {
    router, sites, categories, preferences, favorites, history, sidebar, omni, toast, openSite,
    notes, siteNotes, undo: undoLast
  }

  const commands = computed(() => buildCommands(ctx))

  const prefix = computed(() => {
    const first = raw.value.trim()[0]
    return PREFIX[first] ? first : ''
  })

  /** 去掉前缀后的实际查询串 */
  const query = computed(() => {
    const v = raw.value
    return prefix.value ? v.trim().slice(1).trimStart() : v
  })

  const trimmed = computed(() => query.value.trim())

  // 挂载即取别名表，并在用户开始打字时兜底重试（首次失败不留下「永远没有中文理解」）
  loadPhraseAliases()
  watch(trimmed, v => { if (v) loadPhraseAliases() })

  // 输入变化时把选中项复位到第一条，否则上一条的高亮会落在新结果之外
  watch(query, () => { selectedIndex.value = 0 })

  /* ---------- 网址候选（沿用搜索框既有的决策链） ---------- */

  const domainCandidate = computed(() => {
    const q = trimmed.value
    if (!q || !looksLikeUrl(q)) return null
    const host = hostOf(q)
    return host ? { host, url: q } : null
  })

  const collected = computed(() => {
    const c = domainCandidate.value
    if (!c) return null
    return sites.sites.find(s => hostOf(s.url) === c.host) || null
  })

  /* ---------- root 页结果 ---------- */

  const commandResults = computed(() => {
    const q = trimmed.value
    if (!q) return []
    const only = prefix.value
    if (only && only !== 'command') return []
    return commands.value
      .map(c => ({ cmd: c, score: commandScore(c, q) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(x => ({
        key: `cmd:${x.cmd.id}`,
        type: x.cmd.section,
        title: x.cmd.title,
        subtitle: x.cmd.subtitle,
        icon: x.cmd.icon,
        danger: false,
        score: x.score,
        run: x.cmd.run
      }))
  })

  const siteResults = computed(() => {
    const q = trimmed.value
    if (!q) return []
    if (prefix.value && prefix.value !== 'site') return []
    // 命令面板是全局检索：始终搜全量站点，不受当前分类与页面搜索词影响
    //
    // 加权口径与首页搜索保持一致（同一开关、同一份点击数据）：两处排序若不一致，
    // 用户会看到「命令面板里排第一、回到首页却排在后面」这种说不清的差别。
    const boost = preferences.clickBoost ? clicks.mergedCounts : null
    return rankSites(sites.sites, q, { limit: SITE_LIMIT, clicks: boost }).map(s => ({
      key: `site:${s.id}`,
      type: 'site',
      title: s.name,
      subtitle: s.url,
      site: s,
      icon: '',
      danger: false,
      // 加权改变了顺序，就必须把「为什么」标出来，而不是默默把某条顶上去
      frequent: boost ? clickTier(boost, s.id) >= 2 : false,
      run: () => openSite(s)
    }))
  })

  const domainResults = computed(() => {
    const q = trimmed.value
    if (!q || prefix.value) return []
    return categories.domains
      .map(d => ({ d, score: matchAny([d.label, d.id], q) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map(x => ({
        key: `dom:${x.d.id}`,
        type: 'domain',
        title: x.d.label,
        subtitle: '整个方向',
        icon: 'dot',
        run: () => router.push({ name: 'Home', query: { c: x.d.id } })
      }))
  })

  const categoryResults = computed(() => {
    const q = trimmed.value
    if (!q || prefix.value) return []
    return categories.categories
      .map(c => ({ c, score: matchAny([c.label, c.id], q) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map(x => ({
        key: `cat:${x.c.id}`,
        type: 'category',
        title: x.c.label,
        subtitle: categories.getCategoryLabel(x.c.id),
        dotColor: x.c.dotColor,
        icon: 'dot',
        run: () => router.push({ name: 'Home', query: { c: x.c.id } })
      }))
  })

  const purposeResults = computed(() => {
    const q = trimmed.value
    if (!q || prefix.value) return []
    return PURPOSE_TAGS
      .map(p => ({ p, score: matchAny([p.label, p.id], q) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map(x => ({
        key: `pur:${x.p.id}`,
        type: 'purpose',
        title: x.p.label,
        subtitle: '按用途筛选',
        dotColor: x.p.color,
        icon: 'dot',
        run: () => router.push({ name: 'Home', query: { p: x.p.id } })
      }))
  })

  /** 站外搜索出口：与搜索框共用当前引擎，永远给一条出路 */
  const externalItem = computed(() => {
    const q = trimmed.value
    if (!q || prefix.value) return []
    const e = preferences.getCurrentEngine()
    return [{
      key: 'ext:search',
      type: 'external',
      title: `用 ${e.label} 搜索「${q}」`,
      subtitle: '在浏览器新标签页打开',
      icon: 'search',
      run: () => openInNewTab(`${e.url}?q=${encodeURIComponent(q)}`)
    }]
  })

  /** 输入像网址时置顶的「添加 / 已收录」行 */
  const urlItems = computed(() => {
    const q = trimmed.value
    if (!q || prefix.value) return []
    const col = collected.value
    const cand = domainCandidate.value
    if (col) {
      return [{
        key: `site:${col.id}`,
        type: 'site',
        title: col.name,
        subtitle: '该域名已收录',
        site: col,
        icon: '',
        run: () => openSite(col)
      }]
    }
    if (cand) {
      return [{
        key: 'add:url',
        type: 'add',
        title: `添加站点 ${cand.host}`,
        subtitle: '按此网址自动抓取名称、描述与图标',
        icon: 'plus',
        run: () => omni.requestAdd(cand.url)
      }]
    }
    return []
  })

  /* ---------- 默认视图（palette 空输入） ---------- */

  const defaultGroups = computed(() => {
    const groups = []
    const recent = history.getRecentSites(sites.sites).slice(0, 5)
    if (recent.length) {
      groups.push({
        type: 'recent',
        label: GROUP_LABEL.recent,
        items: recent.map(s => ({
          key: `site:${s.id}`,
          type: 'site',
          title: s.name,
          subtitle: s.url,
          site: s,
          icon: '',
          run: () => openSite(s)
        }))
      })
    }
    const common = ['action.add', 'view.theme', 'page.favorites', 'page.recent', 'action.settings', 'action.card']
      .map(id => commands.value.find(c => c.id === id))
      .filter(Boolean)
      .map(c => ({
        key: `cmd:${c.id}`,
        type: c.section,
        title: c.title,
        subtitle: c.subtitle,
        icon: c.icon,
        run: c.run
      }))
    if (common.length) groups.push({ type: 'common', label: GROUP_LABEL.common, items: common })
    return groups
  })

  /* ---------- 二级页（站点操作） ---------- */

  const siteActionItems = computed(() => {
    const p = page.value
    if (!p) return []
    const all = commands.value.siteActions(p.site)
    const q = trimmed.value
    if (!q) return all.map(a => ({ ...a, key: `act:${a.id}`, type: 'action' }))
    return all
      .map(a => ({ a, score: commandScore(a, q) }))
      .filter(x => x.score > 0)
      .sort((x, y) => y.score - x.score)
      .map(x => ({ ...x.a, key: `act:${x.a.id}`, type: 'action' }))
  })

  /* ---------- 自然语言 → 命令（I3） ---------- */

  /**
   * 一句话直接解析成一条命令：「切换到深色」→ 切换主题。
   *
   * 三条约束：
   * 1. **只在无前缀时**：`>` / `@` / `/` 已有明确语义，不让自然语言插手；
   * 2. **只在 root 页**：站点二级页里用户是在挑对某个站的操作，不是在下达全局命令；
   * 3. **解析不出就返回 null**：猜错的代价是这条搜索结果整段消失，所以宁可不猜。
   *
   * 误命中怎么退：phrase 项是结果的第一项（默认选中），按一下 ↓ 就移到搜索结果，
   * 不需要记特殊快捷键，也不与 Esc=关闭面板的既有语义冲突。
   */
  const phraseHint = computed(() => {
    if (prefix.value || page.value) return null
    const q = trimmed.value
    if (q.length < PHRASE_MIN) return null
    return matchPhrase(q, commands.value, phraseAliases.value)
  })

  const phraseItem = computed(() => {
    const hit = phraseHint.value
    if (!hit) return null
    return {
      key: `phrase:${hit.cmd.id}`,
      type: 'phrase',
      title: hit.cmd.title,
      // 「理解为：深色 → 切换主题」—— 用户在按回车之前就能看到系统理解成了什么
      subtitle: `理解为：${describePhrase(hit)} · ↓ 看其它结果`,
      icon: hit.cmd.icon,
      danger: false,
      // 徽标用：明说这是系统猜的，不是用户搜出来的
      phrase: true,
      run: hit.cmd.run
    }
  })

  /* ---------- 分组输出 ---------- */

  // 命令侧最高分 / 站点侧最高分，用于决定 inline 下谁先露面
  const topCmdScore = computed(() => Math.max(0, ...commandResults.value.map(i => i.score || 0)))
  const topSiteScore = computed(() => {
    const q = trimmed.value.toLowerCase()
    if (!q) return 0
    const first = siteResults.value[0]
    return first ? scoreSite(first.site, q) : 0
  })

  /**
   * inline 默认站点优先（它毕竟是搜索框），但命令**精确/前缀命中**时反过来 ——
   * 用户打 `zhuti` 是要「切换主题」，不该被 Fuse 模糊兜底出来的站点压在下面。
   * 阈值取 PREFIX(700)：包含级与拼音级命中不足以翻盘。
   */
  const groupOrder = computed(() => {
    if (mode !== 'inline') return ORDER.palette
    if (topCmdScore.value >= 700 && topCmdScore.value > topSiteScore.value) {
      return ['page', 'view', 'action', 'site', 'domain', 'category', 'purpose', 'external']
    }
    return ORDER.inline
  })

  const groups = computed(() => {
    if (page.value) {
      const items = siteActionItems.value
      return items.length ? [{ type: 'siteAction', label: GROUP_LABEL.siteAction, items }] : []
    }

    const q = trimmed.value
    // inline 空输入不展开：一聚焦就盖住网格是干扰
    if (!q) return mode === 'palette' ? defaultGroups.value : []

    const byType = {
      site: [...urlItems.value, ...siteResults.value.filter(s => !urlItems.value.some(u => u.key === s.key))],
      page: commandResults.value.filter(c => c.type === 'page'),
      view: commandResults.value.filter(c => c.type === 'view'),
      action: commandResults.value.filter(c => c.type === 'action'),
      domain: domainResults.value,
      category: categoryResults.value,
      purpose: purposeResults.value,
      external: externalItem.value
    }

    const list = groupOrder.value
      .map(t => ({ type: t, label: GROUP_LABEL[t], items: byType[t] || [] }))
      .filter(g => g.items.length)

    // 自然语言命中时置顶，且**只此一条**独占一组 —— 它是「系统猜你的意图」，
    // 与普通结果混在一起会让用户分不清哪条是猜的。作为第一项默认选中，
    // 回车即执行；按 ↓ 立即让位给下面的搜索结果。
    if (phraseItem.value) {
      list.unshift({ type: 'phrase', label: GROUP_LABEL.phrase, items: [phraseItem.value] })
    }
    return list
  })

  const flatItems = computed(() => groups.value.flatMap(g => g.items))

  // 必须显式转成布尔：Vue 的 Boolean prop 会把空字符串 '' 判成 true
  // （HTML 特性 `<comp disabled>` ≡ disabled=""），于是空输入也会显示「没有找到匹配结果」
  const empty = computed(() => Boolean(trimmed.value) && flatItems.value.length === 0)

  /* ---------- 导航与执行 ---------- */

  function clampIndex() {
    const n = flatItems.value.length
    if (!n) { selectedIndex.value = 0; return }
    if (selectedIndex.value >= n) selectedIndex.value = 0
    if (selectedIndex.value < 0) selectedIndex.value = n - 1
  }

  function moveDown() {
    const n = flatItems.value.length
    if (!n) return
    selectedIndex.value = (selectedIndex.value + 1) % n
  }

  function moveUp() {
    const n = flatItems.value.length
    if (!n) return
    selectedIndex.value = (selectedIndex.value - 1 + n) % n
  }

  function selected() {
    clampIndex()
    return flatItems.value[selectedIndex.value] || null
  }

  /** 进入某个站点的操作页 */
  function pushSiteActions(site) {
    if (!site) return
    page.value = { site }
    raw.value = ''
    selectedIndex.value = 0
  }

  function back() {
    if (!page.value) return false
    page.value = null
    raw.value = ''
    selectedIndex.value = 0
    return true
  }

  function reset() {
    raw.value = ''
    page.value = null
    selectedIndex.value = 0
  }

  /**
   * 回车：执行当前选中项。
   * onDone 收到的是被执行的那一项 —— 外壳据此决定「保留搜索词」还是「清空」，
   * 因为打开一个站点和执行一条命令对页面的影响完全不同。
   */
  function enter() {
    const item = selected()
    if (!item) return false
    item.run?.()
    onDone?.(item)
    return true
  }

  /** Tab：在 root 页对站点展开操作页 */
  function tab() {
    const item = selected()
    if (page.value || !item?.site) return false
    pushSiteActions(item.site)
    return true
  }

  /** 退格：二级页且输入为空时退回 root */
  function backspace() {
    if (!page.value) return false
    if (trimmed.value) return false
    back()
    return true
  }

  const breadcrumb = computed(() => {
    if (!page.value) return ''
    return page.value.site?.name || ''
  })

  return {
    raw, query, trimmed, prefix,
    groups, flatItems, selectedIndex, empty, breadcrumb, page: page,
    moveDown, moveUp, selected, enter, tab, backspace, back, reset,
    pushSiteActions, openSite,
    collected, domainCandidate,
    // 暴露给外壳：inline 的「意图筛选」提示条在自然语言命中命令时应当让位，
    // 否则「按点击量排序」会同时得到两条语义重复的提示
    phraseHint
  }
}
