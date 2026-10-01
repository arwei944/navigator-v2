/**
 * 发布流水线内核：步骤目录、编排计划、状态机、日志标记解析。
 *
 * 为什么单独抽出来：这条流水线有两条入口 —— 本地控制台（走 git / 构建 / Vercel CLI）
 * 与线上管理后台（只能走云端 Blob 热更新）。若各自维护一份步骤表，
 * 「本地跑 9 步、线上跑 4 步」的差异迟早会漂移成两套语义。
 * 这里把「步骤是什么、什么条件下跳过、什么标记对应哪一步」定成唯一真相源，
 * 两端只负责执行自己能跑的那几步，跑不了的显式标 skipped 并给出原因。
 *
 * 纯函数、零依赖（与 site-ops.mjs 同约束），浏览器侧也可引用。
 */

/* ---------------- 执行环境能力 ---------------- */

/**
 * 各执行端具备的能力。步骤通过 `requires` 声明依赖，计划阶段据此判定「跑 / 跳过」。
 * - git    : 读取工作区、提交、推送
 * - fs     : 读写本地文件（备份落盘）
 * - node   : 起子进程跑构建脚本
 * - vercel : 调用 Vercel CLI / API
 * - cloud  : 写入云端 Blob 热更新接口
 */
export const RUNNER_CAPS = {
  console: ['git', 'fs', 'node', 'vercel', 'cloud'],
  cloud: ['cloud'],
}

export const RUNNER_LABEL = { console: '本地控制台', cloud: '线上管理后台' }

/* ---------------- 步骤目录 ---------------- */

/**
 * 步骤目录。`marker` 用于解析 scripts/publish.mjs 打印的 `=== N/5 xxx ===` 标记，
 * 从而把子进程输出映射回时间线（构建之后的四步由 publish.mjs 驱动）。
 */
export const STEP_CATALOG = {
  check: { key: 'check', label: '本地改动检查', phase: 'local', requires: ['git'], marker: /本地改动检查|改动检查/ },
  commit: { key: 'commit', label: '提交', phase: 'local', requires: ['git'], optional: true },
  push: { key: 'push', label: '推送到远端', phase: 'local', requires: ['git'], optional: true },
  backup: { key: 'backup', label: '数据备份', phase: 'publish', requires: ['fs'], marker: /备份数据/ },
  validate: { key: 'validate', label: '数据门禁', phase: 'publish', requires: ['node', 'fs'], marker: /schema\s*校验|数据校验/ },
  build: { key: 'build', label: '构建', phase: 'publish', requires: ['node'], optional: true, marker: /构建/ },
  deploy: { key: 'deploy', label: 'Vercel 部署', phase: 'publish', requires: ['vercel'], marker: /部署到\s*Vercel|部署/ },
  hotupdate: { key: 'hotupdate', label: 'Blob 热更新', phase: 'publish', requires: ['cloud'], marker: /热更新/ },
  verify: { key: 'verify', label: '一致性验证', phase: 'publish', requires: ['cloud'], marker: /轮询验证|一致性/ },
}

export const STEP_KEYS = Object.keys(STEP_CATALOG)

/** 全链路发布（本地控制台） */
export const FULL_PIPELINE = ['check', 'commit', 'push', 'backup', 'validate', 'build', 'deploy', 'hotupdate', 'verify']

/** 仅数据同步：不构建、不部署（站点数据变更走热更新即可生效） */
export const DATA_ONLY_PIPELINE = ['check', 'commit', 'push', 'backup', 'validate', 'hotupdate', 'verify']

/** 云端可执行的子集：线上后台只能做「热更新 + 校验 + 验证」 */
export const CLOUD_PIPELINE = ['validate', 'hotupdate', 'verify']

export const TERMINAL_STATUSES = ['success', 'failed', 'skipped']

/** 步骤是否属于「发布阶段」（构建之后由 publish.mjs 驱动的那一段） */
export function isPublishPhase(key) {
  return STEP_CATALOG[key]?.phase === 'publish'
}

/* ---------------- 计划 ---------------- */

/**
 * 由流水线定义 + 执行端能力 + 用户选项，算出每个步骤的最终计划。
 *
 * 判定优先级：能力不足 > 用户显式跳过 > 正常执行。
 * 「能力不足」的步骤不会被删掉，而是保留并标 skipped —— 让用户看到
 * 「线上后台少了哪几步、为什么」，而不是一个悄悄变短的列表。
 *
 * @param {{ pipeline?: string[], runner?: string, options?: object }} input
 * @returns {{ runner: string, steps: object[], runnable: number, skipped: number, plan: string[] }}
 */
export function planPipeline({ pipeline = FULL_PIPELINE, runner = 'console', options = {} } = {}) {
  const caps = new Set(RUNNER_CAPS[runner] || [])
  const steps = pipeline.map(key => {
    const def = STEP_CATALOG[key]
    if (!def) return null
    const missing = (def.requires || []).filter(c => !caps.has(c))
    const optSkip = optionSkipReason(key, options)
    let skipReason = ''
    if (missing.length) skipReason = `当前执行端（${RUNNER_LABEL[runner] || runner}）缺少能力：${missing.join(' / ')}`
    else if (optSkip) skipReason = optSkip
    return {
      key: def.key,
      label: def.label,
      phase: def.phase,
      requires: def.requires || [],
      optional: Boolean(def.optional),
      status: skipReason ? 'skipped' : 'pending',
      skipReason,
      startedAt: null,
      endedAt: null,
      duration: null,
      detail: skipReason || '',
    }
  }).filter(Boolean)

  return {
    runner,
    steps,
    runnable: steps.filter(s => s.status === 'pending').length,
    skipped: steps.filter(s => s.status === 'skipped').length,
    plan: steps.map(s => `${s.key}:${s.status}`),
  }
}

/** 用户选项导致的跳过原因；返回空串表示不跳过 */
function optionSkipReason(key, options = {}) {
  if (options.dryRun && ['commit', 'push', 'backup', 'build', 'deploy', 'hotupdate'].includes(key)) return '预演模式：不产生副作用'
  if (key === 'commit' && options.commit === false) return '已按选项跳过提交'
  if (key === 'push' && options.push === false) return '已按选项跳过推送'
  if (key === 'build' && options.skipBuild) return '已按选项跳过构建'
  if (key === 'deploy' && options.skipDeploy) return '已按选项跳过部署'
  if (key === 'verify' && options.skipVerify) return '已按选项跳过验证'
  return ''
}

/* ---------------- 状态机 ---------------- */

/** 由计划生成可执行步骤（已应用跳过） */
export function createSteps(pipeline, runner, options) {
  return planPipeline({ pipeline, runner, options }).steps
}

/**
 * 就地更新一个步骤的状态并计算耗时。
 * 同状态重复标记且无新细节时直接返回，避免覆盖已记录的耗时。
 */
export function markStep(step, patch) {
  if (patch.status === step.status && patch.detail === undefined && Object.keys(patch).length === 1) return step
  Object.assign(step, patch)
  if (patch.status === 'running' && !step.startedAt) step.startedAt = Date.now()
  if (TERMINAL_STATUSES.includes(patch.status)) {
    step.endedAt = Date.now()
    step.duration = step.startedAt ? step.endedAt - step.startedAt : 0
  }
  return step
}

/** 把剩余未执行步骤统一收尾（失败/中止时用） */
export function settlePending(steps, patch = { status: 'skipped', detail: '未执行' }) {
  for (const s of steps) {
    if (s.status === 'pending') markStep(s, { ...patch })
  }
  return steps
}

/** 把正在执行的步骤收尾（子进程结束后用） */
export function settleRunning(steps, patch) {
  for (const s of steps) {
    if (s.status === 'running') markStep(s, { ...patch })
  }
  return steps
}

/** 由 publish.mjs 的 `=== N/5 xxx ===` 标记反查步骤 key */
export function stepFromMarker(text) {
  const t = String(text || '').trim()
  for (const def of Object.values(STEP_CATALOG)) {
    if (def.marker && def.marker.test(t)) return def.key
  }
  return null
}

/**
 * 推进时间线：把 key 之前的「进行中」步骤收尾，并把 key 标为进行中。
 * publish.mjs 只打印「开始第 N 步」，因此需要这种「顺序推进」而不是逐个标记。
 */
export function advanceTo(steps, key, detail = '进行中…') {
  const order = steps.map(s => s.key)
  const idx = order.indexOf(key)
  if (idx < 0) return steps
  for (let i = 0; i < idx; i++) {
    const s = steps[i]
    if (s.status === 'running') markStep(s, { status: 'success' })
  }
  const target = steps[idx]
  if (target.status === 'pending') markStep(target, { status: 'running', detail })
  return steps
}

/* ---------------- 汇总 ---------------- */

export function stepsSummary(steps = []) {
  const c = { pending: 0, running: 0, success: 0, failed: 0, skipped: 0 }
  for (const s of steps) c[s.status] = (c[s.status] || 0) + 1
  const totalMs = steps.reduce((n, s) => n + (Number(s.duration) || 0), 0)
  return { ...c, total: steps.length, totalMs }
}

/** 流水线最终判定：有 failed 即失败；否则看是否全部落终态 */
export function pipelineVerdict(steps = []) {
  const failed = steps.filter(s => s.status === 'failed')
  if (failed.length) return { ok: false, reason: `${failed.map(s => s.label).join('、')} 失败` }
  const unfinished = steps.filter(s => s.status === 'pending' || s.status === 'running')
  if (unfinished.length) return { ok: false, reason: `${unfinished.map(s => s.label).join('、')} 未完成` }
  return { ok: true, reason: '' }
}

/** 时间线的一行文本（日志 / 通知 / 发布历史共用） */
export function formatStepLine(step) {
  const icon = { success: '✓', failed: '✗', skipped: '·', running: '▶', pending: '○' }[step.status] || '·'
  const ms = step.duration ? ` (${(step.duration / 1000).toFixed(1)}s)` : ''
  return `${icon} ${step.label}${step.detail ? ` — ${step.detail}` : ''}${ms}`
}