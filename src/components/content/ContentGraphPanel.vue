<script setup>
/**
 * 实体共现图谱。
 *
 * 布局在服务端算好（确定性），这里只负责画。节点多时只标注提及量前 14 个，
 * 避免文字互相压住；其余节点靠 hover 的 title 查看。
 */
import { computed, ref } from 'vue'

const props = defineProps({
  graph: { type: Object, default: () => ({ nodes: [], edges: [] }) },
})
const emit = defineEmits(['select'])

const hover = ref('')

const nodes = computed(() => props.graph.nodes || [])
const size = computed(() => props.graph.size || { width: 760, height: 420 })
const nameMap = computed(() => new Map(nodes.value.map(n => [n.id, n.name])))

const edges = computed(() => {
  const map = new Map(nodes.value.map(n => [n.id, n]))
  return (props.graph.edges || [])
    .map(e => ({ ...e, source: map.get(e.a), target: map.get(e.b) }))
    .filter(e => e.source && e.target)
})
const maxWeight = computed(() => Math.max(1, ...edges.value.map(e => Number(e.weight) || 0)))
const labeled = computed(() => new Set(
  [...nodes.value].sort((a, b) => b.count - a.count).slice(0, 14).map(n => n.id),
))

// 只用主题令牌，不引入新的裸色值（test-visual-layer 会守住这条）
const KIND_COLORS = {
  company: 'var(--accent)',
  tech: 'var(--success)',
  asset: 'var(--warning)',
  person: 'var(--danger)',
  regulator: 'var(--text-secondary)',
  regulation: 'var(--success)',
  protocol: 'var(--accent)',
}
const LEGEND = [
  ['company', '公司'],
  ['tech', '技术'],
  ['asset', '资产'],
  ['person', '人物'],
  ['regulator', '监管'],
  ['regulation', '法规'],
  ['protocol', '协议'],
]

function kindColor(kind) {
  return KIND_COLORS[kind] || '#64748b'
}

function nameOf(id) {
  return nameMap.value.get(id) || id
}

function edgeWidth(edge) {
  return 0.6 + 2.6 * ((Number(edge.weight) || 0) / maxWeight.value)
}

function edgeOpacity(edge) {
  return 0.16 + 0.44 * ((Number(edge.weight) || 0) / maxWeight.value)
}
</script>

<template>
  <div class="cg">
    <p v-if="!nodes.length" class="cg-empty">
      还没有足够的共现关系。需要至少两个实体同时出现在多条报道中（默认共现 ≥ 2 次）。
    </p>
    <template v-else>
      <div class="cg-canvas">
        <svg :viewBox="`0 0 ${size.width} ${size.height}`" role="img" aria-label="实体共现图谱">
          <g class="cg-edges">
            <line
              v-for="(edge, i) in edges" :key="`${edge.a}-${edge.b}-${i}`"
              :x1="edge.source.x" :y1="edge.source.y" :x2="edge.target.x" :y2="edge.target.y"
              :stroke-width="edgeWidth(edge)" :stroke-opacity="edgeOpacity(edge)"
              :class="{ hot: hover === edge.a || hover === edge.b }"
            />
          </g>
          <g class="cg-nodes">
            <g
              v-for="node in nodes" :key="node.id"
              :transform="`translate(${node.x},${node.y})`"
              class="cg-node" :class="{ dim: hover && hover !== node.id }"
              @mouseenter="hover = node.id" @mouseleave="hover = ''"
              @click="emit('select', node)"
            >
              <circle :r="node.r" :style="{ fill: kindColor(node.kind) }" />
              <text v-if="labeled.has(node.id)" :y="node.r + 13" text-anchor="middle">
                {{ node.name }}
              </text>
              <title>{{ node.name }} · {{ node.count }} 次提及 · {{ node.kind }}</title>
            </g>
          </g>
        </svg>
      </div>

      <div class="cg-legend">
        <span v-for="[kind, label] in LEGEND" :key="kind">
          <i :style="{ background: kindColor(kind) }"></i>{{ label }}
        </span>
      </div>

      <div class="cg-pairs">
        <h4>最强关联</h4>
        <ul>
          <li v-for="edge in (graph.edges || []).slice(0, 8)" :key="`${edge.a}-${edge.b}`">
            <b>{{ nameOf(edge.a) }}</b>
            <span class="cg-arrow">↔</span>
            <b>{{ nameOf(edge.b) }}</b>
            <span class="cg-meta">共现 {{ edge.co }} 次 · {{ edge.sources }} 个来源</span>
          </li>
        </ul>
        <p v-if="!(graph.edges || []).length" class="cg-empty">暂无共现边。</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.cg-canvas {
  border: 1px solid var(--border);
  border-radius: 10px;
  background:
    radial-gradient(circle at 30% 20%, color-mix(in srgb, var(--accent) 7%, transparent), transparent 60%),
    var(--bg-elevated, transparent);
  overflow: hidden;
}
.cg-canvas svg { display: block; width: 100%; height: auto; }
.cg-edges line { stroke: var(--accent); transition: stroke-opacity var(--dur-fast); }
.cg-edges line.hot { stroke: var(--warning, #b45309); stroke-opacity: .9; }
.cg-node { cursor: pointer; transition: opacity var(--dur-fast); }
.cg-node.dim { opacity: .35; }
.cg-node circle { stroke: var(--bg); stroke-width: 2; }
.cg-node:hover circle { stroke: var(--text); }
.cg-node text {
  font-size: 11px;
  fill: var(--text);
  paint-order: stroke;
  stroke: var(--bg);
  stroke-width: 3;
  stroke-linejoin: round;
}
.cg-legend { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; font-size: 11.5px; color: var(--text-secondary); }
.cg-legend span { display: inline-flex; align-items: center; gap: 5px; }
.cg-legend i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.cg-pairs { margin-top: 14px; }
.cg-pairs h4 { margin: 0 0 6px; font-size: 13px; }
.cg-pairs ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.cg-pairs li { font-size: 12.5px; display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.cg-arrow { color: var(--text-secondary); }
.cg-meta { margin-left: auto; color: var(--text-secondary); font-size: 11.5px; }
.cg-empty { padding: 28px 12px; text-align: center; color: var(--text-secondary); font-size: 13px; }
@media (max-width: 640px) {
  .cg-meta { margin-left: 0; width: 100%; }
}
</style>
