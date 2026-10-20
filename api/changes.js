/**
 * 变更日志端点 —— 「本地离线时云端的变化也能同步回来」的云端半边。
 *
 * ## 为什么需要这个端点
 *
 * 实时同步有两种做法，只有一种能覆盖「本地离线」：
 *
 * 1. **本机轮询比对**：本机每 N 秒拉一次全量，比对 etag。
 *    本机关机期间没有任何人在看，错过的变化**永久丢失** —— 只能靠事后
 *    一次全量重拉补救，而全量重拉在数据大时不可接受，也无法知道「哪里变了」。
 *
 * 2. **云端记账 + 本地追游标**：云端每次写入都记一条变更，本机回来时
 *    从上次的 `seq` 往后读。本机离线多久都不影响，变化一条都不会少。
 *
 * 这里实现第 2 种。日志由 `server/store.mjs` 在**对象写入的同一个事务**里落盘，
 * 所以不存在「数据写成功但日志没记」的静默漏记。
 *
 * ## 鉴权
 *
 * 变更日志里含对象名与大小（例如 `session/<key>.json` 会暴露设备标识），
 * 属于运维面信息，不对匿名访客开放 —— 与 `ops` / `backup` 同一口径。
 *
 * ## 为什么同时返回 `oldest` 和 `truncated`
 *
 * 日志有保留上限。调用方的游标如果比 `oldest` 还老，中间那段**永远补不回来**。
 * 这种情况必须显式告诉它「你落后太多，改走全量对齐」，
 * 而不是回一个空数组让它以为「没有变化」—— 那是最坏的一种静默失败。
 */
import { readChanges, changesInfo } from '#store'
import { checkAuthHeader } from '../shared/auth.mjs'

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
}

export default async function handler(req, res) {
  noStore(res)

  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed' })
    return
  }

  const auth = checkAuthHeader(req)
  if (!auth.ok) {
    res.status(auth.code).json({ ok: false, error: auth.error })
    return
  }

  const query = (req.query && typeof req.query === 'object') ? req.query : {}

  try {
    // 只读元信息：本地用它判断「要不要开始追」
    if (query.info !== undefined) {
      res.status(200).json({ ok: true, ...changesInfo() })
      return
    }

    const since = Number(query.since)
    if (!Number.isFinite(since) || since < 0) {
      res.status(400).json({ ok: false, error: 'since 必须是非负整数（首次同步传 0）' })
      return
    }
    const limit = Number(query.limit) || 500

    const r = readChanges({ since, limit })
    res.status(200).json({
      ok: true,
      since,
      head: r.head,
      oldest: r.oldest,
      truncated: r.truncated,
      hasMore: r.hasMore,
      // 游标已被裁剪时给出明确指引，而不是让调用方自己猜
      hint: r.truncated ? '游标落后于日志保留区间，请改走全量对齐（GET /api/backup?meta=1）' : null,
      items: r.items,
    })
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) })
  }
}
