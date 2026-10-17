/**
 * 站点数据质量体检 CLI（F1）。
 *
 * 用法:
 *   node scripts/audit-data.mjs [path]            # 体检默认 api/sites-data.json
 *   node scripts/audit-data.mjs --json            # 机读输出（供脚本 / 面板消费）
 *   node scripts/audit-data.mjs --strict          # 有问题即退出码 1（发布前强校验）
 *   node scripts/audit-data.mjs --merge-hosts     # 额外打印「合并重复 host」的移除清单（只建议、不改数据）
 *
 * 与 scripts/validate-data.mjs 的分工：那个查 **schema**（字段在不在、分类认不认），
 * 这个查**数据质量**（重复 host / 缺 icon / 描述没用 / 地址解析不了）。两者互补，不重叠。
 * 判据来自 shared/ops/data-quality.mjs —— 与后台「数据质量」面板同一份，不会漂移。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditSites, DESC_ISSUE_LABEL, planHostMerge, summarizeAudit } from '../shared/ops/data-quality.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const strict = argv.includes('--strict')
const withMerge = argv.includes('--merge-hosts')
const file = argv.find(a => !a.startsWith('--')) || join(root, 'api', 'sites-data.json')

let sites
try {
  sites = JSON.parse(readFileSync(file, 'utf-8'))
} catch (e) {
  console.error(`读不到数据文件：${file}\n${e.message}`)
  process.exit(2)
}

const audit = auditSites(sites)

if (asJson) {
  console.log(JSON.stringify(audit, null, 2))
} else {
  console.log(`数据文件：${file}`)
  console.log(summarizeAudit(audit))
  console.log()

  if (audit.duplicateUrls.length) {
    console.log(`■ 完全重复（${audit.duplicateUrls.length} 组）—— 规范化 URL 相同，建议合并：`)
    for (const g of audit.duplicateUrls) {
      console.log(`  ${g.url}`)
      g.ids.forEach((id, i) => console.log(`    ${i === 0 ? '·保留' : '·重复'} ${id}  ${g.names[i] || ''}`.trimEnd()))
    }
    if (withMerge) {
      const plan = planHostMerge(audit)
      console.log(`  → 合并建议（保留每组首条）将移除 ${plan.removeIds.length} 条：${plan.removeIds.join('、')}`)
    }
    console.log()
  }

  if (audit.sameHostGroups.length) {
    console.log(`■ 同站多入口（${audit.sameHostGroups.length} 组）—— host 相同但页面不同，需人工确认是否合并：`)
    for (const g of audit.sameHostGroups) {
      console.log(`  ${g.host}`)
      g.ids.forEach((id, i) => console.log(`    ${id}  ${g.names[i] || ''}  ${g.paths[i] || ''}`.trimEnd()))
    }
    console.log()
  }

  if (audit.weakDesc.length) {
    console.log(`■ 描述待改进（${audit.weakDesc.length} 条）：`)
    for (const d of audit.weakDesc) console.log(`  ${d.id}  ${d.name || ''}  —— ${DESC_ISSUE_LABEL[d.issue] || d.issue}`)
    console.log()
  }

  if (audit.missingIcon.length) {
    console.log(`■ 缺 icon（${audit.missingIcon.length} 条，前端会退化成字母块）：${audit.missingIcon.join('、')}`)
    console.log()
  }

  if (audit.unknownUrl.length) {
    console.log(`■ 地址无法解析（${audit.unknownUrl.length} 条）：${audit.unknownUrl.join('、')}`)
    console.log()
  }

  if (audit.dupSortOrder.length) {
    console.log(`■ sortOrder 冲突：${audit.dupSortOrder.join('、')}`)
    console.log()
  }
}

process.exit(audit.clean ? 0 : strict ? 1 : 0)
