<template>
  <div class="flow-page">
    <header class="df-head">
      <div class="df-head-text">
        <h1 class="df-title">领域流水线</h1>
        <p class="df-sub">
          每个网站在自己领域里的<strong>上下游位置</strong>：从最上游（准备材料、接入能力）
          到最下游（产出成果、落地应用）。看哪一段是空的，就知道这条链缺什么。
        </p>
      </div>

      <div class="df-controls">
        <!-- 视图切换：三种看法回答三个不同问题，所以都要 -->
        <div class="df-viewswitch" role="tablist" aria-label="视图">
          <button
            v-for="v in VIEWS" :key="v.id"
            class="df-vbtn" :class="{ active: view === v.id }"
            role="tab" :aria-selected="view === v.id"
            @click="view = v.id"
          >{{ v.label }}</button>
        </div>

        <label class="df-ctl">
          <span>只看 <b>{{ activeDomainLabel }}</b></span>
          <select class="df-select" :value="domainFilter" @change="domainFilter = $event.target.value">
            <option value="all">全部领域</option>
            <option v-for="d in DOMAINS" :key="d.id" :value="d.id">{{ d.label }}（{{ countIn(d.id) }}）</option>
          </select>
        </label>
      </div>
    </header>

    <!-- 总览条：一眼看到全局健康度 -->
    <div class="df-overview">
      <div class="df-stat">
        <span class="df-stat-num">{{ sitesStore.sites.length }}</span>
        <span class="df-stat-label">站点总数</span>
      </div>
      <div class="df-stat">
        <span class="df-stat-num">{{ placedCount }}</span>
        <span class="df-stat-label">已定位</span>
      </div>
      <div class="df-stat" :class="{ warn: unplacedCount > 0 }">
        <span class="df-stat-num">{{ unplacedCount }}</span>
        <span class="df-stat-label">未定位</span>
      </div>
      <div class="df-stat" :class="{ warn: totalGaps > 0 }">
        <span class="df-stat-num">{{ totalGaps }}</span>
        <span class="df-stat-label">空环节</span>
      </div>
      <div class="df-legend">
        <span class="df-legend-item"><i class="df-dot up"></i>上游</span>
        <span class="df-legend-item"><i class="df-dot mid"></i>中游</span>
        <span class="df-legend-item"><i class="df-dot down"></i>下游</span>
      </div>
    </div>

    <!-- ① 流水线：每个领域一条横向链条 -->
    <div v-if="view === 'pipeline'" class="df-pipelines">
      <section v-for="cov in visibleCoverage" :key="cov.domain.id" class="df-pipeline">
        <div class="df-pipe-head">
          <h2 class="df-pipe-title" :style="{ color: cov.domain.color }">{{ cov.domain.label }}</h2>
          <span class="df-pipe-desc">{{ cov.domain.desc }}</span>
          <span class="df-pipe-meta">
            {{ cov.placed }} 站 · 覆盖率 {{ cov.coverage }}%
            <b v-if="cov.gaps" class="df-gapflag">{{ cov.gaps }} 处空缺</b>
          </span>
        </div>

        <div class="df-chain">
          <div
            v-for="(b, i) in cov.buckets" :key="b.stage.id"
            class="df-node" :class="[b.band, { empty: b.empty }]"
            :title="b.stage.desc"
          >
            <div class="df-node-idx">{{ i + 1 }}</div>
            <div class="df-node-body">
              <div class="df-node-label">{{ b.stage.label }}</div>
              <div class="df-node-count" v-if="!b.empty">{{ b.count }}</div>
              <div class="df-node-count zero" v-else>0</div>
            </div>
            <!-- 站点多时折叠：展开才渲染具体名字，避免 300 张卡片同时上屏 -->
            <div v-if="!b.empty" class="df-node-sites">
              <button
                v-for="s in shownSites(b)" :key="s.id"
                class="df-chip" :style="{ '--chip': s.color || cov.domain.color }"
                :title="s.desc"
                @click="openSite(s)"
              >{{ s.name }}</button>
              <button v-if="b.sites.length > LIMIT" class="df-chip more" @click="expand(b.stage.id)">
                +{{ b.sites.length - LIMIT }}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!--
      ② 矩阵：每个领域**自己一张表**，列就是它自己的环节序列。

      绝不能用一张表把四个领域摞在一起：各领域环节数和含义都不同，
      共用一个表头会让「AI 工作流」行的数字落在「法币入金」列下面 —— 那是错的。
      第一版就是这么写的，截图里一眼能看出来：一个含义对不上的格子。
    -->
    <div v-else-if="view === 'matrix'" class="df-matrices">
      <section v-for="cov in visibleCoverage" :key="cov.domain.id" class="df-mx-block">
        <h3 class="df-mx-title" :style="{ color: cov.domain.color }">
          {{ cov.domain.label }}
          <span class="df-mx-sub">{{ cov.placed }} 站 · {{ cov.gaps }} 处空缺</span>
        </h3>
        <div class="df-mx-row">
          <div
            v-for="(b, i) in cov.buckets" :key="b.stage.id"
            class="df-mx-tile" :class="{ empty: b.empty }"
            :style="cellStyle(b, cov.domain.color)"
            :title="`${b.stage.label}：${b.count} 站`"
            @click="focusStage(b.stage.id)"
          >
            <span class="df-mx-n">{{ b.count || 0 }}</span>
            <span class="df-mx-label">{{ i + 1 }}. {{ b.stage.label }}</span>
          </div>
        </div>
      </section>
      <p class="df-mx-note">颜色越深表示该环节站点越密集；虚线格子＝这条链在这里断了。</p>
    </div>

    <!-- ③ 列表：按位置排序的完整清单，用来核对与手工调整 -->
    <div v-else class="df-list">
      <div class="df-list-head">
        <span>站点</span>
        <span>位置</span>
        <span>来源</span>
        <span>置信</span>
      </div>
      <div v-for="row in sortedRows" :key="row.id" class="df-list-row" @click="openSite(row)">
        <span class="df-lr-name">
          <i class="df-lr-dot" :style="{ background: row.color }"></i>
          {{ row.name }}
        </span>
        <span class="df-lr-pos">{{ row.posLabel }}</span>
        <span class="df-lr-src" :class="row.source">{{ row.source === 'manual' ? '人工' : '自动' }}</span>
        <span class="df-lr-conf">{{ row.confidence ? Math.round(row.confidence * 100) + '%' : '—' }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSitesStore } from '@/stores/sites'
import { usePreferencesStore } from '@/stores/preferences'
import { DOMAINS, DOMAIN_BY_ID, domainCoverage, normalizePosition, describePosition, STAGE_INDEX } from '../../shared/domain-flow.mjs'

const VIEWS = [
  { id: 'pipeline', label: '流水线' },
  { id: 'matrix', label: '热力矩阵' },
  { id: 'list', label: '清单' },
]

/** 单个环节最多先展示几个站点；其余折叠成「+N」 */
const LIMIT = 8

const router = useRouter()
const sitesStore = useSitesStore()
const preferencesStore = usePreferencesStore()

const view = ref('pipeline')
const domainFilter = ref('all')
/** 手动展开过的环节：`${domainId}:${stageId}` → true */
const expanded = ref({})

const activeDomainLabel = computed(() =>
  domainFilter.value === 'all' ? '全部' : (DOMAIN_BY_ID.get(domainFilter.value)?.label || '全部'))

function countIn(domainId) {
  return sitesStore.sites.filter((s) => normalizePosition(s.position)?.domain === domainId).length
}

/** 每个领域的覆盖情况（含空环节统计） */
const coverage = computed(() => DOMAINS.map((d) => domainCoverage(sitesStore.sites, d.id)))

const visibleCoverage = computed(() =>
  domainFilter.value === 'all' ? coverage.value : coverage.value.filter((c) => c.domain.id === domainFilter.value))

const placedCount = computed(() => sitesStore.sites.filter((s) => normalizePosition(s.position)).length)
const unplacedCount = computed(() => sitesStore.sites.length - placedCount.value)
const totalGaps = computed(() => visibleCoverage.value.reduce((a, c) => a + c.gaps, 0))

/**
 * 热力浓度：**按所属领域内**的最大值归一，不跨领域比较。
 *
 * 跨领域比较是没有意义的 —— 「AI 工作流」一个环节 25 站和「基础设施」一个环节 16 站
 * 并不能说明前者更「热」，它们只是不同链条上的不同环节。按领域内归一，
 * 才能读成「这条链上哪一环最密集」。
 */
/**
 * 热力浓度上限**刻意压到 0.55**，不做到 1.0。
 *
 * 满浓度会让深色底上的小字（环节名）对比度不足 —— 截图里「法币入金」几乎读不出来，
 * 而这正是项目上一轮修过的那类问题（`--on-accent` 的 WCAG 欠账）。
 * 浓度只表达「相对密集」，压上限不影响这个语义，却保住可读性。
 */
const MAX_ALPHA = 0.55

function cellStyle(bucket, color) {
  if (!bucket.count) return {}
  const cov = coverage.value.find((c) => c.buckets.some((b) => b.stage.id === bucket.stage.id))
  const max = Math.max(1, ...(cov?.buckets || []).map((x) => x.count))
  const ratio = 0.12 + (MAX_ALPHA - 0.12) * (bucket.count / max)
  return { background: hexAlpha(color, ratio) }
}

/** #rrggbb + 透明度 → rgba()；色值非法时退回中性灰，不抛错 */
function hexAlpha(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''))
  if (!m) return `rgba(120,120,120,${alpha})`
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

function shownSites(bucket) {
  const key = `${bucket.stage.id}`
  return expanded.value[key] ? bucket.sites : bucket.sites.slice(0, LIMIT)
}

function expand(stageId) {
  expanded.value = { ...expanded.value, [stageId]: true }
}

function focusStage(stageId) {
  // 点矩阵格子 → 切到流水线并只看那个领域的链条
  const hit = STAGE_INDEX.get(stageId)
  if (hit) { domainFilter.value = hit.domain.id; view.value = 'pipeline' }
}

/** 清单行：按「领域顺序 → 环节顺序 → 名称」排 */
const sortedRows = computed(() => {
  const rows = []
  for (const s of sitesStore.sites) {
    const pos = normalizePosition(s.position)
    if (!pos) {
      rows.push({
        id: s.id, name: s.name, color: s.color, source: 'auto',
        confidence: 0, posLabel: '未定位', sortKey: [99, 99, s.name],
      })
      continue
    }
    const desc = describePosition(pos.stage)
    rows.push({
      id: s.id, name: s.name, color: s.color, source: pos.source,
      confidence: s.position?.confidence || 0,
      posLabel: desc ? desc.label : pos.stage,
      sortKey: [
        DOMAINS.findIndex((d) => d.id === pos.domain),
        desc?.order ?? 99,
        s.name,
      ],
    })
  }
  return rows
    .filter((r) => domainFilter.value === 'all' || r.posLabel.startsWith(DOMAIN_BY_ID.get(domainFilter.value)?.label || '\u0000'))
    .sort((a, b) => {
      for (let i = 0; i < 2; i++) if (a.sortKey[i] !== b.sortKey[i]) return a.sortKey[i] - b.sortKey[i]
      return String(a.sortKey[2]).localeCompare(String(b.sortKey[2]))
    })
})

/** 点站点 → 回首页并高亮它（复用既有的高亮机制，不另开详情页） */
function openSite(site) {
  if (!site?.id) return
  sitesStore.highlightSite?.(site.id)
  router.push({ name: 'Home', query: { q: site.name } })
}
</script>

<style scoped>
.flow-page { max-width: 1180px; margin: 0 auto; padding: 28px 20px 60px; }
.df-head { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; justify-content: space-between; margin-bottom: 18px; }
.df-title { font-size: 22px; font-weight: 650; margin: 0 0 6px; color: var(--text-primary); }
.df-sub { margin: 0; font-size: 13px; line-height: 1.6; color: var(--text-secondary); max-width: 640px; }
.df-controls { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }

.df-viewswitch { display: inline-flex; background: var(--surface-2, rgba(127,127,127,.12)); border-radius: 8px; padding: 2px; }
.df-vbtn { border: 0; background: transparent; padding: 5px 12px; font-size: 13px; border-radius: 6px; cursor: pointer; color: var(--text-secondary); transition: background var(--dur-fast), color var(--dur-fast); }
.df-vbtn.active { background: var(--surface-1, #fff); color: var(--text-primary); font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,.08); }

.df-ctl { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-secondary); }
.df-select { padding: 5px 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface-1, #fff); color: var(--text-primary); font-size: 13px; }

.df-overview { display: flex; align-items: center; gap: 22px; flex-wrap: wrap; padding: 12px 16px; margin-bottom: 22px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-2, rgba(127,127,127,.05)); }
.df-stat { display: flex; align-items: baseline; gap: 6px; }
.df-stat-num { font-size: 19px; font-weight: 650; color: var(--text-primary); font-variant-numeric: tabular-nums; }
.df-stat.warn .df-stat-num { color: var(--color-danger, #ef4444); }
.df-stat-label { font-size: 12px; color: var(--text-tertiary); }
.df-legend { margin-left: auto; display: flex; gap: 14px; font-size: 12px; color: var(--text-tertiary); }
.df-legend-item { display: inline-flex; align-items: center; gap: 5px; }
.df-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.df-dot.up { background: var(--color-ok, #22c55e); }
.df-dot.mid { background: var(--accent, #0071e3); }
.df-dot.down { background: var(--color-warn, #f59e0b); }

/* ---- 流水线 ---- */
.df-pipelines { display: flex; flex-direction: column; gap: 26px; }
.df-pipe-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.df-pipe-title { font-size: 15px; font-weight: 650; margin: 0; }
.df-pipe-desc { font-size: 12px; color: var(--text-tertiary); }
.df-pipe-meta { margin-left: auto; font-size: 12px; color: var(--text-tertiary); }
.df-gapflag { color: var(--color-danger, #ef4444); margin-left: 6px; }

/*
 * 横向链：环节多于一屏时**横向滚动**，而不是把节点压扁。
 *
 * 第一版用 `flex: 1 1 0` + `min-width`，在窄容器里 flex 会优先压缩以填满一行，
 * 结果是只看得见第一个节点、其余被挤到容器外（截图里能直接看到）。
 * `flex: 0 0 auto` + 固定基准宽让每个节点保持可读，超出部分交给滚动。
 */
.df-chain { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 8px; scrollbar-width: thin; }
.df-node { flex: 0 0 auto; width: 168px; border: 1px solid var(--border); border-radius: 9px; padding: 9px 10px 10px; background: var(--surface-1, #fff); display: flex; flex-direction: column; gap: 7px; }
.df-node.empty { border-style: dashed; opacity: .62; }
.df-node.up { border-top: 3px solid var(--color-ok, #22c55e); }
.df-node.mid { border-top: 3px solid var(--accent, #0071e3); }
.df-node.down { border-top: 3px solid var(--color-warn, #f59e0b); }
.df-node-idx { font-size: 10px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
.df-node-body { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; }
.df-node-label { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.df-node-count { font-size: 15px; font-weight: 650; color: var(--accent, #0071e3); font-variant-numeric: tabular-nums; }
.df-node-count.zero { color: var(--text-tertiary); }
.df-node-sites { display: flex; flex-wrap: wrap; gap: 4px; }
.df-chip { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 1px solid var(--border); border-left: 3px solid var(--chip, var(--accent)); background: transparent; color: var(--text-secondary); font-size: 11px; padding: 2px 6px; border-radius: 4px; cursor: pointer; }
.df-chip:hover { color: var(--text-primary); background: var(--surface-2, rgba(127,127,127,.1)); }
.df-chip.more { color: var(--accent, #0071e3); border-left-color: transparent; }

/* ---- 矩阵（每领域一张，横向格子） ---- */
.df-matrices { display: flex; flex-direction: column; gap: 22px; }
.df-mx-block { }
.df-mx-title { font-size: 14px; font-weight: 650; margin: 0 0 8px; display: flex; align-items: baseline; gap: 8px; }
.df-mx-sub { font-size: 11px; font-weight: 400; color: var(--text-tertiary); }
.df-mx-row { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 6px; scrollbar-width: thin; }
.df-mx-tile {
  flex: 0 0 auto; width: 96px; min-height: 58px; padding: 7px 8px;
  border: 1px solid var(--border-light, rgba(127,127,127,.15)); border-radius: 7px;
  display: flex; flex-direction: column; justify-content: space-between; gap: 4px;
  cursor: pointer; transition: transform var(--dur-fast);
}
.df-mx-tile:hover { transform: translateY(-1px); }
.df-mx-tile.empty { border-style: dashed; background: transparent !important; }
.df-mx-n { font-size: 17px; font-weight: 650; color: var(--text-primary); font-variant-numeric: tabular-nums; line-height: 1; }
.df-mx-tile.empty .df-mx-n { color: var(--text-tertiary); font-weight: 400; }
.df-mx-label { font-size: 10px; color: var(--text-secondary); line-height: 1.3; }
.df-mx-note { margin-top: 12px; font-size: 12px; color: var(--text-tertiary); }

/* ---- 清单 ---- */
.df-list { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.df-list-head, .df-list-row { display: grid; grid-template-columns: 1.4fr 2fr 70px 70px; gap: 10px; padding: 8px 14px; align-items: center; font-size: 13px; }
.df-list-head { background: var(--surface-2, rgba(127,127,127,.08)); font-size: 12px; font-weight: 600; color: var(--text-tertiary); }
.df-list-row { border-top: 1px solid var(--border-light, rgba(127,127,127,.12)); cursor: pointer; }
.df-list-row:hover { background: var(--surface-2, rgba(127,127,127,.06)); }
.df-lr-name { display: flex; align-items: center; gap: 7px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.df-lr-dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
.df-lr-pos { color: var(--text-secondary); font-size: 12px; }
.df-lr-src { font-size: 11px; color: var(--text-tertiary); }
.df-lr-src.manual { color: var(--accent, #0071e3); font-weight: 600; }
.df-lr-conf { font-size: 11px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }

@media (max-width: 768px) {
  .df-chain { flex-direction: column; }
  .df-node { min-width: 0; }
  .df-list-head, .df-list-row { grid-template-columns: 1fr 1.2fr; }
  .df-lr-src, .df-lr-conf, .df-list-head > :nth-child(3), .df-list-head > :nth-child(4) { display: none; }
}
</style>
