/**
 * 云端站点数据读取（被 sync / snapshots / gate 共用）。
 * 单独成文件是为了打断 sync ↔ gate ↔ snapshots 之间的循环依赖。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, getAdminKey } from './env.mjs'
import { resolveProxyUrl } from '../../../shared/proxy.mjs'

const pExecFile = promisify(execFile)

export const SITE_URL = 'https://navigator-v2-two.vercel.app'

/** 解析代理并转成 curl 参数：探测不到则返回空数组（直连） */
async function proxyArgs() {
  const url = await resolveProxyUrl()
  return url ? ['--proxy', url] : []
}

/**
 * 把本机探活结果发布到云端 —— 前端状态角标 / 失效清单的唯一判定来源。
 *
 * 为什么必须由本机发布：判定要「以本地自带代理环境」为准。浏览器读不到跨域状态码，
 * 云端出网口在海外、与本机可达性不是一回事，只有本机的 curl.exe（走系统代理）才是真口径。
 *
 * 只上报事实（id / HTTP 码 / 耗时），status 由服务端按同一套规则重算。
 * @param {Array<{id:string,code:string|number,ms?:number}>} results
 * @returns {Promise<{ok:boolean,version?:number,counts?:object,error?:string}>}
 */
export async function publishHealth(results, { actor = 'console' } = {}) {
  const key = getAdminKey()
  if (!key) return { ok: false, error: '缺少 SITES_ADMIN_KEY，无法写入云端（请配置 .env.local）' }
  const list = (results || [])
    .filter(r => r && r.id)
    .map(r => ({ id: r.id, code: r.code, ms: r.ms }))
  if (!list.length) return { ok: false, error: '没有可发布的探活结果' }

  const proxy = await resolveProxyUrl()
  const via = proxy ? ['--proxy', proxy] : []
  const payload = join(ROOT, 'tmp-health-payload.json')
  try {
    writeFileSync(payload, JSON.stringify({ actor, proxy, results: list }), 'utf-8')
    const { stdout } = await pExecFile('curl.exe', [
      ...via,
      '-s', '--max-time', '60', '-X', 'POST', `${SITE_URL}/api/health`,
      '-H', 'Content-Type: application/json',
      '-H', `Authorization: Bearer ${key}`,
      '--data-binary', '@' + payload,
    ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true })
    const j = JSON.parse(stdout)
    if (!j.results) throw new Error(stdout.slice(0, 200) || '响应异常')
    return { ok: true, version: j.version, counts: j.counts, updatedAt: j.updatedAt }
  } catch (e) {
    return { ok: false, error: e.message }
  } finally {
    if (existsSync(payload)) rmSync(payload, { force: true })
  }
}

/** 读取云端当前判定（用于「云端 vs 本机」一致性核对） */
export async function fetchCloudHealth() {
  try {
    const { stdout } = await pExecFile('curl.exe', [
      ...await proxyArgs(),
      '-s', '--max-time', '30', `${SITE_URL}/api/health?t=${Date.now()}`,
    ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true })
    const j = JSON.parse(stdout)
    return {
      ok: true,
      version: j.version ?? 0,
      updatedAt: j.updatedAt || null,
      counts: j.counts || null,
      total: Object.keys(j.results || {}).length,
    }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

/** 读取云端站点数据（带缓存穿透参数，绕过 CDN 缓存） */
export async function fetchCloud() {
  try {
    const { stdout } = await pExecFile('curl.exe', [
      ...await proxyArgs(),
      '-s', '--max-time', '30', `${SITE_URL}/api/sites?t=${Date.now()}`,
    ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true })
    const j = JSON.parse(stdout)
    const sites = Array.isArray(j.sites) ? j.sites : []
    return {
      ok: true,
      version: j.version ?? null,
      count: sites.length,
      withIcons: sites.filter(s => s.icon).length,
      updatedAt: j.updatedAt || null,
      fetchedAt: Date.now(),
    }
  } catch (e) {
    return { ok: false, error: e.message, fetchedAt: Date.now() }
  }
}

/** 读取云端站点数据全文（回滚前的差异预览需要逐条比对，不止计数） */
export async function fetchCloudData() {
  try {
    const { stdout } = await pExecFile('curl.exe', [
      ...await proxyArgs(),
      '-s', '--max-time', '30', `${SITE_URL}/api/sites?t=${Date.now()}`,
    ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true })
    const j = JSON.parse(stdout)
    return {
      ok: true,
      version: j.version ?? null,
      sites: Array.isArray(j.sites) ? j.sites : [],
      updatedAt: j.updatedAt || null,
    }
  } catch (e) {
    return { ok: false, error: e.message, sites: [] }
  }
}