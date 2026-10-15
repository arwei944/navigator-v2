<script setup>
/**
 * AI 助手面板（v10-P4）。
 *
 * 两件事，都**只出建议**、不直接改数据：
 *   ① 批量分类建议 —— 对「未分类/未识别」的站点跑一轮，把结果列成可勾选的清单
 *   ② 巡检异常摘要 —— 把 down 的站点归并成一段人话（共同原因 / 先看什么）
 *
 * 入口显隐由服务端能力声明决定（`aiApi.probe()`）：没配 AI 就整块不渲染 —— 沿用 v8 的
 * 「无 key 时入口隐藏」纪律，避免留一个点开就报错的空壳按钮。
 */
import { ref, onMounted, computed } from 'vue'
import { aiApi } from '@/services/aiApi'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { useHealthStore } from '@/stores/health'

const props = defineProps({ adminKey: { type: String, default: '' } })

const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()
const healthStore = useHealthStore()

const ready = ref(false)
const model = ref('')
const busy = ref('')
const message = ref('')
const tone = ref('')
const suggestions = ref([])
const summary = ref('')

function say(t, k = '') { message.value = t; tone.value = k }

onMounted(async () => {
  const p = await aiApi.probe()
  ready.value = p.ready
  model.value = p.model
})

/** 未分类 / 未识别的站点优先（这才是「AI 出手」的地方） */
const candidates = computed(() => {
  const known = new Set(categoriesStore.categories.map(c => c.id))
  return sitesStore.sites
    .filter(s => !s.archived && (!s.categoryId || !known.has(s.categoryId)))
    .slice(0, 20)
})

async function runCategorize() {
  const sites = candidates.value
  if (!sites.length) { say('没有待分类的站点', 'ok'); return }
  busy.value = 'cat'; say('AI 正在看这些站点…')
  try {
    const r = await aiApi.categorize(
      sites.map(s => ({ id: s.id, name: s.name, url: s.url, desc: s.desc })),
      categoriesStore.categories.map(c => ({ id: c.id, label: c.label })),
    )
    if (!r.ok) throw new Error(r.error || '失败')
    suggestions.value = r.suggestions || []
    say(`给出 ${suggestions.value.length} 条建议（勾选后可一键写入）`, 'ok')
  } catch (e) {
    say('分类建议失败：' + (e.message || e), 'err')
  } finally { busy.value = '' }
}

async function runSummarize() {
  busy.value = 'sum'; say('AI 正在读巡检结果…')
  try {
    const down = sitesStore.sites
      .filter(s => healthStore.getStatus(s.id) === 'down')
      .map(s => ({ name: s.name, url: s.url }))
    const r = await aiApi.summarize(down.slice(0, 20))
    if (!r.ok) throw new Error(r.error || '失败')
    summary.value = r.summary || ''
    say('摘要已生成', 'ok')
  } catch (e) {
    say('摘要失败：' + (e.message || e), 'err')
  } finally { busy.value = '' }
}

/** 勾选后写入分类：新建分类走 categoriesStore（会落覆盖层），复用走 updateSiteField */
async function applySuggestion(row) {
  if (!row || row.kind === 'keep') return
  if (row.kind === 'use') {
    sitesStore.updateSiteField(row.id, 'categoryId', row.id === row.id ? row.id : row.id)
    return
  }
  if (row.kind === 'new' && row.label) {
    const cid = `ai-${Date.now().toString(36)}`
    const r = categoriesStore.addCategory(row.groupId || 'tools', { id: cid, label: row.label, dotColor: '#8b5cf6' })
    if (!r.ok) { say('新建分类失败：' + (r.error || ''), 'err'); return }
    sitesStore.updateSiteField(row.id, 'categoryId', cid)
  }
}
</script>

<template>
  <div class="ai-panel">
    <div class="ops-head">
      <h3>AI 助手</h3>
      <span class="ops-hint">模型：{{ model || '—' }} ｜ 只出建议，改数据一律你点确认</span>
    </div>

    <section class="panel">
      <h4>批量分类建议</h4>
      <p class="ops-note">对「未分类 / 分类未识别」的站点跑一轮，最多 20 个。已有分类会优先复用，确实没有合适的才建议新建。</p>
      <button class="mini-btn primary" :disabled="busy === 'cat' || !candidates.length" @click="runCategorize">
        {{ busy === 'cat' ? '分析中…' : `分析 ${candidates.length} 个待分类站点` }}
      </button>
      <ul v-if="suggestions.length" class="list">
        <li v-for="row in suggestions" :key="row.id" class="row">
          <span class="name">{{ row.name }}</span>
          <span class="tag" :class="row.kind">
            {{ row.kind === 'keep' ? '保持原样' : row.kind === 'use' ? `归入「${row.label}」` : `建议新建「${row.label}」` }}
          </span>
          <button v-if="row.kind !== 'keep'" class="mini-btn" @click="applySuggestion(row)">应用</button>
        </li>
      </ul>
      <!-- 空兜底：没有它时，「还没跑」与「跑完没建议」两种情况都是一片空白，
           用户分不清是坏了还是没事可做 -->
      <p v-else class="ops-note">
        {{ busy === 'cat' ? '正在分析…' : '还没有建议。点上面的按钮开始分析；若分析后仍为空，说明现有分类已经够用。' }}
      </p>
    </section>

    <section class="panel">
      <h4>巡检异常摘要</h4>
      <p class="ops-note">把「需处理」的站点归并成一段话：可能的共同原因，以及建议先看什么。</p>
      <button class="mini-btn primary" :disabled="busy === 'sum'" @click="runSummarize">
        {{ busy === 'sum' ? '分析中…' : '生成摘要' }}
      </button>
      <p v-if="summary" class="summary">{{ summary }}</p>
      <p v-else class="ops-note">
        {{ busy === 'sum' ? '正在生成…' : '还没有摘要。点上面的按钮生成；若无异常，摘要会明确说明无需处理。' }}
      </p>
    </section>

    <p v-if="message" class="ops-msg" :class="tone">{{ message }}</p>
  </div>
</template>

<style scoped>
.ai-panel { display: flex; flex-direction: column; gap: 18px; }
.panel { border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
.panel h4 { margin: 0 0 8px; font-size: 14px; font-weight: 600; }
.ops-hint, .ops-note { color: var(--text-secondary); font-size: 12px; line-height: 1.6; }
.list { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.row { display: flex; align-items: center; gap: 10px; font-size: 13px; padding: 6px 8px; border-radius: 6px; background: var(--border-light); }
.name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tag { font-size: 12px; color: var(--text-secondary); }
.tag.new { color: #059669; }
.summary { margin: 12px 0 0; padding: 10px; border-radius: 8px; background: var(--border-light); font-size: 13px; line-height: 1.7; }
.ops-msg { font-size: 13px; }
.ops-msg.ok { color: #059669; }
.ops-msg.err { color: #dc2626; }
.mini-btn { padding: 5px 10px; border-radius: 6px; border: 1px solid var(--border); background: transparent; cursor: pointer; font-size: 12px; }
.mini-btn.primary { background: var(--accent); color: #fff; border-color: transparent; }
.mini-btn:disabled { opacity: .6; cursor: default; }
</style>