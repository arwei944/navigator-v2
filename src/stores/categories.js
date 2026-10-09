import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { CATEGORY_GROUPS, cloneGroups, sanitizeGroups } from '../../shared/categories.mjs'
import { encodeStored, decodeStored } from '@/utils/storeVersioning'
import { safeSetItem } from '@/utils/safeStorage'

const OVERLAY_KEY = 'nav-categories-overlay'

/**
 * 本地新增分类覆盖层（与站点 overlay 同思路）：云端 / 默认表是基底，
 * 本地新建的分类（搜索栏自动建、后台手动建）叠在其上并落盘。
 * 没有这一层时，刷新会把未发布的分类冲回基底 —— 站点卡片只剩分类 id、筛选条也认不出它。
 */
function loadOverlay() {
  const d = decodeStored(OVERLAY_KEY, localStorage.getItem(OVERLAY_KEY), null)
  if (!Array.isArray(d)) return []
  // localStorage 是用户可改的边界，坏条目直接丢弃，不让整张表跟着崩；
  // groupId 为空的记录永远叠不上去（找不到目标域），留着只会是死条目
  return d.filter(a => a && typeof a === 'object'
    && typeof a.id === 'string' && a.id
    && typeof a.label === 'string' && a.label
    && typeof a.groupId === 'string' && a.groupId
    && typeof a.dotColor === 'string')
}

export const useCategoriesStore = defineStore('categories', () => {
  const localAdds = ref(loadOverlay())

  // 默认表是模块级常量；这里持有运行时副本，云端下发自定义分类表时整体替换。
  // 全站分类下拉 / 筛选条 / 卡片配色 / 后台管理都读这一处，改分类只需改这里。
  const groups = ref(applyOverlay(cloneGroups(CATEGORY_GROUPS)))
  // 云端下发的分类表基线，用于判断「本地草稿是否已偏离云端」（未发布提示）
  const cloudGroups = ref(null)

  function saveOverlay() {
    safeSetItem(OVERLAY_KEY, encodeStored(localAdds.value))
  }

  /**
   * 把本地新增分类叠到给定表上（就地修改，调用方先确保传进来的是副本）。
   * 基底已有同 id 分类时不叠 —— 那说明它已进云端 / 默认表，以基底为准；
   * 目标域不存在时跳过但保留记录，域回来后下次叠加仍生效。
   */
  function applyOverlay(list) {
    for (const a of localAdds.value) {
      const g = list.find(x => x.id === a.groupId)
      if (!g || g.categories.some(c => c.id === a.id)) continue
      g.categories.push({ id: a.id, label: a.label, dotColor: a.dotColor })
    }
    return list
  }

  const categories = computed(() => groups.value.flatMap(g => g.categories))
  const domains = computed(() => groups.value.map(g => ({ id: g.id, label: g.label })))

  function isDomainScope(value) {
    return groups.value.some(g => g.id === value)
  }

  function domainOfScope(value) {
    if (!value || value === 'all') return 'all'
    for (const g of groups.value) {
      if (g.id === value) return g.id
      if (g.categories.some(c => c.id === value)) return g.id
    }
    return 'all'
  }

  function categoriesOfDomain(domainId) {
    if (!domainId || domainId === 'all') return categories.value
    const g = groups.value.find(g => g.id === domainId)
    return g ? g.categories : []
  }

  function getCategoryLabel(id) {
    if (isDomainScope(id)) return groups.value.find(g => g.id === id)?.label || id
    for (const g of groups.value) {
      const cat = g.categories.find(c => c.id === id)
      if (cat) return cat.label
    }
    return id
  }

  function getCategoryColor(id) {
    if (isDomainScope(id)) return '#64748b'
    for (const g of groups.value) {
      const cat = g.categories.find(c => c.id === id)
      if (cat) return cat.dotColor
    }
    return '#64748b'
  }

  function getGroupByCategory(catId) {
    return groups.value.find(g => g.categories.some(c => c.id === catId))
  }

  /**
   * 用云端分类表替换运行时表。结构非法（sanitizeGroups 返回 null）时保持原表不动并返回 false——
   * 半张表比上一版表更危险，宁可整体回退。
   */
  function applyCloudGroups(input) {
    if (input === undefined || input === null) return false
    const next = sanitizeGroups(input)
    if (!next) return false
    // 先存云端基线、再叠覆盖层：顺序反了，dirty 会把「本地新增」误判成云端自带
    cloudGroups.value = cloneGroups(next)
    groups.value = applyOverlay(next)
    return true
  }

  /** 导出为可发布的云端结构（深拷贝，避免发布过程中被本地编辑串改） */
  function toCloudGroups() {
    return cloneGroups(groups.value)
  }

  function resetToDefault() {
    groups.value = cloneGroups(CATEGORY_GROUPS)
    // 恢复默认表要把本地新增一并清掉，否则覆盖层下一帧就把它们叠回来了
    localAdds.value = []
    saveOverlay()
  }

  /**
   * 发布 / 回滚后清理本地新增覆盖层：只清「已出现在当前分类表里」的记录 ——
   * 被云端表跳过（域或同名已被他端删除）的记录还没进云端，清了就真丢了。
   */
  function clearLocalAdds() {
    const present = new Set(categories.value.map(c => c.id))
    localAdds.value = localAdds.value.filter(a => !present.has(a.id))
    saveOverlay()
  }

  // ── 分类体系编辑（本地草稿，发布后才同步到其他设备） ──

  const ID_RE = /^[a-z0-9][a-z0-9_-]*$/

  function bump() {
    groups.value = [...groups.value]
  }

  function findGroupOf(catId) {
    return groups.value.find(g => g.categories.some(c => c.id === catId)) || null
  }

  function addCategory(groupId, { id, label, dotColor } = {}) {
    const cid = String(id || '').trim()
    const clabel = String(label || '').trim()
    if (!cid || !clabel) return { ok: false, error: '分类 id 与名称都不能为空' }
    if (!ID_RE.test(cid)) return { ok: false, error: 'id 只能用小写字母 / 数字 / - _，且以字母或数字开头' }
    if (categories.value.some(c => c.id === cid)) return { ok: false, error: `分类 id「${cid}」已存在` }
    if (domains.value.some(d => d.id === cid)) return { ok: false, error: `id 与域「${cid}」重名，会造成筛选歧义` }
    const g = groups.value.find(x => x.id === groupId)
    if (!g) return { ok: false, error: '目标域不存在' }
    const dot = String(dotColor || '').trim() || '#64748b'
    g.categories.push({ id: cid, label: clabel, dotColor: dot })
    // 新增即入覆盖层落盘：自动建出的分类必须活过刷新与云端表下发
    localAdds.value.push({ groupId, id: cid, label: clabel, dotColor: dot })
    saveOverlay()
    bump()
    return { ok: true, id: cid }
  }

  function updateCategory(catId, patch = {}) {
    const g = findGroupOf(catId)
    if (!g) return { ok: false, error: '分类不存在' }
    const c = g.categories.find(x => x.id === catId)
    if (patch.label !== undefined) {
      const label = String(patch.label).trim()
      if (!label) return { ok: false, error: '分类名称不能为空' }
      c.label = label
    }
    if (patch.dotColor !== undefined) {
      const color = String(patch.dotColor).trim()
      if (color) c.dotColor = color
    }
    // 本地新增分类的改名 / 换色同步进覆盖层，否则刷新会被旧记录盖回去
    const added = localAdds.value.find(a => a.id === catId)
    if (added) {
      added.label = c.label
      added.dotColor = c.dotColor
      saveOverlay()
    }
    bump()
    return { ok: true }
  }

  /** 删除分类：不检查引用 —— 是否还有站点占用由调用方（后台）判定并给出更明确的提示 */
  function removeCategory(catId) {
    const g = findGroupOf(catId)
    if (!g) return { ok: false, error: '分类不存在' }
    if (g.categories.length <= 1) return { ok: false, error: `域「${g.label}」至少要保留一个分类` }
    g.categories.splice(g.categories.findIndex(x => x.id === catId), 1)
    // 本地新增被删（含撤销自动添加时回收空分类）要同步出覆盖层，否则刷新又叠回来
    const ai = localAdds.value.findIndex(a => a.id === catId)
    if (ai !== -1) {
      localAdds.value.splice(ai, 1)
      saveOverlay()
    }
    bump()
    return { ok: true }
  }

  /** 域内上下移动；delta 为 -1 / +1 */
  function moveCategory(catId, delta) {
    const g = findGroupOf(catId)
    if (!g) return { ok: false, error: '分类不存在' }
    const i = g.categories.findIndex(x => x.id === catId)
    const j = i + delta
    if (j < 0 || j >= g.categories.length) return { ok: false, error: '已到边界' }
    const [c] = g.categories.splice(i, 1)
    g.categories.splice(j, 0, c)
    bump()
    return { ok: true }
  }

  function updateGroupLabel(groupId, label) {
    const g = groups.value.find(x => x.id === groupId)
    if (!g) return { ok: false, error: '域不存在' }
    const next = String(label).trim()
    if (!next) return { ok: false, error: '域名称不能为空' }
    g.label = next
    bump()
    return { ok: true }
  }

  /** 本地草稿是否已偏离云端（含从未下发过云端表时与内置默认表对比） */
  const dirty = computed(() => {
    const base = cloudGroups.value || cloneGroups(CATEGORY_GROUPS)
    return JSON.stringify(groups.value) !== JSON.stringify(base)
  })

  return {
    groups, cloudGroups, categories, domains, dirty,
    isDomainScope, domainOfScope, categoriesOfDomain,
    getCategoryLabel, getCategoryColor, getGroupByCategory,
    applyCloudGroups, toCloudGroups, resetToDefault, clearLocalAdds,
    addCategory, updateCategory, removeCategory, moveCategory, updateGroupLabel,
  }
})