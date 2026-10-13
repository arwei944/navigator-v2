<template>
  <!--
    宿主：**常驻挂载**（由 App 无条件渲染），只有「有东西在跑」或用户手动打开时才可见。
    常驻是为了埋点从不断档 —— 若等第一条 run 出现再去挂载，那一跳已经跑完了，
    日志里永远看不到「为什么第一跳没发生」。
  -->
  <div class="pipeline-root" v-if="visible">
    <!-- 收起态：一枚浮标。有 run 在推进时自动出现，跑完停顿几秒再退，避免闪进闪出 -->
    <button
      v-if="!open"
      class="pipeline-pill"
      :class="pillTone"
      @click="open = true"
      :title="pillTitle"
      :aria-label="pillTitle"
    >
      <span class="pipeline-pill-dot" :class="{ spin: running > 0 }"></span>
      <span class="pipeline-pill-text">{{ pillText }}</span>
      <span v-if="runs.length" class="pipeline-pill-count">{{ runs.length }}</span>
    </button>

    <!-- 展开态：全流程明细 -->
    <section v-else class="pipeline-panel" role="dialog" aria-label="管线日志" ref="panelRef">
      <header class="pipeline-head">
        <div class="pipeline-title">
          <span class="pipeline-live-dot" :class="{ spin: running > 0 }"></span>
          <h3>管线日志</h3>
          <span class="pipeline-sub">实时 · 保留最近 {{ MAX_RUNS }} 条</span>
        </div>
        <div class="pipeline-actions">
          <button class="pipeline-btn" @click="togglePin" :title="pinned ? '取消常显' : '常显浮标'">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 17v5M9 3h6l-1 6 4 3H6l4-3-1-6z" />
            </svg>
          </button>
          <button class="pipeline-btn" @click="clearFinishedRuns" title="清空已完成的记录">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
          <button class="pipeline-btn" @click="open = false" title="收起" aria-label="收起">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </div>
      </header>

      <div class="pipeline-body" ref="bodyRef">
        <p v-if="!view.length" class="pipeline-empty">
          还没有记录。从搜索框粘贴网址、或打开「添加站点」弹窗，这里会逐跳显示进度。
        </p>

        <article v-for="run in view" :key="run.id" class="pipeline-run" :class="`is-${run.status}`">
          <button class="pipeline-run-head" @click="toggle(run.id)">
            <span class="pipeline-chip" :class="`chip-${run.status}`">{{ chipText(run.status) }}</span>
            <span class="pipeline-run-title">{{ run.title }}</span>
            <span class="pipeline-run-target" :title="run.target">{{ run.target }}</span>
            <span class="pipeline-run-ms">{{ elapsedOf(run) }}</span>
            <svg class="pipeline-caret" :class="{ open: expanded.has(run.id) }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          <p v-if="run.summary" class="pipeline-run-summary">{{ run.summary }}</p>

          <ol v-show="expanded.has(run.id)" class="pipeline-stages">
            <li v-for="st in run.stages" :key="st.key" class="pipeline-stage">
              <span class="pipeline-stage-rail" :class="`rail-${st.status}`"></span>
              <span class="pipeline-stage-label">{{ st.label }}</span>
              <span class="pipeline-stage-ms" :class="{ live: st.status === 'running' }">
                {{ st.status === 'running' ? `${since(st.startedAt)}ms…` : `${st.ms}ms` }}
              </span>
              <span v-if="st.detail" class="pipeline-stage-detail" :class="{ 'is-fail': st.status === 'fail' }">
                {{ st.detail }}
                <em v-if="st.reason && st.status !== 'ok'" class="pipeline-stage-reason">{{ st.reason }}</em>
              </span>
            </li>
          </ol>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup>
/**
 * 管线日志面板 —— 把多跳异步链路「正在发生什么」摊开给人看。
 *
 * ## 为什么它自己管显隐而不用 App 的 v-if
 *
 * App 若按 `v-if` 条件挂载它，`beginRun()` 在面板出现之前就被调用过一次了（第一次
 * 添加站点必然如此），那一跳不被记录 —— 而最需要记录的恰恰是**第一次**。所以它是
 * 常驻挂载、内部自管可见性。
 *
 * ## 为什么读的是 `pipeline.runs` 而不是 props
 *
 * 埋点在 `services/*` 与 `components/*` 里，它们不可能知道面板在哪；反过来让面板去订阅
 * 全局总线，埋点就只需要 `beginRun()` 一个调用点。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { pipeline, clearFinishedRuns, addPipelineConsumer } from '@/utils/pipelineTrace'
import { usePreferencesStore } from '@/stores/preferences'

const MAX_RUNS = 20
const props = defineProps({
  /** 由 App 下发的一次性打开请求（命令面板 / 设置项） */
  openToken: { type: Number, default: 0 },
})

const preferencesStore = usePreferencesStore()
const panelRef = ref(null)
const bodyRef = ref(null)

const pinned = computed(() => preferencesStore.pipelineLog)
const running = pipeline.running
const runs = pipeline.runs

const open = ref(false)
const expanded = ref(new Set())
/** 跑完后浮标再停留一会儿：立刻消失等于告诉用户「什么都没发生」 */
const lingerUntil = ref(0)
const now = ref(Date.now())

// 只在「有东西在跑」或有 automation 尚在 linger 时钟时走定时器，其余时刻零开销
let timer = null
function ensureClock() {
  if (timer) return
  timer = setInterval(() => { now.value = Date.now() }, 200)
}
function stopClock() {
  if (!timer) return
  clearInterval(timer)
  timer = null
}

watch([running, () => lingerUntil.value > now.value], ([r, lingering]) => {
  if (r > 0 || lingering) ensureClock()
  else stopClock()
}, { immediate: true })

watch(() => props.openToken, (v) => { if (v) open.value = true })

/**
 * 消费者登记：没有消费者时 `beginRun()` 返回空句柄、完全不记账。
 * 卸载必须注销 —— 否则模块里的全局计数器只增不减，面板关掉后仍在堆历史。
 */
const release = addPipelineConsumer()
onBeforeUnmount(() => { release(); stopClock() })

const view = computed(() => [...runs.value].reverse())

const visible = computed(() => open.value || pinned.value || running.value > 0 || lingerUntil.value > now.value)

const latest = computed(() => view.value[0] || null)

watch(running, (v, prev) => {
  if (v > 0 && prev === 0) lingerUntil.value = 0
  if (v === 0 && prev > 0) lingerUntil.value = Date.now() + 6000
})

const pillText = computed(() => {
  const r = latest.value
  if (running.value > 0) {
    const live = r?.stages.filter(s => s.status === 'running')[0]
    return live ? live.label : (r?.title || '正在处理…')
  }
  return r ? `${r.title} · ${chipText(r.status)}` : '管线日志'
})
const pillTone = computed(() => {
  if (running.value > 0) return 'tone-run'
  const r = latest.value
  if (!r) return ''
  return r.status === 'fail' ? 'tone-fail' : r.status === 'warn' ? 'tone-warn' : 'tone-ok'
})
const pillTitle = computed(() => (running.value > 0 ? '正在推进，点击查看全流程' : '管线日志：点击查看最近流程'))

function chipText(status) {
  return { running: '进行中', ok: '完成', warn: '部分完成', fail: '失败', skip: '跳过' }[status] || status
}

function elapsedOf(run) {
  const end = run.endedAt || now.value
  return `${end - run.startedAt}ms`
}
function since(startedAt) {
  return Math.max(0, now.value - startedAt)
}

/** 详情默认展开最新一条；旧记录折叠，避免一屏塞满历史 */
watch(() => runs.value.length, (n, prev) => {
  if (n > (prev || 0) && latest.value) {
    expanded.value = new Set([latest.value.id])
  }
})

function toggle(id) {
  const next = new Set(expanded.value)
  next.has(id) ? next.delete(id) : next.add(id)
  expanded.value = next
}

function togglePin() {
  preferencesStore.setPipelineLog(!pinned.value)
}
</script>

<style scoped>
.pipeline-root {
  position: fixed;
  left: 16px;
  bottom: 16px;
  z-index: 900;
  font-family: var(--font);
}

/* ── 浮标 ── */
.pipeline-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-white);
  color: var(--text-primary);
  box-shadow: var(--shadow-hover);
  cursor: pointer;
  font-size: 12px;
  max-width: 60vw;
}
.pipeline-pill-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pipeline-pill-count {
  font-size: 11px;
  color: var(--text-secondary);
  padding-left: 6px;
  border-left: 1px solid var(--border-light);
}
.pipeline-pill-dot,
.pipeline-live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--color-muted);
}
.tone-run .pipeline-pill-dot { background: var(--color-ok); }
.tone-fail .pipeline-pill-dot { background: var(--color-danger); }
.tone-warn .pipeline-pill-dot { background: var(--color-warn); }
.tone-ok .pipeline-pill-dot { background: var(--color-ok); }
.spin { animation: pipeline-pulse 1s ease-in-out infinite; }
@keyframes pipeline-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.8); }
}

/* ── 面板 ── */
.pipeline-panel {
  width: min(430px, calc(100vw - 32px));
  max-height: min(60vh, 520px);
  display: flex;
  flex-direction: column;
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow-hover);
  overflow: hidden;
}
.pipeline-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-light);
  flex-shrink: 0;
}
.pipeline-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.pipeline-title h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.pipeline-sub {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.pipeline-actions { display: flex; gap: 4px; }
.pipeline-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
.pipeline-btn:hover {
  background: var(--bg-primary);
  color: var(--text-primary);
}

.pipeline-body {
  overflow-y: auto;
  padding: 8px 12px 12px;
}
.pipeline-empty {
  margin: 8px 2px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-secondary);
}

.pipeline-run {
  padding: 8px 0;
  border-bottom: 1px solid var(--border-light);
}
.pipeline-run:last-child { border-bottom: none; }
.pipeline-run-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  font-family: var(--font);
}
.pipeline-chip {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-secondary);
}
.chip-running { color: var(--color-ok); border-color: var(--color-ok); }
.chip-ok { color: var(--color-ok); border-color: var(--color-ok); }
.chip-warn { color: var(--color-warn); border-color: var(--color-warn); }
.chip-fail { color: var(--color-danger); border-color: var(--color-danger); }
.chip-skip { color: var(--color-muted); border-color: var(--color-muted); }

.pipeline-run-title { font-size: 12px; font-weight: 600; color: var(--text-primary); white-space: nowrap; }
.pipeline-run-target {
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.pipeline-run-ms { font-size: 11px; color: var(--text-secondary); flex-shrink: 0; }
.pipeline-caret { color: var(--text-secondary); transition: transform 0.15s; flex-shrink: 0; }
.pipeline-caret.open { transform: rotate(180deg); }
.pipeline-run-summary {
  margin: 6px 0 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.pipeline-stages {
  list-style: none;
  margin: 8px 0 2px;
  padding: 0 0 0 10px;
  border-left: 1px solid var(--border-light);
}
.pipeline-stage {
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: baseline;
  gap: 4px 8px;
  padding: 4px 0;
  font-size: 11px;
}
.pipeline-stage-rail {
  position: absolute;
  left: -14px;
  top: 9px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-muted);
}
.rail-ok { background: var(--color-ok); }
.rail-warn { background: var(--color-warn); }
.rail-fail { background: var(--color-danger); }
.rail-skip { background: var(--color-muted); }
.rail-running { background: var(--color-ok); animation: pipeline-pulse 1s ease-in-out infinite; }
.pipeline-stage-label { color: var(--text-primary); }
.pipeline-stage-ms { color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.pipeline-stage-ms.live { color: var(--color-ok); }
.pipeline-stage-detail {
  grid-column: 2 / -1;
  color: var(--text-secondary);
  line-height: 1.6;
  word-break: break-all;
}
.pipeline-stage-detail.is-fail { color: var(--color-danger); }
.pipeline-stage-reason {
  display: inline-block;
  margin-left: 6px;
  padding: 0 5px;
  border-radius: 4px;
  border: 1px solid var(--border);
  font-style: normal;
  font-size: 10px;
  color: var(--text-secondary);
}
</style>
