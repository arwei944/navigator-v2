/**
 * 站点管理命令：复用 tools/console/lib/sites.mjs 与 data.mjs，
 * 与控制台「站点」面板、scripts/*.mjs 共用同一套业务逻辑，避免三处实现漂移。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as sites from '../../console/lib/sites.mjs'
import * as data from '../../console/lib/data.mjs'
import { CliError, EXIT, buildOptions, dryRunResult, note, parseCommandArgs, requirePositional, table } from '../lib/core.mjs'

const pExecFile = promisify(execFile)

/* ---------------- 探活 ---------------- */

/** 与 scripts/check-sites.mjs 同口径：限流/反爬/方法误用/鉴权算「可忽略」，站点实际可用 */
const IGNORABLE = new Set(['429', '405', '403', '401'])

function verdictOf(code) {
  if (code === 'ERR' || code === '000') return 'down'
  const n = Number(code)
  if (n >= 400) return IGNORABLE.has(code) ? 'limited' : 'down'
  return 'ok'
}

/** 先 HEAD 再回落 GET：部分站点不支持 HEAD，只发 HEAD 会误判为 000 */
async function probe(url, timeout) {
  const target = url.includes('://') ? url : 'https://' + url
  const call = args => pExecFile('curl.exe', args, { encoding: 'utf8', timeout: (timeout + 5) * 1000, windowsHide: true })
  try {
    const head = await call(['-s', '-o', 'NUL', '-w', '%{http_code}', '-I', '-L', '--max-time', String(timeout), target])
    let code = head.stdout.trim()
    if (!code || code === '000') {
      const get = await call(['-s', '-o', 'NUL', '-w', '%{http_code}', '-L', '--max-time', String(timeout), target])
      code = get.stdout.trim()
    }
    return code || 'ERR'
  } catch {
    return 'ERR'
  }
}

/* ---------------- 命令定义 ---------------- */

const listCmd = {
  path: 'sites list',
  summary: '列出站点，可按关键字（名称/描述/域名/ID）与分类过滤',
  usage: 'nav sites list [--q <关键字>] [--category <分类ID>] [--limit <n>]',
  flags: {
    q: { desc: '关键字：匹配名称 / 描述 / 域名 / 精确 ID' },
    category: { desc: '分类 ID（用 nav sites categories 查询）' },
    limit: { desc: '只返回前 N 条（默认全量）' },
  },
  async run(argv) {
    const { values } = parseCommandArgs(argv, buildOptions(listCmd.flags), { usage: listCmd.usage })
    const r = sites.list({ q: values.q || '', category: values.category || '' })
    const limit = values.limit ? Number(values.limit) : 0
    const items = limit > 0 ? r.sites.slice(0, limit) : r.sites
    return {
      data: { total: r.total, matched: r.matched, returned: items.length, sites: items },
      render: d => `${d.matched}/${d.total} 条匹配，返回 ${d.returned} 条\n\n` + table(
        ['ID', '名称', '域名', '分类'],
        d.sites.map(s => [s.id, s.name, s.url, s.categoryLabel || s.categoryId]),
      ),
    }
  },
}

const getCmd = {
  path: 'sites get',
  summary: '读取单个站点的完整字段',
  usage: 'nav sites get <id>',
  positionals: [{ name: 'id', required: true, desc: '站点 ID' }],
  async run(argv) {
    const { positionals } = parseCommandArgs(argv, {}, { allowPositionals: true, usage: getCmd.usage })
    const id = requirePositional(positionals, 0, 'id', getCmd.usage)
    return { data: sites.getSite(id) }
  },
}

const addCmd = {
  path: 'sites add',
  summary: '新增站点（写入 api/sites-data.json，域名去重，ID/sortOrder 自动递增）',
  usage: 'nav sites add --url <域名> --name <名称> --desc <描述> --category <分类ID> [--color #rrggbb] [--initial X] [--icon <路径>]',
  mutating: true,
  flags: {
    url: { desc: '站点地址（只保留域名，必填）' },
    name: { desc: '站点名称（必填）' },
    desc: { desc: '站点描述（必填）' },
    category: { desc: '分类 ID（必填，需已登记）' },
    color: { desc: '卡片主色，默认取分类色' },
    initial: { desc: '卡片首字母，默认取名称首字母' },
    icon: { desc: '图标相对路径，如 icons/xx.png（通常交给 nav sites icon 抓取）' },
  },
  async run(argv, ctx) {
    const { values } = parseCommandArgs(argv, buildOptions(addCmd.flags), { usage: addCmd.usage })
    const created = sites.addSite({
      url: values.url,
      name: values.name,
      desc: values.desc,
      categoryId: values.category,
      color: values.color,
      initial: values.initial,
      icon: values.icon,
    }, { dryRun: ctx.dryRun })
    if (ctx.dryRun) return dryRunResult({ wouldAdd: created, totalAfter: sites.loadSites().length + 1 })
    return { data: { created, total: sites.loadSites().length } }
  },
}

const updateCmd = {
  path: 'sites update',
  summary: '修改站点字段（仅传入的字段会被改动）',
  usage: 'nav sites update <id> [--url <域名>] [--name <名称>] [--desc <描述>] [--category <分类ID>] [--color #rrggbb] [--initial X] [--icon <路径>] [--sort-order <n>]',
  mutating: true,
  positionals: [{ name: 'id', required: true, desc: '站点 ID' }],
  flags: {
    url: { desc: '新域名（会做域名去重检查）' },
    name: { desc: '新名称' },
    desc: { desc: '新描述' },
    category: { desc: '新分类 ID' },
    color: { desc: '新主色' },
    initial: { desc: '新首字母' },
    icon: { desc: '新图标路径' },
    'sort-order': { desc: '排序权重（数字）' },
  },
  async run(argv, ctx) {
    const { values, positionals } = parseCommandArgs(argv, buildOptions(updateCmd.flags), { allowPositionals: true, usage: updateCmd.usage })
    const id = requirePositional(positionals, 0, 'id', updateCmd.usage)
    const patch = {}
    if (values.url !== undefined) patch.url = values.url
    if (values.name !== undefined) patch.name = values.name
    if (values.desc !== undefined) patch.desc = values.desc
    if (values.category !== undefined) patch.categoryId = values.category
    if (values.color !== undefined) patch.color = values.color
    if (values.initial !== undefined) patch.initial = values.initial
    if (values.icon !== undefined) patch.icon = values.icon
    if (values['sort-order'] !== undefined) patch.sortOrder = values['sort-order']
    if (Object.keys(patch).length === 0) {
      throw new CliError('未提供任何要修改的字段', { code: 'USAGE', exitCode: EXIT.USAGE, hint: `用法：${updateCmd.usage}` })
    }
    const fields = Object.keys(patch)
    if (ctx.dryRun) {
      const before = sites.getSite(id)
      return dryRunResult({ id, fields, before, after: sites.updateSite(id, patch, { dryRun: true }) })
    }
    return { data: { updated: sites.updateSite(id, patch), fields } }
  },
}

const removeCmd = {
  path: 'sites remove',
  summary: '删除站点（返回被删除的条目，可从 git 历史恢复）',
  usage: 'nav sites remove <id>',
  mutating: true,
  positionals: [{ name: 'id', required: true, desc: '站点 ID' }],
  async run(argv, ctx) {
    const { positionals } = parseCommandArgs(argv, {}, { allowPositionals: true, usage: removeCmd.usage })
    const id = requirePositional(positionals, 0, 'id', removeCmd.usage)
    const removed = sites.removeSite(id, { dryRun: ctx.dryRun })
    if (ctx.dryRun) return dryRunResult({ wouldRemove: removed, totalAfter: sites.loadSites().length - 1 })
    return { data: { removed, total: sites.loadSites().length } }
  },
}

const categoriesCmd = {
  path: 'sites categories',
  summary: '列出分类树与各分类站点数（新增站点时用于选 --category）',
  usage: 'nav sites categories',
  async run() {
    const groups = data.categoryGroups()
    const counts = new Map()
    for (const s of data.readSites()) counts.set(s.categoryId, (counts.get(s.categoryId) || 0) + 1)
    const out = groups.map(g => ({
      group: g.id,
      label: g.label,
      categories: g.categories.map(c => ({ id: c.id, label: c.label, color: c.color, count: counts.get(c.id) || 0 })),
    }))
    return {
      data: { groups: out, total: out.reduce((n, g) => n + g.categories.length, 0) },
      render: d => d.groups.map(g => `▸ ${g.label}\n` + table(['ID', '分类', '站点数'], g.categories.map(c => [c.id, c.label, c.count]))).join('\n\n'),
    }
  },
}

const metaCmd = {
  path: 'sites meta',
  summary: '抓取目标站点的标题/描述/图标地址，并给出分类建议（只读，走系统代理）',
  usage: 'nav sites meta <url>',
  positionals: [{ name: 'url', required: true, desc: '目标站点地址或域名' }],
  async run(argv) {
    const { positionals } = parseCommandArgs(argv, {}, { allowPositionals: true, usage: metaCmd.usage })
    const url = requirePositional(positionals, 0, 'url', metaCmd.usage)
    return { data: await sites.fetchMeta(url) }
  },
}

const iconCmd = {
  path: 'sites icon',
  summary: '抓取并落盘站点图标（public/icons），同时回写数据文件的 icon 字段',
  usage: 'nav sites icon <id> [--favicon-url <url>]',
  mutating: true,
  positionals: [{ name: 'id', required: true, desc: '站点 ID' }],
  flags: { 'favicon-url': { desc: '显式指定图标地址，跳过页面声明探测' } },
  async run(argv, ctx) {
    const { values, positionals } = parseCommandArgs(argv, buildOptions(iconCmd.flags), { allowPositionals: true, usage: iconCmd.usage })
    const id = requirePositional(positionals, 0, 'id', iconCmd.usage)
    const r = await sites.downloadIcon(id, { faviconUrl: values['favicon-url'] || '', dryRun: ctx.dryRun })
    if (ctx.dryRun) return dryRunResult({ id, ...r, note: '实际会依次尝试这些来源，落盘 public/icons/<id>.<ext> 并回写 icon 字段' })
    return { data: { id, ...r } }
  },
}

const checkCmd = {
  path: 'sites check',
  summary: '批量探活：区分「正常 / 可忽略（限流反爬）/ 需处理」，--strict 时存在需处理站点则退出码 5',
  usage: 'nav sites check [--ids a,b] [--limit <n>] [--timeout <秒>] [--concurrency <n>] [--strict]',
  flags: {
    ids: { desc: '只检查这些站点，逗号分隔' },
    limit: { desc: '只检查前 N 个（默认全量 298 个）' },
    timeout: { desc: '单站点超时秒数，默认 15' },
    concurrency: { desc: '并发数，默认 12' },
    strict: { type: 'boolean', desc: '存在需处理站点时以退出码 5 结束（供 CI/智能体门禁）' },
  },
  async run(argv, ctx) {
    const { values } = parseCommandArgs(argv, buildOptions(checkCmd.flags), { usage: checkCmd.usage })
    const all = data.readSites()
    let targets = all
    if (values.ids) {
      const want = String(values.ids).split(',').map(s => s.trim()).filter(Boolean)
      const missing = want.filter(id => !all.some(s => s.id === id))
      if (missing.length) {
        throw new CliError(`站点不存在：${missing.join(', ')}`, { code: 'REJECTED', exitCode: EXIT.REJECTED, hint: '用 nav sites list 查看全部 ID' })
      }
      const set = new Set(want)
      targets = all.filter(s => set.has(s.id))
    }
    if (values.limit !== undefined) targets = targets.slice(0, Number(values.limit))
    if (targets.length === 0) throw new CliError('没有可检查的站点', { code: 'REJECTED', exitCode: EXIT.REJECTED })

    const timeout = values.timeout !== undefined ? Number(values.timeout) : 15
    const conc = values.concurrency !== undefined ? Number(values.concurrency) : 12
    const results = []
    for (let i = 0; i < targets.length; i += conc) {
      const chunk = targets.slice(i, i + conc)
      const codes = await Promise.all(chunk.map(s => probe(s.url, timeout)))
      chunk.forEach((s, k) => results.push({ id: s.id, name: s.name, url: s.url, code: codes[k], verdict: verdictOf(codes[k]) }))
      note(`已检查 ${results.length}/${targets.length}`, ctx)
    }

    const down = results.filter(r => r.verdict === 'down')
    const limited = results.filter(r => r.verdict === 'limited')
    const healthy = results.length - down.length - limited.length
    const strictFail = Boolean(values.strict) && down.length > 0
    return {
      ok: !strictFail,
      exitCode: strictFail ? EXIT.REJECTED : EXIT.OK,
      error: strictFail ? { code: 'UNHEALTHY', message: `${down.length} 个站点需处理`, hint: '详见 data.needAttention' } : null,
      data: {
        checked: results.length,
        healthy,
        limited: limited.length,
        down: down.length,
        needAttention: down,
        results,
      },
      render: d => `${d.checked} 个站点：正常 ${d.healthy} / 可忽略 ${d.limited} / 需处理 ${d.down}\n\n` + table(
        ['ID', '状态', '判定', '名称'],
        d.results.map(r => [r.id, r.code, r.verdict, r.name]),
      ),
    }
  },
}

export const commands = [listCmd, getCmd, addCmd, updateCmd, removeCmd, categoriesCmd, metaCmd, iconCmd, checkCmd]