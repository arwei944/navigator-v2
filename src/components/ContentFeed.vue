<template>
  <div class="feed-panel">
    <!-- 最近访问 -->
    <section class="feed-section" v-if="recentSites.length">
      <div class="feed-header">
        <svg class="feed-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
        <span class="feed-title">最近访问</span>
      </div>
      <div class="feed-list">
        <a
          v-for="item in recentSites"
          :key="item.site.id"
          :href="'https://' + item.site.url"
          target="_blank"
          rel="noopener noreferrer"
          class="feed-item"
          @click="onVisit(item.site.id)"
        >
          <div class="feed-item-favicon" :style="{ background: item.site.color }">{{ item.site.initial }}</div>
          <div class="feed-item-info">
            <span class="feed-item-name">{{ item.site.name }}</span>
            <span class="feed-item-time">{{ formatTime(item.timestamp) }}</span>
          </div>
          <svg class="feed-item-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
          </svg>
        </a>
      </div>
    </section>

    <!-- 热门站点 -->
    <section class="feed-section" v-if="hotSites.length">
      <div class="feed-header">
        <svg class="feed-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z"/>
        </svg>
        <span class="feed-title">热门站点</span>
      </div>
      <div class="feed-grid">
        <a
          v-for="site in hotSites"
          :key="site.id"
          :href="'https://' + site.url"
          target="_blank"
          rel="noopener noreferrer"
          class="feed-card"
          @click="onVisit(site.id)"
        >
          <div class="feed-card-favicon" :style="{ background: site.color }">{{ site.initial }}</div>
          <div class="feed-card-info">
            <span class="feed-item-name">{{ site.name }}</span>
            <span class="feed-item-desc">{{ site.desc }}</span>
          </div>
          <span class="feed-card-count">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            {{ site.visitCount }} 次访问
          </span>
        </a>
      </div>
    </section>

    <!-- 推荐发现 -->
    <section class="feed-section" v-if="discoverSites.length">
      <div class="feed-header">
        <svg class="feed-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
        </svg>
        <span class="feed-title">推荐发现</span>
      </div>
      <div class="feed-grid feed-grid-3">
        <a
          v-for="site in discoverSites"
          :key="site.id"
          :href="'https://' + site.url"
          target="_blank"
          rel="noopener noreferrer"
          class="feed-card feed-card-sm"
          @click="onVisit(site.id)"
        >
          <div class="feed-card-top">
            <div class="feed-card-favicon" :style="{ background: site.color }">{{ site.initial }}</div>
            <span class="feed-card-name">{{ site.name }}</span>
          </div>
          <div class="feed-card-desc">{{ site.desc }}</div>
          <div class="feed-card-footer">
            <span class="feed-card-badge" :style="{ background: categoriesStore.getCategoryColor(site.categoryId) + '18', color: categoriesStore.getCategoryColor(site.categoryId) }">
              {{ categoriesStore.getCategoryLabel(site.categoryId) }}
            </span>
          </div>
        </a>
      </div>
    </section>

    <div v-if="!hasData" class="feed-empty">暂无内容，开始添加站点吧</div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useSitesStore } from '@/stores/sites'
import { useFavoritesStore } from '@/stores/favorites'
import { useHistoryStore } from '@/stores/history'
import { useCategoriesStore } from '@/stores/categories'

const sitesStore = useSitesStore()
const favoritesStore = useFavoritesStore()
const historyStore = useHistoryStore()
const categoriesStore = useCategoriesStore()

/** 最近访问：取历史记录前 5 条（去重），附带时间戳 */
const recentSites = computed(() => {
  const records = historyStore.records
  const seen = new Set()
  const result = []
  for (const r of records) {
    const site = sitesStore.sites.find(s => s.id === r.siteId)
    if (site && !seen.has(site.id)) {
      seen.add(site.id)
      result.push({ site, timestamp: r.timestamp })
      if (result.length >= 5) break
    }
  }
  return result
})

/** 热门站点：按 visitCount 降序，取前 6 条 */
const hotSites = computed(() => {
  return [...sitesStore.sites]
    .sort((a, b) => b.visitCount - a.visitCount)
    .slice(0, 6)
})

/** 推荐发现：从 filteredSites 随机取 6 条 */
const discoverSites = computed(() => {
  const pool = [...sitesStore.filteredSites]
  // Fisher-Yates 洗牌
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, 6)
})

/** 是否有内容展示 */
const hasData = computed(() => {
  return recentSites.value.length > 0 || hotSites.value.length > 0 || discoverSites.value.length > 0
})

/** 格式化相对时间 */
function formatTime(timestamp) {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(timestamp).toLocaleDateString('zh-CN')
}

/** 记录访问 */
function onVisit(siteId) {
  sitesStore.recordVisit(siteId)
  historyStore.addRecord(siteId)
}
</script>

<style scoped>
.feed-panel {
  padding: 16px;
  overflow-y: auto;
  height: 100%;
  box-sizing: border-box;
}

/* ---- 分区 ---- */
.feed-section {
  margin-bottom: 16px;
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  transition: box-shadow var(--transition);
}
.feed-section:last-child {
  margin-bottom: 0;
}

/* ---- 分区头部 ---- */
.feed-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--border-light);
}
.feed-icon {
  width: 16px;
  height: 16px;
  color: var(--accent);
  flex-shrink: 0;
}
.feed-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

/* ---- 列表（最近访问） ---- */
.feed-list {
  display: flex;
  flex-direction: column;
}
.feed-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  text-decoration: none;
  transition: background var(--transition);
  border-bottom: 1px solid var(--border-light);
}
.feed-item:last-child {
  border-bottom: none;
}
.feed-item:hover {
  background: var(--accent-light);
}
.feed-item-favicon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 13px;
  color: #fff;
}
.feed-item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.feed-item-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.feed-item-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.feed-item-time {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.feed-item-arrow {
  width: 14px;
  height: 14px;
  color: var(--text-secondary);
  flex-shrink: 0;
  opacity: 0;
  transition: opacity var(--transition);
}
.feed-item:hover .feed-item-arrow {
  opacity: 1;
}

/* ---- 网格布局 ---- */
.feed-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0;
}
.feed-grid-3 {
  grid-template-columns: repeat(3, 1fr);
}

/* ---- 卡片（热门站点 / 推荐发现） ---- */
.feed-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 14px 12px;
  text-decoration: none;
  transition: background var(--transition);
  position: relative;
  border-right: 1px solid var(--border-light);
  border-bottom: 1px solid var(--border-light);
}
.feed-card:nth-child(2n) {
  border-right: none;
}
.feed-grid-3 .feed-card:nth-child(2n) {
  border-right: 1px solid var(--border-light);
}
.feed-grid-3 .feed-card:nth-child(3n) {
  border-right: none;
}
.feed-card:hover {
  background: var(--accent-light);
  box-shadow: var(--shadow-hover);
  z-index: 1;
  position: relative;
}
.feed-card-favicon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 13px;
  color: #fff;
}
.feed-card-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.feed-card-count {
  font-size: 11px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 3px;
  margin-top: 4px;
}
.feed-card-count svg {
  opacity: 0.6;
}

/* 推荐发现 - 紧凑卡片 */
.feed-card-sm {
  padding: 12px 12px 10px;
  gap: 4px;
}
.feed-card-top {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.feed-card-sm .feed-card-favicon {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  font-size: 11px;
}
.feed-card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.feed-card-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin: 2px 0;
}
.feed-card-footer {
  margin-top: 4px;
}
.feed-card-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  line-height: 1.5;
}

/* ---- 空状态 ---- */
.feed-empty {
  text-align: center;
  padding: 60px 16px;
  font-size: 14px;
  color: var(--text-secondary);
  background: var(--bg-white);
  border: 1px dashed var(--border);
  border-radius: var(--radius);
}
</style>