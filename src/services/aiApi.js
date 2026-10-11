/**
 * AI 助手前端服务（P4）。
 *
 * 能力**只暴露服务端那三件**：润色、批量分类建议、巡检异常摘要。
 * 不做「AI 直接改数据」—— 落库一律由用户确认（见 api/ai.js 的边界说明）。
 *
 * key 不在这里、也不在任何前端产物里：请求只带管理凭据，模型配置与 key 全在服务端。
 * `probe()` 拿服务端的能力声明决定入口显不显示（未配置 → 隐藏，沿用 v8 的降级纪律）。
 */
import { getAdminKey } from './opsApi'

const BASE = '/api/ai'

let cached = null

/** 服务端是否配好了 AI（前端据此隐藏入口）。失败一律按「不可用」处理。 */
export async function probe() {
  if (cached) return cached
  try {
    const res = await fetch(BASE)
    const j = await res.json().catch(() => ({}))
    cached = { ready: Boolean(j.ready), model: String(j.model || '') }
  } catch {
    cached = { ready: false, model: '' }
  }
  return cached
}

async function post(body) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminKey() || ''}`, 'X-Nav-Key': getAdminKey() || '' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, error: data.error || `请求失败（${res.status}）` }
  return data
}

/** 名称/描述润色：返回 {name, desc}，由调用方填进表单 */
export const polish = (name, desc) => post({ action: 'polish', name, desc })

/**
 * 批量分类建议：sites 传 [{id,name,url,desc}]，categories 传现有分类 [{id,label}]。
 * 返回 suggestions：每项是 keep / use / new —— **建议而已**，落地要用户点确认。
 */
export const categorize = (sites, categories) => post({ action: 'categorize', sites, categories })

/** 巡检异常摘要：down 传 [{name,url}]，返回一段人话 */
export const summarize = (down) => post({ action: 'summarize', down })
/** 与 opsApi 同样的对象式导出（调用点统一 `aiApi.xxx()`） */
export const aiApi = { probe, polish, categorize, summarize }
