<template>
  <div class="ops-card">
    <div class="ops-head">
      <h3>云端快照与回滚</h3>
      <div class="ops-head-right">
        <span v-if="loaded" class="ops-dim">共 {{ count }} 份 · 保留最近 {{ keep }} 份</span>
        <button class="mini-btn" :disabled="loading || !adminKey" @click="load">刷新</button>
      </div>
    </div>

    <p class="ops-desc">
      每次热更新前，云端都会把「将被覆盖的数据」另存为快照。回滚即把指定快照写回主数据，版本号继续递增（不回退计数），因此回滚本身也可再被回滚。
    </p>

    <div v-if="!adminKey" class="ops-empty">请先在上方输入管理密钥，再查看快照。</div>
    <div v-else-if="loading" class="ops-empty">加载中…</div>
    <div v-else-if="error" class="ops-msg bad">{{ error }}</div>
    <div v-else-if="!items.length" class="ops-empty">暂无快照。首次发布之后才会产生第一份。</div>

    <div v-else class="snap-list">
      <div v-for="s in items" :key="s.pathname" class="snap-row">
        <span class="snap-ver">v{{ s.version }}</span>
        <span class="snap-ts">{{ fmt(s.ts) }}</span>
        <span class="snap-size">{{ kb(s.size) }}</span>
        <button class="mini-btn danger" :disabled="rolling === s.pathname" @click="rollback(s)">
          {{ rolling === s.pathname ? '回滚中…' : '回滚到此版本' }}
        </button>
      </div>
    </div>

    <div v-if="msg" class="ops-msg" :class="{ bad: msgBad }">{{ msg }}</div>
  </div>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue'
import { opsApi } from '@/services/opsApi'

const props = defineProps({ adminKey: { type: String, default: '' } })
const emit = defineEmits(['rolled'])

const items = ref([])
const count = ref(0)
const keep = ref(0)
const loaded = ref(false)
const loading = ref(false)
const error = ref('')
const rolling = ref('')
const msg = ref('')
const msgBad = ref(false)

function fmt(ts) {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString('zh-CN')
}

function kb(size) {
  return size >= 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size || 0} B`
}

async function load() {
  if (!props.adminKey) { items.value = []; loaded.value = false; return }
  loading.value = true
  error.value = ''
  try {
    const r = await opsApi.snapshots(props.adminKey)
    items.value = r.snapshots || []
    count.value = r.count || items.value.length
    keep.value = r.keep || 0
    loaded.value = true
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function rollback(snap) {
  if (!window.confirm(`回滚到 v${snap.version}（${fmt(snap.ts)}）？\n\n云端数据将被替换为该快照内容，版本号会继续递增。`)) return
  rolling.value = snap.pathname
  msg.value = ''
  try {
    const data = await opsApi.rollback(props.adminKey, snap.pathname)
    msgBad.value = false
    msg.value = `已回滚到 v${snap.version}，当前云端版本 v${data.version}（${data.sites?.length || 0} 站点）。`
    emit('rolled', data)
    // 运维面记录失败不影响回滚结果本身
    recordRollback(snap, data)
    await load()
  } catch (e) {
    msgBad.value = true
    msg.value = `回滚失败：${e.message}`
  } finally {
    rolling.value = ''
  }
}

function recordRollback(snap, data) {
  opsApi.appendHistory(props.adminKey, {
    runner: 'cloud',
    trigger: 'admin',
    ok: true,
    reason: '',
    steps: [{ key: 'hotupdate', label: 'Blob 热更新', status: 'success', detail: `回滚到 v${snap.version}` }],
    cloud: { version: data.version, count: data.sites?.length || 0, previousVersion: data.previousVersion || 0 },
    snapshot: { pathname: snap.pathname, ok: true },
    note: `回滚到 v${snap.version}`,
  }).catch(() => {})
  opsApi.pushNotification(props.adminKey, {
    kind: 'rollback.done',
    title: `云端已回滚到 v${snap.version}`,
    body: `当前版本 v${data.version} · ${data.sites?.length || 0} 站点`,
    meta: { from: snap.pathname, version: data.version },
  }).catch(() => {})
}

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
.ops-dim { font-size: 12px; color: var(--text-secondary); }
.ops-desc { font-size: 12.5px; color: var(--text-secondary); line-height: 1.6; margin-bottom: 12px; }
.ops-empty { font-size: 13px; color: var(--text-secondary); padding: 8px 0; }
.ops-msg {
  margin-top: 12px;
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  font-size: 12.5px;
  font-weight: 500;
  background: #ecfdf5;
  color: #059669;
  border: 1px solid #a7f3d0;
}
.ops-msg.bad { background: #fef2f2; color: #dc2626; border-color: #fecaca; }
.snap-list { display: flex; flex-direction: column; max-height: 320px; overflow-y: auto; }
.snap-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border-light);
  font-size: 13px;
}
.snap-row:last-child { border-bottom: none; }
.snap-ver { font-weight: 700; color: var(--accent); min-width: 52px; }
.snap-ts { flex: 1; color: var(--text-secondary); }
.snap-size { font-size: 12px; color: var(--text-secondary); font-family: monospace; min-width: 64px; text-align: right; }
.mini-btn {
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-white);
  font-size: 12.5px;
  color: var(--text-primary);
  cursor: pointer;
}
.mini-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.mini-btn:disabled { opacity: .5; cursor: not-allowed; }
.mini-btn.danger:hover:not(:disabled) { border-color: #ef4444; color: #ef4444; }
</style>