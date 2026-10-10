<template>
  <div class="card"
       :class="[
         { 'card-list': isList, 'card-batch': batchMode, 'card-selected': selected, 'card-highlight': isHighlighted, 'card-archived': site.archived },
         isList ? '' : 'density-' + density
       ]"
       :data-site-id="site.id"
       :data-visited="visited ? '1' : '0'"
       role="button"
       tabindex="0"
       :aria-label="ariaLabel"
       :title="titleAttr"
       @click="onCardClick"
       @keydown.enter.prevent="onActivate"
       @keydown.space.prevent="onActivate"
       @contextmenu.prevent="openMenu"
       @mouseenter="onHover" @mouseleave="onHoverLeave">
    <!-- 批量选择复选框 -->
    <div v-if="batchMode" class="card-checkbox" :class="{ checked: selected }">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline v-if="selected" points="20 6 9 17 4 12"/>
      </svg>
    </div>

    <div class="card-header">
      <div v-if="showDragHandle && !batchMode" class="drag-handle" title="拖拽排序" @click.stop>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      </div>
      <div class="card-favicon" :style="{ background: site.color }">
        <span class="favicon-fallback">{{ site.initial }}</span>
        <img v-if="iconSrc" :src="iconSrc" :alt="site.name" class="favicon-img" loading="lazy" @error="$event.target.remove()">
        <!-- 在线状态角标 -->
        <span v-if="display.health" class="health-dot" :class="'health-' + healthNode"
              :title="healthTip" @click.stop></span>
      </div>
      <div v-if="!isList" class="card-title-group">
        <div class="card-title">{{ site.name }}</div>
        <div class="card-url">{{ site.url }}</div>
      </div>
    </div>
    <div v-if="!isList && showDesc" class="card-body">
      <div class="card-desc">{{ site.desc }}</div>
    </div>
    <!-- 别名：人们实际怎么称呼这个站（GPT / 小狐狸 / 抱抱脸），详细档才铺开占位 -->
    <div v-if="!isList && showAliases" class="card-aliases">
      别名 · {{ aliases.join(' / ') }}
    </div>
    <!-- 用途标签：与分类是两把正交的尺子，分类说「属于哪」，用途说「拿来干嘛」 -->
    <div v-if="!isList && showPurposesByDensity && display.purposes && purposeIds.length" class="card-purposes">
      <PurposeTags :ids="purposeIds" />
    </div>
    <div v-if="!batchMode" class="card-footer">
      <div class="card-footer-left">
        <span v-if="display.categoryTag" class="card-tag">
          <span class="card-tag-dot" :style="{ background: categoriesStore.getCategoryColor(site.categoryId) }"></span>
          {{ categoriesStore.getCategoryLabel(site.categoryId) }}
        </span>
        <span v-if="display.badges && site.pinned" class="card-pinned" title="已置顶">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 4 19 4"/><line x1="12" y1="8" x2="12" y2="20"/><polyline points="8 12 12 8 16 12"/></svg>
        </span>
        <span v-if="site.archived" class="card-archived-tag" title="已归档：不参与日常浏览">已归档</span>
        <span v-if="display.badges && showUnvisited && !visited" class="card-unvisited" title="还没访问过">未访问</span>
        <span v-if="display.heat && clickCount > 0" class="card-clicks" :class="heatClass" :title="'全网累计点击 ' + clickCount + ' 次（所有访客）'">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>
          {{ clickCount }}
        </span>
      </div>
      <div class="card-actions">
        <button class="card-fav-btn" :class="{ favorited: isFav }"
                @click.stop="favoritesStore.toggle(site.id)" :aria-label="isFav ? '取消收藏' : '收藏'">
          <svg viewBox="0 0 24 24" :fill="isFav ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        </button>
        <a :href="'https://' + site.url" target="_blank" rel="noopener noreferrer"
           class="card-visit" @click.stop="onVisit" :aria-label="'访问 ' + site.name">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
        </a>
      </div>
    </div>
    <!-- 列表模式的内联描述 -->
    <div v-if="isList && !batchMode" class="card-body-inline">
      <div class="card-title">{{ site.name }}</div>
      <div class="card-desc">{{ site.desc }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useFavoritesStore } from '@/stores/favorites'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { useHistoryStore } from '@/stores/history'
import { useSidebarStore } from '@/stores/sidebar'
import { useHealthStore } from '@/stores/health'
import { useClicksStore } from '@/stores/clicks'
import { useContextMenuStore } from '@/stores/contextMenu'
import { usePreferencesStore } from '@/stores/preferences'
import { openInNewTab } from '@/utils/open'
import PurposeTags from '@/components/PurposeTags.vue'

const props = defineProps({
  site: { type: Object, required: true },
  isList: { type: Boolean, default: false },
  isReadOnly: { type: Boolean, default: false },
  showDragHandle: { type: Boolean, default: false },
  batchMode: { type: Boolean, default: false },
  selected: { type: Boolean, default: false },
  /** 信息密度：compact 只留名称与域名；standard 为当前形态；rich 再补别名 */
  density: { type: String, default: 'standard' }
})

const emit = defineEmits(['edit', 'delete', 'select'])

const favoritesStore = useFavoritesStore()
const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()
const historyStore = useHistoryStore()
const sidebarStore = useSidebarStore()
const healthStore = useHealthStore()
const clicksStore = useClicksStore()
const contextMenuStore = useContextMenuStore()
const preferencesStore = usePreferencesStore()

/** 卡片元素显隐（在线角标 / 热度 / 分类标签 / 用途标签 / 徽章），由「卡片设置」控制 */
const display = computed(() => preferencesStore.cardDisplay)

/* ---------- 信息密度分层 ---------- */

const showDesc = computed(() => props.density !== 'compact')
// 用途标签受两道开关约束：信息密度（紧凑档不铺开）与「卡片设置」里的显隐
const showPurposesByDensity = computed(() => props.density !== 'compact')
const aliases = computed(() => (Array.isArray(props.site.aliases) ? props.site.aliases.filter(Boolean) : []))
const showAliases = computed(() => props.density === 'rich' && aliases.value.length > 0)

// 全网点击量（所有访客累计）——点完立刻 +1，不等云端往返
const clickCount = computed(() => clicksStore.countFor(props.site.id))

// 是否访问过（本机浏览历史）。300 个站"哪些还没看过"是高频诉求
const visited = computed(() => Boolean(historyStore.getLastVisitTime(props.site.id)))

// 「未访问」徽章只在「详细」档出现。默认档若常驻会在首次访问时铺满全部卡片
// （浏览器实测：新会话下 300 张卡全挂「未访问」，纯噪音），而信息量只有在
// 你已经看过一部分之后才成立 —— 所以做成 opt-in。
const showUnvisited = computed(() => props.density === 'rich')

const isFav = computed(() => favoritesStore.isFav(props.site.id))

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

const ariaLabel = computed(() =>
  props.batchMode ? `选择 ${props.site.name}` : `打开 ${props.site.name}`
)

// 别名只占一行会挤，放到原生 tooltip 里：鼠标停一下就能看到「它还有什么叫法」
const titleAttr = computed(() => {
  const base = `${props.site.name} · ${props.site.url}`
  return aliases.value.length ? `${base}\n别名：${aliases.value.join('、')}` : base
})

/* ---------- 主操作 ---------- */

/** 打开站点：卡片主体、回车、空格、右下角箭头都走这里，口径一致 */
function openSite() {
  // 走 openInNewTab（锚点导航）而不是 window.open —— 后者带 features 参数时属于弹窗请求，
  // 在内嵌 WebView / 弹窗拦截下会变成「覆盖当前页」。详见 src/utils/open.js 顶部注释。
  openInNewTab('https://' + props.site.url)
  sitesStore.recordVisit(props.site.id)
  historyStore.addRecord(props.site.id)
}

/** 批量选择：把这条站点交给父级（父级据此 toggleSelect，无需在模板里写内联闭包） */
function onCardClick() {
  if (props.batchMode) emit('select', props.site)
  else openSite()
}

function onActivate() {
  if (props.batchMode) emit('select', props.site)
  else openSite()
}

function onVisit() {
  sitesStore.recordVisit(props.site.id)
  historyStore.addRecord(props.site.id)
}

function openMenu(e) {
  contextMenuStore.open({
    x: e.clientX,
    y: e.clientY,
    site: props.site,
    // 批量模式下只给只读项（收藏 / 新窗口 / 复制），编辑与删除隐藏
    readOnly: props.batchMode || props.isReadOnly,
    handlers: {
      detail: () => sidebarStore.showDetail(props.site),
      edit: () => emit('edit', props.site),
      remove: () => emit('delete', props.site)
    }
  })
}

function onHover() {
  if (sidebarStore.rightCollapsed) return
  sidebarStore.setHoveredSite(props.site)
}

function onHoverLeave() {
  sidebarStore.clearHoveredSite()
}
</script>

<style scoped>
.card {
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--card-padding, 18px);
  transition: all var(--transition);
  /* 卡片主体就是「打开站点」这一个动作，光标必须说得出这件事 */
  cursor: pointer;
  position: relative;
  border-left: 3px solid transparent;
  box-shadow: var(--shadow-card);
  animation: fadeInUp calc(0.35s * var(--card-anim, 1)) ease both;
}
.card:hover {
  box-shadow: var(--shadow-hover);
  transform: translateY(-2px);
}
/* 键盘可达：焦点环要走 outline，与 hover 的位移区分开 */
.card:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.card-header { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 10px; }
/* 卡片大小：内容整体缩放（图标、字号、控件），间距另有 --card-padding 与 --grid-gap 管。
   --card-scale 是无单位乘数，来自「卡片设置 → 卡片大小」。 */
.card { --cs: var(--card-scale, 1); }
.card-favicon { width: calc(38px * var(--cs)); height: calc(38px * var(--cs)); border-radius: calc(10px * var(--cs)); flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: calc(15px * var(--cs)); color: var(--color-on-solid); transition: transform .2s ease; position: relative; overflow: hidden; }
.favicon-fallback { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
.favicon-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; padding: 2px; background: var(--bg-white); box-sizing: border-box; }
.card:hover .card-favicon { transform: scale(1.05); }

/* 在线状态角标 */
.health-dot {
  position: absolute;
  right: 2px;
  bottom: 2px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 2px solid var(--bg-white);
  box-shadow: 0 0 2px rgba(0,0,0,.35);
  z-index: 2;
}
.health-ok   { background: var(--color-ok); }
.health-limited { background: var(--color-warn); }
.health-down { background: var(--color-danger); }
.health-unknown,
.health-gray { background: var(--color-muted); }
.card-title-group { min-width: 0; }
.card-title { font-size: calc(14px * var(--cs, 1)); font-weight: var(--title-weight, 600); color: var(--text-primary); line-height: 1.3; }
.card-url { font-size: calc(11px * var(--cs, 1)); color: var(--text-secondary); margin-top: 2px; font-weight: 400; }
.card-body { flex: 1; }
.card-desc { font-size: calc(13px * var(--cs, 1)); color: var(--text-secondary); line-height: 1.55; margin-bottom: calc(12px * var(--cs, 1)); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
/* 详细档多给一行描述，把「别名」让出来的空间补回去 */
.density-rich .card-desc { -webkit-line-clamp: 3; }
.card-aliases { font-size: calc(11px * var(--cs, 1)); color: var(--text-secondary); opacity: .85; margin: 0 0 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-purposes { margin: 0 0 12px; }
/* 简洁档：不给描述与用途留位，只保留「图标 + 名称 + 域名 + 底栏」 */
.density-compact .card-header { margin-bottom: 4px; }
.card-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.card-footer-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
/* 归档：只在归档范围内出现，用降饱和 + 灰边把「不再日常用」表达出来，
   但不做整卡 disable —— 它仍可打开、可取消归档 */
.card-archived { opacity: .72; border-style: dashed; }
.card-archived:hover { opacity: 1; }
.card-archived-tag {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 999px;
  color: var(--text-secondary);
  background: var(--border-light);
  flex-shrink: 0;
}
/* 置顶：与「未访问」同为底栏小徽章，一左一右表达「常用」与「没看过」 */
.card-pinned {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  flex-shrink: 0;
}
.card-pinned svg { width: 11px; height: 11px; }
/* 未访问：极淡的标记，只用来在 300 条里快速分辨「我还没看过」 */
.card-unvisited {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 999px;
  color: var(--text-secondary);
  border: 1px dashed var(--border);
  flex-shrink: 0;
  opacity: .8;
}
/* 点击量做成热度徽章：不再是角落里一行灰字，数字要一眼看出「这条站多热」 */
.card-clicks {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: calc(11px * var(--cs, 1));
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  flex-shrink: 0;
}
.card-clicks svg { width: 12px; height: 12px; }
.card-clicks.warm { color: var(--color-heat-warm); background: var(--color-heat-warm-bg); }
.card-clicks.hot { color: var(--color-heat-hot); background: var(--color-heat-hot-bg); }
.card-clicks.hot svg { animation: flamePulse 1.4s ease-in-out infinite; }

@keyframes flamePulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.18); opacity: .8; }
}
.card-tag { font-size: calc(11px * var(--cs, 1)); font-weight: 600; padding: 3px 10px; border-radius: 20px; background: var(--border-light); color: var(--text-secondary); display: flex; align-items: center; gap: 5px; }
.card-tag-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
.card-actions { display: flex; align-items: center; gap: 4px; }
.card-visit, .card-fav-btn {
  width: calc(30px * var(--cs, 1)); height: calc(30px * var(--cs, 1));
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
.card-visit:hover { background: var(--accent); border-color: var(--accent); color: var(--color-on-solid); transform: scale(1.1); }
.card-fav-btn:hover { color: var(--color-favorite); border-color: var(--color-favorite-border); transform: scale(1.1); }
.card-fav-btn.favorited { color: var(--color-favorite); border-color: var(--color-favorite-border); background: var(--color-favorite-bg); }
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
.card-checkbox svg { width: 12px; height: 12px; color: var(--color-on-solid); }

/* 列表模式 */
.card-list { display: flex; align-items: center; gap: 16px; padding: 12px 18px; border-left-width: 3px; }
.card-list .card-header { margin-bottom: 0; flex: 0 0 auto; }
.card-list .card-favicon { width: calc(34px * var(--cs, 1)); height: calc(34px * var(--cs, 1)); border-radius: 8px; font-size: calc(13px * var(--cs, 1)); }
.card-list .card-body-inline { flex: 1; min-width: 0; }
.card-list .card-body-inline .card-desc { margin-bottom: 0; -webkit-line-clamp: 1; }
.card-list .card-footer { flex: 0 0 auto; }
.card-list:hover { transform: translateX(2px) translateY(0); }
</style>
