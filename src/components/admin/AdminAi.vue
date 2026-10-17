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
import { auditCategoryConsistency, auditDescJunk } from '../../../shared/site-infer.mjs'
import { auditSites } from '../../../shared/ops/data-quality.mjs'

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

/**
 * 应用全部「复用已有分类」的建议（#14 的自动应用规则）。
 *
 * 为什么只自动应用这一类：`use` 表示模型在**已有分类里**挑了一个，即使挑得不完美也只是归错类，
 * 撤销成本低；而 `new` 会**新建分类**，那是结构性改动、要人去判断该不该建 —— 留给人点。
 * 这条界线就是「自动应用规则」的全部内容，不做置信度打分（LLM 不吐可靠的分数，编一个只会误导）。
 */
function applyAllConfident() {
  const usable = suggestions.value.filter(s => s.kind === 'use' && s.categoryId)
  if (!usable.length) { say('没有可自动应用的「复用已有分类」建议', 'ok'); return }
  for (const row of usable) sitesStore.updateSiteField(row.id, 'categoryId', row.categoryId)
  const applied = new Set(usable.map(s => s.id))
  suggestions.value = suggestions.value.filter(s => !applied.has(s.id))
  say(`已自动应用 ${usable.length} 条（归入已有分类）；建议新建的仍留给你决定`, 'ok')
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
    // row.id 是**站点 id**，row.categoryId 才是分类 id（早先两者混在一个字段里，见 api/ai.js 的注释）
    sitesStore.updateSiteField(row.id, 'categoryId', row.categoryId)
    return
  }
  if (row.kind === 'new' && row.label) {
    const cid = `ai-${Date.now().toString(36)}`
    const r = categoriesStore.addCategory(row.groupId || 'tools', { id: cid, label: row.label, dotColor: '#8b5cf6' })
    if (!r.ok) { say('新建分类失败：' + (r.error || ''), 'err'); return }
    sitesStore.updateSiteField(row.id, 'categoryId', cid)
  }
}

/* ─────────── F5① 归类一致性 ─────────── */

const consistency = ref(null)   // { scored, consistent, rate, mismatches, topPatterns }

/**
 * 本地跑一致性体检：**不依赖 AI 配置**（纯规则重算），任何时候都可用。
 * 准确率口径见 shared/site-infer.mjs#auditCategoryConsistency 的注释 ——
 * 规则判断不了的站点不计入分母，不然会用「规则没意见」稀释「规则判错了」。
 */
function runConsistency() {
  const meta = Object.fromEntries(categoriesStore.categories.map(c => [c.id, c]))
  consistency.value = auditCategoryConsistency(sitesStore.sites, { categoryMeta: meta })
  const r = consistency.value
  say(r.scored
    ? `规则可判断 ${r.scored} 条，一致 ${r.consistent} 条，准确率 ${(r.rate * 100).toFixed(1)}%`
    : '规则没有对任何站点出手（无信号），没有可比样本', 'ok')
}

/** 把「规则推荐 ≠ 现值」的站点送去 AI 复核 —— 与批量分类同一通道，人确认后才应用 */
async function recheckWithAi() {
  const ids = new Set((consistency.value?.mismatches || []).map(m => m.id))
  const targets = sitesStore.sites.filter(s => ids.has(s.id)).slice(0, 20)
  if (!targets.length) { say('没有待复核的站点', 'ok'); return }
  busy.value = 'cat'; say('AI 正在复核这些站点的归类…')
  try {
    const r = await aiApi.categorize(
      targets.map(s => ({ id: s.id, name: s.name, url: s.url, desc: s.desc })),
      categoriesStore.categories.map(c => ({ id: c.id, label: c.label })),
    )
    if (!r.ok) throw new Error(r.error || '失败')
    suggestions.value = r.suggestions || []
    say(`AI 复核给出 ${suggestions.value.length} 条建议（在上方「批量分类建议」里勾选应用）`, 'ok')
  } catch (e) {
    say('复核失败：' + (e.message || e), 'err')
  } finally { busy.value = '' }
}

/* ─────────── F5② 描述生成 ─────────── */

/**
 * 目标站点 = 「弱描述」（内核 descIssue：缺失/过短/占位/雷同）∪「机器垃圾」（junk 层）。
 * 两个判据都来自共用实现，这里只负责圈人，不另写一套「什么叫描述差」。
 */
const descTargets = computed(() => {
  const weakIds = new Set(auditSites(sitesStore.sites).weakDesc.map(w => w.id))
  const junkIds = new Set(auditDescJunk(sitesStore.sites).map(j => j.id))
  return sitesStore.sites.filter(s => !s.archived && (weakIds.has(s.id) || junkIds.has(s.id))).slice(0, 20)
})

const descSuggestions = ref([])   // [{ id, name, old, desc, changed, picked }]
const pickedCount = computed(() => descSuggestions.value.filter(d => d.picked).length)

async function runDescribe() {
  const targets = descTargets.value
  if (!targets.length) { say('没有待改进的描述（弱描述与机器垃圾检出均为 0）', 'ok'); return }
  busy.value = 'desc'; say('AI 正在写候选描述…')
  try {
    const catLabel = Object.fromEntries(categoriesStore.categories.map(c => [c.id, c.label]))
    const r = await aiApi.describe(targets.map(s => ({
      id: s.id, name: s.name, url: s.url, desc: s.desc,
      categoryId: s.categoryId, categoryLabel: catLabel[s.categoryId] || s.categoryId || '',
    })))
    if (!r.ok) throw new Error(r.error || '失败')
    const old = new Map(targets.map(s => [s.id, s.desc || '']))
    descSuggestions.value = (r.results || [])
      .filter(x => x.changed && x.desc)
      .map(x => ({ ...x, old: old.get(x.id) || '', picked: true }))
    say(descSuggestions.value.length
      ? `给出 ${descSuggestions.value.length} 条候选（默认全选，逐条审阅后写入）`
      : 'AI 认为现有描述已合格，没有重写建议', 'ok')
  } catch (e) {
    say('描述生成失败：' + (e.message || e), 'err')
  } finally { busy.value = '' }
}

/** 写回勾选的描述。只写 picked 的 —— 候选永远只是候选，不勾不写 */
function applyDescSuggestions() {
  const picked = descSuggestions.value.filter(d => d.picked && d.changed && d.desc)
  if (!picked.length) { say('没有勾选任何候选', 'ok'); return }
  const pickedSet = new Set(picked)
  for (const d of picked) sitesStore.updateSiteField(d.id, 'desc', d.desc)
  descSuggestions.value = descSuggestions.value.filter(d => !pickedSet.has(d))
  say(`已写入 ${picked.length} 条描述（本地覆盖层，云端发布后全站生效）`, 'ok')
}

/* ─────────── F5③ 去重建议 ─────────── */

/**
 * 检测与「数据质量体检」（F1）共用同一份内核（shared/ops/data-quality.mjs），
 * 这里只做**只读建议** —— 真正的合并动作在「数据洞察」的体检卡片执行，两处不重复落地。
 */
const dedupe = computed(() => auditSites(sitesStore.sites))
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
      <button
        v-if="suggestions.some(s => s.kind === 'use')"
        class="mini-btn"
        @click="applyAllConfident"
      >
        一键应用「复用已有分类」{{ suggestions.filter(s => s.kind === 'use').length }} 条
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

    <section class="panel">
      <h4>归类一致性体检</h4>
      <p class="ops-note">
        把每条已有分类的站点重新喂给「新增站点时的同一套推断规则」，比对推荐与现值。
        这是<b>规则出手时的准确率</b> —— 规则判断不了的站点不计入分母。
      </p>
      <button class="mini-btn primary" @click="runConsistency">跑一致性体检</button>
      <template v-if="consistency">
        <p class="ops-note cons-rate">
          规则可判断 {{ consistency.scored }} 条 · 一致 {{ consistency.consistent }} 条 ·
          准确率 <b>{{ Math.round(consistency.rate * 1000) / 10 }}%</b>
        </p>
        <div v-if="consistency.topPatterns.length" class="cons-patterns">
          <span v-for="p in consistency.topPatterns" :key="p.pair" class="cons-pattern">{{ p.pair }} ×{{ p.count }}</span>
        </div>
        <ul v-if="consistency.mismatches.length" class="list">
          <li v-for="m in consistency.mismatches.slice(0, 20)" :key="m.id" class="row">
            <span class="name">{{ m.name }}</span>
            <span class="tag diff">{{ m.current }} → {{ m.recommended }}</span>
          </li>
        </ul>
        <button v-if="consistency.mismatches.length" class="mini-btn" @click="recheckWithAi">
          把不一致的送去 AI 复核
        </button>
        <p class="ops-note">
          高频偏差多来自「规则分类粒度比人工体系粗」。系统性改规则前，先看上方偏差是否集中在某几对分类之间。
        </p>
      </template>
    </section>

    <section class="panel">
      <h4>描述生成（缺描述 / 弱描述 / 机器垃圾）</h4>
      <p class="ops-note">
        对描述缺失、过短、占位、与站名雷同或含机器垃圾的站点批量生成候选。
        <b>只出候选</b>，写回要你逐条勾选确认。
      </p>
      <button class="mini-btn primary" :disabled="busy === 'desc' || !ready" @click="runDescribe">
        {{ busy === 'desc' ? '生成中…' : `生成 ${descTargets.length} 个站点的候选描述` }}
      </button>
      <ul v-if="descSuggestions.length" class="list">
        <li v-for="d in descSuggestions" :key="d.id" class="row desc-row">
          <input type="checkbox" v-model="d.picked" class="desc-pick" />
          <span class="desc-body">
            <span class="name">{{ d.name }}</span>
            <span class="desc-old">现：{{ d.old || '（空）' }}</span>
            <span class="desc-new">新：{{ d.desc }}</span>
          </span>
        </li>
      </ul>
      <button v-if="pickedCount" class="mini-btn primary" @click="applyDescSuggestions">
        写入选中的 {{ pickedCount }} 条
      </button>
    </section>

    <section class="panel">
      <h4>重复 / 近似站点建议</h4>
      <p class="ops-note">
        检测与「数据质量体检」共用同一份判据，这里只出建议；合并动作在「数据洞察 → 数据质量体检」卡片里执行。
      </p>
      <ul v-if="dedupe.duplicateUrls.length || dedupe.sameHostGroups.length" class="list">
        <li v-for="g in dedupe.duplicateUrls" :key="g.url" class="row">
          <span class="name">{{ g.names.join(' ／ ') }}</span>
          <span class="tag dup">真重复 · 建议合并（保留 {{ g.keep }}）</span>
        </li>
        <li v-for="g in dedupe.sameHostGroups" :key="g.host" class="row">
          <span class="name">{{ g.names.join(' ／ ') }}</span>
          <span class="tag">同站多入口 · 需人工甄别</span>
        </li>
      </ul>
      <p v-else class="ops-note">未发现真重复或同站多入口。</p>
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
.tag.new { color: var(--ok-fg); }
.summary { margin: 12px 0 0; padding: 10px; border-radius: 8px; background: var(--border-light); font-size: 13px; line-height: 1.7; }
.ops-msg { font-size: 13px; }
.ops-msg.ok { color: var(--ok-fg); }
.ops-msg.err { color: var(--danger-fg); }
.mini-btn { padding: 5px 10px; border-radius: 6px; border: 1px solid var(--border); background: transparent; cursor: pointer; font-size: 12px; }
.mini-btn.primary { background: var(--accent); color: #fff; border-color: transparent; }
.mini-btn:disabled { opacity: .6; cursor: default; }

/* F5 三项：一致性体检 / 描述生成 / 去重建议 */
.cons-rate b { color: var(--accent); }
.cons-patterns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.cons-pattern { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--warn-bg); color: var(--warn-fg); }
.tag.diff { color: var(--warn-fg); }
.tag.dup { color: var(--danger-fg); }
.desc-row { align-items: flex-start; gap: 8px; }
.desc-pick { margin-top: 3px; flex-shrink: 0; accent-color: var(--accent); }
.desc-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.desc-old { font-size: 11px; color: var(--text-secondary); }
.desc-new { font-size: 12px; color: var(--ok-fg); }
</style>