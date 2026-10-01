/**
 * 命令注册表：命令域 → 命令列表 → 命令定义。
 *
 * 这里是「有哪些命令」的唯一真相源，两个消费方都从这里取：
 *   - tools/cli/nav.mjs        命令行入口（help / schema / 分发）
 *   - tools/mcp/server.mjs     MCP 服务（把命令映射成智能体工具）
 *
 * 命令定义本身（path / summary / usage / flags / positionals / mutating / run）
 * 由 tools/cli/commands/*.mjs 提供，业务逻辑仍复用 tools/console/lib/*。
 */
import { commands as siteCommands } from '../commands/sites.mjs'
import { commands as publishCommands } from '../commands/publish.mjs'
import { commands as snapshotCommands } from '../commands/snapshots.mjs'
import { commands as gitCommands } from '../commands/git.mjs'
import { commands as dataCommands } from '../commands/data.mjs'
import { commands as opsCommands } from '../commands/ops.mjs'

export const GROUPS = [
  { id: 'sites', label: '站点管理', desc: '站点数据增删改查、分类、元信息抓取、图标、批量操作、批量探活', commands: siteCommands },
  { id: 'publish', label: '发布与云端', desc: '预检放行、一键发布、云端快照与回滚、数据同步、部署记录', commands: [...publishCommands, ...snapshotCommands] },
  { id: 'ops', label: '运维事件与通知', desc: '发布历史、通知中心（未读 / Webhook）、可用性巡检', commands: opsCommands },
  { id: 'git', label: 'Git 工作流', desc: '状态、差异、历史、提交消息建议、暂存、提交、推送', commands: gitCommands },
  { id: 'data', label: '数据体检与环境', desc: '统计、完整性体检、改动对比、schema 门禁、环境自检', commands: dataCommands },
]

export const REGISTRY = new Map()
for (const g of GROUPS) {
  for (const c of g.commands) {
    if (!c.path.startsWith(g.id + ' ')) throw new Error(`命令路径与命令域不匹配：${c.path} ∉ ${g.id}`)
    if (REGISTRY.has(c.path)) throw new Error(`命令路径重复：${c.path}`)
    REGISTRY.set(c.path, c)
  }
}

/** 按路径取命令定义，未登记返回 null */
export function findCommand(path) {
  return REGISTRY.get(String(path || '').trim()) || null
}

/** 某个命令域下的全部命令 */
export function groupOf(id) {
  return GROUPS.find(g => g.id === id) || null
}

/** 扁平命令清单（含域 id），供 MCP 工具描述与文档生成 */
export function commandList() {
  return GROUPS.flatMap(g => g.commands.map(c => ({
    group: g.id,
    groupLabel: g.label,
    path: c.path,
    action: c.path.slice(g.id.length + 1),
    summary: c.summary,
    usage: c.usage || `nav ${c.path}`,
    mutating: Boolean(c.mutating),
    positionals: c.positionals || [],
    flags: Object.entries(c.flags || {}).map(([name, f]) => ({
      name, type: f.type || 'string', desc: f.desc || '',
    })),
  })))
}