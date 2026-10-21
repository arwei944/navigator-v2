<script setup>
/**
 * 领域动态时间线（阶段 0）。
 *
 * 只读为主：读接口公开，标记已读/收藏需要后台凭据。
 * 抓取是异步的 —— 点「刷新」后轮询统计，不阻塞页面。
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

const domain = ref('')
const category = ref('')
const keyword = ref('')
const unreadOnly = ref(false)
const savedOnly = ref(false)

const items = ref([])
const stats = ref(null)
const sourceLabels = ref({})
const loading = ref(false)
const loadingMore = ref(false)
const refreshing = ref(false)
const error = ref('')
const notice = ref('')
const hasMore = ref(false)

let statsTimer = null

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

function categoryLabel(id) {
  for (const g of categoriesStore.groups || []) {
    const hit = (g.categories || []).find(c => c.id === id)
    if (hit) return hit.label
  }
  return id || '未分类'
}

async function loadSources() {
  const r = await contentApi.sources()
  if (!r.ok) return
  sourceLabels.value = Object.fromEntries((r.sources || []).map(s => [s.id, s.label]))
}

async function load({ reset = true } = {}) {
  if (reset) {
    loading.value = true
    error.value = ''
  } else {
    loadingMore.value = true
  }
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
    stats.value = r.stats || stats.value
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function loadMore() {
  if (!hasMore.value || loadingMore.value) return
  await load({ reset: false })
}

async function refreshStats() {
  const r = await contentApi.stats()
  if (r.ok) stats.value = r.stats
}

async function refreshNow() {
  if (refreshing.value) return
  refreshing.value = true
  notice.value = ''
  error.value = ''
  try {
    const r = await contentApi.refresh()
    if (!r.ok) { error.value = r.error || '抓取启动失败'; return }
    notice.value = r.running ? '已有抓取在运行，等待完成…' : '已开始抓取…'
    let tries = 0
    const timer = setInterval(async () => {
      tries += 1
      const s = await contentApi.stats()
      if (s.ok) {
        stats.value = s.stats
        if (!s.scheduler?.running) {
          clearInterval(timer)
          refreshing.value = false
          notice.value = `抓取完成：新增 ${s.scheduler?.lastResult?.added ?? 0} 条`
          await load()
          await loadSources()
        }
      }
      if (tries >= 40) {
        clearInterval(timer)
        refreshing.value = false
        notice.value = '抓取仍在后台进行，稍后自动刷新'
      }
    }, 3000)
  } catch (e) {
    error.value = String(e?.message || e)
    refreshing.value = false
  }
}

async function toggleRead(item) {
  const r = await contentApi.markRead(null, [item.id], !item.read)
  if (!r.ok) { error.value = r.error || '需要登录后台'; return }
  item.read = !item.read
  await refreshStats()
}

async function toggleSaved(item) {
  const r = await contentApi.markSaved(null, [item.id], !item.saved)
  if (!r.ok) { error.value = r.error || '需要登录后台'; return }
  item.saved = !item.saved
}

function openEntry(item) {
  if (!item.read) toggleRead(item)
}

watch(domain, () => { category.value = ''; load() })
watch(category, () => load())
watch(unreadOnly, () => load())
watch(savedOnly, () => load())

let searchTimer = null
watch(keyword, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => load(), 300)
})

onMounted(async () => {
  await Promise.all([loadSources(), load()])
  statsTimer = setInterval(refreshStats, 30000)
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
          来自公开 RSS / API 的最新进展，只保留标题、摘要与回链。条目保留 30 天。
        </p>
      </div>
      <div class="cv-actions">
        <button class="cv-btn" type="button" :disabled="refreshing" @click="refreshNow">
          {{ refreshing ? '抓取中…' : '刷新抓取' }}
        </button>
      </div>
    </header>

    <p v-if="error" class="cv-msg bad">{{ error }}</p>
    <p v-else-if="notice" class="cv-msg ok">{{ notice }}</p>

    <section class="cv-stats" v-if="stats">
      <div class="cv-stat"><b>{{ stats.total }}</b><span>条目</span></div>
      <div class="cv-stat"><b>{{ stats.today }}</b><span>近 24 小时</span></div>
      <div class="cv-stat"><b>{{ stats.unread }}</b><span>未读</span></div>
      <div class="cv-stat"><b>{{ stats.sources }}</b><span>启用源</span></div>
      <div class="cv-stat" :class="{ warn: stats.failing }"><b>{{ stats.failing }}</b><span>失败源</span></div>
    </section>

    <section class="cv-filters">
      <div class="cv-domains">
        <button
          v-for="d in DOMAINS" :key="d.id" type="button"
          class="cv-domain" :class="{ active: domain === d.id }"
          @click="domain = d.id"
        >{{ d.label }}</button>
      </div>
      <div class="cv-filter-row">
        <select v-model="category" class="cv-select">
          <option value="">全部分类</option>
          <option v-for="c in categoryOptions" :key="c.id" :value="c.id">{{ c.group }} / {{ c.label }}</option>
        </select>
        <input v-model="keyword" class="cv-input" type="search" placeholder="搜索标题或摘要">
        <label class="cv-check"><input v-model="unreadOnly" type="checkbox"> 只看未读</label>
        <label class="cv-check"><input v-model="savedOnly" type="checkbox"> 只看收藏</label>
      </div>
    </section>

    <div v-if="loading" class="cv-empty">正在读取…</div>
    <div v-else-if="!items.length" class="cv-empty">
      还没有条目。点「刷新抓取」跑一轮，或等待定时任务。
    </div>

    <section v-else class="cv-list">
      <article v-for="item in items" :key="item.id" class="cv-item" :class="{ read: item.read, saved: item.saved }">
        <div class="cv-item-top">
          <span class="cv-source">{{ sourceLabels[item.sourceId] || item.sourceId }}</span>
          <span class="cv-dot">·</span>
          <time class="cv-time">{{ fmtRelative(item.publishedAt) }}</time>
          <span class="cv-cat">{{ categoryLabel(item.categoryId) }}</span>
        </div>
        <h2 class="cv-item-title">
          <a :href="item.url" target="_blank" rel="noopener noreferrer" @click="openEntry(item)">{{ item.title }}</a>
        </h2>
        <p v-if="item.summary" class="cv-summary">{{ item.summary }}</p>
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
  </div>
</template>

<style scoped>
.content-view { max-width: 980px; margin: 0 auto; padding: 28px 20px 60px; }
.cv-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.cv-title { margin: 0; font-size: 24px; font-weight: 700; }
.cv-sub { margin: 6px 0 0; color: var(--text-secondary); font-size: 13px; line-height: 1.6; }
.cv-actions { display: flex; gap: 8px; }

.cv-btn {
  padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border);
  background: var(--bg-elevated, transparent); color: var(--text); cursor: pointer; font-size: 13px;
}
.cv-btn:hover:not(:disabled) { border-color: var(--accent); }
.cv-btn:disabled { opacity: .5; cursor: default; }

.cv-msg { margin: 12px 0 0; font-size: 13px; }
.cv-msg.bad { color: var(--danger, #b91c1c); }
.cv-msg.ok { color: var(--success, #15803d); }

.cv-stats { display: flex; gap: 10px; flex-wrap: wrap; margin: 18px 0; }
.cv-stat {
  flex: 1; min-width: 92px; padding: 10px 12px; border: 1px solid var(--border);
  border-radius: 10px; background: var(--bg-elevated, transparent);
}
.cv-stat b { display: block; font-size: 20px; }
.cv-stat span { color: var(--text-secondary); font-size: 12px; }
.cv-stat.warn b { color: var(--warning, #b45309); }

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
.cv-item {
  border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px;
  background: var(--bg-elevated, transparent); transition: border-color .15s;
}
.cv-item:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
.cv-item.read { opacity: .68; }
.cv-item.saved { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); }
.cv-item-top { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--text-secondary); }
.cv-source { color: var(--accent); font-weight: 500; }
.cv-cat { margin-left: auto; padding: 1px 8px; border: 1px solid var(--border); border-radius: 999px; }
.cv-item-title { margin: 6px 0 0; font-size: 16px; line-height: 1.45; }
.cv-item-title a { color: var(--text); text-decoration: none; }
.cv-item-title a:hover { color: var(--accent); }
.cv-summary { margin: 6px 0 0; color: var(--text-secondary); font-size: 13px; line-height: 1.6; }
.cv-item-foot { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.cv-author { font-size: 11.5px; color: var(--text-secondary); }
.cv-mini {
  margin-left: auto; padding: 2px 8px; border: 1px solid var(--border); border-radius: 6px;
  background: transparent; color: var(--text-secondary); cursor: pointer; font-size: 11px;
}
.cv-mini + .cv-mini { margin-left: 0; }
.cv-mini:hover { border-color: var(--accent); color: var(--accent); }

.cv-empty { padding: 40px 0; text-align: center; color: var(--text-secondary); font-size: 13px; }
.cv-more { display: flex; justify-content: center; margin-top: 18px; }

@media (max-width: 640px) {
  .cv-head { flex-direction: column; }
  .cv-stat { min-width: 72px; }
}
</style>