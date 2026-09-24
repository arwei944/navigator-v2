<template>
  <div class="import-panel">
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
</template>

<script setup>
import { ref } from 'vue'
import { useSitesStore } from '@/stores/sites'
import { parseBookmarkFile } from '@/utils/bookmarks'

const sitesStore = useSitesStore()
const dragging = ref(false)
const previewItems = ref([])

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
  parseBookmarkFile(file, (result) => {
    if (result.error) {
      alert(result.error)
      return
    }
    previewItems.value = result.items
  })
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
</script>

<style scoped>
.import-panel { padding: 20px 24px; overflow-y: auto; }
.drop-zone { border: 2px dashed var(--border); border-radius: var(--radius); padding: 36px 20px; text-align: center; cursor: pointer; transition: all var(--transition); background: var(--border-light); }
.drop-zone:hover, .drop-zone.drag-over { border-color: var(--accent); background: var(--accent-light); }
.upload-icon { color: var(--text-secondary); margin-bottom: 8px; transition: color var(--transition); }
.drop-zone:hover .upload-icon, .drop-zone.drag-over .upload-icon { color: var(--accent); }
.drop-text { font-size: 14px; color: var(--text-primary); font-weight: 500; margin-bottom: 4px; }
.drop-hint { font-size: 12px; color: var(--text-secondary); }
.preview-section { margin-top: 16px; }
.preview-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.preview-title { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.import-btn { padding: 6px 16px; font-size: 12px; font-weight: 600; border: none; background: var(--accent); color: white; border-radius: var(--radius-sm); cursor: pointer; transition: opacity var(--transition); }
.import-btn:hover { opacity: 0.9; }
.preview-list { max-height: 200px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 4px; }
.preview-row { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 4px; font-size: 12px; transition: background var(--transition); }
.preview-row:hover { background: var(--border-light); }
.preview-name { font-weight: 500; color: var(--text-primary); min-width: 80px; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.preview-url { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>