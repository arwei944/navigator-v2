/**
 * 全链路同步编排：本地改动 → 提交 → 推送 → 备份 → 门禁 → 构建 → 部署 → 热更新 → 验证
 *
 * 设计原则：scripts/publish.mjs 是唯一发布入口（单一真相源），控制台只做编排与可视化。
 * 构建/部署/热更新/验证四步通过解析 publish.mjs 的 `=== N/5 xxx ===` 标记推进时间线。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ROOT, getAdminKey } from './env.mjs'
import * as jobs from './jobs.mjs'
import * as git from './git.mjs'
import * as vercel from './vercel.mjs'

const pExecFile = promisify(execFile)

export const SITE_URL = 'https://navigator-v2-two.vercel.app'
export const PUBLISH_JOB_TITLE = '一键发布'

const STEP_DEFS = [
  { key: 'check', label: '本地改动检查', phase: 'local' },
  { key: 'commit', label: '提交', phase: 'local' },
  { key: 'push', label: '推送到远端', phase: 'local' },
  { key: 'backup', label: '数据备份', phase: 'publish' },
  { key: 'validate', label: '数据门禁', phase: 'publish' },
  { key: 'build', label: '构建', phase: 'publish' },
  { key: 'deploy', label: 'Vercel 部署', phase: 'publish' },
  { key: 'hotupdate', label: 'Blob 热更新', phase: 'publish' },
  { key: 'verify', label: '一致性验证', phase: 'publish' },
]
const PUBLISH_ORDER = STEP_DEFS.filter(s => s.phase === 'publish').map(s => s.key)

const TERMINAL = ['success', 'failed', 'skipped']
const sleep = ms => new Promise(r => setTimeout(r, ms))

function markerToKey(text) {
  if (/备份数据/.test(text)) return 'backup'
  if (/schema\s*校验|数据校验/.test(text)) return 'validate'
  if (/构建/.test(text)) return 'build'
  if (/部署到\s*Vercel|部署/.test(text)) return 'deploy'
  if (/热更新/.test(text)) return 'hotupdate'
  if (/轮询验证|一致性/.test(text)) return 'verify'
  return null
}

function newSteps() {
  return STEP_DEFS.map(d => ({
    key: d.key, label: d.label, phase: d.phase,
    status: 'pending', startedAt: null, endedAt: null, duration: null, detail: '',
  }))
}

function markStep(job, step, patch) {
  // 同状态重复标记且无新细节时跳过，避免覆盖已记录的耗时
  if (patch.status === step.status && patch.detail === undefined && Object.keys(patch).length === 1) return step
  Object.assign(step, patch)
  if (patch.status === 'running' && !step.startedAt) step.startedAt = Date.now()
  if (TERMINAL.includes(patch.status)) {
    step.endedAt = Date.now()
    step.duration = step.startedAt ? step.endedAt - step.startedAt : 0
  }
  jobs.emitEvent(job, 'step', { ...step })
  return step
}

/** 子进程执行一步，流式日志并入同一任务，不结束任务本身 */
function runStep(job, command, cmdArgs, opts = {}) {
  return new Promise(resolve => {
    const child = jobs.run(job, command, cmdArgs, { ...opts, autoFinish: false })
    child.on('close', code => resolve(code ?? -1))
  })
}

/* ---------------- 云端读取 ---------------- */

/** 读取云端站点数据（带缓存穿透参数，绕过 CDN 缓存） */
export async function fetchCloud() {
  try {
    const { stdout } = await pExecFile('curl.exe', [
      '-s', '--max-time', '30', `${SITE_URL}/api/sites?t=${Date.now()}`,
    ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true })
    const j = JSON.parse(stdout)
    const sites = Array.isArray(j.sites) ? j.sites : []
    return {
      ok: true,
      version: j.version ?? null,
      count: sites.length,
      withIcons: sites.filter(s => s.icon).length,
      updatedAt: j.updatedAt || null,
      fetchedAt: Date.now(),
    }
  } catch (e) {
    return { ok: false, error: e.message, fetchedAt: Date.now() }
  }
}

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

export function startPublish(opts = {}) {
  const job = jobs.createJob(PUBLISH_JOB_TITLE)
  const steps = newSteps()
  job.steps = steps
  jobs.emitEvent(job, 'steps', steps.map(s => ({ ...s })))

  runPipeline(job, steps, opts).catch(e => {
    jobs.log(job, `发布流程异常：${e.message}`, 'stderr')
    for (const s of steps) if (s.status === 'running') markStep(job, s, { status: 'failed', detail: e.message })
    jobs.finish(job, -1)
  })
  return job
}

async function runPipeline(job, steps, opts) {
  const byKey = k => steps.find(s => s.key === k)
  const mark = (k, patch) => markStep(job, byKey(k), patch)

  const fail = (k, detail, code = -1) => {
    if (k) mark(k, { status: 'failed', detail })
    for (const s of steps) if (s.status === 'pending') markStep(job, s, { status: 'skipped', detail: '未执行' })
    jobs.log(job, `❌ 发布中止：${detail}`, 'stderr')
    jobs.finish(job, code)
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
      jobs.log(job, `已提交 ${r.sha}：${message}`, 'success')
      mark('commit', { status: 'success', detail: `${r.sha} · ${staged.length} 个文件` })
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
  }

  /* 4~9. 交给 publish.mjs（构建 → 部署 → 热更新 → 验证） */
  if (!getAdminKey()) jobs.log(job, '[提醒] 未配置 SITES_ADMIN_KEY，热更新步骤将失败', 'stderr')

  const args = ['scripts/publish.mjs']
  if (opts.skipBuild) args.push('--skip-build')

  const advanceTo = key => {
    for (const k of PUBLISH_ORDER) {
      const s = byKey(k)
      if (k === key) {
        if (s.status === 'pending') mark(k, { status: 'running', detail: '进行中…' })
        return
      }
      if (s.status === 'running') mark(k, { status: 'success' })
    }
  }

  const code = await runStep(job, process.execPath, args, {
    cwd: ROOT,
    env: { SITES_ADMIN_KEY: getAdminKey() },
    stderrMode: 'info',
    timeoutMs: 15 * 60 * 1000,
    onLine: line => {
      const m = line.match(/^===\s*(.+?)\s*===\s*$/)
      if (m) { const key = markerToKey(m[1]); if (key) advanceTo(key); return }

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
        mark('hotupdate', { status: 'success', detail: `version ${hot[1]} · ${hot[2]} 站点` })
      }

      const poll = line.match(/poll\s+(\d+):\s*count=(\d+)\s*version=(\d+)/)
      if (poll) mark('verify', { status: 'running', detail: `第 ${poll[1]} 次轮询 · ${poll[2]} 站点 · v${poll[3]}` })
    },
  })

  const running = steps.filter(s => s.status === 'running')
  for (const s of running) markStep(job, s, code === 0 ? { status: 'success' } : { status: 'failed', detail: `退出码 ${code}` })
  for (const s of steps) if (s.status === 'pending') markStep(job, s, { status: 'skipped', detail: '未执行' })

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
  jobs.finish(job, code)
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