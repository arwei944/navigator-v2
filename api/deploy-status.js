/**
 * 部署状态：线上这台机器自述「跑的是哪次构建、跑得怎么样」。
 *
 * ## 它回答什么
 *
 * 页面下方那行「已部署 v?.?」和后台的「部署」面板都读这一处。关键是要能区分三个
 * **不同的事实**，混在一起就会出现「明明刚构建过却说已是最新」这类误导：
 *   1. 线上正在跑的构建 —— 来自部署包根目录的 `build-info.json`（构建时写入，随包走）
 *   2. 当前进程的运行时状态 —— uptime / 内存 / Node 版本
 *   3. 数据与巡检的状态 —— 站点库版本、定时巡检的最近一次结果
 *
 * ## 为什么公开（不带鉴权）
 *
 * 后台「部署」面板要在**登录之前**就能显示这行状态（否则用户连自己在连哪一版都不知道）。
 * 因此这里只放**非敏感**事实，并且刻意不含：
 *   · 任何凭据材料（密钥、口令哈希、指纹一律不出现，那是 `/api/_diag` 的职责，那条链路本身就是排障出口）
 *   · 数据目录里的**文件名**（只回汇总的字节数与文件数）
 *   · 站点条目内容（只回数量与版本号）
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { get } from '#store'
import * as cronMod from '#cron'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function noStore(res) {
  // 状态就是「此刻」的事实：任何缓存都会让它撒谎
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
}

/** 构建信息：不在（本地开发、旧部署包）时返回 available:false，而不是编一个假的出来 */
function buildInfo() {
  try {
    const j = JSON.parse(readFileSync(join(ROOT, 'build-info.json'), 'utf8'))
    return {
      available: true,
      schema: Number(j.schema) || 1,
      sha: String(j.sha || ''),
      shortSha: String(j.shortSha || ''),
      branch: String(j.branch || ''),
      dirty: Boolean(j.dirty),
      subject: String(j.subject || ''),
      builtAt: j.builtAt || null,
    }
  } catch {
    return { available: false, schema: 1, sha: '', shortSha: '', branch: '', dirty: false, subject: '', builtAt: null }
  }
}

/** data/ 目录的**汇总**体积：只回数字，绝不回文件名 */
function storageInfo(dir = join(ROOT, 'data')) {
  let bytes = 0
  let files = 0
  const walk = (d) => {
    let entries
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory()) { walk(p); continue }
      try { bytes += statSync(p).size; files++ } catch { /* 读不到就跳过，状态接口不能因为一个文件失败 */ }
    }
  }
  walk(dir)
  return { bytes, files }
}

/** 站点库的版本与数量 —— 「数据是不是也被更新过」是部署之后最常被问的下一个问题 */
async function dataInfo() {
  try {
    const blob = await get('sites.json', { access: 'private', useCache: false })
    if (!blob || !blob.stream) return { available: false }
    const data = JSON.parse(await new Response(blob.stream).text())
    return {
      available: true,
      siteCount: Array.isArray(data.sites) ? data.sites.length : 0,
      version: Number(data.version) || 0,
      updatedAt: data.updatedAt || null,
    }
  } catch {
    return { available: false }
  }
}

export default async function handler(req, res) {
  noStore(res)
  if (req.method !== 'GET') {
    res.statusCode = 405
    return res.json({ ok: false, error: 'Method not allowed' })
  }

  const mem = process.memoryUsage()
  const cron = cronMod.status || {}
  const data = await dataInfo()
  const storage = storageInfo()

  return res.json({
    ok: true,
    version: buildInfo(),
    runtime: {
      node: process.versions.node,
      platform: process.platform,
      uptimeSec: Math.round(process.uptime()),
      rssMb: +(mem.rss / 1048576).toFixed(1),
      heapUsedMb: +(mem.heapUsed / 1048576).toFixed(1),
      // 端口是排查「域名打到哪个进程」的第一手线索（BotKeep 会动态分配 SERVER_PORT）
      port: Number(process.env.PORT || process.env.SERVER_PORT) || 0,
      // 沙箱部署每个请求可能是新进程（uptime≈0）；长驻托管则持续增长。
      // 前端据此决定要不要显示「运行时长」——恒为 0 的计时器没有意义
      persistent: process.uptime() > 30,
    },
    data,
    storage,
    cron: {
      enabled: Boolean(cron.enabled),
      started: Boolean(cron.started),
      running: Boolean(cron.running),
      phase: cron.lastPhase || '',
      lastRunAgoSec: cron.lastRunAt ? Math.round((Date.now() - cron.lastRunAt) / 1000) : null,
      lastCount: Number(cron.lastCount) || 0,
      lastError: cron.lastError || '',
    },
    checkedAt: new Date().toISOString(),
  })
}
