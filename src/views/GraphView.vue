<template>
  <div class="graph-page">
    <header class="gp-head">
      <div class="gp-head-text">
        <h1 class="gp-title">关联图谱</h1>
        <p class="gp-sub">
          站点之间「为什么相关」的可解释关系网：同分类、同用途、讲同一件事、同一站点家族。
          线条越粗表示关联越强，点节点看它的邻居与理由。
        </p>
      </div>

      <div class="gp-controls">
        <label class="gp-ctl">
          <span>关联强度 <b>{{ draft.threshold }}</b></span>
          <input type="range" min="20" max="70" step="5" :value="draft.threshold"
                 @input="onDraft('threshold', $event)" @change="commit()">
        </label>
        <label class="gp-ctl">
          <span>每站最多连 <b>{{ draft.topK }}</b></span>
          <input type="range" min="2" max="10" step="1" :value="draft.topK"
                 @input="onDraft('topK', $event)" @change="commit()">
        </label>
        <select class="gp-select" :value="categoryFilter" @change="categoryFilter = $event.target.value">
          <option value="">全部分类</option>
          <option v-for="c in categoriesStore.categories" :key="c.id" :value="c.id">{{ c.label }}</option>
        </select>
        <button type="button" class="gp-btn" @click="resetView">重置视图</button>
      </div>
    </header>

    <div class="gp-body">
      <div class="gp-stage" ref="stageRef">
        <svg class="gp-svg" :viewBox="`0 0 ${W} ${H}`" role="img"
             :aria-label="`站点关联图谱，共 ${renderedNodes.length} 个节点、${renderedEdges.length} 条连线`"
             @wheel.prevent="onWheel" @pointerdown="onPanStart" @pointermove="onPanMove"
             @pointerup="onPanEnd" @pointerleave="onPanEnd" @click="onStageClick">
          <g :transform="`translate(${pan.x} ${pan.y}) scale(${zoom})`">
            <!-- 边：先画，永远在节点下面 -->
            <line v-for="e in renderedEdges" :key="e.key"
                  :x1="e.x1" :y1="e.y1" :x2="e.x2" :y2="e.y2"
                  :stroke-width="e.width" :stroke="e.color"
                  :stroke-opacity="e.opacity" :stroke-dasharray="e.dash || undefined"
                  class="gp-edge" />

            <!-- 节点 -->
            <g v-for="n in renderedNodes" :key="n.id" class="gp-node"
               :class="{ dim: n.dim, active: n.active }"
               :transform="`translate(${n.x} ${n.y})`"
               tabindex="0" role="button"
               :aria-label="`${n.label}，${n.degree} 条连接`"
               @pointerenter="hoveredId = n.id" @pointerleave="hoveredId = null"
               @click.stop="select(n.id)" @keydown.enter.stop="select(n.id)">
              <circle :r="n.r" :fill="n.color" :stroke="n.stroke" stroke-width="1.5" />
              <text v-if="n.showLabel" :y="n.r + 12" text-anchor="middle" class="gp-label">{{ n.label }}</text>
            </g>
          </g>
        </svg>

        <p v-if="!renderedNodes.length" class="gp-empty">
          当前条件下没有可展示的关联。把「关联强度」调低，或换一个分类看看。
        </p>

        <!-- 详情：选中一个站点后浮在右侧 -->
        <aside v-if="selected" class="gp-detail" aria-live="polite">
          <div class="gp-detail-head">
            <span class="gp-dot" :style="{ background: selected.color }" aria-hidden="true"></span>
            <div class="gp-detail-title">
              <h2 :title="selected.site.name">{{ selected.site.name || selected.site.url }}</h2>
              <p class="gp-domain">{{ selected.domain }}</p>
            </div>
            <button type="button" class="gp-close" aria-label="关闭详情" @click="selectedId = null">×</button>
          </div>

          <div class="gp-tags">
            <span v-if="selected.categoryLabel" class="gp-tag cat">{{ selected.categoryLabel }}</span>
            <span v-for="p in selected.purposes" :key="p.id" class="gp-tag"
                  :style="{ borderColor: p.color, color: p.color }">{{ p.label }}</span>
          </div>

          <label class="gp-focus">
            <input type="checkbox" :checked="focusOnly" @change="focusOnly = $event.target.checked">
            <span>只看它的邻居（{{ selected.neighbors.length }} 个）</span>
          </label>

          <h3 class="gp-detail-h">相关站点</h3>
          <ol v-if="selected.neighbors.length" class="gp-neighbors" role="list">
            <li v-for="nb in selected.neighbors" :key="nb.id">
              <button type="button" class="gp-nb" @click="select(nb.id)">
                <span class="gp-nb-top">
                  <span class="gp-dot sm" :style="{ background: nb.color }" aria-hidden="true"></span>
                  <span class="gp-nb-name" :title="nb.name">{{ nb.name }}</span>
                  <span class="gp-nb-score" :title="`关联度 ${nb.score}`">{{ nb.score }}</span>
                </span>
                <span class="gp-nb-reasons">{{ nb.reasons.join(' · ') }}</span>
              </button>
            </li>
          </ol>
          <p v-else class="gp-none">这一站暂时没有达到当前强度的关联。</p>
        </aside>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { PURPOSE_TAGS } from '../../shared/purposes.mjs'
import { buildAffinityGraph, DEFAULT_THRESHOLD } from '../../shared/affinity.mjs'
import { layoutGraph } from '@/utils/graphLayout'

/**
 * 关联图谱（v12）。
 *
 * 数据全部来自本地站点库 —— 这张图不需要联网：关联度是 `shared/affinity.mjs` 用
 * 分类 / 用途 / 描述概念词 / 注册域算出来的，每条边都自带可读理由。
 *
 * 性能上做对了两件事：
 *   1. 建图与布局都是**纯计算**（无响应式、无 DOM），一次 300 站约 120 ms；
 *      结果缓存在 computed 里，只有阈值 / 连接数 / 分类筛选变化时才重算。
 *   2. 缩放与平移只改外层 `<g>` 的 transform 字符串 —— 900 个图元的坐标不动，
 *      所以拖拽和滚轮不会触发上千次节点 diff。
 */

const W = 1400
const H = 900

const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()

onMounted(() => {
  // 站点库可能还没拉过（直接刷新 /graph 时 store 是空的），这里补一次
  if (!sitesStore.sites.length) sitesStore.refresh?.()
})

/* ---- 建图参数（滑块即时显示 draft，150 ms 防抖后才真正重算） ---- */

const draft = ref({ threshold: DEFAULT_THRESHOLD, topK: 6 })
const opts = ref({ threshold: DEFAULT_THRESHOLD, topK: 6 })
let commitTimer = null

function onDraft(key, e) {
  draft.value = { ...draft.value, [key]: Number(e.target.value) }
}
function commit() {
  clearTimeout(commitTimer)
  // 建图 + 布局合计约 200 ms；拖动时每次都算会让滑块发涩，等松手再算
  commitTimer = setTimeout(() => { opts.value = { ...draft.value } }, 150)
}
onBeforeUnmount(() => clearTimeout(commitTimer))

/* ---- 图数据 ---- */

const categoryFilter = ref('')

const categoryLabels = computed(() =>
  Object.fromEntries(categoriesStore.categories.map(c => [c.id, c.label])))
const purposeLabels = computed(() =>
  Object.fromEntries(PURPOSE_TAGS.map(t => [t.id, t.label])))
const colorOf = computed(() =>
  Object.fromEntries(categoriesStore.categories.map(c => [c.id, c.dotColor || 'var(--color-muted)'])))

const graph = computed(() => {
  const all = sitesStore.sites || []
  const list = categoryFilter.value
    ? all.filter(s => (s.categoryId || '') === categoryFilter.value)
    : all
  return buildAffinityGraph(list, {
    threshold: opts.value.threshold,
    topK: opts.value.topK,
    categoryLabels: categoryLabels.value,
    purposeLabels: purposeLabels.value,
  })
})

const layout = computed(() => layoutGraph(graph.value.nodes, graph.value.edges, { width: W, height: H }))

/* ---- 交互状态 ---- */

const selectedId = ref(null)
const hoveredId = ref(null)
const focusOnly = ref(false)

const zoom = ref(1)
const pan = ref({ x: 0, y: 0 })
const stageRef = ref(null)

/** 高亮锚点：鼠标悬停优先于已选中（悬停是「我正在看它」，更即时） */
const activeId = computed(() => hoveredId.value || selectedId.value)

const neighborIds = computed(() => {
  const id = activeId.value
  if (!id) return null
  return new Set((graph.value.byId.get(id) || []).map(e => e.id).concat(id))
})

const selected = computed(() => {
  const id = selectedId.value
  if (!id) return null
  const site = graph.value.nodes.find(s => s.id === id)
  if (!site) return null
  const nb = graph.value.byId.get(id) || []
  return {
    site,
    domain: domainOf(site.url),
    color: colorOf.value[site.categoryId] || 'var(--color-muted)',
    categoryLabel: categoryLabels.value[site.categoryId] || '',
    purposes: (site.purposes || []).map(p => ({
      id: p,
      label: purposeLabels.value[p] || p,
      color: PURPOSE_TAGS.find(t => t.id === p)?.color || 'var(--color-muted)',
    })),
    neighbors: nb.map(e => {
      const s = graph.value.nodes.find(x => x.id === e.id)
      return {
        id: e.id,
        name: s?.name || s?.url || e.id,
        score: e.score,
        reasons: e.reasons,
        color: colorOf.value[s?.categoryId] || 'var(--color-muted)',
      }
    }),
  }
})

/* ---- 渲染数据（坐标、颜色、明暗都在这里一次算好） ---- */

const visibleIds = computed(() => {
  if (!focusOnly.value || !selectedId.value) return null
  const set = new Set(graph.value.byId.get(selectedId.value)?.map(e => e.id) || [])
  set.add(selectedId.value)
  return set
})

const degreeOf = (id) => (graph.value.byId.get(id) || []).length

/**
 * 默认露名字的节点：按连接数取前 24 个。
 *
 * 不用「度数 ≥ N」这种绝对阈值 —— 300 站实测那样会一次放出 143 个标签，
 * 在 1400×900 的画布上必然互相压字。取**名额**而不是取阈值，标签密度就恒定可控；
 * 其余节点靠悬停 / 选中 / 「只看邻居」露名，看不到名字时看颜色和大小也够定位。
 */
const LABEL_SLOTS = 24
const labelIds = computed(() => new Set(
  graph.value.nodes
    .map(s => ({ id: s.id, d: degreeOf(s.id) }))
    .sort((a, b) => b.d - a.d)
    .slice(0, LABEL_SLOTS)
    .map(x => x.id)))

const renderedNodes = computed(() => {
  const pos = layout.value.positions
  const keep = visibleIds.value
  const nb = neighborIds.value
  const active = activeId.value
  const out = []
  for (const s of graph.value.nodes) {
    if (keep && !keep.has(s.id)) continue
    const p = pos.get(s.id)
    if (!p) continue
    const degree = degreeOf(s.id)
    const isActive = s.id === active
    const isNb = !!nb && nb.has(s.id)
    out.push({
      id: s.id,
      label: s.name || domainOf(s.url),
      x: p.x,
      y: p.y,
      r: 4.5 + Math.min(degree, 9) * 0.85,
      color: colorOf.value[s.categoryId] || 'var(--color-muted)',
      // 尺寸太小的话，高亮环反而看不清；给激活节点加一圈描边
      stroke: isActive ? '#0f172a' : 'rgba(255,255,255,.75)',
      degree,
      active: isActive,
      dim: !!active && !isNb,
      // 有高亮锚点时只给锚点与它的邻居露名（此时信息量最大）；没锚点时给前 24 个
      showLabel: isActive || (nb ? isNb : labelIds.value.has(s.id)),
    })
  }
  return out
})

const renderedEdges = computed(() => {
  const pos = layout.value.positions
  const keep = visibleIds.value
  const active = activeId.value
  const out = []
  for (const e of graph.value.edges) {
    if (keep && !(keep.has(e.source) && keep.has(e.target))) continue
    const a = pos.get(e.source)
    const b = pos.get(e.target)
    if (!a || !b) continue
    const touching = active && (e.source === active || e.target === active)
    out.push({
      key: `${e.source}|${e.target}`,
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      width: touching ? 1.4 + (e.score / 100) * 2.6 : 0.6 + (e.score / 100) * 1.8,
      color: touching ? '#1e40af' : 'var(--color-muted)',
      opacity: touching ? 0.85 : active ? 0.12 : 0.3,
      dash: touching ? null : null,
    })
  }
  return out
})

/* ---- 交互 ---- */

function select(id) {
  selectedId.value = selectedId.value === id ? null : id
  if (!selectedId.value) focusOnly.value = false
}

function onStageClick() {
  /**
   * 拖过画布之后浏览器还会补派一次 click（pointerdown + move + up 序列的自然结果）。
   * 那一次不该被当成「点击空白」—— 否则用户每拖一次视角，选中的站点就被顺手清掉了。
   */
  if (suppressClick) { suppressClick = false; return }
  // 点空白处取消选中（节点上的 click 已 stop）
  selectedId.value = null
  focusOnly.value = false
}

function resetView() {
  zoom.value = 1
  pan.value = { x: 0, y: 0 }
}

const WHEEL_MIN = 0.35
const WHEEL_MAX = 4

function onWheel(e) {
  const box = stageRef.value?.getBoundingClientRect()
  if (!box || !box.width) return
  // 把「画布像素 → viewBox 坐标」换算出来，作为缩放的锚点，
  // 否则缩放总是以左上角为原点，鼠标下的节点会跑掉
  const vx = (e.clientX - box.left) / box.width * W
  const vy = (e.clientY - box.top) / box.height * H
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
  const next = Math.min(WHEEL_MAX, Math.max(WHEEL_MIN, zoom.value * factor))
  const k = next / zoom.value
  pan.value = {
    x: vx - (vx - pan.value.x) * k,
    y: vy - (vy - pan.value.y) * k,
  }
  zoom.value = next
}

let drag = null
let suppressClick = false

function onPanStart(e) {
  // 只接主键拖拽；在节点上按下时不拖画布（避免「想点节点结果画布跑了」）
  if (e.button !== 0 || e.target.closest('.gp-node')) return
  drag = { x: e.clientX, y: e.clientY, px: pan.value.x, py: pan.value.y, moved: false }
  e.currentTarget.setPointerCapture?.(e.pointerId)
}

function onPanMove(e) {
  if (!drag) return
  const box = stageRef.value?.getBoundingClientRect()
  if (!box || !box.width) return
  const dx = (e.clientX - drag.x) / box.width * W
  const dy = (e.clientY - drag.y) / box.height * H
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) drag.moved = true
  pan.value = { x: drag.px + dx, y: drag.py + dy }
}

function onPanEnd(e) {
  if (!drag) return
  const moved = drag.moved
  drag = null
  e.currentTarget?.releasePointerCapture?.(e.pointerId)
  // 拖过画布就不算「点击空白」，否则一拖完就顺手把选中清掉了
  if (moved) suppressClick = true
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return String(url || '')
  }
}
</script>

<style scoped>
.graph-page { display: flex; flex-direction: column; height: 100%; min-height: 0; }

.gp-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 16px; flex-wrap: wrap; padding: 4px 4px 14px;
}
.gp-title { margin: 0; font-size: 20px; font-weight: 600; color: var(--text-primary); }
.gp-sub { margin: 6px 0 0; max-width: 62ch; font-size: 12px; line-height: 1.7; color: var(--text-secondary); }

.gp-controls { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.gp-ctl { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--text-secondary); }
.gp-ctl b { color: var(--text-primary); font-variant-numeric: tabular-nums; }
.gp-ctl input[type="range"] { width: 120px; accent-color: var(--accent); }
.gp-select {
  padding: 5px 8px; font-size: 12px; border-radius: var(--radius-sm);
  border: 1px solid var(--border); background: var(--bg-white); color: var(--text-primary);
}
.gp-btn {
  padding: 6px 12px; font-size: 12px; border-radius: var(--radius-sm);
  border: 1px solid var(--border); background: var(--bg-white); color: var(--text-secondary);
  cursor: pointer;
}
.gp-btn:hover { border-color: var(--accent); color: var(--accent); }

.gp-body { flex: 1; min-height: 0; display: flex; }
.gp-stage {
  position: relative; flex: 1; min-height: 420px;
  border: 1px solid var(--border); border-radius: var(--radius-md);
  background: var(--bg-white); overflow: hidden;
}
.gp-svg { width: 100%; height: 100%; display: block; cursor: grab; touch-action: none; }
.gp-svg:active { cursor: grabbing; }

.gp-edge { transition: stroke-opacity var(--dur-fast) ease; }
.gp-node { cursor: pointer; }
.gp-node circle { transition: opacity var(--dur-fast) ease; }
.gp-node.dim { opacity: .22; }
.gp-label {
  font-size: 11px; fill: var(--text-secondary); pointer-events: none;
  paint-order: stroke; stroke: var(--bg-white); stroke-width: 3px; stroke-linejoin: round;
}
.gp-node.active .gp-label { fill: var(--text-primary); font-weight: 600; }

.gp-empty {
  position: absolute; inset: 0; margin: 0; display: flex; align-items: center; justify-content: center;
  padding: 24px; text-align: center; font-size: 13px; color: var(--text-secondary);
}

.gp-detail {
  position: absolute; top: 12px; right: 12px; bottom: 12px; width: 300px;
  display: flex; flex-direction: column; gap: 10px; padding: 14px;
  border: 1px solid var(--border); border-radius: var(--radius-md);
  background: var(--bg-white); box-shadow: 0 8px 28px rgba(15, 23, 42, .12);
  overflow-y: auto;
}
.gp-detail-head { display: flex; align-items: flex-start; gap: 8px; }
.gp-detail-title { flex: 1; min-width: 0; }
.gp-detail-title h2 { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); overflow-wrap: anywhere; }
.gp-domain { margin: 2px 0 0; font-size: 11px; color: var(--text-secondary); overflow-wrap: anywhere; }
.gp-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 5px; }
.gp-dot.sm { width: 6px; height: 6px; margin-top: 0; }
.gp-close {
  border: none; background: none; cursor: pointer; font-size: 18px; line-height: 1;
  color: var(--text-secondary); padding: 0 2px;
}
.gp-close:hover { color: var(--text-primary); }

.gp-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.gp-tag {
  font-size: 10px; padding: 1px 7px; border-radius: 999px;
  border: 1px solid var(--border); color: var(--text-secondary);
}
.gp-tag.cat { background: var(--bg-subtle, #f1f5f9); color: var(--text-secondary); }

.gp-focus { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-secondary); cursor: pointer; }
.gp-focus input { accent-color: var(--accent); }

.gp-detail-h { margin: 4px 0 0; font-size: 12px; font-weight: 600; color: var(--text-primary); }
.gp-neighbors { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.gp-nb {
  width: 100%; text-align: left; display: flex; flex-direction: column; gap: 3px;
  padding: 7px 8px; border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--bg-white); cursor: pointer;
}
.gp-nb:hover { border-color: var(--accent); }
.gp-nb-top { display: flex; align-items: center; gap: 6px; }
.gp-nb-name { flex: 1; min-width: 0; font-size: 12px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gp-nb-score { font-size: 10px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.gp-nb-reasons { font-size: 10px; line-height: 1.5; color: var(--text-secondary); }
.gp-none { margin: 0; font-size: 11px; color: var(--text-secondary); }
</style>
