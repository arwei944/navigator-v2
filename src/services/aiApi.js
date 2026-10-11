/**
 * AI 助手前端服务（P4，v11 扩：润色免鉴权）。
 *
 * 能力**只暴露服务端那三件**：润色、批量分类建议、巡检异常摘要。
 * 不做「AI 直接改数据」—— 落库一律由用户确认（见 api/ai.js 的边界说明）。
 *
 * key 不在这里、也不在任何前端产物里：模型配置与 key 全在服务端。
 * `probe()` 拿服务端的能力声明决定入口显不显示（未配置 → 隐藏，沿用 v8 的降级纪律）。
 *
 * ## 免鉴权动作（v11）
 *
 * `polish` 服务端已开放给所有访客（按 IP 指纹限每日额度），**请求不再带管理凭据**。
 * 此前一律带 admin key 的后果是：没有管理 key 的人点「AI 润色」必定失败，
 * 而失败文案只说「请求失败」—— 看起来像功能坏了，实际是鉴权把普通用户挡在门外。
 * 批量分类与巡检摘要仍是管理作业，继续走凭据。
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
    const pub = Array.isArray(j.publicActions) ? j.publicActions : []
    cached = {
      ready: Boolean(j.ready),
      model: String(j.model || ''),
      publicActions: pub,
      // 「能不能润色」= 服务端配好了 **且** 服务端声明润色免鉴权。
      // 只看 ready 会让旧部署（还没放开 publicActions）依然显示一个点了就失败的按钮。
      canPolish: Boolean(j.ready) && pub.includes('polish'),
    }
  } catch {
    cached = { ready: false, model: '', publicActions: [], canPolish: false }
  }
  return cached
}

async function post(body, { isPublic = false } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  // 免鉴权动作刻意不带凭据：带了反而在没有 key 的设备上失败（见文件头）。
  // 管理动作仍双头并发（Authorization 供本机直连，X-Nav-Key 供沙箱网关）。
  const key = isPublic ? '' : (getAdminKey() || '')
  if (key) {
    headers.Authorization = `Bearer ${key}`
    headers['X-Nav-Key'] = key
  }
  const res = await fetch(BASE, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, error: data.error || `请求失败（${res.status}）` }
  return data
}

/** 名称/描述润色：返回 {name, desc}，由调用方填进表单。免鉴权，服务端按 IP 限额度。 */
export const polish = (name, desc) => post({ action: 'polish', name, desc }, { isPublic: true })

/**
 * 批量分类建议：sites 传 [{id,name,url,desc}]，categories 传现有分类 [{id,label}]。
 * 返回 suggestions：每项是 keep / use / new —— **建议而已**，落地要用户点确认。
 */
export const categorize = (sites, categories) => post({ action: 'categorize', sites, categories })

/** 巡检异常摘要：down 传 [{name,url}]，返回一段人话 */
export const summarize = (down) => post({ action: 'summarize', down })
/** 与 opsApi 同样的对象式导出（调用点统一 `aiApi.xxx()`） */
export const aiApi = { probe, polish, categorize, summarize }
