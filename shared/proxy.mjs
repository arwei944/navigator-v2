/**
 * 本机代理环境：所有走代理的出网请求（curl.exe）的唯一口径来源。
 *
 * 为什么要在代码层探测端口：curl.exe 默认只认环境变量里的代理，而 Clash Verge
 * 这类工具的端口会漂移（7897 → 7900）。环境变量一旦滞后，所有依赖代理的请求会
 * 成批失败 —— 探活会把整站误判为「需处理」，发布/抓取也会整体报错。
 * 这里主动探测**实际正在监听**的端口，并让调用方显式使用它（或写回 process.env
 * 供 curl.exe 继承），从而彻底免疫端口漂移。
 *
 * 口径优先级：
 *   1) 环境变量里的端口若真的在监听 → 用环境变量（尊重用户显式配置）
 *   2) 否则扫描常见代理端口，命中即用
 *   3) 都没有 → 返回空串，调用方按「不走代理」处理
 */
import net from 'node:net'

const HOST = '127.0.0.1'

/**
 * 常见本地代理端口，按流行度排序，命中即止。
 * 只收录代理工具的高频默认口（Clash 系 / v2ray 系 / SOCKS），
 * 刻意不收 8080、8888 这类常被开发服务器占用的端口，避免误认。
 */
const COMMON_PORTS = [7890, 7897, 7900, 7899, 7891, 10809, 10808, 1080, 2080]

/** 探测结果缓存：代理端口切换后最多 30s 内自动跟上，无需重启控制台 */
const TTL_MS = 30_000
let cache = { at: 0, url: '' }

/** 环境变量里的代理原文（大小写都认，优先 https） */
function envProxy() {
  return String(
    process.env.https_proxy || process.env.HTTPS_PROXY ||
    process.env.http_proxy || process.env.HTTP_PROXY || ''
  )
}

/** 从代理 URL 里取出端口号，取不到返回 null */
export function portOf(url) {
  const m = String(url || '').match(/:(\d+)\/?$/)
  return m ? Number(m[1]) : null
}

/** 端口是否已有服务在监听（能建立连接即视为被占用） */
function isListening(port, timeout = 250) {
  return new Promise(resolve => {
    const sock = net.connect({ host: HOST, port })
    const done = ok => { sock.destroy(); resolve(ok) }
    sock.setTimeout(timeout)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
  })
}

/**
 * 探测本机代理，返回形如 `http://127.0.0.1:7900` 的 URL；探测不到返回空串。
 * 结果带 30s 缓存，`force:true` 可跳过缓存强制重探。
 */
export async function resolveProxyUrl({ force = false } = {}) {
  // 用 cache.at 作为「已解析过」的标记：连「没有代理」这个结果也要缓存，
  // 否则每次调用都会把常见端口重扫一遍
  if (!force && cache.at && Date.now() - cache.at < TTL_MS) return cache.url
  const raw = envProxy()
  const envPort = portOf(raw)
  let url = ''
  if (envPort && await isListening(envPort)) {
    url = raw
  } else {
    for (const port of COMMON_PORTS) {
      if (await isListening(port)) { url = `http://${HOST}:${port}`; break }
    }
  }
  cache = { at: Date.now(), url }
  return url
}

/**
 * 把探测到的代理写回 process.env —— curl.exe 会继承子进程环境，
 * 因此这一处即可让所有既有 curl 调用点（发布 / 抓取 / 通知 / 快照）
 * 一并免疫端口漂移，无需逐个改造。
 *
 * 探测不到时**不动**环境变量：宁可按原样交给 curl，也不误删用户可能有效的配置。
 */
export async function applyProxyEnv() {
  const url = await resolveProxyUrl()
  if (!url) return ''
  for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY']) process.env[k] = url
  return url
}