/**
 * 数据管理插件的前端封装。
 *
 * 与 `/api/plugins` 同一套凭据（sessionStorage 里的会话 token，回退共享密钥）。
 * 体检报告包含完整站点清单与运维指标，属于管理动作，不对匿名开放。
 *
 * 修复**不在这里写库** —— `plan()` 只拿回计划与 `nextSites`，落库仍走
 * `POST /api/sites`（CAS + 写前快照 + sanitizeSites 门禁）。这样数据管理插件
 * 永远不可能成为第二条写通道。
 */
import { getAdminKey } from './opsApi'

const BASE = '/api/data-manager'

function headers(key) {
  const k = key || getAdminKey()
  return k
    ? { Authorization: `Bearer ${k}`, 'X-Nav-Key': k }
    : null
}

async function call(method, body, key, query = '') {
  const h = headers(key)
  if (!h) return { ok: false, error: '未登录' }
  const res = await fetch(BASE + query, {
    method,
    headers: { ...h, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) window.dispatchEvent(new CustomEvent('nav-auth-expired'))
  if (!res.ok) return { ok: false, error: data.error || `请求失败（${res.status}）`, rejected: data.rejected || [] }
  return { ok: true, ...data }
}

/** 下载走二进制流：接口用 Content-Disposition 给文件名，前端负责落盘 */
async function fetchFile(search, key) {
  const h = headers(key)
  if (!h) throw new Error('未登录')
  const res = await fetch(`${BASE}?${search}`, { headers: h })
  if (res.status === 401) window.dispatchEvent(new CustomEvent('nav-auth-expired'))
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new Error(j.error || `导出失败（${res.status}）`)
  }
  const disp = res.headers.get('Content-Disposition') || ''
  const m = /filename="([^"]+)"/.exec(disp)
  const blob = await res.blob()
  return { blob, filename: m ? m[1] : 'nav-download' }
}

async function download(kind, { categoryId = '', domain = '' } = {}, key) {
  const qs = new URLSearchParams({ export: kind })
  if (categoryId) qs.set('categoryId', categoryId)
  if (domain) qs.set('domain', domain)
  return fetchFile(qs.toString(), key)
}

export const dataManagerApi = {
  /** 完整体检报告（含逐条缺失清单） */
  report: (key) => call('GET', null, key),

  /** 只要汇总数字 —— 仪表盘卡片用，不拉逐条清单 */
  summary: (key) => call('GET', null, key, '?summary=1'),

  /**
   * 生成修复计划（不写库）。
   * @param {{actions?:object, reassign?:object, markManual?:string[]}} body
   */
  plan: (key, body) => call('POST', { mode: 'plan', ...body }, key),

  /**
   * 导入预检（不写库）。
   * @param {{text:string, format?:'auto'|'csv'|'json', strategy?:'skip'|'overwrite'|'new-id'}} body
   */
  importPlan: (key, body) => call('POST', { mode: 'import', ...body }, key),

  /** 导出站点数据 JSON / CSV，返回 `{ blob, filename }` */
  download,

  /** 导出体检报告 markdown / json，返回 `{ blob, filename }` */
  downloadReport: (kind, key) => fetchFile(`report=${encodeURIComponent(kind)}`, key),

  /** 体检趋势点（摘要序列） */
  history: (key) => call('GET', null, key, '?history=1'),

  /** 记录一次当前体检摘要（服务端计算，不接受前端数字） */
  record: (key) => call('POST', { mode: 'history' }, key),

  /** 重复站点分组（合并向导用） */
  duplicates: (key) => call('GET', null, key, '?duplicates=1'),

  /**
   * 生成合并计划（不写库）。
   * @param {object} choices { [groupKey]: { keepId, fields: { desc: id } } }
   */
  mergePlan: (key, choices) => call('POST', { mode: 'merge', choices }, key),
}
