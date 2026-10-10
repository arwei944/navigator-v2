<template>
  <section class="settings-section">
    <div class="section-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      <span>数据管理</span>
    </div>
    <div class="setting-row">
      <button class="data-btn" @click="$emit('open-import')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        导入 / 导出书签
      </button>
    </div>
    <div class="setting-row">
      <div class="data-info">
        <span class="data-info-label">当前数据</span>
        <span class="data-info-value">{{ sites.sites.length }} 个站点 · {{ categories.categories.length }} 个分类</span>
      </div>
    </div>
    <div class="setting-row">
      <div class="data-info">
        <span class="data-info-label">云端会话同步</span>
        <span class="data-info-value">用同一串密钥在不同的浏览器/设备间同步收藏、待办、访问记录、偏好、站点备注与便利贴。</span>
      </div>
    </div>
    <div class="setting-row">
      <div class="data-info">
        <span class="data-info-label">个人批注</span>
        <span class="data-info-value">{{ siteNotesStore.marks.size }} 条站点备注 · {{ notesStore.count }} 枚便利贴 · 约 {{ personalSize }} KB</span>
      </div>
    </div>
    <div class="sync-panel">
      <input v-model="sessionKey" class="setting-input sync-key-input" placeholder="输入会话密钥" spellcheck="false" autocomplete="off" />
      <button class="data-btn sync-gen" @click="generateKey" title="随机生成一串新密钥">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        生成密钥
      </button>
      <div class="sync-actions">
        <button class="data-btn" :disabled="!sessionKey || syncing" @click="upload">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          {{ syncing === 'up' ? '上传中…' : '上传到云端' }}
        </button>
        <button class="data-btn" :disabled="!sessionKey || syncing" @click="download">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          {{ syncing === 'down' ? '下载中…' : '从云端下载' }}
        </button>
      </div>
      <div v-if="syncMsg" class="sync-status" :class="{ error: syncError }">{{ syncMsg }}</div>
      <div v-else-if="lastSyncInfo" class="sync-status">{{ lastSyncInfo }}</div>
    </div>
  </section>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { useFavoritesStore } from '@/stores/favorites'
import { useTodosStore } from '@/stores/todos'
import { useHistoryStore } from '@/stores/history'
import { usePreferencesStore } from '@/stores/preferences'
import { useSiteNotesStore } from '@/stores/siteNotes'
import { useNotesStore } from '@/stores/notes'
import { getStoredKey, storeKey, fetchSession, pushSession, snapshotFromStores, applySnapshotToStores } from '@/services/session'

defineEmits(['open-import'])

const sites = useSitesStore()
const categories = useCategoriesStore()
const favoritesStore = useFavoritesStore()
const todosStore = useTodosStore()
const historyStore = useHistoryStore()
const preferencesStore = usePreferencesStore()
const siteNotesStore = useSiteNotesStore()
const notesStore = useNotesStore()

const sessionKey = ref(getStoredKey())
const syncing = ref('')
const syncMsg = ref('')
const syncError = ref(false)
const lastSyncInfo = ref('')

/** 个人批注占的体积：接近上限时用户得有途径知道该清理了（服务端 413 之外的第一道提示） */
const personalSize = computed(() =>
  Math.round((siteNotesStore.usedBytes + notesStore.usedBytes) / 1024)
)

onMounted(() => { sessionKey.value = getStoredKey() })

function generateKey() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  sessionKey.value = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  storeKey(sessionKey.value)
  syncMsg.value = '已生成新密钥，请妥善保存以便在其他设备上使用'
  syncError.value = false
  lastSyncInfo.value = ''
}

function snapshot() {
  return snapshotFromStores({
    favorites: favoritesStore,
    todos: todosStore,
    history: historyStore,
    preferences: preferencesStore,
    siteNotes: siteNotesStore,
    notes: notesStore
  })
}

function applyLocal(data) {
  applySnapshotToStores(data, {
    favorites: favoritesStore,
    todos: todosStore,
    history: historyStore,
    preferences: preferencesStore,
    siteNotes: siteNotesStore,
    notes: notesStore
  })
}

async function upload() {
  const key = sessionKey.value.trim()
  if (!key) return
  syncing.value = 'up'
  syncMsg.value = ''
  syncError.value = false
  try {
    storeKey(key)
    const res = await pushSession(key, snapshot())
    lastSyncInfo.value = `上次上传：${new Date(res.updatedAt).toLocaleString()} · 版本 v${res.version}`
  } catch (e) {
    syncError.value = true
    syncMsg.value = e.message
  } finally {
    syncing.value = ''
  }
}

async function download() {
  const key = sessionKey.value.trim()
  if (!key) return
  syncing.value = 'down'
  syncMsg.value = ''
  syncError.value = false
  try {
    storeKey(key)
    const res = await fetchSession(key)
    if (res.data) {
      applyLocal(res.data)
      syncMsg.value = `已合并云端数据（版本 v${res.version}）`
      lastSyncInfo.value = `云端版本 v${res.version} · 更新于 ${res.updatedAt ? new Date(res.updatedAt).toLocaleString() : '-'}`
    } else {
      syncMsg.value = '云端暂无该密钥的数据，可先上传'
    }
  } catch (e) {
    syncError.value = true
    syncMsg.value = e.message
  } finally {
    syncing.value = ''
  }
}
</script>

<style scoped>
.settings-section { padding: 16px 0; border-bottom: 1px solid var(--border-light); }
.settings-section:last-child { border-bottom: none; }
.section-header { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 14px; }
.section-header svg { width: 16px; height: 16px; color: var(--accent); opacity: 0.8; }
.setting-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; gap: 16px; }
.setting-label { font-size: 13px; color: var(--text-secondary); white-space: nowrap; }
.setting-input { flex: 1; padding: 6px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-white); color: var(--text-primary); font-size: 12px; font-family: var(--font); outline: none; transition: border-color 0.15s ease; }
.setting-input:focus { border-color: var(--accent); }
.setting-input::placeholder { color: var(--text-secondary); opacity: 0.5; }
.data-btn { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-white); color: var(--text-primary); font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.15s ease; font-family: var(--font); }
.data-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-light); }
.data-btn svg { width: 16px; height: 16px; }
.data-info { display: flex; flex-direction: column; gap: 2px; }
.data-info-label { font-size: 12px; font-weight: 500; color: var(--text-primary); }
.data-info-value { font-size: 11px; color: var(--text-secondary); }
.sync-panel { display: flex; flex-direction: column; gap: 8px; width: 100%; margin-top: 4px; }
.sync-key-input { font-family: var(--font-mono, monospace); letter-spacing: 0.5px; }
.sync-gen { align-self: flex-start; }
.sync-gen svg { width: 14px; height: 14px; }
.sync-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.data-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.data-btn:disabled:hover { border-color: var(--border); color: var(--text-primary); background: var(--bg-white); }
.sync-status { font-size: 11px; color: var(--accent); line-height: 1.5; }
.sync-status.error { color: #ef4444; }
</style>