/**
 * 部署端点注册表（N2）。
 *
 * 「端点」= 一个可部署目标：站点地址 + 该目标的 BotKeep workload 凭据。
 *
 * ## 向后兼容是第一位的
 *
 * 默认端点**直接沿用现有单端点配置**（`DEPLOY_SITE_URL` + `BOTKEEP_API_KEY`/`BOTKEEP_WORKLOAD_ID`）。
 * 不配任何额外端点时，`listEndpoints()` 只返回这一个，`resolveEndpoints([])` 也只选它 ——
 * 行为与「多端点」引入之前一字不差。
 *
 * ## 额外端点从哪来
 *
 * `.env.local` 里的 `NAV_DEPLOY_ENDPOINTS`（JSON 数组），例如：
 *   NAV_DEPLOY_ENDPOINTS='[{"id":"mirror","label":"镜像站","url":"https://mirror.example.com","workloadId":"wl-xxx","key":"bk-xxx"}]'
 * 凭据只存在于本地 `.env.local`（不入 git）。`publicEndpoints()` 是给**清单接口**用的，
 * **不含任何凭据材料**，只回「配没配」——线上后台据此展示端点，不会拿到密钥。
 */

const ENV_LIST = 'NAV_DEPLOY_ENDPOINTS'
const DEFAULT_URL = 'https://navigator-v2.bot-keep.xyz'

/** 默认端点：沿用既有的单端点配置 */
function defaultEndpoint() {
  return {
    id: 'default',
    label: '主站',
    url: (process.env.DEPLOY_SITE_URL || DEFAULT_URL).replace(/\/+$/, ''),
    workloadId: process.env.BOTKEEP_WORKLOAD_ID || '',
    key: process.env.BOTKEEP_API_KEY || process.env.BK_KEY || '',
  }
}

function normalize(e) {
  if (!e || typeof e !== 'object') return null
  const id = String(e.id || '').trim()
  if (!id || id === 'default') return null // 'default' 是保留 id，额外端点不得占用
  const url = String(e.url || '').trim().replace(/\/+$/, '')
  if (!url) return null
  return {
    id,
    label: String(e.label || id),
    url,
    workloadId: String(e.workloadId || ''),
    key: String(e.key || ''),
  }
}

function extraEndpoints() {
  const raw = process.env[ENV_LIST]
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.map(normalize).filter(Boolean) : []
  } catch {
    // 配置写坏了不能让整个控制台起不来：忽略额外端点，退回单端点
    return []
  }
}

/** 全部端点（默认端点在前），**含凭据** —— 仅供本机发布流程使用 */
export function listEndpoints() {
  return [defaultEndpoint(), ...extraEndpoints()]
}

/** 清单接口用的公开视图：不含凭据，只回「配没配」 */
export function publicEndpoints() {
  return listEndpoints().map(e => ({
    id: e.id,
    label: e.label,
    url: e.url,
    hasCredentials: Boolean(e.key && e.workloadId),
  }))
}

/**
 * 按 id 解析端点（单选 / 多选）。
 * @param {string[]} [ids] 端点 id 列表；空/未传 → 只取默认端点（向后兼容单端点行为）
 * @returns {{ok:boolean, endpoints?:object[], error?:string}}
 */
export function resolveEndpoints(ids) {
  const all = listEndpoints()
  if (!ids || !ids.length) return { ok: true, endpoints: [all[0]] }
  const wanted = [...new Set(ids.map(String))]
  const missing = wanted.filter(id => !all.some(e => e.id === id))
  if (missing.length) {
    return { ok: false, error: `未知端点：${missing.join('、')}（可用：${all.map(e => e.id).join('、')}）` }
  }
  return { ok: true, endpoints: all.filter(e => wanted.includes(e.id)) }
}
