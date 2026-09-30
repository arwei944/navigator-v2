/**
 * 站点探活引擎：分级口径与探测方式在此唯一定义。
 *
 * 为什么单独抽出来：控制台可用性看板、CLI `nav sites check`、`scripts/check-sites.mjs`
 * 三处都要判「这个站点到底通不通」，口径一旦漂移就会出现「看板说好的、报告说要处理」。
 * 与 `shared/site-infer.mjs` 同理：同源一处，改一处即全生效。
 *
 * 分级（与前端 `src/stores/health.js` 保持一致）：
 *  - ok      : 2xx / 3xx 可访问
 *  - limited : 429/403/405/401 —— 限流 / 反爬 / 方法误用 / 鉴权，站点实际可用
 *  - down    : 连接失败 / ERR / 000 / 404 / 402 / 410 等真实失效
 *
 * 探测方式必须是 curl.exe：本机 Node fetch 不走系统代理，直连会大面积误判为不可达。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const pExecFile = promisify(execFile)

/** 限流 / 反爬 / 方法误用 / 鉴权：站点实际可用，不计入「需处理」 */
export const IGNORABLE = new Set([429, 403, 405, 401])

export const STATUS_LABEL = { ok: '正常', limited: '可忽略', down: '需处理', unknown: '未探测' }

export function verdictOf(code) {
  if (code === 'ERR' || code === '000') return 'down'
  const n = Number(code)
  if (Number.isNaN(n)) return 'down'
  if (n >= 400) return IGNORABLE.has(n) ? 'limited' : 'down'
  return 'ok'
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

function normalize(url) {
  return String(url || '').includes('://') ? String(url) : `https://${url}`
}

/**
 * 单次探测：先 HEAD，被拒或返回 000 时回落 GET。
 * 部分站点不支持 HEAD，只发 HEAD 会把可用站点误判成 000。
 */
async function probeOnce(url, timeout) {
  const target = normalize(url)
  const call = args => pExecFile('curl.exe', args, {
    encoding: 'utf8', timeout: (timeout + 5) * 1000, windowsHide: true,
  })
  const t0 = Date.now()
  try {
    const head = await call(['-s', '-o', 'NUL', '-w', '%{http_code}', '-I', '-L', '--max-time', String(timeout), target])
    let code = head.stdout.trim()
    if (!code || code === '000') {
      const get = await call(['-s', '-o', 'NUL', '-w', '%{http_code}', '-L', '--max-time', String(timeout), target])
      code = get.stdout.trim()
    }
    return { code: code || 'ERR', ms: Date.now() - t0 }
  } catch {
    return { code: 'ERR', ms: Date.now() - t0 }
  }
}

/**
 * 带重试的单站探测：首次判定为 down 时再试一次，只有连续失败才定性。
 * 这是本项目的「误报抑制」口径 —— WAF 抖动、瞬时超时不应直接判宕机。
 * @returns {Promise<{code:string,status:'ok'|'limited'|'down',ms:number,attempts:number}>}
 */
export async function probe(url, { timeout = 12, attempts = 2, retryDelayMs = 500 } = {}) {
  const tries = Math.max(1, Number(attempts) || 1)
  let last = null
  for (let i = 1; i <= tries; i++) {
    last = await probeOnce(url, timeout)
    const status = verdictOf(last.code)
    if (status !== 'down') return { ...last, status, attempts: i }
    if (i < tries) await sleep(retryDelayMs)
  }
  return { ...last, status: verdictOf(last.code), attempts: tries }
}

/**
 * 批量探测：按并发数分块，逐块完成即回调进度（供 SSE 实时透出）。
 * @returns {Promise<Array<{id,name,url,code,status,ms,attempts}>>}
 */
export async function probeMany(sites, { timeout = 12, concurrency = 12, attempts = 2, onProgress } = {}) {
  const list = sites || []
  const conc = Math.max(1, Number(concurrency) || 12)
  const results = []
  for (let i = 0; i < list.length; i += conc) {
    const chunk = list.slice(i, i + conc)
    const out = await Promise.all(chunk.map(async s => {
      const r = await probe(s.url, { timeout, attempts })
      return { id: s.id, name: s.name, url: s.url, ...r }
    }))
    results.push(...out)
    if (onProgress) onProgress({ done: results.length, total: list.length, chunk: out })
  }
  return results
}

/** 汇总计数（看板与 CLI 共用同一份口径） */
export function tally(results) {
  const out = { ok: 0, limited: 0, down: 0 }
  for (const r of results) out[r.status] = (out[r.status] || 0) + 1
  return out
}