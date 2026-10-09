/**
 * 验证 api/sites.js 的 GET 分支：**只有「Blob 确认为空」才允许写种子**。
 * 运行：node --import ./probe/_blob-register.mjs probe/test-sites-get.mjs
 */
import { __setScenario, __calls } from './_blob-stub.mjs'

const { default: handler } = await import('../api/sites.js')

function mkRes() {
  const out = { code: 0, body: null }
  return {
    setHeader() {},
    status(c) { out.code = c; return this },
    json(b) { out.body = b; return this },
    _out: out
  }
}

const results = []
function check(label, ok, extra = '') {
  results.push({ label, ok })
  console.log(`  ${ok ? '✅' : '❌'} ${label}${extra ? ' — ' + extra : ''}`)
}

async function run(scenario) {
  __setScenario(scenario)
  const res = mkRes()
  await handler({ method: 'GET', query: {} }, res)
  return { ...res._out, calls: __calls() }
}

console.log('\n[场景 A] Blob 读取抛异常（网络抖动 / 5xx / token 失效）')
{
  const r = await run('throw')
  console.log(`  HTTP ${r.code} · put 调用 ${r.calls.put} 次`)
  check('返回 503 而不是 200', r.code === 503)
  check('绝不写 Blob（put 未被调用）', r.calls.put === 0)
  check('未把种子数据当成响应体返回', !r.body?.sites)
}

console.log('\n[场景 B] 已存储的数据结构非法（sites 为空数组）')
{
  const r = await run('invalid')
  console.log(`  HTTP ${r.code} · put 调用 ${r.calls.put} 次`)
  check('返回 503', r.code === 503)
  check('绝不覆盖已有数据', r.calls.put === 0)
}

console.log('\n[场景 C] Blob 确认为空（首次部署）')
{
  const r = await run('empty')
  console.log(`  HTTP ${r.code} · put 调用 ${r.calls.put} 次 · version=${r.body?.version}`)
  check('返回 200', r.code === 200)
  check('写入种子初始化（这是唯一允许写的路径）', r.calls.put === 1)
  check('种子 version 为 1', r.body?.version === 1)
}

console.log('\n[场景 D] Blob 数据正常')
{
  const r = await run('good')
  console.log(`  HTTP ${r.code} · put 调用 ${r.calls.put} 次 · version=${r.body?.version}`)
  check('返回 200 且是存储里的数据', r.code === 200 && r.body?.version === 42)
  check('不写 Blob', r.calls.put === 0)
}

const failed = results.filter(r => !r.ok)
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length ? 1 : 0)
