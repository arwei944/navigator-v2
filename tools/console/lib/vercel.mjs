/**
 * Vercel 部署状态客户端。
 * 本机 Node fetch 不走系统代理，统一用 curl.exe（沿用项目约定）。
 * 未配置 VERCEL_TOKEN 时优雅降级：仅提供项目信息与输出解析，不做 API 轮询。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ROOT, loadEnv } from './env.mjs'

const pExecFile = promisify(execFile)
const API = 'https://api.vercel.com'

/** Vercel 部署状态机中文标签 */
export const STATE_LABEL = {
  QUEUED: '排队中',
  INITIALIZING: '初始化',
  BUILDING: '构建中',
  READY: '已就绪',
  ERROR: '部署失败',
  CANCELED: '已取消',
}

export function stateLabel(state) {
  return STATE_LABEL[state] || state || '未知'
}

/** 读取本地 .vercel/project.json（由 vercel CLI link 生成） */
export function projectInfo() {
  const file = join(ROOT, '.vercel', 'project.json')
  if (!existsSync(file)) return null
  try {
    const j = JSON.parse(readFileSync(file, 'utf-8'))
    return { projectId: j.projectId || '', orgId: j.orgId || '', projectName: j.projectName || '' }
  } catch {
    return null
  }
}

export function token() {
  loadEnv()
  return process.env.VERCEL_TOKEN || process.env.VERCEL_API_TOKEN || ''
}

/** 是否具备 REST API 查询能力（token + 项目信息齐备） */
export function available() {
  return Boolean(token() && projectInfo()?.projectId)
}

async function apiGet(path) {
  const t = token()
  if (!t) throw new Error('未配置 VERCEL_TOKEN，无法查询 Vercel API')
  const { stdout } = await pExecFile('curl.exe', [
    '-s', '--max-time', '30', `${API}${path}`,
    '-H', `Authorization: Bearer ${t}`,
  ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true })
  let j
  try { j = JSON.parse(stdout) } catch { throw new Error('Vercel API 返回非 JSON') }
  if (j.error) throw new Error(j.error.message || 'Vercel API 错误')
  return j
}

function shape(d) {
  return {
    id: d.uid || d.id,
    url: d.url ? `https://${d.url}` : '',
    state: d.readyState || d.state || '',
    target: d.target || '',
    createdAt: d.created || d.createdAt || 0,
    branch: d.meta?.githubCommitRef || '',
    commitSha: d.meta?.githubCommitSha || '',
    commitMessage: d.meta?.githubCommitMessage || '',
  }
}

export async function listDeployments(limit = 10) {
  const p = projectInfo()
  if (!p?.projectId) throw new Error('未找到 .vercel/project.json，无法定位项目')
  const q = new URLSearchParams({ projectId: p.projectId, limit: String(limit) })
  if (p.orgId) q.set('teamId', p.orgId)
  const j = await apiGet(`/v6/deployments?${q}`)
  return (j.deployments || []).map(shape)
}

export async function getDeployment(id) {
  const p = projectInfo()
  const q = new URLSearchParams({ withGitRepoInfo: 'true' })
  if (p?.orgId) q.set('teamId', p.orgId)
  return shape(await apiGet(`/v13/deployments/${encodeURIComponent(id)}?${q}`))
}

/** 从任意文本中提取最后一个 vercel 部署地址 */
export function extractDeploymentUrl(text) {
  const m = String(text).match(/https:\/\/[a-z0-9][a-z0-9-]*\.vercel\.app/gi)
  return m && m.length ? m[m.length - 1] : ''
}