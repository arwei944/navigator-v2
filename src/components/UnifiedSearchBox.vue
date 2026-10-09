<template>
  <div class="unified-search" ref="rootEl">
    <div class="search-input-wrap" :class="{ focused: focused }">
      <!-- 引擎前缀：站外搜索用哪个引擎常驻可见、随手可切 -->
      <label class="engine-select" title="选择搜索引擎">
        <select v-model="engineId" aria-label="选择搜索引擎">
          <option v-for="e in preferencesStore.engines" :key="e.id" :value="e.id">{{ shortLabel(e) }}</option>
        </select>
        <svg class="engine-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
      </label>

      <!-- 放大镜兼作「立即站外搜索」的显式按钮 -->
      <button type="button" class="search-go" @mousedown.prevent="externalSearch"
              :title="`用 ${currentEngine.label} 搜索`" aria-label="用外部搜索引擎搜索">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </button>

      <input type="search" class="search-input unified-search-input" v-model="raw"
             :placeholder="page ? '筛选站点操作…' : '搜索站点、命令、页面…'"
             aria-label="全能搜索框"
             @mousedown="onInputPointerDown"
             @focus="focused = true" @blur="onBlur"
             @keydown="onKeydownInput"
             ref="searchInput">
      <span v-if="raw && !page" class="search-count">{{ filteredCount }} 个结果</span>
      <button v-if="raw" class="search-clear" @click="clearSearch" aria-label="清除搜索">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <kbd class="search-hint">Ctrl+F</kbd>
      <button class="search-palette-hint" type="button" @click="emit('open-palette')" title="展开为命令面板（Ctrl+K）">⌘K</button>
    </div>

    <!-- 全能下拉：命令 / 页面 / 方向 / 分类 / 用途 / 站点 / 站外，一套结果 -->
    <div v-if="open" class="search-suggestions">
      <OmniResults
        :groups="groups"
        :selected-index="selectedIndex"
        :query="trimmed"
        :breadcrumb="breadcrumb"
        :empty="empty"
        @select="onSelect"
        @hover="setSelected"
        @back="back"
      />
      <div class="omni-hints">
        <kbd>↑↓</kbd> 导航 <kbd>⏎</kbd> 执行 <kbd>⇥</kbd> 站点操作 <kbd>ESC</kbd> 关闭
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useSitesStore } from '@/stores/sites'
import { usePreferencesStore } from '@/stores/preferences'
import { useOmniBox } from '@/composables/useOmniBox'
import OmniResults from '@/components/OmniResults.vue'

const emit = defineEmits(['open-palette'])

const sitesStore = useSitesStore()
const preferencesStore = usePreferencesStore()

const searchInput = ref(null)
const rootEl = ref(null)
const focused = ref(false)

const omni = useOmniBox({ mode: 'inline' })
const {
  raw, trimmed, groups, selectedIndex, empty, breadcrumb, page,
  moveDown, moveUp, enter, tab, backspace, back
} = omni

const filteredCount = computed(() => sitesStore.filteredSites.length)

/**
 * 输入即过滤网格（沿用既有行为）。两个例外：
 *  - 带前缀（> / @ / /）时不同步：用户在找命令，不是要筛卡片；
 *  - 二级页时不同步：那是临时状态，不该动页面。
 * 命令执行后单独清空，避免「执行一条命令把网格筛没了」。
 */
let debounceTimer = null
watch(() => (omni.prefix.value || page.value ? '' : trimmed.value), (val) => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    if (sitesStore.searchQuery !== val) sitesStore.setSearchQuery(val)
  }, 300)
})

// 外部（路由 / 命令）改了搜索词 → 回填输入框
watch(() => sitesStore.searchQuery, (val) => {
  if (!page.value && val !== raw.value) raw.value = val || ''
})

const open = computed(() => focused.value && (Boolean(trimmed.value) || Boolean(page.value)))

// 鼠标悬停即改选中项。写成方法而不是模板里直接赋值，避免依赖模板对 ref 的赋值解包
function setSelected(i) {
  selectedIndex.value = i
}

/* ---------- 站外搜索 ---------- */

const SHORT_LABELS = { google: 'Google', bing: 'Bing', baidu: '百度', duckduckgo: 'DDG', perplexity: 'PPLX' }
function shortLabel(e) {
  return SHORT_LABELS[e.id] || e.label
}

const engineId = computed({
  get: () => preferencesStore.searchEngine,
  set: (id) => preferencesStore.setSearchEngine(id)
})

const currentEngine = computed(() => preferencesStore.getCurrentEngine())

function externalSearch() {
  const q = trimmed.value
  if (!q) return
  window.open(`${currentEngine.value.url}?q=${encodeURIComponent(q)}`, '_blank', 'noopener')
  focused.value = false
}

/* ---------- 执行与关闭 ---------- */

/**
 * 执行后的收尾分两种：
 *  - 站点：只关下拉，保留输入与网格筛选（用户是在「边搜边开」，这正是搜索框的本职）；
 *  - 其余（命令 / 跳页 / 分类 / 站外）：关下拉并清空，命令不该把网格留在被筛状态。
 */
function done(item) {
  focused.value = false
  const keepSearch = Boolean(page.value) === false && item?.type === 'site'
  if (page.value) back()
  if (!keepSearch) {
    raw.value = ''
    sitesStore.setSearchQuery('')
  }
  searchInput.value?.blur()
}

function onSelect(item) {
  item.run?.()
  done(item)
}

/** 回车：无选中项时沿用既有决策链（网址优先收录，否则站外搜索） */
function onEnter() {
  if (enter()) return
  if (trimmed.value) externalSearch()
}

function onKeydownInput(e) {
  if (e.key === 'Escape') {
    // 二级页先退回 root，再收起下拉
    if (page.value) { e.preventDefault(); back(); return }
    focused.value = false
    searchInput.value?.blur()
    return
  }
  if (e.key === 'ArrowDown') { e.preventDefault(); moveDown(); return }
  if (e.key === 'ArrowUp') { e.preventDefault(); moveUp(); return }
  if (e.key === 'Enter') { e.preventDefault(); onEnter(); return }
  if (e.key === 'Tab') {
    if (tab()) e.preventDefault()
    return
  }
  if (e.key === 'Backspace') {
    if (backspace()) e.preventDefault()
  }
}

function clearSearch() {
  if (page.value) { back(); return }
  raw.value = ''
  sitesStore.setSearchQuery('')
  searchInput.value?.focus()
}

function onBlur() {
  // 延迟关闭下拉，允许点击下拉里的行
  setTimeout(() => { focused.value = false }, 100)
}

// 预览/自动化浏览器里点击输入框可能拿不到焦点，@focus 不派发时兜底打开
function onInputPointerDown() {
  focused.value = true
}

// 同理拿不到焦点时 blur 也不来，用文档级按下事件兜底关闭
function onDocPointerDown(e) {
  if (rootEl.value && !rootEl.value.contains(e.target)) focused.value = false
}

function onKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault()
    searchInput.value?.focus()
    return
  }
  // 焦点不在输入框时（例如点过下拉里的空白），文档级 Escape 也要能收起下拉，
  // 否则下拉只能靠点击别处关掉。输入框自己的 Escape 处理已把 focused 置 false，
  // 事件冒泡到这里时会被这次判断挡掉，不会重复执行。
  if (e.key === 'Escape' && focused.value) {
    if (page.value) back()
    else focused.value = false
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('mousedown', onDocPointerDown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('mousedown', onDocPointerDown)
  clearTimeout(debounceTimer)
})
</script>

<style scoped>
/* 由所在工具栏负责外边距，这里只管自身与下拉定位 */
.unified-search {
  padding: 0;
  position: relative;
}
.search-input-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0 14px 0 0;
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
.search-input::-webkit-search-cancel-button { display: none; }

/* 引擎前缀：贴左边缘，浅底 + 右分隔线，与输入区区分开 */
.engine-select {
  position: relative;
  display: flex;
  align-items: center;
  align-self: stretch;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: var(--border-light);
  border-radius: calc(var(--radius) - 1px) 0 0 calc(var(--radius) - 1px);
}
.search-input-wrap.focused .engine-select {
  border-bottom-left-radius: 0;
}
.engine-select select {
  appearance: none;
  -webkit-appearance: none;
  border: none;
  outline: none;
  background: transparent;
  font-family: var(--font);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  height: 100%;
  padding: 0 24px 0 12px;
  cursor: pointer;
}
.engine-select select:hover { color: var(--accent); }
.engine-caret {
  position: absolute;
  right: 7px;
  width: 12px;
  height: 12px;
  color: var(--text-secondary);
  pointer-events: none;
}

/* 放大镜：兼作「立即站外搜索」按钮 */
.search-go {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
  transition: color .15s ease;
}
.search-go:hover { color: var(--accent); }
.search-go svg { width: 16px; height: 16px; }

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
.search-palette-hint {
  font-size: 10px;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-secondary);
  background: var(--border-light);
  font-family: inherit;
  line-height: 1.4;
  flex-shrink: 0;
  opacity: .6;
  cursor: pointer;
  transition: all .15s ease;
}
.search-palette-hint:hover { opacity: 1; border-color: var(--accent); color: var(--accent); }

/* 全能下拉 */
.search-suggestions {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 600px;
  max-height: 420px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-top: none;
  border-radius: 0 0 var(--radius) var(--radius);
  box-shadow: 0 8px 24px rgba(0,0,0,.12);
  z-index: 100;
}
/* 动画只动 transform、不动 opacity：预览/自动化环境里动画时钟可能不推进，
   用 opacity:0 起帧会让下拉被永久定格成透明。 */
.search-suggestions {
  animation: dropdown-in .15s ease;
}
@keyframes dropdown-in {
  from { transform: translateX(-50%) translateY(-5px); }
}

.omni-hints {
  padding: 8px 14px;
  border-top: 1px solid var(--border);
  text-align: center;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.omni-hints kbd {
  font-size: 10px;
  padding: 1px 5px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--border-light);
  color: var(--text-secondary);
  font-family: inherit;
  line-height: 1.4;
}

@media (max-width: 768px) {
  .unified-search { width: 100%; max-width: 100%; min-width: 0; }
  .search-input-wrap { max-width: 100%; }
  .search-palette-hint { display: none; }
  /* 下拉恒不超出视口：窄屏下留出工具栏的左右边距 */
  .search-suggestions { max-width: 100%; max-height: 60vh; }
}
</style>
