/**
 * 告警规则：后台「偏好设置」里可配的阈值表（按分类 / 域名给不同的「连续几次不可达才报警」）。
 *
 * ## 两个动作
 *
 *   GET  → 读当前规则（归一后的 config，另附原始存储便于排查）
 *   POST → **整体替换**规则表（不做局部 patch：规则表是有序的，顺序即优先级，
 *          局部合并会让「特例写在前面」这条语义悄悄漂移）
 *
 * ## 与插件接口的差异
 *
 * 插件配置是**运行期开关**（改了要 applyOverrides 即时生效、要落 process.env），
 * 而告警规则是**纯数据** —— 只影响「何时提醒你」，不影响站点怎么跑。所以这里读的时候现读，
 * 不需要那套「启动时应用」的机制。
 *
 * ## 鉴权
 *
 * 与 `/api/plugins`、`/api/ops` 一致：GET 也要求 Bearer。规则表本身会暴露
 * 「你在意哪些站点、盯得多紧」，不是匿名可读的内容。
 *
 * 存储与站点库同库（`alert-rules.json`），不入部署包 —— 它是运行期配置，不是种子数据。
 */
import { get, put } from '#store'
import { checkAuthHeader } from '../shared/auth.mjs'
import { normalizeRules } from '../shared/alert-rules.mjs'

const PATH = 'alert-rules.json'

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
}

/** `req.body` 在 Vercel 下是对象、在自建服务里是原始字符串（见 server/main.mjs 的 attachBody） */
function readJsonBody(req) {
  const b = req.body
  if (!b) return {}
  if (typeof b === 'object') return b
  try { return JSON.parse(String(b)) } catch { return {} }
}

async function readStored() {
  try {
    const blob = await get(PATH, { access: 'private', useCache: false })
    if (!blob || !blob.stream) return null
    return JSON.parse(await new Response(blob.stream).text())
  } catch {
    return null /* 读不到就当没配过 —— 坏数据不该让面板打不开 */
  }
}

export default async function handler(req, res) {
  noStore(res)

  const auth = checkAuthHeader(req)
  if (!auth || auth.ok === false) {
    res.status(auth?.code || 401).json({ ok: false, error: auth?.error || 'Unauthorized' })
    return
  }

  if (req.method === 'GET') {
    const stored = await readStored()
    return res.status(200).json({ ok: true, config: normalizeRules(stored), stored })
  }

  if (req.method === 'POST') {
    const body = readJsonBody(req)
    const config = normalizeRules(body)
    await put(PATH, JSON.stringify(config), {
      access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json',
    })
    return res.status(200).json({ ok: true, config, savedAt: new Date().toISOString() })
  }

  res.statusCode = 405
  res.setHeader('Allow', 'GET, POST')
  return res.json({ ok: false, error: 'Method not allowed' })
}
