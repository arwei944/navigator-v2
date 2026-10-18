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
    <!-- 可用性与响应时间趋势（#11 / #12）：数据来自服务端巡检逐轮追加的历史点 -->
    <div class="insight-card trend-card">
      <h3 class="insight-title">
        可用性与响应时间趋势
        <span class="dead-note">（服务端每跑完一轮巡检追加一个采样点）</span>
      </h3>
      <div v-if="!histLoaded" class="trend-empty">加载中…</div>
      <div v-else-if="histPoints.length < 2" class="trend-empty warn">
        还没有足够的历史点（当前 {{ histPoints.length }} 个）。这条曲线要靠时间积累 ——
        服务端巡检每跑完一轮才会追加一个点，不会凭空造数据。
      </div>
      <template v-else>
        <div class="trend-row">
          <div class="trend-metric">
            <span class="trend-label">不可用比例</span>
            <span class="trend-value">{{ downPctText }}</span>
          </div>
          <div class="trend-spark" v-html="downSpark"></div>
        </div>
        <div class="trend-row">
          <div class="trend-metric">
            <span class="trend-label">平均响应</span>
            <span class="trend-value">{{ avgMsText }}</span>
          </div>
          <div class="trend-spark" v-html="msSpark"></div>
        </div>
        <div class="trend-foot">{{ histPoints.length }} 个采样点 · {{ trendRange }}</div>
      </template>
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
          <span v-if="s.fails" class="dead-fails">连续 {{ s.fails }} 次</span>
          <span class="dead-code" :class="{ warn: s.statusCode === 'ERR' }">HTTP {{ s.statusCode || 'ERR' }}</span>
        </div>
      </div>
      <div v-if="deadSites.length" class="dead-actions">
        <button type="button" class="quality-fix" @click="archiveDead">归档全部失效站点（{{ deadSites.length }}）</button>
        <span class="quality-hint">进回收站，可随时恢复；判据来自本机探活，归档前建议复核 WAF / 限流误判</span>
      </div>
    </div>
    <!-- 数据质量体检（F1）：判据与 `scripts/audit-data.mjs` 同源（shared/ops/data-quality.mjs） -->
    <div class="insight-card quality-card">
      <h3 class="insight-title">数据质量体检
        <span class="dead-note">（判据与 <code>nav data audit</code> 同源；「同站多入口」需人工甄别，不自动合并）</span>
      </h3>
      <p class="quality-summary" :class="{ ok: quality.clean }">{{ qualitySummary }}</p>

      <div v-if="quality.duplicateUrls.length" class="quality-block">
        <div class="quality-block-title danger">完全重复 · {{ quality.duplicateUrls.length }} 组（同一页被收录多次）</div>
        <div v-for="g in quality.duplicateUrls" :key="g.url" class="quality-row">
          <span class="quality-host">{{ g.url }}</span>
          <span class="quality-names">{{ g.names.join(' / ') }}</span>
          <button type="button" class="quality-fix" @click="mergeDuplicate(g)">合并（归档其余）</button>
        </div>
      </div>

      <div v-if="quality.sameHostGroups.length" class="quality-block">
        <div class="quality-block-title warn">同站多入口 · {{ quality.sameHostGroups.length }} 组（不同页面，需人工确认是否合并）</div>
        <div v-for="g in quality.sameHostGroups" :key="g.host" class="quality-row merge-row">
          <span class="quality-host">{{ g.host }}</span>
          <span class="quality-names">{{ g.names.join(' / ') }}</span>
          <select v-model="mergeKeep[g.host]" class="merge-pick" :aria-label="`保留 ${g.host} 的哪一条`">
            <option value="">保留…</option>
            <option v-for="(id, i) in g.ids" :key="id" :value="id">{{ g.names[i] }}</option>
          </select>
          <button
            type="button"
            class="quality-fix"
            :disabled="!mergeKeep[g.host]"
            @click="mergeHostGroup(g)"
          >合并其余</button>
        </div>
      </div>

      <div v-if="quality.weakDesc.length" class="quality-block">
        <div class="quality-block-title">描述待改进 · {{ quality.weakDesc.length }} 条</div>
        <div v-for="d in quality.weakDesc.slice(0, 10)" :key="d.id" class="quality-row">
          <span class="quality-host">{{ d.name || d.id }}</span>
          <span class="quality-names">{{ descLabel(d.issue) }}</span>
        </div>
        <div v-if="quality.weakDesc.length > 10" class="quality-hint">…另有 {{ quality.weakDesc.length - 10 }} 条</div>
      </div>

      <div v-if="quality.missingIcon.length" class="quality-block">
        <div class="quality-block-title">缺 icon · {{ quality.missingIcon.length }} 条
          <span class="quality-hint">（前端退化为字母块，功能不受影响）</span>
        </div>
      </div>

      <div v-if="quality.clean && !quality.sameHostGroups.length" class="quality-empty">未发现数据质量问题。</div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { useHealthStore } from '@/stores/health'
import { useClicksStore } from '@/stores/clicks'
import { rankByClicks } from '../../../shared/clicks-core.mjs'
import { sparkline } from '@/utils/chartkit'
import { fmtDateTimeCompact } from '@/utils/format'
import { auditSites, DESC_ISSUE_LABEL, summarizeAudit, planGroupMerge } from '../../../shared/ops/data-quality.mjs'
import { fetchHealthHistory } from '@/services/healthApi'

const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()
const healthStore = useHealthStore()
const clicksStore = useClicksStore()

// 进入后台即拉取云端判定与点击统计（都只读云端结果，不在浏览器里重新探测 / 计数）
onMounted(() => {
  healthStore.refresh()
  clicksStore.refresh()
  loadHistory()
})

/** 判定产出时间（本机探活那一刻，非页面打开时间） */
const judgedAt = computed(() => fmtDateTimeCompact(healthStore.updatedAt))

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
      return h.status === 'down' ? { ...s, statusCode: h.code, fails: Number(h.fails) || 0 } : null
    })
    .filter(Boolean),
)

/* ---------------- 数据质量体检（F1） ---------------- */

/**
 * 判据与 scripts/audit-data.mjs **同源**（shared/ops/data-quality.mjs）——
 * 面板与 CLI 不会各说各话。这里只消费内核结果，不重复实现判据。
 */
const quality = computed(() => auditSites(sitesStore.sites))
const qualitySummary = computed(() => summarizeAudit(quality.value))
const descLabel = (issue) => DESC_ISSUE_LABEL[issue] || issue

/** 合并真重复：保留每组首条，其余**归档**进回收站（可恢复，比直接删除安全） */
function mergeDuplicate(g) {
  const removeIds = (g.ids || []).filter(id => id !== g.keep)
  if (!removeIds.length) return
  const names = (g.names || []).join(' / ')
  if (!window.confirm(`合并「${names}」：保留 ${g.keep}，归档其余 ${removeIds.length} 条？\n\n归档进回收站，可随时恢复。`)) return
  sitesStore.batchArchive(removeIds)
}

/**
 * 同站多入口的人工合并：保留用户选中的那条，其余归档。
 *
 * 与 `mergeDuplicate` 的区别是**保留项由人指定** —— 同 host 的不同页面往往是不同产品
 * （github.com/trending 与 github.com/copilot），默认保留首条会删错。
 */
const mergeKeep = ref({})
function mergeHostGroup(g) {
  const keepId = mergeKeep.value[g.host]
  const { removeIds } = planGroupMerge(g, keepId)
  if (!removeIds.length) return
  const keepName = g.names[(g.ids || []).indexOf(keepId)] || keepId
  if (!window.confirm(`合并 ${g.host}：保留「${keepName}」，归档其余 ${removeIds.length} 条？\n\n归档进回收站，可随时恢复。`)) return
  sitesStore.batchArchive(removeIds)
  delete mergeKeep.value[g.host]
}

/**
 * F6：把当前判定的失效站点**一键归档**（进回收站，可恢复）。
 * 服务端巡检（cron 的「连续失效自动归档」）按 alert-rules 阈值已会自动做这件事，
 * 这里是**人工干预面**：看着这批不合意就立刻处理，不必等下一轮巡检。
 */
function archiveDead() {
  const ids = deadSites.value.map(s => s.id)
  if (ids.length) sitesStore.batchArchive(ids)
}

/* ---------------- 可用性 / 响应时间趋势 ---------------- */

const histPoints = ref([])
const histLoaded = ref(false)

/**
 * 历史点来自服务端 `/api/health-history`（公开只读，只有聚合计数与耗时）。
 * 拿不到就当作「还没有历史」，不报错、不造数据 —— 这是要靠时间积累的东西。
 */
async function loadHistory() {
  histPoints.value = await fetchHealthHistory()
  histLoaded.value = true
}

const lastPoint = computed(() => histPoints.value[histPoints.value.length - 1] || null)

/** 画「不可用比例」而不是「可用率」：可用率常年在 98%~100% 之间，画出来是一条贴顶的直线，看不出波动 */
const downSpark = computed(() => sparkline(
  histPoints.value.map(p => (p.total ? p.down / p.total : 0)),
  { width: 240, height: 42, stroke: 'var(--danger-fg)', area: 'rgba(220,38,38,.10)' },
))
const msSpark = computed(() => sparkline(
  histPoints.value.map(p => p.avgMs || 0),
  { width: 240, height: 42, stroke: '#2563eb', area: 'rgba(37,99,235,.10)' },
))
const downPctText = computed(() => {
  const p = lastPoint.value
  if (!p || !p.total) return '—'
  return `${Math.round((p.down / p.total) * 1000) / 10}%（${p.down}/${p.total}）`
})
const avgMsText = computed(() => (lastPoint.value && lastPoint.value.avgMs ? `${lastPoint.value.avgMs} ms` : '—'))
const trendRange = computed(() => {
  const pts = histPoints.value
  if (pts.length < 2) return ''
  return `${fmtDateTimeCompact(pts[0].t, '')} → ${fmtDateTimeCompact(pts[pts.length - 1].t, '')}`
})
</script>

<style scoped>
.admin-section { padding: 0 32px 32px; }
.admin-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.admin-section-header h2 { font-size: 16px; font-weight: 600; }
.insight-note { font-size: 12px; color: var(--accent); font-weight: 600; }
.insight-notes { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.insight-note.muted { color: var(--text-secondary); font-weight: 500; }
.insight-grid { display: grid; grid-template-columns: 1.3fr 1fr; gap: 16px; margin-bottom: 16px; }
.quality-summary { margin: 0 0 12px; font-size: 12.5px; color: var(--text-secondary); }
.quality-summary.ok { color: var(--ok-fg); }
.quality-block { margin-bottom: 12px; }
.quality-block:last-child { margin-bottom: 0; }
.quality-block-title { font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; }
.quality-block-title.danger { color: var(--danger-fg); }
.quality-block-title.warn { color: var(--warn-fg); }
.quality-row { display: flex; align-items: baseline; gap: 10px; padding: 5px 0; font-size: 12px; border-bottom: 1px solid var(--border-light); }
.quality-row:last-child { border-bottom: none; }
.quality-host { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text-primary); flex-shrink: 0; }
.quality-names { color: var(--text-secondary); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.quality-fix { border: 1px solid var(--accent); background: transparent; color: var(--accent); font-size: 11px; padding: 2px 10px; border-radius: 999px; cursor: pointer; flex-shrink: 0; font-family: var(--font); }
.quality-fix:hover { background: var(--accent); color: var(--color-on-solid); }
.quality-fix:disabled { opacity: .5; cursor: default; border-color: var(--border); color: var(--text-secondary); background: transparent; }
.merge-row { flex-wrap: wrap; }
.merge-pick { font-family: var(--font); font-size: 11px; padding: 2px 6px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-white); color: var(--text-primary); flex-shrink: 0; max-width: 180px; }
.quality-hint { font-size: 11px; color: var(--text-secondary); opacity: .85; font-weight: 400; }
.quality-empty { font-size: 12.5px; color: var(--text-secondary); }
.dead-fails { font-size: 11px; color: var(--warn-fg); flex-shrink: 0; }
.dead-actions { display: flex; align-items: center; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
.insight-card { background: var(--bg-white); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 20px; }
.insight-title { font-size: 14px; font-weight: 600; margin-bottom: 14px; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.cat-bar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.cat-bar-label { width: 120px; flex-shrink: 0; font-size: 12px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cat-bar-track { flex: 1; height: 10px; background: var(--border-light); border-radius: 5px; overflow: hidden; }
.cat-bar-fill { height: 100%; border-radius: 5px; transition: width var(--dur-slow) ease; }
.cat-bar-count { width: 28px; text-align: right; font-size: 12px; font-weight: 600; color: var(--text-secondary); flex-shrink: 0; }
.top-list { list-style: none; margin: 0; padding: 0; }
.top-list li { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--border-light); }
.top-list li:last-child { border-bottom: none; }
.top-rank { width: 20px; height: 20px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; border-radius: 5px; background: var(--border-light); color: var(--text-secondary); font-size: 11px; font-weight: 700; }
.top-rank.hot { background: var(--warn-bg); color: var(--warn-fg); }
.top-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.top-name { font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.top-url { font-size: 11px; color: var(--text-secondary); font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.top-count { font-size: 12px; font-weight: 700; color: var(--accent); flex-shrink: 0; }
.top-empty { font-size: 13px; color: var(--text-secondary); padding: 6px 0; line-height: 1.6; }
.top-empty strong { color: var(--text-primary); font-weight: 600; }
.dead-note { font-size: 11px; font-weight: 400; color: var(--text-secondary); }
.dead-empty { font-size: 13px; color: var(--ok-fg); padding: 6px 0; }
.dead-list { display: flex; flex-direction: column; max-height: 280px; overflow-y: auto; }
.dead-item { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--border-light); font-size: 13px; }
.dead-item:last-child { border-bottom: none; }
.dead-name { font-weight: 600; color: var(--text-primary); min-width: 120px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dead-url { flex: 1; color: var(--text-secondary); font-family: monospace; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dead-code { flex-shrink: 0; font-size: 11px; font-weight: 700; color: var(--danger-fg); background: var(--danger-bg); padding: 2px 8px; border-radius: 10px; }
.dead-code.warn { color: var(--warn-fg); background: var(--warn-bg); }
@media (max-width: 900px) {
  .insight-grid { grid-template-columns: 1fr; }
}

/* 趋势卡 */
.trend-card { margin-bottom: 16px; }
.trend-empty { font-size: 13px; color: var(--text-secondary); padding: 6px 0; line-height: 1.6; }
.trend-empty.warn { color: var(--warn-fg); }
.trend-row { display: flex; align-items: center; gap: 16px; padding: 8px 0; border-bottom: 1px solid var(--border-light); }
.trend-row:last-of-type { border-bottom: none; }
.trend-metric { width: 130px; flex-shrink: 0; display: flex; flex-direction: column; gap: 2px; }
.trend-label { font-size: 11px; color: var(--text-secondary); }
.trend-value { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.trend-spark { flex: 1; min-width: 0; display: flex; align-items: center; }
.trend-spark svg { max-width: 100%; height: auto; }
.trend-foot { margin-top: 10px; font-size: 11.5px; color: var(--text-disabled); }
</style>