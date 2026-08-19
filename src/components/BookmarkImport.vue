<template>
  <Teleport to="body">
    <div class="bm-overlay" @click.self="$emit('close')">
      <div class="bm-modal">
        <div class="bm-header">
          <h3>书签管理</h3>
          <button class="close-btn" @click="$emit('close')" aria-label="关闭">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <!-- 选项卡 -->
        <div class="tabs">
          <button
            class="tab"
            :class="{ active: activeTab === 'import' }"
            @click="activeTab = 'import'"
          >导入</button>
          <button
            class="tab"
            :class="{ active: activeTab === 'export' }"
            @click="activeTab = 'export'"
          >导出</button>
          <button
            class="tab"
            :class="{ active: activeTab === 'sync' }"
            @click="activeTab = 'sync'"
          >云同步</button>
        </div>

        <!-- 导入面板 -->
        <div v-if="activeTab === 'import'" class="import-panel">
          <div
            class="drop-zone"
            :class="{ 'drag-over': dragging }"
            @dragover.prevent="dragging = true"
            @dragleave="dragging = false"
            @drop.prevent="onDrop"
            @click="$refs.fileInput.click()"
          >
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="upload-icon">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
            </svg>
            <p class="drop-text">点击或拖拽文件到此处</p>
            <p class="drop-hint">支持 .html（浏览器书签）和 .json 文件</p>
            <input
              ref="fileInput"
              type="file"
              accept=".html,.json"
              style="display:none"
              @change="onFileChange"
            />
          </div>

          <!-- 预览列表 -->
          <div v-if="previewItems.length > 0" class="preview-section">
            <div class="preview-header">
              <span class="preview-title">解析到 {{ previewItems.length }} 个站点</span>
              <button class="import-btn" @click="confirmImport">确认导入</button>
            </div>
            <div class="preview-list">
              <div v-for="(item, idx) in previewItems" :key="idx" class="preview-row">
                <span class="preview-name">{{ item.name }}</span>
                <span class="preview-url">{{ item.url }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 导出面板 -->
        <div v-else-if="activeTab === 'export'" class="export-panel">
          <div class="export-info">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="export-icon">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
            </svg>
            <p class="export-count">当前共有 <strong>{{ sitesStore.sites.length }}</strong> 个站点</p>
            <p class="export-hint">将导出为 JSON 格式文件</p>
          </div>
          <div class="export-actions">
            <button class="export-btn" @click="exportJSON">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
              </svg>
              下载 JSON
            </button>
            <button class="export-btn export-btn-secondary" @click="exportHTML">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              导出为 HTML 书签
            </button>
          </div>
        </div>

        <!-- 同步面板 -->
        <div v-else-if="activeTab === 'sync'" class="sync-panel">
          <div class="sync-section">
            <div class="sync-icon-area">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </div>
            <p class="sync-desc">在不同设备之间同步你的导航数据，基于 Vercel KV 加密存储。</p>

            <div v-if="!syncKey" class="sync-key-input-area">
              <label class="sync-label">已有同步密钥？</label>
              <div class="sync-key-row">
                <input type="text" v-model="inputKey" class="sync-key-input" placeholder="粘贴同步密钥..." @keyup.enter="connectKey">
                <button class="sync-btn" @click="connectKey" :disabled="syncing">连接</button>
              </div>
              <div class="sync-divider"><span>或</span></div>
              <button class="sync-btn primary" @click="createKey" :disabled="syncing">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
                {{ syncing ? '生成中...' : '生成新密钥' }}
              </button>
            </div>

            <div v-else class="sync-connected">
              <div class="sync-key-display">
                <span class="sync-key-label">当前密钥</span>
                <code class="sync-key-value">{{ syncKey.slice(0, 8) }}...{{ syncKey.slice(-4) }}</code>
              </div>
              <div class="sync-actions">
                <button class="sync-btn primary" @click="doSync" :disabled="syncing">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                  {{ syncing ? '同步中...' : '立即同步' }}
                </button>
                <button class="sync-btn danger" @click="disconnectKey" :disabled="syncing">断开</button>
              </div>
              <div v-if="lastSyncTime" class="sync-status">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                上次同步：{{ lastSyncTime }}
              </div>
              <div v-if="syncResult" class="sync-result" :class="{ success: syncResult.success, error: !syncResult.success }">
                {{ syncResult.message }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useSitesStore } from '@/stores/sites'
import { useFavoritesStore } from '@/stores/favorites'
import { useHistoryStore } from '@/stores/history'
import * as syncService from '@/services/sync'

const emit = defineEmits(['close'])
const sitesStore = useSitesStore()
const favoritesStore = useFavoritesStore()
const historyStore = useHistoryStore()

const activeTab = ref('import')
const dragging = ref(false)
const previewItems = ref([])

// Sync state
const syncKey = ref(syncService.getSyncKey())
const inputKey = ref('')
const syncing = ref(false)
const syncResult = ref(null)
const lastSyncTime = ref('')

onMounted(() => {
  if (syncKey.value) {
    const stored = localStorage.getItem('nav-sync-last')
    if (stored) {
      lastSyncTime.value = new Date(stored).toLocaleString()
    }
  }
})

async function createKey() {
  syncing.value = true
  syncResult.value = null
  try {
    const key = await syncService.generateKey()
    syncKey.value = key
    syncResult.value = { success: true, message: '同步密钥已生成！请复制并在其他设备上使用。' }
    lastSyncTime.value = new Date().toLocaleString()
  } catch (e) {
    syncResult.value = { success: false, message: '生成失败：' + e.message }
  } finally {
    syncing.value = false
  }
}

function connectKey() {
  if (!inputKey.value.trim()) return
  syncKey.value = inputKey.value.trim()
  syncService.setKey(syncKey.value)
  syncResult.value = { success: true, message: '密钥已连接，点击"立即同步"拉取数据。' }
}

async function doSync() {
  if (!syncKey.value) return
  syncing.value = true
  syncResult.value = null
  try {
    const data = await syncService.mergeSnapshot(syncKey.value)
    if (data) {
      await syncService.applySnapshot(data)
      syncResult.value = { success: true, message: '同步成功！刷新页面查看最新数据。' }
      lastSyncTime.value = new Date().toLocaleString()
    } else {
      syncResult.value = { success: true, message: '同步完成，无新数据。' }
    }
  } catch (e) {
    syncResult.value = { success: false, message: '同步失败：' + e.message }
  } finally {
    syncing.value = false
  }
}

function disconnectKey() {
  syncService.clearKey()
  syncKey.value = null
  inputKey.value = ''
  syncResult.value = null
  lastSyncTime.value = ''
}

function onDrop(e) {
  dragging.value = false
  const file = e.dataTransfer.files[0]
  if (file) processFile(file)
}

function onFileChange(e) {
  const file = e.target.files[0]
  if (file) processFile(file)
  e.target.value = ''
}

function processFile(file) {
  const reader = new FileReader()
  reader.onload = (e) => {
    const content = e.target.result
    if (file.name.endsWith('.json')) {
      parseJSON(content)
    } else if (file.name.endsWith('.html')) {
      parseBookmarkHTML(content)
    }
  }
  reader.readAsText(file, 'UTF-8')
}

function parseJSON(content) {
  try {
    const data = JSON.parse(content)
    const items = Array.isArray(data) ? data : (data.sites || data.bookmarks || [])
    previewItems.value = items.map(item => ({
      name: item.name || item.title || '未命名',
      url: item.url || item.href || '#',
      desc: item.desc || item.description || ''
    }))
  } catch {
    alert('JSON 解析失败，请检查文件格式')
  }
}

function parseBookmarkHTML(content) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(content, 'text/html')
  const links = doc.querySelectorAll('a[href]')
  const items = []
  const seen = new Set()

  links.forEach(link => {
    const href = link.getAttribute('href')
    const text = link.textContent.trim()
    if (!href || href === '#' || href.startsWith('javascript:') || href.startsWith('place:')) return
    if (seen.has(href)) return
    seen.add(href)
    items.push({
      name: text || href.replace(/^https?:\/\//, '').split('/')[0],
      url: href,
      desc: ''
    })
  })

  previewItems.value = items
}

function confirmImport() {
  let imported = 0
  previewItems.value.forEach(item => {
    const exists = sitesStore.sites.some(s => s.url === item.url)
    if (!exists) {
      sitesStore.addSite({
        name: item.name,
        url: item.url.replace(/^https?:\/\//, ''),
        desc: item.desc || '',
        categoryId: 'other'
      })
      imported++
    }
  })
  alert(`成功导入 ${imported} 个站点（${previewItems.value.length - imported} 个已存在）`)
  previewItems.value = []
}

function exportJSON() {
  const data = {
    exportedAt: new Date().toISOString(),
    version: 2,
    sites: sitesStore.sites,
    favorites: favoritesStore.favorites,
    history: historyStore.visitHistory
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `nav-sites-${Date.now()}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function exportHTML() {
  const now = new Date().toISOString().split('T')[0]
  let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Navigator Bookmarks</TITLE>
<H1>Navigator Bookmarks</H1>
<DL><p>
  <DT><H3>Navigator 导航站 (${now})</H3>
  <DL><p>\n`
  sitesStore.sites.forEach(s => {
    html += `    <DT><A HREF="https://${s.url}" ADD_DATE="${Math.floor(s.createdAt / 1000)}">${s.name}</A>\n`
  })
  html += `  </DL><p>\n</DL><p>\n`
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `nav-bookmarks-${now}.html`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
</script>

<style scoped>
.bm-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 0.2s ease;
}

.bm-modal {
  background: var(--bg-white);
  border-radius: var(--radius-lg);
  width: 520px;
  max-width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
  animation: slideUp 0.25s ease;
}

.bm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 0;
}

.bm-header h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.close-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--transition);
}

.close-btn:hover {
  background: var(--accent-light);
  color: var(--accent);
}

/* 选项卡 */
.tabs {
  display: flex;
  gap: 0;
  padding: 16px 24px 0;
  border-bottom: 1px solid var(--border);
  margin-bottom: 0;
}

.tab {
  padding: 10px 20px;
  font-size: 13px;
  font-weight: 500;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  position: relative;
  transition: color var(--transition);
}

.tab::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
  height: 2px;
  background: transparent;
  border-radius: 1px;
  transition: background var(--transition);
}

.tab.active {
  color: var(--accent);
  font-weight: 600;
}

.tab.active::after {
  background: var(--accent);
}

/* 导入面板 */
.import-panel {
  padding: 20px 24px;
  overflow-y: auto;
}

.drop-zone {
  border: 2px dashed var(--border);
  border-radius: var(--radius);
  padding: 36px 20px;
  text-align: center;
  cursor: pointer;
  transition: all var(--transition);
  background: var(--border-light);
}

.drop-zone:hover,
.drop-zone.drag-over {
  border-color: var(--accent);
  background: var(--accent-light);
}

.upload-icon {
  color: var(--text-secondary);
  margin-bottom: 8px;
  transition: color var(--transition);
}

.drop-zone:hover .upload-icon,
.drop-zone.drag-over .upload-icon {
  color: var(--accent);
}

.drop-text {
  font-size: 14px;
  color: var(--text-primary);
  font-weight: 500;
  margin-bottom: 4px;
}

.drop-hint {
  font-size: 12px;
  color: var(--text-secondary);
}

/* 预览 */
.preview-section {
  margin-top: 16px;
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.preview-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.import-btn {
  padding: 6px 16px;
  font-size: 12px;
  font-weight: 600;
  border: none;
  background: var(--accent);
  color: white;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: opacity var(--transition);
}

.import-btn:hover {
  opacity: 0.9;
}

.preview-list {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 4px;
}

.preview-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 12px;
  transition: background var(--transition);
}

.preview-row:hover {
  background: var(--border-light);
}

.preview-name {
  font-weight: 500;
  color: var(--text-primary);
  min-width: 80px;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-url {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 导出面板 */
.export-panel {
  padding: 32px 24px;
  text-align: center;
}

.export-icon {
  color: var(--accent);
  margin-bottom: 12px;
}

.export-info {
  margin-bottom: 20px;
}

.export-count {
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.export-count strong {
  color: var(--accent);
  font-size: 18px;
}

.export-hint {
  font-size: 12px;
  color: var(--text-secondary);
}

.export-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 28px;
  font-size: 14px;
  font-weight: 600;
  border: none;
  background: var(--accent);
  color: white;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: opacity var(--transition);
}

.export-btn:hover {
  opacity: 0.9;
}

.export-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
}

.export-btn-secondary {
  background: var(--bg-white);
  color: var(--text-primary);
  border: 1px solid var(--border);
}

.export-btn-secondary:hover {
  border-color: var(--accent);
  color: var(--accent);
  opacity: 1;
}

/* 同步面板 */
.sync-panel {
  padding: 24px;
}

.sync-section {
  text-align: center;
}

.sync-icon-area {
  display: flex;
  justify-content: center;
  margin-bottom: 12px;
  color: var(--accent);
  opacity: 0.8;
}

.sync-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 24px;
  line-height: 1.5;
}

.sync-key-input-area {
  max-width: 360px;
  margin: 0 auto;
}

.sync-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 8px;
  text-align: left;
}

.sync-key-row {
  display: flex;
  gap: 8px;
}

.sync-key-input {
  flex: 1;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-family: var(--font);
  color: var(--text-primary);
  background: var(--bg-white);
  outline: none;
  transition: border-color var(--transition);
}

.sync-key-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-light);
}

.sync-key-input::placeholder {
  color: var(--text-secondary);
}

.sync-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 16px 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.sync-divider::before,
.sync-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}

.sync-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 9px 20px;
  font-size: 13px;
  font-weight: 600;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-white);
  color: var(--text-primary);
  cursor: pointer;
  transition: all var(--transition);
  white-space: nowrap;
}

.sync-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.sync-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sync-btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}

.sync-btn.primary:hover:not(:disabled) {
  filter: brightness(1.1);
}

.sync-btn.danger {
  color: #ef4444;
  border-color: #fecaca;
}

.sync-btn.danger:hover:not(:disabled) {
  background: #fef2f2;
  border-color: #ef4444;
}

.sync-btn svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.sync-connected {
  max-width: 360px;
  margin: 0 auto;
}

.sync-key-display {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-bottom: 16px;
  padding: 10px 16px;
  background: var(--accent-light);
  border-radius: var(--radius-sm);
}

.sync-key-label {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}

.sync-key-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
  font-family: 'SF Mono', 'Fira Code', monospace;
  letter-spacing: 0.5px;
}

.sync-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
  margin-bottom: 12px;
}

.sync-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.sync-status svg {
  flex-shrink: 0;
}

.sync-result {
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  text-align: center;
}

.sync-result.success {
  background: #ecfdf5;
  color: #059669;
  border: 1px solid #a7f3d0;
}

.sync-result.error {
  background: #fef2f2;
  color: #dc2626;
  border: 1px solid #fecaca;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(16px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
</style>