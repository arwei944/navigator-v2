<script setup>
/**
 * 重复站点合并向导。
 *
 * 这是面板里**唯一会减少站点条数**的操作，所以界面上必须显式写出「将减少 N 条」，
 * 并让人逐组选择保留项。合并规则由服务端执行（别名取并集、访问量相加），
 * 前端只负责收集选择、展示结果。
 */
import { ref } from 'vue'
import { dataManagerApi } from '@/services/dataManagerApi'
import { useDataWrite } from '@/composables/useDataWrite'

const props = defineProps({
  adminKey: { type: String, default: '' },
  mergeFields: { type: Array, default: () => [] },
})
const emit = defineEmits(['applied', 'changed'])

const { writePayload } = useDataWrite(() => props.adminKey)

const groups = ref([])
const choices = ref({})
const plan = ref(null)
const busy = ref('')
const merging = ref(false)
const message = ref('')
const tone = ref('')

function say(msg, t = '') { message.value = msg; tone.value = t }

async function load() {
  busy.value = 'load'
  plan.value = null
  try {
    const r = await dataManagerApi.duplicates(props.adminKey)
    if (!r.ok) { say(r.error || '查找失败', 'err'); return }
    groups.value = r.groups || []
    choices.value = {}
    for (const g of groups.value) {
      choices.value[g.key] = { keepId: g.suggestedKeepId, fields: {} }
    }
    say(groups.value.length ? `找到 ${groups.value.length} 组重复站点` : '没有发现重复站点。', 'ok')
  } catch (e) {
    say('查找失败：' + (e.message || e), 'err')
  } finally {
    busy.value = ''
  }
}

async function preview() {
  busy.value = 'plan'
  plan.value = null
  try {
    const r = await dataManagerApi.mergePlan(props.adminKey, choices.value)
    if (!r.ok) { say(r.error || '生成合并计划失败', 'err'); return }
    plan.value = r
    say(
      r.stats.removedSites
        ? `合并计划：${r.stats.groups} 组，将减少 ${r.stats.removedSites} 条站点`
        : '没有可合并的组。',
      r.stats.removedSites ? 'ok' : '',
    )
  } catch (e) {
    say('生成合并计划失败：' + (e.message || e), 'err')
  } finally {
    busy.value = ''
  }
}

async function apply() {
  if (!plan.value) return
  merging.value = true
  say('')
  try {
    const removed = plan.value.stats.removedSites
    const v = await writePayload(plan.value.payload, plan.value.baseVersion)
    say(`合并完成：减少 ${removed} 条站点，新版本 v${v}。写前快照已自动生成。`, 'ok')
    plan.value = null
    groups.value = []
    emit('applied', { version: v })
    emit('changed')
  } catch (e) {
    say(e.message || String(e), 'err')
  } finally {
    merging.value = false
  }
}

defineExpose({ reset() { plan.value = null; groups.value = [] } })
</script>

<template>
  <section class="dm-merge">
    <div class="dm-merge-head">
      <h3>重复合并</h3>
      <span class="dm-merge-hint">这不是删除：别名与用途取并集、访问量相加、空字段互相补齐</span>
    </div>

    <div class="dm-merge-foot">
      <button type="button" class="dm-merge-btn" :disabled="busy === 'load'" @click="load">
        {{ busy === 'load' ? '查找中…' : '查找重复站点' }}
      </button>
      <button type="button" class="dm-merge-btn" :disabled="!groups.length || busy === 'plan'" @click="preview">
        {{ busy === 'plan' ? '生成中…' : '生成合并计划' }}
      </button>
      <button type="button" class="dm-merge-btn primary" :disabled="!plan || merging" @click="apply">
        {{ merging ? '合并中…' : '确认合并' }}
      </button>
      <span v-if="plan" class="dm-merge-hint">
        {{ plan.stats.groups }} 组 · 减少 {{ plan.stats.removedSites }} 条
        （{{ plan.stats.before }} → {{ plan.stats.after }}）
      </span>
    </div>

    <p v-if="message" class="dm-merge-msg" :class="tone">{{ message }}</p>

    <p v-if="!groups.length" class="dm-merge-none">
      点「查找重复站点」开始。判据是同网址（归一化后）或同名；A 同网址 B、B 同名 C 会归为同一组。
    </p>

    <div v-for="g in groups" :key="g.key" class="dm-merge-group">
      <p class="dm-merge-title">{{ g.matchReasons.join(' / ') }} · {{ g.ids.length }} 条</p>
      <label v-for="s in g.sites" :key="s.id" class="dm-merge-row">
        <input
          type="radio"
          :name="'keep-' + g.key"
          :value="s.id"
          v-model="choices[g.key].keepId"
        >
        <b>{{ s.name }}</b>
        <code>{{ s.url }}</code>
        <span class="dm-merge-reason">{{ (s.desc || '').slice(0, 40) || '(无描述)' }}</span>
        <span class="dm-merge-hint">访问 {{ s.visitCount }}</span>
      </label>
      <div class="dm-merge-fields">
        <label v-for="f in mergeFields" :key="f.key" class="dm-merge-field">
          <span>{{ f.label }}</span>
          <select v-model="choices[g.key].fields[f.key]" class="dm-merge-select">
            <option value="">自动</option>
            <option v-for="s in g.sites" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </label>
      </div>
    </div>

    <div v-if="plan && plan.merges.length" class="dm-merge-list">
      <p class="dm-merge-title">合并结果</p>
      <div v-for="m in plan.merges.slice(0, 20)" :key="m.key" class="dm-merge-line">
        <b>{{ m.keptName }}</b>
        <span class="dm-merge-arrow">⇐</span>
        <span class="dm-merge-to">{{ m.removedNames.join('、') }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.dm-merge { display: flex; flex-direction: column; gap: 10px; }
.dm-merge-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.dm-merge-head h3 { margin: 0; font-size: 14px; font-weight: 650; }
.dm-merge-hint { font-size: 12px; color: var(--text-secondary); }
.dm-merge-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dm-merge-btn {
  padding: 7px 14px; border-radius: 7px; border: 1px solid var(--border);
  background: var(--bg-elevated, transparent); color: var(--text); cursor: pointer; font-size: 13px;
}
.dm-merge-btn:hover:not(:disabled) { border-color: var(--accent); }
.dm-merge-btn.primary { background: var(--accent); color: var(--on-accent); border-color: transparent; }
.dm-merge-btn:disabled { opacity: .5; cursor: default; }
.dm-merge-msg { margin: 0; font-size: 13px; line-height: 1.6; }
.dm-merge-msg.ok { color: var(--ok-fg); }
.dm-merge-msg.err { color: var(--danger-fg); }
.dm-merge-none { margin: 0; font-size: 12px; color: var(--text-secondary); }
.dm-merge-group {
  border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px;
  display: flex; flex-direction: column; gap: 3px;
}
.dm-merge-title { margin: 6px 0 2px; font-size: 12px; font-weight: 600; color: var(--text-secondary); }
.dm-merge-row {
  display: flex; align-items: center; gap: 8px; font-size: 12px;
  padding: 3px 4px; border-radius: 6px; cursor: pointer;
}
.dm-merge-row:hover { background: var(--border-light, transparent); }
.dm-merge-row b { font-weight: 600; }
.dm-merge-row code { font-size: 11px; color: var(--text-secondary); }
.dm-merge-reason { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.dm-merge-fields { display: flex; flex-wrap: wrap; gap: 10px; padding: 4px 0 2px 22px; }
.dm-merge-field { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); }
.dm-merge-select {
  padding: 3px 7px; border-radius: 6px; border: 1px solid var(--border);
  background: var(--bg, transparent); color: var(--text); font-size: 12px;
}
.dm-merge-list { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.dm-merge-line { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 6px; }
.dm-merge-line:nth-child(odd) { background: var(--border-light, transparent); }
.dm-merge-arrow { color: var(--text-secondary); }
.dm-merge-to { color: var(--ok-fg); }
</style>
