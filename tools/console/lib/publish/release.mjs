/**
 * 开发流水线 —— 一条命令跑完一次「改完代码 → 上线」的全过程。
 *
 * ## 为什么需要它
 *
 * 三块能力此前各有一个入口，但**没有一个入口把它们串起来**：
 *
 *   · `nav publish run`  端到端九步，但部署环节走的是 **Vercel**（线上早已迁到自有服务器），
 *                        而且**不含测试**；
 *   · 控制台「发布」面板  走对了服务器（BotKeep），但**不管提交与推送**；
 *   · 测试门禁            `console:test:all` 51 个脚本，**纯手工**。
 *
 * 这个模块把三者收成一条闭环，**部署段直接复用 `deploy.publish`**（不重写），
 * 前四步（检查 / 测试 / 提交 / 推送）由本模块补齐。
 *
 * ## 形态
 *
 * 控制台面板与 CLI（`nav release`）共用这一个编排引擎 —— 行为完全一致，
 * 面板只是多一层实时日志与时间线。
 *
 * ## 步骤推进
 *
 * `deploy.publish` 只用回调打日志，不吐结构化事件。这里按它的 `· xxx` 标记
 * 把日志映射成步骤状态（与 `sync.mjs` 解析 `=== N/5 ===` 是同一手法）——
 * 好处是部署那段的实现一行不用改。
 */
import { ROOT } from '../core/env.mjs'
import * as jobs from '../core/jobs.mjs'
import * as git from '../vcs/git.mjs'
import * as deploy from './deploy.mjs'
import * as endpointsLib from './endpoints.mjs'

export const RELEASE_JOB_TITLE = '开发流水线'
export const TEST_JOB_TITLE = '测试门禁'

/** 步骤定义 —— 顺序即流程。`flag` 指向可跳过它的选项名 */
export const STEP_DEFS = [
  { key: 'check', label: '检查工作区', role: '分支、改动与领先提交' },
  { key: 'test', label: '测试门禁', role: '全量 console:test:all（51 脚本，约 1–2 分钟）', flag: 'skipTest', skipLabel: '--skip-test' },
  { key: 'commit', label: '提交', role: '把工作区改动提交进 git' },
  { key: 'push', label: '推送', role: '推送到 origin', flag: 'noPush', skipLabel: '--no-push' },
  { key: 'build', label: '构建', role: 'vite build + 后置脚本', flag: 'skipBuild', skipLabel: '--skip-build' },
  { key: 'gate', label: '产物门禁', role: '产物完整性与新鲜度' },
  { key: 'pack', label: '打包', role: 'tar 切片（排除 data/）' },
  { key: 'upload', label: '上传', role: '分片上传到平台' },
  { key: 'restart', label: '重启容器', role: '删 server.js 触发解压' },
  { key: 'verify', label: '线上验证', role: '轮询直到线上版本一致' },
]

/**
 * 部署段的日志标记 → 步骤推进。
 * 顺序有意义：`find` 取第一个命中，所以更具体的排在前面。
 */
const DEPLOY_MARKERS = [
  { re: /跳过构建（复用现有 dist）/, key: 'build', skip: true },
  { re: /·\s*构建产物/, key: 'build' },
  { re: /·\s*发布门禁/, key: 'gate' },
  { re: /·\s*打包/, key: 'pack' },
  { re: /·\s*上传分片/, key: 'upload' },
  { re: /·\s*触发容器解压/, key: 'restart' },
  { re: /·\s*等待线上就绪并验证版本/, key: 'verify' },
]

/**
 * 日志行 → 步骤推进指令。纯函数，单独导出是为了让单测能锁住「日志格式漂移」——
 * 万一 deploy.mjs 把 `· 打包` 改成了别的字样，这里必须立刻红，而不是静默地不再推进步骤。
 */
export function markerKeyOf(line) {
  const s = String(line || '').trim()
  if (!s) return null
  const m = DEPLOY_MARKERS.find(x => x.re.test(s))
  return m ? { key: m.key, skip: Boolean(m.skip) } : null
}

/**
 * 该步骤是否**还能被标记推进** —— 已走过（ok/skipped）或已终结（failed）的不再改。
 *
 * 为什么需要：`deploy.publish` 的同一段日志里 `· 打包` 出现过两次，而标记是纯文本匹配的。
 * 没有这道守卫，一个迟到的重复标记会把**已经完成**的 upload 标成 ok、又把 pack 打回 running，
 * 时间线就会显示成「越跑越回去」。纯函数，便于单测。
 */
export function shouldAdvance(steps, key) {
  const s = (steps || []).find(x => x.key === key)
  if (!s) return false
  return s.status === 'pending' || s.status === 'running'
}

/** 该步骤是否被选项显式跳过 */
export function isSkipped(key, opts = {}) {
  const def = STEP_DEFS.find(s => s.key === key)
  return Boolean(def && def.flag && opts[def.flag])
}

/**
 * 纯函数：步骤计划（含跳过标记）。
 * 不读磁盘、不碰网络 —— 单测可以直接断言。
 */
export function planSteps(opts = {}) {
  return STEP_DEFS.map(s => ({
    key: s.key,
    label: s.label,
    role: s.role,
    status: isSkipped(s.key, opts) ? 'skipped' : 'pending',
    note: isSkipped(s.key, opts) ? `已按 ${s.skipLabel} 跳过` : '',
  }))
}

/**
 * 异步预检：计划 + 阻塞项 + 事实。
 * 面板的「预检」按钮与 CLI 的 `--dry-run` 都读它。**只读，不产生副作用。**
 */
export async function preflight(opts = {}) {
  const steps = planSteps(opts)
  const blockers = []

  let st = null
  try { st = await git.getStatus() } catch { blockers.push('无法读取 git 状态（当前不是 git 仓库？）') }
  if (st && !st.branch) blockers.push('处于 detached HEAD，无法推送')

  const dirty = Number(st?.counts?.total) || 0
  const staged = Number(st?.counts?.staged) || 0
  const ahead = Number(st?.ahead) || 0
  const message = String(opts.message || '').trim()

  // 面板打开时只是「看看状态」，此刻还没有 message 是正常的 —— 传 requireMessage:false 跳过这一项
  if (dirty > 0 && !message && opts.requireMessage !== false) blockers.push(`有 ${dirty} 处未提交改动，但没有提交消息（--message）`)

  const c = deploy.credentials()
  if (!c.key) blockers.push('缺少 BOTKEEP_API_KEY（在本机 .env.local 配置）')
  if (!c.workloadId) blockers.push('缺少 BOTKEEP_WORKLOAD_ID（在本机 .env.local 配置）')

  const plan = []
  plan.push(`检查工作区（${st ? `${st.branch} · ${dirty} 处改动 · 领先 ${ahead}` : '读不到状态'}）`)
  plan.push(isSkipped('test', opts) ? '测试门禁（已跳过）' : '测试门禁：console:test:all')
  plan.push(dirty > 0 ? `提交 ${dirty} 处改动` : '提交（工作区干净，跳过）')
  plan.push(isSkipped('push', opts) ? '推送（已跳过）' : `推送 ${ahead} 个领先提交`)
  plan.push(isSkipped('build', opts) ? '构建（已跳过，复用现有 dist）' : '构建前端产物')
  plan.push('产物门禁 → 打包 → 上传 → 重启容器 → 线上验证')

  return { steps, blockers, plan, facts: { branch: st?.branch || '', dirty, staged, ahead } }
}

/* ---------------- 运行期 ---------------- */

function mark(job, steps, key, patch) {
  const s = steps.find(x => x.key === key)
  if (!s) return
  Object.assign(s, patch)
  jobs.emitEvent(job, 'step', { ...s })
}

/** 子进程执行一步，日志并入同一任务，**不结束任务本身** */
function runStep(job, command, cmdArgs, opts = {}) {
  return new Promise(resolve => {
    const child = jobs.run(job, command, cmdArgs, { ...opts, autoFinish: false })
    child.on('close', code => resolve(code ?? -1))
  })
}

async function runRelease(job, steps, opts) {
  const t0 = Date.now()
  const message = String(opts.message || '').trim()

  /* 1. 检查工作区 */
  mark(job, steps, 'check', { status: 'running' })
  const st = await git.getStatus()
  if (!st.branch) throw new Error('处于 detached HEAD，无法推送')
  const dirty = Number(st.counts?.total) || 0
  mark(job, steps, 'check', { status: 'ok', note: `${dirty} 处改动 · 领先 ${st.ahead} 个提交` })
  jobs.log(job, `工作区：${st.branch} · ${dirty} 处改动 · 领先 origin ${st.ahead} 个提交`, 'info')

  /* 2. 测试门禁 */
  if (isSkipped('test', opts)) {
    mark(job, steps, 'test', { status: 'skipped', note: '已按 --skip-test 跳过' })
    jobs.log(job, '测试门禁：已显式跳过（本次发布未经测试放行）', 'stderr')
  } else {
    mark(job, steps, 'test', { status: 'running' })
    jobs.log(job, '测试门禁：console:test:all（52 个脚本，约 1–2 分钟）', 'info')
    /**
     * Windows 上 `npm` 是 `npm.cmd`，spawn 直接执行会 ENOENT（Node 对 .cmd 的安全限制）。
     * 与 deploy.mjs 的构建步骤同一套解法：Windows 走 shell + 整条命令，其余平台走 argv。
     */
    const win = process.platform === 'win32'
    const code = win
      ? await runStep(job, 'npm run console:test:all', [], { cwd: ROOT, shell: true })
      : await runStep(job, 'npm', ['run', 'console:test:all'], { cwd: ROOT })
    if (code !== 0) throw new Error('测试未通过 —— 流水线中止（确认无碍后可用 --skip-test 显式跳过）')
    mark(job, steps, 'test', { status: 'ok' })
  }

  /* 3. 提交 */
  if (dirty === 0) {
    mark(job, steps, 'commit', { status: 'skipped', note: '工作区干净，无需提交' })
  } else {
    if (!message) throw new Error(`有 ${dirty} 处改动但没有提交消息（--message）`)
    mark(job, steps, 'commit', { status: 'running' })
    await git.stagePaths(['.'])
    const r = await git.commit(message)
    mark(job, steps, 'commit', { status: 'ok', note: r.sha })
    jobs.log(job, `已提交 ${r.sha}`, 'info')
  }

  /* 4. 推送 */
  if (isSkipped('push', opts)) {
    mark(job, steps, 'push', { status: 'skipped', note: '已按 --no-push 跳过' })
  } else {
    const st2 = await git.getStatus()
    if (!Number(st2.ahead)) {
      mark(job, steps, 'push', { status: 'skipped', note: '没有需要推送的提交' })
    } else {
      mark(job, steps, 'push', { status: 'running' })
      const code = await runStep(job, 'git', ['push', 'origin', st2.branch], {
        cwd: ROOT, env: { GIT_TERMINAL_PROMPT: '0' }, stderrMode: 'info',
      })
      if (code !== 0) throw new Error('推送失败（凭据缺失会快速失败而非挂起）')
      mark(job, steps, 'push', { status: 'ok', note: `${st2.ahead} 个提交` })
    }
  }

  /* 5-10. 部署段：复用 deploy.publish，用日志标记推进步骤 */
  if (isSkipped('build', opts)) mark(job, steps, 'build', { status: 'skipped', note: '已按 --skip-build 跳过' })
  else mark(job, steps, 'build', { status: 'running' })
  let cur = 'build'

  const deployLog = (t) => {
      for (const raw of String(t).split(/\r?\n/)) {
        const line = raw.trim()
        if (!line) continue
        const m = markerKeyOf(line)
        // 只前进：迟到的重复标记不能让时间线回退（见 shouldAdvance 的说明）
        if (m && shouldAdvance(steps, m.key)) {
          // 上一个部署步收尾 —— 只收敛仍在 running 的，别把 skipped 覆盖成 ok
          if (cur && cur !== m.key) {
            const prev = steps.find(x => x.key === cur)
            if (prev && prev.status === 'running') mark(job, steps, cur, { status: 'ok' })
          }
          mark(job, steps, m.key, m.skip
            ? { status: 'skipped', note: '复用现有 dist' }
            : { status: 'running' })
          cur = m.key
        }
      }
      jobs.log(job, t)
  }

  /**
   * N2：多端点。选了 ≥2 个端点时依次发布（一个失败不阻断其余）；否则走原单端点路径，
   * 行为与多端点引入之前一字不差。第一个端点构建，其余复用同一份 dist。
   */
  let r
  let multiEndpointResults = null
  const endpointPick = opts.endpointIds && opts.endpointIds.length
    ? endpointsLib.resolveEndpoints(opts.endpointIds) : null
  if (endpointPick && !endpointPick.ok) throw new Error(endpointPick.error)
  if (endpointPick && endpointPick.endpoints.length > 1) {
    const all = await deploy.publishAll({ skipBuild: Boolean(opts.skipBuild), log: deployLog, endpoints: endpointPick.endpoints })
    const firstOk = all.results.find(x => x.ok)
    r = firstOk ? firstOk.result : { ok: false, error: all.results.map(x => `${x.endpoint}: ${x.error || '失败'}`).join('；') }
    multiEndpointResults = all.results
  } else {
    r = await deploy.publish({ skipBuild: Boolean(opts.skipBuild), log: deployLog })
  }

  if (!r.ok) throw new Error(r.error || '发布失败')
  const verifyStep = steps.find(x => x.key === 'verify')
  if (verifyStep && verifyStep.status !== 'ok') mark(job, steps, 'verify', { status: 'ok', note: `线上 ${r.shortSha}` })

  const seconds = Math.round((Date.now() - t0) / 1000)
  jobs.log(job, `\n✓ 流水线完成 —— 用时 ${seconds}s，线上版本 ${r.shortSha}（${r.subject || ''}）`, 'info')
  job.release = {
    sha: r.sha, shortSha: r.shortSha, subject: r.subject || '', seconds, steps: r.steps || [],
    endpoints: multiEndpointResults
      ? multiEndpointResults.map(x => ({ endpoint: x.endpoint, ok: x.ok, shortSha: x.result?.shortSha || '' }))
      : null,
  }
  jobs.finish(job, 0)
}

/** 启动流水线：返回 job，前端拿 jobId 走 SSE 看实时日志与时间线 */
export function startRelease(opts = {}) {
  if (jobs.listJobs().some(j => j.title === RELEASE_JOB_TITLE && j.status === 'running')) {
    throw new Error('已有流水线在运行中，请等它结束。')
  }
  const job = jobs.createJob(RELEASE_JOB_TITLE)
  const steps = planSteps(opts)
  job.steps = steps
  job.releaseOpts = {
    message: opts.message || '',
    skipTest: Boolean(opts.skipTest),
    noPush: Boolean(opts.noPush),
    skipBuild: Boolean(opts.skipBuild),
  }
  jobs.emitEvent(job, 'steps', steps.map(s => ({ ...s })))

  runRelease(job, steps, opts).catch(e => {
    const cur = steps.find(s => s.status === 'running')
    if (cur) mark(job, steps, cur.key, { status: 'failed', note: e.message })
    jobs.log(job, `\n✗ 流水线中止：${e.message}`, 'stderr')
    jobs.finish(job, 1)
  })
  return job
}

/** 最近一次流水线的概览（面板打开时回显） */
export function lastRelease() {
  const j = jobs.listJobs().find(x => x.title === RELEASE_JOB_TITLE)
  if (!j) return null
  return {
    id: j.id,
    status: j.status,
    startedAt: j.startedAt,
    endedAt: j.endedAt,
    steps: (j.steps || []).map(s => ({ key: s.key, label: s.label, status: s.status, note: s.note })),
    release: j.release || null,
    opts: j.releaseOpts || null,
  }
}
