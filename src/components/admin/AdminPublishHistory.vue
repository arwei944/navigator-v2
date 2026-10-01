<template>
  <div class="ops-card">
    <div class="ops-head">
      <h3>发布历史</h3>
      <div class="ops-head-right">
        <button class="mini-btn" :disabled="loading || !adminKey" @click="load">刷新</button>
      </div>
    </div>

    <div v-if="!adminKey" class="ops-empty">请先在上方输入管理密钥，再查看发布历史。</div>

    <template v-else>
      <div class="hist-summary" v-if="summary">
        <span class="hs-item">共 <b>{{ summary.total }}</b> 次</span>
        <span class="hs-item ok">成功 <b>{{ summary.ok }}</b></span>
        <span class="hs-item bad">失败 <b>{{ summary.failed }}</b></span>
        <span class="hs-item" v-if="summary.successRate !== null">成功率 <b>{{ summary.successRate }}%</b></span>
        <span class="hs-item" v-if="summary.avgDuration">平均耗时 <b>{{ sec(summary.avgDuration) }}</b></span>
      </div>

      <div class="hist-filters">
        <select v-model="filter.ok" class="mini-input" @change="load">
          <option value="">全部结果</option>
          <option value="ok">仅成功</option>
          <option value="fail">仅失败</option>
        </select>
        <select v-model="filter.trigger" class="mini-input" @change="load">
          <option value="">全部来源</option>
          <option v-for="(label, key) in triggers" :key="key" :value="key">{{ label }}</option>
        </select>
        <input v-model="filter.q" class="mini-input grow" placeholder="搜索提交信息 / 失败原因 / 备注" @keyup.enter="load">
        <button class="mini-btn" @click="load">查询</button>
      </div>

      <div v-if="loading" class="ops-empty">加载中…</div>
      <div v-else-if="error" class="ops-msg bad">{{ error }}</div>
      <div v-else-if="!items.length" class="ops-empty">暂无发布记录。从本页或本地控制台发布后，这里会留下痕迹。</div>

      <div v-else class="hist-list">
        <div v-for="r in items" :key="r.id" class="hist-row" :class="{ bad: !r.ok }">
          <span class="hist-mark" :class="r.ok ? 'ok' : 'bad'">{{ r.ok ? '✓' : '✗' }}</span>
          <div class="hist-main">
            <div class="hist-line1">
              <span class="hist-ts">{{ fmt(r.ts) }}</span>
              <span class="hist-trigger">{{ triggers[r.trigger] || r.trigger }}</span>
              <span v-if="r.cloud" class="hist-cloud">v{{ r.cloud.version }} · {{ r.cloud.count }} 站点</span>
              <span v-if="r.duration" class="hist-dur">{{ sec(r.duration) }}</span>
            </div>
            <div v-if="!r.ok && r.reason" class="hist-reason">失败：{{ r.reason }}</div>
            <div v-if="r.note" class="hist-note">{{ r.note }}</div>
            <div v-if="r.deployment?.url" class="hist-note">部署：{{ r.deployment.url }}</div>
          </div>
        </div>
      </div>
    </template>

    <div v-if="msg" class="ops-msg" :class="{ bad: msgBad }">{{ msg }}</div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref, watch } from 'vue'
import { opsApi } from '@/services/opsApi'

const props = defineProps({ adminKey: { type: String, default: '' } })
const emit = defineEmits(['loaded'])

const items = ref([])
const summary = ref(null)
const triggers = ref({})
const loading = ref(false)
const error = ref('')
const msg = ref('')
const msgBad = ref(false)
const filter = reactive({ ok: '', trigger: '', q: '' })

function fmt(ts) {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString('zh-CN')
}
function sec(ms) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

async function load() {
  if (!props.adminKey) { items.value = []; summary.value = null; return }
  loading.value = true
  error.value = ''
  try {
    const r = await opsApi.history(props.adminKey, { limit: 30, ...filter })
    items.value = r.items || []
    summary.value = r.summary || null
    triggers.value = r.triggers || {}
    emit('loaded', r)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

/** 供父组件在发布/回滚后触发刷新 */
defineExpose({ reload: load })

onMounted(load)
watch(() => props.adminKey, load)
</script>

<style scoped>
.ops-card {
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px 20px;
}
.ops-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.ops-head h3 { font-size: 15px; font-weight: 600; }
.ops-head-right { display: flex; align-items: center; gap: 10px; }
.ops-empty { font-size: 13px; color: var(--text-secondary); padding: 8px 0; }
.ops-msg {
  margin-top: 12px; padding: 9px 12px; border-radius: var(--radius-sm);
  font-size: 12.5px; font-weight: 500;
  background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0;
}
.ops-msg.bad { background: #fef2f2; color: #dc2626; border-color: #fecaca; }
.hist-summary { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 12px; font-size: 12.5px; color: var(--text-secondary); }
.hs-item b { color: var(--text-primary); font-size: 14px; }
.hs-item.ok b { color: #059669; }
.hs-item.bad b { color: #dc2626; }
.hist-filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.mini-input {
  padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm);
  font-size: 13px; font-family: var(--font); color: var(--text-primary);
  background: var(--bg-white); outline: none;
}
.mini-input:focus { border-color: var(--accent); }
.mini-input.grow { flex: 1; min-width: 180px; }
.mini-btn {
  padding: 6px 14px; border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--bg-white); font-size: 13px; color: var(--text-primary); cursor: pointer;
}
.mini-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.mini-btn:disabled { opacity: .5; cursor: not-allowed; }
.hist-list { display: flex; flex-direction: column; max-height: 360px; overflow-y: auto; }
.hist-row { display: flex; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--border-light); }
.hist-row:last-child { border-bottom: none; }
.hist-mark { width: 18px; flex-shrink: 0; font-weight: 700; }
.hist-mark.ok { color: #059669; }
.hist-mark.bad { color: #dc2626; }
.hist-main { flex: 1; min-width: 0; }
.hist-line1 { display: flex; flex-wrap: wrap; gap: 10px; align-items: baseline; font-size: 13px; }
.hist-ts { color: var(--text-secondary); }
.hist-trigger { font-size: 11px; font-weight: 600; color: var(--accent); background: var(--accent-light); padding: 1px 8px; border-radius: 10px; }
.hist-cloud { font-size: 12px; color: var(--text-primary); font-weight: 600; }
.hist-dur { font-size: 12px; color: var(--text-secondary); }
.hist-reason { margin-top: 3px; font-size: 12px; color: #dc2626; }
.hist-note { margin-top: 3px; font-size: 12px; color: var(--text-secondary); word-break: break-all; }
</style>