/**
 * 云端站点数据读取（被 sync / snapshots / gate 共用）。
 * 单独成文件是为了打断 sync ↔ gate ↔ snapshots 之间的循环依赖。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const pExecFile = promisify(execFile)

export const SITE_URL = 'https://navigator-v2-two.vercel.app'

/** 读取云端站点数据（带缓存穿透参数，绕过 CDN 缓存） */
export async function fetchCloud() {
  try {
    const { stdout } = await pExecFile('curl.exe', [
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