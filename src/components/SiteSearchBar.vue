<template>
  <div class="site-search" ref="rootEl">
    <div class="search-input-wrap" :class="{ focused: focused }">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="search" class="search-input site-search-input" v-model="localQuery"
             placeholder="搜索站点名称、别名、描述、拼音..." aria-label="搜索站点"
             @mousedown="onInputPointerDown"
             @focus="focused = true" @blur="onBlur" @keydown.escape="focused = false"
             @keydown.down.prevent="moveDown" @keydown.up.prevent="moveUp"
             @keydown.enter.prevent="onEnter"
             ref="searchInput">
      <span v-if="localQuery" class="search-count">{{ filteredCount }} 个结果</span>
      <button v-if="localQuery" class="search-clear" @click="clearSearch" aria-label="清除搜索">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <kbd class="search-hint">Ctrl+F</kbd>
      <button class="search-palette-hint" type="button" @click="openPalette" title="打开命令面板">⌘K</button>
    </div>

    <!-- 建议下拉：把「添加站点」也收进搜索框。
         网址类输入置顶（回车即带着网址进入添加）；搜不到时给一条出路；其余情况在底部留一条淡入口。 -->
    <div v-if="focused && trimmedQuery" class="search-suggestions">
      <div v-if="suggestions.length === 0" class="suggestion-note">未找到「{{ trimmedQuery }}」相关站点</div>

      <div v-for="(item, i) in navItems" :key="itemKey(item, i)"
             class="suggestion-item"
             :class="{ active: i === activeIndex, 'is-add': item.kind === 'add', 'is-subtle': item.subtle }"
             @mousedown.prevent="activate(item)" @mouseenter="activeIndex = i">
          <!-- 添加站点 -->
          <template v-if="item.kind === 'add'">
            <span class="suggestion-add-icon" :class="{ 'is-muted': item.subtle }">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </span>
            <div class="suggestion-info">
              <span class="suggestion-name"><span class="suggestion-name-text">添加站点<template v-if="item.label"> {{ item.label }}</template></span></span>
              <span class="suggestion-desc">{{ item.hint }}</span>
            </div>
            <span class="suggestion-cat add-badge">新增</span>
          </template>

          <!-- 域名已收录：提示而非重复添加，点一下跳到那条站点 -->
          <template v-else-if="item.kind === 'collected'">
            <span class="suggestion-add-icon is-muted">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </span>
            <div class="suggestion-info">
              <span class="suggestion-name"><span class="suggestion-name-text">{{ item.site.name }}</span></span>
              <span class="suggestion-desc">该域名已收录，无需重复添加</span>
            </div>
            <span class="suggestion-cat">{{ getCategoryLabel(item.site.categoryId) }}</span>
            <a :href="'https://' + item.site.url" target="_blank" class="suggestion-visit" @click.stop>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
            </a>
          </template>

          <!-- 站点 -->
          <template v-else>
            <span class="suggestion-icon" :style="{ background: item.site.color }">
              <span class="favicon-fallback">{{ item.site.initial }}</span>
              <img v-if="item.site.icon" :src="'/' + item.site.icon" :alt="item.site.name" class="favicon-img" loading="lazy" @error="$event.target.remove()">
            </span>
            <div class="suggestion-info">
              <span class="suggestion-name"><span class="suggestion-name-text"><template
                v-for="(seg, si) in splitHighlight(item.site.name, localQuery)" :key="'n' + si"
              ><mark v-if="seg.hit">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></span><span
                v-if="matchedAlias(item.site, localQuery)" class="suggestion-alias">别名 · {{ matchedAlias(item.site, localQuery) }}</span></span>
              <span class="suggestion-desc"><template
                v-for="(seg, si) in splitHighlight(item.site.desc, localQuery)" :key="'d' + si"
              ><mark v-if="seg.hit">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></span>
            </div>
            <span class="suggestion-cat">{{ getCategoryLabel(item.site.categoryId) }}</span>
            <a :href="'https://' + item.site.url" target="_blank" class="suggestion-visit" @click.stop>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
            </a>
          </template>
        </div>

        <!-- 库里搜不到时的外部出口，只在无结果时出现，避免平时占用列表 -->
        <a v-if="suggestions.length === 0" class="suggestion-google" :href="googleUrl" target="_blank" rel="noopener">
          用 Google 搜索「{{ trimmedQuery }}」
        </a>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { rankSites, splitHighlight, matchedAlias } from '@/utils/search'
import { looksLikeUrl, hostOf } from '@/utils/url'

const emit = defineEmits(['add-site'])

const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()

const searchInput = ref(null)
const rootEl = ref(null)
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

const trimmedQuery = computed(() => localQuery.value.trim())

const filteredCount = computed(() => sitesStore.filteredSites.length)

const suggestions = computed(() => rankSites(sitesStore.categorySites, localQuery.value, { limit: 6 }))

const googleUrl = computed(() => 'https://www.google.com/search?q=' + encodeURIComponent(trimmedQuery.value))

// 输入已经像网址（chat.openai.com / https://…）时，才有资格拿它去新增站点
const domainCandidate = computed(() => {
  const q = trimmedQuery.value
  if (!q || !looksLikeUrl(q)) return null
  const host = hostOf(q)
  return host ? { host, url: q } : null
})

// 已收录判定与「添加站点」弹窗里的重复校验同源，避免一边说没收录、一边拦下来说重复
const collected = computed(() => {
  const c = domainCandidate.value
  if (!c) return null
  return sitesStore.sites.find(s => hostOf(s.url) === c.host) || null
})

/**
 * 下拉里的可导航行（含键盘上下选择）。
 * 只有网址类输入才把网址预填进弹窗；关键词不是网址，塞进网址框只会让用户先删一遍。
 */
const navItems = computed(() => {
  const q = trimmedQuery.value
  if (!q) return []
  const cand = domainCandidate.value
  const col = collected.value
  // 已收录时「已收录」那条就代表了这家站点，再把它当普通结果重复列一遍只会让人以为有两个
  const list = col ? suggestions.value.filter(s => s.id !== col.id) : suggestions.value
  const items = []

  if (col) {
    items.push({ kind: 'collected', site: col })
  } else if (cand) {
    items.push({ kind: 'add', url: cand.url, label: cand.host, hint: '按此网址自动抓取名称、描述与图标' })
  } else if (list.length === 0) {
    items.push({ kind: 'add', url: '', label: '', hint: '没找到？手动添加一个新站点' })
  }

  for (const s of list) items.push({ kind: 'site', site: s })

  if (!col && !cand && list.length > 0) {
    items.push({ kind: 'add', url: '', label: '', hint: '添加一个还没收录的站点', subtle: true })
  }
  return items
})

function itemKey(item, i) {
  return item.kind === 'site' ? item.site.id : `${item.kind}-${i}`
}

function openPalette() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
}

function getCategoryLabel(id) {
  return categoriesStore.getCategoryLabel(id)
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

function requestAdd(url) {
  focused.value = false
  emit('add-site', { url })
}

function activate(item) {
  if (item.kind === 'site') jumpToSite(item.site)
  else if (item.kind === 'collected') requestAdd('https://' + item.site.url)
  else if (item.kind === 'add') requestAdd(item.url)
}

function moveDown() {
  if (navItems.value.length === 0) return
  activeIndex.value = (activeIndex.value + 1) % navItems.value.length
}

function moveUp() {
  if (navItems.value.length === 0) return
  activeIndex.value = activeIndex.value <= 0 ? navItems.value.length - 1 : activeIndex.value - 1
}

function onEnter() {
  const idx = activeIndex.value >= 0 ? activeIndex.value : 0
  const item = navItems.value[idx]
  if (item) activate(item)
}

function onBlur() {
  // 延迟关闭下拉，允许点击 suggestion 中的链接
  setTimeout(() => { focused.value = false }, 100)
}

// 预览/自动化浏览器里点击输入框可能拿不到焦点（document.hasFocus() 为 false，
// activeElement 停在 BODY，focus 事件从不派发），只靠 @focus 会让下拉永远打不开。
// 这里在按下时兜底打开。
function onInputPointerDown() {
  focused.value = true
}

// 同理，拿不到焦点时 blur 也不会来，用文档级按下事件兜底关闭，免得下拉关不掉。
// 点击下拉内部（含「添加站点」行、外链）不关闭。
function onDocPointerDown(e) {
  if (rootEl.value && !rootEl.value.contains(e.target)) focused.value = false
}

function onKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault()
    searchInput.value?.focus()
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
.site-search {
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

/* 搜索建议下拉 */
.search-suggestions {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 600px;
  max-height: 360px;
  overflow-y: auto;
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-top: none;
  border-radius: 0 0 var(--radius) var(--radius);
  box-shadow: 0 8px 24px rgba(0,0,0,.12);
  z-index: 100;
}
.suggestion-note {
  padding: 12px 14px 4px;
  font-size: 12px;
  color: var(--text-secondary);
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

/* 「添加站点」行：图标与标题用强调色立起层级，靠 is-muted 把底部那条淡入口压回去 */
.suggestion-add-icon {
  width: 30px; height: 30px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent);
  color: #fff;
  flex-shrink: 0;
}
.suggestion-add-icon svg { width: 15px; height: 15px; }
.suggestion-add-icon.is-muted { background: var(--border-light); color: var(--text-secondary); }
.suggestion-item.is-add .suggestion-name { color: var(--accent); }
/* 底部那条淡入口：把强调色收回去，免得抢搜索结果的位置 */
.suggestion-item.is-subtle .suggestion-name { color: var(--text-secondary); font-weight: 500; }
.add-badge { background: var(--accent); color: #fff; }
.suggestion-item.is-subtle .add-badge { background: var(--border-light); color: var(--text-secondary); }

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
  display: flex;
  align-items: center;
  gap: 6px;
}
.suggestion-name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.suggestion-alias {
  font-size: 10px;
  font-weight: 500;
  color: var(--accent);
  background: var(--accent-light);
  border-radius: 4px;
  padding: 1px 5px;
  white-space: nowrap;
  flex-shrink: 0;
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

/* 无结果时的外部出口 */
.suggestion-google {
  display: block;
  padding: 10px 14px;
  font-size: 12px;
  color: var(--text-secondary);
  text-decoration: none;
  border-top: 1px solid var(--border-light);
  transition: all .1s ease;
}
.suggestion-google:hover { background: var(--accent-light); color: var(--accent); }

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

/* 动画：用 CSS 关键帧而非 Vue Transition，并且只动 transform、不动 opacity。
   预览/自动化环境里动画时钟可能与 rAF 一样不推进：若用 opacity:0 起帧，
   下拉会被永久定格成透明（元素在、能命中，却看不见）。这里保证元素自始至终不透明，
   即使动画没跑，也只是没滑入那 5px，仍然完整可见。 */
.search-suggestions {
  animation: dropdown-in .15s ease;
}
@keyframes dropdown-in {
  from { transform: translateX(-50%) translateY(-5px); }
}

@media (max-width: 768px) {
  .search-input-wrap { max-width: 100%; }
  .search-palette-hint { display: none; }
}
</style>