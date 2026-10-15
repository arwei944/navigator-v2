<template>
  <div class="batch-bar">
    <div class="batch-head">
      <span class="batch-count">已选 <b>{{ selectedIds.size }}</b> 个站点</span>
      <button class="mini-btn" @click="$emit('select-all')">全选当前列表</button>
      <button class="mini-btn" @click="$emit('clear')">取消选择</button>
    </div>

    <div class="batch-row">
      <select v-model="op" class="mini-input">
        <option v-for="o in ops" :key="o.id" :value="o.id">{{ o.label }}</option>
      </select>

      <select v-if="needsCategory" v-model="patch.categoryId" class="mini-input">
        <option value="">选择分类…</option>
        <option v-for="c in categoriesStore.categories" :key="c.id" :value="c.id">{{ c.label }}</option>
      </select>

      <input v-if="needsColor" v-model="patch.color" type="color" class="mini-color" title="统一主题色">

      <!-- 多字段编辑：一次填多个字段，**留空 = 这项不改**（不是清空）—— 与内核 applyFieldset 同一约定 -->
      <template v-if="isFieldset">
        <input v-model="patch.name" class="mini-input" placeholder="名称（留空不改）">
        <input v-model="patch.desc" class="mini-input grow" placeholder="描述（留空不改）">
        <select v-model="patch.categoryId" class="mini-input">
          <option value="">分类（不改）</option>
          <option v-for="c in categoriesStore.categories" :key="c.id" :value="c.id">{{ c.label }}</option>
        </select>
        <input v-model="patch.aliases" class="mini-input" placeholder="别名，逗号分隔（留空不改）">
        <input v-model="patch.purposes" class="mini-input" placeholder="用途 id 或中文标签，逗号分隔（留空不改）">
      </template>

      <input
        v-if="needsAliases"
        v-model="patch.aliases"
        class="mini-input grow"
        :placeholder="op === 'aliasAdd' ? '追加别名，逗号分隔' : '替换为这些别名，逗号分隔'"
      >

      <button class="mini-btn" :disabled="!selectedIds.size" @click="preview">预演影响面</button>
      <button class="mini-btn primary" :disabled="!selectedIds.size" @click="apply">
        {{ def.destructive ? '确认删除' : '执行' }}
      </button>
      <!-- 重新获取信息：与上面的批量改写不是一类（那是同步改字段，这是逐个联网抓取），
           所以独立成按钮、独立给进度，不塞进 BATCH_OPS 那张同步操作表 -->
      <button class="mini-btn" :disabled="!selectedIds.size || refreshing" @click="refreshSelected">
        {{ refreshing ? `获取中 ${doneCount}/${totalCount}` : '重新获取信息' }}
      </button>
      <!-- AI 生成描述：与「重新获取信息」一样是逐个联网的动作，同样独立成按钮、独立给进度 -->
      <button class="mini-btn" :disabled="!selectedIds.size || genDescBusy || refreshing" @click="generateDescriptions">
        {{ genDescBusy ? `AI 生成中 ${genDescProgress}` : 'AI 生成描述' }}
      </button>
    </div>

    <div class="batch-hint">{{ def.hint }}</div>
    <div v-if="previewText" class="batch-preview" :class="{ bad: !previewOk }">{{ previewText }}</div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { BATCH_OPS, BATCH_OP_LIST, applyBatch } from '../../../shared/ops/site-ops.mjs'

defineProps({ adminKey: { type: String, default: '' } })
const emit = defineEmits(['done', 'clear', 'select-all'])

const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()

const ops = BATCH_OP_LIST
const op = ref(BATCH_OP_LIST[0].id)
const patch = reactive({ categoryId: '', color: '#3b82f6', aliases: '', name: '', desc: '', purposes: '' })

const selectedIds = computed(() => sitesStore.selectedIds)
const def = computed(() => BATCH_OPS[op.value])
const needsCategory = computed(() => (def.value.requires || []).includes('categoryId'))
const needsColor = computed(() => (def.value.requires || []).includes('color'))
const needsAliases = computed(() => (def.value.requires || []).includes('aliases'))
/** 多字段编辑走单独一组输入，不按 requires 逐项显隐 */
const isFieldset = computed(() => op.value === 'fieldset')

/** 分类元信息（供内核在改分类时跟随主题色） */
const categoryMeta = computed(() => Object.fromEntries(
  categoriesStore.categories.map(c => [c.id, { color: c.dotColor }]),
))

const previewText = ref('')
const previewOk = ref(true)

/* ---- 重新获取信息（逐个联网抓最新元信息） ---- */

const refreshing = ref(false)
const doneCount = ref(0)
const totalCount = ref(0)

/**
 * 串行刷新选中站点。**串行**是有意的：并发打过去等于同时向几十个站发请求，
 * 既容易被对方的反爬挡下，也会让每个站都变慢；串行还能给出稳定的进度。
 * 每个站点之间互不影响 —— 一个失败不影响后面的。
 */
async function refreshSelected() {
  if (refreshing.value || !selectedIds.value.size) return
  refreshing.value = true
  previewText.value = ''
  const targets = sitesStore.sites.filter(s => selectedIds.value.has(s.id))
  totalCount.value = targets.length
  doneCount.value = 0

  let okCount = 0, changedCount = 0, failCount = 0
  const failed = []
  const { refreshSiteMeta } = await import('@/services/siteRefresh')

  for (const s of targets) {
    try {
      const r = await refreshSiteMeta({
        site: s,
        update: (p) => sitesStore.updateSite(s.id, p),
      })
      if (r.ok) {
        okCount++
        if (r.changed) changedCount++
      } else {
        failCount++
        failed.push(`${s.name}（${r.message}）`)
      }
    } catch (e) {
      failCount++
      failed.push(`${s.name}（${String(e?.message || e)}）`)
    }
    doneCount.value++
  }

  refreshing.value = false
  previewOk.value = failCount === 0
  previewText.value = `重新获取完成：${okCount} 个成功（其中 ${changedCount} 个有更新）`
    + (failCount ? `，${failCount} 个失败 —— ${failed.slice(0, 3).join('；')}${failed.length > 3 ? ' …' : ''}` : '')
}

/* ---- AI 生成 / 改写描述（#13） ---- */

const genDescBusy = ref(false)
const genDescProgress = ref('')

/**
 * 分批调用服务端 `describe`（服务端单次上限 MAX_BATCH）。
 * 只把**真的有变化**的描述写回去：模型常把已经不错的描述原样返回，那不该产生一次无意义的更新。
 */
async function generateDescriptions() {
  if (genDescBusy.value || refreshing.value || !selectedIds.value.size) return
  genDescBusy.value = true
  previewText.value = ''
  try {
    const { aiApi } = await import('@/services/aiApi')
    const targets = sitesStore.sites.filter(s => selectedIds.value.has(s.id))
    const CHUNK = 12
    let changed = 0
    let failed = 0
    for (let i = 0; i < targets.length; i += CHUNK) {
      genDescProgress.value = `${Math.min(i + CHUNK, targets.length)}/${targets.length}`
      const batch = targets.slice(i, i + CHUNK)
      const r = await aiApi.describe(batch.map(s => ({
        id: s.id,
        name: s.name,
        url: s.url,
        desc: s.desc,
        categoryId: s.categoryId,
        categoryLabel: categoriesStore.getCategoryLabel(s.categoryId),
      })))
      if (!r.ok) { failed += batch.length; continue }
      for (const it of r.results || []) {
        if (it.changed && it.desc) { sitesStore.updateSite(it.id, { desc: it.desc }); changed++ }
      }
    }
    previewOk.value = failed === 0
    previewText.value = `AI 生成完成：${changed} 个描述有更新`
      + (failed ? `，${failed} 个失败（AI 未配置或调用出错）` : '')
    if (changed) emit('done', { changes: [], removed: [], skipped: [] })
  } catch (e) {
    previewOk.value = false
    previewText.value = 'AI 生成失败：' + String((e && e.message) || e)
  } finally {
    genDescBusy.value = false
    genDescProgress.value = ''
  }
}

// 换操作即清空上一次的预演结论，避免用旧结果误导用户
watch(op, () => { previewText.value = '' })

function buildPatch() {
  const p = {}
  if (needsCategory.value) p.categoryId = patch.categoryId
  if (needsColor.value) p.color = patch.color
  if (needsAliases.value) p.aliases = patch.aliases
  // 多字段编辑：只把**填了值**的字段带上；留空的字段不进 patch，内核也就不会碰它们
  if (isFieldset.value) {
    const fs = { name: patch.name, desc: patch.desc, categoryId: patch.categoryId, aliases: patch.aliases, purposes: patch.purposes }
    for (const [k, v] of Object.entries(fs)) if (v !== undefined && v !== null && v !== '') p[k] = v
  }
  return p
}

function compute() {
  return applyBatch(sitesStore.sites, {
    ids: [...selectedIds.value],
    op: op.value,
    patch: buildPatch(),
    categoryMeta: categoryMeta.value,
  })
}

function preview() {
  const r = compute()
  previewOk.value = r.ok
  if (!r.ok) { previewText.value = r.errors.join('；'); return }
  const parts = []
  if (r.changes.length) {
    const labels = [...new Set(r.changes.flatMap(c => c.labels))].join('/')
    parts.push(`将更新 ${r.changes.length} 个（字段：${labels}）`)
  }
  if (r.removed.length) parts.push(`将删除 ${r.removed.length} 个`)
  if (r.skipped.length) parts.push(`跳过 ${r.skipped.length} 个（无变化）`)
  previewText.value = parts.join('；') || '无实际改动'
}

function apply() {
  const r = compute()
  previewOk.value = r.ok
  if (!r.ok) { previewText.value = r.errors.join('；'); return }
  if (def.value.destructive && !window.confirm(`${def.value.label}：将移除 ${r.removed.length} 个站点。确认继续？`)) return

  for (const ch of r.changes) {
    const site = r.next.find(s => s.id === ch.id)
    if (!site) continue
    const fields = {}
    for (const k of ch.fields) fields[k] = site[k]
    sitesStore.updateSite(ch.id, fields)
  }
  // 删除走回收站而非硬删：批量误操作可一键恢复，比不可撤销更符合后台场景
  for (const rm of r.removed) sitesStore.deleteSite(rm.id)
  sitesStore.clearSelection()

  previewText.value = `已应用：更新 ${r.changes.length} / 移除 ${r.removed.length} / 跳过 ${r.skipped.length}`
  emit('done', r)
}
</script>

<style scoped>
.batch-bar {
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
  margin-bottom: 12px;
}
.batch-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.batch-count { font-size: 13px; color: var(--text-secondary); }
.batch-count b { color: var(--accent); font-size: 15px; }
.batch-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mini-input {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-family: var(--font);
  color: var(--text-primary);
  background: var(--bg-white);
  outline: none;
}
.mini-input:focus { border-color: var(--accent); }
.mini-input.grow { flex: 1; min-width: 180px; }
.mini-color {
  width: 34px; height: 30px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-white);
  cursor: pointer;
}
.mini-btn {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-white);
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
}
.mini-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.mini-btn:disabled { opacity: .5; cursor: not-allowed; }
.mini-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.mini-btn.primary:hover:not(:disabled) { filter: brightness(1.1); color: #fff; }
.batch-hint { margin-top: 8px; font-size: 12px; color: var(--text-secondary); }
.batch-preview {
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  font-size: 12.5px;
  background: var(--ok-bg);
  color: var(--ok-fg);
  border: 1px solid var(--ok-border);
}
.batch-preview.bad { background: var(--danger-bg); color: var(--danger-fg); border-color: var(--danger-border); }
</style>