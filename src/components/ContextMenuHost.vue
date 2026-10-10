<template>
  <Teleport to="body">
    <div v-if="menu.visible && menu.site"
         class="context-menu" role="menu"
         :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
         @click.stop @contextmenu.prevent>
      <button type="button" class="context-menu-item" role="menuitem" @click="toggleFav">
        <svg viewBox="0 0 24 24" :fill="isFav ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        {{ isFav ? '取消收藏' : '收藏' }}
      </button>
      <button type="button" class="context-menu-item" role="menuitem" @click="openNewWindow">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
        新窗口打开
      </button>
      <button type="button" class="context-menu-item" role="menuitem" @click="copyLink">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        {{ copied ? '已复制' : '复制链接' }}
      </button>

      <button type="button" class="context-menu-item" role="menuitem" @click="run('detail')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        查看详情
      </button>

      <button type="button" class="context-menu-item" role="menuitem" @click="togglePin">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 4 19 4"/><line x1="12" y1="8" x2="12" y2="20"/><polyline points="8 12 12 8 16 12"/></svg>
        {{ site.pinned ? '取消置顶' : '置顶' }}
      </button>

      <button type="button" class="context-menu-item" role="menuitem" @click="toggleArchive">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"/><line x1="10" y1="13" x2="14" y2="13"/></svg>
        {{ site.archived ? '取消归档' : '归档' }}
      </button>

      <template v-if="!menu.readOnly">
        <div class="context-menu-divider"></div>
        <button type="button" class="context-menu-item" role="menuitem" @click="run('edit')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          编辑
        </button>
        <button type="button" class="context-menu-item context-menu-danger" role="menuitem" @click="run('remove')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          删除
        </button>
      </template>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useContextMenuStore } from '@/stores/contextMenu'
import { useFavoritesStore } from '@/stores/favorites'
import { useSitesStore } from '@/stores/sites'
import { useHistoryStore } from '@/stores/history'
import { openInNewTab } from '@/utils/open'

const menu = useContextMenuStore()
const favoritesStore = useFavoritesStore()
const sitesStore = useSitesStore()
const historyStore = useHistoryStore()

const copied = ref(false)
let copyTimer = null

const site = computed(() => menu.site)
const isFav = computed(() => (site.value ? favoritesStore.isFav(site.value.id) : false))

function toggleFav() {
  if (site.value) favoritesStore.toggle(site.value.id)
  menu.close()
}

function openNewWindow() {
  if (!site.value) return
  openInNewTab('https://' + site.value.url)
  sitesStore.recordVisit(site.value.id)
  historyStore.addRecord(site.value.id)
  menu.close()
}

function copyLink() {
  if (!site.value) return
  navigator.clipboard.writeText('https://' + site.value.url)
  copied.value = true
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => { copied.value = false }, 2000)
  menu.close()
}

/** 编辑 / 删除由打开方（卡片 → 容器）注入，菜单只负责转发 */
function run(action) {
  const fn = menu.handlers?.[action]
  menu.close()
  fn?.()
}

/** 置顶 / 归档都不需要打开方参与：直接改站点数据即可 */
function togglePin() {
  if (site.value) sitesStore.togglePin(site.value.id)
  menu.close()
}

function toggleArchive() {
  if (site.value) sitesStore.toggleArchive(site.value.id)
  menu.close()
}

// 单例监听：全站只有这一组，与卡片数量无关
function onDocClick() { if (menu.visible) menu.close() }
function onScroll() { if (menu.visible) menu.close() }
function onKeydown(e) { if (e.key === 'Escape' && menu.visible) menu.close() }

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('scroll', onScroll, true)
  document.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('scroll', onScroll, true)
  document.removeEventListener('keydown', onKeydown)
  clearTimeout(copyTimer)
})
</script>

<!-- 非 scoped：内容 Teleport 到 body，样式必须是全局的 -->
<style>
.context-menu {
  position: fixed;
  z-index: 500;
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 4px;
  min-width: 160px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, .15);
}
.context-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  text-align: left;
  color: var(--text-primary);
  transition: background .1s ease;
}
.context-menu-item:hover { background: var(--border-light); }
.context-menu-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.context-menu-item svg { width: 15px; height: 15px; color: var(--text-secondary); flex-shrink: 0; }
.context-menu-danger { color: var(--color-danger); }
.context-menu-danger svg { color: var(--color-danger); }
.context-menu-divider { height: 1px; background: var(--border); margin: 4px 8px; }
</style>
