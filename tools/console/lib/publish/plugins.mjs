/**
 * 控制台的插件管理：与站内 `/api/plugins` **同源**（都走 shared/plugin-registry.mjs），
 * 区别只在配置落哪儿与生效范围。
 *
 *   · 站内：配置存进站点库（`plugins.json`），影响线上那台机器。
 *   · 控制台：配置存进本机 `plugins.local.json`，影响**本机控制台进程** ——
 *     也就是控制台自己做站点抓取 / 翻译 / 探活时用的引擎链。
 *
 * 两者是不同的事实，不该互相覆盖：本机想用 siteprobe 抓取，
 * 不代表线上也该把抓取引擎切过去。
 *
 * 安全边界与站内完全一致：只能写 `WRITABLE_ENVS` 白名单内的变量，
 * **`NAV_SITE_STORE` 永不写** —— 存储是数据安全单点。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  pluginGroups, sanitizeOverrides, applyOverrides, currentOverrides, WRITABLE_ENVS,
} from '../../../../shared/plugin-registry.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const FILE = join(ROOT, 'plugins.local.json')
const SCHEMA = 1

function readStored() {
  try {
    const j = JSON.parse(readFileSync(FILE, 'utf8'))
    return (j && typeof j.overrides === 'object' && j.overrides) ? j.overrides : {}
  } catch {
    return {} /* 文件不在 / 坏掉都当没配过 —— 面板不该因此打不开 */
  }
}

function writeStored(overrides) {
  writeFileSync(FILE, JSON.stringify({
    schema: SCHEMA,
    updatedAt: new Date().toISOString(),
    _comment: '本机控制台的插件配置（不影响线上）。改这个文件后重启控制台生效，或在面板里改（即时生效）。',
    overrides,
  }, null, 2) + '\n', 'utf8')
}

/** 启动时应用一次；幂等 */
let applied = false
export function applyStored() {
  if (applied) return currentOverrides()
  applied = true
  const { ok } = sanitizeOverrides(readStored())
  applyOverrides(ok)
  return ok
}

/** 面板要的全部数据：引擎清单 + 当前生效的覆盖配置 */
export async function status() {
  applyStored()
  return {
    ok: true,
    groups: await pluginGroups({ check: true }),
    overrides: currentOverrides(),
    writable: [...WRITABLE_ENVS],
    file: FILE,
    at: new Date().toISOString(),
  }
}

/** 保存覆盖配置：清洗 → 落盘 → 应用（顺序刻意如此：写盘失败就不该改变运行期行为） */
export function save(incoming) {
  const { ok, rejected } = sanitizeOverrides(incoming)
  const merged = { ...readStored() }
  for (const [k, v] of Object.entries(ok)) {
    if (String(v ?? '').trim()) merged[k] = String(v).trim()
    else delete merged[k]
  }
  writeStored(merged)
  const applied = applyOverrides(ok)
  return { applied, rejected, overrides: currentOverrides() }
}

export const pluginsFile = () => FILE
export const fileExists = () => existsSync(FILE)
