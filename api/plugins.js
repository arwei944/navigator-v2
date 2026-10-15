/**
 * 插件管理：把 9 个引擎模块的注册表聚合成后台「插件」面板的数据面。
 *
 * ## 两个动作
 *
 *   GET  → 列出全部插件组（providers / 当前生效 / 可用性 / 职责）
 *   POST → 改运行期配置（白名单内的 NAV_* 变量），写 process.env 即时生效并持久化
 *
 * ## 为什么要求鉴权
 *
 * 插件配置决定「站点怎么抓、怎么翻、AI 走哪个后端」——这是管理动作，
 * 不是浏览动作。因此 GET 也要求 Bearer（登录会话 token 或 SITES_ADMIN_KEY），
 * 与 `/api/ops` 一致，不对匿名访客开放。
 *
 * ## 持久化与生效时机
 *
 * 配置落在 `plugins.json`（与站点库同库）。它由 `server/main.mjs` 在**启动时**应用，
 * 这里则在每次请求前兜一次底（`ensureApplied`）—— 覆盖「沙箱每请求新进程」的部署形态。
 * 应用是幂等的：同一次进程里只读一次文件。
 *
 * 安全边界见 `shared/plugin-registry.mjs` 的 `WRITABLE_ENVS`：**`NAV_SITE_STORE` 永不落盘、
 * 永不写入** —— 存储是数据安全单点，一次误设就会用种子覆盖线上真实数据。
 */
import { get, put } from '#store'
import { checkAuthHeader } from '../shared/auth.mjs'
import {
  pluginGroups, sanitizeOverrides, applyOverrides, currentOverrides, WRITABLE_ENVS,
} from '../shared/plugin-registry.mjs'

const PATH = 'plugins.json'
const SCHEMA = 1

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
}

function authorized(req) {
  return checkAuthHeader(req)
}

/** `req.body` 在 Vercel 下是对象、在自建服务里是原始字符串（见 server/main.mjs 的 attachBody） */
function readJsonBody(req) {
  const b = req.body
  if (!b) return {}
  if (typeof b === 'object') return b
  try { return JSON.parse(String(b)) } catch { return {} }
}

/* ---------------- 覆盖层持久化 ---------------- */

async function readStored() {
  try {
    const blob = await get(PATH, { access: 'private', useCache: false })
    if (!blob || !blob.stream) return {}
    const j = JSON.parse(await new Response(blob.stream).text())
    return (j && typeof j.overrides === 'object' && j.overrides) ? j.overrides : {}
  } catch {
    return {} /* 读不到就当没配过 —— 与站点库一致：坏数据不该让面板打不开 */
  }
}

async function writeStored(overrides) {
  await put(PATH, JSON.stringify({
    schema: SCHEMA,
    updatedAt: new Date().toISOString(),
    overrides,
  }), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  })
}

/** 只留白名单内、且值非空的项（落盘的永远是「干净的」配置） */
function persistable(map) {
  const out = {}
  for (const [k, v] of Object.entries(map || {})) {
    if (WRITABLE_ENVS.has(k) && String(v ?? '').trim()) out[k] = String(v).trim()
  }
  return out
}

/* ---------------- 启动时应用（供 server/main.mjs 调用） ---------------- */

let applied = false

/**
 * 把持久化的覆盖配置应用到 process.env。幂等 —— 同一次进程里只做一次。
 * 单测里可用 `__resetApplied()` 重置。
 */
export async function ensureApplied() {
  if (applied) return currentOverrides()
  applied = true
  const stored = await readStored()
  const { ok } = sanitizeOverrides(stored)
  applyOverrides(ok)
  return ok
}

/** 仅供测试：让下一次 ensureApplied 重新读库 */
export function __resetApplied() { applied = false }

/* ---------------- handler ---------------- */

export default async function handler(req, res) {
  noStore(res)

  const auth = authorized(req)
  if (!auth.ok) { res.status(auth.code).json({ ok: false, error: auth.error }); return }

  if (req.method === 'GET') {
    await ensureApplied()
    const groups = await pluginGroups({ check: true })
    return res.status(200).json({
      ok: true,
      groups,
      overrides: currentOverrides(),
      writable: [...WRITABLE_ENVS],
      at: new Date().toISOString(),
    })
  }

  if (req.method === 'POST') {
    const body = readJsonBody(req)
    const incoming = body && typeof body.overrides === 'object' ? body.overrides : null
    if (!incoming) {
      return res.status(400).json({ ok: false, error: '缺少 overrides 对象' })
    }

    const { ok, rejected } = sanitizeOverrides(incoming)
    if (!Object.keys(ok).length && rejected.length) {
      return res.status(422).json({ ok: false, error: '全部配置项被拒绝', rejected })
    }

    /* 先落盘、再应用：写库失败就不该改变运行期行为（否则刷新一次就丢） */
    const merged = { ...(await readStored()), ...persistable(ok) }
    for (const [k, v] of Object.entries(ok)) if (!String(v ?? '').trim()) delete merged[k]
    try {
      await writeStored(merged)
    } catch (e) {
      return res.status(503).json({ ok: false, error: `配置持久化失败：${e.message}`, rejected })
    }

    const appliedNow = applyOverrides(ok)
    const groups = await pluginGroups({ check: false })

    return res.status(200).json({
      ok: true,
      applied: appliedNow,
      rejected,
      overrides: currentOverrides(),
      groups,
      at: new Date().toISOString(),
    })
  }

  res.statusCode = 405
  res.setHeader('Allow', 'GET, POST')
  return res.json({ ok: false, error: 'Method not allowed' })
}
