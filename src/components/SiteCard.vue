<template>
  <div class="card"
       :class="{ 'card-list': isList, 'card-batch': batchMode, 'card-selected': selected, 'card-highlight': isHighlighted }"
       :data-site-id="site.id"
       @click="onCardClick" @contextmenu.prevent="batchMode ? null : showContextMenu($event)"
       @mouseenter="onHover" @mouseleave="onHoverLeave">
    <!-- 批量选择复选框 -->
    <div v-if="batchMode" class="card-checkbox" :class="{ checked: selected }">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline v-if="selected" points="20 6 9 17 4 12"/>
      </svg>
    </div>

    <div class="card-header">
      <div v-if="showDragHandle && !batchMode" class="drag-handle" title="拖拽排序">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      </div>
      <div class="card-favicon" :style="{ background: site.color }">
        <span class="favicon-fallback">{{ site.initial }}</span>
        <img v-if="iconSrc" :src="iconSrc" :alt="site.name" class="favicon-img" loading="lazy" @error="$event.target.remove()">
        <!-- 在线状态角标 -->
        <span class="health-dot" :class="'health-' + healthNode"
              :title="healthTip" @click.stop></span>
      </div>
      <div v-if="!isList" class="card-title-group">
        <div class="card-title">{{ site.name }}</div>
        <div class="card-url">{{ site.url }}</div>
      </div>
    </div>
    <div v-if="!isList" class="card-body">
      <div class="card-desc">{{ site.desc }}</div>
    </div>
    <!-- 用途标签：与分类是两把正交的尺子，分类说「属于哪」，用途说「拿来干嘛」 -->
    <div v-if="!isList && purposeIds.length" class="card-purposes">
      <PurposeTags :ids="purposeIds" />
    </div>
    <div v-if="!batchMode" class="card-footer">
      <div class="card-footer-left">
        <span class="card-tag">
          <span class="card-tag-dot" :style="{ background: categoriesStore.getCategoryColor(site.categoryId) }"></span>
          {{ categoriesStore.getCategoryLabel(site.categoryId) }}
        </span>
        <span v-if="clickCount > 0" class="card-clicks" :class="heatClass" :title="'全网累计点击 ' + clickCount + ' 次（所有访客）'">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>
          {{ clickCount }}
        </span>
      </div>
      <div class="card-actions">
        <button class="card-fav-btn" :class="{ favorited: favoritesStore.isFav(site.id) }"
                @click.stop="favoritesStore.toggle(site.id)" :aria-label="favoritesStore.isFav(site.id) ? '取消收藏' : '收藏'">
          <svg viewBox="0 0 24 24" :fill="favoritesStore.isFav(site.id) ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        </button>
        <a :href="'https://' + site.url" target="_blank" rel="noopener noreferrer"
           class="card-visit" @click="onVisit" :aria-label="'访问 ' + site.name">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
        </a>
      </div>
    </div>
    <!-- 列表模式的内联描述 -->
    <div v-if="isList && !batchMode" class="card-body-inline">
      <div class="card-title">{{ site.name }}</div>
      <div class="card-desc">{{ site.desc }}</div>
    </div>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div v-if="contextMenu.visible" class="context-menu"
           :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
           @click.stop @contextmenu.prevent>
        <div class="context-menu-item" @click="toggleFav">
          <svg viewBox="0 0 24 24" :fill="favoritesStore.isFav(props.site.id) ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          {{ favoritesStore.isFav(props.site.id) ? '取消收藏' : '收藏' }}
        </div>
        <div class="context-menu-item" @click="openNewWindow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          新窗口打开
        </div>
        <div class="context-menu-item" @click="copyLink">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          复制链接
        </div>
        <div class="context-menu-item" @click="editSite" v-if="!isReadOnly">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          编辑
        </div>
        <div class="context-menu-divider" v-if="!isReadOnly"></div>
        <div class="context-menu-item context-menu-danger" @click="deleteSite" v-if="!isReadOnly">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          删除
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { useFavoritesStore } from '@/stores/favorites'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { useHistoryStore } from '@/stores/history'
import { useSidebarStore } from '@/stores/sidebar'
import { useHealthStore } from '@/stores/health'
import { useClicksStore } from '@/stores/clicks'
import PurposeTags from '@/components/PurposeTags.vue'

const props = defineProps({
  site: { type: Object, required: true },
  isList: { type: Boolean, default: false },
  isReadOnly: { type: Boolean, default: false },
  showDragHandle: { type: Boolean, default: false },
  batchMode: { type: Boolean, default: false },
  selected: { type: Boolean, default: false }
})

const emit = defineEmits(['edit', 'delete', 'select'])

const favoritesStore = useFavoritesStore()
const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()
const historyStore = useHistoryStore()
const sidebarStore = useSidebarStore()
const healthStore = useHealthStore()
const clicksStore = useClicksStore()

// 全网点击量（所有访客累计）——点完立刻 +1，不等云端往返
const clickCount = computed(() => clicksStore.countFor(props.site.id))

// 热度分档：数字本身要说得出「这条站有多热」，光给个数字用户不会去比大小
const heatClass = computed(() => {
  const n = clickCount.value
  if (n >= 1000) return 'hot'
  if (n >= 100) return 'warm'
  return ''
})

// 用途 id 列表（词表外的脏值由 PurposeTags 自行过滤）
const purposeIds = computed(() => (Array.isArray(props.site.purposes) ? props.site.purposes : []))

// 自动添加 / 定位复看时的高亮描边：由 sitesStore 统一计时清除
const isHighlighted = computed(() => sitesStore.highlightSiteId === props.site.id)

// 正式收录的站点有本地图标文件（icons/xx.png）；访客自己新增的只有远程图标地址
const iconSrc = computed(() => props.site.icon ? '/' + props.site.icon : (props.site.iconUrl || ''))

// 在线状态角标
const healthState = computed(() => healthStore.getStatus(props.site.id))
const healthNode = computed(() => healthState.value.status)   // ok|limited|down|unknown
const healthTip = computed(() => {
  const m = { ok: '在线', limited: '限流/需验证', down: '无法访问', unknown: '状态未知' }
  const code = healthState.value.code
  return m[healthState.value.status] + (code ? ` (HTTP ${code})` : '')
})

// 进入视口后触发探测（避免一加载就并发打全部）
watch(() => props.site.id, (id) => {
  if (id) healthStore.probeSites([props.site])
}, { immediate: true })

const contextMenu = reactive({
  visible: false,
  x: 0,
  y: 0
})

function onCardClick() {
  if (props.batchMode) {
    emit('select')
  }
}

function onVisit() {
  sitesStore.recordVisit(props.site.id)
  historyStore.addRecord(props.site.id)
}

function onHover() {
  if (sidebarStore.rightCollapsed) return
  sidebarStore.setHoveredSite(props.site)
}

function onHoverLeave() {
  sidebarStore.clearHoveredSite()
}

function showContextMenu(e) {
  contextMenu.visible = true
  let x = e.clientX
  let y = e.clientY
  const menuWidth = 180
  const menuHeight = 160
  if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 8
  if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 8
  if (x < 8) x = 8
  if (y < 8) y = 8
  contextMenu.x = x
  contextMenu.y = y
}

function hideContextMenu() {
  contextMenu.visible = false
}

function toggleFav() {
  favoritesStore.toggle(props.site.id)
  hideContextMenu()
}

function openNewWindow() {
  window.open('https://' + props.site.url, '_blank', 'noopener,noreferrer')
  sitesStore.recordVisit(props.site.id)
  historyStore.addRecord(props.site.id)
  hideContextMenu()
}

function copyLink() {
  navigator.clipboard.writeText('https://' + props.site.url)
  hideContextMenu()
}

function editSite() {
  emit('edit', props.site)
  hideContextMenu()
}

function deleteSite() {
  emit('delete', props.site)
  hideContextMenu()
}

onMounted(() => {
  document.addEventListener('click', hideContextMenu)
  document.addEventListener('scroll', hideContextMenu, true)
})

onUnmounted(() => {
  document.removeEventListener('click', hideContextMenu)
  document.removeEventListener('scroll', hideContextMenu, true)
})
</script>

<style scoped>
.card {
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--card-padding, 18px);
  transition: all var(--transition);
  cursor: default;
  position: relative;
  border-left: 3px solid transparent;
  box-shadow: var(--shadow-card);
  animation: fadeInUp calc(0.35s * var(--card-anim, 1)) ease both;
}
.card:hover {
  box-shadow: var(--shadow-hover);
  transform: translateY(-2px);
}
.card-header { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 10px; }
.card-favicon { width: 38px; height: 38px; border-radius: 10px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px; color: #fff; transition: transform .2s ease; position: relative; overflow: hidden; }
.favicon-fallback { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
.favicon-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; padding: 2px; background: #fff; box-sizing: border-box; }
.card:hover .card-favicon { transform: scale(1.05); }

/* 在线状态角标 */
.health-dot {
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 2px solid #fff;
  box-shadow: 0 0 2px rgba(0,0,0,.35);
  z-index: 2;
}
.health-ok   { background: #22c55e; }
.health-limited { background: #f59e0b; }
.health-down { background: #ef4444; }
.health-unknown,
.health-gray { background: #94a3b8; }
.card-title-group { min-width: 0; }
.card-title { font-size: 14px; font-weight: var(--title-weight, 600); color: var(--text-primary); line-height: 1.3; }
.card-url { font-size: 11px; color: var(--text-secondary); margin-top: 2px; font-weight: 400; }
.card-body { flex: 1; }
.card-desc { font-size: 13px; color: var(--text-secondary); line-height: 1.55; margin-bottom: 12px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.card-purposes { margin: 0 0 12px; }
.card-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.card-footer-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
/* 点击量做成热度徽章：不再是角落里一行灰字，数字要一眼看出「这条站多热」 */
.card-clicks {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  flex-shrink: 0;
}
.card-clicks svg { width: 12px; height: 12px; }
.card-clicks.warm { color: #b45309; background: color-mix(in srgb, #f59e0b 18%, transparent); }
.card-clicks.hot { color: #dc2626; background: color-mix(in srgb, #ef4444 16%, transparent); }
.card-clicks.hot svg { animation: flamePulse 1.4s ease-in-out infinite; }

@keyframes flamePulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.18); opacity: .8; }
}
.card-tag { font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 20px; background: var(--border-light); color: var(--text-secondary); display: flex; align-items: center; gap: 5px; }
.card-tag-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
.card-actions { display: flex; align-items: center; gap: 4px; }
.card-visit, .card-fav-btn {
  width: 30px; height: 30px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-white);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all .2s cubic-bezier(.4,0,.2,1);
  color: var(--text-secondary);
}
.card-visit:hover { background: var(--accent); border-color: var(--accent); color: #fff; transform: scale(1.1); }
.card-fav-btn:hover { color: #eab308; border-color: #eab308; transform: scale(1.1); }
.card-fav-btn.favorited { color: #eab308; border-color: #eab308; background: #fefce8; }
.card-fav-btn:active { transform: scale(0.9); }
.card-fav-btn svg, .card-visit svg { width: 14px; height: 14px; transition: transform .2s ease; }
.card-fav-btn.favorited svg { animation: heartPop 0.3s ease; }
.card-visit { text-decoration: none; }
.drag-handle { cursor: grab; color: var(--text-secondary); opacity: 0.5; display: flex; align-items: center; padding: 4px; border-radius: 4px; transition: opacity var(--transition); flex-shrink: 0; }
.drag-handle:hover { opacity: 1; }
.drag-handle:active { cursor: grabbing; }
.drag-handle svg { width: 14px; height: 14px; }

@keyframes heartPop {
  0% { transform: scale(1); }
  50% { transform: scale(1.3); }
  100% { transform: scale(1); }
}

/* 批量选择模式 */
.card-batch { cursor: pointer; }
.card-batch:hover { border-left-color: var(--accent); }
.card-selected { background: var(--accent-light); border-color: var(--accent); border-left-color: var(--accent); box-shadow: 0 0 0 1px rgba(0,113,227,.2); }
/* 高亮：描边 + 一圈光晕。走 transition 而非 animation —— .card 已占了 animation（fadeInUp），
   再叠一个会互相覆盖，导致卡片入场跳变。2.5s 后由 store 清掉 class，自然淡出。 */
.card.card-highlight {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-left-color: var(--accent);
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 18%, transparent), var(--shadow-hover);
  transform: translateY(-2px);
}
@media (prefers-reduced-motion: reduce) {
  .card.card-highlight { transform: none; }
}
.card-checkbox {
  position: absolute; top: 12px; right: 12px; z-index: 2;
  width: 22px; height: 22px; border-radius: 50%;
  border: 2px solid var(--border); background: var(--bg-white);
  display: flex; align-items: center; justify-content: center;
  transition: all .15s ease;
}
.card-checkbox.checked { background: var(--accent); border-color: var(--accent); }
.card-checkbox svg { width: 12px; height: 12px; color: #fff; }

/* 列表模式 */
.card-list { display: flex; align-items: center; gap: 16px; padding: 12px 18px; border-left-width: 3px; }
.card-list .card-header { margin-bottom: 0; flex: 0 0 auto; }
.card-list .card-favicon { width: 34px; height: 34px; border-radius: 8px; font-size: 13px; }
.card-list .card-body-inline { flex: 1; min-width: 0; }
.card-list .card-body-inline .card-desc { margin-bottom: 0; -webkit-line-clamp: 1; }
.card-list .card-footer { flex: 0 0 auto; }
.card-list:hover { transform: translateX(2px) translateY(0); }
</style>

<!-- 全局右键菜单样式（非 scoped，因为 Teleport 到 body） -->
<style>
.context-menu {
  position: fixed;
  z-index: 500;
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 4px;
  min-width: 160px;
  box-shadow: 0 8px 30px rgba(0,0,0,.15);
}
.context-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
  transition: background .1s ease;
}
.context-menu-item:hover { background: var(--border-light); }
.context-menu-item svg { width: 15px; height: 15px; color: var(--text-secondary); flex-shrink: 0; }
.context-menu-danger { color: #ef4444; }
.context-menu-danger svg { color: #ef4444; }
.context-menu-divider { height: 1px; background: var(--border); margin: 4px 8px; }
</style>