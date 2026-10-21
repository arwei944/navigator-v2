<script setup>
/**
 * 数据管理面板 —— 站点库的体检、趋势、导出，以及三个写操作入口。
 *
 * ## 它与「站点管理」的分工
 *
 * `AdminSitesPanel` 管**录入**（单条增删改、批量、书签导入）；这里管**库的质量**：
 * 哪些字段成片缺失、哪些分类指向了不存在的目标、哪些推断不可信、资源引用是否对得上。
 *
 * ## 为什么拆成三个子组件
 *
 * 修复、导入、合并各自都有「草稿状态 + 预览 + 写入」三步，混在一个文件里会让
 * 一个 1100 行的组件同时管理三套互不相关的草稿。拆开后本文件只负责**读**：
 * 加载报告、展示分区、导出。写操作各自封装，共用一个 `useDataWrite`。
 *
 * ## 读取口径
 *
 * 报告来自服务端对**权威数据**的计算（不是前端本地视图），避免把访客本地的
 * overlay 增删改混进体检结果。读取失败一律显式报错，不显示一份「空库报告」。
 */
import { ref, computed, onMounted } from 'vue'
import { dataManagerApi } from '@/services/dataManagerApi'
import AdminDataRepair from './AdminDataRepair.vue'
import AdminDataMerge from './AdminDataMerge.vue'
import AdminDataImport from './AdminDataImport.vue'
import { fmtDateTimeSec as fmtTime, fmtBytes } from '@/utils/format'

const props = defineProps({ adminKey: { type: String, default: '' } })
const emit = defineEmits(['applied'])

const loading = ref(false)
const error = ref('')
const notice = ref('')
const tone = ref('')
const report = ref(null)

/** 趋势 */
const history = ref(null)
const historyBusy = ref('')

/** 导出 */
const exportFormat = ref('json')
const exportCategory = ref('')
const exportDomain = ref('')
const exporting = ref(false)
const exportingReport = ref('')

const repairRef = ref(null)
const mergeRef = ref(null)
const importRef = ref(null)

const r = computed(() => (report.value && report.value.report ? report.value.report : null))
const total = computed(() => (r.value ? r.value.total : 0))

const categoryOptions = computed(() => {
  const groups = (report.value && report.value.categories) || []
  const out = []
  for (const g of groups) {
    for (const c of g.categories || []) out.push({ id: c.id, label: c.label, group: g.label })
  }
  return out
})

const orphanRows = computed(() => (r.value ? r.value.orphanCategories : []))
const lowConfidence = computed(() => (r.value ? r.value.inference.lowConfidence : []))
const fieldRows = computed(() => (r.value ? r.value.fields : []))

const urlIssueTotal = computed(() => {
  if (!r.value) return 0
  const u = r.value.urlIssues
  return u.hasProtocol.length + u.hasWww.length + u.hasTrailingSlash.length + u.invalid.length
})

function say(text, t = '') { notice.value = text; tone.value = t }

function downloadBlob(blob, filename) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}

function pct(n, d) {
  if (!d) return 0
  return Math.round((n / d) * 1000) / 10
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await dataManagerApi.report(props.adminKey)
    if (!res.ok) { error.value = res.error || '读取失败'; report.value = null; return }
    report.value = res
  } catch (e) {
    error.value = e.message || String(e)
  } finally {
    loading.value = false
  }
}

/* ---------------- 趋势 ---------------- */

async function loadHistory() {
  try {
    const res = await dataManagerApi.history(props.adminKey)
    if (res.ok) history.value = res
  } catch { /* 趋势是辅助信息，失败不显示错误条 */ }
}

async function recordHistory() {
  historyBusy.value = 'record'
  try {
    const res = await dataManagerApi.record(props.adminKey)
    if (!res.ok) { say(res.error || '记录失败', 'err'); return }
    history.value = { ...(history.value || {}), items: res.items, series: res.series, count: res.count }
    say(
      res.added
        ? `已记录：问题 ${res.entry.issueCount} 个（共 ${res.count} 个点）`
        : '与上一条完全相同，已去重（5 分钟内同问题数不重复记录）',
      res.added ? 'ok' : '',
    )
  } catch (e) {
    say('记录失败：' + (e.message || e), 'err')
  } finally {
    historyBusy.value = ''
  }
}

/** 迷你折线：只画问题总数的相对走势，不画坐标轴 */
const spark = computed(() => {
  const pts = (history.value && history.value.series) || []
  if (pts.length < 2) return null
  const w = 260
  const h = 48
  const vs = pts.map(p => p.value)
  const min = Math.min(...vs)
  const max = Math.max(...vs)
  const span = max - min || 1
  const d = pts.map((p, i) => {
    const x = (i / (pts.length - 1)) * w
    const y = h - ((p.value - min) / span) * (h - 4) - 2
    return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return { d, w, h, min, max, first: vs[0], last: vs[vs.length - 1], count: vs.length }
})

/* ---------------- 导出 ---------------- */

async function doExport() {
  exporting.value = true
  say('')
  try {
    const slice = exportCategory.value
      ? { categoryId: exportCategory.value }
      : exportDomain.value ? { domain: exportDomain.value } : {}
    const { blob, filename } = await dataManagerApi.download(exportFormat.value, slice, props.adminKey)
    downloadBlob(blob, filename)
    say(`已导出 ${filename}（${fmtBytes(blob.size)}）`, 'ok')
  } catch (e) {
    say('导出失败：' + (e.message || e), 'err')
  } finally {
    exporting.value = false
  }
}

async function exportReport(kind) {
  exportingReport.value = kind
  say('')
  try {
    const { blob, filename } = await dataManagerApi.downloadReport(kind, props.adminKey)
    downloadBlob(blob, filename)
    say(`已导出 ${filename}（${fmtBytes(blob.size)}）`, 'ok')
  } catch (e) {
    say('导出报告失败：' + (e.message || e), 'err')
  } finally {
    exportingReport.value = ''
  }
}

/* ---------------- 子组件回调 ---------------- */

async function onApplied(payload) {
  emit('applied', payload)
  repairRef.value && repairRef.value.reset()
  mergeRef.value && mergeRef.value.reset()
  importRef.value && importRef.value.reset()
  await load()
  await loadHistory()
}

onMounted(() => { load(); loadHistory() })
</script>

<template>
  <div class="dm">
    <header class="dm-head">
      <div>
        <h2 class="dm-title">数据管理</h2>
        <p class="dm-sub">
          站点库的体检、趋势、修复、合并与导入导出。体检只读；所有写操作都先生成计划，
          确认后才走站点库唯一通道（CAS + 写前快照）。
        </p>
      </div>
      <button type="button" class="dm-btn" :disabled="loading" @click="load">
        {{ loading ? '体检中…' : '重新体检' }}
      </button>
    </header>

    <p v-if="error" class="dm-msg err">{{ error }}</p>
    <p v-if="notice" class="dm-msg" :class="tone">{{ notice }}</p>

    <p v-if="loading && !report" class="dm-empty">正在读取站点库并生成报告…</p>

    <template v-if="r">
      <!-- 概览 -->
      <section class="dm-stats">
        <div class="dm-stat">
          <b>{{ r.total }}</b>
          <span>站点总数</span>
        </div>
        <div class="dm-stat">
          <b>v{{ report.version }}</b>
          <span>数据版本</span>
        </div>
        <div class="dm-stat">
          <b>{{ r.categoriesDefined }}</b>
          <span>分类数</span>
        </div>
        <div class="dm-stat" :class="{ warn: r.issueCount > 0 }">
          <b>{{ r.issueCount }}</b>
          <span>待处理问题</span>
        </div>
        <div class="dm-stat" :class="{ warn: lowConfidence.length > 0 }">
          <b>{{ lowConfidence.length }}</b>
          <span>低置信度</span>
        </div>
        <div class="dm-stat">
          <b>{{ r.resources.iconMissing.length }}</b>
          <span>图标缺失</span>
        </div>
      </section>

      <p class="dm-meta">
        数据更新时间 {{ fmtTime(report.updatedAt) }} · 体检生成于 {{ fmtTime(report.at) }} ·
        数据来源 {{ report.storedAt === 'stored' ? '云端已存数据' : '构建期种子' }} ·
        低置信度阈值 ≤ {{ report.thresholds.lowConfidence }}
        <span v-if="!report.resourcesChecked" class="dm-tag off">图标目录未找到，资源检查已跳过</span>
      </p>

      <!-- 趋势 -->
      <section class="dm-card">
        <div class="dm-card-head">
          <h3>体检趋势</h3>
          <span class="dm-hint">显式记录 · 最多保留 {{ (history && history.keep) || 100 }} 个点</span>
        </div>
        <div class="dm-trend-body">
          <div class="dm-trend-num">
            <b>{{ spark ? spark.last : r.issueCount }}</b>
            <span v-if="spark">
              较首个点 {{ spark.last - spark.first > 0 ? '+' : '' }}{{ spark.last - spark.first }}
            </span>
            <span v-else>当前问题数</span>
          </div>
          <svg v-if="spark" :viewBox="`0 0 ${spark.w} ${spark.h}`" class="dm-spark" preserveAspectRatio="none" aria-hidden="true">
            <path :d="spark.d" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" />
          </svg>
          <div v-else class="dm-none">还没有足够的记录点（至少 2 次）。</div>
          <button type="button" class="dm-btn" :disabled="historyBusy === 'record'" @click="recordHistory">
            {{ historyBusy === 'record' ? '记录中…' : '记录本次体检' }}
          </button>
        </div>
        <p v-if="spark" class="dm-note">
          共 {{ spark.count }} 个点 · 最低 {{ spark.min }} · 最高 {{ spark.max }} ·
          同问题数在 5 分钟内不重复记录
        </p>
      </section>

      <!-- 字段覆盖 -->
      <section class="dm-card">
        <div class="dm-card-head">
          <h3>字段覆盖</h3>
          <span class="dm-hint">缺失按「空字符串 / 空数组 / 空对象 / 非数值」判定</span>
        </div>
        <div class="dm-table">
          <div v-for="f in fieldRows" :key="f.key" class="dm-row">
            <code class="dm-key">{{ f.key }}</code>
            <span class="dm-label">{{ f.label }}</span>
            <div class="dm-bar"><i :style="{ width: pct(f.covered, total) + '%' }" :class="{ bad: f.missingCount > 0 && f.required }"></i></div>
            <span class="dm-num">{{ f.covered }}/{{ total }}</span>
            <span class="dm-miss" :class="{ bad: f.missingCount > 0 }">{{ f.missingCount ? `缺 ${f.missingCount}` : '完整' }}</span>
          </div>
        </div>
      </section>

      <!-- 一致性问题 -->
      <section class="dm-card">
        <div class="dm-card-head">
          <h3>一致性问题</h3>
          <span class="dm-hint">重复、孤儿分类、URL 形态</span>
        </div>
        <div class="dm-chips">
          <span class="dm-chip" :class="{ bad: r.duplicates.urls.length }">重复网址 {{ r.duplicates.urls.length }}</span>
          <span class="dm-chip" :class="{ bad: r.duplicates.names.length }">重复名称 {{ r.duplicates.names.length }}</span>
          <span class="dm-chip" :class="{ bad: r.duplicates.ids.length }">重复 ID {{ r.duplicates.ids.length }}</span>
          <span class="dm-chip" :class="{ bad: orphanRows.length }">孤儿分类 {{ orphanRows.length }}</span>
          <span class="dm-chip" :class="{ bad: r.urlIssues.invalid.length }">非法域名 {{ r.urlIssues.invalid.length }}</span>
          <span class="dm-chip" :class="{ bad: urlIssueTotal }">URL 可归一化 {{ urlIssueTotal }}</span>
          <span class="dm-chip">带路径 {{ r.urlIssues.hasPath.length }}</span>
        </div>

        <div v-if="r.duplicates.urls.length" class="dm-list">
          <p class="dm-list-title">重复网址（归一化后）</p>
          <div v-for="d in r.duplicates.urls" :key="d.key" class="dm-line">
            <code>{{ d.key }}</code>
            <span>{{ d.items.map(i => i.name).join(' / ') }}</span>
          </div>
        </div>

        <div v-if="orphanRows.length" class="dm-list">
          <p class="dm-list-title">分类指向了不存在的目标（可在下方修复区重指派）</p>
          <div v-for="o in orphanRows" :key="o.id" class="dm-line">
            <b>{{ o.name }}</b>
            <code>{{ o.categoryId }}</code>
          </div>
        </div>

        <div v-if="r.urlIssues.invalid.length" class="dm-list">
          <p class="dm-list-title">域名格式非法</p>
          <div v-for="u in r.urlIssues.invalid" :key="u.id" class="dm-line">
            <b>{{ u.name }}</b>
            <code>{{ u.url }}</code>
          </div>
        </div>
      </section>

      <!-- 推断质量（只读） -->
      <section class="dm-card">
        <div class="dm-card-head">
          <h3>推断质量</h3>
          <span class="dm-hint">position.source 来自自动推断；低置信度需人工确认</span>
        </div>
        <div class="dm-chips">
          <span v-for="s in r.inference.source" :key="s.key" class="dm-chip">source {{ s.key }}：{{ s.count }}</span>
        </div>
        <div class="dm-chips">
          <span v-for="c in r.inference.confidence" :key="c.key" class="dm-chip" :class="{ warn: Number(c.key) <= report.thresholds.lowConfidence }">
            confidence {{ c.key }}：{{ c.count }}
          </span>
        </div>
        <p class="dm-list-title">低置信度条目（{{ lowConfidence.length }}）—— 在下方修复区勾选后可标记为人工校正</p>
        <p v-if="!lowConfidence.length" class="dm-none">没有低于阈值的条目。</p>
        <div v-else class="dm-list scroll">
          <div v-for="s in lowConfidence.slice(0, 8)" :key="s.id" class="dm-line">
            <b>{{ s.name }}</b>
            <span class="dm-conf">{{ s.confidence }}</span>
            <span class="dm-reason">{{ s.reason || '无归因说明' }}</span>
          </div>
          <p v-if="lowConfidence.length > 8" class="dm-more">还有 {{ lowConfidence.length - 8 }} 条，完整清单在修复区</p>
        </div>
        <div v-if="r.inference.reasons.length" class="dm-chips">
          <span v-for="x in r.inference.reasons" :key="x.key" class="dm-chip dim">{{ x.key }}：{{ x.count }}</span>
        </div>
      </section>

      <!-- 分类分布 -->
      <section class="dm-card">
        <div class="dm-card-head">
          <h3>分类分布</h3>
          <span class="dm-hint">空分类 {{ r.emptyCategories.length }} 个</span>
        </div>
        <div class="dm-bars">
          <div v-for="c in r.categoryDistribution" :key="c.id" class="dm-barrow">
            <code class="dm-key">{{ c.id }}</code>
            <span class="dm-label">{{ c.label }}</span>
            <div class="dm-bar"><i :style="{ width: pct(c.count, r.overloaded.length ? r.overloaded[0].count : 1) + '%' }"></i></div>
            <span class="dm-num">{{ c.count }}</span>
          </div>
        </div>
        <p v-if="r.emptyCategories.length" class="dm-note">
          空分类：{{ r.emptyCategories.map(c => c.label).join('、') }}
        </p>
      </section>

      <!-- 资源与时间 -->
      <section class="dm-card">
        <div class="dm-card-head">
          <h3>资源与时间线</h3>
          <span class="dm-hint">图标引用一致性 · 数据新鲜度</span>
        </div>
        <div class="dm-chips">
          <span class="dm-chip" :class="{ bad: r.resources.iconMissing.length }">图标引用失效 {{ r.resources.iconMissing.length }}</span>
          <span class="dm-chip" :class="{ bad: r.resources.orphanFiles.length }">无引用图标文件 {{ r.resources.orphanFiles.length }}</span>
          <span class="dm-chip">远程图标 {{ r.resources.iconExternal.length }}</span>
          <span class="dm-chip" :class="{ warn: r.timeline.staleCount }">超 {{ r.timeline.staleDays }} 天未更新 {{ r.timeline.staleCount }}</span>
        </div>
        <p class="dm-note">
          创建时间 {{ fmtTime(r.timeline.createdMin) }} ~ {{ fmtTime(r.timeline.createdMax) }}<br>
          更新时间 {{ fmtTime(r.timeline.updatedMin) }} ~ {{ fmtTime(r.timeline.updatedMax) }}
        </p>
        <div v-if="r.resources.iconMissing.length" class="dm-list">
          <p class="dm-list-title">引用了不存在的图标文件</p>
          <div v-for="i in r.resources.iconMissing" :key="i.id" class="dm-line">
            <b>{{ i.name }}</b><code>{{ i.icon }}</code>
          </div>
        </div>
      </section>

      <!-- 写操作 -->
      <section class="dm-card repair">
        <AdminDataRepair
          ref="repairRef"
          :admin-key="adminKey"
          :fix-catalog="report.fixCatalog"
          :category-options="categoryOptions"
          :orphan-rows="orphanRows"
          :low-confidence="lowConfidence"
          :total="total"
          @applied="onApplied"
        />
      </section>

      <section class="dm-card">
        <AdminDataMerge
          ref="mergeRef"
          :admin-key="adminKey"
          :merge-fields="report.mergeFields"
          @applied="onApplied"
        />
      </section>

      <section class="dm-card">
        <AdminDataImport
          ref="importRef"
          :admin-key="adminKey"
          :catalog="report.importCatalog"
          :limits="report.limits"
          @applied="onApplied"
        />
      </section>

      <!-- 导出 -->
      <section class="dm-card">
        <div class="dm-card-head">
          <h3>导出</h3>
          <span class="dm-hint">JSON 可回灌；CSV 供表格处理</span>
        </div>
        <div class="dm-export">
          <label class="dm-field">
            <span>格式</span>
            <select v-model="exportFormat" class="dm-select">
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
            </select>
          </label>
          <label class="dm-field">
            <span>按分类</span>
            <select v-model="exportCategory" class="dm-select" @change="exportCategory && (exportDomain = '')">
              <option value="">全量</option>
              <option v-for="c in categoryOptions" :key="c.id" :value="c.id">{{ c.group }} / {{ c.label }}</option>
            </select>
          </label>
          <label class="dm-field">
            <span>按方向</span>
            <select v-model="exportDomain" class="dm-select" @change="exportDomain && (exportCategory = '')">
              <option value="">全量</option>
              <option value="ai-work">ai-work</option>
              <option value="research">research</option>
              <option value="onchain">onchain</option>
              <option value="infra">infra</option>
            </select>
          </label>
          <button type="button" class="dm-btn" :disabled="exporting" @click="doExport">
            {{ exporting ? '导出中…' : '导出下载' }}
          </button>
        </div>

        <div class="dm-export">
          <span class="dm-hint">体检报告：</span>
          <button type="button" class="dm-btn" :disabled="!!exportingReport" @click="exportReport('markdown')">
            {{ exportingReport === 'markdown' ? '导出中…' : 'Markdown' }}
          </button>
          <button type="button" class="dm-btn" :disabled="!!exportingReport" @click="exportReport('json')">
            {{ exportingReport === 'json' ? '导出中…' : 'JSON' }}
          </button>
          <span class="dm-hint">留档 / 发人用，数字与面板同源</span>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.dm { display: flex; flex-direction: column; gap: 16px; }
.dm-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.dm-title { margin: 0; font-size: 20px; font-weight: 650; }
.dm-sub { margin: 6px 0 0; color: var(--text-secondary); font-size: 13px; line-height: 1.6; max-width: 720px; }

.dm-btn {
  padding: 7px 14px; border-radius: 7px; border: 1px solid var(--border);
  background: var(--bg-elevated, transparent); color: var(--text); cursor: pointer; font-size: 13px;
}
.dm-btn:hover:not(:disabled) { border-color: var(--accent); }
.dm-btn:disabled { opacity: .5; cursor: default; }

.dm-msg { font-size: 13px; line-height: 1.6; margin: 0; }
.dm-msg.ok { color: var(--ok-fg); }
.dm-msg.err { color: var(--danger-fg); }
.dm-empty { color: var(--text-secondary); font-size: 13px; }

.dm-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; }
.dm-stat {
  border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px;
  display: flex; flex-direction: column; gap: 4px;
}
.dm-stat b { font-size: 20px; font-weight: 650; font-variant-numeric: tabular-nums; }
.dm-stat span { font-size: 12px; color: var(--text-secondary); }
.dm-stat.warn b { color: var(--danger-fg); }

.dm-meta { font-size: 12px; color: var(--text-secondary); line-height: 1.7; margin: 0; }

.dm-card { border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
.dm-card.repair { border-color: var(--accent); }
.dm-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.dm-card-head h3 { margin: 0; font-size: 14px; font-weight: 650; }
.dm-hint { font-size: 12px; color: var(--text-secondary); }

.dm-table { display: flex; flex-direction: column; gap: 5px; }
.dm-row { display: grid; grid-template-columns: 130px 78px 1fr 72px 56px; align-items: center; gap: 10px; font-size: 12px; }
.dm-bars { display: flex; flex-direction: column; gap: 5px; }
.dm-barrow { display: grid; grid-template-columns: 110px 110px 1fr 40px; align-items: center; gap: 10px; font-size: 12px; }
.dm-key { font-size: 11px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dm-label { font-size: 12px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dm-bar { height: 6px; border-radius: 3px; background: var(--border-light, var(--border)); overflow: hidden; }
.dm-bar i { display: block; height: 100%; border-radius: 3px; background: var(--accent); }
.dm-bar i.bad { background: var(--danger-fg); }
.dm-num { font-variant-numeric: tabular-nums; color: var(--text-secondary); text-align: right; }
.dm-miss { font-size: 11px; color: var(--ok-fg); text-align: right; }
.dm-miss.bad { color: var(--danger-fg); }

.dm-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.dm-chip {
  font-size: 12px; padding: 3px 9px; border-radius: 999px;
  border: 1px solid var(--border); color: var(--text-secondary);
}
.dm-chip.bad { border-color: var(--danger-fg); color: var(--danger-fg); }
.dm-chip.warn { border-color: var(--warn-fg, var(--accent)); color: var(--warn-fg, var(--accent)); }
.dm-chip.dim { opacity: .75; }
.dm-tag { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--border); margin-left: 6px; }
.dm-tag.off { color: var(--warn-fg, var(--accent)); }

.dm-list { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.dm-list.scroll { max-height: 220px; overflow-y: auto; }
.dm-list-title { margin: 6px 0 2px; font-size: 12px; font-weight: 600; color: var(--text-secondary); }
.dm-line { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 6px; }
.dm-line:nth-child(odd) { background: var(--border-light, transparent); }
.dm-line b { font-weight: 600; }
.dm-line code { font-size: 11px; color: var(--text-secondary); }
.dm-conf { font-variant-numeric: tabular-nums; color: var(--warn-fg, var(--accent)); }
.dm-reason { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dm-more { margin: 4px 0 0; font-size: 11px; color: var(--text-secondary); }
.dm-none { margin: 0; font-size: 12px; color: var(--text-secondary); }
.dm-note { margin: 0; font-size: 12px; color: var(--text-secondary); line-height: 1.7; }

.dm-trend-body { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.dm-trend-num { display: flex; flex-direction: column; gap: 2px; min-width: 96px; }
.dm-trend-num b { font-size: 22px; font-weight: 650; font-variant-numeric: tabular-nums; }
.dm-trend-num span { font-size: 11.5px; color: var(--text-secondary); }
.dm-spark { width: 260px; height: 48px; color: var(--accent); flex: 1 1 200px; max-width: 100%; }

.dm-export { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.dm-field { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); }
.dm-select {
  padding: 4px 8px; border-radius: 6px; border: 1px solid var(--border);
  background: var(--bg, transparent); color: var(--text); font-size: 12px;
}

@media (max-width: 760px) {
  .dm-row { grid-template-columns: 92px 1fr 60px; }
  .dm-row .dm-label, .dm-row .dm-num { display: none; }
  .dm-barrow { grid-template-columns: 84px 1fr 34px; }
  .dm-barrow .dm-label { display: none; }
}
</style>
