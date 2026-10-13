/**
 * 站点探活 **探针注册表（热拔插）** —— 把「怎么探」与「探完怎么定性」分开。
 *
 * ## 为什么需要它（真实存在的重复）
 *
 * 本仓原本有两套探测实现，注释里都写着「不能复用对方」：
 *   · `shared/health-probe.mjs` —— 本机 Windows，靠 `curl.exe` 出网
 *     （本机 Node fetch 不走系统代理，直连会大面积误判不可达）；
 *   · `server/cron.mjs`         —— 部署沙箱 Linux，没有 curl.exe，改走 `fetchCapped`。
 * 同一件事（HEAD 不收就 GET 复核）在两处各写一遍，口径靠人肉维持一致 ——
 * 这就是「改一处要记得改两处」的典型。注册表把实现收成两个探针，机制只有一份。
 *
 * ## 与翻译链 / 图片链的**关键语义差别**
 *
 * 翻译与取图可以「换下一个重试」，因为失败只是这条路走不通。
 * 探活不行：**「站点 down」本身就是结论**。所以这里的回退条件只能是
 * 「这个探针在当前环境**不可用**」，而不是「它探出来的结果是失败」：
 *   · `run()` 抛错，或返回 `{ unavailable: true, reason }` → 换下一个探针；
 *   · `run()` 返回 `{ code, ms }`（哪怕 code 是 `ERR`）→ **这就是最终结论，停止**。
 * 混淆这两者会让「探测到宕机」被当成「探针坏了」而反复换探针重试，
 * 既浪费请求，又把「确认宕机」的结论稀释掉。
 *
 * ## 定性仍归 shared/health-rules.mjs
 *
 * 探针只回答「探到了什么」（code + ms）。`ok` / `limited` / `down` 的判定、
 * 以及「连续失败才定性」的重试口径留在 `health-probe.mjs`（`verdictOf` + attempts），
 * 两者不混 —— 换探针不会改变判定标准。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fetchCapped } from './http-fetch.mjs'
import { resolveProxyUrl } from './proxy.mjs'

const pExecFile = promisify(execFile)

const registry = new Map()
let seq = 0

const DEFAULT_UA = 'Mozilla/5.0 (compatible; NavigatorHealthBot/1.0; +https://navigator.local)'

/** 补协议：站点表里的 url 多数是裸域名 */
export function normalizeTarget(url) {
  const s = String(url || '')
  return s.includes('://') ? s : `https://${s}`
}

/* ---------------- 注册表 ---------------- */

/**
 * 注册一个探针。同 id 覆盖（便于测试与热替换）。
 *
 * @param {{
 *   id: string,
 *   label?: string,
 *   order?: number,
 *   available?: () => boolean | Promise<boolean>,   // 该环境是否有此探针（如 curl 只在 Windows）
 *   run: (url: string, opts: object) => Promise<{ code: string, ms: number } | { unavailable: true, reason?: string }>,
 * }} spec
 */
export function registerProbe(spec) {
  if (!spec || !spec.id) throw new Error('探针必须提供 id')
  if (typeof spec.run !== 'function') throw new Error(`探针 ${spec.id} 缺少 run`)
  const entry = {
    id: String(spec.id),
    label: spec.label ? String(spec.label) : String(spec.id),
    order: Number.isFinite(spec.order) ? Number(spec.order) : 100 + seq,
    available: typeof spec.available === 'function' ? spec.available : () => true,
    run: spec.run,
  }
  seq += 1
  registry.set(entry.id, entry)
  return entry
}

/** 探针清单（供控制台/接口展示） */
export function listProbes({ check = true } = {}) {
  return [...registry.values()]
    .sort((a, b) => a.order - b.order)
    .map(p => ({ id: p.id, label: p.label, order: p.order, available: check ? Boolean(p.available()) : true }))
}

/**
 * 产出实际要跑的探针链。
 * 优先级：显式传入 → `NAV_HEALTH_PROBES` → 注册顺序；然后过滤掉当前环境不可用的。
 */
export function probeChain(explicit) {
  const all = [...registry.values()].sort((a, b) => a.order - b.order)
  const raw = explicit !== undefined && explicit !== null
    ? String(explicit)
    : String(process.env.NAV_HEALTH_PROBES || '')
  const ids = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  if (ids.length === 1 && ['none', 'off', '0'].includes(ids[0])) return []
  const matched = ids.map(id => all.find(p => p.id === id)).filter(Boolean)
  const chosen = matched.length ? matched : all
  return chosen.filter(p => p.available())
}

/**
 * 跑一次探测：取第一个**可用**的探针，拿到它的结论即返回。
 *
 * @returns {Promise<{ code: string, ms: number, probe: string } | null>}
 *          null 表示链上所有探针在当前环境都不可用（调用方决定怎么兜底）
 */
export async function runProbe(url, opts = {}) {
  const list = Array.isArray(opts.chain) ? opts.chain : probeChain()
  for (const p of list) {
    try {
      const out = await p.run(url, opts)
      if (!out || out.unavailable) continue          // 该探针在此环境不可用 → 换下一个
      if (typeof out.code === 'string') return { code: out.code, ms: Number(out.ms) || 0, probe: p.id }
    } catch { /* 探针自身出错 → 换下一个 */ }
  }
  return null
}

/* ---------------- 内建探针一：curl（Windows 本机，走系统代理） ---------------- */

/**
 * 单次 curl，只取 http_code。
 *
 * 关键：curl 超时（`--max-time`）会以非 0 码退出（exit 28），此时 `execFile` 的 Promise
 * 会 reject —— 但 `-w` 已经把 http_code 写进 stdout 了。若不从 error.stdout 取回，
 * 「HEAD 超时」就会被当成探测异常直接定性，GET 回落永远执行不到（曾导致 BlockBeats 误判）。
 */
async function curlCode(args, timeoutS) {
  try {
    const { stdout } = await pExecFile('curl.exe', args, {
      encoding: 'utf8', timeout: (timeoutS + 5) * 1000, windowsHide: true,
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

registerProbe({
  id: 'curl-http',
  label: 'curl（本机，走系统代理）',
  order: 100,
  /** curl.exe 与系统代理是本机（Windows）特有的；沙箱里应落到 fetch-http */
  available: () => process.platform === 'win32',
  run: async (url, { timeoutS = 12, proxy } = {}) => {
    // 显式指定代理，而不是依赖环境变量：代理端口会漂移，环境变量可能滞后
    const via = proxy !== undefined ? proxy : await resolveProxyUrl()
    const viaArgs = via ? ['--proxy', via] : []
    const target = normalizeTarget(url)
    const base = ['-s', '-o', 'NUL', '-w', '%{http_code}', '-L', '--max-time', String(timeoutS), ...viaArgs]
    const t0 = Date.now()
    // 先 HEAD 省流量；HEAD 不是 2xx/3xx 就用 GET 复核（大量站点不支持 HEAD）
    let code = await curlCode(['-I', ...base, target], timeoutS)
    if (!isReachable(code)) code = await curlCode([...base, target], timeoutS)
    return { code: code || 'ERR', ms: Date.now() - t0 }
  },
})

/* ---------------- 内建探针二：fetchCapped（跨平台，带 SSRF 防护） ---------------- */

registerProbe({
  id: 'fetch-http',
  label: 'fetchCapped（跨平台，SSRF 防护）',
  order: 200,
  available: () => typeof fetch === 'function',
  run: async (url, { timeoutMs = 6000, ua } = {}) => {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    const t0 = Date.now()
    try {
      const r = await fetchCapped(normalizeTarget(url), {
        signal: ctl.signal, headers: { 'user-agent': ua || DEFAULT_UA }, maxBytes: 2048,
      })
      return { code: String(r.status || 0), ms: Date.now() - t0 }
    } catch (e) {
      // BLOCKED_HOST = 命中 SSRF 防护（站址指向内网），按失效记录，不重试
      return { code: e && e.code === 'BLOCKED_HOST' ? 'BLOCKED' : 'ERR', ms: Date.now() - t0 }
    } finally { clearTimeout(timer) }
  },
})
