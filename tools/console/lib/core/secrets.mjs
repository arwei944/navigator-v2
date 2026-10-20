/**
 * 密钥管理：状态读取、写入、连通性验证。
 *
 * 设计要点：
 *   1. **读值只在本模块内发生**，对外只回掩码与形态判定 —— 面板与 API 层拿不到完整值。
 *   2. 写入统一走 `.env.local`（已 gitignore），并按行 upsert，保留其余行与注释。
 *   3. 「验证」是**主动问平台**，不是看格式像不像。格式体检（secrets-registry）只是前置过滤，
 *      真正能回答「这把 key 还有效吗」的只有平台本身。
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, loadEnv } from './env.mjs'
import { SECRETS, groupedSecrets, findSecret, inspectShape, maskSecret } from '../../../../shared/secrets-registry.mjs'

const ENV_FILE = join(ROOT, '.env.local')

/** 当前值（仅内部使用，绝不外传） */
function readValue(key) {
  loadEnv()
  const meta = findSecret(key)
  const names = [key, ...((meta?.aliases) || [])]
  for (const n of names) {
    const v = process.env[n]
    if (v) return { value: String(v), from: n }
  }
  return { value: '', from: '' }
}

/**
 * 面板用的完整状态。
 * 每项包含：登记元信息 + 是否已配置 + 掩码 + 形态问题 + 来源变量名。
 * **不包含完整值**。
 */
export function status() {
  const groups = groupedSecrets().map(g => ({
    platform: g.platform,
    label: g.label,
    items: g.items.map(s => {
      const { value, from } = readValue(s.key)
      const shape = inspectShape(s.key, value)
      return {
        key: s.key,
        label: s.label,
        required: Boolean(s.required),
        where: s.where,
        scope: s.scope,
        rotate: Boolean(s.rotate),
        aliases: s.aliases || [],
        configured: Boolean(value),
        // 只回后 4 位：足够辨认「配的是哪一把」，不足以复用
        masked: maskSecret(value),
        viaAlias: from && from !== s.key ? from : '',
        shapeOk: shape.ok,
        shapeProblems: shape.problems,
        length: value.length,
      }
    }),
  }))

  const flat = groups.flatMap(g => g.items)
  return {
    groups,
    summary: {
      total: flat.length,
      configured: flat.filter(i => i.configured).length,
      missingRequired: flat.filter(i => i.required && !i.configured).map(i => i.key),
      shapeIssues: flat.filter(i => i.configured && !i.shapeOk).map(i => i.key),
    },
    envFile: { path: ENV_FILE, exists: existsSync(ENV_FILE) },
  }
}

/**
 * 写入一组密钥。
 *
 * 传 `''` 表示清空该行（不是「写一个空值」）—— 这与 `saveCredentials` 的既有语义一致。
 * 写入前先做形态体检：**形态不对直接拒绝**，而不是写进去再让用户在别处遇到 401。
 * 需要强制写入时传 `{ force: true }`（例如平台确实用了非标准前缀）。
 */
export function save(entries, { force = false } = {}) {
  const rejected = []
  const applied = []
  const clean = {}

  for (const [key, raw] of Object.entries(entries || {})) {
    const meta = findSecret(key)
    if (!meta) { rejected.push({ key, reason: '未在 secrets-registry 登记，拒绝写入（防止随手加变量）' }); continue }
    const value = String(raw ?? '').trim()
    if (value) {
      const shape = inspectShape(key, value)
      if (!shape.ok && !force) { rejected.push({ key, reason: shape.problems.join('；') }); continue }
    }
    clean[meta.key] = value
  }

  if (rejected.length) return { ok: false, rejected, applied: [] }
  if (!Object.keys(clean).length) return { ok: true, applied: [], rejected: [] }

  let text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : ''
  const upsert = (name, value) => {
    if (!value) {
      text = text.split(/\r?\n/).filter(l => !new RegExp(`^${name}=`).test(l)).join('\n')
      return
    }
    // 值里若含空格等需要引号的情况，统一用双引号包起来（.env 解析器支持）
    const needQuote = /\s/.test(value)
    const line = `${name}=${needQuote ? `"${value}"` : value}`
    const re = new RegExp(`^${name}=.*$`, 'm')
    text = re.test(text) ? text.replace(re, line) : (text.replace(/\s*$/, '') + '\n' + line + '\n')
  }

  for (const [key, value] of Object.entries(clean)) {
    upsert(key, value)
    // 让当前进程立刻生效，不必重启控制台
    if (value) process.env[key] = value
    else delete process.env[key]
    applied.push({ key, cleared: !value })
  }

  if (!existsSync(join(ROOT, '.env.local'))) mkdirSync(ROOT, { recursive: true })
  writeFileSync(ENV_FILE, text)
  return { ok: true, applied, rejected: [] }
}

/* ---------------- 连通性验证 ---------------- */

/**
 * 主动问平台「这把 key 还有效吗」。
 *
 * 只做**只读**调用，不产生任何写副作用 —— 验证不该改变远端状态。
 * 每个平台一个探测函数，返回 { ok, detail }。
 */
const PROBES = {
  async BOTKEEP_API_KEY(value) {
    const r = await fetch('https://api.botkeep.cloud/api/v1/developer/workloads', {
      headers: { Authorization: `Bearer ${value}` },
      signal: AbortSignal.timeout(10000),
    })
    if (r.status === 401 || r.status === 403) return { ok: false, detail: `平台拒绝（HTTP ${r.status}）—— 密钥无效或已撤销` }
    if (!r.ok) return { ok: false, detail: `平台返回 HTTP ${r.status}` }
    const j = await r.json()
    const list = Array.isArray(j) ? j : (j.data || j.items || [])
    // 这条比「有效」更有价值：密钥有效但账号下没有工作负载，说明配错了账号
    return {
      ok: true,
      detail: list.length
        ? `有效，该账号可见 ${list.length} 个工作负载：${list.map(w => w.name).join('、')}`
        : '有效，但该账号下**没有任何工作负载** —— 可能登录了另一个账号',
      workloads: list.map(w => ({ name: w.name, id: w.id })),
    }
  },

  /**
   * 站点管理密钥：本地配了不等于线上认。
   * 两件事都查——「有效吗」看格式与平台，「线上是不是同一把」看指纹比对。
   */
  async SITES_ADMIN_KEY(value) {
    const cmp = await compareWithCloud()
    return {
      ok: cmp.same,
      detail: cmp.same
        ? `本地与线上一致（指纹 ${cmp.localFp}）`
        : cmp.detail,
      compare: cmp,
    }
  },

  async BOTKEEP_WORKLOAD_ID(value) {
    const { value: key } = readValue('BOTKEEP_API_KEY')
    if (!key) return { ok: false, detail: '需先配置 BOTKEEP_API_KEY 才能验证' }
    const r = await fetch(`https://api.botkeep.cloud/api/v1/developer/workloads/${value}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10000),
    })
    if (r.status === 404) return { ok: false, detail: '该工作负载不存在，或不属于当前密钥所在账号' }
    if (!r.ok) return { ok: false, detail: `平台返回 HTTP ${r.status}` }
    const w = await r.json()
    return { ok: true, detail: `命中工作负载 ${w.name}｜状态 ${w.status}` }
  },

  async VERCEL_TOKEN(value) {
    const r = await fetch('https://api.vercel.com/v2/user', {
      headers: { Authorization: `Bearer ${value}` },
      signal: AbortSignal.timeout(10000),
    })
    if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` }
    const j = await r.json()
    return { ok: true, detail: `有效，账号 ${j.user?.username || j.user?.email || '(未知)'}` }
  },
}

/**
 * 验证单个密钥。未登记探测函数的（如 LLM key，各家用不同端点）只回形态结论，
 * 并明确说明「未做平台验证」—— 不假装验证过。
 */
export async function verify(key) {
  const meta = findSecret(key)
  if (!meta) return { ok: false, detail: '未登记的密钥' }
  const { value } = readValue(meta.key)
  if (!value) return { ok: false, detail: '未配置' }

  const shape = inspectShape(meta.key, value)
  if (!shape.ok) return { ok: false, detail: `形态不符：${shape.problems.join('；')}`, shapeOnly: true }

  const probe = PROBES[meta.key]
  if (!probe) {
    return { ok: true, detail: '形态正常（该平台未接入在线验证，仅做格式检查）', shapeOnly: true }
  }
  try {
    const r = await probe(value)
    return { ...r, shapeOnly: false }
  } catch (e) {
    return { ok: false, detail: `验证请求失败：${e.name === 'TimeoutError' ? '超时' : e.message}` }
  }
}

/**
 * 本地与线上密钥是否一致 —— 比对**指纹**，不传输明文。
 *
 * 为什么需要单独一项：`verify()` 只能回答「本地这把 key 在平台上有效吗」，
 * 回答不了「线上那台机器用的和我本地是不是同一把」。而后者才是 401 mismatch
 * 的真正原因（2026-10-20 实测：平台密钥改不动、`data/` 又不进部署包，
 * 线上读到的既不是本地值也不是平台值，纯靠 `/api/_diag` 的指纹才定位到）。
 *
 * 线上用 `/api/_diag` 的 `secretFp`（sha256 前 10 位，不可逆），
 * 本地算同一算法 —— 两个指纹可比对，但任一方都无法从指纹还原密钥。
 */
export async function compareWithCloud(siteUrl = process.env.DEPLOY_SITE_URL || 'https://navigator-v2.bot-keep.xyz') {
  const { createHash } = await import('node:crypto')
  const { value } = readValue('SITES_ADMIN_KEY')
  if (!value) return { ok: false, detail: '本地未配置 SITES_ADMIN_KEY，无法比对' }
  const localFp = createHash('sha256').update(value).digest('hex').slice(0, 10)

  try {
    const r = await fetch(`${siteUrl.replace(/\/+$/, '')}/api/_diag`, {
      headers: { 'X-Nav-Key': value },
      signal: AbortSignal.timeout(15000),
    })
    if (!r.ok) return { ok: false, detail: `线上诊断接口返回 HTTP ${r.status}`, localFp }
    const j = await r.json()
    const cloudFp = String(j.secretFp || '')
    if (!cloudFp) return { ok: false, detail: '线上未返回密钥指纹（服务端版本过旧？）', localFp }

    const same = cloudFp === localFp
    return {
      ok: same,
      same,
      localFp,
      cloudFp,
      hasEnvKey: Boolean(j.hasEnvKey),
      hasKeyFile: Boolean(j.hasKeyFile),
      detail: same
        ? '本地与线上使用同一把密钥'
        : `不一致（本地 ${localFp} / 线上 ${cloudFp}）—— 写接口会回 401 mismatch。`
          + `线上来源：环境变量 ${j.hasEnvKey ? '有' : '无'}、密钥文件 ${j.hasKeyFile ? '有' : '无'}。`
          + `注意 data/ 不进部署包，改本地文件不会自动同步到线上。`,
    }
  } catch (e) {
    return {
      ok: false,
      localFp,
      detail: `无法连接线上：${e.name === 'TimeoutError' ? '超时' : e.message}`,
    }
  }
}

/** 批量验证（串行，避免同时打多个平台被限流） */
export async function verifyAll(keys) {
  const out = []
  const list = Array.isArray(keys) && keys.length ? keys : SECRETS.map(s => s.key)
  for (const k of list) out.push({ key: k, ...(await verify(k)) })
  return out
}
