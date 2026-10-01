/**
 * 全链路同步编排：本地改动 → 提交 → 推送 → 备份 → 门禁 → 构建 → 部署 → 热更新 → 验证
 *
 * 设计原则：scripts/publish.mjs 是唯一发布入口（单一真相源），控制台只做编排与可视化。
 * 构建/部署/热更新/验证四步通过解析 publish.mjs 的 `=== N/5 xxx ===` 标记推进时间线。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, getAdminKey } from './env.mjs'
import { SITE_URL, fetchCloud } from './cloud.mjs'
import * as jobs from './jobs.mjs'
import * as git from './git.mjs'
import * as vercel from './vercel.mjs'
import { consumeGate } from './gate.mjs'
import { record } from './audit.mjs'
import { append as appendHistory } from './publishlog.mjs'
import { push as notifyPush } from './notify.mjs'
import {
  FULL_PIPELINE, createSteps, markStep as markStepCore, settlePending, settleRunning,
  stepFromMarker, advanceTo as advanceToCore, pipelineVerdict,
} from '../../../shared/ops/pipeline.mjs'

export { SITE_URL, fetchCloud }

export const PUBLISH_JOB_TITLE = '一键发布'

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** 步骤表由内核给出（与线上后台同源）；控制台只执行自己能跑的那几步，其余由内核标 skipped 并说明原因 */
function newSteps(opts = {}) {
  return createSteps(FULL_PIPELINE, 'console', opts)
}

/** 就地更新状态并广播给 UI；耗时计算与同态去重由内核状态机负责 */
function markStep(job, step, patch) {
  markStepCore(step, patch)
  jobs.emitEvent(job, 'step', { ...step })
  return step
}

/**
 * 批量收尾并广播。状态转移由内核（settlePending / settleRunning）负责，
 * 控制台只把「真的变了」的那几条推给 UI，避免无谓的重绘。
 */
function settleSteps(job, steps, patch, which = 'pending') {
  const before = steps.map(s => s.status)
  if (which === 'running') settleRunning(steps, patch)
  else settlePending(steps, patch)
  steps.forEach((s, i) => { if (s.status !== before[i]) jobs.emitEvent(job, 'step', { ...s }) })
  return steps
}

/**
 * 发布收尾：落一条发布历史 + 记一条审计 + 结束任务。
 * 历史与审计都是旁路，写失败不影响任务结果本身。
 */
function finishPublish(job, steps, code, opts, reason = '') {
  const verdict = pipelineVerdict(steps)
  const ok = code === 0 && verdict.ok
  appendHistory({
    runner: 'console',
    trigger: opts.trigger || 'manual',
    ok,
    reason: ok ? '' : (reason || verdict.reason),
    duration: job.startedAt ? Date.now() - job.startedAt : null,
    steps,
    commit: job.commitInfo || null,
    deployment: job.deployment
      ? { url: job.deployment.url, state: job.deployment.state }
      : (job.deploymentUrl ? { url: job.deploymentUrl, state: '' } : null),
    cloud: Number.isFinite(job.cloudVersion) ? { version: job.cloudVersion, count: job.cloudCount || 0 } : null,
    snapshot: job.snapshot
      ? { pathname: job.snapshot, ok: true }
      : (job.snapshotError ? { pathname: '', ok: false } : null),
    counts: { sites: localSitesCount() },
    note: opts.message || '',
  })
  record({
    action: ok ? 'publish.done' : 'publish.fail',
    result: ok ? 'ok' : 'fail',
    target: '一键发布',
    detail: ok
      ? `云端 v${job.cloudVersion || '-'} · ${job.cloudCount || 0} 站点`
      : (reason || verdict.reason || `退出码 ${code}`),
  })
  // 通知是旁路：与审计/历史同批落，但只挑「需要人知道」的结果推
  notifyPush({
    kind: ok ? 'publish.done' : 'publish.fail',
    title: ok ? `发布完成 · v${job.cloudVersion || '-'}` : '发布失败',
    body: ok
      ? `${job.cloudCount || 0} 站点已热更新到云端${job.deployment?.url ? ` · ${job.deployment.url}` : ''}`
      : (reason || verdict.reason || `退出码 ${code}`),
    meta: { cloud: job.cloudVersion || null, count: job.cloudCount || 0, snapshot: job.snapshot || '' },
  })
  if (job.snapshotError) {
    notifyPush({
      kind: 'snapshot.fail',
      title: '云端快照保存失败',
      body: String(job.snapshotError).slice(0, 300),
    })
  }
  jobs.finish(job, code)
}

/** 子进程执行一步，流式日志并入同一任务，不结束任务本身 */
function runStep(job, command, cmdArgs, opts = {}) {
  return new Promise(resolve => {
    const child = jobs.run(job, command, cmdArgs, { ...opts, autoFinish: false })
    child.on('close', code => resolve(code ?? -1))
  })
}

/* ---------------- 云端读取 ---------------- */

function localSitesCount() {
  try { return JSON.parse(readFileSync(join(ROOT, 'api', 'sites-data.json'), 'utf-8')).length } catch { return null }
}

function packageVersion() {
  try { return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version || '' } catch { return '' }
}

/** 同步面板总览：本地版本 / 云端版本 / Vercel 项目 / 上次发布 */
export async function status() {
  let st = null
  try { st = await git.getStatus() } catch { /* 非 git 仓库时忽略 */ }
  const [head, cloud] = await Promise.all([git.headCommit().catch(() => null), fetchCloud()])
  const p = vercel.projectInfo()
  const localCount = localSitesCount()
  const lastPublish = jobs.listJobs().find(j => j.title === PUBLISH_JOB_TITLE) || null

  return {
    siteUrl: SITE_URL,
    local: {
      version: packageVersion(),
      count: localCount,
      branch: st?.branch || '',
      ahead: st?.ahead || 0,
      behind: st?.behind || 0,
      staged: st?.counts?.staged || 0,
      changes: st?.counts?.total || 0,
      head,
    },
    cloud,
    converged: cloud.ok && localCount !== null && cloud.count === localCount,
    vercel: {
      apiAvailable: vercel.available(),
      tokenConfigured: Boolean(vercel.token()),
      projectId: p?.projectId || '',
      orgId: p?.orgId || '',
      projectName: p?.projectName || '',
    },
    hotUpdateReady: Boolean(getAdminKey()),
    lastPublish,
  }
}

/* ---------------- 一键发布流水线 ---------------- */

/**
 * 发布门禁：默认要求先预检再放行。
 *
 * 三种放行方式（按优先级）：
 *   ① gateId：核销一张有效的预检凭证（推荐，工作区变动即失效）
 *   ② allowUngated：显式绕过（自动化脚本用，会在日志与审计里留痕）
 * 两者都没有则直接拒绝，不进入流水线。
 */
export async function resolveGate({ gateId, allowUngated = false } = {}) {
  if (gateId) {
    const r = await consumeGate(gateId, { kind: 'publish' })
    if (!r.ok) throw new Error(r.reason)
    return { gateId: r.gate.id, bypassed: false }
  }
  if (allowUngated) {
    record({ action: 'gate.bypass', result: 'rejected', target: 'publish', detail: '显式绕过发布门禁（未经预检放行）' })
    return { gateId: null, bypassed: true }
  }
  throw new Error('发布需要放行凭证：请先执行预检（nav publish preflight），确认无误后带 --gate <id> 放行；确需跳过请显式使用 --no-gate')
}

export function startPublish(opts = {}) {
  const job = jobs.createJob(PUBLISH_JOB_TITLE)
  const steps = newSteps(opts)
  job.steps = steps
  job.gate = opts.gateId ? { id: opts.gateId, bypassed: false } : { id: null, bypassed: true }
  jobs.emitEvent(job, 'steps', steps.map(s => ({ ...s })))
  jobs.log(
    job,
    opts.gateId ? `发布门禁：已核销放行凭证 ${opts.gateId}` : '发布门禁：已按 --no-gate 显式绕过（本次发布未经预检放行）',
    opts.gateId ? 'info' : 'stderr',
  )

  runPipeline(job, steps, opts).catch(e => {
    jobs.log(job, `发布流程异常：${e.message}`, 'stderr')
    settleSteps(job, steps, { status: 'failed', detail: e.message }, 'running')
    finishPublish(job, steps, -1, opts, e.message)
  })
  return job
}

async function runPipeline(job, steps, opts) {
  const byKey = k => steps.find(s => s.key === k)
  const mark = (k, patch) => markStep(job, byKey(k), patch)

  const fail = (k, detail, code = -1) => {
    if (k) mark(k, { status: 'failed', detail })
    settleSteps(job, steps, { status: 'skipped', detail: '未执行' }, 'pending')
    jobs.log(job, `❌ 发布中止：${detail}`, 'stderr')
    // 发布结果的审计与历史统一在 finishPublish 里落一次，避免本地阶段与 publish.mjs 重复记账
    finishPublish(job, steps, code, opts, detail)
  }

  jobs.log(job, `开始一键发布 · ${new Date().toLocaleString('zh-CN')}`, 'info')

  /* 1. 本地改动检查 */
  mark('check', { status: 'running' })
  let st
  try {
    st = await git.getStatus()
  } catch (e) {
    return fail('check', e.message)
  }
  const branch = st.branch
  const staged = st.files.filter(f => f.staged)
  mark('check', {
    status: 'success',
    detail: `分支 ${branch || '(detached)'} · 改动 ${st.counts.total} · 已暂存 ${st.counts.staged} · 领先 ${st.ahead}`,
  })
  if (!branch) return fail('push', '当前处于 detached HEAD，无法推送')

  /* 2. 提交（有暂存改动时必填消息） */
  if (staged.length > 0) {
    const message = String(opts.message || '').trim()
    if (!message) return fail('commit', '存在已暂存改动，但未填写提交消息')
    mark('commit', { status: 'running' })
    try {
      const r = await git.commit(message, staged.map(f => f.path))
      job.commitInfo = { sha: r.sha, message }
      jobs.log(job, `已提交 ${r.sha}：${message}`, 'success')
      mark('commit', { status: 'success', detail: `${r.sha} · ${staged.length} 个文件` })
      record({ action: 'commit', target: r.sha, detail: `${staged.length} 个文件 · ${message}` })
    } catch (e) {
      return fail('commit', e.message)
    }
  } else {
    mark('commit', { status: 'skipped', detail: '无已暂存改动' })
  }

  /* 3. 推送到远端 */
  if (opts.push === false) {
    mark('push', { status: 'skipped', detail: '已按选项跳过' })
  } else {
    mark('push', { status: 'running' })
    const code = await runStep(job, 'git', ['push', 'origin', branch], {
      cwd: ROOT, env: { GIT_TERMINAL_PROMPT: '0' }, stderrMode: 'info', timeoutMs: 180000,
    })
    if (code !== 0) return fail('push', `git push 退出码 ${code}`)
    mark('push', { status: 'success', detail: `origin/${branch}` })
    record({ action: 'push', target: `origin/${branch}`, detail: `推送成功（退出码 0）` })
  }

  /* 4~9. 交给 publish.mjs（构建 → 部署 → 热更新 → 验证） */
  if (!getAdminKey()) jobs.log(job, '[提醒] 未配置 SITES_ADMIN_KEY，热更新步骤将失败', 'stderr')

  const args = ['scripts/publish.mjs']
  if (opts.skipBuild) args.push('--skip-build')

  const advanceTo = key => {
    advanceToCore(steps, key)
    for (const s of steps) jobs.emitEvent(job, 'step', { ...s })
  }

  const code = await runStep(job, process.execPath, args, {
    cwd: ROOT,
    env: { SITES_ADMIN_KEY: getAdminKey(), NAV_AUDIT_ACTOR: 'console' },
    stderrMode: 'info',
    timeoutMs: 15 * 60 * 1000,
    onLine: line => {
      const m = line.match(/^===\s*(.+?)\s*===\s*$/)
      if (m) { const key = stepFromMarker(m[1]); if (key) advanceTo(key); return }

      if (/跳过构建/.test(line)) mark('build', { status: 'skipped', detail: '--skip-build' })
      if (/数据校验通过/.test(line)) mark('validate', { status: 'success', detail: 'schema 通过' })

      const url = vercel.extractDeploymentUrl(line)
      if (url && !job.deploymentUrl) {
        job.deploymentUrl = url
        jobs.emitEvent(job, 'deployment', { url })
        if (byKey('deploy').status === 'running') mark('deploy', { status: 'running', detail: url })
      }

      const hot = line.match(/发布成功:\s*version=(\d+)\s*count=(\d+)/)
      if (hot) {
        job.cloudVersion = Number(hot[1])
        job.cloudCount = Number(hot[2])
        mark('hotupdate', { status: 'success', detail: `version ${hot[1]} · ${hot[2]} 站点` })
      }

      // 云端快照由服务端在写入前落盘，这里把结果透出给 UI/CLI，失败要显式可见
      const snap = line.match(/快照已保存:\s*(\S+)/)
      if (snap) { job.snapshot = snap[1]; jobs.emitEvent(job, 'snapshot', { ok: true, pathname: snap[1] }) }
      if (/快照保存失败/.test(line)) {
        job.snapshotError = line
        jobs.emitEvent(job, 'snapshot', { ok: false, error: line.replace(/^.*快照保存失败[^：:]*[：:]\s*/, '') })
      }

      const poll = line.match(/poll\s+(\d+):\s*count=(\d+)\s*version=(\d+)/)
      if (poll) mark('verify', { status: 'running', detail: `第 ${poll[1]} 次轮询 · ${poll[2]} 站点 · v${poll[3]}` })
    },
  })

  settleSteps(job, steps, code === 0 ? { status: 'success' } : { status: 'failed', detail: `退出码 ${code}` }, 'running')
  settleSteps(job, steps, { status: 'skipped', detail: '未执行' }, 'pending')

  /* 部署状态机补全：仅在配置了 VERCEL_TOKEN 时可用 */
  if (code === 0 && vercel.available()) {
    try {
      const list = await vercel.listDeployments(10)
      // CLI 可能只打印生产别名，故按 URL 匹配失败时退回最近一次生产部署
      const d = list.find(x => x.url === job.deploymentUrl) || list.find(x => x.target === 'production') || list[0]
      if (d) {
        job.deployment = d
        jobs.emitEvent(job, 'deployment', d)
        mark('deploy', { status: 'success', detail: `${vercel.stateLabel(d.state)} · ${d.url}` })
      }
    } catch (e) {
      jobs.log(job, `[提醒] Vercel 状态补全失败：${e.message}`, 'info')
    }
  }

  jobs.log(job, code === 0 ? '✅ 一键发布完成' : `❌ 一键发布失败（退出码 ${code}）`, code === 0 ? 'success' : 'stderr')
  finishPublish(job, steps, code, opts, code === 0 ? '' : `退出码 ${code}`)
}

/* ---------------- 独立云端验证 ---------------- */

export function startVerify({ expectCount = null, tries = 6, intervalMs = 2000 } = {}) {
  const job = jobs.createJob('云端一致性验证')
  ;(async () => {
    const expect = expectCount ?? localSitesCount()
    jobs.log(job, `目标站点数：${expect ?? '未知'} · 最多轮询 ${tries} 次`, 'info')
    for (let i = 1; i <= tries; i++) {
      const r = await fetchCloud()
      if (!r.ok) {
        jobs.log(job, `poll ${i}: 读取失败 ${r.error}`, 'stderr')
      } else {
        jobs.log(job, `poll ${i}: count=${r.count} version=${r.version} withIcons=${r.withIcons}`)
        if (expect !== null && r.count === expect) {
          jobs.emitEvent(job, 'verdict', { ok: true, expect, ...r })
          jobs.log(job, `✅ 云端已收敛（${r.count} 站点 · v${r.version}）`, 'success')
          jobs.finish(job, 0)
          return
        }
      }
      if (i < tries) await sleep(intervalMs)
    }
    jobs.emitEvent(job, 'verdict', { ok: false, expect })
    jobs.log(job, '⚠️ 云端数据未收敛，请检查热更新结果', 'stderr')
    jobs.finish(job, 1)
  })().catch(e => {
    jobs.log(job, `验证异常：${e.message}`, 'stderr')
    jobs.finish(job, -1)
  })
  return job
}

/** 最近部署列表（需 VERCEL_TOKEN） */
export async function deployments(limit = 8) {
  if (!vercel.available()) {
    return { available: false, reason: '未配置 VERCEL_TOKEN，无法查询部署历史', items: [] }
  }
  try {
    const items = await vercel.listDeployments(limit)
    return { available: true, items: items.map(d => ({ ...d, stateLabel: vercel.stateLabel(d.state) })) }
  } catch (e) {
    return { available: false, reason: e.message, items: [] }
  }
}