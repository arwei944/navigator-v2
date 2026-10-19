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
import { openInNewTab } from '@/utils/open'
import { GROUP_LABEL, commandScore, buildDefaultGroups, buildSiteActionItems } from '@/utils/omniViews'
import { useOmniPreview } from '@/composables/useOmniPreview'
import { useOmniPhrase } from '@/composables/useOmniPhrase'
import { useNotesStore } from '@/stores/notes'
import { useSiteNotesStore } from '@/stores/siteNotes'
import { useClicksStore } from '@/stores/clicks'
import { useHealthStore } from '@/stores/health'
import { PURPOSE_TAGS } from '../../shared/purposes.mjs'

/** 分组顺序：inline 站点优先，palette 命令优先；网址预览两边都在最前 */
const ORDER = {
  inline: ['preview', 'site', 'page', 'view', 'action', 'domain', 'category', 'purpose', 'external'],
  palette: ['preview', 'page', 'view', 'action', 'site', 'domain', 'category', 'purpose', 'external']
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

  /* ── 运维动作（#16 自然语言运维）──
   * 只提供**可撤销**的动作：归档能一键取回、取消归档本身就是反向操作。
   * 删除 / 清空这类不可逆的动作不给自然语言入口 —— 一句话误触的代价太高。 */
  const health = useHealthStore()

  /** 把探活判定为「需处理」的站点批量移入归档；返回处理条数 */
  function archiveDownSites() {
    const ids = sites.sites
      .filter(s => !s.archived && health.getStatus(s.id).status === 'down')
      .map(s => s.id)
    if (ids.length) sites.batchUpdate(ids, { archived: true, pinned: false })
    return ids.length
  }

  /** 把所有归档站点取回默认列表；返回恢复条数 */
  function unarchiveAllSites() {
    const ids = sites.sites.filter(s => s.archived).map(s => s.id)
    if (ids.length) sites.batchUpdate(ids, { archived: false })
    return ids.length
  }

  const ctx = {
    router, sites, categories, preferences, favorites, history, sidebar, omni, toast, openSite,
    notes, siteNotes, undo: undoLast, health, archiveDownSites, unarchiveAllSites
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

  /* ---------- 网址候选与下拉预览卡 ----------
   * 实现在 useOmniPreview.js：候选判定、是否已收录、抓取、译文补全，
   * 以及与 shouldPreview 同源的预取触发都在那里。这里只取结果。 */
  const { domainCandidate, collected, previewCardFinal } = useOmniPreview({
    raw, trimmed, prefix, page, sites, categories,
  })

  /* ---------- root 页结果 ---------- */

  /**
   * 命令评分的上下文（注入 matchAny / scoreText / 副标题权重）。
   *
   * ⚠️ 必须定义在**所有** `commandScore` 调用之前 —— `commandScore` 的第三个参数是
   * 解构签名（`{ matchAny, scoreText, subWeight }`），漏传会直接抛
   * `Cannot destructure property 'matchAny' of 'undefined'`，而该异常发生在
   * 搜索框 render 期间的 computed 里，Vue 会把整棵子树卸掉重挂 → 输入框失焦、
   * 后续字符全部丢失。这个顺序是「输入首字符即失焦」的真实根因。
   */
  const scoreCtx = { matchAny, scoreText, subWeight: SUB_WEIGHT }

  const commandResults = computed(() => {
    const q = trimmed.value
    if (!q) return []
    const only = prefix.value
    if (only && only !== 'command') return []
    return commands.value
      .map(c => ({ cmd: c, score: commandScore(c, q, scoreCtx) }))
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

  /**
   * 输入像网址时置顶的**预览卡片**：一张卡说清「这个网址是什么」，并给出唯一的下一步。
   *
   * 卡片本身就是那条可执行项 —— 回车=打开（已收录）或添加（未收录），
   * 不额外长一条操作行：同一件事给两个入口，用户还得判断该点哪个。
   */
  const previewItems = computed(() => {
    const q = trimmed.value
    if (!q || prefix.value) return []
    const cand = domainCandidate.value
    if (!cand) return []

    const col = collected.value
    const state = previewCardFinal.value
    return [{
      key: col ? `site:${col.id}` : 'preview:url',
      // type 说的是「这是什么条目」，不是「在哪个组」：已收录是一条站点项，
      // 未收录是一条添加项 —— 外壳据此决定回车后要不要保留搜索词（见 UnifiedSearchBox#done），
      // 换成 'preview' 会让「打开站点」变成「清空搜索框」。
      type: col ? 'site' : 'add',
      title: state.card?.titleTranslated || state.card?.title || cand.host,
      subtitle: col ? '该域名已收录' : '按此网址自动抓取名称、描述与图标',
      icon: col ? '' : 'plus',
      // 渲染成卡片而不是单行，全靠这个字段；数据与状态判定都在 utils/urlPreview.js
      preview: state,
      // 已收录才有站点可操作（⇥ 进操作页），未收录时不留空的 site
      ...(col ? { site: col } : {}),
      run: () => (col ? openSite(col) : omni.requestAdd(cand.url))
    }]
  })

  /* ---------- 默认视图 / 二级页 ----------
   * 组装逻辑在 utils/omniViews.js（纯函数）：默认视图固定「最近访问 + 常用命令」，
   * 二级页按关键词过滤并评分。这里只提供数据源与评分函数。
   * `scoreCtx` 已提到 `commandResults` 之前定义，见那里的说明。 */
  const defaultGroups = computed(() =>
    buildDefaultGroups({ sites: sites.sites, commands: commands.value, getRecentSites: history.getRecentSites, openSite }),
  )
  const siteActionItems = computed(() =>
    buildSiteActionItems({ pageSite: page.value?.site, commands: commands.value, query: trimmed.value, scoreCtx }),
  )

  /* ---------- 自然语言 → 命令（I3） ----------
   * 实现在 useOmniPhrase.js：前缀 / 二级页 / 最短长度三重闸，解析不出就返回 null。
   * 这里只接线，供分组输出与提示条使用。 */
  const { phraseHint, phraseItem } = useOmniPhrase({ trimmed, prefix, page, commands, phraseAliases })

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
      return ['preview', 'page', 'view', 'action', 'site', 'domain', 'category', 'purpose', 'external']
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
      preview: previewItems.value,
      // 已收录的站点已在预览卡片里出现过，站点组里不再重复列一遍（同一 key 会让键盘序号错位）
      site: siteResults.value.filter(s => !previewItems.value.some(u => u.key === s.key)),
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
