<template>
  <div class="site-search">
    <div class="search-input-wrap" :class="{ focused: focused }">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="search" class="search-input site-search-input" v-model="localQuery"
             placeholder="搜索站点名称、描述、拼音..." aria-label="搜索站点"
             @focus="focused = true" @blur="onBlur" @keydown.escape="focused = false"
             @keydown.down.prevent="moveDown" @keydown.up.prevent="moveUp"
             @keydown.enter.prevent="onEnter"
             ref="searchInput">
      <span v-if="localQuery" class="search-count">{{ filteredCount }} 个结果</span>
      <button v-if="localQuery" class="search-clear" @click="clearSearch" aria-label="清除搜索">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <kbd class="search-hint">Ctrl+F</kbd>
    </div>

    <!-- 搜索建议下拉 -->
    <Transition name="dropdown">
      <div v-if="focused && localQuery && suggestions.length > 0" class="search-suggestions">
        <div v-for="(item, i) in suggestions" :key="item.id" class="suggestion-item"
             :class="{ active: i === activeIndex }"
             @mousedown.prevent="jumpToSite(item)" @mouseenter="activeIndex = i">
          <span class="suggestion-icon" :style="{ background: item.color }">
            <span class="favicon-fallback">{{ item.initial }}</span>
            <img v-if="item.icon" :src="'/' + item.icon" :alt="item.name" class="favicon-img" loading="lazy" @error="$event.target.remove()">
          </span>
          <div class="suggestion-info">
            <span class="suggestion-name" v-html="highlight(item.name)"></span>
            <span class="suggestion-desc" v-html="highlight(item.desc)"></span>
          </div>
          <span class="suggestion-cat">{{ getCategoryLabel(item.categoryId) }}</span>
          <a :href="'https://' + item.url" target="_blank" class="suggestion-visit" @click.stop>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
          </a>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'

const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()

const searchInput = ref(null)
const focused = ref(false)
const localQuery = ref(sitesStore.searchQuery)
const activeIndex = ref(-1)
let debounceTimer = null

// 防抖同步到 store
watch(localQuery, (val) => {
  activeIndex.value = -1
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    sitesStore.setSearchQuery(val)
  }, 300)
})

// 同步 store 外部变更
watch(() => sitesStore.searchQuery, (val) => {
  if (val !== localQuery.value) {
    localQuery.value = val
  }
})

const filteredCount = computed(() => sitesStore.filteredSites.length)

const suggestions = computed(() => {
  if (!localQuery.value.trim()) return []
  return sitesStore.filteredSites.slice(0, 6)
})

function getCategoryLabel(id) {
  return categoriesStore.getCategoryLabel(id)
}

function highlight(text) {
  if (!localQuery.value.trim()) return text
  const q = localQuery.value.trim()
  const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  return text.replace(regex, '<mark>$1</mark>')
}

function clearSearch() {
  localQuery.value = ''
  sitesStore.setSearchQuery('')
  searchInput.value?.focus()
}

function jumpToSite(site) {
  window.open('https://' + site.url, '_blank')
  sitesStore.recordVisit(site.id)
}

function moveDown() {
  if (suggestions.value.length === 0) return
  activeIndex.value = (activeIndex.value + 1) % suggestions.value.length
}

function moveUp() {
  if (suggestions.value.length === 0) return
  activeIndex.value = activeIndex.value <= 0 ? suggestions.value.length - 1 : activeIndex.value - 1
}

function onEnter() {
  const idx = activeIndex.value >= 0 ? activeIndex.value : 0
  if (suggestions.value[idx]) {
    jumpToSite(suggestions.value[idx])
  }
}

function onBlur() {
  // 延迟关闭下拉，允许点击 suggestion 中的链接
  setTimeout(() => { focused.value = false }, 100)
}

function onKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault()
    searchInput.value?.focus()
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  clearTimeout(debounceTimer)
})
</script>

<style scoped>
.site-search {
  padding: 12px 28px 0;
  flex-shrink: 0;
  position: relative;
}
.search-input-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0 14px;
  height: 40px;
  transition: all .15s ease;
  max-width: 600px;
  margin: 0 auto;
  position: relative;
}
.search-input-wrap:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-light);
}
.search-input-wrap.focused {
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}
.search-input-wrap svg { width: 16px; height: 16px; color: var(--text-secondary); flex-shrink: 0; }
.search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-family: var(--font);
  font-size: 13px;
  color: var(--text-primary);
  min-width: 0;
}
.search-input::placeholder { color: var(--text-secondary); }
.search-count {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  flex-shrink: 0;
  opacity: .7;
}
.search-hint {
  font-size: 10px;
  padding: 2px 5px;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-secondary);
  background: var(--border-light);
  font-family: inherit;
  line-height: 1.4;
  flex-shrink: 0;
  opacity: .6;
}
.search-clear {
  width: 26px; height: 26px;
  border: none;
  border-radius: 50%;
  background: var(--border);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all .15s ease;
}
.search-clear:hover { background: var(--text-secondary); color: var(--bg-white); }
.search-clear svg { width: 12px; height: 12px; }

/* 搜索建议下拉 */
.search-suggestions {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  width: 600px;
  max-width: 90vw;
  max-height: 360px;
  overflow-y: auto;
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-top: none;
  border-radius: 0 0 var(--radius) var(--radius);
  box-shadow: 0 8px 24px rgba(0,0,0,.12);
  z-index: 100;
}
.suggestion-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  transition: background .1s ease;
  border-bottom: 1px solid var(--border-light);
}
.suggestion-item:last-child { border-bottom: none; }
.suggestion-item:hover { background: var(--accent-light); }
.suggestion-item.active { background: var(--accent-light); }
.suggestion-icon {
  width: 30px; height: 30px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 12px;
  color: #fff;
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
}
.favicon-fallback { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
.favicon-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; padding: 1px; background: #fff; box-sizing: border-box; }
.suggestion-info {
  flex: 1;
  min-width: 0;
}
.suggestion-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.3;
}
.suggestion-desc {
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.suggestion-cat {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--border-light);
  color: var(--text-secondary);
  flex-shrink: 0;
}
.suggestion-visit {
  width: 26px; height: 26px;
  border-radius: 6px;
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  transition: all .15s ease;
  flex-shrink: 0;
}
.suggestion-visit:hover { background: var(--accent); border-color: var(--accent); color: #fff; }
.suggestion-visit svg { width: 12px; height: 12px; }

/* 高亮 */
:deep(mark) {
  background: #fef08a;
  color: inherit;
  padding: 0 2px;
  border-radius: 2px;
}
[data-theme="dark"] :deep(mark) {
  background: #854d0e;
  color: #fef9c3;
}

/* 动画 */
.dropdown-enter-active, .dropdown-leave-active {
  transition: all .15s ease;
}
.dropdown-enter-from, .dropdown-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-4px);
}

@media (max-width: 768px) {
  .site-search { padding: 12px 16px 0; }
  .search-input-wrap { max-width: 100%; }
}
</style>