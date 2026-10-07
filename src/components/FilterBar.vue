<template>
  <div class="filter-bar" role="group" aria-label="筛选">
    <!-- 一级：域 -->
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

    <!-- 二级：当前域下的子分类，按域分组多行铺开 -->
    <div class="chip-row">
      <div v-for="group in chipGroups" :key="group.id" class="chip-group">
        <span v-if="group.label" class="chip-group-label">{{ group.label }}</span>
        <button
          v-for="item in group.chips" :key="item.id"
          class="chip" :class="{ active: current === item.id }"
          :aria-pressed="current === item.id"
          :title="item.hint"
          @click="selectCategory(item)"
        >
          <span v-if="item.color" class="chip-dot" :style="{ background: item.color }"></span>
          {{ item.label }}
          <span class="chip-count">{{ item.count }}</span>
        </button>
      </div>
    </div>

    <!-- 三级：用途，与分类正交，可跨分类聚合（如「所有查资料站」） -->
    <div v-if="purposeChips.length" class="chip-row purpose-row">
      <span class="chip-group-label">用途</span>
      <button
        v-for="item in purposeChips" :key="item.id"
        class="chip purpose-chip" :class="{ active: activePurpose === item.id }"
        :aria-pressed="activePurpose === item.id"
        @click="selectPurpose(item.id)"
      >
        <span v-if="item.color" class="chip-dot" :style="{ background: item.color }"></span>
        {{ item.label }}
        <span class="chip-count">{{ item.count }}</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { useFavoritesStore } from '@/stores/favorites'
import { useSidebarStore } from '@/stores/sidebar'
import { PURPOSE_TAGS } from '../../shared/purposes.mjs'

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

const chipGroups = computed(() => {
  const dom = activeDomain.value

  if (dom !== 'all') {
    const cats = categoriesStore.categoriesOfDomain(dom)
    // 首位「全部」= 退回整个域，是这一层最显眼的重置手势
    return [{
      id: dom,
      label: '',
      chips: [
        { id: dom, label: '全部', count: domainCount(dom), hint: '显示该方向下全部站点' },
        ...cats.map(c => ({ id: c.id, label: c.label, color: c.dotColor, count: catCount(c.id) }))
      ]
    }]
  }

  // 未选方向：按域分组铺开，每组自带换行，标签不会被甩到行尾
  return categoriesStore.groups.map(g => ({
    id: g.id,
    label: g.label,
    chips: g.categories.map(c => ({ id: c.id, label: c.label, color: c.dotColor, count: catCount(c.id) }))
  }))
})

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

function selectPurpose(id) {
  // 再点一次已选中的用途 = 取消该筛选，回到「全部用途」
  const next = id === 'all' || activePurpose.value === id ? 'all' : id
  const query = { ...route.query }
  if (next === 'all') delete query.p
  else query.p = next
  router.push({ name: route.name, query })
}
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

/* 二级：子分类，按域分组多行铺开，一屏看全，无横向滚动条 */
.chip-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px 14px;
}
.chip-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

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
  color: #fff;
}
.chip-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.chip-count { font-size: 10px; font-weight: 600; opacity: .6; }
.chip.active .chip-count { opacity: .9; }

.chip-group-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  opacity: .65;
  white-space: nowrap;
  flex-shrink: 0;
}

/* 用途行与分类行用一条浅分隔线区隔：两把筛子正交，视觉上也要分得清 */
.purpose-row { border-top: 1px dashed var(--border-light); padding-top: 8px; }

@media (max-width: 768px) {
  .filter-bar { padding: 0 16px 10px; gap: 7px; }
  .domain-tab { padding: 6px 11px; font-size: 12px; }
}
</style>
