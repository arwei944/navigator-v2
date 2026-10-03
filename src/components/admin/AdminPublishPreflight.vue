<template>
  <div class="ops-card">
    <div class="ops-head">
      <h3>发布预检与变更摘要</h3>
      <div class="ops-head-right">
        <span v-if="sitesStore.cloudVersion" class="pf-cloud">云端 v{{ sitesStore.cloudVersion }}</span>
        <span class="pf-summary" :class="result.ok ? 'ok' : 'bad'">{{ result.summary }}</span>
        <button class="mini-btn" @click="runPreflight">重新预检</button>
      </div>
    </div>

    <div class="pf-block">
      <div v-for="b in result.blockers" :key="b.code" class="pf-item bad">
        <span class="pf-tag">阻断</span><span>{{ b.message }}</span>
      </div>
      <div v-for="w in result.warnings" :key="w.code" class="pf-item warn">
        <span class="pf-tag">提示</span><span>{{ w.message }}</span>
      </div>
      <div v-if="!result.blockers.length && !result.warnings.length" class="pf-item ok">
        <span class="pf-tag">通过</span><span>未发现风险项，可以发布。</span>
      </div>
    </div>

    <div class="pf-cols">
      <div class="pf-col">
        <h4>站点变更</h4>
        <div v-if="!siteChanged" class="pf-none">无改动</div>
        <template v-else>
          <div v-if="result.sites.added.length" class="pf-line">
            <span class="pf-key add">新增 {{ result.sites.added.length }}</span>
            <span class="pf-vals">{{ result.sites.added.map(s => `${s.id} ${s.name}`).join('、') }}</span>
          </div>
          <div v-if="result.sites.removed.length" class="pf-line">
            <span class="pf-key del">移除 {{ result.sites.removed.length }}</span>
            <span class="pf-vals">{{ result.sites.removed.map(s => `${s.id} ${s.name}`).join('、') }}</span>
          </div>
          <div v-if="result.sites.modified.length" class="pf-line">
            <span class="pf-key mod">更新 {{ result.sites.modified.length }}</span>
            <span class="pf-vals">
              {{ result.sites.modified.map(m => `${m.id}（${m.labels.join('/')}）`).join('、') }}
            </span>
          </div>
        </template>
        <div class="pf-foot">发布后共 {{ result.sites.total }} 个站点</div>
      </div>

      <div class="pf-col">
        <h4>分类表变更</h4>
        <div v-if="!result.categories.total" class="pf-none">无改动</div>
        <template v-else>
          <div v-if="result.categories.groupsAdded.length" class="pf-line">
            <span class="pf-key add">新增域</span>
            <span class="pf-vals">{{ result.categories.groupsAdded.map(g => g.label).join('、') }}</span>
          </div>
          <div v-if="result.categories.groupsRemoved.length" class="pf-line">
            <span class="pf-key del">移除域</span>
            <span class="pf-vals">{{ result.categories.groupsRemoved.map(g => g.label).join('、') }}</span>
          </div>
          <div v-if="result.categories.groupsRenamed.length" class="pf-line">
            <span class="pf-key mod">重命名域</span>
            <span class="pf-vals">{{ result.categories.groupsRenamed.map(g => `${g.from}→${g.to}`).join('、') }}</span>
          </div>
          <div v-if="result.categories.catsAdded.length" class="pf-line">
            <span class="pf-key add">新增分类</span>
            <span class="pf-vals">{{ result.categories.catsAdded.map(c => c.label).join('、') }}</span>
          </div>
          <div v-if="result.categories.catsRemoved.length" class="pf-line">
            <span class="pf-key del">移除分类</span>
            <span class="pf-vals">{{ result.categories.catsRemoved.map(c => c.label).join('、') }}</span>
          </div>
          <div v-if="result.categories.catsUpdated.length" class="pf-line">
            <span class="pf-key mod">编辑分类</span>
            <span class="pf-vals">{{ result.categories.catsUpdated.map(c => `${c.label}（${fieldText(c.fields)}）`).join('、') }}</span>
          </div>
          <div v-if="result.categories.catsMoved.length" class="pf-line">
            <span class="pf-key mod">迁移分类</span>
            <span class="pf-vals">{{ result.categories.catsMoved.map(c => `${c.label}（${c.from}→${c.to}）`).join('、') }}</span>
          </div>
          <div v-if="result.categories.reordered" class="pf-line">
            <span class="pf-key mod">顺序调整</span>
            <span class="pf-vals">域内分类顺序有变化</span>
          </div>
        </template>
        <div class="pf-foot">线上将执行：{{ planText }}</div>
      </div>
    </div>

    <div v-if="lastRunAt" class="pf-ran">最近预检 {{ fmt(lastRunAt) }}</div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { preflightPublish } from '../../../shared/ops/preflight.mjs'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { recordAudit } from '@/services/auditLog'

const props = defineProps({ adminKey: { type: String, default: '' } })
const emit = defineEmits(['verdict'])

const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()

const lastRunAt = ref(0)

const FIELD_TEXT = { label: '名称', dotColor: '配色', group: '所属域' }
function fieldText(fields) {
  return fields.map(f => FIELD_TEXT[f] || f).join('/')
}

const result = computed(() => preflightPublish({
  cloudSites: sitesStore.cloudSites,
  sites: sitesStore.sites,
  cloudGroups: categoriesStore.cloudGroups || [],
  groups: categoriesStore.groups,
  hasKey: Boolean(props.adminKey),
}))

const siteChanged = computed(() =>
  result.value.sites.added.length + result.value.sites.removed.length + result.value.sites.modified.length > 0
)

const planText = computed(() => result.value.plan.map(s => s.label).join(' → '))

function fmt(ts) {
  return new Date(ts).toLocaleString('zh-CN')
}

/** 预检是只读动作：结果实时随数据变化，审计只在显式点击时留痕 */
function runPreflight() {
  const r = result.value
  lastRunAt.value = Date.now()
  recordAudit('gate.preflight', {
    target: `v${sitesStore.cloudVersion || 0}`,
    result: r.ok ? 'ok' : 'rejected',
    detail: r.summary,
  })
  if (r.ok && r.changed) {
    recordAudit('gate.approve', { target: `v${sitesStore.cloudVersion || 0}`, detail: r.summary })
  } else if (!r.ok) {
    recordAudit('gate.reject', {
      target: `v${sitesStore.cloudVersion || 0}`,
      result: 'rejected',
      detail: r.blockers.map(b => b.message).join('；'),
    })
  }
}

// 门禁必须实时：数据一变就重算并把结论推给父组件，发布按钮据此启停。
// 否则用户改了数据却忘了点「重新预检」，按钮还停在旧结论上。
watch(result, (r) => emit('verdict', r), { immediate: true })

defineExpose({ run: runPreflight })
</script>

<style scoped>
.ops-card { background: var(--bg-white); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 20px; }
.ops-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.ops-head h3 { font-size: 15px; font-weight: 600; }
.ops-head-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pf-cloud { font-size: 12px; color: var(--text-secondary); }
.pf-summary { font-size: 12.5px; font-weight: 600; }
.pf-summary.ok { color: #059669; }
.pf-summary.bad { color: #dc2626; }
.mini-btn {
  padding: 6px 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-white);
  font-size: 13px; color: var(--text-primary); cursor: pointer;
}
.mini-btn:hover { border-color: var(--accent); color: var(--accent); }
.pf-block { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.pf-item { display: flex; gap: 8px; align-items: flex-start; font-size: 12.5px; padding: 8px 12px; border-radius: var(--radius-sm); line-height: 1.6; }
.pf-item.bad { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
.pf-item.warn { background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
.pf-item.ok { background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; }
.pf-tag { flex-shrink: 0; font-weight: 700; }
.pf-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.pf-col h4 { font-size: 13px; font-weight: 600; margin-bottom: 8px; color: var(--text-primary); }
.pf-none { font-size: 12.5px; color: var(--text-secondary); }
.pf-line { display: flex; gap: 8px; font-size: 12.5px; line-height: 1.8; align-items: baseline; }
.pf-key { flex-shrink: 0; font-weight: 600; }
.pf-key.add { color: #059669; }
.pf-key.del { color: #dc2626; }
.pf-key.mod { color: #b45309; }
.pf-vals { color: var(--text-secondary); word-break: break-all; }
.pf-foot { margin-top: 8px; font-size: 12px; color: var(--text-disabled); }
.pf-ran { margin-top: 12px; font-size: 12px; color: var(--text-disabled); }
@media (max-width: 900px) { .pf-cols { grid-template-columns: 1fr; } }
</style>