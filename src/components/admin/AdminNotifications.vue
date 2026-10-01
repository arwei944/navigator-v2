<template>
  <div class="ops-card">
    <div class="ops-head">
      <h3>通知中心 <span v-if="summary && summary.unread" class="notify-unread-badge">{{ summary.unread }} 未读</span></h3>
      <div class="ops-head-right">
        <button class="mini-btn" :disabled="!adminKey || loading" @click="markAllRead">全部已读</button>
        <button class="mini-btn danger" :disabled="!adminKey || loading" @click="clearAll">清空</button>
        <button class="mini-btn" :disabled="!adminKey || loading" @click="load">刷新</button>
      </div>
    </div>

    <div v-if="!adminKey" class="ops-empty">请先在上方输入管理密钥，再查看通知。</div>

    <template v-else>
      <div class="notify-summary" v-if="summary">
        <span class="ns-item bad">严重 <b>{{ summary.error }}</b></span>
        <span class="ns-item warn">注意 <b>{{ summary.warn }}</b></span>
        <span class="ns-item info">提示 <b>{{ summary.info }}</b></span>
      </div>

      <div class="notify-filters">
        <select v-model="filter.severity" class="mini-input" @change="load">
          <option value="">全部级别</option>
          <option value="error">严重</option>
          <option value="warn">注意</option>
          <option value="info">提示</option>
        </select>
        <input v-model="filter.q" class="mini-input grow" placeholder="搜索标题 / 正文 / 目标" @keyup.enter="load">
        <label class="mini-chk"><input type="checkbox" v-model="filter.unread" @change="load"> 只看未读</label>
        <button class="mini-btn" @click="load">查询</button>
      </div>

      <div v-if="loading" class="ops-empty">加载中…</div>
      <div v-else-if="error" class="ops-msg bad">{{ error }}</div>
      <div v-else-if="!items.length" class="ops-empty">暂无通知。发布、回滚、批量操作与巡检的事件都会汇到这里。</div>

      <div v-else class="notify-list">
        <div v-for="n in items" :key="n.id" class="notify-row" :class="[n.severity, { read: n.read }]">
          <span class="notify-dot" :class="n.severity"></span>
          <div class="notify-main">
            <div class="notify-line1">
              <span class="notify-title">{{ n.title || n.label }}</span>
              <span class="notify-kind">{{ n.label }}</span>
              <span v-if="!n.read" class="notify-new">未读</span>
            </div>
            <div v-if="n.body" class="notify-body">{{ n.body }}</div>
            <div v-if="n.action" class="notify-action">建议：{{ n.action }}</div>
          </div>
          <span class="notify-ts">{{ fmt(n.ts) }}</span>
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
const emit = defineEmits(['badge'])

const items = ref([])
const summary = ref(null)
const loading = ref(false)
const error = ref('')
const msg = ref('')
const msgBad = ref(false)
const filter = reactive({ severity: '', q: '', unread: false })

function fmt(ts) {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString('zh-CN')
}

async function load() {
  if (!props.adminKey) { items.value = []; summary.value = null; emit('badge', 0); return }
  loading.value = true
  error.value = ''
  try {
    const r = await opsApi.notifications(props.adminKey, {
      limit: 50,
      severity: filter.severity,
      q: filter.q,
      unread: filter.unread ? 1 : '',
    })
    items.value = r.items || []
    summary.value = r.summary || null
    emit('badge', summary.value?.unread || 0)
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function markAllRead() {
  try {
    await opsApi.markRead(props.adminKey, [])
    msgBad.value = false
    msg.value = '已全部标记为已读。'
    await load()
  } catch (e) {
    msgBad.value = true
    msg.value = e.message
  }
}

async function clearAll() {
  if (!window.confirm('清空全部通知？此操作不可撤销。')) return
  try {
    await opsApi.clearNotifications(props.adminKey)
    msgBad.value = false
    msg.value = '通知已清空。'
    await load()
  } catch (e) {
    msgBad.value = true
    msg.value = e.message
  }
}

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
.ops-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; gap: 12px; }
.ops-head h3 { font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.ops-head-right { display: flex; align-items: center; gap: 8px; }
.notify-unread-badge {
  font-size: 11px; font-weight: 700; color: #fff; background: #ef4444;
  padding: 1px 8px; border-radius: 10px;
}
.ops-empty { font-size: 13px; color: var(--text-secondary); padding: 8px 0; }
.ops-msg {
  margin-top: 12px; padding: 9px 12px; border-radius: var(--radius-sm);
  font-size: 12.5px; font-weight: 500;
  background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0;
}
.ops-msg.bad { background: #fef2f2; color: #dc2626; border-color: #fecaca; }
.notify-summary { display: flex; gap: 16px; margin-bottom: 12px; font-size: 12.5px; color: var(--text-secondary); }
.ns-item b { font-size: 14px; }
.ns-item.bad b { color: #dc2626; }
.ns-item.warn b { color: #b45309; }
.ns-item.info b { color: var(--accent); }
.notify-filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 12px; }
.mini-input {
  padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm);
  font-size: 13px; font-family: var(--font); color: var(--text-primary);
  background: var(--bg-white); outline: none;
}
.mini-input:focus { border-color: var(--accent); }
.mini-input.grow { flex: 1; min-width: 180px; }
.mini-chk { font-size: 12.5px; color: var(--text-secondary); display: flex; align-items: center; gap: 5px; }
.mini-btn {
  padding: 6px 14px; border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--bg-white); font-size: 13px; color: var(--text-primary); cursor: pointer;
}
.mini-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.mini-btn:disabled { opacity: .5; cursor: not-allowed; }
.mini-btn.danger:hover:not(:disabled) { border-color: #ef4444; color: #ef4444; }
.notify-list { display: flex; flex-direction: column; max-height: 360px; overflow-y: auto; }
.notify-row { display: flex; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--border-light); }
.notify-row:last-child { border-bottom: none; }
.notify-row.read { opacity: .55; }
.notify-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; flex-shrink: 0; }
.notify-dot.error { background: #ef4444; }
.notify-dot.warn { background: #f59e0b; }
.notify-dot.info { background: var(--accent); }
.notify-main { flex: 1; min-width: 0; }
.notify-line1 { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
.notify-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.notify-kind { font-size: 11px; color: var(--text-secondary); background: var(--border-light); padding: 1px 7px; border-radius: 10px; }
.notify-new { font-size: 10px; font-weight: 700; color: #fff; background: #ef4444; padding: 1px 6px; border-radius: 8px; }
.notify-body { margin-top: 3px; font-size: 12px; color: var(--text-secondary); word-break: break-all; }
.notify-action { margin-top: 3px; font-size: 11.5px; color: var(--accent); }
.notify-ts { font-size: 11.5px; color: var(--text-secondary); flex-shrink: 0; }
</style>