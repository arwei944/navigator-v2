/**
 * 站点数据 schema 校验
 * 用法: node scripts/validate-data.mjs  （默认校验 api/sites-data.json）
 *       或 node scripts/validate-data.mjs <path>
 * 通过退出码 0，失败退出码 1 并列出所有问题
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PURPOSE_IDS, MAX_PURPOSES } from '../shared/purposes.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const file = process.argv[2] || join(root, 'api', 'sites-data.json')
const sites = JSON.parse(readFileSync(file, 'utf-8'))

const errors = []
const warnings = []
const idSet = new Set()
const sortSet = new Set()
const knownCats = new Set(['articial', 'aiapi', 'aicrypto', 'coding', 'data', 'dex', 'design', 'account', 'projects', 'proxy', 'security', 'sms', 'starter', 'tools', 'other', 'b', 'c', 'd', 'e', 'f', 'g', 'l', 'sc', 's', 'dx', 'u', 'w', 'm', 'ot', 're', 'cc', 'bs', 'cd', 'ac', 'acc', 'dt', 'n'])
// 某些分类是旧前缀，收集实际出现的 categoryId 用于提示（不硬校验未知值，避免历史数据误报）
const actualCats = new Set(sites.map(s => s.categoryId))

const now = Date.now()

sites.forEach((s, i) => {
  if (!s.id) errors.push(`[${i}] 缺少 id`)
  else if (idSet.has(s.id)) errors.push(`id 重复: ${s.id}`)
  else idSet.add(s.id)

  if (!s.name || !String(s.name).trim()) errors.push(`[${i}:${s.id}] 缺少 name`)
  if (!s.url || !String(s.url).trim()) errors.push(`[${i}:${s.id}] 缺少 url`)

  if (s.categoryId === undefined || s.categoryId === null || s.categoryId === '') {
    errors.push(`[${s.id}] 缺少 categoryId`)
  }

  if (typeof s.sortOrder !== 'number') {
    errors.push(`[${s.id}] sortOrder 不是数字: ${s.sortOrder}`)
  } else {
    if (sortSet.has(s.sortOrder)) warnings.push(`sortOrder 重复: ${s.sortOrder} (${[...sites].filter(x => x.sortOrder === s.sortOrder).map(x => x.id).join(',')})`)
    sortSet.add(s.sortOrder)
  }

  if (!s.createdAt || typeof s.createdAt !== 'number') {
    errors.push(`[${s.id}] 缺少 createdAt`)
  } else if (s.createdAt > now + 24 * 3600 * 1000) {
    warnings.push(`[${s.id}] createdAt 是未来时间`)
  }

  if (!s.color) warnings.push(`[${s.id}] 缺少 color`)
  if (!s.icon) warnings.push(`[${s.id}] 缺少 icon`)

  // aliases 可选；一旦出现必须是「非空字符串数组、无重复、不与站名/域名重复」
  if (s.aliases !== undefined) {
    if (!Array.isArray(s.aliases)) {
      errors.push(`[${s.id}] aliases 不是数组`)
    } else {
      const seen = new Set()
      const name = String(s.name || '').trim().toLowerCase()
      const host = String(s.url || '').toLowerCase().replace(/^www\./, '')
      s.aliases.forEach((a, ai) => {
        if (typeof a !== 'string' || !a.trim()) {
          errors.push(`[${s.id}] aliases[${ai}] 不是非空字符串`)
          return
        }
        const lower = a.trim().toLowerCase()
        if (seen.has(lower)) errors.push(`[${s.id}] 别名重复: ${a}`)
        seen.add(lower)
        if (lower === name) warnings.push(`[${s.id}] 别名与站名相同: ${a}`)
        if (lower === host) warnings.push(`[${s.id}] 别名与域名相同: ${a}`)
      })
    }
  }

  // purposes 可选；一旦出现必须是「词表内的 id 数组、无重复、不超过上限」
  if (s.purposes !== undefined) {
    if (!Array.isArray(s.purposes)) {
      errors.push(`[${s.id}] purposes 不是数组`)
    } else {
      const seen = new Set()
      s.purposes.forEach((p, pi) => {
        const id = String(p ?? '').trim()
        if (!id || !PURPOSE_IDS.has(id)) {
          errors.push(`[${s.id}] purposes[${pi}] 不在用途词表内: ${p}`)
          return
        }
        if (seen.has(id)) errors.push(`[${s.id}] 用途重复: ${id}`)
        seen.add(id)
      })
      if (s.purposes.length > MAX_PURPOSES) errors.push(`[${s.id}] 用途超过上限 ${MAX_PURPOSES} 个`)
    }
  }
})

// 全局：id 前缀唯一性（categoryId 前导字母一致性）
const prefixStat = {}
for (const s of sites) {
  const p = (s.id || '').replace(/\d+/g, 'N')
  prefixStat[p] = (prefixStat[p] || 0) + 1
}
const multi = Object.entries(prefixStat).filter(([, c]) => c > 1 && c < sites.length)
// id 前缀唯一性：只提示 count 较大或明显的类别混用，避免对历史小批量误报

console.log(`校验 ${sites.length} 条站点: 分类 ${actualCats.size} 个`)

if (errors.length) {
  console.error('\n❌ 校验失败:')
  errors.forEach(e => console.error('  - ' + e))
  process.exit(1)
}

if (warnings.length) {
  console.log('\n⚠️ 警告:')
  warnings.forEach(w => console.log('  - ' + w))
}

console.log('\n✅ 数据校验通过')