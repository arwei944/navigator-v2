<template>
  <div class="admin-view">
    <header class="admin-header">
      <router-link to="/" class="admin-back">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
        返回首页
      </router-link>
      <h1>管理后台</h1>
    </header>

    <div class="admin-stats">
      <div class="admin-stat-card">
        <div class="admin-stat-value">{{ sitesStore.sites.length }}</div>
        <div class="admin-stat-label">站点总数</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-value">{{ categoriesStore.categories.length }}</div>
        <div class="admin-stat-label">分类数</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-value">{{ todayCount }}</div>
        <div class="admin-stat-label">今日访问</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-value">{{ favoritesStore.count }}</div>
        <div class="admin-stat-label">收藏数</div>
      </div>
    </div>

    <div class="admin-section">
      <div class="admin-section-header">
        <h2>站点管理</h2>
        <button class="admin-btn" @click="showAdd = true">+ 添加站点</button>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>网址</th>
              <th>分类</th>
              <th>访问</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="site in sitesStore.sites" :key="site.id">
              <td>
                <div class="admin-site-name">
                  <span class="admin-favicon" :style="{ background: site.color }">{{ site.initial }}</span>
                  {{ site.name }}
                </div>
              </td>
              <td class="admin-url">{{ site.url }}</td>
              <td><span class="admin-tag" :style="{ background: categoriesStore.getCategoryColor(site.categoryId) + '20', color: categoriesStore.getCategoryColor(site.categoryId) }">{{ categoriesStore.getCategoryLabel(site.categoryId) }}</span></td>
              <td>{{ site.visitCount }}</td>
              <td>
                <div class="admin-actions">
                  <button class="admin-action-btn" @click="openEdit(site)" title="编辑">✎</button>
                  <button class="admin-action-btn admin-action-danger" @click="confirmDelete(site)" title="删除">✕</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="admin-section">
      <div class="admin-section-header">
        <h2>分类管理</h2>
      </div>
      <div class="admin-categories">
        <div v-for="cat in categoriesStore.categories" :key="cat.id" class="admin-category-card">
          <span class="admin-cat-dot" :style="{ background: cat.dotColor }"></span>
          <span class="admin-cat-label">{{ cat.label }}</span>
          <span class="admin-cat-count">{{ sitesStore.sites.filter(s => s.categoryId === cat.id).length }} 个站点</span>
        </div>
      </div>
    </div>

    <AddSiteModal v-if="showAdd" @close="showAdd = false" />
    <EditSiteModal v-if="editingSite" :site="editingSite" @close="editingSite = null" />
    <ConfirmDialog v-if="deletingSite"
      title="删除站点"
      :message="'确定要删除「' + deletingSite.name + '」吗？'"
      confirm-text="确认删除"
      @confirm="doDelete"
      @cancel="deletingSite = null" />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { useFavoritesStore } from '@/stores/favorites'
import { useHistoryStore } from '@/stores/history'
import AddSiteModal from '@/components/AddSiteModal.vue'
import EditSiteModal from '@/components/EditSiteModal.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()
const favoritesStore = useFavoritesStore()
const historyStore = useHistoryStore()

const todayCount = computed(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return historyStore.records.filter(r => r.timestamp >= today.getTime()).length
})

const showAdd = ref(false)
const editingSite = ref(null)
const deletingSite = ref(null)

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
</script>

<style scoped>
.admin-view {
  min-height: 100vh;
  background: var(--bg);
  padding: 0;
}
.admin-header {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 20px 32px;
  background: var(--bg-white);
  border-bottom: 1px solid var(--border);
}
.admin-back {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--accent);
  font-weight: 500;
  text-decoration: none;
}
.admin-back svg { width: 16px; height: 16px; }
.admin-header h1 { font-size: 20px; font-weight: 700; }
.admin-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  padding: 24px 32px;
}
.admin-stat-card {
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  text-align: center;
}
.admin-stat-value { font-size: 28px; font-weight: 700; color: var(--accent); }
.admin-stat-label { font-size: 13px; color: var(--text-secondary); margin-top: 4px; }
.admin-section { padding: 0 32px 32px; }
.admin-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.admin-section-header h2 { font-size: 16px; font-weight: 600; }
.admin-btn {
  padding: 7px 16px;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.admin-btn:hover { filter: brightness(1.1); }
.admin-table-wrap {
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: auto;
}
.admin-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.admin-table th {
  text-align: left;
  padding: 12px 16px;
  font-weight: 600;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: .5px;
}
.admin-table td {
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-light);
  color: var(--text-primary);
}
.admin-table tr:last-child td { border-bottom: none; }
.admin-site-name { display: flex; align-items: center; gap: 10px; font-weight: 500; }
.admin-favicon { width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; color: #fff; flex-shrink: 0; }
.admin-url { color: var(--text-secondary); font-family: monospace; font-size: 12px; }
.admin-tag { display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; }
.admin-actions { display: flex; gap: 4px; }
.admin-action-btn {
  width: 28px; height: 28px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-white);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--text-secondary);
}
.admin-action-btn:hover { border-color: var(--accent); color: var(--accent); }
.admin-action-danger:hover { border-color: #ef4444; color: #ef4444; }
.admin-categories { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.admin-category-card {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
}
.admin-cat-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
.admin-cat-label { font-weight: 600; font-size: 14px; }
.admin-cat-count { margin-left: auto; font-size: 12px; color: var(--text-secondary); }
</style>