<script setup>
/**
 * 领域动态（阶段 1）：时间线 / 事件 / 简报。
 *
 * 读接口公开；「刷新抓取」「处理内容」需要后台凭据。
 * 处理是异步的：正文抽取 + 摘要 + 聚类 + 简报可能跑 1–2 分钟，页面轮询状态。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { contentApi } from '@/services/contentApi'
import { useCategoriesStore } from '@/stores/categories'

const categoriesStore = useCategoriesStore()

const DOMAINS = [
  { id: '', label: '全部' },
  { id: 'ai-work', label: 'AI' },
  { id: 'research', label: '研究' },
  { id: 'onchain', label: '链上' },
  { id: 'infra', label: '工具 / 基础设施' },
]

const view = ref('timeline')
const domain = ref('')
const category = ref('')
const keyword = ref('')
const unreadOnly = ref(false)
const savedOnly = ref(false)

const items = ref([])
const events = ref([])
const digest = ref(null)
const stats = ref(null)
const processing = ref(null)
const sourceLabels = ref({})

const loading = ref(false)
const loadingMore = ref(false)
const refreshing = ref(false)
const processingNow = ref(false)
const error = ref('')
const notice = ref('')
const hasMore = ref(false)

const expandedEvent = ref('')
const eventDetail = ref(null)
const insights = ref(null)
const entityFilter = ref(null)
const keywordDraft = ref('')

let statsTimer = null
let searchTimer = null

const categoryOptions = computed(() => {
  const groups = categoriesStore.groups || []
  let selected = groups
  if (domain.value === 'onchain') selected = groups.filter(g => g.id === 'crypto')
  else if (domain.value === 'infra') selected = groups.filter(g => g.id === 'tools' || g.id === 'basics')
  else if (domain.value === 'ai-work' || domain.value === 'research') selected = groups.filter(g => g.id === 'ai')
  const out = []
  for (const g of selected) {
    for (const c of g.categories || []) out.push({ id: c.id, label: c.label, group: g.label })
  }
  return out
})

function fmtRelative(ts) {
  if (!ts) return ''
  const diff = Date.now() - Number(ts)
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  const d = new Date(Number(ts))
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function fmtRange(first, last) {
  if (!first || !last) return ''
  const a = new Date(Number(first))
  const b = new Date(Number(last))
  const pad = n => String(n).padStart(2, '0')
  const day = d => `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `${day(a)} ~ ${day(b)}`
}

function categoryLabel(id) {
  for (const g of categoriesStore.groups || []) {
    const hit = (g.categories || []).find(c => c.id === id)
    if (hit) return hit.label
  }
  return id || '未分类'
}

function heatWidth(item) {
  const max = Math.max(1, ...(insights.value?.domainHeat || []).map(x => x.count))
  return `${Math.round((Number(item.count) || 0) / max * 100)}%`
}

function llmBadge(item) {
  if (item.llmStatus === 'ok') return 'LLM 摘要'
  if (item.llmStatus === 'fallback') return '规则摘要'
  return ''
}

async function loadSources() {
  const r = await contentApi.sources()
  if (!r.ok) return
  sourceLabels.value = Object.fromEntries((r.sources || []).map(s => [s.id, s.label]))
}

async function loadStats() {
  const r = await contentApi.stats()
  if (!r.ok) return
  stats.value = r.stats
  processing.value = {
    ...(r.processing || {}),
    llm: r.llm,
    translation: r.translation,
  }
}

async function loadTimeline({ reset = true } = {}) {
  if (reset) { loading.value = true; error.value = '' } else loadingMore.value = true
  try {
    const before = reset ? 0 : (items.value[items.value.length - 1]?.publishedAt || 0)
    const r = await contentApi.list({
      domain: domain.value,
      categoryId: category.value,
      q: keyword.value.trim(),
      unread: unreadOnly.value ? 1 : '',
      saved: savedOnly.value ? 1 : '',
      limit: 50,
      before,
    })
    if (!r.ok) { error.value = r.error || '读取失败'; return }
    items.value = reset ? r.items : [...items.value, ...r.items]
    hasMore.value = Boolean(r.hasMore)
    if (r.stats) stats.value = r.stats
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function loadEvents() {
  loading.value = true
  error.value = ''
  try {
    const r = await contentApi.events(null, { domain: domain.value, limit: 30 })
    if (!r.ok) { error.value = r.error || '读取事件失败'; return }
    events.value = r.items || []
  } finally {
    loading.value = false
  }
}

async function loadDigest() {
  loading.value = true
  error.value = ''
  try {
    const r = await contentApi.digest()
    if (!r.ok) { error.value = r.error || '读取简报失败'; return }
    digest.value = r.digest || null
  } finally {
    loading.value = false
  }
}

async function loadInsights() {
  loading.value = true
  error.value = ''
  try {
    const r = await contentApi.insights(null, { hours: 24 })
    if (!r.ok) { error.value = r.error || '读取洞察失败'; return }
    insights.value = r
    keywordDraft.value = (r.keywords || []).join(', ')
  } finally {
    loading.value = false
  }
}

async function reloadCurrent() {
  if (view.value === 'timeline') await loadTimeline()
  else if (view.value === 'events') await loadEvents()
  else if (view.value === 'trends') await loadInsights()
  else await loadDigest()
  await loadStats()
}

async function filterByEntity(entity) {
  entityFilter.value = { id: entity.id, name: entity.name }
  view.value = 'timeline'
  loading.value = true
  error.value = ''
  try {
    const r = await contentApi.entity(null, entity.id, { limit: 50 })
    if (!r.ok) { error.value = r.error || '读取实体条目失败'; return }
    items.value = r.items || []
    hasMore.value = false
  } finally {
    loading.value = false
  }
}

async function clearEntityFilter() {
  entityFilter.value = null
  await loadTimeline()
}

async function markAlert(alert) {
  const r = await contentApi.markAlertsRead(null, [alert.id])
  if (r.ok) alert.read = true
}

async function saveKeywords() {
  const list = keywordDraft.value.split(/[,，]/).map(s => s.trim()).filter(Boolean)
  const r = await contentApi.setKeywords(null, list)
  if (!r.ok) { error.value = r.error || '保存关键词失败（需要登录后台）'; return }
  notice.value = '告警关键词已保存'
  await loadInsights()
}

async function loadMore() {
  if (!hasMore.value || loadingMore.value) return
  await loadTimeline({ reset: false })
}

async function toggleEvent(event) {
  if (expandedEvent.value === event.id) {
    expandedEvent.value = ''
    eventDetail.value = null
    return
  }
  expandedEvent.value = event.id
  eventDetail.value = null
  const r = await contentApi.event(null, event.id)
  if (r.ok) eventDetail.value = r.event
}

async function refreshNow() {
  if (refreshing.value) return
  refreshing.value = true
  notice.value = ''
  error.value = ''
  try {
    const r = await contentApi.refresh()
    if (!r.ok) { error.value = r.error || '抓取启动失败'; return }
    notice.value = '已开始抓取…'
    pollUntil(() => {
      refreshing.value = false
      reloadCurrent()
      loadSources()
    })
  } catch (e) {
    error.value = String(e?.message || e)
    refreshing.value = false
  }
}

async function processNow() {
  if (processingNow.value) return
  processingNow.value = true
  notice.value = ''
  error.value = ''
  try {
    const r = await contentApi.process(null, { extractLimit: 20, summaryLimit: 20 })
    if (!r.ok) { error.value = r.error || '处理启动失败（需要登录后台）'; processingNow.value = false; return }
    notice.value = '已开始处理：正文抽取 → 翻译/摘要 → 事件聚类 → 简报'
    pollProcessing(() => {
      processingNow.value = false
      reloadCurrent()
      loadStats()
    })
  } catch (e) {
    error.value = String(e?.message || e)
    processingNow.value = false
  }
}

function pollUntil(done) {
  let tries = 0
  const timer = setInterval(async () => {
    tries += 1
    const r = await contentApi.stats()
    if (r.ok) {
      stats.value = r.stats
      processing.value = { ...(r.processing || {}), llm: r.llm, translation: r.translation }
      if (!r.scheduler?.running) {
        clearInterval(timer)
        notice.value = `抓取完成：新增 ${r.scheduler?.lastResult?.added ?? 0} 条`
        done()
      }
    }
    if (tries >= 40) { clearInterval(timer); done() }
  }, 3000)
}

function pollProcessing(done) {
  let tries = 0
  const timer = setInterval(async () => {
    tries += 1
    const r = await contentApi.processing()
    if (r.ok) {
      processing.value = { ...(r.processing || {}), llm: r.llm, translation: r.translation }
      if (!r.running) {
        clearInterval(timer)
        notice.value = '处理完成'
        done()
      }
    }
    if (tries >= 60) { clearInterval(timer); done() }
  }, 3000)
}

async function toggleRead(item) {
  const r = await contentApi.markRead(null, [item.id], !item.read)
  if (!r.ok) { error.value = r.error || '需要登录后台'; return }
  item.read = !item.read
  await loadStats()
}

async function toggleSaved(item) {
  const r = await contentApi.markSaved(null, [item.id], !item.saved)
  if (!r.ok) { error.value = r.error || '需要登录后台'; return }
  item.saved = !item.saved
}

function openEntry(item) {
  if (!item.read) toggleRead(item)
}

watch(domain, () => {
  category.value = ''
  expandedEvent.value = ''
  entityFilter.value = null
  if (view.value === 'timeline') loadTimeline()
  else if (view.value === 'events') loadEvents()
  else if (view.value === 'trends') loadInsights()
})
watch(category, () => { if (view.value === 'timeline') loadTimeline() })
watch(unreadOnly, () => { if (view.value === 'timeline') loadTimeline() })
watch(savedOnly, () => { if (view.value === 'timeline') loadTimeline() })
watch(view, () => {
  error.value = ''
  if (view.value === 'timeline') loadTimeline()
  else if (view.value === 'events') loadEvents()
  else if (view.value === 'trends') loadInsights()
  else loadDigest()
})

watch(keyword, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { if (view.value === 'timeline') loadTimeline() }, 300)
})

onMounted(async () => {
  await Promise.all([loadSources(), loadTimeline(), loadStats()])
  statsTimer = setInterval(loadStats, 30000)
})

onBeforeUnmount(() => {
  clearInterval(statsTimer)
  clearTimeout(searchTimer)
})
</script>

<template>
  <div class="content-view">
    <header class="cv-head">
      <div>
        <h1 class="cv-title">领域动态</h1>
        <p class="cv-sub">
          公开 RSS / API 的最新进展；阶段 1 提供正文抽取、中文摘要、事件聚类与每日简报。
        </p>
      </div>
      <div class="cv-actions">
        <button class="cv-btn" type="button" :disabled="processingNow" @click="processNow">
          {{ processingNow ? '处理中…' : '处理内容' }}
        </button>
        <button class="cv-btn" type="button" :disabled="refreshing" @click="refreshNow">
          {{ refreshing ? '抓取中…' : '刷新抓取' }}
        </button>
      </div>
    </header>

    <div class="cv-badges">
      <span class="cv-badge" :class="{ ok: processing?.llm }">
        {{ processing?.llm ? 'LLM 已配置' : 'LLM 未配置 · 规则摘要' }}
      </span>
      <span class="cv-badge" :class="{ ok: processing?.translation }">
        {{ processing?.translation ? '翻译可用' : '翻译未配置' }}
      </span>
      <span v-if="processing?.summary?.pending" class="cv-badge">
        待摘要 {{ processing.summary.pending }}
      </span>
      <span v-if="processing?.extract?.pending" class="cv-badge">
        待抽取 {{ processing.extract.pending }}
      </span>
    </div>

    <p v-if="error" class="cv-msg bad">{{ error }}</p>
    <p v-else-if="notice" class="cv-msg ok">{{ notice }}</p>

    <section class="cv-stats" v-if="stats">
      <div class="cv-stat"><b>{{ stats.total }}</b><span>条目</span></div>
      <div class="cv-stat"><b>{{ stats.today }}</b><span>近 24 小时</span></div>
      <div class="cv-stat"><b>{{ stats.unread }}</b><span>未读</span></div>
      <div class="cv-stat"><b>{{ stats.sources }}</b><span>启用源</span></div>
      <div class="cv-stat" :class="{ warn: stats.failing }"><b>{{ stats.failing }}</b><span>失败源</span></div>
      <div class="cv-stat"><b>{{ processing?.events ?? 0 }}</b><span>事件</span></div>
    </section>

    <nav class="cv-views">
      <button type="button" :class="{ active: view === 'timeline' }" @click="view = 'timeline'">时间线</button>
      <button type="button" :class="{ active: view === 'events' }" @click="view = 'events'">事件</button>
      <button type="button" :class="{ active: view === 'trends' }" @click="view = 'trends'">趋势 / 告警</button>
      <button type="button" :class="{ active: view === 'digest' }" @click="view = 'digest'">每日简报</button>
    </nav>

    <section v-if="view !== 'digest'" class="cv-filters">
      <div class="cv-domains">
        <button
          v-for="d in DOMAINS" :key="d.id" type="button"
          class="cv-domain" :class="{ active: domain === d.id }"
          @click="domain = d.id"
        >{{ d.label }}</button>
      </div>
      <div v-if="view === 'timeline'" class="cv-filter-row">
        <select v-model="category" class="cv-select">
          <option value="">全部分类</option>
          <option v-for="c in categoryOptions" :key="c.id" :value="c.id">{{ c.group }} / {{ c.label }}</option>
        </select>
        <input v-model="keyword" class="cv-input" type="search" placeholder="搜索标题或摘要">
        <label class="cv-check"><input v-model="unreadOnly" type="checkbox"> 只看未读</label>
        <label class="cv-check"><input v-model="savedOnly" type="checkbox"> 只看收藏</label>
      </div>
    </section>

    <div v-if="entityFilter" class="cv-entity-filter">
      实体：<b>{{ entityFilter.name }}</b>
      <button class="cv-mini" type="button" @click="clearEntityFilter">清除</button>
    </div>

    <div v-if="loading" class="cv-empty">正在读取…</div>

    <!-- 时间线 -->
    <template v-else-if="view === 'timeline'">
      <div v-if="!items.length" class="cv-empty">还没有条目。点「刷新抓取」跑一轮。</div>
      <section v-else class="cv-list">
        <article v-for="item in items" :key="item.id" class="cv-item" :class="{ read: item.read, saved: item.saved }">
          <div class="cv-item-top">
            <span class="cv-source">{{ sourceLabels[item.sourceId] || item.sourceId }}</span>
            <span class="cv-dot">·</span>
            <time class="cv-time">{{ fmtRelative(item.publishedAt) }}</time>
            <span class="cv-cat">{{ categoryLabel(item.categoryId) }}</span>
            <span v-if="llmBadge(item)" class="cv-ai">{{ llmBadge(item) }}</span>
            <button
              v-for="entity in (item.entities || [])" :key="entity.id"
              class="cv-entity" type="button" @click="filterByEntity(entity)"
            >{{ entity.name }}</button>
          </div>
          <h2 class="cv-item-title">
            <a :href="item.url" target="_blank" rel="noopener noreferrer" @click="openEntry(item)">
              {{ item.titleZh || item.title }}
            </a>
          </h2>
          <p v-if="item.summaryZh || item.summary" class="cv-summary">{{ item.summaryZh || item.summary }}</p>
          <p v-if="item.why" class="cv-why">为什么重要：{{ item.why }}</p>
          <div class="cv-item-foot">
            <span v-if="item.author" class="cv-author">{{ item.author }}</span>
            <button class="cv-mini" type="button" @click="toggleRead(item)">{{ item.read ? '标为未读' : '标为已读' }}</button>
            <button class="cv-mini" type="button" @click="toggleSaved(item)">{{ item.saved ? '取消收藏' : '收藏' }}</button>
          </div>
        </article>
      </section>
      <div v-if="hasMore" class="cv-more">
        <button class="cv-btn" type="button" :disabled="loadingMore" @click="loadMore">
          {{ loadingMore ? '加载中…' : '加载更多' }}
        </button>
      </div>
    </template>

    <!-- 事件 -->
    <template v-else-if="view === 'events'">
      <div v-if="!events.length" class="cv-empty">
        还没有聚类事件。需要至少两条相近的报道；点「处理内容」运行聚类。
      </div>
      <section v-else class="cv-list">
        <article v-for="event in events" :key="event.id" class="cv-event">
          <div class="cv-item-top">
            <span class="cv-event-tag">事件</span>
            <span class="cv-source">{{ event.sourceCount }} 个来源</span>
            <span class="cv-dot">·</span>
            <span class="cv-time">{{ fmtRange(event.firstSeen, event.lastSeen) }}</span>
            <span class="cv-cat">{{ categoryLabel(event.categoryId) }}</span>
            <span class="cv-heat">热度 {{ Number(event.heat || 0).toFixed(2) }}</span>
          </div>
          <h2 class="cv-item-title">
            <a v-if="event.primaryUrl" :href="event.primaryUrl" target="_blank" rel="noopener noreferrer">{{ event.title }}</a>
            <span v-else>{{ event.title }}</span>
          </h2>
          <p v-if="event.summary" class="cv-summary">{{ event.summary }}</p>
          <div v-if="eventDetail?.id === event.id && eventDetail?.entities?.length" class="cv-event-entities">
            <span v-for="entity in eventDetail.entities" :key="entity.id" class="cv-entity">{{ entity.name }}</span>
          </div>
          <div class="cv-item-foot">
            <button class="cv-mini" type="button" @click="toggleEvent(event)">
              {{ expandedEvent === event.id ? '收起报道' : `查看 ${event.entryCount} 条报道` }}
            </button>
          </div>
          <div v-if="expandedEvent === event.id" class="cv-event-entries">
            <p v-if="!eventDetail" class="cv-empty">读取中…</p>
            <a
              v-for="entry in (eventDetail?.entries || [])" :key="entry.id"
              class="cv-event-entry" :href="entry.url" target="_blank" rel="noopener noreferrer"
            >
              <span class="cv-source">{{ sourceLabels[entry.sourceId] || entry.sourceId }}</span>
              <span>{{ entry.titleZh || entry.title }}</span>
              <time>{{ fmtRelative(entry.publishedAt) }}</time>
            </a>
          </div>
        </article>
      </section>
    </template>

    <!-- 趋势 / 告警 -->
    <template v-else-if="view === 'trends'">
      <div v-if="!insights" class="cv-empty">正在读取洞察…</div>
      <template v-else>
        <section class="cv-panel">
          <div class="cv-panel-head">
            <h3>突增实体（24h）</h3>
            <span class="cv-hint">当前窗口 vs 过去 7 天基线</span>
          </div>
          <div class="cv-trend-grid">
            <article v-for="t in insights.trends.slice(0, 12)" :key="t.entityId" class="cv-trend-card">
              <header>
                <b>{{ t.name }}</b>
                <span class="cv-trend-z" :class="{ hot: t.z >= 5 }">z {{ t.z }}</span>
              </header>
              <p>{{ t.current }} 条 · 基线期望 {{ t.expected }} · {{ t.sources }} 个来源</p>
              <button class="cv-mini" type="button" @click="filterByEntity({ id: t.entityId, name: t.name })">
                查看相关条目
              </button>
            </article>
            <p v-if="!insights.trends.length" class="cv-empty">暂无明显突增</p>
          </div>
        </section>

        <section class="cv-panel">
          <div class="cv-panel-head"><h3>领域热度（24h）</h3></div>
          <div v-for="d in insights.domainHeat" :key="d.domain" class="cv-heat-row">
            <span class="cv-heat-domain">{{ d.domain }}</span>
            <div class="cv-heat-bar"><i :style="{ width: heatWidth(d) }"></i></div>
            <span class="cv-heat-num">{{ d.count }}</span>
          </div>
          <p v-if="!insights.domainHeat.length" class="cv-empty">暂无数据</p>
        </section>

        <section class="cv-panel">
          <div class="cv-panel-head">
            <h3>告警</h3>
            <span class="cv-hint">实体突增 / 关键词 / 来源失败</span>
          </div>
          <div class="cv-alert-keywords">
            <input v-model="keywordDraft" class="cv-input" placeholder="关键词告警，用逗号分隔">
            <button class="cv-btn" type="button" @click="saveKeywords">保存关键词</button>
          </div>
          <article v-for="a in insights.alerts" :key="a.id" class="cv-alert" :class="{ read: a.read }">
            <span class="cv-alert-sev" :class="a.severity">{{ a.severity }}</span>
            <div class="cv-alert-main">
              <b>{{ a.title }}</b>
              <p>{{ a.detail }}</p>
            </div>
            <button v-if="!a.read" class="cv-mini" type="button" @click="markAlert(a)">标记已读</button>
          </article>
          <p v-if="!insights.alerts.length" class="cv-empty">暂无告警</p>
        </section>
      </template>
    </template>

    <!-- 简报 -->
    <template v-else>
      <div v-if="!digest" class="cv-empty">还没有简报。点「处理内容」生成当日简报。</div>
      <article v-else class="cv-digest">
        <header>
          <h2>{{ digest.date }} · 每日简报</h2>
          <span class="cv-badge" :class="{ ok: digest.llmStatus === 'ok' }">
            {{ digest.llmStatus === 'ok' ? 'LLM 生成' : '规则汇总' }}
          </span>
        </header>
        <pre class="cv-digest-body">{{ digest.contentMd }}</pre>
      </article>
    </template>
  </div>
</template>

<style scoped>
.content-view { max-width: 980px; margin: 0 auto; padding: 28px 20px 60px; }
.cv-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.cv-title { margin: 0; font-size: 24px; font-weight: 700; }
.cv-sub { margin: 6px 0 0; color: var(--text-secondary); font-size: 13px; line-height: 1.6; }
.cv-actions { display: flex; gap: 8px; flex-wrap: wrap; }

.cv-btn {
  padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border);
  background: var(--bg-elevated, transparent); color: var(--text); cursor: pointer; font-size: 13px;
}
.cv-btn:hover:not(:disabled) { border-color: var(--accent); }
.cv-btn:disabled { opacity: .5; cursor: default; }

.cv-badges { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
.cv-badge {
  font-size: 11px; padding: 2px 8px; border-radius: 999px;
  border: 1px solid var(--border); color: var(--text-secondary);
}
.cv-badge.ok { color: var(--success, #15803d); border-color: currentColor; }

.cv-msg { margin: 12px 0 0; font-size: 13px; }
.cv-msg.bad { color: var(--danger, #b91c1c); }
.cv-msg.ok { color: var(--success, #15803d); }

.cv-stats { display: flex; gap: 10px; flex-wrap: wrap; margin: 18px 0; }
.cv-stat {
  flex: 1; min-width: 82px; padding: 10px 12px; border: 1px solid var(--border);
  border-radius: 10px; background: var(--bg-elevated, transparent);
}
.cv-stat b { display: block; font-size: 20px; }
.cv-stat span { color: var(--text-secondary); font-size: 12px; }
.cv-stat.warn b { color: var(--warning, #b45309); }

.cv-views { display: flex; gap: 6px; margin: 0 0 12px; }
.cv-views button {
  padding: 6px 14px; border-radius: 8px; border: 1px solid var(--border);
  background: transparent; color: var(--text-secondary); cursor: pointer; font-size: 13px;
}
.cv-views button.active { border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }

.cv-filters {
  border: 1px solid var(--border); border-radius: 10px; padding: 12px;
  background: var(--bg-elevated, transparent);
}
.cv-domains { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.cv-domain {
  padding: 5px 12px; border-radius: 999px; border: 1px solid var(--border);
  background: transparent; color: var(--text-secondary); cursor: pointer; font-size: 12px;
}
.cv-domain.active { border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); }
.cv-filter-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.cv-select, .cv-input {
  border: 1px solid var(--border); border-radius: 7px; padding: 6px 8px;
  background: var(--bg); color: var(--text); font-size: 13px;
}
.cv-input { flex: 1; min-width: 180px; }
.cv-check { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-secondary); }

.cv-list { display: flex; flex-direction: column; gap: 10px; margin-top: 16px; }
.cv-item, .cv-event {
  border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px;
  background: var(--bg-elevated, transparent); transition: border-color .15s;
}
.cv-item:hover, .cv-event:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
.cv-item.read { opacity: .68; }
.cv-item.saved { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); }
.cv-item-top { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--text-secondary); flex-wrap: wrap; }
.cv-source { color: var(--accent); font-weight: 500; }
.cv-cat { margin-left: auto; padding: 1px 8px; border: 1px solid var(--border); border-radius: 999px; }
.cv-ai { padding: 1px 7px; border: 1px solid currentColor; border-radius: 999px; color: var(--success, #15803d); font-size: 10.5px; }
.cv-event-tag { color: var(--warning, #b45309); font-weight: 600; }
.cv-heat { margin-left: auto; color: var(--warning, #b45309); }
.cv-item-title { margin: 6px 0 0; font-size: 16px; line-height: 1.45; }
.cv-item-title a { color: var(--text); text-decoration: none; }
.cv-item-title a:hover { color: var(--accent); }
.cv-summary { margin: 6px 0 0; color: var(--text-secondary); font-size: 13px; line-height: 1.6; }
.cv-why { margin: 6px 0 0; color: var(--accent); font-size: 12.5px; line-height: 1.5; }
.cv-item-foot { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.cv-author { font-size: 11.5px; color: var(--text-secondary); }
.cv-mini {
  margin-left: auto; padding: 2px 8px; border: 1px solid var(--border); border-radius: 6px;
  background: transparent; color: var(--text-secondary); cursor: pointer; font-size: 11px;
}
.cv-mini + .cv-mini { margin-left: 0; }
.cv-mini:hover { border-color: var(--accent); color: var(--accent); }

.cv-event-entries { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 6px; }
.cv-event-entry { display: flex; gap: 8px; align-items: baseline; font-size: 12px; color: var(--text); text-decoration: none; }
.cv-event-entry:hover { color: var(--accent); }
.cv-event-entry time { margin-left: auto; color: var(--text-secondary); font-size: 11px; white-space: nowrap; }

.cv-digest { margin-top: 16px; border: 1px solid var(--border); border-radius: 10px; padding: 16px; background: var(--bg-elevated, transparent); }
.cv-digest header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.cv-digest h2 { margin: 0; font-size: 18px; }
.cv-digest-body { white-space: pre-wrap; word-break: break-word; font: inherit; font-size: 13px; line-height: 1.75; margin: 12px 0 0; }

.cv-empty { padding: 40px 0; text-align: center; color: var(--text-secondary); font-size: 13px; }
.cv-more { display: flex; justify-content: center; margin-top: 18px; }

.cv-entity-filter {
  display: flex; align-items: center; gap: 8px; margin: 12px 0; padding: 8px 12px;
  border: 1px solid var(--accent); border-radius: 8px; font-size: 13px;
}
.cv-entity {
  padding: 1px 7px; border: 1px solid var(--border); border-radius: 999px;
  background: transparent; color: var(--text-secondary); cursor: pointer; font-size: 10.5px;
}
.cv-entity:hover { border-color: var(--accent); color: var(--accent); }

.cv-panel { margin-top: 16px; border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
.cv-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.cv-panel-head h3 { margin: 0; font-size: 15px; }
.cv-hint { color: var(--text-secondary); font-size: 11.5px; }
.cv-trend-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
.cv-trend-card { border: 1px solid var(--border); border-radius: 8px; padding: 10px; }
.cv-trend-card header { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.cv-trend-card p { margin: 6px 0; color: var(--text-secondary); font-size: 12px; }
.cv-trend-z {
  font-size: 11px; padding: 1px 7px; border-radius: 999px;
  border: 1px solid var(--border); color: var(--text-secondary);
}
.cv-trend-z.hot { color: var(--danger, #b91c1c); border-color: currentColor; }
.cv-heat-row { display: flex; align-items: center; gap: 10px; margin: 6px 0; font-size: 12px; }
.cv-heat-domain { width: 90px; color: var(--text-secondary); }
.cv-heat-bar { flex: 1; height: 8px; background: var(--border); border-radius: 999px; overflow: hidden; }
.cv-heat-bar i { display: block; height: 100%; background: var(--accent); border-radius: 999px; }
.cv-heat-num { width: 36px; text-align: right; }
.cv-alert-keywords { display: flex; gap: 8px; margin-bottom: 10px; }
.cv-alert { display: flex; gap: 10px; align-items: flex-start; padding: 8px 0; border-bottom: 1px solid var(--border); }
.cv-alert:last-child { border-bottom: none; }
.cv-alert.read { opacity: .55; }
.cv-alert-main { flex: 1; }
.cv-alert-main b { font-size: 13px; }
.cv-alert-main p { margin: 3px 0 0; color: var(--text-secondary); font-size: 12px; }
.cv-alert-sev {
  font-size: 10px; padding: 1px 7px; border-radius: 999px;
  border: 1px solid var(--border); color: var(--text-secondary); white-space: nowrap;
}
.cv-alert-sev.high { color: var(--danger, #b91c1c); border-color: currentColor; }
.cv-alert-sev.medium { color: var(--warning, #b45309); border-color: currentColor; }

@media (max-width: 640px) {
  .cv-head { flex-direction: column; }
  .cv-stat { min-width: 72px; }
}
</style>