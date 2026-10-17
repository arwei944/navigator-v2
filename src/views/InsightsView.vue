<template>
  <div class="insights">
    <header class="ins-head">
      <div class="ins-head-text">
        <h1 class="ins-title">洞察</h1>
        <p class="ins-sub">
          热度、分类分布与站点健康度。点击与体检都是<strong>云端全站口径</strong>，
          不是本机的浏览记录 —— 换设备看到的是同一份。
        </p>
      </div>
      <div class="ins-range" role="group" aria-label="趋势区间">
        <button v-for="d in RANGES" :key="d" type="button"
                class="seg-btn" :class="{ active: days === d }"
                :aria-pressed="days === d"
                @click="days = d">近 {{ d }} 天</button>
      </div>
    </header>

    <div class="ins-grid">
      <!-- 使用热度 -->
      <section class="ins-card">
        <div class="ins-card-head">
          <h2>使用热度</h2>
          <span class="ins-hint">近 {{ days }} 天 · 共 {{ totalClicks }} 次点击</span>
        </div>

        <ol v-if="topSites.length" class="rank-list" role="list">
          <li v-for="(s, i) in topSites" :key="s.id" class="rank-row">
            <span class="rank-no" :class="{ hot: s.hot }">{{ i + 1 }}</span>
            <span class="rank-name" :title="s.name || s.url">{{ s.name || s.url }}</span>
            <!-- v-html 的内容全部来自 utils/chartkit.js：那里只输出几何图元、不输出任何文本，
                 因此外部数据（站点名）永远进不了这段 HTML。文本一律走上面的普通插值。 -->
            <span class="rank-spark" v-html="s.spark" aria-hidden="true"></span>
            <span class="rank-recent" :title="`近 ${days} 天 ${s.recent} 次`">+{{ s.recent }}</span>
            <span class="rank-total">{{ s.count }}</span>
          </li>
        </ol>
        <p v-else class="ins-empty">
          还没有点击数据。点击统计是<strong>匿名累加</strong>的，访客点过站之后这里才会出现曲线。
        </p>
      </section>

      <!-- 分类分布 -->
      <section class="ins-card">
        <div class="ins-card-head">
          <h2>分类分布</h2>
          <span class="ins-hint">{{ sitesStore.sites.length }} 个站点</span>
        </div>
        <div class="cat-body">
          <div class="cat-donut" v-html="donutSvg" aria-hidden="true"></div>
          <ul class="cat-list" role="list">
            <li v-for="c in categoryStats" :key="c.id">
              <span class="cat-dot" :style="{ background: c.color }" aria-hidden="true"></span>
              <span class="cat-label" :title="c.label">{{ c.label }}</span>
              <span class="cat-track" v-html="c.bar" aria-hidden="true"></span>
              <span class="cat-count">{{ c.count }}</span>
            </li>
          </ul>
        </div>
      </section>

      <!-- 站点健康度 -->
      <section class="ins-card ins-card-wide">
        <div class="ins-card-head">
          <h2>站点健康度</h2>
          <span class="ins-hint">{{ judgedAt }}</span>
        </div>
        <div class="health-strip" v-html="healthStrip" aria-hidden="true"></div>
        <ul class="health-legend" role="list">
          <li v-for="seg in healthSegments" :key="seg.key">
            <span class="cat-dot" :style="{ background: seg.color }" aria-hidden="true"></span>
            <span class="leg-label">{{ seg.label }}</span>
            <span class="leg-value">{{ seg.value }}</span>
          </li>
        </ul>

        <div v-if="abnormalSites.length" class="health-issues">
          <p class="issues-note">{{ abnormalSites.length }} 个站点需要留意，点击查看判定详情</p>
          <ul class="issues-list" role="list">
            <li v-for="s in abnormalSites" :key="s.id">
              <button type="button" class="issue-btn" @click="showDetail(s)">
                <span class="issue-dot" :class="s.status" aria-hidden="true"></span>
                <span class="issue-name" :title="s.name">{{ s.name }}</span>
                <span class="issue-url">{{ s.url }}</span>
                <span class="issue-code" v-if="s.code">{{ s.code }}</span>
              </button>
            </li>
          </ul>
        </div>
        <p v-else class="ins-empty">尚无失效或受限的站点。体检由服务端定时巡检产出，未配置时这里会显示「未探测」。</p>
      </section>

      <!-- 点击趋势：近 N 天全站点击量按天汇总 -->
      <section class="ins-card">
        <div class="ins-card-head">
          <h2>点击趋势</h2>
          <span class="ins-hint">近 {{ days }} 天 · 共 {{ trendTotal }} 次</span>
        </div>
        <div class="trend-body" v-html="trendSpark" aria-hidden="true"></div>
        <p v-if="!trendTotal" class="ins-empty">
          近 {{ days }} 天没有点击记录。趋势要靠时间积累 —— 云端巡检与访客点击持续累积后这里才有曲线。
        </p>
      </section>

      <!-- 冷门站点：点击最少的长尾，供「该不该清理/归档」的决策参考 -->
      <section class="ins-card">
        <div class="ins-card-head">
          <h2>冷门站点</h2>
          <span class="ins-hint">{{ coldSites.zero }} / {{ sitesStore.sites.length }} 个零点击</span>
        </div>
        <ul v-if="coldSites.least.length" class="cold-list" role="list">
          <li v-for="s in coldSites.least" :key="s.id" class="cold-row">
            <span class="cold-name" :title="s.name">{{ s.name }}</span>
            <span class="cold-count">{{ s.count }}</span>
          </li>
        </ul>
        <p v-else class="ins-empty">暂无点击数据，无法判别冷门。</p>
        <p class="ins-note">长期零点击的站点可考虑归档；归档建议与一键操作在后台「数据洞察」提供。</p>
      </section>

      <!-- 图表外观：三个令牌只服务这个页面，放在这里比塞进设置面板更近 -->
      <section class="ins-card">
        <div class="ins-card-head">
          <h2>图表外观</h2>
          <span class="ins-hint">跟随视觉方案</span>
        </div>
        <div class="tune-row">
          <label class="tune-label" for="tune-radius">圆角</label>
          <input id="tune-radius" type="range" min="0" max="16" step="2"
                 :value="chartRadius" @input="setToken('chartRadius', $event)" />
          <span class="tune-value">{{ chartRadius }}px</span>
        </div>
        <div class="tune-row">
          <label class="tune-label" for="tune-height">趋势图高度</label>
          <input id="tune-height" type="range" min="24" max="64" step="4"
                 :value="chartHeight" @input="setToken('chartHeight', $event)" />
          <span class="tune-value">{{ chartHeight }}px</span>
        </div>
        <div class="tune-row">
          <label class="tune-label" for="tune-area">填充面积</label>
          <input id="tune-area" type="checkbox" :checked="chartArea"
                 @change="prefs.setVisualToken('chartArea', $event.target.checked)" />
        </div>
        <div class="tune-preview" v-html="previewSpark" aria-hidden="true"></div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { useClicksStore } from '@/stores/clicks'
import { useHealthStore } from '@/stores/health'
import { usePreferencesStore } from '@/stores/preferences'
import { useSidebarStore } from '@/stores/sidebar'
import { rankByClicks, seriesOf, dayKey } from '../../shared/clicks-core.mjs'
import { sparkline, donut, heatstrip, barTrack } from '@/utils/chartkit'

/**
 * 洞察面板（v11）。
 *
 * 与后台「数据洞察」的区别：那里是管理入口（要登录），这里是**任何人可见**的前台页面。
 * 能这么做是因为这两个数据源本来就是公开只读的 —— `GET /api/clicks` 与 `GET /api/health`
 * 都不带个人数据（点击是匿名累加的全站口径，体检是服务端巡检的判定）。
 *
 * 性能：整页只依赖 4 个 store 的聚合值，300 站的遍历都在 computed 里做一次并缓存；
 * 图表是**字符串**，不建立任何响应式图元，切换区间只是重算 10 条字符串。
 */
const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()
const clicksStore = useClicksStore()
const healthStore = useHealthStore()
const prefs = usePreferencesStore()
const sidebarStore = useSidebarStore()

const RANGES = [7, 30]
const days = ref(30)

onMounted(() => {
  // 两个数据源都是云端快照，进来先拉一次新鲜的（TTL 内的重复调用是 no-op）
  clicksStore.refresh()
  healthStore.refresh()
})

/* ---- 图表令牌 ---- */

const chartRadius = computed(() => Number(prefs.activeTokens.chartRadius) || 0)
const chartHeight = computed(() => Number(prefs.activeTokens.chartHeight) || 32)
const chartArea = computed(() => prefs.activeTokens.chartArea !== false)

function setToken(key, e) {
  prefs.setVisualToken(key, Number(e.target.value))
}

/* ---- 使用热度 ---- */

const totalClicks = computed(() => {
  let t = 0
  for (const n of Object.values(clicksStore.mergedCounts)) t += Number(n) || 0
  return t
})

const topSites = computed(() =>
  rankByClicks(sitesStore.sites, clicksStore.mergedCounts)
    .filter((s) => clicksStore.countFor(s.id) > 0)
    .slice(0, 10)
    .map((s, i) => {
      const vals = seriesOf(clicksStore.mergedSeries, s.id, { days: days.value })
      return {
        id: s.id,
        name: s.name,
        url: s.url,
        count: clicksStore.countFor(s.id),
        recent: vals.reduce((a, b) => a + b, 0),
        spark: sparkline(vals, {
          width: 132,
          height: chartHeight.value,
          area: chartArea.value ? undefined : null,
        }),
        hot: i < 3,
      }
    })
)

/* ---- 分类分布 ---- */

/** 未归类的站点单独成一项：它们真实存在，藏起来会让分布图加起来对不上总数 */
const categoryStats = computed(() => {
  const counts = new Map()
  let loose = 0
  for (const s of sitesStore.sites) {
    if (!s.categoryId) { loose += 1; continue }
    counts.set(s.categoryId, (counts.get(s.categoryId) || 0) + 1)
  }
  const rows = categoriesStore.categories
    .map((c) => ({ id: c.id, label: c.label, color: c.dotColor || 'var(--accent)', count: counts.get(c.id) || 0 }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count)
  if (loose) rows.push({ id: '__none__', label: '未分类', color: 'var(--color-muted)', count: loose })
  const max = Math.max(1, ...rows.map((r) => r.count))
  return rows.map((r) => ({ ...r, bar: barTrack(r.count, max, { width: 140, height: 8, radius: chartRadius.value, color: r.color }) }))
})

/** 环形只画前 6 项 + 「其他」：20 多个分类挤成一圈，每段都细得看不出来 */
const donutSvg = computed(() => {
  const rows = categoryStats.value
  if (!rows.length) return donut([], { size: 132, thickness: 16, radius: chartRadius.value })
  const head = rows.slice(0, 6)
  const rest = rows.slice(6)
  const segs = head.map((r) => ({ value: r.count, color: r.color }))
  if (rest.length) segs.push({ value: rest.reduce((a, r) => a + r.count, 0), color: 'var(--color-muted)' })
  return donut(segs, { size: 132, thickness: 16 })
})

/* ---- 站点健康度 ---- */

const HEALTH_META = [
  { key: 'ok', label: '可访问', color: 'var(--color-ok)' },
  { key: 'limited', label: '受限', color: 'var(--color-warn)' },
  { key: 'down', label: '失效', color: 'var(--color-danger)' },
  { key: 'unknown', label: '未探测', color: 'var(--color-muted)' },
]

const healthSegments = computed(() => {
  const c = { ok: 0, limited: 0, down: 0, unknown: 0 }
  for (const s of sitesStore.sites) {
    const st = healthStore.getStatus(s.id).status
    c[st] = (c[st] || 0) + 1
  }
  return HEALTH_META.map((m) => ({ ...m, value: c[m.key] || 0 }))
})

const healthStrip = computed(() =>
  heatstrip(healthSegments.value, { width: 420, height: 12, radius: chartRadius.value })
)

/** 失效与受限才需要人看；全部可访问时这一块整体不出现 */
const abnormalSites = computed(() =>
  sitesStore.sites
    .map((s) => {
      const h = healthStore.getStatus(s.id)
      return h.status === 'down' || h.status === 'limited' ? { ...s, status: h.status, code: h.code } : null
    })
    .filter(Boolean)
    .slice(0, 20)
)

const judgedAt = computed(() => {
  const ts = healthStore.updatedAt
  if (!ts) return '尚未体检'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '尚未体检'
  return `体检于 ${d.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
})

function showDetail(site) {
  sidebarStore.showDetail(site)
}

/* ---- 点击趋势（F6）：近 N 天全站点击量按天聚合 ---- */

/**
 * 把 mergedSeries 里每个站点的按天分桶，按日期横向汇总成全站曲线。
 * 为什么逐日回填而不是遍历 series 的 key：分桶只记录**有点击的那天**，
 * 缺的天要补 0，否则曲线会把「没人点的那天」挤掉，看上去像天天都有人来。
 */
const trendVals = computed(() => {
  const n = days.value
  const out = []
  const base = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base)
    d.setDate(d.getDate() - i)
    const key = dayKey(d)
    let total = 0
    for (const buckets of Object.values(clicksStore.mergedSeries)) {
      total += Number(buckets?.[key]) || 0
    }
    out.push(total)
  }
  return out
})
const trendTotal = computed(() => trendVals.value.reduce((a, b) => a + b, 0))
const trendSpark = computed(() => sparkline(trendVals.value, {
  width: 420,
  height: chartHeight.value + 8,
  area: chartArea.value ? undefined : null,
}))

/* ---- 冷门站点（F6）：点击最少的长尾 ---- */

/**
 * 冷门 = 点击最少。零点击单独计数（它是「从没被打开过」的强信号），
 * 清单则取「有点击但最少」的 10 条 —— 全列零点击会有几百行，看不出重点。
 */
const coldSites = computed(() => {
  const rows = sitesStore.sites.map(s => ({
    id: s.id, name: s.name, url: s.url, count: clicksStore.countFor(s.id),
  }))
  return {
    zero: rows.filter(r => r.count === 0).length,
    least: rows.filter(r => r.count > 0).sort((a, b) => a.count - b.count).slice(0, 10),
  }
})

/* ---- 预览（调令牌时立刻看到效果，不必滚回上面） ---- */
const previewSpark = computed(() =>
  sparkline([2, 5, 3, 8, 6, 11, 9, 14], {
    width: 260,
    height: chartHeight.value + 8,
    area: chartArea.value ? undefined : null,
  })
)
</script>

<style scoped>
.insights { padding: 24px 28px 40px; max-width: 1240px; margin: 0 auto; }
.ins-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
.ins-title { font-size: 22px; font-weight: 600; margin: 0 0 6px; color: var(--text-primary); }
.ins-sub { font-size: 13px; color: var(--text-secondary); margin: 0; line-height: 1.6; max-width: 640px; }
.ins-sub strong { font-weight: 500; color: var(--text-primary); }

.ins-range { display: flex; gap: 4px; background: var(--bg-white); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 3px; }
.seg-btn { border: none; background: transparent; color: var(--text-secondary); font-size: 12px; font-weight: 500; padding: 5px 12px; border-radius: calc(var(--radius-sm) - 2px); cursor: pointer; }
.seg-btn.active { background: var(--accent); color: var(--color-on-solid, #fff); }

.ins-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.ins-card { background: var(--bg-white); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 20px; min-width: 0; }
.ins-card-wide { grid-column: 1 / -1; }
.ins-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
.ins-card-head h2 { font-size: 14px; font-weight: 600; margin: 0; color: var(--text-primary); }
.ins-hint { font-size: 11px; color: var(--text-secondary); }

.ins-empty { font-size: 13px; color: var(--text-secondary); line-height: 1.7; margin: 0; }
.ins-empty strong { font-weight: 500; color: var(--text-primary); }

/* 热度榜 */
.rank-list { list-style: none; margin: 0; padding: 0; }
.rank-row { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--border-light); }
.rank-row:last-child { border-bottom: none; }
.rank-no { width: 20px; height: 20px; flex: 0 0 20px; display: flex; align-items: center; justify-content: center; border-radius: 5px; background: var(--border-light); color: var(--text-secondary); font-size: 11px; font-weight: 600; }
.rank-no.hot { background: var(--color-heat-warm-bg, var(--accent-light)); color: var(--color-heat-warm, var(--accent)); }
.rank-name { flex: 1; min-width: 0; font-size: 13px; font-weight: 500; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rank-spark { flex: 0 0 auto; display: flex; align-items: center; }
.rank-recent { flex: 0 0 auto; font-size: 12px; font-weight: 600; color: var(--accent); min-width: 34px; text-align: right; font-variant-numeric: tabular-nums; }
.rank-total { flex: 0 0 auto; font-size: 12px; color: var(--text-secondary); min-width: 40px; text-align: right; font-variant-numeric: tabular-nums; }

/* 分类分布 */
.cat-body { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; }
.cat-donut { flex: 0 0 auto; display: flex; align-items: center; }
.cat-list { flex: 1; min-width: 200px; list-style: none; margin: 0; padding: 0; }
.cat-list li { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
.cat-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 8px; }
.cat-label { flex: 0 0 76px; font-size: 12px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cat-track { flex: 1; min-width: 0; display: flex; align-items: center; }
.cat-count { flex: 0 0 auto; font-size: 12px; font-weight: 600; color: var(--text-secondary); font-variant-numeric: tabular-nums; }

/* 健康度 */
.health-strip { margin-bottom: 14px; }
.health-legend { list-style: none; margin: 0 0 14px; padding: 0; display: flex; gap: 18px; flex-wrap: wrap; }
.health-legend li { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); }
.leg-value { font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums; }
.issues-note { font-size: 12px; color: var(--text-secondary); margin: 0 0 8px; }
.issues-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 2px 16px; }
.issue-btn { display: flex; align-items: center; gap: 8px; width: 100%; border: none; background: transparent; padding: 5px 0; cursor: pointer; text-align: left; border-bottom: 1px solid var(--border-light); }
.issue-dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 7px; background: var(--color-warn); }
.issue-dot.down { background: var(--color-danger); }
.issue-name { font-size: 12px; font-weight: 500; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px; }
.issue-url { flex: 1; min-width: 0; font-size: 11px; color: var(--text-secondary); font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.issue-code { flex: 0 0 auto; font-size: 11px; font-weight: 600; color: var(--text-secondary); }

/* 图表外观 */
.tune-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.tune-label { flex: 0 0 72px; font-size: 12px; color: var(--text-secondary); }
.tune-row input[type='range'] { flex: 1; min-width: 0; accent-color: var(--accent); }
.tune-row input[type='checkbox'] { accent-color: var(--accent); }
.tune-value { flex: 0 0 44px; text-align: right; font-size: 12px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.tune-preview { margin-top: 12px; padding: 10px; border: 1px solid var(--border-light); border-radius: var(--radius-sm); display: flex; align-items: center; }

/* 点击趋势 + 冷门站点（F6） */
.trend-body { display: flex; align-items: center; }
.trend-body svg { max-width: 100%; height: auto; }
.cold-list { list-style: none; margin: 0; padding: 0; }
.cold-row { display: flex; align-items: center; gap: 10px; padding: 5px 0; border-bottom: 1px solid var(--border-light); }
.cold-row:last-child { border-bottom: none; }
.cold-name { flex: 1; min-width: 0; font-size: 13px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cold-count { flex: 0 0 auto; font-size: 12px; font-weight: 600; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.ins-note { font-size: 11.5px; color: var(--text-secondary); margin: 10px 0 0; line-height: 1.6; }

@media (max-width: 900px) {
  .insights { padding: 16px 14px 32px; }
  .ins-grid { grid-template-columns: 1fr; }
}
</style>
