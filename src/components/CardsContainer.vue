<template>
  <div class="cards-container">
    <!-- 回收站视图 -->
    <template v-if="sidebarStore.activeNav === 'trash'">
      <div class="trash-header">
        <div class="trash-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          回收站
          <span class="trash-count">{{ sitesStore.trash.length }} 个站点</span>
        </div>
        <button v-if="sitesStore.trash.length > 0" class="trash-empty-btn" @click="showEmptyConfirm = true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          清空回收站
        </button>
      </div>
      <div v-if="sitesStore.trash.length === 0" class="no-results">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        <div>回收站为空</div>
      </div>
      <div v-else class="trash-list">
        <div v-for="site in sitesStore.trash" :key="site.id" class="trash-item">
          <div class="trash-item-left">
            <div class="card-favicon" :style="{ background: site.color }">
              <span class="favicon-fallback">{{ site.initial }}</span>
              <img v-if="site.icon" :src="'/' + site.icon" :alt="site.name" class="favicon-img" loading="lazy" @error="$event.target.remove()">
            </div>
            <div class="trash-item-info">
              <div class="card-title">{{ site.name }}</div>
              <div class="card-desc">{{ site.desc }}</div>
            </div>
          </div>
          <div class="trash-item-actions">
            <button class="trash-restore-btn" @click="sitesStore.restoreFromTrash(site.id)" title="恢复">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
              恢复
            </button>
            <button class="trash-delete-btn" @click="permanentDeleteConfirm(site)" title="永久删除">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              永久删除
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- 正常站点视图 -->
    <template v-else>
      <Draggable
        v-if="!dragEnabled"
        :list="displaySites"
        :class="viewClass"
        item-key="id"
        tag="div"
        ghost-class="dragging-ghost"
        :disabled="!dragEnabled"
      >
        <template #item="{ element: site }">
          <SiteCard :site="site" :is-list="sitesStore.viewMode === 'list'"
                    :show-drag-handle="dragEnabled"
                    :batch-mode="batchMode"
                    :selected="sitesStore.selectedIds.has(site.id)"
                    :is-read-only="batchMode"
                    @select="sitesStore.toggleSelect(site.id)"
                    @edit="openEdit" @delete="confirmDelete" />
        </template>
      </Draggable>

      <Draggable
        v-if="dragEnabled"
        :list="displaySites"
        :class="viewClass"
        item-key="id"
        tag="div"
        ghost-class="dragging-ghost"
        handle=".drag-handle"
        @change="onDragChange"
      >
        <template #item="{ element: site }">
          <SiteCard :site="site" :is-list="sitesStore.viewMode === 'list'"
                    :show-drag-handle="true"
                    :batch-mode="batchMode"
                    :selected="sitesStore.selectedIds.has(site.id)"
                    :is-read-only="batchMode"
                    @select="sitesStore.toggleSelect(site.id)"
                    @edit="openEdit" @delete="confirmDelete" />
        </template>
      </Draggable>

      <div v-if="displaySites.length === 0" class="no-results">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
        <div>{{ emptyMessage }}</div>
      </div>
    </template>

    <!-- 批量操作浮动栏 -->
    <Transition name="slide-up">
      <div v-if="batchMode && selectedCount > 0" class="batch-bar">
        <span class="batch-count">已选 {{ selectedCount }} 个站点</span>
        <div class="batch-actions">
          <button class="batch-btn" @click="sitesStore.selectAll(displaySites.map(s => s.id))">全选</button>
          <button class="batch-btn" @click="sitesStore.clearSelection()">取消全选</button>
          <button class="batch-btn batch-btn-danger" @click="showBatchDeleteConfirm = true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            批量删除
          </button>
        </div>
      </div>
    </Transition>

    <!-- 编辑弹窗 -->
    <EditSiteModal v-if="editingSite" :site="editingSite" @close="editingSite = null" />

    <!-- 删除确认 -->
    <ConfirmDialog v-if="deletingSite"
      title="删除站点"
      :message="'确定要删除「' + deletingSite.name + '」吗？删除后可在回收站恢复。'"
      confirm-text="确认删除"
      @confirm="doDelete"
      @cancel="deletingSite = null" />

    <!-- 批量删除确认 -->
    <ConfirmDialog v-if="showBatchDeleteConfirm"
      title="批量删除"
      :message="'确定要删除选中的 ' + selectedCount + ' 个站点吗？删除后可在回收站恢复。'"
      confirm-text="确认删除"
      @confirm="doBatchDelete"
      @cancel="showBatchDeleteConfirm = false" />

    <!-- 永久删除确认 -->
    <ConfirmDialog v-if="permanentDeletingSite"
      title="永久删除"
      :message="'确定要永久删除「' + permanentDeletingSite.name + '」吗？此操作不可撤销。'"
      confirm-text="永久删除"
      @confirm="doPermanentDelete"
      @cancel="permanentDeletingSite = null" />

    <!-- 清空回收站确认 -->
    <ConfirmDialog v-if="showEmptyConfirm"
      title="清空回收站"
      :message="'确定要清空回收站吗？' + sitesStore.trash.length + ' 个站点将被永久删除，此操作不可撤销。'"
      confirm-text="确认清空"
      @confirm="doEmptyTrash"
      @cancel="showEmptyConfirm = false" />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useSitesStore } from '@/stores/sites'
import { useSidebarStore } from '@/stores/sidebar'
import { useFavoritesStore } from '@/stores/favorites'
import SiteCard from '@/components/SiteCard.vue'
import EditSiteModal from '@/components/EditSiteModal.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import Draggable from 'vuedraggable'

const sitesStore = useSitesStore()
const sidebarStore = useSidebarStore()
const favoritesStore = useFavoritesStore()

const editingSite = ref(null)
const deletingSite = ref(null)
const showBatchDeleteConfirm = ref(false)
const permanentDeletingSite = ref(null)
const showEmptyConfirm = ref(false)

const selectedCount = computed(() => sitesStore.selectedIds.size)
// 工具栏已上移到 MainToolbar，拖拽开关由 store 承载
const dragEnabled = computed(() => sitesStore.dragEnabled)

const displaySites = computed(() => {
  switch (sidebarStore.activeNav) {
    case 'favorites':
      return sitesStore.filteredSites.filter(s => favoritesStore.isFav(s.id))
    case 'recent':
      // 最近添加：按录入时间倒序。这里**不能截断**——侧栏那版只露 24 条是「预览」，
      // 提成独立范围后截断会让筛选条计数（301）与列表（24）对不上，且用户滚到底也
      // 翻不到更早的站点，成了死路。排序本身已足够表达「最近」。
      return [...sitesStore.filteredSites]
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    default:
      return sitesStore.filteredSites
  }
})

const emptyMessage = computed(() => {
  switch (sidebarStore.activeNav) {
    case 'favorites': return '还没有收藏的站点'
    case 'recent': return '还没有收录的站点'
    default: return '没有找到匹配的站点'
  }
})

const viewClass = computed(() => {
  return sitesStore.viewMode === 'list' ? 'cards-list' : 'cards-grid'
})

const batchMode = computed({
  get: () => sitesStore.batchMode,
  set: (v) => { if (!v) sitesStore.toggleBatchMode() }
})

function openEdit(site) {
  editingSite.value = { ...site }
}

function confirmDelete(site) {
  deletingSite.value = site
}

function doDelete() {
  if (deletingSite.value) {
    sitesStore.deleteSite(deletingSite.value.id)
    deletingSite.value = null
  }
}

function doBatchDelete() {
  sitesStore.batchDeleteToTrash()
  showBatchDeleteConfirm.value = false
}

function permanentDeleteConfirm(site) {
  permanentDeletingSite.value = site
}

function doPermanentDelete() {
  if (permanentDeletingSite.value) {
    sitesStore.permanentDelete(permanentDeletingSite.value.id)
    permanentDeletingSite.value = null
  }
}

function doEmptyTrash() {
  sitesStore.emptyTrash()
  showEmptyConfirm.value = false
}

function onDragChange() {
  sitesStore.reorderSites(displaySites.value)
}
</script>

<style scoped>
.cards-container { padding: 16px 28px 28px; flex: 1; min-height: 0; display: flex; flex-direction: column; overflow-y: auto; overflow-x: hidden; }
.cards-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.cards-list { display: flex; flex-direction: column; gap: 8px; }

/* 卡片虚拟化：离屏卡片跳过渲染（content-visibility），站点增多时滚动仍流畅 */
.cards-grid .card { content-visibility: auto; contain-intrinsic-size: auto 200px; }
.cards-list .card { content-visibility: auto; contain-intrinsic-size: auto 64px; }

.no-results { text-align: center; padding: 60px 20px; color: var(--text-secondary); font-size: 14px; }
.no-results svg { width: 48px; height: 48px; margin-bottom: 16px; opacity: .3; }

.dragging-ghost { opacity: 0.4; background: var(--accent-light) !important; border: 2px dashed var(--accent) !important; transform: none !important; }

/* 批量操作浮动栏 */
.batch-bar {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 200;
  display: flex; align-items: center; justify-content: center; gap: 16px;
  padding: 14px 24px; background: var(--bg-white); border-top: 1px solid var(--border);
  box-shadow: 0 -4px 20px rgba(0,0,0,.1);
}
.batch-count { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.batch-actions { display: flex; gap: 8px; }
.batch-btn {
  padding: 7px 16px; font-size: 13px; font-weight: 500; border-radius: var(--radius-sm);
  border: 1px solid var(--border); background: var(--bg-white); color: var(--text-primary); cursor: pointer;
  transition: all .15s ease; display: inline-flex; align-items: center; gap: 6px;
}
.batch-btn:hover { border-color: var(--accent); color: var(--accent); }
.batch-btn-danger { color: #ef4444; border-color: #fca5a5; }
.batch-btn-danger:hover { background: #fef2f2; border-color: #ef4444; }
.batch-btn-danger svg { width: 14px; height: 14px; }

/* 移动端：批量栏抬到 tab 栏之上，避免遮挡 */
@media (max-width: 768px) {
  .batch-bar {
    bottom: calc(56px + env(safe-area-inset-bottom));
    padding: 12px 16px;
    gap: 10px;
    justify-content: space-between;
  }
  .batch-count { font-size: 13px; }
  .batch-actions { gap: 6px; }
  .batch-btn { padding: 7px 12px; font-size: 12px; }
}

/* 回收站 */
.trash-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border);
}
.trash-title { font-size: 16px; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 10px; }
.trash-title svg { width: 20px; height: 20px; color: var(--text-secondary); }
.trash-count { font-size: 13px; font-weight: 400; color: var(--text-secondary); }
.trash-empty-btn {
  display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; font-size: 12px; font-weight: 500;
  border: 1px solid #fca5a5; border-radius: var(--radius-sm); background: #fef2f2; color: #ef4444;
  cursor: pointer; transition: all .15s ease;
}
.trash-empty-btn:hover { background: #fee2e2; }
.trash-empty-btn svg { width: 14px; height: 14px; }
.trash-list { display: flex; flex-direction: column; gap: 8px; }
.trash-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; background: var(--bg-white); border: 1px solid var(--border);
  border-radius: var(--radius); transition: all .15s ease;
}
.trash-item:hover { border-color: var(--accent); box-shadow: var(--shadow-hover); }
.trash-item-left { display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0; }
.trash-item-info { min-width: 0; }
.trash-item-info .card-desc { margin-bottom: 0; }
.trash-item-actions { display: flex; gap: 8px; flex-shrink: 0; }
.trash-restore-btn, .trash-delete-btn {
  display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; font-size: 12px; font-weight: 500;
  border-radius: var(--radius-sm); cursor: pointer; transition: all .15s ease; border: 1px solid var(--border);
  background: var(--bg-white); color: var(--text-primary);
}
.trash-restore-btn:hover { border-color: var(--accent); color: var(--accent); }
.trash-delete-btn:hover { border-color: #ef4444; color: #ef4444; background: #fef2f2; }
.trash-restore-btn svg, .trash-delete-btn svg { width: 14px; height: 14px; }

/* 卡片样式复用 */
.card-favicon { width: 38px; height: 38px; border-radius: 10px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px; color: #fff; position: relative; overflow: hidden; }
.favicon-fallback { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
.favicon-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; padding: 2px; background: #fff; box-sizing: border-box; }
.card-title { font-size: 14px; font-weight: 600; color: var(--text-primary); line-height: 1.3; }
.card-desc { font-size: 13px; color: var(--text-secondary); line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

/* 动画 */
.slide-up-enter-active, .slide-up-leave-active { transition: all .25s ease; }
.slide-up-enter-from, .slide-up-leave-to { transform: translateY(100%); opacity: 0; }

@media (max-width: 1024px) {
  .cards-grid { grid-template-columns: repeat(2, 1fr) !important; }
}
@media (max-width: 768px) {
  .cards-grid { grid-template-columns: 1fr !important; }
  /* 为底部 tab 栏留出空间，避免最后一行卡片被遮挡 */
  .cards-container { padding: 16px 16px calc(72px + env(safe-area-inset-bottom)); }
}
@media (min-width: 1440px) {
  .cards-grid { grid-template-columns: repeat(4, 1fr) !important; }
}
</style>