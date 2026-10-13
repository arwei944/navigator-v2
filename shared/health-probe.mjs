/**
 * 站点探活引擎：分级口径与**重试口径**在此唯一定义。
 *
 * 为什么单独抽出来：控制台可用性看板、CLI `nav sites check`、`scripts/check-sites.mjs`
 * 三处都要判「这个站点到底通不通」，口径一旦漂移就会出现「看板说好的、报告说要处理」。
 * 与 `shared/site-infer.mjs` 同理：同源一处，改一处即全生效。
 *
 * ## 分工（本次拆分后）
 *
 *   · **怎么探**（HEAD→GET 复核、代理、curl vs fetch）→ `shared/probe-engine.mjs` 的探针注册表；
 *   · **怎么定性**（ok/limited/down 分级、连续失败才判宕机的误报抑制）→ 本文件；
 *   · **分级阈值本身** → `shared/health-rules.mjs`（纯规则，前端与 Serverless 也读它）。
 *
 * 拆开的好处很直接：原本 `server/cron.mjs`（Linux 沙箱，没有 curl.exe）不得不把
 * 同一件事用 fetchCapped 再写一遍，两处口径靠人肉同步；现在两边都从注册表取探针，
 * 沙箱因为 `curl-http` 的 `available()` 为 false 而自然落到 `fetch-http`，语义不分叉。
 */
import { IGNORABLE, STATUS_LABEL, verdictOf, tally } from './health-rules.mjs'
import { resolveProxyUrl } from './proxy.mjs'
import { runProbe } from './probe-engine.mjs'

export { IGNORABLE, STATUS_LABEL, verdictOf, tally }

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * 单次探测：交给注册表选出的探针（默认 `curl-http`；非 Windows 环境自动落到 `fetch-http`）。
 *
 * 注意**不在这里做定性**：探针回什么 code 就照实往上报（哪怕 ERR），
 * `ok`/`limited`/`down` 与重试都由下面的 `probe()` 决定。
 */
async function probeOnce(url, timeout, proxy) {
  const r = await runProbe(url, { timeoutS: timeout, proxy })
  return r ? { code: r.code, ms: r.ms, probe: r.probe } : { code: 'ERR', ms: 0, probe: '' }
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
