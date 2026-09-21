<template>
  <aside class="right-sidebar" :class="{ collapsed: sidebarStore.rightCollapsed }" role="complementary" aria-label="站点详情">
    <!-- 折叠按钮 -->
    <button class="right-collapse-toggle" @click="sidebarStore.toggleRightCollapse()"
            :title="sidebarStore.rightCollapsed ? '展开右侧面板' : '折叠右侧面板'"
            :class="{ collapsed: sidebarStore.rightCollapsed }">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </button>

    <!-- 站点详情面板 -->
    <div v-if="site" class="site-detail-panel" :key="site.id">
      <!-- 站点头部 -->
      <div class="detail-header" :style="{ '--site-color': site.color || '#64748b' }">
        <div class="detail-icon" :style="{ background: site.color || '#64748b' }">
          <span class="favicon-fallback">{{ site.initial || site.name.charAt(0).toUpperCase() }}</span>
          <img v-if="site.icon" :src="'/' + site.icon" :alt="site.name" class="favicon-img" loading="lazy" @error="$event.target.remove()">
        </div>
        <div class="detail-title-group">
          <h3 class="detail-name">{{ site.name }}</h3>
          <span class="detail-domain">{{ formatDomain(site.url) }}</span>
        </div>
      </div>

      <!-- 分类标签 -->
      <div class="detail-category">
        <span class="category-tag" :style="{ '--cat-color': categoryColor }">
          <span class="category-dot" :style="{ background: categoryColor }"></span>
          {{ categoryLabel }}
        </span>
      </div>

      <!-- 描述 -->
      <div class="detail-section">
        <div class="section-label">简介</div>
        <p class="detail-desc">{{ site.desc || '暂无描述' }}</p>
      </div>

      <!-- 统计信息 -->
      <div class="detail-section">
        <div class="section-label">使用统计</div>
        <div class="stat-grid">
          <div class="stat-item">
            <div class="stat-value">{{ site.visitCount || 0 }}</div>
            <div class="stat-name">访问次数</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">{{ age }}</div>
            <div class="stat-name">已添加</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">{{ lastVisit }}</div>
            <div class="stat-name">上次访问</div>
          </div>
        </div>
      </div>

      <!-- 时间信息 -->
      <div class="detail-section">
        <div class="section-label">时间线</div>
        <div class="timeline">
          <div class="timeline-item">
            <span class="timeline-icon added">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v18M3 12h18"/></svg>
            </span>
            <div class="timeline-content">
              <span class="timeline-label">添加时间</span>
              <span class="timeline-date">{{ formatDate(site.createdAt) }}</span>
            </div>
          </div>
          <div class="timeline-item">
            <span class="timeline-icon updated">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            </span>
            <div class="timeline-content">
              <span class="timeline-label">更新时间</span>
              <span class="timeline-date">{{ formatDate(site.updatedAt) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 快速操作 -->
      <div class="detail-actions">
        <a :href="fullUrl" target="_blank" rel="noopener noreferrer" class="action-btn primary" @click="onVisit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          打开
        </a>
        <button class="action-btn" @click="copyUrl">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          {{ copied ? '已复制' : '复制链接' }}
        </button>
        <button class="action-btn" :class="{ favorited: isFav }" @click="toggleFav">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          {{ isFav ? '已收藏' : '收藏' }}
        </button>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-else class="empty-state">
      <div class="empty-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
        </svg>
      </div>
      <p class="empty-title">站点详情</p>
      <p class="empty-desc">将鼠标悬停到中间栏的卡片上<br/>即可查看多维度的站点信息</p>
    </div>
  </aside>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useSidebarStore } from '@/stores/sidebar'
import { useCategoriesStore } from '@/stores/categories'
import { useFavoritesStore } from '@/stores/favorites'
import { useSitesStore } from '@/stores/sites'
import { useHistoryStore } from '@/stores/history'

const sidebarStore = useSidebarStore()
const categoriesStore = useCategoriesStore()
const favoritesStore = useFavoritesStore()
const sitesStore = useSitesStore()
const historyStore = useHistoryStore()

const copied = ref(false)
let copyTimer = null

const site = computed(() => sidebarStore.hoveredSite)

const categoryLabel = computed(() => {
  if (!site.value) return ''
  return categoriesStore.getCategoryLabel(site.value.categoryId)
})

const categoryColor = computed(() => {
  if (!site.value) return '#64748b'
  return categoriesStore.getCategoryColor(site.value.categoryId)
})

const isFav = computed(() => {
  if (!site.value) return false
  return favoritesStore.isFavorite(site.value.id)
})

const fullUrl = computed(() => {
  if (!site.value) return '#'
  const url = site.value.url
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return 'https://' + url
})

const age = computed(() => {
  if (!site.value?.createdAt) return '—'
  const now = Date.now()
  const diff = now - (typeof site.value.createdAt === 'number' ? site.value.createdAt : new Date(site.value.createdAt).getTime())
  const days = Math.floor(diff / 86400000)
  if (days < 1) return '今天'
  if (days < 30) return days + ' 天'
  const months = Math.floor(days / 30)
  if (months < 12) return months + ' 个月'
  const years = Math.floor(days / 365)
  return years + ' 年'
})

const lastVisit = computed(() => {
  if (!site.value) return '—'
  const last = historyStore.getLastVisitTime(site.value.id)
  if (!last) return '从未访问'
  const diff = Date.now() - (typeof last === 'number' ? last : new Date(last).getTime())
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return mins + ' 分钟前'
  const hours = Math.floor(mins / 60)
  if (hours < 24) return hours + ' 小时前'
  const days = Math.floor(hours / 24)
  if (days < 30) return days + ' 天前'
  return formatDate(last)
})

function formatDate(ts) {
  if (!ts) return '—'
  const d = new Date(typeof ts === 'number' ? ts : ts)
  const now = new Date()
  const isThisYear = d.getFullYear() === now.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hour = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  if (isThisYear) return `${month}/${day} ${hour}:${min}`
  return `${d.getFullYear()}/${month}/${day} ${hour}:${min}`
}

function formatDomain(url) {
  if (!url) return ''
  return url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
}

function copyUrl() {
  if (!site.value) return
  navigator.clipboard.writeText(fullUrl.value)
  copied.value = true
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => { copied.value = false }, 2000)
}

function toggleFav() {
  if (!site.value) return
  favoritesStore.toggle(site.value.id)
}

function onVisit() {
  if (!site.value) return
  sitesStore.recordVisit(site.value.id)
  historyStore.addRecord(site.value.id)
}

// 清除 hover 状态时重置复制状态
watch(() => site.value, () => {
  copied.value = false
  clearTimeout(copyTimer)
})
</script>

<style scoped>
.right-sidebar {
  width: 280px;
  min-width: 280px;
  background: var(--glass-bg);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  color: var(--text-sidebar);
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow-y: auto;
  overflow-x: hidden;
  z-index: 50;
  position: relative;
  border-left: 1px solid var(--border);
  transition: width .28s cubic-bezier(.4,0,.2,1), min-width .28s cubic-bezier(.4,0,.2,1);
}
.right-sidebar.collapsed {
  width: 0;
  min-width: 0;
  border-left: none;
  overflow: hidden;
}

/* 折叠按钮 */
.right-collapse-toggle {
  position: absolute;
  top: 12px;
  left: 8px;
  z-index: 20;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}
.right-collapse-toggle:hover {
  background: var(--accent-light);
  color: var(--accent);
}
.right-collapse-toggle svg {
  width: 16px;
  height: 16px;
  transition: transform 0.28s ease;
}
.right-collapse-toggle.collapsed svg {
  transform: rotate(180deg);
}
.right-sidebar.collapsed .right-collapse-toggle {
  display: none;
}

/* ---- 站点详情 ---- */
.site-detail-panel {
  padding: 48px 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  animation: fadeSlideIn 0.25s ease;
}

@keyframes fadeSlideIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 头部 */
.detail-header {
  display: flex;
  align-items: center;
  gap: 12px;
}
.detail-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--site-color, #64748b) 30%, transparent);
  position: relative;
  overflow: hidden;
}
.favicon-fallback { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
.favicon-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; padding: 3px; background: #fff; box-sizing: border-box; border-radius: 12px; }
.detail-icon span {
  font-size: 18px;
  font-weight: 700;
  color: #fff;
}
.detail-title-group {
  min-width: 0;
  flex: 1;
}
.detail-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail-domain {
  font-size: 12px;
  color: var(--text-secondary);
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 分类标签 */
.detail-category {
  display: flex;
}
.category-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  background: color-mix(in srgb, var(--cat-color, #64748b) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--cat-color, #64748b) 20%, transparent);
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  color: var(--cat-color, #64748b);
}
.category-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* 通用 section */
.detail-section {
  padding-top: 4px;
}
.section-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
  opacity: 0.7;
}

/* 描述 */
.detail-desc {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-primary);
  margin: 0;
  opacity: 0.85;
}

/* 统计网格 */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.stat-item {
  background: var(--border-light);
  border-radius: 8px;
  padding: 10px 8px;
  text-align: center;
}
.stat-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}
.stat-name {
  font-size: 10px;
  color: var(--text-secondary);
  margin-top: 3px;
  opacity: 0.7;
}

/* 时间线 */
.timeline {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.timeline-item {
  display: flex;
  align-items: center;
  gap: 10px;
}
.timeline-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.timeline-icon svg {
  width: 13px;
  height: 13px;
}
.timeline-icon.added {
  background: #e0f2fe;
  color: #0284c7;
}
.timeline-icon.updated {
  background: #fef3c7;
  color: #d97706;
}
.timeline-content {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.timeline-label {
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.7;
}
.timeline-date {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
}

/* 操作按钮 */
.detail-actions {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 6px;
  padding-top: 4px;
  border-top: 1px solid var(--border-light);
}
.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 8px 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-white);
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  text-decoration: none;
  font-family: var(--font);
}
.action-btn svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.action-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-light);
}
.action-btn.primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.action-btn.primary:hover {
  opacity: 0.9;
}
.action-btn.favorited {
  color: #eab308;
  border-color: #eab308;
  background: #fefce8;
}

/* ---- 空状态 ---- */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 24px;
  text-align: center;
  gap: 8px;
}
.empty-icon {
  width: 48px;
  height: 48px;
  border-radius: 16px;
  background: var(--border-light);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  opacity: 0.5;
  margin-bottom: 4px;
}
.empty-icon svg {
  width: 24px;
  height: 24px;
}
.empty-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}
.empty-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin: 0;
  opacity: 0.7;
}
</style>