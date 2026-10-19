<template>
  <div class="related">
    <ul v-if="items.length" class="rel-list" role="list">
      <li v-for="r in items" :key="r.id">
        <button type="button" class="rel-item" @click="go(r.id)"
                :title="`切到 ${r.name}`">
          <span class="rel-dot" :style="{ background: r.color }" aria-hidden="true"></span>
          <span class="rel-body">
            <span class="rel-top">
              <span class="rel-name">{{ r.name }}</span>
              <span class="rel-score" :title="`关联度 ${r.score}`">{{ r.score }}</span>
            </span>
            <span class="rel-why">{{ r.reasons.join(' · ') }}</span>
          </span>
        </button>
      </li>
    </ul>
    <p v-else class="rel-empty">还没有足够接近的站点。</p>
    <p v-if="items.length" class="rel-hint">点一个站直接切过去，可以顺着关系一路走下去。</p>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { useSidebarStore } from '@/stores/sidebar'
import { PURPOSE_TAGS } from '../../../shared/purposes.mjs'
import { relatedTo } from '../../../shared/affinity.mjs'

/**
 * 站点详情里的「相关站点」。
 *
 * 与图谱页共用同一个关联度引擎（shared/affinity.mjs），但**不用** buildAffinityGraph：
 * 那个函数会把 300 站两两比一遍（≈4.5 万对）来织整张网；这里只关心「与我相关的有谁」，
 * 所以自己建一次特征包（O(n)），再对每个站点单独算一次分（O(n) 次常数级比较）。
 *
 * 这个组件刻意独立成文件并被异步引入 —— 它带着 affinity 引擎，而面板本身在首屏。
 * 静态引入会把引擎拖进首屏预算（GraphView 那边就是靠同样的边界省下的）。
 */

const props = defineProps({
  site: { type: Object, default: null },
})

const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()
const sidebarStore = useSidebarStore()

/** 与图谱页默认阈值保持一致：两处口径不同会让用户困惑「为什么图上连了、这里没连」 */
const TOP_N = 5

const colorOf = computed(() =>
  Object.fromEntries(categoriesStore.categories.map(c => [c.id, c.dotColor || 'var(--color-muted)'])))
const categoryLabels = computed(() =>
  Object.fromEntries(categoriesStore.categories.map(c => [c.id, c.label])))
const purposeLabels = computed(() =>
  Object.fromEntries(PURPOSE_TAGS.map(t => [t.id, t.label])))

const items = computed(() => relatedTo(props.site, sitesStore.sites || [], {
  topN: TOP_N,
  categoryLabels: categoryLabels.value,
  purposeLabels: purposeLabels.value,
}).map(r => ({
  id: r.id,
  name: r.site.name || r.site.url,
  score: r.score,
  reasons: r.reasons,
  color: colorOf.value[r.site.categoryId] || 'var(--color-muted)',
})))

function go(id) {
  const target = sitesStore.sites.find(s => s.id === id)
  // 走 selectSite 而不是直接写 rightSite：面板有 hover/click/pin 三种模式，
  // 该不该响应由 store 统一裁决（见 sidebar.js 的 applyRight）
  if (target) sidebarStore.selectSite(target)
}
</script>

<style scoped>
.related { display: flex; flex-direction: column; gap: 6px; }
.rel-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }

.rel-item {
  width: 100%; display: flex; align-items: flex-start; gap: 8px;
  padding: 6px 8px; text-align: left; cursor: pointer;
  border: 1px solid var(--border); border-radius: 8px; background: var(--bg-white);
  transition: border-color var(--dur-fast) ease, background var(--dur-fast) ease;
}
.rel-item:hover { border-color: var(--accent); background: var(--border-light); }
.rel-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; margin-top: 4px; }
.rel-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.rel-top { display: flex; align-items: baseline; gap: 6px; }
.rel-name {
  flex: 1; min-width: 0; font-size: 12px; color: var(--text-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.rel-score { font-size: 10px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.rel-why { font-size: 10px; line-height: 1.5; color: var(--text-secondary); opacity: .85; }

.rel-empty { margin: 0; font-size: 11px; color: var(--text-secondary); opacity: .7; }
.rel-hint { margin: 2px 0 0; font-size: 10px; color: var(--text-secondary); opacity: .6; }
</style>
