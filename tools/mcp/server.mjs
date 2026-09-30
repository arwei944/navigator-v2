#!/usr/bin/env node
/**
 * nav-mcp —— 把 nav CLI 的 28 条命令包成智能体原生工具（MCP，stdio 传输）。
 *
 * 工具数刻意收敛到 5 个：社区实测工具数超过 30–50 后模型选择准确率明显下降，
 * 而工具定义本身也占上下文。因此按「命令域」做网关（nav_sites / nav_publish /
 * nav_git / nav_data），再加一个聚合读工具 nav_status 作为智能体的「第一问」。
 *
 * 语义不重复实现：参数翻译与结果信封都在 lib/bridge.mjs，业务逻辑仍走 tools/cli/commands/*。
 * 写操作默认只预演 —— 必须显式 confirm: true 才真跑（见 bridge.mjs 的 WRITE_REASON）。
 *
 * 用法（作为 MCP server 由客户端拉起，一般不手工执行）：
 *   node tools/mcp/server.mjs
 *
 * 注意：stdout 是 JSON-RPC 通道，任何调试输出必须走 stderr。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { ROOT } from '../console/lib/env.mjs'
import { invoke, invokeGated, toToolText, isToolError } from './lib/bridge.mjs'

function projectVersion() {
  try { return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version || '0.0.0' } catch { return '0.0.0' }
}

const READ_ONLY = { readOnlyHint: true, idempotentHint: true }
const WRITES = { readOnlyHint: false, destructiveHint: true, idempotentHint: false }

/** 统一的工具回调包装：结果一律 JSON 文本，失败标 isError */
function reply(res) {
  return {
    content: [{ type: 'text', text: toToolText(res) }],
    isError: isToolError(res),
  }
}

const server = new McpServer({ name: 'nav', version: projectVersion() })

/* ---------------- nav_status：智能体的「第一问」 ---------------- */

server.registerTool(
  'nav_status',
  {
    title: '环境与版本总览',
    description: '一次拿到项目根目录、环境自检结果、本地/云端站点数与版本、热更新是否就绪、当前分支与改动数。开始任何操作前先调这个。',
    inputSchema: {},
    annotations: READ_ONLY,
  },
  async () => {
    const [doctor, publish, git] = await Promise.all([
      invoke('data doctor', { quiet: true }),
      invoke('publish status', { quiet: true }),
      invoke('git status', { quiet: true }),
    ])
    const env = doctor.data
    const st = publish.data
    const gs = git.data
    return reply({
      ok: doctor.ok && publish.ok,
      command: 'nav_status',
      data: {
        root: env?.root || ROOT,
        env: env ? { ok: env.ok, pass: env.pass, warn: env.warn, fail: env.fail, checks: env.checks } : null,
        cloud: st
          ? {
            siteUrl: st.siteUrl,
            localCount: st.local?.count ?? null,
            localVersion: st.local?.version || '',
            cloudCount: st.cloud?.ok ? st.cloud.count : null,
            cloudVersion: st.cloud?.version ?? null,
            cloudError: st.cloud?.ok ? null : st.cloud?.error || '',
            converged: Boolean(st.converged),
            hotUpdateReady: Boolean(st.hotUpdateReady),
            vercelApiAvailable: Boolean(st.vercel?.apiAvailable),
            head: st.local?.head || null,
            lastPublish: st.lastPublish ? { id: st.lastPublish.id, status: st.lastPublish.status, startedAt: st.lastPublish.startedAt, exitCode: st.lastPublish.exitCode } : null,
          }
          : null,
        workspace: gs
          ? { branch: gs.branch, upstream: gs.upstream, ahead: gs.ahead, behind: gs.behind, counts: gs.counts }
          : null,
      },
      error: doctor.ok ? null : doctor.error,
      exitCode: doctor.exitCode,
      meta: {},
    })
  },
)

/* ---------------- nav_sites：站点域网关 ---------------- */

const SITES_ACTIONS = ['list', 'get', 'add', 'update', 'remove', 'categories', 'meta', 'icon', 'check']

const SITES_DOC = [
  '站点数据增删改查与探活。action 取值：',
  '- list        列出/搜索站点（可选 q 关键字、category 分类、limit 条数）',
  '- get         读单个站点完整字段（需 id）',
  '- update      改站点字段（需 id，至少给一个待改字段）',
  '- remove      删除站点（需 id）',
  '- categories  列出分类树与各分类站点数（新增前用它确认 category）',
  '- meta        抓取目标网址的标题/描述/图标/分类建议（需 url，只读）',
  '- check       批量探活（可选 ids/limit/timeout/concurrency/strict）',
  '- add         新增站点（需 url/name/desc/category）',
  '- icon        抓取并落盘站点图标（需 id，可选 faviconUrl）',
  '',
  '写操作（add / update / remove / icon）默认只预演并返回将要发生的改动；',
  '确认无误后带 confirm: true 重新调用才会真正写入。',
].join('\n')

const sitesSchema = {
  action: z.enum(SITES_ACTIONS).describe('要执行的动作'),
  id: z.string().optional().describe('站点 ID，如 dt33'),
  url: z.string().optional().describe('站点地址或域名'),
  name: z.string().optional().describe('站点名称'),
  desc: z.string().optional().describe('站点描述'),
  category: z.string().optional().describe('分类 ID；list 时作为过滤条件'),
  color: z.string().optional().describe('卡片主色，如 #3b82f6'),
  initial: z.string().optional().describe('卡片首字母'),
  icon: z.string().optional().describe('图标相对路径，如 icons/dt33.png'),
  sortOrder: z.number().optional().describe('排序权重'),
  faviconUrl: z.string().optional().describe('显式指定图标地址，跳过页面声明探测'),
  q: z.string().optional().describe('list 的关键字：匹配名称/描述/域名/精确 ID'),
  limit: z.number().optional().describe('list / check 的条数上限'),
  ids: z.string().optional().describe('check 只检查这些站点，逗号分隔'),
  timeout: z.number().optional().describe('check 单站点超时秒数，默认 15'),
  concurrency: z.number().optional().describe('check 并发数，默认 12'),
  strict: z.boolean().optional().describe('check 时存在需处理站点则返回 ok=false'),
  confirm: z.boolean().optional().describe('写操作必须显式传 true 才真正执行'),
}

server.registerTool(
  'nav_sites',
  { title: '站点管理', description: SITES_DOC, inputSchema: sitesSchema, annotations: WRITES },
  async (args) => {
    const { action } = args
    const num = v => (v === undefined ? undefined : String(v))
    const map = {
      list: { path: 'sites list', flags: { q: args.q, category: args.category, limit: num(args.limit) } },
      get: { path: 'sites get', positionals: [args.id] },
      add: {
        path: 'sites add',
        flags: { url: args.url, name: args.name, desc: args.desc, category: args.category, color: args.color, initial: args.initial, icon: args.icon },
      },
      update: {
        path: 'sites update',
        positionals: [args.id],
        flags: {
          url: args.url, name: args.name, desc: args.desc, category: args.category,
          color: args.color, initial: args.initial, icon: args.icon,
          'sort-order': num(args.sortOrder),
        },
      },
      remove: { path: 'sites remove', positionals: [args.id] },
      categories: { path: 'sites categories' },
      meta: { path: 'sites meta', positionals: [args.url] },
      icon: { path: 'sites icon', positionals: [args.id], flags: { 'favicon-url': args.faviconUrl } },
      check: {
        path: 'sites check',
        flags: {
          ids: args.ids, limit: num(args.limit), timeout: num(args.timeout),
          concurrency: num(args.concurrency), strict: args.strict,
        },
      },
    }
    const plan = map[action]
    if (!plan) return reply({ ok: false, command: 'nav_sites', data: null, error: { code: 'USAGE', message: `未知 action：${action}`, hint: `可用：${SITES_ACTIONS.join('、')}` }, exitCode: 2, meta: {} })
    const res = await invokeGated(plan.path, { positionals: plan.positionals, flags: plan.flags }, { confirm: args.confirm })
    return reply(res)
  },
)

/* ---------------- nav_publish：发布与云端 ---------------- */

const PUBLISH_ACTIONS = ['status', 'run', 'verify', 'sync-data', 'deployments']

const PUBLISH_DOC = [
  '发布与云端一致性。action 取值：',
  '- status       本地/云端版本对比与热更新就绪状态（只读）',
  '- verify       轮询云端直到与本地站点数一致（只读，可选 expect/tries）',
  '- deployments  最近的 Vercel 部署（只读，需 VERCEL_TOKEN，可选 limit）',
  '- sync-data    只同步站点数据：提交 → 推送 → 备份 → 门禁 → 热更新 → 验证',
  '- run          全量一键发布：检查改动 → 提交 → 推送 → 备份 → 门禁 → 构建 → 部署 → 热更新 → 验证',
  '',
  '写操作（run / sync-data）默认只返回执行计划与阻断原因（blockers）；',
  '确认无误后带 confirm: true 重新调用才会真正执行。',
].join('\n')

const publishSchema = {
  action: z.enum(PUBLISH_ACTIONS).describe('要执行的动作'),
  message: z.string().optional().describe('提交消息；存在已暂存改动时必填'),
  skipBuild: z.boolean().optional().describe('run 时跳过前端构建，仅热更新云端数据'),
  noPush: z.boolean().optional().describe('跳过 git push（本地演练）'),
  noCommit: z.boolean().optional().describe('sync-data 时不提交，仅热更新云端'),
  expect: z.number().optional().describe('verify 期望站点数，默认取本地条数'),
  tries: z.number().optional().describe('verify 最多轮询次数，默认 6'),
  limit: z.number().optional().describe('deployments 条数，默认 8'),
  confirm: z.boolean().optional().describe('写操作必须显式传 true 才真正执行'),
}

server.registerTool(
  'nav_publish',
  { title: '发布与云端', description: PUBLISH_DOC, inputSchema: publishSchema, annotations: WRITES },
  async (args) => {
    const { action } = args
    const num = v => (v === undefined ? undefined : String(v))
    const map = {
      status: { path: 'publish status' },
      run: { path: 'publish run', flags: { message: args.message, 'skip-build': args.skipBuild, 'no-push': args.noPush } },
      verify: { path: 'publish verify', flags: { expect: num(args.expect), tries: num(args.tries) } },
      'sync-data': { path: 'publish sync-data', flags: { message: args.message, 'no-commit': args.noCommit, 'no-push': args.noPush } },
      deployments: { path: 'publish deployments', flags: { limit: num(args.limit) } },
    }
    const plan = map[action]
    if (!plan) return reply({ ok: false, command: 'nav_publish', data: null, error: { code: 'USAGE', message: `未知 action：${action}`, hint: `可用：${PUBLISH_ACTIONS.join('、')}` }, exitCode: 2, meta: {} })
    const res = await invokeGated(plan.path, { flags: plan.flags }, { confirm: args.confirm })
    return reply(res)
  },
)

/* ---------------- nav_git：Git 工作流 ---------------- */

const GIT_ACTIONS = ['status', 'diff', 'hunks', 'log', 'suggest', 'stage', 'unstage', 'stage-hunks', 'unstage-hunks', 'commit', 'push', 'remote']

const GIT_DOC = [
  'Git 工作流。action 取值：',
  '- status         工作区状态：分支、领先/落后、文件列表（只读）',
  '- diff           单文件 diff（需 path，可选 staged；未跟踪文件按新增构造）',
  '- hunks          列出单个文件的 hunk 边界与序号（需 path，可选 staged；只读）',
  '- log            提交历史（可选 limit，默认 20）',
  '- suggest        按当前改动生成规范提交消息（只读，建议在 commit 前调用）',
  '- remote         origin 地址与上游分支（只读）',
  '- stage          暂存整个文件（需 paths）',
  '- unstage        取消暂存整个文件（需 paths）',
  '- stage-hunks    只暂存文件中的指定块（需 path + hunks，其余块留在工作区）',
  '- unstage-hunks  只取消暂存文件中的指定块（需 path + hunks，其余块留在索引）',
  '- commit         创建提交（需 message，可选 paths 只提交这些文件）',
  '- push           推送到 origin（可选 branch）',
  '',
  '分块操作前先调 hunks 拿序号：0 起，逗号分隔传给 hunks 参数。',
  '写操作（stage / unstage / stage-hunks / unstage-hunks / commit / push）默认只预演；',
  '确认后带 confirm: true 才真正执行。',
].join('\n')

const gitSchema = {
  action: z.enum(GIT_ACTIONS).describe('要执行的动作'),
  path: z.string().optional().describe('diff / hunks / stage-hunks / unstage-hunks 的文件路径（仓库内相对路径）'),
  staged: z.boolean().optional().describe('diff / hunks 查看已暂存侧（--cached）'),
  hunks: z.array(z.number().int().min(0)).optional().describe('stage-hunks / unstage-hunks 的 hunk 序号（0 起，先调 hunks 获取）'),
  limit: z.number().optional().describe('log 条数，默认 20'),
  paths: z.array(z.string()).optional().describe('stage / unstage 的文件列表；commit 时限定提交范围'),
  message: z.string().optional().describe('commit 消息'),
  branch: z.string().optional().describe('push 的分支，默认当前分支'),
  confirm: z.boolean().optional().describe('写操作必须显式传 true 才真正执行'),
}

server.registerTool(
  'nav_git',
  { title: 'Git 工作流', description: GIT_DOC, inputSchema: gitSchema, annotations: WRITES },
  async (args) => {
    const { action } = args
    const num = v => (v === undefined ? undefined : String(v))
    const map = {
      status: { path: 'git status' },
      diff: { path: 'git diff', positionals: [args.path], flags: { staged: args.staged } },
      hunks: { path: 'git hunks', positionals: [args.path], flags: { staged: args.staged } },
      log: { path: 'git log', flags: { limit: num(args.limit) } },
      suggest: { path: 'git suggest' },
      stage: { path: 'git stage', positionals: args.paths },
      unstage: { path: 'git unstage', positionals: args.paths },
      'stage-hunks': { path: 'git stage-hunks', positionals: [args.path], flags: { hunks: args.hunks?.join(',') } },
      'unstage-hunks': { path: 'git unstage-hunks', positionals: [args.path], flags: { hunks: args.hunks?.join(',') } },
      commit: { path: 'git commit', flags: { message: args.message, paths: args.paths?.join(',') } },
      push: { path: 'git push', flags: { branch: args.branch } },
      remote: { path: 'git remote' },
    }
    const plan = map[action]
    if (!plan) return reply({ ok: false, command: 'nav_git', data: null, error: { code: 'USAGE', message: `未知 action：${action}`, hint: `可用：${GIT_ACTIONS.join('、')}` }, exitCode: 2, meta: {} })
    const res = await invokeGated(plan.path, { positionals: plan.positionals, flags: plan.flags }, { confirm: args.confirm })
    return reply(res)
  },
)

/* ---------------- nav_data：数据体检与环境 ---------------- */

const DATA_ACTIONS = ['stats', 'integrity', 'diff', 'validate', 'doctor']

const DATA_DOC = [
  '数据体检与环境自检（全部只读）。action 取值：',
  '- stats      站点总数与分类分布（含未登记分类告警）',
  '- integrity  完整性体检：图标/配色/描述缺失、sortOrder 重复与空洞、重复域名',
  '- diff       站点数据工作区 vs HEAD 的结构化差异（新增/移除/修改了哪些站点与字段）',
  '- validate   站点数据 schema 门禁（与 npm run validate、发布门禁、CI 同一脚本）',
  '- doctor     环境自检：Node/git/curl/密钥/数据文件/图标目录，定位「某条命令为什么跑不动」',
].join('\n')

server.registerTool(
  'nav_data',
  {
    title: '数据体检与环境',
    description: DATA_DOC,
    inputSchema: { action: z.enum(DATA_ACTIONS).describe('要执行的动作') },
    annotations: READ_ONLY,
  },
  async (args) => {
    const { action } = args
    if (!DATA_ACTIONS.includes(action)) {
      return reply({ ok: false, command: 'nav_data', data: null, error: { code: 'USAGE', message: `未知 action：${action}`, hint: `可用：${DATA_ACTIONS.join('、')}` }, exitCode: 2, meta: {} })
    }
    return reply(await invoke(`data ${action}`, {}))
  },
)

/* ---------------- 启动 ---------------- */

const transport = new StdioServerTransport()
await server.connect(transport)