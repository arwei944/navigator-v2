<template>
  <div class="filter-bar" ref="rootEl" role="group" aria-label="筛选">
    <!-- 第一行：域 -->
    <div class="domain-tabs" role="tablist" aria-label="方向">
      <button
        class="domain-tab" :class="{ active: activeDomain === 'all' }"
        role="tab" :aria-selected="activeDomain === 'all'"
        @click="selectDomain('all')"
      >
        全部
        <span class="tab-count">{{ baseSites.length }}</span>
      </button>
      <button
        v-for="d in categoriesStore.domains" :key="d.id"
        class="domain-tab" :class="{ active: activeDomain === d.id }"
        role="tab" :aria-selected="activeDomain === d.id"
        @click="selectDomain(d.id)"
      >
        {{ d.label }}
        <span class="tab-count">{{ domainCount(d.id) }}</span>
      </button>
    </div>

    <!-- 第二行：常用标签 + 更多。整条强制单行、超宽横向滑动 —— 筛选条总高固定两行。
         已选中的标签由 pickInlineChips 强制留在行内，不会被计数挤出可视区。
         「更多」刻意留在滚动区**之外**：标签一溢出，最先被切掉的恰好是唯一的入口。 -->
    <div class="chip-row-wrap">
      <div class="chip-row">
        <button
          v-for="item in inlineChips" :key="item.id"
          class="chip" :class="{ active: isActive(item) }"
          :aria-pressed="isActive(item)"
          :title="item.hint"
          @click="clickInline(item)"
        >
          <span v-if="item.color" class="chip-dot" :style="{ background: item.color }"></span>
          {{ item.label }}
          <span class="chip-count">{{ item.count }}</span>
        </button>
      </div>

      <button
        type="button"
        class="chip more-btn" :class="{ open: moreOpen }"
        :aria-expanded="moreOpen" aria-haspopup="true"
        title="展开全部分类与用途"
        @click="moreOpen = !moreOpen"
      >
        更多<span class="chev">▾</span>
      </button>
    </div>

    <!-- 「更多」面板：同列内展开，不用浮层 —— .main 是 overflow:hidden，浮层会被裁掉。
         展开时把下方卡片区下压，不覆盖内容、不与卡片抢层。 -->
    <div v-if="moreOpen" class="more-panel" role="group" aria-label="全部分类与用途">
      <div
        v-for="g in panelGroups" :key="g.id"
        class="pop-group" :class="{ 'pop-purpose': g.purpose }"
      >
        <span v-if="g.label" class="chip-group-label">{{ g.label }}</span>
        <div class="pop-chips">
          <button
            v-for="item in g.chips" :key="item.id"
            class="chip"
            :class="{ active: g.purpose ? activePurpose === item.id : current === item.id }"
            :aria-pressed="g.purpose ? activePurpose === item.id : current === item.id"
            :title="item.hint"
            @click="g.purpose ? pickPurpose(item.id) : pickCategory(item)"
          >
            <span v-if="item.color" class="chip-dot" :style="{ background: item.color }"></span>
            {{ item.label }}
            <span class="chip-count">{{ item.count }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { useFavoritesStore } from '@/stores/favorites'
import { useSidebarStore } from '@/stores/sidebar'
import { PURPOSE_TAGS } from '../../shared/purposes.mjs'
import { pickInlineChips, INLINE_MAX } from '@/utils/filterChips'

const route = useRoute()
const router = useRouter()
const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()
const favoritesStore = useFavoritesStore()
const sidebarStore = useSidebarStore()

// 当前筛选值：'all' | 域 id | 子分类 id
const current = computed(() => sitesStore.currentCategory)

// 域是派生量：选了子分类时，它所属的域保持高亮，用户不会「丢失方向感」
const activeDomain = computed(() => categoriesStore.domainOfScope(current.value))

// 计数基准：跟随范围轴（收藏里只数收藏），否则数字会和下方列表对不上
const baseSites = computed(() => {
  if (sidebarStore.activeNav === 'favorites') {
    return sitesStore.sites.filter(s => favoritesStore.isFav(s.id))
  }
  return sitesStore.sites
})

const countByCategory = computed(() => {
  const m = new Map()
  for (const s of baseSites.value) m.set(s.categoryId, (m.get(s.categoryId) || 0) + 1)
  return m
})

function catCount(id) {
  return countByCategory.value.get(id) || 0
}

function domainCount(domainId) {
  return categoriesStore.categoriesOfDomain(domainId)
    .reduce((sum, c) => sum + catCount(c.id), 0)
}

/**
 * 候选标签，按域分组。域内会被这两个地方共用：
 *   · 第二行 —— 取一个扁平列表，按站点数挑常用的；
 *   · 「更多」面板 —— 保留分组和域标签，铺全。
 */
const chipGroups = computed(() => {
  const dom = activeDomain.value

  if (dom !== 'all') {
    const cats = categoriesStore.categoriesOfDomain(dom)
    const meta = categoriesStore.domains.find(d => d.id === dom)
    // 首位「全部」= 退回整个域，是这一层最显眼的重置手势
    return [{
      id: dom,
      label: meta ? meta.label : '',
      chips: [
        { id: dom, label: '全部', count: domainCount(dom), hint: '显示该方向下全部站点' },
        ...cats.map(c => ({ id: c.id, label: c.label, color: c.dotColor, count: catCount(c.id) }))
      ]
    }]
  }

  return categoriesStore.groups.map(g => ({
    id: g.id,
    label: g.label,
    chips: g.categories.map(c => ({ id: c.id, label: c.label, color: c.dotColor, count: catCount(c.id) }))
  }))
})

/* ---------------- 第二行：常用标签 ---------------- */

const moreOpen = ref(false)

const allChips = computed(() => chipGroups.value.flatMap(g => g.chips))

function purposeTagOf(id) {
  const t = PURPOSE_TAGS.find(x => x.id === id)
  return t ? { id: t.id, label: t.label, color: t.color, count: 0 } : null
}

// 已选项永远留在第二行、并排在前面：被计数挤出去就等于「看不见自己选了什么」。
// 用途不在分类候选里，所以要单独补一个（带上 kind 以便点击时走对分支）。
const pinnedChips = computed(() => {
  const list = []
  const cat = allChips.value.find(c => c.id === current.value)
  if (cat) list.push(cat)
  if (activePurpose.value !== 'all') {
    const p = purposeChips.value.find(c => c.id === activePurpose.value)
      || purposeTagOf(activePurpose.value)
    if (p) list.push({ ...p, kind: 'purpose' })
  }
  return list
})

const inlineChips = computed(() => pickInlineChips(allChips.value, pinnedChips.value, INLINE_MAX))

function isActive(item) {
  return item.kind === 'purpose' ? activePurpose.value === item.id : current.value === item.id
}

function clickInline(item) {
  if (item.kind === 'purpose') selectPurpose(item.id)
  else selectCategory(item)
}

/* ---------------- 筛选动作 ---------------- */

function go(value) {
  // 留在当前范围（收藏页就还是收藏），只换筛选值 —— 范围与筛选互不挤占
  const query = { ...route.query }
  if (value === 'all') delete query.c
  else query.c = value
  router.push({ name: route.name, query })
}

function selectDomain(id) {
  go(id)
}

function selectCategory(item) {
  // 再点一次已选中的子分类 = 退回它所属的域，避免「只能前进不能后退」
  const next = current.value === item.id ? activeDomain.value : item.id
  go(next)
}

// 面板里的选择：选完即收起，不必再点一次「更多」
function pickCategory(item) {
  selectCategory(item)
  moreOpen.value = false
}

/* ---------------- 用途（Axis 4） ---------------- */

// 当前用途筛选值：'all' 或用途 id
const activePurpose = computed(() => sitesStore.currentPurpose || 'all')

// 用途计数基准：先按分类轴收窄，数字才与「选中用途后看到的列表」对得上
const categoryScoped = computed(() => {
  const v = current.value
  if (!v || v === 'all') return baseSites.value
  if (categoriesStore.isDomainScope(v)) {
    const ids = new Set(categoriesStore.categoriesOfDomain(v).map(c => c.id))
    return baseSites.value.filter(s => ids.has(s.categoryId))
  }
  return baseSites.value.filter(s => s.categoryId === v)
})

// 只列出现过的用途，避免把 12 个标签全铺出来、每个还挂着 0
const purposeChips = computed(() => {
  const counts = new Map()
  for (const s of categoryScoped.value) {
    for (const id of Array.isArray(s.purposes) ? s.purposes : []) {
      counts.set(id, (counts.get(id) || 0) + 1)
    }
  }
  const chips = []
  if (activePurpose.value !== 'all') {
    chips.push({ id: 'all', label: '全部用途', count: categoryScoped.value.length })
  }
  for (const tag of PURPOSE_TAGS) {
    const count = counts.get(tag.id) || 0
    if (!count) continue
    chips.push({ id: tag.id, label: tag.label, color: tag.color, count })
  }
  return chips
})

// 面板的渲染模型：分类各组 + 用途一组，走同一条渲染路径。
// 两块标记结构完全一样，只有「哪个是选中值、点击落哪个动作」不同 ——
// 拆成两段写等于把同一段模板抄两遍。
const panelGroups = computed(() => {
  const groups = chipGroups.value.map(g => ({ id: g.id, label: g.label, purpose: false, chips: g.chips }))
  if (purposeChips.value.length) {
    groups.push({ id: '__purpose', label: '用途', purpose: true, chips: purposeChips.value })
  }
  return groups
})

function selectPurpose(id) {
  // 再点一次已选中的用途 = 取消该筛选，回到「全部用途」
  const next = id === 'all' || activePurpose.value === id ? 'all' : id
  const query = { ...route.query }
  if (next === 'all') delete query.p
  else query.p = next
  router.push({ name: route.name, query })
}

function pickPurpose(id) {
  selectPurpose(id)
  moreOpen.value = false
}

/* ---------------- 面板收起 ---------------- */

const rootEl = ref(null)

function onDocPointerDown(e) {
  if (moreOpen.value && rootEl.value && !rootEl.value.contains(e.target)) moreOpen.value = false
}

function onKeydown(e) {
  if (e.key === 'Escape' && moreOpen.value) moreOpen.value = false
}

onMounted(() => {
  document.addEventListener('mousedown', onDocPointerDown)
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', onDocPointerDown)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.filter-bar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 28px 12px;
  flex-shrink: 0;
}

/* 一级：域，用分段控件与二级 chips 拉开视觉层级 */
.domain-tabs {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  background: var(--border-light);
  border-radius: 9px;
  align-self: flex-start;
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}
.domain-tabs::-webkit-scrollbar { display: none; }
.domain-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 13px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  white-space: nowrap;
  cursor: pointer;
  transition: all var(--transition);
}
.domain-tab:hover { color: var(--text-primary); }
.domain-tab.active {
  background: var(--bg-white);
  color: var(--text-primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, .08);
}
.tab-count { font-size: 11px; font-weight: 600; color: var(--text-secondary); opacity: .75; }
.domain-tab.active .tab-count { color: var(--accent); opacity: 1; }

/* 二级：常用标签。
   强制单行 + 横向滑动，筛选条总高就是固定的两行；滚动条藏起来，
   不给「这里还能滑」之外的视觉噪声（触控板横滑 / Shift+滚轮都可以）。
   「更多」在滚动区外，所以标签溢出时它也完整可见。 */
.chip-row-wrap { display: flex; align-items: center; gap: 6px; }
.chip-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.chip-row::-webkit-scrollbar { display: none; }

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-white);
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
  font-weight: 500;
  font-family: inherit;
  white-space: nowrap;
  cursor: pointer;
  transition: all var(--transition);
  flex-shrink: 0;
}
.chip:hover { border-color: var(--accent); color: var(--accent); }
.chip.active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
}
.chip-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.chip-count { font-size: 10px; font-weight: 600; opacity: .6; }
.chip.active .chip-count { opacity: .9; }

/* 「更多」是入口不是筛选项：虚线边框 + 箭头，与可筛选的 chip 区分开 */
.more-btn { gap: 4px; border-style: dashed; }
.more-btn.open {
  border-style: solid;
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-light);
}
.chev { font-size: 9px; line-height: 1; transition: transform var(--transition); }
.more-btn.open .chev { transform: rotate(180deg); }

/* 「更多」面板：同列内展开（浮层会被 .main 的 overflow:hidden 裁掉） */
.more-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  max-height: 46vh;
  overflow-y: auto;
}
.pop-group { display: flex; align-items: flex-start; gap: 10px; }
.pop-chips { display: flex; flex-wrap: wrap; gap: 6px; flex: 1; min-width: 0; }
/* 用途与分类是两把正交的筛子，同面板内也要分得清 */
.pop-purpose { border-top: 1px dashed var(--border-light); padding-top: 10px; }

.chip-group-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  opacity: .65;
  white-space: nowrap;
  flex-shrink: 0;
  /* 各组的标签对齐成一列，扫起来不用逐个重新定位 */
  min-width: 60px;
  padding-top: 4px;
}

@media (max-width: 768px) {
  .filter-bar { padding: 0 16px 10px; gap: 7px; }
  .domain-tab { padding: 6px 11px; font-size: 12px; }
  .pop-group { flex-direction: column; gap: 6px; }
  .chip-group-label { min-width: 0; padding-top: 0; }
}
</style>
