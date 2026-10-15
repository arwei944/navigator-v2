/**
 * 环境与路径：统一解析项目根目录与 .env.local
 * 本地控制台专用，不参与生产构建。
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// tools/console/lib/ -> 项目根
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const ENV_FILE = join(ROOT, '.env.local')

let loaded = false

/** 把 .env.local 注入 process.env（不覆盖已存在的同名变量） */
export function loadEnv() {
  if (loaded) return
  loaded = true
  if (!existsSync(ENV_FILE)) return
  for (const line of readFileSync(ENV_FILE, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)="?([^"]*)"?$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2]
  }
}

/** 管理密钥：与 scripts/publish.mjs 同源，避免两处逻辑 */
export function getAdminKey() {
  loadEnv()
  return process.env.SITES_ADMIN_KEY || ''
}

/** 环境变量配置概览（仅暴露是否已配置，不泄露值） */
export function envSummary() {
  loadEnv()
  const names = [
    // 当前主链路真正需要这两组 —— 缺了 doctor 会说「未配置」，必须如实列出来
    'SITES_ADMIN_KEY', // 数据热更新 / 云端发布
    'BOTKEEP_API_KEY', // 部署到自有服务器（release run / deploy-botkeep）
    'BOTKEEP_WORKLOAD_ID',
    // 保留的旧通道 / 旧平台凭据（缺失不影响主流程，doctor 里恒为 ok）
    'BLOB_READ_WRITE_TOKEN',
    'VERCEL_TOKEN',
    'VERCEL_ORG_ID',
    'VERCEL_PROJECT_ID',
  ]
  return {
    envFileExists: existsSync(ENV_FILE),
    vars: names.map(name => ({ name, configured: Boolean(process.env[name]) })),
  }
}