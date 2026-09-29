#!/usr/bin/env node
/**
 * nav —— nav-v2 运维 CLI（面向智能体调用）
 *
 * 输出契约：
 * - stdout 只有一份结果文档：默认单行 JSON `{ok,command,data,meta}`，`--pretty` 转人类可读
 * - 进度与子进程日志一律走 stderr，因此 stdout 可直接 JSON.parse
 * - 退出码稳定：0 成功 / 1 内部错误 / 2 用法错误 / 3 环境缺失 / 4 远端失败 / 5 业务拒绝
 * 例外：help 是阅读型输出，直接打印文本；机器可读清单用 `nav schema`。
 *
 * 业务逻辑全部复用 tools/console/lib/*，与控制台面板、scripts/*.mjs 同源，避免多处实现漂移。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../console/lib/env.mjs'
import { CliError, EXIT, EXIT_CODES, GLOBAL_FLAGS, emitResult, note, splitGlobals, table, toCliError } from './lib/core.mjs'
import { commands as siteCommands } from './commands/sites.mjs'
import { commands as publishCommands } from './commands/publish.mjs'
import { commands as gitCommands } from './commands/git.mjs'
import { commands as dataCommands } from './commands/data.mjs'

const GROUPS = [
  { id: 'sites', label: '站点管理', desc: '站点数据增删改查、分类、元信息抓取、图标、批量探活', commands: siteCommands },
  { id: 'publish', label: '发布与云端', desc: '本地/云端一致性、一键发布、数据同步、部署记录', commands: publishCommands },
  { id: 'git', label: 'Git 工作流', desc: '状态、差异、历史、提交消息建议、暂存、提交、推送', commands: gitCommands },
  { id: 'data', label: '数据体检与环境', desc: '统计、完整性体检、改动对比、schema 门禁、环境自检', commands: dataCommands },
]

const META_HELP = [
  ['nav help [命令路径]', '查看总览，或单个命令的完整用法'],
  ['nav schema', '输出机器可读清单（命令 / 选项 / 退出码），供智能体自述'],
  ['nav version', '输出版本号'],
]

const REGISTRY = new Map()
for (const g of GROUPS) {
  for (const c of g.commands) {
    if (!c.path.startsWith(g.id + ' ')) throw new Error(`命令路径与命令域不匹配：${c.path} ∉ ${g.id}`)
    if (REGISTRY.has(c.path)) throw new Error(`命令路径重复：${c.path}`)
    REGISTRY.set(c.path, c)
  }
}

function projectVersion() {
  try { return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version || '0.0.0' } catch { return '0.0.0' }
}

function errPayload(e) {
  return { code: e.code, message: e.message, hint: e.hint || '', detail: e.detail ?? null }
}

/* ---------------- help 文本 ---------------- */

function commandHelp(cmd) {
  const lines = [`nav ${cmd.path} — ${cmd.summary}`, '', `用法：${cmd.usage || `nav ${cmd.path}`}`]
  if (cmd.mutating) lines.push('', '这是写操作：加 --dry-run 可先预演（只校验并展示将要发生的变化，不落盘 / 不推送）')
  if (cmd.positionals?.length) {
    lines.push('', '参数：', table(['名称', '必填', '说明'], cmd.positionals.map(p => [p.name, p.required ? '是' : '否', p.desc || ''])))
  }
  const flags = Object.entries(cmd.flags || {})
  if (flags.length) {
    lines.push('', '选项：', table(['选项', '说明'], flags.map(([k, f]) => [`--${k}`, f.desc || ''])))
  }
  lines.push('', '全局选项同样可用：nav help 查看')
  return lines.join('\n')
}

function groupHelp(group) {
  return [
    `▸ ${group.label}（${group.id}）— ${group.desc}`,
    '',
    table(['命令', '说明'], group.commands.map(c => [`nav ${c.path}`, c.summary])),
    '',
    '查看单个命令用法：nav help <命令路径>',
  ].join('\n')
}

function globalHelp() {
  const lines = [
    'nav —— nav-v2 运维 CLI（面向智能体调用）',
    '',
    `用法：nav <命令域> <子命令> [选项] [--pretty]     · 版本 ${projectVersion()}`,
    '',
  ]
  for (const g of GROUPS) {
    lines.push(`▸ ${g.label}（${g.id}）— ${g.desc}`, '')
    lines.push(table(['命令', '说明'], g.commands.map(c => [`nav ${c.path}`, c.summary])), '')
  }
  lines.push('▸ 元命令', '', table(['命令', '说明'], META_HELP), '')
  lines.push('▸ 全局选项', '', table(['选项', '说明'], GLOBAL_FLAGS.map(f => [f.name, f.desc])), '')
  lines.push('▸ 退出码', '', table(['码', '名称', '含义'], EXIT_CODES.map(e => [e.code, e.name, e.meaning])), '')
  lines.push('提示：stdout 只有结果文档（默认单行 JSON），进度日志走 stderr；--pretty 转人类可读；机器可读清单用 nav schema。')
  return lines.join('\n')
}

/* ---------------- 元命令 ---------------- */

function buildSchema() {
  return {
    name: 'nav',
    version: projectVersion(),
    root: ROOT,
    usage: 'nav <命令域> <子命令> [选项] [--pretty]',
    groups: GROUPS.map(g => ({
      id: g.id,
      label: g.label,
      desc: g.desc,
      commands: g.commands.map(c => ({
        path: c.path,
        summary: c.summary,
        usage: c.usage || `nav ${c.path}`,
        mutating: Boolean(c.mutating),
        positionals: c.positionals || [],
        flags: Object.entries(c.flags || {}).map(([name, f]) => ({ name: `--${name}`, type: f.type || 'string', desc: f.desc || '' })),
      })),
    })),
    globals: GLOBAL_FLAGS,
    exitCodes: EXIT_CODES,
    output: {
      stdout: '单份结果文档：成功 {ok:true,command,data,meta} / 失败 {ok:false,command,error,data,meta}',
      stderr: '进度、长任务日志、告警提示',
      helpException: 'nav help / 无参数调用输出纯文本，不遵循 JSON 契约',
    },
  }
}

/* ---------------- 主流程 ---------------- */

function emitError(command, err, ctx) {
  emitResult({ command, ok: false, error: errPayload(err), meta: { durationMs: 0 } }, ctx)
  return err.exitCode
}

async function main() {
  const raw = process.argv.slice(2)

  let globals, rest
  try {
    ({ globals, rest } = splitGlobals(raw))
  } catch (e) {
    return emitError('nav', toCliError(e), { pretty: false })
  }
  const ctx = { pretty: globals.pretty, quiet: globals.quiet, dryRun: globals.dryRun, timeoutMs: globals.timeoutMs }

  if (globals.version) {
    process.stdout.write(projectVersion() + '\n')
    return EXIT.OK
  }

  const [head, sub, ...tail] = rest

  if (!head) {
    process.stdout.write(globalHelp() + '\n')
    return EXIT.OK
  }

  if (head === 'version') {
    process.stdout.write(projectVersion() + '\n')
    return EXIT.OK
  }

  if (head === 'schema') {
    emitResult({ command: 'schema', ok: true, data: buildSchema(), meta: {} }, ctx)
    return EXIT.OK
  }

  if (head === 'help') {
    const group = sub ? GROUPS.find(g => g.id === sub) : null
    const target = group && tail[0] ? REGISTRY.get(`${sub} ${tail[0]}`) : null
    if (target) process.stdout.write(commandHelp(target) + '\n')
    else if (group) process.stdout.write(groupHelp(group) + '\n')
    else process.stdout.write(globalHelp() + '\n')
    return EXIT.OK
  }

  const group = GROUPS.find(g => g.id === head)
  if (!group) {
    const hint = `可用命令域：${GROUPS.map(g => g.id).join('、')}；元命令：help、schema、version`
    return emitError('nav', new CliError(`未知命令域：${head}`, { code: 'USAGE', exitCode: EXIT.USAGE, hint }), ctx)
  }
  if (!sub) {
    process.stdout.write(groupHelp(group) + '\n')
    return EXIT.OK
  }

  const cmd = REGISTRY.get(`${head} ${sub}`)
  if (!cmd) {
    const hint = `该命令域可用：${group.commands.map(c => c.path.split(' ')[1]).join('、')}`
    return emitError(`${head} ${sub}`, new CliError(`未知子命令：${head} ${sub}`, { code: 'USAGE', exitCode: EXIT.USAGE, hint }), ctx)
  }

  if (globals.help) {
    process.stdout.write(commandHelp(cmd) + '\n')
    return EXIT.OK
  }

  if (ctx.dryRun && !cmd.mutating) note(`提示：nav ${cmd.path} 是只读命令，--dry-run 无效果`, ctx)

  const started = Date.now()
  let res
  try {
    res = await cmd.run(tail, ctx)
  } catch (e) {
    const err = toCliError(e)
    emitResult({ command: cmd.path, ok: false, error: errPayload(err), meta: { durationMs: Date.now() - started } }, ctx)
    return err.exitCode
  }

  const ok = res?.ok !== undefined ? Boolean(res.ok) : true
  emitResult({
    command: cmd.path,
    ok,
    data: res?.data ?? null,
    error: res?.error ?? null,
    meta: { durationMs: Date.now() - started, ...(res?.meta || {}) },
    render: res?.render,
  }, ctx)
  return res?.exitCode !== undefined ? res.exitCode : (ok ? EXIT.OK : EXIT.REJECTED)
}

main()
  .then(code => { process.exitCode = code })
  .catch(e => {
    const err = toCliError(e)
    emitResult({ command: 'nav', ok: false, error: errPayload(err), meta: {} }, { pretty: false })
    process.exitCode = err.exitCode
  })