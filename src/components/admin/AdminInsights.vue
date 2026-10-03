<template>
  <div class="admin-section">
    <div class="admin-section-header">
      <h2>数据洞察</h2>
      <div class="insight-notes">
        <span class="insight-note" v-if="clicksStore.loaded">
          全网累计点击 {{ clicksStore.total.toLocaleString('zh-CN') }} 次 · {{ clicksStore.sites }} 个站点有点击
        </span>
        <span class="insight-note muted" v-if="healthStore.updatedAt">
          失效站点 {{ deadSites.length }} 个 · 判定于 {{ judgedAt }}
        </span>
      </div>
    </div>
    <div class="insight-grid">
      <div class="insight-card">
        <h3 class="insight-title">分类分布</h3>
        <div class="cat-bars">
          <div v-for="c in categoryDistribution" :key="c.id" class="cat-bar-row">
            <span class="cat-bar-label" :style="{ color: c.color }">{{ c.label }}</span>
            <div class="cat-bar-track">
              <div class="cat-bar-fill" :style="{ width: (c.count / maxCatCount * 100) + '%', background: c.color }"></div>
            </div>
            <span class="cat-bar-count">{{ c.count }}</span>
          </div>
        </div>
      </div>
      <div class="insight-card">
        <h3 class="insight-title">点击量 TOP 10</h3>
        <ol v-if="topSites.length" class="top-list">
          <li v-for="(s, i) in topSites" :key="s.id">
            <span class="top-rank" :class="{ hot: i < 3 }">{{ i + 1 }}</span>
            <div class="top-meta">
              <span class="top-name">{{ s.name }}</span>
              <span class="top-url">{{ s.url }}</span>
            </div>
            <span class="top-count">{{ clicksStore.countFor(s.id) }}</span>
          </li>
        </ol>
        <div v-else class="top-empty">
          暂无点击数据。访客点击站点后，这里会按<strong>全网累计点击量</strong>排行。
        </div>
      </div>
    </div>
    <div class="insight-card dead-card">
      <h3 class="insight-title">失效站点清单
        <span class="dead-note">（判定来自本机代理环境探活，非浏览器直连；删除前仍建议人工复核 WAF / 限流误判）</span>
      </h3>
      <div v-if="!healthStore.updatedAt" class="dead-empty warn">
        暂无云端判定。请在本机运维控制台「可用性」面板执行探活（或运行
        <code>nav sites check --publish</code>），判定发布到云端后这里才有数据。
      </div>
      <div v-else-if="deadSites.length === 0" class="dead-empty">
        ✓ 未发现失效站点（判定于 {{ judgedAt }} · 代理 {{ healthStore.proxy || '未记录' }}）
      </div>
      <div v-else class="dead-list">
        <div v-for="s in deadSites" :key="s.id" class="dead-item">
          <span class="dead-name">{{ s.name }}</span>
          <span class="dead-url">{{ s.url }}</span>
          <span class="dead-code" :class="{ warn: s.statusCode === 'ERR' }">HTTP {{ s.statusCode || 'ERR' }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { useHealthStore } from '@/stores/health'
import { useClicksStore } from '@/stores/clicks'
import { rankByClicks } from '../../../shared/clicks-core.mjs'

const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()
const healthStore = useHealthStore()
const clicksStore = useClicksStore()

// 进入后台即拉取云端判定与点击统计（都只读云端结果，不在浏览器里重新探测 / 计数）
onMounted(() => {
  healthStore.refresh()
  clicksStore.refresh()
})

/** 判定产出时间（本机探活那一刻，非页面打开时间） */
const judgedAt = computed(() => {
  const ts = healthStore.updatedAt
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
})

/** 分类分布（按站点数降序） */
const categoryDistribution = computed(() => {
  return categoriesStore.categories
    .map(cat => ({
      id: cat.id,
      label: cat.label,
      color: cat.dotColor,
      count: sitesStore.sites.filter(s => s.categoryId === cat.id).length,
    }))
    .filter(x => x.count > 0)
    .sort((a, b) => b.count - a.count)
})
const maxCatCount = computed(() => Math.max(1, ...categoryDistribution.value.map(c => c.count)))

/**
 * 点击量 TOP10：只列**真的有点击**的站点（云端全局口径，含本机待发增量）。
 * 无点击时返回空数组 → 模板显示空态，不用 0 次点击的站点填满「TOP 10」。
 */
const topSites = computed(() =>
  rankByClicks(sitesStore.sites, clicksStore.mergedCounts)
    .filter(s => clicksStore.countFor(s.id) > 0)
    .slice(0, 10),
)

/** 失效站点清单（health 判定 down） */
const deadSites = computed(() =>
  sitesStore.sites
    .map(s => {
      const h = healthStore.getStatus(s.id)
      return h.status === 'down' ? { ...s, statusCode: h.code } : null
    })
    .filter(Boolean),
)
</script>

<style scoped>
.admin-section { padding: 0 32px 32px; }
.admin-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.admin-section-header h2 { font-size: 16px; font-weight: 600; }
.insight-note { font-size: 12px; color: var(--accent); font-weight: 600; }
.insight-notes { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.insight-note.muted { color: var(--text-secondary); font-weight: 500; }
.insight-grid { display: grid; grid-template-columns: 1.3fr 1fr; gap: 16px; margin-bottom: 16px; }
.insight-card { background: var(--bg-white); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 20px; }
.insight-title { font-size: 14px; font-weight: 600; margin-bottom: 14px; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.cat-bar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.cat-bar-label { width: 120px; flex-shrink: 0; font-size: 12px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cat-bar-track { flex: 1; height: 10px; background: var(--border-light); border-radius: 5px; overflow: hidden; }
.cat-bar-fill { height: 100%; border-radius: 5px; transition: width .3s ease; }
.cat-bar-count { width: 28px; text-align: right; font-size: 12px; font-weight: 600; color: var(--text-secondary); flex-shrink: 0; }
.top-list { list-style: none; margin: 0; padding: 0; }
.top-list li { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--border-light); }
.top-list li:last-child { border-bottom: none; }
.top-rank { width: 20px; height: 20px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border-radius: 5px; background: var(--border-light); color: var(--text-secondary); font-size: 11px; font-weight: 700; }
.top-rank.hot { background: #fef3c7; color: #b45309; }
.top-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.top-name { font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.top-url { font-size: 11px; color: var(--text-secondary); font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.top-count { font-size: 12px; font-weight: 700; color: var(--accent); flex-shrink: 0; }
.top-empty { font-size: 13px; color: var(--text-secondary); padding: 6px 0; line-height: 1.6; }
.top-empty strong { color: var(--text-primary); font-weight: 600; }
.dead-note { font-size: 11px; font-weight: 400; color: var(--text-secondary); }
.dead-empty { font-size: 13px; color: #059669; padding: 6px 0; }
.dead-list { display: flex; flex-direction: column; max-height: 280px; overflow-y: auto; }
.dead-item { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--border-light); font-size: 13px; }
.dead-item:last-child { border-bottom: none; }
.dead-name { font-weight: 600; color: var(--text-primary); min-width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dead-url { flex: 1; color: var(--text-secondary); font-family: monospace; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dead-code { flex-shrink: 0; font-size: 11px; font-weight: 700; color: #dc2626; background: #fef2f2; padding: 2px 8px; border-radius: 10px; }
.dead-code.warn { color: #b45309; background: #fffbeb; }
@media (max-width: 900px) {
  .insight-grid { grid-template-columns: 1fr; }
}
</style>