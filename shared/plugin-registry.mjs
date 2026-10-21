/**
 * 插件目录 —— 把散在 9 个引擎模块与 1 项数据管理能力里的「注册表」聚成一份统一视图。
 *
 * ## 它解决什么
 *
 * 引擎热拔插重构之后，每个模块都有一套自己的 `register* / list* / chain` 机制，
 * 但**没有任何一处**把它们汇总起来。于是「现在翻译走的是哪条链」「图标第三方兜底
 * 开没开」「探针为什么没生效」这些问题，只能逐个去读源码或靠猜。
 *
 * ## 它做三件事
 *
 * 1. **集中加载注册链**。有几个引擎的 provider 不是自注册的：
 *      · translate 的内建两引擎由 `translate.mjs` 注册；
 *      · image 的封面 provider 由 `cover-source.mjs` 注册。
 *    少 import 一个，清单就**静默缺项**（不报错，只是少了）。所以加载必须集中在这里。
 *
 * 2. **归一成同一形状**。各引擎的 list* 返回字段并不一致（有的 async、有的带
 *    reason、有的按 kind 分组），这里收敛成 `{ providers, current, available }`。
 *
 * 3. **配置覆盖层的纯函数**。文件读写交给宿主（站内是 `data/plugins.json`，控制台
 *    是工具目录），这里只做白名单校验与合并 —— 保持纯函数，才能被纯 node 测试覆盖。
 *
 * ## 分层
 *
 * 本模块**只被服务端引用**（api/*.js 与控制台 server），不进前端产物。
 */

import { listEngines, resolveEngineId, resolveEngine } from './site-engine.mjs'
import './translate.mjs' /* 副作用：注册 MyMemory / Google 两个内建翻译引擎 */
import { listTranslators, translatorChain } from './translate-engine.mjs'
import { listLlms, llmChain } from './llm-engine.mjs'
import { listImageProviders, imageChain } from './image-engine.mjs'
import './cover-source.mjs' /* 副作用：注册 og:image 封面 provider */
import { listProbes, probeChain } from './probe-engine.mjs'
import { listCategorySources, categorySourceChain } from './category-source.mjs'
import { listSiteStores } from './site-store.mjs'
import { listPublishers, resolvePublisher } from './publisher.mjs'

/* ================================ 配置变量的解析 ================================ */

const OFF_WORDS = new Set(['none', 'off', '0'])

/**
 * 解析「链式」配置变量（逗号分隔的 id 列表）。
 * 返回 null = 没配（用默认全量）／[] = 显式清空／[ids] = 指定子集。
 * 三态必须区分：把它俩混成一件事，面板就分不清「没配」和「配成了空」。
 */
function envChain(name) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase()
  if (!raw) return null
  const ids = raw.split(',').map(s => s.trim()).filter(Boolean)
  if (ids.length === 1 && OFF_WORDS.has(ids[0])) return []
  return ids
}

/** 把「配置了吗」翻译成给人看的一句话 */
function chainMode(configured) {
  if (configured === null) return 'default'
  if (configured.length === 0) return 'off'
  return 'custom'
}

/* ================================ 分组构造 ================================ */

/**
 * 构造一个「链式」插件组：按顺序试到能用为止（翻译 / LLM / 图标 / 封面 / 探针 / 分类表）。
 *
 * @param {object} spec
 * @param {string} spec.id
 * @param {string} spec.label
 * @param {string} spec.role        这个引擎负责什么（给人看的一句话）
 * @param {string} spec.env         控制它的环境变量名
 * @param {() => object[]} spec.list  注册表清单（每个引擎的 list* 函数）
 * @param {() => object[]} spec.chain 实际会跑的链（每个引擎的 chain 函数）
 * @param {string} [spec.note]      补充说明（如「未配置则不出现」）
 */
function chainGroup({ id, label, role, env, list, chain, note = '' }) {
  const all = list().map(p => ({ id: p.id, label: p.label, order: p.order, available: p.available }))
  const configured = envChain(env)
  const activeIds = new Set(chain().map(p => p.id))

  const providers = all.map(p => ({
    ...p,
    // selected = 配置层面选中它（未配置时视为全选）；active = 实际会被用到
    selected: configured === null || configured.length === 0 ? true : configured.includes(p.id),
    active: activeIds.has(p.id),
  }))

  return {
    id,
    label,
    role,
    strategy: 'chain',
    env,
    hot: true,
    writable: true,
    available: providers.some(p => p.active),
    providers,
    current: {
      mode: chainMode(configured),
      env,
      ids: [...activeIds] /* 实际生效（已过滤不可用） */,
      configured /* 配置层面：null=默认全量 / []=关闭 / [ids]=指定。面板回显用它，不能拿 ids 反推 */,
      // 未配置时链就是全量，面板要能如实说「默认（全部按序）」
      label: configured === null
        ? '默认（按注册顺序全部启用）'
        : configured.length === 0
          ? '已关闭（显式清空）'
          : configured.join(' → '),
    },
    note,
  }
}

/** 构造一个「单选」插件组：指定一个，不可用则回退（站点抓取 / 发布通道） */
function pickGroup({ id, label, role, env, list, current, note = '' }) {
  const providers = list().map(p => ({ id: p.id, label: p.label, order: p.order, available: p.available, note: p.reason || '' }))
  return {
    id,
    label,
    role,
    strategy: 'pick',
    env,
    hot: true,
    writable: true,
    available: providers.some(p => p.available),
    // selected = 配置层面被指定（auto 时无人被指定，全 false；mode 字段表达「自动」）
    providers: providers.map(p => ({ ...p, selected: p.id === (current.requested || ''), active: p.id === current.resolved })),
    current,
    note,
  }
}

/* ================================ 主入口 ================================ */

/**
 * 全部插件组。`check:true` 会做真实探测（siteprobe 探活等），
 * 面板打开时用 true、批量展示时可按需 false。
 */
export async function pluginGroups({ check = true } = {}) {
  const groups = []

  /* 1. 站点抓取引擎 —— 单选，auto 会探活 siteprobe，失败回退 native */
  const siteEngines = await listEngines({ check })
  const requested = resolveEngineId() /* 'auto' | 'native' | 'siteprobe' */
  const decided = check ? await resolveEngine() : (requested === 'auto' ? 'native' : requested)
  groups.push(pickGroup({
    id: 'site-engine',
    label: '站点抓取引擎',
    role: '把网址抓成站点元信息（名称 / 描述 / 图标 / 分类）',
    env: 'NAV_SITE_ENGINE',
    list: () => siteEngines,
    current: {
      mode: requested === 'auto' ? 'auto' : 'fixed',
      env: 'NAV_SITE_ENGINE',
      requested,
      resolved: decided,
      label: requested === 'auto'
        ? `自动选择（当前生效：${decided}）`
        : `固定为 ${requested}`,
    },
    note: 'auto 模式下探活 siteprobe /health，离线自动回退内置引擎（探活结果缓存 30s）',
  }))

  /* 2. 翻译引擎链 */
  groups.push(chainGroup({
    id: 'translate-engine',
    label: '翻译引擎链',
    role: '把抓到的英文描述译成简体中文（按链逐个试，成功即止）',
    env: 'NAV_TRANSLATE_ENGINES',
    list: () => listTranslators({ check }),
    chain: () => translatorChain(),
    note: 'LLM 译厂只在配了 TRANSLATE_LLM_ENDPOINT 时出现；失败会静默跳下一个',
  }))

  /* 3. LLM 后端链（AI 助手 / 分类 / 摘要） */
  groups.push(chainGroup({
    id: 'llm-engine',
    label: 'LLM 后端链',
    role: 'AI 助手、自动分类、摘要等对话能力的后端',
    env: 'NAV_LLM_BACKENDS',
    list: () => listLlms({ check }),
    chain: () => llmChain(),
    note: '后端凭据与地址由 AI_* / LLM_GATEWAY_* 等变量提供',
  }))

  /* 4. 图标提供者链 */
  groups.push(chainGroup({
    id: 'image-engine',
    label: '图标提供者链',
    role: '为站点取图标（页面 icon 声明 → /favicon.ico → 第三方兜底）',
    env: 'NAV_ICON_PROVIDERS',
    list: () => listImageProviders({ kind: 'favicon', check }),
    chain: () => imageChain('favicon'),
    note: '第三方兜底可用 NAV_ICON_DISABLE_THIRD_PARTY=1 关闭',
  }))

  /* 5. 封面提供者链 */
  groups.push(chainGroup({
    id: 'cover-source',
    label: '封面提供者链',
    role: '为站点取封面图（og:image 等）',
    env: 'NAV_COVER_PROVIDERS',
    list: () => listImageProviders({ kind: 'cover', check }),
    chain: () => imageChain('cover'),
    note: '另有可选的「图标作封面」由图集接口按 NAV_COVER_FAVICON_FALLBACK=1 注册（默认关）',
  }))

  /* 6. 探活探针链（站点健康巡检） */
  groups.push(chainGroup({
    id: 'probe-engine',
    label: '探活探针链',
    role: '站点健康巡检：判断站点是否可用（server/cron 与 health-probe 共用）',
    env: 'NAV_HEALTH_PROBES',
    list: () => listProbes({ check }),
    chain: () => probeChain(),
    note: '探针只负责「取事实」，定性口径仍由 health-rules 决定',
  }))

  /* 7. 分类表来源链 */
  groups.push(chainGroup({
    id: 'category-source',
    label: '分类表来源链',
    role: '提供分类白名单（可由服务端下发覆盖内置表）',
    env: 'NAV_CATEGORY_SOURCES',
    list: () => listCategorySources({ check }),
    chain: () => categorySourceChain(),
    note: '内置表是最后兜底，永远排在链尾',
  }))

  /* 8. 站点存储 provider —— 锁定只读 */
  const storeProviders = listSiteStores({ check, ctx: {} }).map(p => ({
    id: p.id,
    label: p.label,
    order: p.order,
    available: p.available,
    capabilities: p.capabilities || null,
  }))
  groups.push({
    id: 'site-store',
    label: '站点存储',
    role: '站点库的读写通道（数据安全单点）',
    strategy: 'locked',
    env: 'NAV_SITE_STORE',
    hot: false,
    writable: false /* 刻意不可写 —— 见下方 note */,
    available: true,
    providers: storeProviders.map(p => ({ ...p, selected: true, active: p.id === 'kv' })),
    current: {
      mode: 'locked',
      env: 'NAV_SITE_STORE',
      ids: ['kv'],
      label: '固定为 kv（站内写路径不接受环境变量切换）',
    },
    note: '存储是数据安全单点：一次误设（如指到空目录）就会让种子覆盖线上真实数据。'
      + '因此站内写路径把 provider 固定为 kv，换后端须在 provider 层显式切换。',
  })

  /* 9. 数据管理 —— 只读诊断，刻意不可配置 */
  groups.push({
    id: 'data-manager',
    label: '数据管理',
    role: '站点库体检、受控修复与导出（只读诊断；写入复用站点库唯一通道）',
    strategy: 'locked',
    env: '',
    hot: true,
    writable: false,
    available: true,
    providers: [
      { id: 'audit', label: '库级体检', order: 1, available: true, selected: true, active: true },
      { id: 'repair-plan', label: '修复计划', order: 2, available: true, selected: true, active: true },
      { id: 'export', label: '导出', order: 3, available: true, selected: true, active: true },
    ],
    current: {
      mode: 'locked',
      env: '',
      ids: ['audit', 'repair-plan', 'export'],
      label: '固定启用（修复计划只生成 nextSites，落库仍走 /api/sites）',
    },
    note: '本组刻意不可配置：数据管理插件只生成修复计划，不直接写库。'
      + '写入仍走 POST /api/sites（CAS + 写前快照 + sanitizeSites 门禁），'
      + '因此它不会成为站点库的第二条写通道。',
  })

  /* 10. 发布通道 —— 单选 */
  let pubCurrent
  const pubRequested = String(process.env.NAV_PUBLISHER || '').trim().toLowerCase()
  try {
    const p = resolvePublisher()
    pubCurrent = {
      mode: pubRequested ? 'fixed' : 'auto',
      env: 'NAV_PUBLISHER',
      requested: pubRequested,
      resolved: p.id,
      label: p.label,
    }
  } catch (e) {
    pubCurrent = { mode: 'error', env: 'NAV_PUBLISHER', requested: pubRequested, resolved: '', label: e.message }
  }
  groups.push(pickGroup({
    id: 'publisher',
    label: '发布通道',
    role: '把构建产物发布出去（站点地址与部署命令由通道提供）',
    env: 'NAV_PUBLISHER',
    list: () => listPublishers({ check }).map(p => ({ id: p.id, label: p.label, order: p.order, available: p.available, reason: p.reason })),
    current: pubCurrent,
    note: '通道的 siteUrl 与部署命令每次解析时重新求值，改配置即时生效',
  }))

  return groups
}

/* ================================ 配置覆盖层（纯函数） ================================ */

/**
 * 允许在面板里改写的配置变量白名单。
 *
 * **刻意不含 `NAV_SITE_STORE`** —— 存储是数据安全单点，一次误设就会用种子覆盖线上数据。
 * 换存储后端应当在 provider 层显式切换，而不是经界面上的一个下拉框。
 */
export const WRITABLE_ENVS = new Set([
  'NAV_SITE_ENGINE',
  'NAV_TRANSLATE_ENGINES',
  'NAV_LLM_BACKENDS',
  'NAV_ICON_PROVIDERS',
  'NAV_COVER_PROVIDERS',
  'NAV_HEALTH_PROBES',
  'NAV_CATEGORY_SOURCES',
  'NAV_PUBLISHER',
])

/** 值只允许 id 列表形态：字母数字 + 逗号 + 连字符/下划线。够用，且挡掉一切注入 */
const VALUE_RE = /^[a-z0-9][a-z0-9,\-_]*$/i
const MAX_VALUE_LEN = 200

/**
 * 清洗一份覆盖配置：只留白名单内的键，值必须合规。
 *
 * 空值**保留在 ok 里**（值为 `''`），语义是「清除该项」—— 不能直接丢掉，
 * 否则「把配置改回默认」这个动作就没法表达了。
 *
 * @returns {{ ok: object, rejected: {name:string, value:any, reason:string}[] }}
 */
export function sanitizeOverrides(raw) {
  const ok = {}
  const rejected = []
  if (!raw || typeof raw !== 'object') return { ok, rejected }
  for (const [name, value] of Object.entries(raw)) {
    if (!WRITABLE_ENVS.has(name)) {
      rejected.push({ name, value, reason: name === 'NAV_SITE_STORE' ? '数据安全单点，不允许在面板改写' : '不在可改白名单内' })
      continue
    }
    const v = String(value ?? '').trim()
    if (!v) { ok[name] = ''; continue } /* 空值 = 清除该项，不算错误 */
    if (v.length > MAX_VALUE_LEN) { rejected.push({ name, value: v, reason: `值过长（>${MAX_VALUE_LEN}）` }); continue }
    if (!VALUE_RE.test(v)) { rejected.push({ name, value: v, reason: '值含非法字符（只允许字母数字、逗号、连字符、下划线）' }); continue }
    ok[name] = v
  }
  return { ok, rejected }
}

/**
 * 应用覆盖配置到 process.env（运行期即时生效）。
 * @returns {string[]} 实际写入的变量名
 */
export function applyOverrides(map) {
  const applied = []
  if (!map || typeof map !== 'object') return applied
  for (const [name, value] of Object.entries(map)) {
    if (!WRITABLE_ENVS.has(name)) continue
    const v = String(value ?? '').trim()
    if (v) { process.env[name] = v; applied.push(name) } else { delete process.env[name]; applied.push(name) }
  }
  return applied
}

/** 摘出当前进程里受这 8 个变量控制的配置（用于面板回显「现在是什么」） */
export function currentOverrides() {
  const out = {}
  for (const name of WRITABLE_ENVS) {
    const v = String(process.env[name] ?? '').trim()
    if (v) out[name] = v
  }
  return out
}
