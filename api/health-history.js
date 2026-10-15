/**
 * 站点可用性与响应时间的历史曲线数据（公开只读）。
 *
 * 与 `/api/deploy-status` 同一档：响应体里**没有任何站点内容** —— 只有聚合计数
 * （总数 / 正常 / 限流 / 需处理）与平均耗时，供页面画趋势图。所以无需鉴权，
 * 页面角标在没有登录态时也能显示「最近一周可用率」。
 *
 * 数据由服务端巡检（`server/cron.mjs#appendHistoryPoint`）写入 `ops/health-history.json`，
 * 每跑完一轮追加一个点。**不做实时计算**：这是时间序列，没有历史就没有曲线 ——
 * 首次部署后需要一段时间积累（这一点在 UI 上会如实说明，不假装有数据）。
 */
import { get } from '#store'

const PATH = 'ops/health-history.json'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=60')

  if (req.method !== 'GET') {
    res.statusCode = 405
    res.setHeader('Allow', 'GET')
    return res.json({ ok: false, error: 'Method not allowed' })
  }

  let points = []
  try {
    const blob = await get(PATH, { access: 'private' })
    if (blob && blob.stream) {
      const j = JSON.parse(await new Response(blob.stream).text())
      points = Array.isArray(j.points) ? j.points : []
    }
  } catch { /* 读不到就是还没有历史 */ }

  return res.json({ ok: true, points, total: points.length })
}
