/**
 * 云端数据快照：清单 / 读取 / 回滚。
 *
 * 快照由 api/sites.js 在每次热更新前自动落盘（写入前先备份将被覆盖的当前数据），
 * 因此这里只做「读 + 回滚」，不负责生成 —— 生成必须在服务端与写入同处，才不会被绕过。
 *
 * 网络一律走 curl.exe（本机 Node fetch 不走系统代理），与控制台其他模块同源。
 */
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ROOT, getAdminKey } from './env.mjs'
import { SITE_URL, fetchCloudData } from './cloud.mjs'
import { diffSites } from './changes.mjs'

const pExecFile = promisify(execFile)

function requireKey() {
  const key = getAdminKey()
  if (!key) throw new Error('缺少 SITES_ADMIN_KEY，无法访问云端快照（请配置 .env.local）')
  return key
}

async function callCloud(path, { method = 'GET', body = null, timeout = 60 } = {}) {
  const args = ['-s', '--max-time', String(timeout), '-X', method, `${SITE_URL}${path}`,
    '-H', `Authorization: Bearer ${requireKey()}`]
  if (body !== null) {
    args.push('-H', 'Content-Type: application/json', '--data-binary', JSON.stringify(body))
  }
  const { stdout } = await pExecFile('curl.exe', args, {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true,
  })
  let json
  try { json = JSON.parse(stdout) } catch { throw new Error(stdout.slice(0, 200) || '云端响应异常') }
  if (json.error) throw new Error(json.error)
  return json
}

/** 云端快照清单（新 → 旧） */
export async function listSnapshots() {
  const r = await callCloud('/api/sites?snapshots=1')
  // 旧版线上 API 不认识 snapshots 查询，会把普通站点数据当响应返回；
  // 这里显式区分「契约不符」与「真的没有快照」，否则会误报成「暂无快照」。
  if (!Number.isFinite(r.count) || !Array.isArray(r.snapshots)) {
    throw new Error('线上 /api/sites 尚未支持快照接口，请先发布 V5 代码后再使用快照与回滚')
  }
  return { keep: r.keep, count: r.count, snapshots: r.snapshots }
}

/** 读取单份快照的完整内容（含 sites 数组，用于回滚前预览差异） */
export async function readSnapshot(pathname) {
  return callCloud(`/api/sites?snapshot=${encodeURIComponent(pathname)}`)
}

/**
 * 把指定快照写回云端主 pathname。
 * 服务端会先把「回滚前的当前数据」也存一份快照，并让 version 继续递增（不回退计数）。
 */
export async function rollbackTo(pathname) {
  return callCloud('/api/sites', { method: 'POST', body: { action: 'rollback', snapshot: pathname } })
}

/**
 * 回滚预演：算出「当前云端 → 目标快照」会增删改哪些站点，不写任何东西。
 * 方向按「回滚动作」描述：将移除 = 当前有、快照没有；将恢复 = 快照有、当前没有。
 */
export async function previewRollback(pathname) {
  const [snapshot, current] = await Promise.all([readSnapshot(pathname), fetchCloudData()])
  if (!current.ok) throw new Error(`读取当前云端数据失败：${current.error}`)
  const before = current.sites || []
  const after = Array.isArray(snapshot.sites) ? snapshot.sites : []
  const diff = diffSites(before, after)
  return {
    pathname,
    snapshotVersion: snapshot.version ?? null,
    currentVersion: current.version ?? null,
    currentCount: before.length,
    snapshotCount: after.length,
    willRemove: diff.removed,
    willRestore: diff.added,
    willRevert: diff.modified,
  }
}

/** 本地 backups/ 目录的快照镜像（不上云，仅作本机对照） */
export function localBackups(limit = 20) {
  const dir = join(ROOT, 'backups')
  let names = []
  try { names = readdirSync(dir).filter(n => /^sites-data-.*\.json$/.test(n)) } catch { return { count: 0, items: [] } }
  const items = names.sort().reverse().slice(0, limit).map(name => {
    let size = null
    try { size = statSync(join(dir, name)).size } catch { /* 读不到大小不影响列表 */ }
    return { name, size }
  })
  return { count: names.length, items }
}