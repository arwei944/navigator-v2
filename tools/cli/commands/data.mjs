/**
 * 数据体检命令：复用 lib/data.mjs（只读体检）与 lib/changes.mjs（工作区 vs HEAD 对比），
 * schema 门禁直接复用 scripts/validate-data.mjs，保证与发布门禁、CI 完全同口径。
 */
import { execFile } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ROOT, envSummary } from '../../console/lib/env.mjs'
import * as data from '../../console/lib/data.mjs'
import * as changes from '../../console/lib/changes.mjs'
import * as git from '../../console/lib/git.mjs'
import * as audit from '../../console/lib/audit.mjs'
import { EXIT, buildOptions, parseCommandArgs, table } from '../lib/core.mjs'

const pExecFile = promisify(execFile)

const statsCmd = {
  path: 'data stats',
  summary: '站点总数与分类分布（含未登记分类告警）',
  usage: 'nav data stats',
  async run() {
    const r = data.report()
    return {
      data: {
        file: r.file,
        total: r.total,
        categories: r.categories,
        unknownCategories: r.unknownCategories,
        distribution: r.distribution,
      },
      render: d => `${d.total} 个站点 · ${d.categories} 个分类${d.unknownCategories.length ? ` · ⚠️ 未登记分类：${d.unknownCategories.join(', ')}` : ''}\n\n` + table(
        ['分类ID', '分类', '站点数'],
        d.distribution.map(x => [x.id, x.label, x.count]),
      ),
    }
  },
}

const integrityCmd = {
  path: 'data integrity',
  summary: '完整性体检：图标/配色/描述缺失、sortOrder 重复与空洞、重复域名',
  usage: 'nav data integrity',
  async run() {
    const r = data.report()
    const issues = r.missingIcon.length + r.missingColor.length + r.missingDesc.length + r.dupSortOrder.length + r.holes.length + r.dupDomains.length
    return {
      data: { ...r, issueCount: issues, clean: issues === 0 },
      render: d => [
        `${d.total} 个站点 · ${d.clean ? '✅ 无问题' : `⚠️ ${d.issueCount} 项待处理`}`,
        '',
        table(['检查项', '数量', '明细'], [
          ['图标缺失', d.missingIcon.length, d.missingIcon.join(' ')],
          ['配色缺失', d.missingColor.length, d.missingColor.join(' ')],
          ['描述缺失', d.missingDesc.length, d.missingDesc.join(' ')],
          ['sortOrder 重复', d.dupSortOrder.length, d.dupSortOrder.join(' ')],
          ['sortOrder 空洞', d.holes.length, d.holes.length > 30 ? `${d.holes.slice(0, 30).join(' ')} …` : d.holes.join(' ')],
          ['重复域名', d.dupDomains.length, d.dupDomains.map(x => `${x.domain}(${x.ids.join('/')})`).join(' ')],
        ]),
      ].join('\n'),
    }
  },
}

const diffCmd = {
  path: 'data diff',
  summary: '站点数据工作区 vs HEAD 的结构化差异（新增/移除/修改了哪些站点与字段）',
  usage: 'nav data diff',
  async run() {
    const r = await changes.sitesSummary()
    if (!r) return { data: { changed: false, reason: '读取 api/sites-data.json 失败' } }
    return {
      data: r,
      render: d => [
        `${d.changed ? '有差异' : '与 HEAD 一致'}：HEAD ${d.headCount} → 工作区 ${d.currentCount}`,
        `新增 ${d.diff.added.length} / 移除 ${d.diff.removed.length} / 修改 ${d.diff.modified.length}`,
        d.diff.added.length ? `\n新增：${d.diff.added.map(s => `${s.id} ${s.name}`).join('、')}` : '',
        d.diff.removed.length ? `\n移除：${d.diff.removed.map(s => `${s.id} ${s.name}`).join('、')}` : '',
        d.diff.modified.length ? `\n修改：${d.diff.modified.map(m => `${m.id}(${m.labels.join('/')})`).join('、')}` : '',
      ].filter(Boolean).join('\n'),
    }
  },
}

const validateCmd = {
  path: 'data validate',
  summary: '站点数据 schema 门禁（与 npm run validate / 发布门禁 / CI 同一脚本）',
  usage: 'nav data validate',
  async run() {
    const script = join(ROOT, 'scripts', 'validate-data.mjs')
    try {
      const { stdout, stderr } = await pExecFile(process.execPath, [script], { cwd: ROOT, encoding: 'utf8', windowsHide: true })
      return { data: { passed: true, output: `${stdout}${stderr}`.trim() } }
    } catch (e) {
      return {
        ok: false,
        exitCode: EXIT.REJECTED,
        data: { passed: false, output: `${e.stdout || ''}${e.stderr || ''}`.trim() || String(e.message) },
        error: { code: 'VALIDATION_FAILED', message: '站点数据 schema 校验未通过', hint: '详见 data.output' },
      }
    }
  },
}

async function probeCmd(command, args, cwd) {
  try {
    const { stdout, stderr } = await pExecFile(command, args, { cwd, encoding: 'utf8', timeout: 10000, windowsHide: true })
    return { ok: true, out: String(stdout || stderr).trim().split(/\r?\n/)[0] || '' }
  } catch (e) {
    return { ok: false, out: String(e.message || '').split(/\r?\n/)[0] }
  }
}

const doctorCmd = {
  path: 'data doctor',
  summary: '环境自检：Node/git/curl/密钥/数据文件/图标目录，定位「某条命令为什么跑不动」',
  usage: 'nav data doctor',
  async run() {
    const checks = []
    const add = (key, label, level, detail) => checks.push({ key, label, level, detail })

    const major = Number(process.versions.node.split('.')[0])
    add('node', 'Node 运行时', major >= 18 ? 'ok' : 'fail', `${process.version}${major >= 18 ? '' : '（需要 >= 18.3 才能用 parseArgs）'}`)

    const gitVersion = await probeCmd('git', ['--version'])
    if (!gitVersion.ok) {
      add('git', 'git 可执行文件', 'fail', gitVersion.out)
    } else {
      const inside = await probeCmd('git', ['rev-parse', '--is-inside-work-tree'], ROOT)
      add('git', 'git 可执行文件', inside.out === 'true' ? 'ok' : 'fail', inside.out === 'true' ? gitVersion.out : `${gitVersion.out} · 当前目录不是 git 仓库`)
    }

    let curl = await probeCmd('curl.exe', ['--version'])
    if (!curl.ok) curl = await probeCmd('curl', ['--version'])
    add('curl', 'curl 可执行文件', curl.ok ? 'ok' : 'fail', curl.ok ? curl.out : '缺失：探活、元信息抓取、云端读取都依赖 curl')

    const env = envSummary()
    add('envFile', '.env.local', env.envFileExists ? 'ok' : 'warn', env.envFileExists ? '已存在' : '缺失（密钥只能从环境变量读取）')
    const has = name => env.vars.find(v => v.name === name)?.configured
    add('adminKey', 'SITES_ADMIN_KEY', has('SITES_ADMIN_KEY') ? 'ok' : 'warn', has('SITES_ADMIN_KEY') ? '已配置' : '未配置：publish run / sync-data 会以退出码 3 中止')
    add('vercelToken', 'VERCEL_TOKEN', has('VERCEL_TOKEN') ? 'ok' : 'warn', has('VERCEL_TOKEN') ? '已配置' : '未配置：publish deployments 不可用')

    try {
      const sites = data.readSites()
      add('sitesData', 'api/sites-data.json', 'ok', `${sites.length} 个站点`)
    } catch (e) {
      add('sitesData', 'api/sites-data.json', 'fail', `读取失败：${e.message}`)
    }

    try {
      const icons = readdirSync(join(ROOT, 'public', 'icons'))
      add('icons', 'public/icons', icons.length ? 'ok' : 'warn', `${icons.length} 个图标文件`)
    } catch (e) {
      add('icons', 'public/icons', 'warn', `目录不可读：${e.message}`)
    }

    const remote = await git.getRemoteUrl().catch(() => '')
    add('remote', 'origin 远端', remote ? 'ok' : 'warn', remote || '未配置 origin：git push 不可用')

    let version = ''
    try { version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version || '' } catch { /* 忽略：仅用于展示 */ }
    add('version', '项目版本', version ? 'ok' : 'warn', version || 'package.json 读取失败')

    const fail = checks.filter(c => c.level === 'fail')
    const warn = checks.filter(c => c.level === 'warn')
    const ok = fail.length === 0
    return {
      ok,
      exitCode: ok ? EXIT.OK : EXIT.ENV,
      error: ok ? null : { code: 'ENV_MISSING', message: `${fail.length} 项环境检查未通过`, hint: fail.map(c => `${c.label}：${c.detail}`).join('；') },
      data: {
        root: ROOT,
        ok,
        pass: checks.length - fail.length - warn.length,
        warn: warn.length,
        fail: fail.length,
        checks,
      },
      render: d => [
        `${d.ok ? '✅ 环境自检通过' : '✖ 环境自检未通过'} · 正常 ${d.pass} / 告警 ${d.warn} / 失败 ${d.fail}`,
        `项目根目录：${d.root}`,
        '',
        table(['检查项', '级别', '说明'], d.checks.map(c => [c.label, { ok: '✓', warn: '!', fail: '✖' }[c.level], c.detail])),
      ].join('\n'),
    }
  },
}

const auditCmd = {
  path: 'data audit',
  summary: '操作审计日志查询：提交 / 推送 / 发布 / 放行 / 回滚 / 校验失败等关键动作（新 → 旧）',
  usage: 'nav data audit [--limit <n>] [--action <动作>] [--result ok|fail|rejected] [--q <关键词>]',
  flags: {
    limit: { desc: '最多返回多少条，默认 50' },
    action: { desc: '按动作过滤，如 gate.approve / publish.done / rollback.apply' },
    result: { desc: '按结果过滤：ok / fail / rejected' },
    q: { desc: '关键词，匹配动作/目标/详情' },
  },
  async run(argv) {
    const { values } = parseCommandArgs(argv, buildOptions(auditCmd.flags), { usage: auditCmd.usage })
    const r = audit.list({
      limit: Number(values.limit) || 50,
      action: values.action || '',
      result: values.result || '',
      q: values.q || '',
    })
    const s = audit.summary()
    const RESULT_MARK = { ok: '✓', fail: '✖', rejected: '⊘' }
    return {
      data: { ...r, summary: s, actions: audit.ACTIONS },
      render: d => [
        `审计文件：${audit.AUDIT_FILE}`,
        `累计 ${d.summary.total} 条 · 非成功 ${d.summary.failures} 条 · 最近一条 ${d.summary.lastAt || '—'}`,
        d.summary.lastApprove ? `最近一次放行：${d.summary.lastApprove.action} · ${d.summary.lastApprove.ts} · ${d.summary.lastApprove.detail}` : '最近一次放行：无',
        '',
        `匹配 ${d.total} 条（显示 ${d.items.length} 条）：`,
        table(['时间', '', '动作', '目标', '详情'], d.items.map(it => [
          it.ts, RESULT_MARK[it.result] || '·', audit.actionLabel(it.action), it.target, it.detail,
        ])),
      ].join('\n'),
    }
  },
}

export const commands = [statsCmd, integrityCmd, diffCmd, validateCmd, doctorCmd, auditCmd]