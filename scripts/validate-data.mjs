/**
 * 站点数据 schema 校验
 * 用法: node scripts/validate-data.mjs  （默认校验 api/sites-data.json）
 *       或 node scripts/validate-data.mjs <path>
 *       --strict  把警告也当失败（用于发布前的强校验）
 * 通过退出码 0，失败退出码 1 并列出所有问题
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PURPOSE_IDS, MAX_PURPOSES } from '../shared/purposes.mjs'
import { CATEGORY_GROUPS } from '../shared/categories.mjs'
import { hostOf } from '../shared/host.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const strict = argv.includes('--strict')
const file = argv.find(a => !a.startsWith('--')) || join(root, 'api', 'sites-data.json')
const sites = JSON.parse(readFileSync(file, 'utf-8'))

const errors = []
const warnings = []
const idSet = new Set()
const sortSet = new Set()

/**
 * 分类白名单**从内置分类表推导**，不再是一串手抄的常量。
 *
 * 原来那串 35 个 id 是手写的，而且 `knownCats` 定义了从头到尾没被用过 ——
 * 于是「未登记分类可绕过校验」：本地校验通过、发布时才被运行时的 preflight 拦下，
 * 表现为「本地明明没问题却发不出去」。现在直接用同一份表，两边不可能漂移。
 */
const knownCats = new Set()
for (const g of CATEGORY_GROUPS) {
  knownCats.add(g.id)
  for (const c of g.categories) knownCats.add(c.id)
}
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
  } else if (!knownCats.has(s.categoryId)) {
    // 云端可能下发自定义分类，所以默认只警告；发布前的 --strict 才会拦下来
    warnings.push(`[${s.id}] 分类不在内置分类表内: ${s.categoryId}`)
  }

  // desc 是卡片正文，之前完全没校验：类型不对会让卡片渲染出 "[object Object]"
  if (s.desc !== undefined && typeof s.desc !== 'string') {
    errors.push(`[${s.id}] desc 不是字符串: ${typeof s.desc}`)
  } else if (!String(s.desc ?? '').trim()) {
    warnings.push(`[${s.id}] 缺少 desc`)
  } else if (String(s.desc).length > 300) {
    warnings.push(`[${s.id}] desc 过长（${String(s.desc).length} 字），卡片上会被截断`)
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

  // archived / pinned 可选；一旦出现必须是布尔值。
  // 两者都是「本站状态」而非内容字段：归档 = 不再日常用但保留，置顶 = 固定在前。
  // 缺省等价于 false，故只做类型把关，不做存在性要求。
  for (const flag of ['archived', 'pinned']) {
    if (s[flag] !== undefined && typeof s[flag] !== 'boolean') {
      errors.push(`[${s.id}] ${flag} 不是布尔值`)
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

// 全局：同一个域名被收录了多次。
// 这不是「一定错」——同域不同产品（github.com 与 github.com/xxx）可能确实要分两条 ——
// 但实测已有 4 组，多半是重复录入；而重复域名会让搜索出现两条几乎一样的结果，
// 也让「已收录判定」在两个 id 间摇摆。故默认警告报出，--strict 下才算失败。
const byHost = new Map()
for (const s of sites) {
  const h = hostOf(s.url)
  if (!h) {
    warnings.push(`[${s.id}] url 解析不出域名: ${s.url}`)
    continue
  }
  if (!byHost.has(h)) byHost.set(h, [])
  byHost.get(h).push(s.id)
}
for (const [h, ids] of byHost) {
  if (ids.length > 1) warnings.push(`重复域名 ${h}: ${ids.join(', ')}`)
}

// 全局：id 前缀唯一性（categoryId 前导字母一致性）
const prefixStat = {}
for (const s of sites) {
  const p = (s.id || '').replace(/\d+/g, 'N')
  prefixStat[p] = (prefixStat[p] || 0) + 1
}
const multi = Object.entries(prefixStat).filter(([, c]) => c > 1 && c < sites.length)
// id 前缀唯一性：只提示 count 较大或明显的类别混用，避免对历史小批量误报

console.log(`校验 ${sites.length} 条站点: 分类 ${actualCats.size} 个${strict ? '（strict 模式：警告即失败）' : ''}`)

if (errors.length) {
  console.error('\n❌ 校验失败:')
  errors.forEach(e => console.error('  - ' + e))
  process.exit(1)
}

if (warnings.length) {
  console.log(`\n⚠️ 警告 ${warnings.length} 条:`)
  warnings.forEach(w => console.log('  - ' + w))
  if (strict) {
    console.error('\n❌ strict 模式下警告视为失败')
    process.exit(1)
  }
}

console.log('\n✅ 数据校验通过')