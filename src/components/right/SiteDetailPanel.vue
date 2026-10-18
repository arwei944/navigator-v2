<template>
  <div class="site-detail-panel" :key="site.id">
    <!-- ================= 编辑态 =================
         刻意**不受区块开关约束**：编辑态是一张表单，要能改到别名，
         即便用户把「别名」区块关掉了 —— 那正是"我不想平时看到它"，
         而不是"我不许改它"。若也跟着过滤，关掉区块就等于把字段锁死了。 -->
    <form v-if="editing" class="detail-edit" @submit.prevent="saveEdit">
      <div class="edit-head">
        <span class="edit-head-title">编辑站点信息</span>
      </div>

      <div class="form-group">
        <label class="form-label">名称</label>
        <input v-model="form.name" type="text" required class="form-input" placeholder="站点名称">
      </div>

      <div class="form-group">
        <label class="form-label">网址</label>
        <input v-model="form.url" type="text" required class="form-input" placeholder="example.com" @blur="completeUrl">
        <span class="form-hint">只存域名，协议 / 路径 / www. 会自动去掉</span>
      </div>

      <div class="form-group">
        <label class="form-label">简介</label>
        <textarea v-model="form.desc" class="form-input form-textarea" rows="3" placeholder="一句话描述这个站点"></textarea>
      </div>

      <div class="form-group">
        <label class="form-label">分类</label>
        <select v-model="form.categoryId" class="form-input">
          <option v-for="cat in categoriesStore.categories" :key="cat.id" :value="cat.id">{{ cat.label }}</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">别名 <span class="form-hint">俗称 / 缩写，用「、」或逗号分隔</span></label>
        <input v-model="form.aliases" type="text" class="form-input" placeholder="例如: 币安、Binance">
      </div>

      <div class="form-group">
        <label class="form-label">用途 <span class="form-hint">最多 {{ MAX_PURPOSES }} 个</span></label>
        <PurposePicker :model-value="form.purposes" @update:model-value="form.purposes = normalizePurposes($event)" />
      </div>

      <div class="edit-actions">
        <button type="button" class="edit-btn" @click="cancelEdit">取消</button>
        <button type="submit" class="edit-btn primary">保存</button>
      </div>
    </form>

    <!-- ================= 阅读态 ================= -->
    <template v-else>
      <!-- 站点头部（不可关：面板总要有主体） -->
      <div class="detail-header" :style="{ '--site-color': site.color || '#64748b' }">
        <div class="detail-icon" :style="{ background: site.color || '#64748b' }">
          <span class="favicon-fallback">{{ site.initial || site.name.charAt(0).toUpperCase() }}</span>
          <img v-if="site.icon" :src="'/' + site.icon" :alt="site.name" class="favicon-img" loading="lazy" @error="$event.target.remove()">
        </div>
        <div class="detail-title-group">
          <h3 class="detail-name">{{ site.name }}</h3>
          <span class="detail-domain">{{ formatDomain(site.url) }}</span>
        </div>
        <button class="detail-edit-btn" title="编辑站点信息" aria-label="编辑站点信息" @click="startEdit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      </div>

      <!-- 分类标签（不可关） -->
      <div class="detail-category">
        <span class="category-tag" :style="{ '--cat-color': categoryColor }">
          <span class="category-dot" :style="{ background: categoryColor }"></span>
          {{ categoryLabel }}
        </span>
      </div>

      <!-- 别名：人们实际怎么称呼这个站（GPT / 小狐狸 / 抱抱脸）。
           搜索早就能按别名命中，人也该在详情里看得到它还有什么叫法。 -->
      <div v-if="show.aliases && aliases.length" class="detail-section">
        <div class="section-label">别名</div>
        <div class="alias-list">
          <span v-for="a in aliases" :key="a" class="alias-chip">{{ a }}</span>
        </div>
      </div>

      <!-- 用途：与分类正交的第二把尺子 —— 分类说「属于哪」，用途说「拿来干嘛」 -->
      <div v-if="show.purposes && purposeIds.length" class="detail-section">
        <div class="section-label">用途</div>
        <PurposeTags :ids="purposeIds" size="md" />
      </div>

      <!-- 描述 -->
      <div v-if="show.desc" class="detail-section">
        <div class="section-label">简介</div>
        <p class="detail-desc">{{ site.desc || '暂无描述' }}</p>
      </div>

      <!-- 备注：个人批注，不进站点表 —— 一次发布也不会把它冲掉。
           输入即存（300ms 防抖），同浏览器的其他标签页秒级可见。 -->
      <div v-if="show.note" class="detail-section">
        <div class="section-label note-label">
          备注
          <button class="note-pin" :class="{ on: notePinned }" :title="notePinned ? '取消钉在卡片上' : '钉在卡片上'"
                  :disabled="!noteText.trim()" @click="toggleNotePin">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>
            {{ notePinned ? '已钉住' : '钉住' }}
          </button>
        </div>
        <textarea v-model="noteText" class="note-input" rows="3" maxlength="1000"
                  placeholder="记点什么：免费额度、使用注意、要不要挂代理…"
                  @input="onNoteInput" @blur="flushNote"></textarea>
        <div class="note-meta">
          <span class="note-status" :class="{ saving: noteSaving }">{{ noteStatusText }}</span>
          <button v-if="noteText.trim()" class="note-clear" @click="clearNote">清除</button>
        </div>
      </div>

      <!-- 统计信息 -->
      <div v-if="show.stats" class="detail-section">
        <div class="section-label">使用统计</div>
        <div class="stat-grid">
          <div class="stat-item">
            <div class="stat-value">{{ clickCount }}</div>
            <div class="stat-name">全网点击</div>
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
      <div v-if="show.timeline" class="detail-section">
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

      <!-- 相关站点：与图谱页同一个关联度口径，可以从这里「顺着关系走」 -->
      <div v-if="show.related" class="detail-section">
        <div class="section-label">相关站点</div>
        <RelatedSites :site="site" />
      </div>

      <!-- 快速操作 -->
      <div v-if="show.actions" class="detail-actions">
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
    </template>
  </div>
</template>

<script setup>
import { computed, defineAsyncComponent, reactive, ref, watch, onBeforeUnmount } from 'vue'
import { useCategoriesStore } from '@/stores/categories'
import { useFavoritesStore } from '@/stores/favorites'
import { useSitesStore } from '@/stores/sites'
import { useHistoryStore } from '@/stores/history'
import { useClicksStore } from '@/stores/clicks'
import { useSiteNotesStore } from '@/stores/siteNotes'
import { useSidebarStore } from '@/stores/sidebar'
import { usePreferencesStore } from '@/stores/preferences'
import PurposeTags from '@/components/PurposeTags.vue'
import { normalizePurposes, MAX_PURPOSES } from '../../../shared/purposes.mjs'
// 编辑字段归一（域名 / 别名 / 空用途 / initial）与 EditSiteModal 共用一份，避免两个入口漂移
import { siteToForm, buildSitePatch } from '../../../shared/site-edit.mjs'

// 「点开才用」的重组件一律异步：面板本身在首屏，但用途选择器只有进编辑态才需要。
// 静态引入会把它拖进首屏（实测 589.3 → 603.8 KiB，直接越预算）——它原本只出现在
// EditSiteModal 那个异步 chunk 里，正是靠这条边界省下的体积。
const PurposePicker = defineAsyncComponent(() => import('@/components/PurposePicker.vue'))

// 相关站点：带着关联度引擎（affinity），同样只有要显示它时才加载。
// 引擎进首屏的代价比用途选择器更大 —— 图谱页整个 15 KiB chunk 就是它撑起来的。
const RelatedSites = defineAsyncComponent(() => import('@/components/right/RelatedSites.vue'))

const props = defineProps({
  site: { type: Object, default: null }
})

const categoriesStore = useCategoriesStore()
const favoritesStore = useFavoritesStore()
const sitesStore = useSitesStore()
const historyStore = useHistoryStore()
const clicksStore = useClicksStore()
const siteNotesStore = useSiteNotesStore()
const sidebarStore = useSidebarStore()
const prefs = usePreferencesStore()

const copied = ref(false)
let copyTimer = null

/* ---------- 区块显隐 ----------
   只控制「允不允许显示」，**空数据仍然整段不渲染**（沿用既有 `v-if="aliases.length"` 口径）——
   否则会出现"标题下面什么都没有"的空壳。头部与分类标签不在开关范围内。 */
const show = computed(() => prefs.activeRightSections)

/* ---------- 内联编辑 ----------
   不做"输入即存"（备注那种适合纯本地短文本，不适合会进 overlay 并触发同步的结构化字段）：
   改动集中在点「保存」时一次落库。 */

const editing = ref(false)
const form = reactive({ ...siteToForm(null) })

function startEdit() {
  Object.assign(form, siteToForm(props.site))
  editing.value = true
}

function cancelEdit() { editing.value = false }

function saveEdit() {
  if (!props.site) return
  // 落库 patch 由 buildSitePatch 统一构造 —— 与 EditSiteModal 是同一份实现，
  // 「域名怎么取、别名怎么切、空用途传什么」只在一处定义
  const patch = buildSitePatch(form)
  sitesStore.updateSite(props.site.id, patch)
  editing.value = false
}

/** 网址补协议：与 EditSiteModal 的 autoCompleteUrl 同口径（那里是 blur 时补） */
function completeUrl() {
  if (form.url && !/^https?:\/\//.test(form.url)) form.url = 'https://' + form.url
}

/**
 * 编辑期间**占用**面板 —— 让悬停不再抢走内容（见 `shared/right-panel.mjs` 的 `frozen`）。
 * 没有这一步，`hover` 模式下"点铅笔 → 鼠标划过卡片 → 改动全丢"必然发生。
 */
watch(editing, (v) => sidebarStore.setRightFrozen(v))
onBeforeUnmount(() => sidebarStore.setRightFrozen(false))

/* ---------- 备注：输入即存 ----------
   防抖 300ms 是「实时」的手感与写入频率之间的平衡点：再快就会每个按键都写一次
   localStorage 并广播一条消息；再慢就不是「实时备注」了。
   切换站点 / 关闭面板前必须 flush，否则最后一次输入会丢。 */

const SAVE_DEBOUNCE = 300
const noteText = ref('')
const noteSaving = ref(false)
const noteQuota = ref(false)
let noteTimer = null
let currentId = null

const notePinned = computed(() => (currentId ? siteNotesStore.isPinned(currentId) : false))
const noteStatusText = computed(() => {
  if (noteQuota.value) return '备注空间已满，请先清理其他备注'
  if (noteSaving.value) return '保存中…'
  if (!noteText.value.trim()) return '还没写备注'
  return '已保存'
})

function flushNote(id = currentId) {
  clearTimeout(noteTimer)
  if (!id) return
  const draft = noteText.value
  if (draft === siteNotesStore.textOf(id)) return
  const res = siteNotesStore.setText(id, draft)
  noteQuota.value = res.ok === false && res.reason === 'quota'
  noteSaving.value = false
}

function onNoteInput() {
  noteSaving.value = true
  clearTimeout(noteTimer)
  noteTimer = setTimeout(() => flushNote(), SAVE_DEBOUNCE)
}

function clearNote() {
  if (!currentId) return
  flushNote()
  siteNotesStore.remove(currentId)
  noteText.value = ''
  noteQuota.value = false
}

function toggleNotePin() {
  if (!currentId || !noteText.value.trim()) return
  siteNotesStore.togglePin(currentId)
}

// 站点切换：先把上一条的草稿落盘，再载入新站点的备注；顺带退出编辑态
// （编辑态下悬停被 frozen 挡住，能走到这里的切换都是用户明确的动作）
watch(() => props.site?.id, (id, old) => {
  if (old && currentId === old) flushNote(old)
  currentId = id || null
  noteText.value = id ? siteNotesStore.textOf(id) : ''
  noteSaving.value = false
  noteQuota.value = false
  editing.value = false
}, { immediate: true })

// 别处的改动（另一个标签页、云端同步）要回流到输入框，但**不能**覆盖正在编辑的内容
watch(() => (currentId ? siteNotesStore.textOf(currentId) : ''), (v) => {
  if (noteSaving.value) return
  if (v !== noteText.value) noteText.value = v
})

onBeforeUnmount(() => {
  flushNote()
  clearTimeout(noteTimer)
})

const categoryLabel = computed(() =>
  props.site ? categoriesStore.getCategoryLabel(props.site.categoryId) : ''
)
const categoryColor = computed(() =>
  props.site ? categoriesStore.getCategoryColor(props.site.categoryId) : '#64748b'
)
// 用途 id 列表（词表外的脏值由 PurposeTags 过滤），空数组时整段不渲染
const purposeIds = computed(() => (Array.isArray(props.site?.purposes) ? props.site.purposes : []))
// 别名列表（空串过滤），非空才渲染整段
const aliases = computed(() => (Array.isArray(props.site?.aliases) ? props.site.aliases.filter(Boolean) : []))
const isFav = computed(() => (props.site ? favoritesStore.isFavorite(props.site.id) : false))
// 全网点击量（所有访客累计），与「我的访问次数」不是一回事
const clickCount = computed(() => (props.site ? clicksStore.countFor(props.site.id) : 0))
const fullUrl = computed(() => {
  if (!props.site) return '#'
  const url = props.site.url
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  return 'https://' + url
})
const age = computed(() => {
  if (!props.site?.createdAt) return '—'
  const diff = Date.now() - toTs(props.site.createdAt)
  const days = Math.floor(diff / 86400000)
  if (days < 1) return '今天'
  if (days < 30) return days + ' 天'
  const months = Math.floor(days / 30)
  if (months < 12) return months + ' 个月'
  return Math.floor(days / 365) + ' 年'
})
const lastVisit = computed(() => {
  if (!props.site) return '—'
  const last = historyStore.getLastVisitTime(props.site.id)
  if (!last) return '从未访问'
  const diff = Date.now() - toTs(last)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return mins + ' 分钟前'
  const hours = Math.floor(mins / 60)
  if (hours < 24) return hours + ' 小时前'
  const days = Math.floor(hours / 24)
  if (days < 30) return days + ' 天前'
  return formatDate(last)
})

function toTs(ts) {
  return typeof ts === 'number' ? ts : new Date(ts).getTime()
}
function formatDate(ts) {
  if (!ts) return '—'
  const d = new Date(toTs(ts))
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
  if (!props.site) return
  navigator.clipboard.writeText(fullUrl.value)
  copied.value = true
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => { copied.value = false }, 2000)
}
function toggleFav() {
  if (props.site) favoritesStore.toggle(props.site.id)
}
function onVisit() {
  if (!props.site) return
  sitesStore.recordVisit(props.site.id)
  historyStore.addRecord(props.site.id)
}
watch(() => props.site, () => {
  copied.value = false
  clearTimeout(copyTimer)
})
</script>

<style scoped>
.site-detail-panel { padding: 48px 16px 20px; display: flex; flex-direction: column; gap: 16px; animation: fadeSlideIn 0.25s ease; }
@keyframes fadeSlideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.detail-header { display: flex; align-items: center; gap: 12px; }
.detail-icon { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 2px 8px color-mix(in srgb, var(--site-color, #64748b) 30%, transparent); position: relative; overflow: hidden; }
.favicon-fallback { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
.favicon-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; padding: 3px; background: #fff; box-sizing: border-box; border-radius: 12px; }
.detail-icon span { font-size: 18px; font-weight: 700; color: #fff; }
.detail-title-group { min-width: 0; flex: 1; }
.detail-name { font-size: 16px; font-weight: 600; color: var(--text-primary); margin: 0; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.detail-domain { font-size: 12px; color: var(--text-secondary); display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 编辑入口：与折叠把手同样是"低存在感"控件 —— 常态淡、悬停才显形，别跟内容抢焦点 */
.detail-edit-btn { width: 26px; height: 26px; flex-shrink: 0; padding: 0; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--text-secondary); opacity: .45; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all var(--dur-fast) ease; }
.detail-edit-btn:hover { opacity: 1; border-color: var(--border); background: var(--border-light); color: var(--text-primary); }
.detail-edit-btn svg { width: 13px; height: 13px; }
.detail-category { display: flex; }
.category-tag { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; background: color-mix(in srgb, var(--cat-color, #64748b) 10%, transparent); border: 1px solid color-mix(in srgb, var(--cat-color, #64748b) 20%, transparent); border-radius: 6px; font-size: 11px; font-weight: 500; color: var(--cat-color, #64748b); }
.category-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.detail-section { padding-top: 4px; }
.alias-list { display: flex; flex-wrap: wrap; gap: 6px; }
.alias-chip { font-size: 11px; padding: 3px 9px; border-radius: 999px; background: var(--border-light); color: var(--text-secondary); }
.section-label { font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; opacity: 0.7; }
.detail-desc { font-size: 13px; line-height: 1.6; color: var(--text-primary); margin: 0; opacity: 0.85; }

/* ---- 编辑态表单：面板宽度可在 60~400 之间拖拽，所以表单必须能压到很窄 ---- */
.detail-edit { display: flex; flex-direction: column; gap: 12px; }
.edit-head { display: flex; align-items: center; }
.edit-head-title { font-size: 12px; font-weight: 600; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.7; }
.form-group { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.form-label { font-size: 11px; font-weight: 600; color: var(--text-secondary); }
.form-hint { font-weight: 400; font-size: 10px; color: var(--text-secondary); opacity: 0.75; }
.form-input { width: 100%; box-sizing: border-box; padding: 7px 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-white); color: var(--text-primary); font-family: var(--font); font-size: 12px; line-height: 1.5; outline: none; transition: border-color var(--dur-fast) ease; }
.form-input:focus { border-color: var(--accent); }
.form-textarea { resize: vertical; min-height: 56px; }
.form-input::placeholder { color: var(--text-secondary); opacity: 0.6; }
.edit-actions { display: flex; justify-content: flex-end; gap: 6px; padding-top: 4px; border-top: 1px solid var(--border-light); }
.edit-btn { padding: 7px 16px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-white); color: var(--text-primary); font-family: var(--font); font-size: 12px; font-weight: 600; cursor: pointer; transition: all var(--dur-fast) ease; }
.edit-btn:hover { border-color: var(--accent); color: var(--accent); }
.edit-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.edit-btn.primary:hover { opacity: 0.9; color: #fff; }

.note-label { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.note-pin { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border: 1px solid var(--border); border-radius: 999px; background: transparent; color: var(--text-secondary); font-size: 10px; font-weight: 600; cursor: pointer; text-transform: none; letter-spacing: 0; opacity: 1; margin: 0; transition: all var(--dur-fast) ease; }
.note-pin svg { width: 11px; height: 11px; }
.note-pin:hover:not(:disabled) { border-color: var(--color-note); color: var(--color-note); }
.note-pin.on { border-color: var(--color-note); color: var(--color-note); background: var(--color-note-bg); }
.note-pin:disabled { opacity: 0.4; cursor: not-allowed; }
.note-input { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-white); color: var(--text-primary); font-family: var(--font); font-size: 12px; line-height: 1.6; resize: vertical; outline: none; transition: border-color var(--dur-fast) ease; }
.note-input:focus { border-color: var(--color-note); }
.note-input::placeholder { color: var(--text-secondary); opacity: 0.6; }
.note-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; }
.note-status { font-size: 11px; color: var(--text-secondary); opacity: 0.75; }
.note-status.saving { color: var(--color-note); opacity: 1; }
.note-clear { border: none; background: transparent; color: var(--text-secondary); font-size: 11px; cursor: pointer; padding: 2px 4px; font-family: var(--font); }
.note-clear:hover { color: var(--color-danger); }
.stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.stat-item { background: var(--border-light); border-radius: 8px; padding: 10px 8px; text-align: center; }
.stat-value { font-size: 18px; font-weight: 700; color: var(--text-primary); line-height: 1.2; }
.stat-name { font-size: 10px; color: var(--text-secondary); margin-top: 3px; opacity: 0.7; }
.timeline { display: flex; flex-direction: column; gap: 10px; }
.timeline-item { display: flex; align-items: center; gap: 10px; }
.timeline-icon { width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.timeline-icon svg { width: 13px; height: 13px; }
.timeline-icon.added { background: #e0f2fe; color: #0284c7; }
.timeline-icon.updated { background: #fef3c7; color: #d97706; }
.timeline-content { display: flex; flex-direction: column; gap: 1px; }
.timeline-label { font-size: 11px; color: var(--text-secondary); opacity: 0.7; }
.timeline-date { font-size: 12px; font-weight: 500; color: var(--text-primary); }
.detail-actions { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; padding-top: 4px; border-top: 1px solid var(--border-light); }
.action-btn { display: flex; align-items: center; justify-content: center; gap: 5px; padding: 8px 6px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-white); color: var(--text-primary); font-size: 11px; font-weight: 500; cursor: pointer; transition: all var(--dur-fast) ease; text-decoration: none; font-family: var(--font); }
.action-btn svg { width: 14px; height: 14px; flex-shrink: 0; }
.action-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-light); }
.action-btn.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.action-btn.primary:hover { opacity: 0.9; }
.action-btn.favorited { color: #eab308; border-color: #eab308; background: #fefce8; }
</style>
