<template>
  <div class="ops-card">
    <div class="ops-head">
      <h3>操作审计日志</h3>
      <div class="ops-head-right">
        <span v-if="summary" class="audit-total">共 {{ summary.total }} 条</span>
        <button class="mini-btn" :disabled="loading || !adminKey" @click="load">刷新</button>
      </div>
    </div>

    <div v-if="!adminKey" class="ops-empty">请先在上方输入管理密钥，再查看操作审计日志。</div>

    <template v-else>
      <div v-if="summary" class="audit-summary">
        <span class="as-item">总计 <b>{{ summary.total }}</b></span>
        <span class="as-item" :class="{ bad: summary.failures > 0 }">异常 <b>{{ summary.failures }}</b></span>
        <span class="as-item" v-if="summary.lastAt">最近 <b>{{ fmt(summary.lastAt) }}</b></span>
        <span class="as-item" v-if="summary.lastApprove">最近放行 <b>{{ summary.lastApprove.target || summary.lastApprove.action }}</b></span>
      </div>

      <div class="audit-filters">
        <select v-model="filter.action" class="mini-input" @change="applyFilter">
          <option value="">全部动作</option>
          <option v-for="a in actions" :key="a.value" :value="a.value">{{ a.label }}</option>
        </select>
        <select v-model="filter.result" class="mini-input" @change="applyFilter">
          <option value="">全部结果</option>
          <option v-for="(label, key) in results" :key="key" :value="key">{{ label }}</option>
        </select>
        <input v-model="filter.q" class="mini-input grow" placeholder="搜索动作 / 目标 / 详情" @keyup.enter="applyFilter">
        <button class="mini-btn" @click="load">查询</button>
        <button v-if="isFiltering" class="mini-btn" @click="resetFilter">重置</button>
      </div>

      <div v-if="loading" class="ops-empty">加载中…</div>
      <div v-else-if="error" class="ops-msg bad">{{ error }}</div>
      <div v-else-if="!items.length" class="ops-empty">
        {{ isFiltering ? '没有匹配的审计记录。' : '暂无审计记录。发布、回滚、站点与分类改动都会在这里留痕。' }}
      </div>

      <template v-else>
        <div class="audit-list">
          <div v-for="(e, i) in paged" :key="e.ts + '-' + i" class="audit-row">
            <span class="audit-mark" :class="e.result">{{ MARK[e.result] || '•' }}</span>
            <div class="audit-main">
              <div class="audit-line1">
                <span class="audit-action">{{ labelOf(e.action) }}</span>
                <span v-if="e.target" class="audit-target">{{ e.target }}</span>
                <span class="audit-ts">{{ fmt(e.ts) }}</span>
              </div>
              <div v-if="e.detail" class="audit-detail">{{ e.detail }}</div>
            </div>
            <span class="audit-actor">{{ e.actor }}</span>
          </div>
        </div>

        <div class="audit-pager">
          <span>命中 {{ filteredCount }} 条 · 第 {{ page }} / {{ totalPages }} 页</span>
          <button class="mini-btn" :disabled="page <= 1" @click="page--">上一页</button>
          <button class="mini-btn" :disabled="page >= totalPages" @click="page++">下一页</button>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { opsApi } from '@/services/opsApi'

const props = defineProps({ adminKey: { type: String, default: '' } })

const MARK = { ok: '✓', fail: '✗', rejected: '⊘' }
const FETCH_LIMIT = 500
const PAGE_SIZE = 30

const items = ref([])
const summary = ref(null)
const actions = ref([])
const results = ref({})
const actionLabels = ref({})
const loading = ref(false)
const error = ref('')
const filter = reactive({ action: '', result: '', q: '' })
const page = ref(1)

const isFiltering = computed(() => Boolean(filter.action || filter.result || filter.q.trim()))

/** 过滤在服务端完成（口径与本地控制台一致），分页在客户端做：一次取回上限内全部命中再切片 */
const filteredCount = computed(() => items.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(items.value.length / PAGE_SIZE)))
const paged = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE
  return items.value.slice(start, start + PAGE_SIZE)
})

function labelOf(key) {
  return actionLabels.value[key] || key
}

function fmt(ts) {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString('zh-CN')
}

async function load() {
  if (!props.adminKey) { items.value = []; summary.value = null; return }
  loading.value = true
  error.value = ''
  try {
    const r = await opsApi.audit(props.adminKey, {
      limit: FETCH_LIMIT,
      action: filter.action,
      result: filter.result,
      q: filter.q.trim(),
    })
    items.value = r.items || []
    summary.value = r.summary || null
    actions.value = r.actions || []
    results.value = r.results || {}
    actionLabels.value = r.actionLabels || {}
    page.value = 1
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

function applyFilter() {
  load()
}

function resetFilter() {
  filter.action = ''
  filter.result = ''
  filter.q = ''
  load()
}

watch(totalPages, (tp) => { if (page.value > tp) page.value = tp })

/** 供父组件在发布 / 回滚 / 分类改动后触发刷新 */
defineExpose({ reload: load })

onMounted(load)
watch(() => props.adminKey, load)
</script>

<style scoped>
.ops-card { background: var(--bg-white); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 20px; }
.ops-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.ops-head h3 { font-size: 15px; font-weight: 600; }
.ops-head-right { display: flex; align-items: center; gap: 10px; }
.audit-total { font-size: 12.5px; color: var(--text-secondary); }
.ops-empty { font-size: 13px; color: var(--text-secondary); padding: 8px 0; }
.ops-msg { margin-top: 12px; padding: 9px 12px; border-radius: var(--radius-sm); font-size: 12.5px; font-weight: 500; background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; }
.ops-msg.bad { background: #fef2f2; color: #dc2626; border-color: #fecaca; }
.audit-summary { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 12px; font-size: 12.5px; color: var(--text-secondary); }
.as-item b { color: var(--text-primary); font-size: 14px; }
.as-item.bad b { color: #dc2626; }
.audit-filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.mini-input {
  padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 13px;
  font-family: var(--font); color: var(--text-primary); background: var(--bg-white); outline: none;
}
.mini-input:focus { border-color: var(--accent); }
.mini-input.grow { flex: 1; min-width: 180px; }
.mini-btn {
  padding: 6px 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-white);
  font-size: 13px; color: var(--text-primary); cursor: pointer;
}
.mini-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.mini-btn:disabled { opacity: .5; cursor: not-allowed; }
.audit-list { display: flex; flex-direction: column; max-height: 420px; overflow-y: auto; }
.audit-row { display: flex; gap: 10px; align-items: flex-start; padding: 8px 0; border-bottom: 1px solid var(--border-light); }
.audit-row:last-child { border-bottom: none; }
.audit-mark { width: 18px; flex-shrink: 0; font-weight: 700; }
.audit-mark.ok { color: #059669; }
.audit-mark.fail { color: #dc2626; }
.audit-mark.rejected { color: #b45309; }
.audit-main { flex: 1; min-width: 0; }
.audit-line1 { display: flex; flex-wrap: wrap; gap: 10px; align-items: baseline; font-size: 13px; }
.audit-action { font-weight: 600; color: var(--text-primary); }
.audit-target { font-size: 12px; color: var(--accent); background: var(--accent-light); padding: 1px 8px; border-radius: 10px; }
.audit-ts { font-size: 12px; color: var(--text-secondary); margin-left: auto; }
.audit-detail { margin-top: 3px; font-size: 12px; color: var(--text-secondary); word-break: break-all; }
.audit-actor { flex-shrink: 0; font-size: 11px; color: var(--text-disabled); }
.audit-pager { display: flex; align-items: center; gap: 10px; margin-top: 12px; font-size: 12.5px; color: var(--text-secondary); }
.audit-pager span { margin-right: auto; }
</style>