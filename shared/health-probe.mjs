/**
 * 站点探活引擎：分级口径与探测方式在此唯一定义。
 *
 * 为什么单独抽出来：控制台可用性看板、CLI `nav sites check`、`scripts/check-sites.mjs`
 * 三处都要判「这个站点到底通不通」，口径一旦漂移就会出现「看板说好的、报告说要处理」。
 * 与 `shared/site-infer.mjs` 同理：同源一处，改一处即全生效。
 *
 * 分级口径来自 `shared/health-rules.mjs`（纯规则，前端与 Serverless 也读它）；
 * 本模块只负责「怎么探」——探测方式必须是 curl.exe：本机 Node fetch 不走系统代理，
 * 直连会大面积误判为不可达。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { IGNORABLE, STATUS_LABEL, verdictOf, tally } from './health-rules.mjs'
import { resolveProxyUrl } from './proxy.mjs'

const pExecFile = promisify(execFile)

export { IGNORABLE, STATUS_LABEL, verdictOf, tally }

const sleep = ms => new Promise(r => setTimeout(r, ms))

function normalize(url) {
  return String(url || '').includes('://') ? String(url) : `https://${url}`
}

/**
 * 单次 curl，只取 http_code。
 *
 * 关键：curl 超时（`--max-time`）会以非 0 码退出（exit 28），此时 `execFile` 的 Promise
 * 会 reject —— 但 `-w` 已经把 http_code 写进 stdout 了。若不从 error.stdout 取回，
 * 「HEAD 超时」就会被当成探测异常直接定性，GET 回落永远执行不到（曾导致 BlockBeats 误判）。
 */
async function curlCode(args, timeout) {
  try {
    const { stdout } = await pExecFile('curl.exe', args, {
      encoding: 'utf8', timeout: (timeout + 5) * 1000, windowsHide: true,
    })
    return stdout.trim()
  } catch (e) {
    return String(e.stdout || '').trim()
  }
}

/** 2xx / 3xx 视为「HEAD 已足够定性」，其余一律需要 GET 复核 */
function isReachable(code) {
  const n = Number(code)
  return Number.isFinite(n) && n >= 200 && n < 400
}

/**
 * 单次探测：先 HEAD 省流量，**只要 HEAD 不是 2xx/3xx 就用 GET 复核**。
 *
 * 为什么不能只信 HEAD：大量站点不支持 HEAD（返回 404 / 405）或对 HEAD 直接超时，
 * 而 GET 是正常的 200 —— 只按 HEAD 定性会把可用站点成批误判为「需处理」
 * （曾误伤 Kaggle / 文心一言 / BlockBeats）。GET 才是用户真实访问方式，故以它为准。
 */
async function probeOnce(url, timeout, proxy) {
  const target = normalize(url)
  // 显式指定代理，而不是依赖环境变量：代理端口会漂移，环境变量可能滞后
  const via = proxy ? ['--proxy', proxy] : []
  const base = ['-s', '-o', 'NUL', '-w', '%{http_code}', '-L', '--max-time', String(timeout), ...via]
  const t0 = Date.now()
  let code = await curlCode(['-I', ...base, target], timeout)
  if (!isReachable(code)) code = await curlCode([...base, target], timeout)
  return { code: code || 'ERR', ms: Date.now() - t0 }
}

/**
 * 带重试的单站探测：首次判定为 down 时再试一次，只有连续失败才定性。
 * 这是本项目的「误报抑制」口径 —— WAF 抖动、瞬时超时不应直接判宕机。
 * @returns {Promise<{code:string,status:'ok'|'limited'|'down',ms:number,attempts:number}>}
 */
export async function probe(url, { timeout = 12, attempts = 2, retryDelayMs = 500, proxy } = {}) {
  const tries = Math.max(1, Number(attempts) || 1)
  // 未显式传入代理时按本机实际监听的端口解析一次（带缓存，批量调用不会重复探测）
  const via = proxy !== undefined ? proxy : await resolveProxyUrl()
  let last = null
  for (let i = 1; i <= tries; i++) {
    last = await probeOnce(url, timeout, via)
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
export async function probeMany(sites, { timeout = 12, concurrency = 12, attempts = 2, onProgress, proxy } = {}) {
  const list = sites || []
  const conc = Math.max(1, Number(concurrency) || 12)
  // 整批只解析一次代理：既避免每站重复探测端口，也保证同批口径一致
  const via = proxy !== undefined ? proxy : await resolveProxyUrl()
  const results = []
  for (let i = 0; i < list.length; i += conc) {
    const chunk = list.slice(i, i + conc)
    const out = await Promise.all(chunk.map(async s => {
      const r = await probe(s.url, { timeout, attempts, proxy: via })
      return { id: s.id, name: s.name, url: s.url, ...r }
    }))
    results.push(...out)
    if (onProgress) onProgress({ done: results.length, total: list.length, chunk: out })
  }
  return results
}