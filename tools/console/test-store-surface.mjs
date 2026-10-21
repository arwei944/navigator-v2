/**
 * store 导出面门禁：源码里调用的 `sitesStore.xxx()` / `categoriesStore.xxx()`
 * 必须在对应 store 的 `return { ... }` 里真的导出。
 *
 * 为什么需要：`applyCloudData` 曾在 store 内部定义、被云同步使用，却没加进 return。
 * TypeScript 会当场报错，但这是纯 JavaScript；运行时只在**发布成功那一刻**
 * 才炸出 `is not a function` —— 数据已经写进云端，前端却回填失败。
 * 这类漂移靠人工检查很难覆盖，用一条静态断言兜住。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')

function read(file) {
  return readFileSync(join(ROOT, file), 'utf8')
}

function exportedNames(file, endPattern) {
  const src = read(file)
  const m = src.match(endPattern)
  if (!m) throw new Error(`无法在 ${file} 中定位 return 块`)
  const body = m[1]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
  const names = new Set()
  for (const part of body.split(',')) {
    const hit = part.trim().match(/^([A-Za-z_$][\w$]*)/)
    if (hit) names.add(hit[1])
  }
  return names
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (/\.(js|vue|mjs)$/.test(name)) out.push(full)
  }
  return out
}

let pass = 0
let fail = 0
function ok(name, fn) {
  try { fn(); pass += 1; console.log(`  ✓ ${name}`) }
  catch (e) { fail += 1; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

const sitesExports = exportedNames('src/stores/sites.js', /return\s*\{([\s\S]*?)\n\s*\}\s*\n\}\)/)
const categoriesExports = exportedNames('src/stores/categories.js', /return\s*\{([\s\S]*?)\n\s*\}\s*\n\}\)/)

const files = walk(join(ROOT, 'src')).map(f => ({ full: f, rel: relative(ROOT, f) }))

function collect(storeName) {
  const calls = new Map() // name -> [file]
  const re = new RegExp(`\\b${storeName}\\.([A-Za-z_$][\\w$]*)\\s*\\(`, 'g')
  for (const { full, rel } of files) {
    const src = readFileSync(full, 'utf8')
    for (const m of src.matchAll(re)) {
      const name = m[1]
      if (name.startsWith('$')) continue
      if (!calls.has(name)) calls.set(name, new Set())
      calls.get(name).add(rel)
    }
  }
  return calls
}

console.log('store 导出面')

ok('sitesStore 的调用都已在 store 中导出', () => {
  const calls = collect('sitesStore')
  const missing = [...calls.entries()].filter(([name]) => !sitesExports.has(name))
  if (missing.length) {
    const detail = missing.map(([name, where]) => `${name}（${[...where].slice(0, 3).join('、')}）`).join('；')
    throw new Error(`调用了未导出的方法：${detail}`)
  }
})

ok('categoriesStore 的调用都已在 store 中导出', () => {
  const calls = collect('categoriesStore')
  const missing = [...calls.entries()].filter(([name]) => !categoriesExports.has(name))
  if (missing.length) {
    const detail = missing.map(([name, where]) => `${name}（${[...where].slice(0, 3).join('、')}）`).join('；')
    throw new Error(`调用了未导出的方法：${detail}`)
  }
})

ok('发布回填方法已导出', () => {
  for (const name of ['applyCloudData', 'clearLocalOverlay']) {
    if (!sitesExports.has(name)) throw new Error(`sites store 缺少导出：${name}`)
  }
})

console.log(`\n结果：${pass} 通过，${fail} 失败`)
process.exit(fail ? 1 : 0)