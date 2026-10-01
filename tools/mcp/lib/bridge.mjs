/**
 * MCP ↔ CLI 桥接层：MCP 只做「参数映射 + 结果透传」，业务逻辑全部走 tools/cli/commands/*。
 *
 * 为什么不在 MCP 里重新实现一遍：命令定义（flags / positionals / mutating）已经是
 * 声明式的，MCP 直接读它来把结构化参数翻译成 argv，就不会出现「CLI 改了参数、MCP 没跟上」的漂移。
 */
import { CliError, EXIT, toCliError } from '../../cli/lib/core.mjs'
import { findCommand, commandList } from '../../cli/lib/registry.mjs'

export { commandList, findCommand }

/**
 * 写操作清单：MCP 侧对这些动作要求显式 confirm: true 才真跑，否则降级为预演。
 * 与命令定义里的 `mutating` 保持一致 —— 这里额外列出来是为了能给出「为什么被拦」的说明。
 */
const WRITE_REASON = {
  'sites add': '会写入 api/sites-data.json',
  'sites update': '会改写 api/sites-data.json 中该站点',
  'sites remove': '会从 api/sites-data.json 删除该站点',
  'sites batch': '会批量改写 / 删除 api/sites-data.json 中的多个站点',
  'sites icon': '会下载图标文件并回写 icon 字段',
  'publish run': '会提交 / 推送 / 部署 / 覆盖云端数据',
  'publish sync-data': '会提交 / 推送 / 覆盖云端数据',
  'ops notify-read': '会改写通知的已读状态',
  'ops notify-clear': '会清空全部通知（不可撤销）',
  'ops webhook-set': '会改写通知 Webhook 配置',
  'ops inspect': '会执行全站探活并写入健康快照与通知',
  'git stage': '会修改 git 索引',
  'git unstage': '会修改 git 索引',
  'git stage-hunks': '会修改 git 索引（只搬选中的 hunk）',
  'git unstage-hunks': '会修改 git 索引（只退回选中的 hunk）',
  'git commit': '会创建 commit',
  'git push': '会推送到远端',
}

/** 该命令路径是否属于写操作 */
export function isWrite(path) {
  return Object.prototype.hasOwnProperty.call(WRITE_REASON, path)
}

export function writeReason(path) {
  return WRITE_REASON[path] || ''
}

/**
 * 由命令的声明式 flags 生成 argv：字符串型 → `--k v`，布尔型 → `--k`（仅真值时）。
 * 未知 flag 直接报用法错误，避免智能体传了拼错的参数却被静默忽略。
 */
export function toArgv(cmd, { positionals = [], flags = {} } = {}) {
  const argv = positionals.map(v => String(v))
  for (const [name, value] of Object.entries(flags)) {
    if (value === undefined || value === null) continue
    const decl = cmd.flags?.[name]
    if (!decl) {
      const known = Object.keys(cmd.flags || {})
      throw new CliError(`命令 ${cmd.path} 不支持参数 ${name}`, {
        code: 'USAGE',
        exitCode: EXIT.USAGE,
        hint: known.length ? `可用参数：${known.join('、')}` : '该命令没有可选参数',
      })
    }
    if (decl.type === 'boolean') {
      if (value) argv.push(`--${name}`)
      continue
    }
    argv.push(`--${name}`, String(value))
  }
  return argv
}

/** 把命令返回值归一成统一信封，便于 MCP 侧一律按同一结构读取 */
function normalize(path, res, durationMs) {
  const ok = res?.ok !== undefined ? Boolean(res.ok) : true
  return {
    ok,
    command: path,
    data: res?.data ?? null,
    error: res?.error ?? null,
    exitCode: res?.exitCode !== undefined ? res.exitCode : (ok ? EXIT.OK : EXIT.REJECTED),
    meta: { durationMs, ...(res?.meta || {}) },
  }
}

/**
 * 调用一个 CLI 命令。
 * quiet 默认 false：长任务的进度日志走 stderr，MCP 客户端会把它显示为服务端日志，便于观察。
 */
export async function invoke(path, { positionals, flags, dryRun = false, quiet = false, timeoutMs } = {}) {
  const cmd = findCommand(path)
  if (!cmd) {
    throw new CliError(`未知命令：${path}`, {
      code: 'USAGE',
      exitCode: EXIT.USAGE,
      hint: `可用命令：${commandList().map(c => c.path).join('、')}`,
    })
  }
  const argv = toArgv(cmd, { positionals, flags })
  const ctx = { dryRun: Boolean(dryRun), quiet: Boolean(quiet), timeoutMs: timeoutMs || 15 * 60 * 1000 }
  const started = Date.now()
  try {
    const res = await cmd.run(argv, ctx)
    return normalize(path, res, Date.now() - started)
  } catch (e) {
    const err = toCliError(e)
    return {
      ok: false,
      command: path,
      data: err.detail ?? null,
      error: { code: err.code, message: err.message, hint: err.hint || '' },
      exitCode: err.exitCode,
      meta: { durationMs: Date.now() - started },
    }
  }
}

/**
 * 带闸门的调用：写操作必须显式 confirm 才执行，否则自动降级为预演。
 * 返回值里带 `gate` 字段，让智能体一眼看出「这是预演，还是真跑了」。
 */
export async function invokeGated(path, params = {}, { confirm = false, quiet = false, timeoutMs } = {}) {
  const write = isWrite(path)
  const gated = write && confirm !== true
  const res = await invoke(path, {
    ...params,
    dryRun: gated ? true : Boolean(params.dryRun),
    quiet,
    timeoutMs,
  })
  return {
    ...res,
    gate: write
      ? (gated
        ? { write: true, confirmed: false, preview: true, reason: writeReason(path), next: '确认无误后带 confirm: true 重新调用即可真正执行' }
        : { write: true, confirmed: true, preview: false, reason: writeReason(path) })
      : { write: false, confirmed: true, preview: Boolean(params.dryRun) },
  }
}

/** 把命令结果渲染成 MCP 工具返回的文本块：JSON 为主，便于智能体直接解析 */
export function toToolText(res) {
  return JSON.stringify(res, null, 2)
}

/** 命令结果是否应标为工具错误（isError=true） */
export function isToolError(res) {
  return res.ok === false
}