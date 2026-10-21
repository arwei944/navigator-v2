<script setup>
/**
 * 受控修复区。
 *
 * 为什么「选择做什么」全部收在这里、而不是分散在诊断区：
 * 诊断区回答「哪里有问题」，修复区回答「我要怎么改」。把勾选框放在诊断区，
 * 用户会一边看一边点，最后不知道自己到底选了多少 —— 而这是一次会写库的操作。
 */
import { ref, computed } from 'vue'
import { dataManagerApi } from '@/services/dataManagerApi'
import { useDataWrite } from '@/composables/useDataWrite'

const props = defineProps({
  adminKey: { type: String, default: '' },
  fixCatalog: { type: Array, default: () => [] },
  categoryOptions: { type: Array, default: () => [] },
  orphanRows: { type: Array, default: () => [] },
  lowConfidence: { type: Array, default: () => [] },
  total: { type: Number, default: 0 },
})
const emit = defineEmits(['applied', 'changed'])

const { writePayload } = useDataWrite(() => props.adminKey)

const actions = ref({
  normalizeUrl: true,
  fillAliases: true,
  dropMissingIcons: true,
  renumberSortOrder: false,
})
const reassign = ref({})
const markManual = ref([])
/** 作用范围：'' = 全量；`category:<id>` / `domain:<id>` = 只对子集生效 */
const fixScope = ref('')

const plan = ref(null)
const planning = ref(false)
const applying = ref(false)
const message = ref('')
const tone = ref('')

function say(text, t = '') { message.value = text; tone.value = t }

const scopePayload = computed(() => {
  const v = fixScope.value
  if (v.startsWith('category:')) return { categoryId: v.slice('category:'.length) }
  if (v.startsWith('domain:')) return { domain: v.slice('domain:'.length) }
  return null
})

const planChanges = computed(() => (plan.value ? plan.value.changes : []))
const planShown = computed(() => planChanges.value.slice(0, 12))
const planStats = computed(() => (plan.value ? plan.value.stats : null))

function toggleManual(id) {
  const i = markManual.value.indexOf(id)
  if (i >= 0) markManual.value.splice(i, 1)
  else markManual.value.push(id)
}

function selectAllLow() {
  markManual.value = props.lowConfidence.map(s => s.id)
}

function clearLow() {
  markManual.value = []
}

async function preview() {
  planning.value = true
  plan.value = null
  say('')
  try {
    const res = await dataManagerApi.plan(props.adminKey, {
      actions: { ...actions.value, markManual: markManual.value.length > 0 },
      reassign: reassign.value,
      markManual: markManual.value,
      scope: scopePayload.value,
    })
    if (!res.ok) { say(res.error || '生成计划失败', 'err'); return }
    plan.value = res
    if (!res.changes.length) say('没有需要修复的条目（当前勾选项对这份数据没有产生任何改动）。', 'ok')
    else say(`计划生成完毕：${res.stats.changedSites} 条站点、${res.stats.changes} 处字段变更。确认无误后再应用。`, 'ok')
  } catch (e) {
    say('生成计划失败：' + (e.message || e), 'err')
  } finally {
    planning.value = false
  }
}

async function apply() {
  if (!plan.value || !planChanges.value.length) return
  applying.value = true
  say('')
  try {
    const changes = plan.value.stats.changes
    const v = await writePayload(plan.value.payload, plan.value.baseVersion)
    say(`已应用：${changes} 处变更写入云端，新版本 v${v}。写前快照已自动生成，可在「快照与回滚」里撤销。`, 'ok')
    plan.value = null
    markManual.value = []
    reassign.value = {}
    emit('applied', { version: v })
    emit('changed')
  } catch (e) {
    say(e.message || String(e), 'err')
  } finally {
    applying.value = false
  }
}

defineExpose({ reset() { plan.value = null; markManual.value = []; reassign.value = {} } })
</script>

<template>
  <section class="dr">
    <div class="dr-head">
      <h3>受控修复</h3>
      <span class="dr-hint">先生成计划，确认后再写入</span>
    </div>

    <div class="dr-row">
      <label class="dr-field">
        <span>作用范围</span>
        <select v-model="fixScope" class="dr-select">
          <option value="">全部站点</option>
          <optgroup label="按方向">
            <option value="domain:ai-work">ai-work</option>
            <option value="domain:research">research</option>
            <option value="domain:onchain">onchain</option>
            <option value="domain:infra">infra</option>
          </optgroup>
          <optgroup label="按分类">
            <option v-for="c in categoryOptions" :key="c.id" :value="`category:${c.id}`">
              {{ c.group }} / {{ c.label }}
            </option>
          </optgroup>
        </select>
      </label>
      <span class="dr-hint">只约束 URL 归一化 / 补别名 / 清图标；排序重排与逐条指定不受影响</span>
    </div>

    <div class="dr-actions">
      <label v-for="a in fixCatalog" :key="a.key" class="dr-action" :class="`lv-${a.level}`">
        <input v-if="a.key !== 'markManual'" v-model="actions[a.key]" type="checkbox">
        <span v-else class="dr-static">{{ markManual.length ? `已选 ${markManual.length} 条` : '未选择条目' }}</span>
        <span class="dr-action-body">
          <b>{{ a.label }}</b>
          <em>{{ a.desc }}</em>
        </span>
      </label>
    </div>

    <div v-if="orphanRows.length" class="dr-sub">
      <p class="dr-title">孤儿分类重指派</p>
      <div v-for="o in orphanRows" :key="o.id" class="dr-line">
        <b>{{ o.name }}</b>
        <code>{{ o.categoryId }}</code>
        <select v-model="reassign[o.id]" class="dr-select">
          <option value="">不处理</option>
          <option v-for="c in categoryOptions" :key="c.id" :value="c.id">{{ c.group }} / {{ c.label }}</option>
        </select>
      </div>
    </div>

    <div v-if="lowConfidence.length" class="dr-sub">
      <div class="dr-title-row">
        <p class="dr-title">标记人工校正（低置信度 {{ lowConfidence.length }} 条）</p>
        <span class="dr-mini">
          <button type="button" class="dr-link" @click="selectAllLow">全选</button>
          <button type="button" class="dr-link" @click="clearLow">清空</button>
          <span class="dr-hint">已选 {{ markManual.length }}</span>
        </span>
      </div>
      <div class="dr-list scroll">
        <label v-for="s in lowConfidence" :key="s.id" class="dr-line pick">
          <input type="checkbox" :checked="markManual.includes(s.id)" @change="toggleManual(s.id)">
          <b>{{ s.name }}</b>
          <span class="dr-conf">{{ s.confidence }}</span>
          <span class="dr-reason">{{ s.reason || '无归因说明' }}</span>
        </label>
      </div>
    </div>

    <div class="dr-foot">
      <button type="button" class="dr-btn" :disabled="planning" @click="preview">
        {{ planning ? '生成中…' : '生成修复计划' }}
      </button>
      <button type="button" class="dr-btn primary" :disabled="!plan || !planChanges.length || applying" @click="apply">
        {{ applying ? '写入中…' : '确认应用' }}
      </button>
      <span v-if="planStats" class="dr-hint">
        计划：{{ planStats.changedSites }} 条站点 / {{ planStats.changes }} 处变更
        · 范围内 {{ planStats.scopedSites }}/{{ planStats.total }}
        <template v-for="(n, k) in planStats.byAction" :key="k"> · {{ k }} {{ n }}</template>
      </span>
    </div>

    <p v-if="message" class="dr-msg" :class="tone">{{ message }}</p>
    <p v-if="plan && !planChanges.length" class="dr-none">这份计划没有任何改动，无需应用。</p>

    <div v-if="planChanges.length" class="dr-list scroll">
      <div v-for="(c, i) in planShown" :key="i" class="dr-line change">
        <b>{{ c.name }}</b>
        <code>{{ c.field }}</code>
        <span class="dr-from">{{ String(c.from) || '(空)' }}</span>
        <span class="dr-arrow">→</span>
        <span class="dr-to">{{ Array.isArray(c.to) ? c.to.join('; ') : (String(c.to) || '(空)') }}</span>
      </div>
      <p v-if="planChanges.length > planShown.length" class="dr-more">
        还有 {{ planChanges.length - planShown.length }} 处变更未展示
      </p>
    </div>

    <div v-if="plan && plan.skipped.length" class="dr-list">
      <p class="dr-title">被跳过的项</p>
      <div v-for="(s, i) in plan.skipped.slice(0, 8)" :key="i" class="dr-line">
        <code>{{ s.action }}</code><span>{{ s.reason }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.dr { display: flex; flex-direction: column; gap: 10px; }
.dr-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.dr-head h3 { margin: 0; font-size: 14px; font-weight: 650; }
.dr-hint { font-size: 12px; color: var(--text-secondary); }
.dr-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.dr-field { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); }
.dr-select {
  padding: 4px 8px; border-radius: 6px; border: 1px solid var(--border);
  background: var(--bg, transparent); color: var(--text); font-size: 12px;
}
.dr-actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 8px; }
.dr-action {
  display: flex; gap: 9px; align-items: flex-start; padding: 9px 11px;
  border: 1px solid var(--border); border-radius: 8px; cursor: pointer;
}
.dr-action.lv-medium { border-color: var(--warn-fg, var(--accent)); }
.dr-action input { margin-top: 3px; }
.dr-static { font-size: 11px; color: var(--text-secondary); margin-top: 2px; white-space: nowrap; }
.dr-action-body { display: flex; flex-direction: column; gap: 2px; }
.dr-action-body b { font-size: 13px; }
.dr-action-body em { font-style: normal; font-size: 11px; color: var(--text-secondary); line-height: 1.5; }
.dr-sub { display: flex; flex-direction: column; gap: 4px; }
.dr-title-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.dr-title { margin: 6px 0 2px; font-size: 12px; font-weight: 600; color: var(--text-secondary); }
.dr-mini { display: flex; align-items: center; gap: 8px; }
.dr-link { background: none; border: 0; padding: 0; cursor: pointer; color: var(--accent); font-size: 12px; }
.dr-link:hover { text-decoration: underline; }
.dr-list { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.dr-list.scroll { max-height: 220px; overflow-y: auto; }
.dr-line { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 6px; }
.dr-line:nth-child(odd) { background: var(--border-light, transparent); }
.dr-line.pick { cursor: pointer; }
.dr-line b { font-weight: 600; }
.dr-line code { font-size: 11px; color: var(--text-secondary); }
.dr-conf { font-variant-numeric: tabular-nums; color: var(--warn-fg, var(--accent)); }
.dr-reason { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dr-from { color: var(--danger-fg); text-decoration: line-through; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dr-arrow { color: var(--text-secondary); }
.dr-to { color: var(--ok-fg); max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dr-more { margin: 4px 0 0; font-size: 11px; color: var(--text-secondary); }
.dr-none { margin: 0; font-size: 12px; color: var(--text-secondary); }
.dr-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dr-btn {
  padding: 7px 14px; border-radius: 7px; border: 1px solid var(--border);
  background: var(--bg-elevated, transparent); color: var(--text); cursor: pointer; font-size: 13px;
}
.dr-btn:hover:not(:disabled) { border-color: var(--accent); }
.dr-btn.primary { background: var(--accent); color: var(--on-accent); border-color: transparent; }
.dr-btn:disabled { opacity: .5; cursor: default; }
.dr-msg { margin: 0; font-size: 13px; line-height: 1.6; }
.dr-msg.ok { color: var(--ok-fg); }
.dr-msg.err { color: var(--danger-fg); }
</style>
