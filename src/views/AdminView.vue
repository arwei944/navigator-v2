<template>
  <div class="admin-view">
    <header class="admin-header">
      <router-link to="/" class="admin-back">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
        返回首页
      </router-link>
      <h1>管理后台</h1>
      <button class="admin-btn admin-publish-btn" @click="scrollToPublish" title="将当前站点数据发布到云端，所有设备实时更新">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        发布到云端
      </button>
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
                  <span class="admin-favicon" :style="{ background: site.color }">
                    <span class="favicon-fallback">{{ site.initial }}</span>
                    <img v-if="site.icon" :src="'/' + site.icon" :alt="site.name" class="favicon-img" loading="lazy" @error="$event.target.remove()">
                  </span>
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

    <div class="admin-section" ref="publishSectionRef">
      <div class="admin-section-header">
        <h2>云端发布（热更新）</h2>
        <span class="admin-cloud-version" v-if="sitesStore.cloudVersion">云端版本 v{{ sitesStore.cloudVersion }}</span>
      </div>
      <div class="admin-publish-box">
        <p class="admin-publish-desc">将当前站点数据发布到云端后，所有已打开的页面会在 <b>30 秒内自动热更新</b>，无需刷新、无需重新部署。</p>
        <div class="admin-publish-row">
          <input type="password" v-model="adminKey" class="admin-key-input" placeholder="管理密钥（SITES_ADMIN_KEY）" @keyup.enter="publishToCloud">
          <button class="admin-btn" @click="publishToCloud" :disabled="publishState === 'loading'">
            {{ publishState === 'loading' ? '发布中...' : '发布到云端' }}
          </button>
        </div>
        <div v-if="adminKey" class="admin-key-saved">密钥已保存在本机，下次发布自动填充 <button class="admin-link-btn" @click="clearSavedKey">清除</button></div>
        <div v-if="publishMsg" class="admin-publish-msg" :class="{ success: publishState === 'success', error: publishState === 'error' }">
          {{ publishMsg }}
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
import { ref, computed, watch } from 'vue'
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
const publishSectionRef = ref(null)
const adminKey = ref(localStorage.getItem('nav_admin_key') || '')
const publishState = ref('idle')
const publishMsg = ref('')

// 记住密钥，下次发布无需重输（可清除）
watch(adminKey, (v) => {
  if (v) localStorage.setItem('nav_admin_key', v)
  else localStorage.removeItem('nav_admin_key')
})

function clearSavedKey() {
  adminKey.value = ''
  localStorage.removeItem('nav_admin_key')
}

function scrollToPublish() {
  if (publishSectionRef.value) {
    publishSectionRef.value.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

async function publishToCloud() {
  if (!adminKey.value.trim()) {
    publishState.value = 'error'
    publishMsg.value = '请输入管理密钥'
    return
  }
  publishState.value = 'loading'
  publishMsg.value = ''
  try {
    const res = await fetch('/api/sites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: adminKey.value.trim(), sites: sitesStore.sites })
    })
    const data = await res.json()
    if (!res.ok) {
      publishState.value = 'error'
      publishMsg.value = data.error || '发布失败'
      return
    }
    publishState.value = 'success'
    publishMsg.value = `发布成功！云端版本 v${data.version}，其他设备将在 30 秒内自动更新。`
  } catch (e) {
    publishState.value = 'error'
    publishMsg.value = '发布失败：' + e.message
  }
}

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
.admin-favicon { width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; color: #fff; flex-shrink: 0; position: relative; overflow: hidden; }
.favicon-fallback { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
.favicon-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; padding: 1px; background: #fff; box-sizing: border-box; }
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
.admin-publish-btn { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; }
.admin-publish-btn svg { width: 14px; height: 14px; }
.admin-cloud-version { font-size: 12px; color: var(--accent); font-weight: 600; }
.admin-publish-box {
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px 20px;
}
.admin-publish-desc { font-size: 13px; color: var(--text-secondary); margin-bottom: 14px; line-height: 1.6; }
.admin-publish-desc b { color: var(--accent); }
.admin-publish-row { display: flex; gap: 10px; }
.admin-key-saved { margin-top: 8px; font-size: 12px; color: var(--text-secondary); display: flex; align-items: center; gap: 8px; }
.admin-link-btn { border: none; background: transparent; color: var(--accent); cursor: pointer; font-size: 12px; padding: 0; text-decoration: underline; }
.admin-key-input {
  flex: 1;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-family: var(--font);
  color: var(--text-primary);
  background: var(--bg-white);
  outline: none;
  transition: border-color .15s ease;
}
.admin-key-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-light); }
.admin-publish-msg {
  margin-top: 12px;
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  font-size: 12.5px;
  font-weight: 500;
}
.admin-publish-msg.success { background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; }
.admin-publish-msg.error { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
</style>