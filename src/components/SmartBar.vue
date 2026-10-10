<template>
  <section v-if="items.length" class="smart-bar" :class="{ cold }">
    <div class="smart-head">
      <svg class="smart-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><line x1="19" y1="17" x2="19" y2="21"/><line x1="17" y1="19" x2="21" y2="19"/></svg>
      <span class="smart-title">{{ cold ? '大家在用的' : '此刻推荐' }}</span>
      <span v-if="!cold" class="smart-sub">{{ slotLabel }}</span>
      <div class="smart-actions">
        <button class="smart-btn" title="换一批" @click="rotate">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </button>
        <button class="smart-btn" title="不再显示" @click="preferences.setSmartBar(false)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
    <div class="smart-list">
      <button v-for="it in items" :key="it.site.id" class="smart-card" @click="open(it.site)">
        <span class="smart-favicon" :style="{ background: it.site.color }">
          <img v-if="iconOf(it.site)" :src="iconOf(it.site)" :alt="it.site.name" loading="lazy" @error="$event.target.remove()">
          <span v-else class="smart-fallback">{{ (it.site.initial || it.site.name || '?').toString().charAt(0) }}</span>
        </span>
        <span class="smart-name">{{ it.site.name }}</span>
        <span class="smart-reason">{{ it.reason }}</span>
      </button>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useSitesStore } from '@/stores/sites'
import { useHistoryStore } from '@/stores/history'
import { useClicksStore } from '@/stores/clicks'
import { useCategoriesStore } from '@/stores/categories'
import { usePreferencesStore } from '@/stores/preferences'
import { openInNewTab } from '@/utils/open'
import { buildSignals, hasSignal, rankSites, SLOT_LABELS, slotOf } from '@/utils/smartRank'

const SHOWN = 8

const sitesStore = useSitesStore()
const historyStore = useHistoryStore()
const clicksStore = useClicksStore()
const categoriesStore = useCategoriesStore()
const preferences = usePreferencesStore()

const offset = ref(0)

const signals = computed(() => buildSignals(historyStore.records, sitesStore.sites))
/** 没有访问记录就无从个性化 —— 这时降级成全局热门，而不是给一排莫名其妙的站 */
const cold = computed(() => !hasSignal(signals.value))

const categoryLabels = computed(() => {
  const out = {}
  for (const c of categoriesStore.categories) out[c.id] = c.label
  return out
})

const ranked = computed(() => {
  if (cold.value) {
    return sitesStore.sites
      .map(s => ({ site: s, score: Number(clicksStore.countFor(s.id)) || 0, reason: '大家都在用' }))
      .sort((a, b) => b.score - a.score)
      .slice(0, SHOWN * 3)
  }
  const anchorId = historyStore.records[0]?.siteId
  const anchorName = anchorId ? (sitesStore.sites.find(s => s.id === anchorId)?.name || '') : ''
  return rankSites(sitesStore.sites, signals.value, {
    clicks: clicksStore.mergedCounts || {},
    recentId: anchorId,
    anchorName,
    categoryLabels: categoryLabels.value
  }).slice(0, SHOWN * 3)
})

const items = computed(() => {
  const list = ranked.value
  if (!list.length) return []
  const start = offset.value % Math.max(1, list.length)
  // 环形取 SHOWN 条：换一批是「看下一批」，不是「重新随机」
  return Array.from({ length: Math.min(SHOWN, list.length) }, (_, i) => list[(start + i) % list.length])
})

const slotLabel = computed(() => `${SLOT_LABELS[slotOf()] || '此刻'}好`)

function iconOf(site) {
  return site.icon ? '/' + site.icon : (site.iconUrl || '')
}

/** 打开站点：与卡片点击完全同一条口径 */
function open(site) {
  openInNewTab('https://' + site.url)
  sitesStore.recordVisit(site.id)
  historyStore.addRecord(site.id)
}

function rotate() {
  offset.value += SHOWN
}
</script>

<style scoped>
.smart-bar { margin: 10px 28px 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-white); box-shadow: var(--shadow-card); }
.smart-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.smart-icon { width: 15px; height: 15px; color: var(--color-note); }
.smart-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.smart-sub { font-size: 11px; color: var(--text-secondary); }
.smart-actions { display: flex; gap: 2px; margin-left: auto; }
.smart-btn { width: 24px; height: 24px; border: none; border-radius: 6px; background: transparent; color: var(--text-secondary); display: flex; align-items: center; justify-content: center; cursor: pointer; opacity: .7; }
.smart-btn:hover { background: var(--border-light); opacity: 1; color: var(--accent); }
.smart-btn svg { width: 13px; height: 13px; }
.smart-list { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: thin; }
.smart-card { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 132px; flex-shrink: 0; padding: 8px; border: 1px solid var(--border-light); border-radius: 10px; background: var(--bg); cursor: pointer; text-align: left; transition: all .15s ease; font-family: var(--font); }
.smart-card:hover { border-color: var(--accent); transform: translateY(-1px); }
.smart-favicon { width: 24px; height: 24px; border-radius: 7px; display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0; position: relative; color: var(--color-on-solid); font-weight: 700; font-size: 12px; }
.smart-favicon img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: var(--bg-white); }
.smart-name { font-size: 12px; font-weight: 600; color: var(--text-primary); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.smart-reason { font-size: 10px; color: var(--text-secondary); line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.cold .smart-icon { color: var(--color-heat-warm); }
@media (max-width: 768px) {
  .smart-bar { margin: 8px 16px 0; }
}
</style>
