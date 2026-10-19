/**
 * 环境与路径：统一解析项目根目录与 .env.local
 * 本地控制台专用，不参与生产构建。
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ENV_VARS } from '../../../../shared/env-registry.mjs'

// tools/console/lib/ -> 项目根
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

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

/**
 * 环境变量配置概览（仅暴露是否已配置，不泄露值）。
 * 清单来自 shared/env-registry.mjs（唯一事实来源）—— 不再本地硬编码，
 * 避免「台账 7 条、代码 200+ 处」的两套账。
 */
export function envSummary() {
  loadEnv()
  return {
    envFileExists: existsSync(ENV_FILE),
    vars: ENV_VARS.map(v => ({
      name: v.name,
      scope: v.scope,
      required: Boolean(v.required),
      desc: v.desc,
      configured: Boolean(process.env[v.name]),
    })),
  }
}