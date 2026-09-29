/**
 * nav CLI 内核：输出契约、退出码、参数解析、长任务等待。
 *
 * 面向智能体的输出契约：
 * - stdout 永远只有一份结果文档 —— 默认单行 JSON，`--pretty` 时为人类可读文本
 * - 进度与子进程日志一律走 stderr，因此 stdout 可直接 JSON.parse
 * - 退出码稳定可判定：0 成功 / 1 内部错误 / 2 用法错误 / 3 环境缺失 / 4 远端失败 / 5 业务拒绝
 */
import { parseArgs } from 'node:util'
import * as jobs from '../../console/lib/jobs.mjs'

export const EXIT = {
  OK: 0,
  INTERNAL: 1,
  USAGE: 2,
  ENV: 3,
  REMOTE: 4,
  REJECTED: 5,
}

/** 退出码语义（供 `nav schema` 自述） */
export const EXIT_CODES = [
  { code: 0, name: 'OK', meaning: '成功' },
  { code: 1, name: 'INTERNAL', meaning: '未预期的内部异常' },
  { code: 2, name: 'USAGE', meaning: '参数或用法错误' },
  { code: 3, name: 'ENV', meaning: '环境/配置缺失（密钥、工具链、非 git 仓库等）' },
  { code: 4, name: 'REMOTE', meaning: '远端或网络失败（推送、部署、热更新、超时）' },
  { code: 5, name: 'REJECTED', meaning: '业务规则拒绝（校验不通过、路径不安全、前置条件不满足）' },
]

export class CliError extends Error {
  constructor(message, { code = 'REJECTED', exitCode = EXIT.REJECTED, hint = '', detail = null } = {}) {
    super(message)
    this.name = 'CliError'
    this.code = code
    this.exitCode = exitCode
    this.hint = hint
    this.detail = detail
  }
}

/** 把任意异常映射为稳定的错误码与退出码，避免把原始堆栈语义泄露给调用方 */
export function toCliError(e) {
  if (e instanceof CliError) return e
  const message = String(e?.message || e || '未知错误')
  const usage = /Unknown option|Missing required|requires|无法解析|需要|请填写|必须/.test(message)
  const env = /SITES_ADMIN_KEY|管理密钥|未配置|不是 git 仓库|ENOENT|not found/.test(message)
  const remote = /超时|timeout|网络|ECONN|ETIMEDOUT|EAI_AGAIN|socket|curl|退出码|部署|远端|推送/.test(message)
  if (usage) return new CliError(message, { code: 'USAGE', exitCode: EXIT.USAGE })
  if (env) return new CliError(message, { code: 'ENV_MISSING', exitCode: EXIT.ENV })
  if (remote) return new CliError(message, { code: 'REMOTE_FAILED', exitCode: EXIT.REMOTE })
  return new CliError(message, { code: 'REJECTED', exitCode: EXIT.REJECTED })
}

/* ---------------- 全局参数 ---------------- */

const BOOL_GLOBALS = new Map([
  ['--pretty', 'pretty'], ['--json', 'json'], ['--quiet', 'quiet'], ['-q', 'quiet'],
  ['--dry-run', 'dryRun'],
  ['--help', 'help'], ['-h', 'help'], ['--version', 'version'], ['-v', 'version'],
])

export const GLOBAL_FLAGS = [
  { name: '--pretty', desc: '人类可读输出（默认输出单行 JSON）' },
  { name: '--json', desc: '显式声明 JSON 输出（默认即 JSON，便于脚本自述）' },
  { name: '--quiet, -q', desc: '抑制 stderr 进度与日志' },
  { name: '--dry-run', desc: '预演写操作：只校验并展示将要发生的变化，不落盘 / 不推送（对只读命令无效果）' },
  { name: '--timeout <ms>', desc: '长任务超时毫秒数，超时强制终止（默认 900000）' },
  { name: '--help, -h', desc: '查看帮助（`nav help <命令>` 看单个命令）' },
  { name: '--version, -v', desc: '输出版本号' },
]

/** 剥离全局参数，其余原样交给命令自己的 parseArgs */
export function splitGlobals(argv) {
  const globals = { pretty: false, json: false, quiet: false, dryRun: false, help: false, version: false, timeoutMs: 15 * 60 * 1000 }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]
    if (BOOL_GLOBALS.has(tok)) {
      globals[BOOL_GLOBALS.get(tok)] = true
      continue
    }
    if (tok === '--timeout' || tok.startsWith('--timeout=')) {
      const raw = tok.includes('=') ? tok.slice(tok.indexOf('=') + 1) : argv[++i]
      const n = Number(raw)
      if (!Number.isFinite(n) || n <= 0) {
        throw new CliError(`--timeout 需要正整数毫秒，收到：${raw}`, { code: 'USAGE', exitCode: EXIT.USAGE })
      }
      globals.timeoutMs = n
      continue
    }
    rest.push(tok)
  }
  return { globals, rest }
}

/** 命令内统一参数解析：失败一律转为 USAGE 错误，并附带该命令用法 */
export function parseCommandArgs(argv, options = {}, { allowPositionals = false, usage = '' } = {}) {
  try {
    return parseArgs({ args: argv, options, allowPositionals, strict: true })
  } catch (e) {
    throw new CliError(e.message, { code: 'USAGE', exitCode: EXIT.USAGE, hint: usage ? `用法：${usage}` : '用 nav help 查看命令清单' })
  }
}

/** 必填位置参数取值 */
export function requirePositional(positionals, index, name, usage) {
  const value = positionals[index]
  if (!value) {
    throw new CliError(`缺少参数 ${name}`, { code: 'USAGE', exitCode: EXIT.USAGE, hint: `用法：${usage}` })
  }
  return value
}

/**
 * 由声明式 flags 生成 parseArgs 选项。
 * 同一份声明同时供 `nav schema` 自述，避免「文档与实现两处维护」。
 */
export function buildOptions(flags = {}) {
  return Object.fromEntries(Object.entries(flags).map(([name, f]) => [name, {
    type: f.type || 'string',
    ...(f.short ? { short: f.short } : {}),
    ...(f.default !== undefined ? { default: f.default } : {}),
  }]))
}

/* ---------------- 输出 ---------------- */

/** 结果信封：成功与失败共用同一外层结构，便于调用方统一解析 */
export function emitResult(res, { pretty }) {
  const { command, ok, data = null, error = null, meta = {} } = res
  if (pretty) {
    const text = ok
      ? (res.render ? res.render(data, meta) : JSON.stringify(data, null, 2))
      : `✖ ${command} 失败：${error?.message || '未知错误'}${error?.hint ? `\n  ↳ ${error.hint}` : ''}`
    process.stdout.write(text + '\n')
    return
  }
  const payload = ok
    ? { ok: true, command, data, meta }
    : { ok: false, command, error, data, meta }
  process.stdout.write(JSON.stringify(payload) + '\n')
}

/** 人类可读提示：JSON 模式写 stderr，保证 stdout 纯净 */
export function note(text, { quiet }) {
  if (quiet) return
  process.stderr.write(text + '\n')
}

/** 东亚宽字符与 emoji 占两列，按显示宽度对齐才能让中文表格不歪 */
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]|[\u{1F300}-\u{1FAFF}]|[\u{20000}-\u{3FFFD}]/u

export function displayWidth(text) {
  let w = 0
  for (const ch of String(text ?? '')) w += WIDE.test(ch) ? 2 : 1
  return w
}

/** 极简表格渲染（--pretty 用），列宽按显示宽度自适应 */
export function table(headers, rows) {
  const cells = rows.map(r => r.map(v => String(v ?? '')))
  const widths = headers.map((h, i) => Math.max(displayWidth(h), ...cells.map(r => displayWidth(r[i] || ''))))
  const pad = (v, i) => String(v ?? '') + ' '.repeat(Math.max(0, widths[i] - displayWidth(v)))
  const line = r => r.map(pad).join('  ').trimEnd()
  return [line(headers), widths.map(w => '-'.repeat(w)).join('  '), ...cells.map(line)].join('\n')
}

/** 写操作预演的统一信封：明确标注未生效，避免调用方误以为已落盘 */
export function dryRunResult(plan) {
  const data = { dryRun: true, applied: false, ...plan }
  return {
    data,
    render: d => `预演（未生效）\n\n${JSON.stringify(Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'dryRun' && k !== 'applied')), null, 2)}`,
  }
}

/* ---------------- 长任务等待 ---------------- */

const STEP_MARK = { running: '▶', success: '✓', failed: '✖', skipped: '·', pending: ' ' }

/**
 * 等待任务结束：实时把日志与步骤进度打到 stderr，返回结构化结果。
 * 任务与 CLI 同进程，因此直接轮询内存中的 job 对象，无需经 SSE。
 */
export function awaitJob(job, { timeoutMs = 0, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    let cursor = 0

    const flush = () => {
      for (; cursor < job.events.length; cursor++) {
        const { event, data } = job.events[cursor]
        if (quiet) continue
        if (event === 'log') process.stderr.write(`[${job.id}] ${data.text}\n`)
        else if (event === 'step') process.stderr.write(`[${job.id}] ${STEP_MARK[data.status] || '·'} ${data.label}${data.detail ? ' — ' + data.detail : ''}\n`)
      }
    }

    const result = () => ({
      jobId: job.id,
      title: job.title,
      status: job.status,
      exitCode: job.exitCode,
      durationMs: (job.endedAt || Date.now()) - job.startedAt,
      steps: (job.steps || []).map(s => ({ key: s.key, label: s.label, status: s.status, detail: s.detail, duration: s.duration })),
      cloudVersion: job.cloudVersion ?? null,
      deploymentUrl: job.deploymentUrl || null,
      logs: job.events.filter(e => e.event === 'log').map(e => e.data),
    })

    const tick = () => {
      flush()
      if (job.status !== 'running') {
        resolve(result())
        return
      }
      if (timeoutMs && Date.now() - started > timeoutMs) {
        jobs.killJob(job.id)
        reject(new CliError(`任务超时（${Math.round(timeoutMs / 1000)}s）：${job.title}`, {
          code: 'TIMEOUT', exitCode: EXIT.REMOTE, hint: '可用 --timeout <ms> 放宽，或到控制台查看已产出的日志',
        }))
        return
      }
      setTimeout(tick, 200)
    }

    tick()
  })
}

/** 等待任务并按退出码转成命令结果：失败时保留完整结构化结果，仅 ok=false */
export async function runJob(job, ctx, { label } = {}) {
  const result = await awaitJob(job, { timeoutMs: ctx.timeoutMs, quiet: ctx.quiet })
  const ok = result.exitCode === 0
  return {
    ok,
    data: result,
    meta: { jobId: result.jobId, durationMs: result.durationMs },
    error: ok ? null : {
      code: 'JOB_FAILED',
      message: `${label || result.title} 失败（退出码 ${result.exitCode}）`,
      hint: '详见 data.steps 与 data.logs',
    },
    exitCode: ok ? EXIT.OK : EXIT.REMOTE,
  }
}