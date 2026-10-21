<script setup>
/**
 * 浏览器临时工作区：批次列表 → 逐条确认 → 提升入主库。
 *
 * ## 为什么要有这一层
 *
 * 浏览器历史是「结构合法但没价值」的数据海洋。批次先落在 `staging/`，
 * 主库在提升之前完全不受影响；丢弃一批的代价是零。
 *
 * ## 默认策略是「跳过重复」
 *
 * 与主库同网址的条目默认不勾选。想覆盖必须自己选策略 —— 覆盖会替换整条记录
 * （保留原 id、归档、访问计数），属于不可逆操作，不该是默认值。
 */
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ingestApi } from '@/services/ingestApi'
import { fmtDateTimeShort as fmtTime } from '@/utils/format'

const props = defineProps({ adminKey: { type: String, default: '' } })
const emit = defineEmits(['applied'])

const route = useRoute()

const loading = ref(false)
const busy = ref('')
const error = ref('')
const notice = ref('')
const tone = ref('')

const batches = ref([])
const categories = ref([])
const batch = ref(null)
const picked = ref(new Set())
const overrides = ref({})
const strategy = ref('skip')
const filter = ref('pending')
const keyword = ref('')

const MAX_RENDER = 300

const flatCategories = computed(() => {
  const out = []
  for (const g of categories.value) {
    for (const c of g.categories || []) {
      out.push({ id: c.id, label: c.label, group: g.label, color: c.dotColor })
    }
  }
  return out
})

const rows = computed(() => {
  const items = batch.value?.items || []
  const kw = keyword.value.trim().toLowerCase()
  return items.filter(item => {
    if (filter.value === 'new' && item.duplicateOf) return false
    if (filter.value === 'duplicate' && !item.duplicateOf) return false
    if (filter.value === 'pending' && item.status !== 'pending') return false
    if (filter.value === 'promoted' && item.status !== 'promoted') return false
    if (kw && !`${item.title} ${item.url} ${item.site?.name || ''}`.toLowerCase().includes(kw)) return false
    return true
  })
})

const visibleRows = computed(() => rows.value.slice(0, MAX_RENDER))
const selectedCount = computed(() => picked.value.size)

function say(text, t = '') { notice.value = text; tone.value = t }

async function loadList() {
  const r = await ingestApi.list(props.adminKey)
  if (!r.ok) { error.value = r.error || '读取批次失败'; return }
  batches.value = r.batches || []
  categories.value = r.categories || []
}

async function openBatch(id) {
  busy.value = 'open'
  error.value = ''
  try {
    const r = await ingestApi.detail(props.adminKey, id)
    if (!r.ok) { error.value = r.error || '读取批次失败'; return }
    batch.value = r.batch
    overrides.value = {}
    // 默认只勾「新增且未处理」的条目
    picked.value = new Set(
      (r.batch.items || [])
        .filter(i => i.status === 'pending' && !i.duplicateOf)
        .map(i => i.key),
    )
  } finally {
    busy.value = ''
  }
}

async function discard() {
  if (!batch.value) return
  if (!window.confirm(`丢弃批次 ${batch.value.id}？主库不受影响，但该批次条目将不可恢复。`)) return
  busy.value = 'discard'
  try {
    const r = await ingestApi.discard(props.adminKey, batch.value.id)
    if (!r.ok) { error.value = r.error || '丢弃失败'; return }
    say('批次已丢弃', 'ok')
    batch.value = null
    picked.value = new Set()
    await loadList()
  } finally {
    busy.value = ''
  }
}

function toggle(key, checked) {
  const next = new Set(picked.value)
  if (checked) next.add(key)
  else next.delete(key)
  picked.value = next
}

function toggleAll(checked) {
  picked.value = checked ? new Set(rows.value.map(i => i.key)) : new Set()
}

function setCategory(key, catId) {
  overrides.value = { ...overrides.value, [key]: catId }
  // 改分类意味着要保留，顺手勾上
  if (catId) {
    const next = new Set(picked.value)
    next.add(key)
    picked.value = next
  }
  const item = (batch.value?.items || []).find(i => i.key === key)
  if (item && item.site) item.site.categoryId = catId
}

function applyBulkCategory(catId) {
  if (!catId) return
  const next = { ...overrides.value }
  for (const key of picked.value) next[key] = catId
  overrides.value = next
  for (const item of batch.value?.items || []) {
    if (picked.value.has(item.key) && item.site) item.site.categoryId = catId
  }
  say(`已把 ${picked.value.size} 条设为 ${catId}（提升时生效）`, 'ok')
}

async function promote() {
  if (!batch.value || !picked.value.size) { say('没有选中条目', 'warn'); return }
  const selected = [...picked.value]
  const dupCount = (batch.value.items || []).filter(i => selected.includes(i.key) && i.duplicateOf).length
  const msg = strategy.value === 'overwrite'
    ? `将覆盖 ${dupCount} 条主库已有站点，并新增其余条目。覆盖会替换整条记录。继续？`
    : strategy.value === 'new-id'
      ? `同网址也会新建一份（${dupCount} 条与主库重复）。继续？`
      : `将新增 ${selected.length - dupCount} 条，跳过 ${dupCount} 条重复。继续？`
  if (!window.confirm(msg)) return

  busy.value = 'promote'
  error.value = ''
  try {
    const r = await ingestApi.promote(props.adminKey, {
      batchId: batch.value.id,
      keys: selected,
      strategy: strategy.value,
      categoryOverrides: overrides.value,
    })
    if (!r.ok) { error.value = r.error || '提升失败'; return }
    if (r.noop) {
      say('没有可写入的条目（可能已全部处理）', 'warn')
    } else {
      say(`已写入主库：版本 v${r.version}，新增 ${r.stats.added} 条，覆盖 ${r.stats.updated} 条，跳过 ${r.stats.skipped} 条`, 'ok')
      emit('applied', r)
    }
    await openBatch(batch.value.id)
    await loadList()
  } finally {
    busy.value = ''
  }
}

onMounted(async () => {
  loading.value = true
  try {
    await loadList()
    const wanted = String(route.query.batch || '')
    if (wanted) await openBatch(wanted)
    else if (batches.value.length) await openBatch(batches.value[0].id)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="ing">
    <div class="ing-head">
      <div>
        <h2 class="ing-title">浏览器工作区</h2>
        <p class="ing-sub">
          来自浏览器扩展的历史、书签与标签页先落在这里，<b>不进主库</b>。
          确认分类与去重策略后再提升；丢弃一批不影响任何现有站点。
        </p>
      </div>
      <div class="ing-actions">
        <button class="ing-btn" type="button" :disabled="loading" @click="loadList">
          {{ loading ? '读取中…' : '刷新' }}
        </button>
      </div>
    </div>

    <p v-if="error" class="ing-msg bad">{{ error }}</p>
    <p v-else-if="notice" class="ing-msg" :class="tone">{{ notice }}</p>

    <div class="ing-layout">
      <aside class="ing-side">
        <div class="ing-side-head">
          <h3>批次</h3>
          <span class="ing-hint">{{ batches.length }}</span>
        </div>
        <button
          v-for="b in batches"
          :key="b.id"
          type="button"
          class="ing-batch"
          :class="{ active: batch && batch.id === b.id }"
          @click="openBatch(b.id)"
        >
          <span class="ing-batch-id">{{ b.id }}</span>
          <span class="ing-batch-meta">
            {{ fmtTime(b.createdAt) }} · {{ b.stats?.deduped ?? 0 }} 条
          </span>
          <span class="ing-batch-pill" :class="b.status">{{ b.status }}</span>
        </button>
        <p v-if="!batches.length" class="ing-empty">
          还没有批次。在浏览器扩展里扫描后点「保存到临时工作区」。
        </p>
      </aside>

      <section class="ing-main">
        <template v-if="batch">
          <div class="ing-bar">
            <div>
              <h3>{{ batch.id }}</h3>
              <p class="ing-hint">
                {{ fmtTime(batch.createdAt) }} ·
                采集 {{ batch.stats?.incoming ?? 0 }} ·
                去重后 {{ batch.stats?.deduped ?? 0 }} ·
                新增 {{ batch.stats?.newSites ?? 0 }} ·
                主库已有 {{ batch.stats?.duplicates ?? 0 }} ·
                非法 {{ batch.stats?.invalid ?? 0 }}
              </p>
            </div>
            <button class="ing-btn danger" type="button" :disabled="!!busy" @click="discard">丢弃批次</button>
          </div>

          <div class="ing-filters">
            <select v-model="filter" class="ing-select">
              <option value="pending">待处理</option>
              <option value="new">仅新增</option>
              <option value="duplicate">仅主库已有</option>
              <option value="promoted">已提升</option>
              <option value="all">全部</option>
            </select>
            <input v-model="keyword" class="ing-input" type="search" placeholder="搜索名称或网址">
            <label class="ing-check">
              <input type="checkbox" :checked="picked.size > 0 && picked.size === rows.length" @change="toggleAll($event.target.checked)"> 全选当前筛选
            </label>
            <span class="ing-hint">已选 {{ selectedCount }}</span>
          </div>

          <div class="ing-bulk">
            <select class="ing-select" @change="applyBulkCategory($event.target.value); $event.target.value = ''">
              <option value="">批量设置分类…</option>
              <optgroup v-for="g in categories" :key="g.id" :label="g.label">
                <option v-for="c in (g.categories || [])" :key="c.id" :value="c.id">{{ c.label }}（{{ c.id }}）</option>
              </optgroup>
            </select>
            <span class="ing-hint">只影响已勾选条目，提升时生效</span>
          </div>

          <div class="ing-table-wrap">
            <table class="ing-table">
              <thead>
                <tr>
                  <th class="col-check"></th>
                  <th>名称 / 网址</th>
                  <th>访问</th>
                  <th>分类</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in visibleRows" :key="item.key" :class="{ dup: item.duplicateOf, done: item.status === 'promoted' }">
                  <td class="col-check">
                    <input
                      type="checkbox"
                      :checked="picked.has(item.key)"
                      :disabled="item.status === 'promoted'"
                      @change="toggle(item.key, $event.target.checked)"
                    >
                  </td>
                  <td>
                    <div class="ing-name">{{ item.site?.name || item.title || item.url }}</div>
                    <code class="ing-url">{{ item.url }}</code>
                  </td>
                  <td>{{ item.visitCount || 0 }}</td>
                  <td>
                    <select
                      class="ing-select small"
                      :value="overrides[item.key] || item.site?.categoryId || ''"
                      :disabled="item.status === 'promoted'"
                      @change="setCategory(item.key, $event.target.value)"
                    >
                      <option v-for="c in flatCategories" :key="c.id" :value="c.id">{{ c.label }}</option>
                    </select>
                  </td>
                  <td>
                    <span v-if="item.status === 'promoted'" class="ing-tag ok">已提升</span>
                    <span v-else-if="item.duplicateOf" class="ing-tag warn">主库已有</span>
                    <span v-else class="ing-tag">新增</span>
                  </td>
                </tr>
                <tr v-if="!visibleRows.length">
                  <td colspan="5" class="ing-empty">当前筛选下没有条目</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="rows.length > MAX_RENDER" class="ing-hint">
            仅显示前 {{ MAX_RENDER }} 条（共 {{ rows.length }} 条），提升仍会包含全部已选条目。
          </p>

          <div class="ing-promote">
            <label class="ing-field">
              <span>冲突策略</span>
              <select v-model="strategy" class="ing-select">
                <option value="skip">跳过重复（默认）</option>
                <option value="overwrite">覆盖同网址记录</option>
                <option value="new-id">同网址也新建</option>
              </select>
            </label>
            <button class="ing-btn primary" type="button" :disabled="!!busy || !selectedCount" @click="promote">
              {{ busy === 'promote' ? '写入中…' : `提升 ${selectedCount} 条到主库` }}
            </button>
          </div>
        </template>
        <p v-else class="ing-empty">从左侧选择一个批次，或在浏览器扩展里新建批次。</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.ing { display: flex; flex-direction: column; gap: 14px; }
.ing-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.ing-title { margin: 0; font-size: 20px; font-weight: 650; }
.ing-sub { margin: 6px 0 0; color: var(--text-secondary); font-size: 13px; line-height: 1.6; max-width: 760px; }
.ing-actions { display: flex; gap: 8px; }

.ing-btn {
  padding: 7px 14px; border-radius: 7px; border: 1px solid var(--border);
  background: var(--bg-elevated, transparent); color: var(--text); cursor: pointer; font-size: 13px;
}
.ing-btn:hover:not(:disabled) { border-color: var(--accent); }
.ing-btn:disabled { opacity: .5; cursor: default; }
.ing-btn.primary:not(:disabled) { background: var(--accent); border-color: var(--accent); color: #fff; }
.ing-btn.danger { color: var(--danger, #b91c1c); }
.ing-btn.danger:hover { border-color: currentColor; }

.ing-msg { margin: 0; font-size: 13px; line-height: 1.6; }
.ing-msg.bad { color: var(--danger, #b91c1c); }
.ing-msg.warn { color: var(--warning, #b45309); }
.ing-msg.ok { color: var(--success, #15803d); }

.ing-layout { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 14px; align-items: start; }
.ing-side { border: 1px solid var(--border); border-radius: 10px; padding: 10px; max-height: 640px; overflow: auto; }
.ing-side-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.ing-side-head h3 { margin: 0; font-size: 14px; }
.ing-batch {
  display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left;
  border: 1px solid transparent; border-radius: 8px; padding: 7px 8px; margin-bottom: 4px;
  background: transparent; color: var(--text); cursor: pointer;
}
.ing-batch:hover { border-color: var(--border); }
.ing-batch.active { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
.ing-batch-id { font-size: 12px; font-family: ui-monospace, monospace; word-break: break-all; }
.ing-batch-meta { font-size: 11px; color: var(--text-secondary); }
.ing-batch-pill { align-self: flex-start; font-size: 10px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--border); color: var(--text-secondary); }
.ing-batch-pill.promoted { color: var(--success, #15803d); border-color: currentColor; }

.ing-main { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; min-width: 0; }
.ing-bar { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.ing-bar h3 { margin: 0; font-size: 14px; font-family: ui-monospace, monospace; }
.ing-hint { color: var(--text-secondary); font-size: 12px; margin: 4px 0 0; }

.ing-filters, .ing-bulk, .ing-promote {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px;
}
.ing-check { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; }
.ing-field { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-secondary); }

.ing-select, .ing-input {
  border: 1px solid var(--border); border-radius: 6px; padding: 5px 7px;
  background: transparent; color: var(--text); font-size: 12px;
}
.ing-select.small { font-size: 11px; max-width: 130px; }
.ing-input { flex: 1; min-width: 160px; }

.ing-table-wrap { overflow: auto; margin-top: 10px; max-height: 440px; border: 1px solid var(--border); border-radius: 8px; }
.ing-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.ing-table th, .ing-table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.ing-table th { color: var(--text-secondary); font-weight: 500; position: sticky; top: 0; background: var(--bg, #fff); }
.ing-table tr.dup { opacity: .72; }
.ing-table tr.done { opacity: .55; }
.col-check { width: 30px; }
.ing-name { font-weight: 500; max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ing-url { color: var(--text-secondary); font-size: 11px; }
.ing-tag { font-size: 10px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--border); color: var(--text-secondary); white-space: nowrap; }
.ing-tag.ok { color: var(--success, #15803d); border-color: currentColor; }
.ing-tag.warn { color: var(--warning, #b45309); border-color: currentColor; }

.ing-empty { color: var(--text-secondary); font-size: 12px; text-align: center; padding: 14px 8px; }

@media (max-width: 860px) {
  .ing-layout { grid-template-columns: 1fr; }
  .ing-side { max-height: 220px; }
}
</style>