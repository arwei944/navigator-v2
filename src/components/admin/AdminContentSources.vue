<script setup>
/**
 * 内容源管理：启停、编辑、测试、手动刷新。
 *
 * 抓取是异步的：刷新后只提示「已启动」，实际进度看抓取日志与统计。
 */
import { computed, onMounted, ref } from 'vue'
import { contentApi } from '@/services/contentApi'
import { useCategoriesStore } from '@/stores/categories'

const props = defineProps({ adminKey: { type: String, default: '' } })
const categoriesStore = useCategoriesStore()

const TYPE_OPTIONS = ['rss', 'jsonfeed', 'hn', 'arxiv', 'github', 'v2ex']
const DOMAIN_OPTIONS = [
  { id: 'ai-work', label: 'AI' },
  { id: 'research', label: '研究' },
  { id: 'onchain', label: '链上' },
  { id: 'infra', label: '工具 / 基础设施' },
]

const loading = ref(false)
const busy = ref('')
const error = ref('')
const notice = ref('')
const sources = ref([])
const fetches = ref([])
const scheduler = ref(null)

const editing = ref(false)
const form = ref(emptyForm())

const allCategories = computed(() => {
  const out = []
  for (const g of categoriesStore.groups || []) {
    for (const c of g.categories || []) out.push({ id: c.id, label: c.label, group: g.label })
  }
  return out
})

function emptyForm() {
  return {
    id: '', label: '', type: 'rss', url: '', domain: 'ai-work',
    categoryId: 'learning', weight: 1, maxItems: 60, enabled: true,
  }
}

function fmtTime(ts) {
  if (!ts) return '—'
  const d = new Date(Number(ts))
  if (Number.isNaN(d.getTime())) return '—'
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function say(text, tone = '') {
  notice.value = text
  error.value = tone === 'error' ? text : ''
  if (tone === 'error') notice.value = ''
}

async function load() {
  loading.value = true
  try {
    const r = await contentApi.sources(props.adminKey)
    if (!r.ok) { error.value = r.error || '读取失败'; return }
    sources.value = r.sources || []
    fetches.value = r.fetches || []
    scheduler.value = r.scheduler || null
  } finally {
    loading.value = false
  }
}

function startCreate() {
  editing.value = true
  form.value = emptyForm()
}

function startEdit(source) {
  editing.value = true
  form.value = {
    ...source,
    enabled: Boolean(source.enabled),
  }
}

function cancelEdit() {
  editing.value = false
  form.value = emptyForm()
}

async function save() {
  if (!form.value.id.trim() || !form.value.url.trim()) {
    say('id 与 url 必填', 'error')
    return
  }
  busy.value = 'save'
  try {
    const r = await contentApi.saveSource(props.adminKey, {
      ...form.value,
      id: form.value.id.trim(),
      weight: Number(form.value.weight) || 1,
      maxItems: Number(form.value.maxItems) || 60,
    })
    if (!r.ok) { say(r.error || '保存失败', 'error'); return }
    say('已保存')
    editing.value = false
    await load()
  } finally {
    busy.value = ''
  }
}

async function toggle(source) {
  busy.value = source.id
  try {
    const r = await contentApi.saveSource(props.adminKey, { ...source, enabled: !source.enabled })
    if (!r.ok) { say(r.error || '操作失败', 'error'); return }
    await load()
  } finally {
    busy.value = ''
  }
}

async function remove(source) {
  if (!window.confirm(`删除源「${source.label}」？已抓取的历史条目会保留，直到 30 天过期。`)) return
  busy.value = source.id
  try {
    const r = await contentApi.deleteSource(props.adminKey, source.id)
    if (!r.ok) { say(r.error || '删除失败', 'error'); return }
    say('已删除')
    await load()
  } finally {
    busy.value = ''
  }
}

async function test(source) {
  busy.value = source.id
  say(`正在测试 ${source.label}…`)
  try {
    const r = await contentApi.testSource(props.adminKey, source.id)
    if (!r.ok) { say(r.error || '测试失败', 'error'); return }
    const result = r.result || {}
    say(`${source.label}：${result.status} · 抓取 ${result.fetched || 0} 条 · 新增 ${result.added || 0} 条${result.error ? ` · ${result.error}` : ''}`)
    await load()
  } finally {
    busy.value = ''
  }
}

async function refreshAll() {
  busy.value = 'refresh'
  try {
    const r = await contentApi.refresh(props.adminKey)
    if (!r.ok) { say(r.error || '启动失败', 'error'); return }
    say(r.running ? '已有抓取在运行' : '已启动抓取，稍后查看日志')
  } finally {
    busy.value = ''
  }
}

onMounted(load)
</script>

<template>
  <div class="cs">
    <div class="cs-head">
      <div>
        <h2 class="cs-title">内容源</h2>
        <p class="cs-sub">
          RSS / Atom / JSON Feed / 官方 API。抓取只取标题、摘要与回链，条目保留 30 天。
        </p>
      </div>
      <div class="cs-actions">
        <button class="cs-btn" type="button" :disabled="loading" @click="load">
          {{ loading ? '读取中…' : '刷新' }}
        </button>
        <button class="cs-btn" type="button" :disabled="busy === 'refresh'" @click="refreshAll">
          {{ busy === 'refresh' ? '抓取中…' : '抓取全部到期源' }}
        </button>
        <button class="cs-btn primary" type="button" @click="startCreate">新增源</button>
      </div>
    </div>

    <p v-if="error" class="cs-msg bad">{{ error }}</p>
    <p v-else-if="notice" class="cs-msg ok">{{ notice }}</p>

    <p v-if="scheduler" class="cs-hint">
      调度：{{ scheduler.enabled ? `已开启 · 每 ${scheduler.intervalMinutes} 分钟` : '未开启（NAV_CONTENT_ENABLED=1 后启动）' }}
      <template v-if="scheduler.lastResult"> · 最近 {{ fmtTime(scheduler.lastRunAt) }} 新增 {{ scheduler.lastResult.added }} 条</template>
      <template v-if="scheduler.lastError"> · 错误：{{ scheduler.lastError }}</template>
    </p>

    <section v-if="editing" class="cs-form">
      <h3>{{ form.label ? `编辑：${form.label}` : '新增源' }}</h3>
      <div class="cs-form-grid">
        <label><span>id</span><input v-model="form.id" :disabled="Boolean(form.label)" placeholder="唯一 id"></label>
        <label><span>名称</span><input v-model="form.label" placeholder="显示名称"></label>
        <label><span>类型</span>
          <select v-model="form.type">
            <option v-for="t in TYPE_OPTIONS" :key="t" :value="t">{{ t }}</option>
          </select>
        </label>
        <label class="wide"><span>URL</span><input v-model="form.url" placeholder="https://... 或 GitHub 搜索模板"></label>
        <label><span>领域</span>
          <select v-model="form.domain">
            <option v-for="d in DOMAIN_OPTIONS" :key="d.id" :value="d.id">{{ d.label }}</option>
          </select>
        </label>
        <label><span>分类</span>
          <select v-model="form.categoryId">
            <option v-for="c in allCategories" :key="c.id" :value="c.id">{{ c.group }} / {{ c.label }}</option>
          </select>
        </label>
        <label><span>权重</span><input v-model.number="form.weight" type="number" min="0.1" max="3" step="0.05"></label>
        <label><span>单次上限</span><input v-model.number="form.maxItems" type="number" min="1" max="200"></label>
        <label class="inline"><input v-model="form.enabled" type="checkbox"> 启用</label>
      </div>
      <div class="cs-form-actions">
        <button class="cs-btn primary" type="button" :disabled="busy === 'save'" @click="save">
          {{ busy === 'save' ? '保存中…' : '保存' }}
        </button>
        <button class="cs-btn" type="button" @click="cancelEdit">取消</button>
      </div>
    </section>

    <div class="cs-table-wrap">
      <table class="cs-table">
        <thead>
          <tr>
            <th>源</th><th>类型</th><th>领域 / 分类</th><th>状态</th><th>上次抓取</th><th>下次</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in sources" :key="s.id" :class="{ off: !s.enabled }">
            <td>
              <div class="cs-name">{{ s.label }}</div>
              <code class="cs-id">{{ s.id }}</code>
            </td>
            <td>{{ s.type }}</td>
            <td>{{ s.domain }} / {{ s.categoryId }}</td>
            <td>
              <span v-if="s.failCount" class="cs-pill bad">失败 {{ s.failCount }}</span>
              <span v-else-if="s.enabled" class="cs-pill ok">正常</span>
              <span v-else class="cs-pill">停用</span>
              <div v-if="s.lastError" class="cs-err" :title="s.lastError">{{ s.lastError.slice(0, 40) }}</div>
            </td>
            <td>{{ fmtTime(s.lastFetchAt) }}</td>
            <td>{{ s.enabled ? fmtTime(s.nextFetchAt) : '—' }}</td>
            <td class="cs-ops">
              <button class="cs-mini" type="button" :disabled="busy === s.id" @click="test(s)">测试</button>
              <button class="cs-mini" type="button" :disabled="busy === s.id" @click="toggle(s)">{{ s.enabled ? '停用' : '启用' }}</button>
              <button class="cs-mini" type="button" @click="startEdit(s)">编辑</button>
              <button class="cs-mini danger" type="button" :disabled="busy === s.id" @click="remove(s)">删除</button>
            </td>
          </tr>
          <tr v-if="!sources.length"><td colspan="7" class="cs-empty">还没有内容源</td></tr>
        </tbody>
      </table>
    </div>

    <section class="cs-log">
      <h3>最近抓取</h3>
      <ul>
        <li v-for="(f, i) in fetches" :key="`${f.sourceId}-${f.at}-${i}`" :class="{ bad: f.status === 'error' }">
          <span class="cs-log-time">{{ fmtTime(f.at) }}</span>
          <span class="cs-log-source">{{ f.label }}</span>
          <span>{{ f.status }}</span>
          <span>新增 {{ f.added || 0 }}</span>
          <span>{{ f.durationMs || 0 }}ms</span>
          <span v-if="f.error" class="cs-log-err">{{ f.error }}</span>
        </li>
        <li v-if="!fetches.length" class="cs-empty">暂无抓取记录</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.cs { display: flex; flex-direction: column; gap: 14px; }
.cs-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.cs-title { margin: 0; font-size: 20px; font-weight: 650; }
.cs-sub { margin: 6px 0 0; color: var(--text-secondary); font-size: 13px; line-height: 1.6; }
.cs-actions { display: flex; gap: 8px; flex-wrap: wrap; }

.cs-btn {
  padding: 7px 14px; border-radius: 7px; border: 1px solid var(--border);
  background: var(--bg-elevated, transparent); color: var(--text); cursor: pointer; font-size: 13px;
}
.cs-btn:hover:not(:disabled) { border-color: var(--accent); }
.cs-btn:disabled { opacity: .5; cursor: default; }
.cs-btn.primary:not(:disabled) { background: var(--accent); border-color: var(--accent); color: #fff; }

.cs-msg { margin: 0; font-size: 13px; }
.cs-msg.bad { color: var(--danger, #b91c1c); }
.cs-msg.ok { color: var(--success, #15803d); }
.cs-hint { margin: 0; color: var(--text-secondary); font-size: 12px; }

.cs-form {
  border: 1px solid var(--border); border-radius: 10px; padding: 14px;
  background: var(--bg-elevated, transparent);
}
.cs-form h3 { margin: 0 0 10px; font-size: 15px; }
.cs-form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
.cs-form-grid label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-secondary); }
.cs-form-grid label.wide { grid-column: 1 / -1; }
.cs-form-grid label.inline { flex-direction: row; align-items: center; gap: 6px; }
.cs-form-grid input, .cs-form-grid select {
  border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px;
  background: var(--bg); color: var(--text); font-size: 13px;
}
.cs-form-actions { display: flex; gap: 8px; margin-top: 12px; }

.cs-table-wrap { overflow: auto; border: 1px solid var(--border); border-radius: 10px; }
.cs-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.cs-table th, .cs-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
.cs-table th { color: var(--text-secondary); font-weight: 500; white-space: nowrap; }
.cs-table tr.off { opacity: .6; }
.cs-name { font-weight: 500; }
.cs-id { font-size: 10.5px; color: var(--text-secondary); }
.cs-pill { font-size: 10.5px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--border); }
.cs-pill.ok { color: var(--success, #15803d); border-color: currentColor; }
.cs-pill.bad { color: var(--danger, #b91c1c); border-color: currentColor; }
.cs-err { color: var(--danger, #b91c1c); font-size: 10.5px; margin-top: 3px; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cs-ops { white-space: nowrap; }
.cs-mini {
  padding: 3px 7px; margin-right: 4px; border: 1px solid var(--border); border-radius: 5px;
  background: transparent; color: var(--text-secondary); cursor: pointer; font-size: 11px;
}
.cs-mini:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.cs-mini.danger:hover { border-color: var(--danger, #b91c1c); color: var(--danger, #b91c1c); }
.cs-mini:disabled { opacity: .45; cursor: default; }

.cs-log { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
.cs-log h3 { margin: 0 0 8px; font-size: 14px; }
.cs-log ul { list-style: none; margin: 0; padding: 0; font-size: 11.5px; }
.cs-log li { display: flex; gap: 10px; padding: 4px 0; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.cs-log li:last-child { border-bottom: none; }
.cs-log li.bad { color: var(--danger, #b91c1c); }
.cs-log-time { color: var(--text-secondary); }
.cs-log-source { min-width: 110px; }
.cs-log-err { flex: 1; color: var(--danger, #b91c1c); }
.cs-empty { text-align: center; color: var(--text-secondary); padding: 16px; font-size: 12px; }
</style>