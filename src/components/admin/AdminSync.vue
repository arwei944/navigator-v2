<script setup>
/**
 * 三端同步面板：本地库 ↔ BotKeep ↔ WorkBuddy。
 *
 * ## 面板只做两件事
 *
 * 「看清现在谁最新」和「决定要不要推」。真正的写入由服务端完成，
 * 且只推给内容落后的端；前端不拼装站点数据，也没有第二条写通道。
 *
 * ## 为什么先预演
 *
 * 同步本身就是覆盖写。预演（dryRun）会把三端版本、指纹、待写端全部列出来，
 * 确认没有「某端刚被人改过」再执行。默认按钮是预演，执行需要二次确认。
 */
import { ref, computed, onMounted } from 'vue'
import { syncApi } from '@/services/syncApi'

const props = defineProps({ adminKey: { type: String, default: '' } })
const emit = defineEmits(['synced'])

const loading = ref(false)
const busy = ref('')
const error = ref('')
const notice = ref('')
const tone = ref('')
const status = ref(null)
const plan = ref(null)
const lastRun = ref(null)

const targets = computed(() => (status.value ? status.value.targets : []))
const history = computed(() => (status.value && Array.isArray(status.value.history) ? status.value.history : []))

function say(text, t = '') { notice.value = text; tone.value = t }

function fmtTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function shortFp(fp) {
  return fp ? String(fp).slice(0, 10) : '—'
}

function targetState(t) {
  if (!t.configured) return { label: '未配置', cls: 'muted' }
  if (!t.ok) return { label: '不可达', cls: 'bad' }
  if (!plan.value || !plan.value.winner) return { label: '可用', cls: 'ok' }
  if (t.fingerprint === plan.value.winner.fingerprint) return { label: '已最新', cls: 'ok' }
  const action = (plan.value.actions || []).find(a => a.id === t.id)
  if (action) return { label: '待更新', cls: 'warn' }
  return { label: '冲突', cls: 'bad' }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const r = await syncApi.status(props.adminKey)
    if (!r.ok) { error.value = r.error || '读取状态失败'; return }
    status.value = r
    lastRun.value = r.lastResult || null
  } finally {
    loading.value = false
  }
}

async function preview() {
  busy.value = 'preview'
  error.value = ''
  try {
    const r = await syncApi.run(props.adminKey, { dryRun: true })
    if (!r.ok) { error.value = r.error || '预演失败'; return }
    plan.value = r.plan
    lastRun.value = null
    const n = (r.plan.actions || []).length
    say(n ? `预演完成：${n} 个端需要更新` : '预演完成：三端内容已经一致', n ? '' : 'ok')
  } finally {
    busy.value = ''
  }
}

async function execute() {
  const n = plan.value ? (plan.value.actions || []).length : 0
  if (!n) { say('没有需要写入的端，先点「预演」', 'warn'); return }
  if (!window.confirm(`将把「${plan.value.winner.label}」的内容写给 ${n} 个端，写入前各端会自动生成快照。继续？`)) return
  busy.value = 'run'
  error.value = ''
  try {
    const r = await syncApi.run(props.adminKey, { dryRun: false })
    if (!r.ok) {
      error.value = r.error || (r.after && !r.after.consistent ? '写入后复核未通过' : '同步失败')
    }
    lastRun.value = r
    plan.value = r.plan || plan.value
    const failed = (r.results || []).filter(x => !x.ok)
    if (failed.length) {
      error.value = `部分端写入失败：${failed.map(x => `${x.id}（${x.error || x.status}）`).join('；')}`
    } else {
      say(r.after && r.after.consistent ? '同步完成，三端已一致' : '同步完成，但复核显示仍有差异', r.after && r.after.consistent ? 'ok' : 'warn')
    }
    emit('synced')
    await load()
  } finally {
    busy.value = ''
  }
}

onMounted(load)
</script>

<template>
  <div class="sync">
    <div class="sync-head">
      <div>
        <h2 class="sync-title">三端同步</h2>
        <p class="sync-sub">
          以 <b>{{ status?.authority || 'BotKeep' }}</b> 为权威源：只把它推给落后的端，
          <b>永不反向覆盖权威端</b>；权威端不可达时本轮不写任何一端。
          写入仍走各端 <code>POST /api/sites</code>（CAS + 写前快照）。
        </p>
      </div>
      <div class="sync-actions">
        <button class="sync-btn" type="button" :disabled="loading" @click="load">
          {{ loading ? '读取中…' : '刷新状态' }}
        </button>
        <button class="sync-btn" type="button" :disabled="!!busy" @click="preview">
          {{ busy === 'preview' ? '预演中…' : '预演（不写）' }}
        </button>
        <button class="sync-btn primary" type="button" :disabled="!!busy || !plan" @click="execute">
          {{ busy === 'run' ? '同步中…' : '立即同步' }}
        </button>
      </div>
    </div>

    <p v-if="error" class="sync-msg bad">{{ error }}</p>
    <p v-else-if="notice" class="sync-msg" :class="tone">{{ notice }}</p>

    <div class="sync-grid">
      <article v-for="t in targets" :key="t.id" class="sync-card">
        <header>
          <div>
            <h3>{{ t.label }}</h3>
            <code class="sync-url">{{ t.url || '未配置地址' }}</code>
          </div>
          <span class="sync-pill" :class="targetState(t).cls">{{ targetState(t).label }}</span>
        </header>
        <dl class="sync-fields">
          <div><dt>版本</dt><dd>{{ t.version ?? '—' }}</dd></div>
          <div><dt>站点</dt><dd>{{ t.sites ?? '—' }}</dd></div>
          <div><dt>更新时间</dt><dd>{{ fmtTime(t.updatedAt) }}</dd></div>
          <div><dt>内容指纹</dt><dd><code>{{ shortFp(t.fingerprint) }}</code></dd></div>
        </dl>
        <p v-if="t.error" class="sync-card-error">{{ t.error }}</p>
      </article>
    </div>

    <section v-if="plan" class="sync-panel">
      <div class="sync-panel-head">
        <h3>同步计划</h3>
        <span class="sync-hint">
          权威源：{{ plan.authority || '自动选最新' }} ·
          主端：{{ plan.winner ? plan.winner.label : '无（权威端不可用）' }}
        </span>
      </div>
      <div class="sync-chips">
        <span class="sync-chip" :class="{ ok: plan.consistent }">
          {{ plan.consistent ? '三端一致' : '存在差异' }}
        </span>
        <span v-for="a in plan.actions" :key="a.id" class="sync-chip warn">
          待写 {{ a.label }}（{{ a.reason === 'empty' ? '空库' : '落后' }}）
        </span>
        <span v-for="c in plan.conflicts" :key="c.id" class="sync-chip bad">
          冲突 {{ c.label }}
        </span>
        <span v-for="d in plan.diverged" :key="d.id" class="sync-chip warn">
          另一端更新 {{ d.label }}（仍以权威源为准）
        </span>
        <span v-for="id in plan.unreachable" :key="id" class="sync-chip bad">不可达 {{ id }}</span>
      </div>
      <p v-if="plan.authorityUnavailable" class="sync-msg bad">
        权威端 {{ plan.authority }} 不可达或没有数据：本轮不会写入任何一端。
      </p>
      <p v-if="plan.winner" class="sync-hint">
        主端版本 v{{ plan.winner.version }} · {{ fmtTime(plan.winner.updatedAt) }} ·
        指纹 <code>{{ shortFp(plan.winner.fingerprint) }}</code>
      </p>
      <p class="sync-note">
        口径：只比较站点业务字段（名称 / 网址 / 描述 / 分类 / 图标 / 别名 / 用途等）。
        各端巡检产生的归档、置顶、访问计数属于本地状态，写入时保留目标端现值，不参与一致性判定。
      </p>
    </section>

    <section v-if="lastRun" class="sync-panel">
      <div class="sync-panel-head">
        <h3>最近一次结果</h3>
        <span class="sync-hint">
          {{ lastRun.plan ? `主端 ${lastRun.plan.winner?.label || '—'}` : '' }}
          <template v-if="lastRun.after"> · 写后一致 {{ lastRun.after.consistent ? '是' : '否' }}</template>
        </span>
      </div>
      <ul v-if="lastRun.results && lastRun.results.length" class="sync-results">
        <li v-for="r in lastRun.results" :key="r.id" :class="{ bad: !r.ok }">
          {{ r.id }}：{{ r.ok ? `已写入（v${r.body?.version ?? '—'}）` : (r.error || `HTTP ${r.status}`) }}
        </li>
      </ul>
      <p v-else class="sync-hint">{{ lastRun.noop ? '没有需要写入的端' : '未执行写入' }}</p>
      <p v-if="lastRun.removed" class="sync-hint">
        目标端独有站点 {{ lastRun.removed }} 条已先归档到 <code>backups/sync/removed/</code>，可随时取回。
      </p>
      <p v-if="lastRun.error" class="sync-msg bad">{{ lastRun.error }}</p>
    </section>

    <section class="sync-panel">
      <div class="sync-panel-head">
        <h3>同步历史</h3>
        <span class="sync-hint">最多保留 100 条</span>
      </div>
      <div class="sync-table-wrap">
        <table class="sync-table">
          <thead>
            <tr><th>时间</th><th>结果</th><th>主端</th><th>写入</th><th>失败</th><th>触发</th></tr>
          </thead>
          <tbody>
            <tr v-for="(h, i) in history" :key="`${h.at}-${i}`">
              <td>{{ fmtTime(h.at) }}</td>
              <td :class="{ bad: !h.ok, good: h.ok }">{{ h.ok ? '成功' : '失败' }}</td>
              <td>{{ h.winner || '—' }}{{ h.winnerVersion ? ` v${h.winnerVersion}` : '' }}</td>
              <td>{{ (h.written || []).join('、') || '—' }}</td>
              <td>
                {{ (h.failed || []).length ? h.failed.map(f => f.id).join('、') : '—' }}
              </td>
              <td>{{ h.trigger }}</td>
            </tr>
            <tr v-if="!history.length"><td colspan="6" class="sync-empty">暂无记录</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <p v-if="status && !status.hasAdminKey" class="sync-msg warn">
      当前进程未配置 <code>SITES_ADMIN_KEY</code>，写入会被拒绝。启动服务时注入该环境变量即可。
    </p>
  </div>
</template>

<style scoped>
.sync { display: flex; flex-direction: column; gap: 16px; }
.sync-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.sync-title { margin: 0; font-size: 20px; font-weight: 650; }
.sync-sub { margin: 6px 0 0; color: var(--text-secondary); font-size: 13px; line-height: 1.6; max-width: 780px; }
.sync-actions { display: flex; gap: 8px; flex-wrap: wrap; }

.sync-btn {
  padding: 7px 14px; border-radius: 7px; border: 1px solid var(--border);
  background: var(--bg-elevated, transparent); color: var(--text); cursor: pointer; font-size: 13px;
}
.sync-btn:hover:not(:disabled) { border-color: var(--accent); }
.sync-btn:disabled { opacity: .5; cursor: default; }
.sync-btn.primary { border-color: var(--accent); }
.sync-btn.primary:not(:disabled) { background: var(--accent); color: #fff; }

.sync-msg { font-size: 13px; line-height: 1.6; margin: 0; }
.sync-msg.bad { color: var(--danger, #b91c1c); }
.sync-msg.warn { color: var(--warning, #b45309); }
.sync-msg.ok, .sync-msg.good { color: var(--success, #15803d); }

.sync-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
.sync-card {
  border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px;
  background: var(--bg-elevated, transparent);
}
.sync-card header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.sync-card h3 { margin: 0; font-size: 15px; }
.sync-url { display: block; margin-top: 4px; font-size: 11px; color: var(--text-secondary); word-break: break-all; }
.sync-pill { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border); white-space: nowrap; }
.sync-pill.ok { color: var(--success, #15803d); border-color: currentColor; }
.sync-pill.warn { color: var(--warning, #b45309); border-color: currentColor; }
.sync-pill.bad { color: var(--danger, #b91c1c); border-color: currentColor; }
.sync-pill.muted { color: var(--text-secondary); }

.sync-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; margin: 12px 0 0; }
.sync-fields div { min-width: 0; }
.sync-fields dt { font-size: 11px; color: var(--text-secondary); margin: 0; }
.sync-fields dd { margin: 2px 0 0; font-size: 13px; word-break: break-all; }
.sync-card-error { margin: 10px 0 0; font-size: 12px; color: var(--danger, #b91c1c); word-break: break-word; }

.sync-panel { border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
.sync-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.sync-panel-head h3 { margin: 0; font-size: 15px; }
.sync-hint { color: var(--text-secondary); font-size: 12px; }
.sync-note { color: var(--text-secondary); font-size: 12px; line-height: 1.6; margin: 8px 0 0; }

.sync-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.sync-chip { font-size: 12px; padding: 2px 9px; border-radius: 999px; border: 1px solid var(--border); }
.sync-chip.ok { color: var(--success, #15803d); border-color: currentColor; }
.sync-chip.warn { color: var(--warning, #b45309); border-color: currentColor; }
.sync-chip.bad { color: var(--danger, #b91c1c); border-color: currentColor; }

.sync-results { margin: 10px 0 0; padding-left: 18px; font-size: 13px; line-height: 1.8; }
.sync-results li.bad { color: var(--danger, #b91c1c); }

.sync-table-wrap { overflow: auto; margin-top: 10px; }
.sync-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.sync-table th, .sync-table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); white-space: nowrap; }
.sync-table th { color: var(--text-secondary); font-weight: 500; }
.sync-table td.bad { color: var(--danger, #b91c1c); }
.sync-table td.good { color: var(--success, #15803d); }
.sync-empty { text-align: center; color: var(--text-secondary); }
</style>