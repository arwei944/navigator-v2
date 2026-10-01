<template>
  <Teleport to="body">
    <div v-if="visible" class="cp-overlay" @click.self="close" @keydown="handleKeydown">
      <div class="cp-panel">
        <CommandSearchBar ref="searchBarRef" v-model:query="query" @keydown="handleInputKeydown" />
        <CommandResults
          :query="query"
          :groups="allGroups"
          :selected-index="selectedIndex"
          :no-results="noResults"
          :get-index="getIndex"
          @select="execute"
          @hover="selectedIndex = $event"
        />
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
import { rankSites } from '@/utils/search'
import CommandSearchBar from '@/components/command/CommandSearchBar.vue'
import CommandResults from '@/components/command/CommandResults.vue'

const emit = defineEmits(['close', 'navigate'])
const router = useRouter()
const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()
const preferencesStore = usePreferencesStore()

const visible = ref(false)
const query = ref('')
const searchBarRef = ref(null)
const selectedIndex = ref(0)

const pages = [
  { id: 'home', name: '首页', icon: 'home', action: () => router.push('/') },
  { id: 'admin', name: '管理后台', icon: 'settings', action: () => router.push('/admin') },
]

const actions = [
  { id: 'theme', name: '切换主题', icon: 'sun', action: () => preferencesStore.toggleTheme() },
  { id: 'shortcuts', name: '查看快捷键', icon: 'keyboard', action: () => emit('navigate', 'shortcuts') },
]

const pageResults = computed(() =>
  pages.filter(p => p.name.toLowerCase().includes(query.value.toLowerCase()))
)
// 方向（域）与子分类共用「当前范围」这一轴，都能直接路由过去
const domainResults = computed(() =>
  categoriesStore.domains.filter(d => d.label.toLowerCase().includes(query.value.toLowerCase()))
)
const categoryResults = computed(() =>
  categoriesStore.categories.filter(c => c.label.toLowerCase().includes(query.value.toLowerCase()))
)
// 命令面板是全局检索：始终搜全量站点，不受当前分类与页面搜索词影响
const siteResults = computed(() => rankSites(sitesStore.sites, query.value, { limit: 8 }))
const actionResults = computed(() =>
  actions.filter(a => a.name.toLowerCase().includes(query.value.toLowerCase()))
)

const groupDefs = [
  { type: 'page', label: '页面', source: pageResults },
  { type: 'domain', label: '方向', source: domainResults },
  { type: 'category', label: '分类', source: categoryResults },
  { type: 'site', label: '站点', source: siteResults },
  { type: 'action', label: '操作', source: actionResults },
]

const allGroups = computed(() =>
  groupDefs
    .map(g => ({ type: g.type, label: g.label, items: g.source.value }))
    .filter(g => g.items.length)
)

const noResults = computed(() => query.value && allGroups.value.length === 0)

function getIndex(groupType, idx) {
  let offset = 0
  for (const group of allGroups.value) {
    if (group.type === groupType) return offset + idx
    offset += group.items.length
  }
  return 0
}

function open() {
  visible.value = true
  query.value = ''
  selectedIndex.value = 0
  nextTick(() => searchBarRef.value?.focus())
}

function close() {
  visible.value = false
  query.value = ''
}

function execute(item) {
  if (item.action) { item.action(); close(); return }
  if (item.url) { window.open('https://' + item.url, '_blank'); close(); return }
  // 方向 / 分类：命令面板是全局跳转，统一落到「全部」范围再套上筛选
  if (item.id) { router.push({ name: 'Home', query: { c: item.id } }); close(); return }
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
  if (e.key === 'Escape') { e.preventDefault(); close() }
}

defineExpose({ open, close })
</script>

<style scoped>
.cp-overlay { position: fixed; inset: 0; z-index: 2000; background: rgba(0, 0, 0, 0.5); display: flex; align-items: flex-start; justify-content: center; padding-top: 15vh; animation: cp-fade-in 0.15s ease; }
.cp-panel { width: 580px; max-width: 90vw; max-height: 70vh; background: var(--bg-white); border-radius: var(--radius-lg); box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2); overflow: hidden; display: flex; flex-direction: column; animation: cp-slide-up 0.2s ease; }
@media (prefers-reduced-motion: reduce) { .cp-overlay, .cp-panel { animation: none; } }
.cp-hints { padding: 10px 16px; border-top: 1px solid var(--border); text-align: center; flex-shrink: 0; }
.cp-hint-row { font-size: 12px; color: var(--text-secondary); display: flex; align-items: center; justify-content: center; gap: 4px; }
.cp-hint-row kbd { font-size: 11px; padding: 1px 5px; border: 1px solid var(--border); border-radius: 4px; background: var(--border-light); color: var(--text-secondary); font-family: inherit; line-height: 1.4; }
@keyframes cp-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes cp-slide-up { from { opacity: 0; transform: translateY(-8px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
</style>