/** @vercel/blob 的打桩实现，用于在本地验证 api/sites.js 的 GET 分支行为 */
let scenario = 'empty'
const calls = { get: 0, put: 0 }

export function __setScenario(s) {
  scenario = s
  calls.get = 0
  calls.put = 0
}

export function __calls() {
  return { ...calls }
}

// 真实的 @vercel/blob.get 返回 { stream, url, ... }，内容在 stream 里 ——
// 打桩必须还原这一点，否则 readStored 的 `!blob.stream` 判断会一律当成「不存在」
function blobOf(data) {
  return { stream: new Response(JSON.stringify(data)).body }
}

export async function get() {
  calls.get++
  if (scenario === 'throw') throw new Error('模拟 Blob 5xx / 超时')
  if (scenario === 'empty') return null
  if (scenario === 'invalid') return blobOf({ version: 5, sites: [] })
  if (scenario === 'good') {
    return blobOf({ version: 42, sites: [{ id: 'a', name: 'A', url: 'a.com' }, { id: 'b', name: 'B', url: 'b.com' }] })
  }
  return null
}

export async function put() {
  calls.put++
  return { url: 'stub' }
}

export async function list() {
  return { blobs: [] }
}

export async function del() {
  return {}
}
