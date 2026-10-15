/**
 * 告警规则引擎：把「连续 N 次不可达才告警」从写死的常量变成可配置的规则表。
 *
 * ## 为什么要它能按站点分类
 *
 * 站点的「该多快报警」本来就不一样：交易所 / 支付类挂 5 分钟就是事故，
 * 而一个冷门工具站偶尔超时几轮无所谓。用同一个阈值，要么吵得没人看，要么真出事时被淹没。
 * 所以规则按 **host 精确 > 分类 > 全局兜底** 三级匹配，越具体越优先。
 *
 * ## 与自动归档的关系
 *
 * `server/cron.mjs` 的「连续失效自动归档」用的是**同一份 `fails` 计数**、**同一套阈值解析**：
 * 规则里给的 downThreshold 同时决定「何时告警」与「何时归档」。两处若各写一套，
 * 就会出现「提醒说没事、后台却已经把它归档了」这种自相矛盾。
 *
 * 纯函数 + 零依赖（只引同目录的 host），浏览器侧与 Node 侧都能直接用。
 */
import { hostOf } from './host.mjs'

export const DEFAULT_FALLBACK = { downThreshold: 2, cooldownMs: 6 * 3600e3 }

function toThreshold(v, fallback) {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n >= 1 ? n : fallback
}
function toCooldown(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** 单条规则归一：没有 match 条件的规则一律丢弃（那会无意中匹配所有站点） */
export function normalizeRule(input, i = 0) {
  if (!input || typeof input !== 'object') return null
  const match = {}
  if (input.match && input.match.categoryId) match.categoryId = String(input.match.categoryId)
  if (input.match && input.match.host) match.host = hostOf(input.match.host)
  if (!match.categoryId && !match.host) return null
  return {
    id: String(input.id || `rule-${i}`),
    label: String(input.label || '').slice(0, 40),
    enabled: input.enabled !== false,
    match,
    downThreshold: toThreshold(input.downThreshold, DEFAULT_FALLBACK.downThreshold),
    cooldownMs: toCooldown(input.cooldownMs, DEFAULT_FALLBACK.cooldownMs),
  }
}

/** 规则表归一：接受 `{rules, fallback}` 或裸数组；非法项丢弃而不是抛错（配置由人填） */
export function normalizeRules(input) {
  const list = Array.isArray(input?.rules) ? input.rules : (Array.isArray(input) ? input : [])
  const rules = list.map(normalizeRule).filter(Boolean)
  const fb = (input && input.fallback) || {}
  return {
    rules,
    fallback: {
      downThreshold: toThreshold(fb.downThreshold, DEFAULT_FALLBACK.downThreshold),
      cooldownMs: toCooldown(fb.cooldownMs, DEFAULT_FALLBACK.cooldownMs),
    },
  }
}

/**
 * 为某个站点挑出适用的阈值。优先级：host 精确 > 分类 > 全局兜底。
 * 同优先级下取**表里靠前**的那条（顺序即优先级，便于用户把特例写在前面）。
 */
export function ruleFor(site, config) {
  const cfg = config && config.rules ? config : normalizeRules(config)
  const host = hostOf(site && site.url)
  const cat = site && site.categoryId ? String(site.categoryId) : ''
  const active = cfg.rules.filter(r => r.enabled)
  if (host) {
    const hit = active.find(r => r.match.host && r.match.host === host)
    if (hit) return hit
  }
  if (cat) {
    const hit = active.find(r => r.match.categoryId && r.match.categoryId === cat)
    if (hit) return hit
  }
  return { id: 'fallback', label: '全局默认', match: {}, ...cfg.fallback }
}

/**
 * 评估一批健康判定，产出「达到阈值、应当告警」的站点。
 *
 * @param {{ results?: object, sites?: object[], config?: object }} args
 * @returns {{ id, name, url, fails, threshold, ruleId }[]}
 */
export function evaluateAlerts({ results, sites = [], config } = {}) {
  const cfg = normalizeRules(config)
  const byId = new Map((sites || []).map(s => [s.id, s]))
  const out = []
  for (const [id, r] of Object.entries(results || {})) {
    if (!r || r.status !== 'down') continue
    const site = byId.get(id) || { id, url: '' }
    const rule = ruleFor(site, cfg)
    const fails = Number(r.fails) || 0
    if (fails >= rule.downThreshold) {
      out.push({ id, name: site.name || id, url: site.url || '', fails, threshold: rule.downThreshold, ruleId: rule.id })
    }
  }
  return out
}
