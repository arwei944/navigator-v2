<template>
  <Teleport to="body">
    <div v-if="visible" class="cp-overlay" @click.self="close" @keydown="handleKeydown">
      <div class="cp-panel" ref="panelRef">
        <!-- 搜索栏 -->
        <div class="cp-search-wrap">
          <svg class="cp-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref="inputRef"
            v-model="query"
            class="cp-input"
            placeholder="搜索站点、页面、分类..."
            @keydown="handleInputKeydown"
          />
          <kbd class="cp-hint">ESC</kbd>
        </div>

        <!-- 搜索结果 -->
        <div class="cp-results" v-if="query">
          <!-- 页面导航 -->
          <div v-if="pageResults.length" class="cp-group">
            <div class="cp-group-label">页面</div>
            <div
              v-for="(item, i) in pageResults"
              :key="'p' + i"
              class="cp-item"
              :class="{ active: selectedIndex === getIndex('page', i) }"
              @click="execute(item)"
              @mouseenter="selectedIndex = getIndex('page', i)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <template v-if="item.icon === 'home'">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                  <polyline points="9 22 9 12 15 12 15 22"/>
                </template>
                <template v-else-if="item.icon === 'settings'">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </template>
              </svg>
              <span>{{ item.name }}</span>
            </div>
          </div>

          <!-- 分类 -->
          <div v-if="categoryResults.length" class="cp-group">
            <div class="cp-group-label">分类</div>
            <div
              v-for="(item, i) in categoryResults"
              :key="'c' + i"
              class="cp-item"
              :class="{ active: selectedIndex === getIndex('category', i) }"
              @click="execute(item)"
              @mouseenter="selectedIndex = getIndex('category', i)"
            >
              <span class="cp-dot" :style="{ background: item.dotColor }"></span>
              <span>{{ item.label }}</span>
            </div>
          </div>

          <!-- 站点 -->
          <div v-if="siteResults.length" class="cp-group">
            <div class="cp-group-label">站点</div>
            <div
              v-for="(item, i) in siteResults"
              :key="'s' + i"
              class="cp-item"
              :class="{ active: selectedIndex === getIndex('site', i) }"
              @click="execute(item)"
              @mouseenter="selectedIndex = getIndex('site', i)"
            >
              <span class="cp-site-icon" :style="{ background: item.color }">
                <span class="favicon-fallback">{{ item.initial }}</span>
                <img v-if="item.icon" :src="'/' + item.icon" :alt="item.name" class="favicon-img" loading="lazy" @error="$event.target.remove()">
              </span>
              <div class="cp-site-info">
                <span class="cp-site-name">{{ item.name }}</span>
                <span class="cp-site-url">{{ item.url }}</span>
              </div>
            </div>
          </div>

          <!-- 操作 -->
          <div v-if="actionResults.length" class="cp-group">
            <div class="cp-group-label">操作</div>
            <div
              v-for="(item, i) in actionResults"
              :key="'a' + i"
              class="cp-item"
              :class="{ active: selectedIndex === getIndex('action', i) }"
              @click="execute(item)"
              @mouseenter="selectedIndex = getIndex('action', i)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <template v-if="item.icon === 'sun'">
                  <circle cx="12" cy="12" r="5"/>
                  <line x1="12" y1="1" x2="12" y2="3"/>
                  <line x1="12" y1="21" x2="12" y2="23"/>
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                  <line x1="1" y1="12" x2="3" y2="12"/>
                  <line x1="21" y1="12" x2="23" y2="12"/>
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                </template>
                <template v-else-if="item.icon === 'moon'">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </template>
                <template v-else-if="item.icon === 'keyboard'">
                  <rect x="2" y="4" width="20" height="16" rx="2" ry="2"/>
                  <line x1="6" y1="8" x2="6.01" y2="8"/>
                  <line x1="10" y1="8" x2="10.01" y2="8"/>
                  <line x1="14" y1="8" x2="14.01" y2="8"/>
                  <line x1="18" y1="8" x2="18.01" y2="8"/>
                  <line x1="6" y1="12" x2="6.01" y2="12"/>
                  <line x1="10" y1="12" x2="10.01" y2="12"/>
                  <line x1="14" y1="12" x2="14.01" y2="12"/>
                  <line x1="18" y1="12" x2="18.01" y2="12"/>
                  <line x1="6" y1="16" x2="18" y2="16"/>
                </template>
              </svg>
              <span>{{ item.name }}</span>
            </div>
          </div>

          <!-- 无结果 -->
          <div v-if="noResults" class="cp-empty">没有找到匹配结果</div>
        </div>

        <!-- 快捷键提示 -->
        <div class="cp-hints" v-if="!query">
          <div class="cp-hint-row">
            <kbd>&uarr;&darr;</kbd> 导航 <kbd>&#x23CE;</kbd> 选择 <kbd>ESC</kbd> 关闭
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { usePreferencesStore } from '@/stores/preferences'
import { useSidebarStore } from '@/stores/sidebar'
import Fuse from 'fuse.js'

const emit = defineEmits(['close', 'navigate'])
const router = useRouter()
const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()
const preferencesStore = usePreferencesStore()
const sidebarStore = useSidebarStore()

const visible = ref(false)
const query = ref('')
const inputRef = ref(null)
const panelRef = ref(null)
const selectedIndex = ref(0)

/* ---- 页面导航 ---- */
const pages = [
  { id: 'home', name: '首页', icon: 'home', action: () => router.push('/') },
  { id: 'admin', name: '管理后台', icon: 'settings', action: () => router.push('/admin') },
]

/* ---- 快捷操作 ---- */
const actions = [
  { id: 'theme', name: '切换主题', icon: 'sun', action: () => preferencesStore.toggleTheme() },
  { id: 'shortcuts', name: '查看快捷键', icon: 'keyboard', action: () => emit('navigate', 'shortcuts') },
]

/* ---- 过滤结果 ---- */
const pageResults = computed(() =>
  pages.filter(p => p.name.toLowerCase().includes(query.value.toLowerCase()))
)
const categoryResults = computed(() =>
  categoriesStore.categories.filter(c => c.label.toLowerCase().includes(query.value.toLowerCase()))
)
const siteResults = computed(() => {
  if (!query.value) return []
  const q = query.value.toLowerCase()
  // 先精确匹配
  const exact = sitesStore.filteredSites.filter(s =>
    s.name.toLowerCase().includes(q) ||
    s.desc.toLowerCase().includes(q)
  )
  if (exact.length > 0) return exact.slice(0, 8)
  // 模糊匹配
  try {
    const fuse = new Fuse(sitesStore.filteredSites, {
      keys: ['name', 'desc'],
      threshold: 0.4
    })
    return fuse.search(q).map(r => r.item).slice(0, 8)
  } catch {
    return sitesStore.filteredSites.filter(s =>
      s.name.toLowerCase().includes(q)
    ).slice(0, 8)
  }
})
const actionResults = computed(() =>
  actions.filter(a => a.name.toLowerCase().includes(query.value.toLowerCase()))
)

const allGroups = computed(() => {
  const groups = []
  if (pageResults.value.length) groups.push({ type: 'page', items: pageResults.value })
  if (categoryResults.value.length) groups.push({ type: 'category', items: categoryResults.value })
  if (siteResults.value.length) groups.push({ type: 'site', items: siteResults.value })
  if (actionResults.value.length) groups.push({ type: 'action', items: actionResults.value })
  return groups
})

const noResults = computed(() => query.value && allGroups.value.length === 0)

function getIndex(groupType, idx) {
  let offset = 0
  for (const group of allGroups.value) {
    if (group.type === groupType) return offset + idx
    offset += group.items.length
  }
  return 0
}

/* ---- 方法 ---- */
function open() {
  visible.value = true
  query.value = ''
  selectedIndex.value = 0
  nextTick(() => inputRef.value?.focus())
}

function close() {
  visible.value = false
  query.value = ''
}

function execute(item) {
  if (item.action) {
    item.action()
    close()
    return
  }
  if (item.url) {
    window.open('https://' + item.url, '_blank')
    close()
    return
  }
  if (item.id) {
    // 分类跳转
    sitesStore.setCategory(item.id)
    sidebarStore.setActiveNav('categories')
    close()
    return
  }
  close()
}

function handleInputKeydown(e) {
  const total = allGroups.value.reduce((sum, g) => sum + g.items.length, 0)
  if (total === 0) return

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = (selectedIndex.value + 1) % total
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = (selectedIndex.value - 1 + total) % total
  } else if (e.key === 'Enter') {
    e.preventDefault()
    let idx = 0
    for (const group of allGroups.value) {
      if (idx + group.items.length > selectedIndex.value) {
        execute(group.items[selectedIndex.value - idx])
        return
      }
      idx += group.items.length
    }
  }
}

function handleKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
  }
}

defineExpose({ open, close })
</script>

<style scoped>
/* ---- 遮罩层 ---- */
.cp-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 15vh;
  animation: cp-fade-in 0.15s ease;
}

/* ---- 面板 ---- */
.cp-panel {
  width: 580px;
  max-width: 90vw;
  max-height: 70vh;
  background: var(--bg-white);
  border-radius: var(--radius-lg);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  animation: cp-slide-up 0.2s ease;
}
@media (prefers-reduced-motion: reduce) {
  .cp-overlay { animation: none; }
  .cp-panel { animation: none; }
}

/* ---- 搜索栏 ---- */
.cp-search-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}
.cp-search-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: var(--text-secondary);
}
.cp-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 15px;
  font-family: var(--font);
  color: var(--text-primary);
  background: transparent;
}
.cp-input::placeholder {
  color: var(--text-secondary);
}
.cp-hint {
  font-size: 11px;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-secondary);
  background: var(--border-light);
  font-family: inherit;
  line-height: 1.4;
  flex-shrink: 0;
}

/* ---- 结果区 ---- */
.cp-results {
  overflow-y: auto;
  max-height: 50vh;
  padding: 4px 0;
  flex: 1;
}
.cp-results::-webkit-scrollbar {
  width: 5px;
}
.cp-results::-webkit-scrollbar-track {
  background: transparent;
}
.cp-results::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 4px;
}

/* ---- 分组 ---- */
.cp-group {
  padding: 4px 0;
}
.cp-group + .cp-group {
  border-top: 1px solid var(--border-light);
}
.cp-group-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 8px 16px 4px;
  color: var(--text-secondary);
}

/* ---- 条目 ---- */
.cp-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  cursor: pointer;
  font-size: 13px;
  transition: background var(--transition), color var(--transition);
  color: var(--text-primary);
}
.cp-item:hover,
.cp-item.active {
  background: var(--accent-light);
  color: var(--accent);
}
.cp-item svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

/* 分类圆点 */
.cp-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* 站点图标 */
.cp-site-icon {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
}
.favicon-fallback { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
.favicon-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; padding: 1px; background: #fff; box-sizing: border-box; }
.cp-site-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.cp-site-name {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.3;
}
.cp-site-url {
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 空状态 */
.cp-empty {
  text-align: center;
  padding: 32px 16px;
  color: var(--text-secondary);
  font-size: 14px;
}

/* ---- 底部提示 ---- */
.cp-hints {
  padding: 10px 16px;
  border-top: 1px solid var(--border);
  text-align: center;
  flex-shrink: 0;
}
.cp-hint-row {
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.cp-hint-row kbd {
  font-size: 11px;
  padding: 1px 5px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--border-light);
  color: var(--text-secondary);
  font-family: inherit;
  line-height: 1.4;
}

/* ---- 动画 ---- */
@keyframes cp-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes cp-slide-up {
  from {
    opacity: 0;
    transform: translateY(-8px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>