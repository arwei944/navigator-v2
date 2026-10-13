/**
 * 管线日志总线：「一次用户动作 = 一条 run，一段明细 = 一个 stage」。
 *
 * ## 为什么要有它
 *
 * 「添加站点」这条链路是**多跳异步**的：本地推断（毫秒）→ 分类决策（要现拉一个带
 * pinyin-pro 的 chunk）→ 落库（毫秒）→ 后台真实抓取（最长 3s 预算）→ 异步补译（三层
 * 引擎逐个降级）→ 写回补丁。用户看到的表象只有两句 toast：立刻「已添加」、几秒后可能
 * 有一条「已补全」。中间任何一跳失败都是**静默**的 —— 于是「为什么信息没填上」既没法
 * 自查、也没法复述，只能靠猜。
 *
 * 所以把每一跳记成 stage，谁在跑、跑了多久、为什么停，面板一眼可见。
 *
 * ## 三条纪律
 *
 *   ① **旁路**：追踪不是业务流程的一部分。面板没挂载时 `enabled()` 为假，`beginRun`
 *      返回空句柄，埋点退化成几次属性读取 —— 不许因为日志失败影响主流程。
 *   ② **UI 无关的纯数据**：stage 只收「已经发生的事实」（耗时是 **Promise settle 后**
 *      才落定的），不许写「将要发生」的预期；失败要带 `reason`，那是唯一能拿去重述的东西。
 *   ③ **体量恒定**：环形缓冲，最多 `MAX_RUNS` 条 run、每条最多 `MAX_STAGES` 个 stage。
 *      这是常驻内存的对象，跟着首屏包走的多一个字节都要算钱。
 *
 * 面板 UI 是按需加载的（`PipelineLogPanel.vue`），**这个模块本身是极小的**，并且只在
 * 真的有人在看时才对外暴露读写 —— 不看的会话里它只是一段参与了 tree-shaking 的死代码。
 */
import { ref } from 'vue'

/** 环形缓冲上限：日志面板是给人看「刚刚发生了什么」的，留太多没有意义 */
const MAX_RUNS = 20
const MAX_STAGES = 12

/**
 * @typedef {'running'|'ok'|'warn'|'fail'|'skip'} StageStatus
 */

/**
 * 状态挂在 globalThis 上，而不是模块作用域里。
 *
 * 为什么：这个模块会被**多个异步 chunk 引用**（自动添加的链路、后台升级、添加弹窗、
 * 日志面板），Vite 完全可能把它复制进多个 chunk。那时每个副本各有一份 `runs`，
 * 面板读的是自己那份、埋点写的是另一份 —— 表面一切正常，日志却是空的（本机实测踩到：
 * 「追踪总线可用」已经是绿的，但一条 run 都没有）。状态唯一化之后，副本再多也只有一份数据。
 */
const STATE_KEY = '__navPipelineState__'
function singletonState() {
  if (globalThis[STATE_KEY]) return globalThis[STATE_KEY]
  const fresh = {
    /** 最近若干条 run（索引 0 最早），面板按需求倒序展示 */
    runs: ref([]),
    /** 仍在推进的 run 条数 —— 浮标据此显隐（>0 就是「还在跑」） */
    running: ref(0),
    /** 消费者计数：>0 时才记账 */
    consumers: 0,
    seq: 0,
  }
  globalThis[STATE_KEY] = fresh
  return fresh
}
const state = singletonState()
const runs = state.runs
const running = state.running

export const pipeline = { runs, running }

/**
 * 空句柄：面板没挂载时用它替代真句柄，让所有埋点退化成 no-op。
 * 写 alias 而不是在每个埋点处判空 —— 判空是给下一个改这段代码的人留坑。
 */
const NOOP_STAGE = {
  ok() {}, warn() {}, fail() {}, skip() {}, note() {}, ms: 0, status: 'skip',
}
const NOOP_RUN = {
  stage: () => NOOP_STAGE,
  end() {},
  id: 0,
}

/**
 * 是否有人在追踪。**没有消费者就完全不记账** —— 否则每次 Silently 加个站点都要
 * 在内存里堆 20 条立刻被丢弃的记录。
 */
function hasConsumer() {
  return state.consumers > 0
}

/** 面板挂载 / 卸载时登记消费者：有消费者才产出事件 */
export function addPipelineConsumer() {
  state.consumers++
  return () => {
    state.consumers = Math.max(0, state.consumers - 1)
  }
}

function push(run) {
  const list = runs.value
  list.push(run)
  if (list.length > MAX_RUNS) list.splice(0, list.length - MAX_RUNS)
}

/**
 * 开一次运行。
 *
 * @param {{flow: string, title: string, target?: string}} spec
 *        `flow` 用来分流（auto-add / add-modal…），`target` 是作用对象（网址 / 站点名）。
 * @returns 句柄；**没有消费者时返回空句柄**（见文件头第 ① 条纪律）
 */
export function beginRun({ flow, title, target = '' }) {
  if (!hasConsumer()) return NOOP_RUN
  const run = {
    id: ++state.seq,
    flow,
    title,
    target: String(target || ''),
    startedAt: Date.now(),
    endedAt: 0,
    status: 'running',
    summary: '',
    stages: [],
  }
  push(run)
  running.value++
  let closed = false
  return {
    id: run.id,
    stage(key, label) {
      const idx = run.stages.findIndex(s => s.key === key)
      const st = {
        key,
        label,
        status: 'running',
        startedAt: Date.now(),
        ms: 0,
        detail: '',
        reason: '',
      }
      if (idx !== -1) {
        // 同名 stage 重登记（如重试）覆盖旧的：面板上不该出现两条一模一样的阶段
        run.stages.splice(idx, 1)
      } else if (run.stages.length >= MAX_STAGES) {
        return NOOP_STAGE
      }
      run.stages.push(st)
      const settle = (status, detail = '', reason = '') => {
        if (st.status !== 'running') return
        st.status = status
        st.ms = Date.now() - st.startedAt
        st.detail = String(detail || '')
        st.reason = String(reason || '')
      }
      return {
        ok: (d) => settle('ok', d),
        warn: (d, r = 'warning') => settle('warn', d, r),
        fail: (d, r = 'error') => settle('fail', d, r),
        skip: (d, r = 'skip') => settle('skip', d, r),
        /** 还在跑，但先补充一句能看到的东西（如「等待 600ms 防抖」） */
        note: (d) => { if (st.status === 'running') st.detail = String(d || '') },
        stage: st,
      }
    },
    end(status = 'ok', summary = '') {
      if (closed) return
      closed = true
      run.status = status
      run.endedAt = Date.now()
      run.summary = String(summary || '')
      running.value = Math.max(0, running.value - 1)
    },
  }
}

/**
 * 把一段异步过程记成一个 stage：Promise settle 即终态，**异常照抛**（追踪不吞错误：
 * 吞了就把代码缺陷变成「日志里飘红一行」这种没人会回访的东西）。
 *
 * @param {object} run   `beginRun()` 的句柄
 * @param {string} key
 * @param {string} label
 * @param {Function|Promise} fn
 */
export async function trackStage(run, key, label, fn) {
  const st = run.stage(key, label)
  try {
    const v = await (typeof fn === 'function' ? fn() : fn)
    st.ok('')
    return v
  } catch (e) {
    st.fail(String(e?.message || e))
    throw e
  }
}

/** 面板「清空」：只清历史，不影响正在跑的 run */
export function clearFinishedRuns() {
  runs.value = runs.value.filter(r => r.status === 'running')
}

/**
 * 探针出口：供 `probe/*.mjs` 直接读同一份数据，不必去 DOM 上刮文本
 * （DOM 文案会变，用它做判据的探针迟早假红 —— 这条在 add-flow-realtime 上已经踩过一次）。
 */
if (typeof globalThis !== 'undefined') {
  globalThis.__navPipeline__ = { runs, running, clearFinishedRuns, addPipelineConsumer }
}
