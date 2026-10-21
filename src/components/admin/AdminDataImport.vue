<script setup>
/**
 * 站点导入区。
 *
 * 流程固定为「选文件 → 预检 → 看无效行 → 确认导入」。预检不写库，
 * 所以用户可以先看清「新增几条、覆盖哪些、哪一行不合法」再决定。
 */
import { ref, computed } from 'vue'
import { dataManagerApi } from '@/services/dataManagerApi'
import { useDataWrite } from '@/composables/useDataWrite'
import { fmtBytes } from '@/utils/format'

const props = defineProps({
  adminKey: { type: String, default: '' },
  catalog: { type: Array, default: () => [] },
  limits: { type: Object, default: () => ({ maxImportRows: 5000 }) },
})
const emit = defineEmits(['applied', 'changed'])

const { writePayload } = useDataWrite(() => props.adminKey)

const text = ref('')
const fileName = ref('')
const format = ref('auto')
const strategy = ref('skip')
const result = ref(null)
const importing = ref(false)
const applying = ref(false)
const message = ref('')
const tone = ref('')

function say(msg, t = '') { message.value = msg; tone.value = t }

const strategyDesc = computed(() => {
  const hit = props.catalog.find(s => s.key === strategy.value)
  return hit ? hit.desc : ''
})

function onFile(ev) {
  const file = ev.target.files && ev.target.files[0]
  if (!file) return
  fileName.value = file.name
  result.value = null
  say('')
  const reader = new FileReader()
  reader.onload = () => {
    text.value = String(reader.result || '')
    say(`已读取 ${file.name}（${fmtBytes(file.size)}），点「导入预检」查看结果。`, 'ok')
  }
  reader.onerror = () => say('读取文件失败', 'err')
  reader.readAsText(file)
}

async function preview() {
  if (!text.value.trim()) { say('还没有选择文件', 'err'); return }
  importing.value = true
  result.value = null
  say('')
  try {
    const res = await dataManagerApi.importPlan(props.adminKey, {
      text: text.value,
      format: format.value,
      strategy: strategy.value,
    })
    if (!res.ok) { say(res.error || '导入预检失败', 'err'); return }
    result.value = res
    const s = res.stats
    say(
      `预检完成：共 ${s.incoming} 行 → 新增 ${s.adds}、覆盖 ${s.updates}、跳过 ${s.skips}、无效 ${s.invalid}。` +
      (s.invalid ? '无效行不会写入，请先看清单。' : ''),
      s.invalid ? 'err' : 'ok',
    )
  } catch (e) {
    say('导入预检失败：' + (e.message || e), 'err')
  } finally {
    importing.value = false
  }
}

async function apply() {
  const res = result.value
  if (!res) return
  if (!res.stats.adds && !res.stats.updates) { say('这份计划没有任何新增或覆盖，无需应用。', 'err'); return }
  applying.value = true
  say('')
  try {
    const v = await writePayload(res.payload, res.baseVersion)
    say(`导入完成：新增 ${res.stats.adds} 条、覆盖 ${res.stats.updates} 条，新版本 v${v}。写前快照已自动生成。`, 'ok')
    result.value = null
    text.value = ''
    fileName.value = ''
    emit('applied', { version: v })
    emit('changed')
  } catch (e) {
    say(e.message || String(e), 'err')
  } finally {
    applying.value = false
  }
}

defineExpose({ reset() { result.value = null; text.value = ''; fileName.value = '' } })
</script>

<template>
  <section class="di">
    <div class="di-head">
      <h3>导入</h3>
      <span class="di-hint">CSV / JSON；先预检，确认后才写入</span>
    </div>

    <div class="di-row">
      <label class="di-field">
        <span>文件</span>
        <input type="file" accept=".csv,.json,text/csv,application/json" @change="onFile">
      </label>
      <label class="di-field">
        <span>格式</span>
        <select v-model="format" class="di-select">
          <option value="auto">自动识别</option>
          <option value="csv">CSV</option>
          <option value="json">JSON</option>
        </select>
      </label>
      <label class="di-field">
        <span>冲突</span>
        <select v-model="strategy" class="di-select">
          <option v-for="s in catalog" :key="s.key" :value="s.key">{{ s.label }}</option>
        </select>
      </label>
      <button type="button" class="di-btn" :disabled="importing" @click="preview">
        {{ importing ? '预检中…' : '导入预检' }}
      </button>
      <button
        type="button"
        class="di-btn primary"
        :disabled="!result || applying || (!result.stats.adds && !result.stats.updates)"
        @click="apply"
      >
        {{ applying ? '写入中…' : '确认导入' }}
      </button>
    </div>

    <p class="di-note">{{ strategyDesc }}</p>
    <p v-if="fileName" class="di-note">已选文件：{{ fileName }}（{{ text.length }} 字符）</p>
    <p class="di-note">
      上限 {{ limits.maxImportRows }} 行。支持本插件导出的 CSV / JSON，
      也支持「名称 / 网址 / 描述 / 分类」这类中文表头；无 id 的行会按网址派生稳定 id。
    </p>

    <p v-if="message" class="di-msg" :class="tone">{{ message }}</p>

    <div v-if="result" class="di-chips">
      <span class="di-chip">共 {{ result.stats.incoming }} 行</span>
      <span class="di-chip" :class="{ bad: result.stats.invalid }">无效 {{ result.stats.invalid }}</span>
      <span class="di-chip">新增 {{ result.stats.adds }}</span>
      <span class="di-chip">覆盖 {{ result.stats.updates }}</span>
      <span class="di-chip" :class="{ warn: result.stats.noopUpdates }">其中无实际变化 {{ result.stats.noopUpdates }}</span>
      <span class="di-chip">字段变更 {{ result.stats.changedFields }}</span>
      <span class="di-chip">跳过 {{ result.stats.skips }}</span>
    </div>

    <div v-if="result && result.invalid.length" class="di-list scroll">
      <p class="di-title">无效行（不会写入）</p>
      <div v-for="(x, i) in result.invalid" :key="i" class="di-line">
        <code>{{ x.line ? ('第 ' + x.line + ' 行') : ('第 ' + x.index + ' 条') }}</code>
        <span class="di-to">{{ x.issues.map(it => it.message).join('；') }}</span>
      </div>
    </div>

    <div v-if="result && result.adds.length" class="di-list scroll">
      <p class="di-title">将新增（前 50 条）</p>
      <div v-for="a in result.adds.slice(0, 50)" :key="a.id" class="di-line">
        <b>{{ a.name }}</b>
        <code>{{ a.url }}</code>
        <span class="di-reason">{{ a.categoryId }}</span>
      </div>
    </div>

    <div v-if="result && result.updates.length" class="di-list scroll">
      <p class="di-title">
        将覆盖（共 {{ result.updatesTotal }} 条，展示前 {{ Math.min(result.updates.length, 50) }} 条）
      </p>
      <div v-for="u in result.updates.slice(0, 50)" :key="u.id" class="di-change">
        <div class="di-line">
          <b>{{ u.name }}</b>
          <code>{{ u.reason }}</code>
          <span class="di-hint">{{ u.fieldCount ? `${u.fieldCount} 处变更` : '无字段变化' }}</span>
        </div>
        <div v-if="u.fields.length" class="di-diffs">
          <div v-for="f in u.fields" :key="f.field" class="di-line diff">
            <code>{{ f.field }}</code>
            <span class="di-from">{{ f.from === '' || f.from === null ? '(空)' : f.from }}</span>
            <span class="di-arrow">→</span>
            <span class="di-to">{{ f.to === '' || f.to === null ? '(空)' : f.to }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.di { display: flex; flex-direction: column; gap: 10px; }
.di-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.di-head h3 { margin: 0; font-size: 14px; font-weight: 650; }
.di-hint { font-size: 12px; color: var(--text-secondary); }
.di-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.di-field { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); }
.di-select {
  padding: 4px 8px; border-radius: 6px; border: 1px solid var(--border);
  background: var(--bg, transparent); color: var(--text); font-size: 12px;
}
.di-btn {
  padding: 7px 14px; border-radius: 7px; border: 1px solid var(--border);
  background: var(--bg-elevated, transparent); color: var(--text); cursor: pointer; font-size: 13px;
}
.di-btn:hover:not(:disabled) { border-color: var(--accent); }
.di-btn.primary { background: var(--accent); color: var(--on-accent); border-color: transparent; }
.di-btn:disabled { opacity: .5; cursor: default; }
.di-note { margin: 0; font-size: 12px; color: var(--text-secondary); line-height: 1.7; }
.di-msg { margin: 0; font-size: 13px; line-height: 1.6; }
.di-msg.ok { color: var(--ok-fg); }
.di-msg.err { color: var(--danger-fg); }
.di-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.di-chip {
  font-size: 12px; padding: 3px 9px; border-radius: 999px;
  border: 1px solid var(--border); color: var(--text-secondary);
}
.di-chip.bad { border-color: var(--danger-fg); color: var(--danger-fg); }
.di-chip.warn { border-color: var(--warn-fg, var(--accent)); color: var(--warn-fg, var(--accent)); }
.di-list { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.di-list.scroll { max-height: 240px; overflow-y: auto; }
.di-title { margin: 6px 0 2px; font-size: 12px; font-weight: 600; color: var(--text-secondary); }
.di-line { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 6px; }
.di-line:nth-child(odd) { background: var(--border-light, transparent); }
.di-line b { font-weight: 600; }
.di-line code { font-size: 11px; color: var(--text-secondary); }
.di-reason { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.di-from { color: var(--danger-fg); text-decoration: line-through; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.di-arrow { color: var(--text-secondary); }
.di-to { color: var(--ok-fg); max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.di-change { border-bottom: 1px dashed var(--border); padding-bottom: 4px; }
.di-change:last-child { border-bottom: 0; }
.di-diffs { padding-left: 16px; display: flex; flex-direction: column; gap: 1px; }
.di-line.diff { padding: 1px 6px; font-size: 11.5px; }
.di-line.diff:nth-child(odd) { background: transparent; }
</style>
