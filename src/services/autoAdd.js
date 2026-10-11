/**
 * 自动添加管道：搜索栏粘网址 → 识别 → 决定分类 → 入库，中间不给用户确认的机会。
 *
 * 出口是「决策结果」而不是「弹窗」：只有网址不成立、同域名已收录、写库失败这三种情况
 * 才返回 ok:false，由 App 分派到底部 Toast；抓取失败 / 站名不可信一律域名兜底照常入库，
 * 分类没把握就按页面简介新建一个。判定本身都在纯函数里，这里只做编排与联网。
 */
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { normalizeUrl, hostOf } from '@/utils/url'
import { fetchSiteMeta, META_TIMEOUT_MS } from '@/services/meta'
import { localSiteMeta } from '@/services/localMeta'
import {
  AUTO_ADD_REASON, findDuplicate, preflightOf, fallbackDraftFromMeta, buildSiteFromDraft, domainOf,
} from '@/utils/siteDraft'

/**
 * `suggestCategory` 走**动态 import**（不是顶部的静态 import）。
 *
 * 原因：它所在的 `shared/auto-category.mjs` 顶层静态 import 了 `pinyin-pro`（317 KB raw）。
 * 只要这个 import 是静态的，pinyin-pro 就会经由「autoAdd → auto-category」进入**首屏静态图**，
 * 于是无论 `src/utils/search.js` 那边怎么改成动态 import，构建产物里入口 chunk 仍会有一条
 * `import{pinyin}from"./pinyin-xxx.js"`，浏览器照样在首屏把它拉下来 —— 分包白做。
 *
 * 而这个函数（自动添加站点）只在用户粘网址时才会走到，首屏一次都不用，所以推迟到调用点是
 * 零成本的：`runAutoAdd` 本来就是 async。
 */
export async function loadSuggestCategory() {
  const m = await import('../../shared/auto-category.mjs')
  return m.suggestCategory
}

/**
 * 在途锁：并发提交共享同一次执行，锁键是**域名** —— 与查重口径（findDuplicate 按域名
 * 去重）对齐，同域不同路径的提交也落进同一次执行。
 */
const inFlight = new Map()

/**
 * 后台升级：真实抓取（读对方页面）回来后，把秒填时的域名推断值替换成真实信息。
 *
 * 只升级 name / desc / 图标 / 配色 —— **分类不动**：分类在添加那一刻已经决定了
 * （本机推断或新建），事后改分类会让卡片在用户眼前换位置，比「分类略欠准」糟糕得多。
 *
 * 覆盖守卫：以添加时刻的 `updatedAt` 为凭。用户在抓取返回前编辑过这条站点
 * （updatedAt 变了）就整体放弃升级 —— 自动补全绝不能覆盖人的输入。
 * 抓取失败（超时 / 站点反爬）静默放弃：本地推断值仍然可用。
 */
function scheduleMetaUpgrade(url, created) {
  const capturedAt = created.updatedAt
  const domain = domainOf(url)
  fetchSiteMeta(url, { timeoutMs: META_TIMEOUT_MS })
    .then((r) => {
      if (!r.ok) return
      const cur = sitesStore.sites.find(s => s.id === created.id)
      if (!cur || cur.updatedAt !== capturedAt) return
      const patch = {}
      if (r.data.name && r.data.name !== cur.name) {
        patch.name = r.data.name
        patch.initial = String(r.data.name).charAt(0).toUpperCase()
      }
      if (r.data.desc && r.data.desc !== cur.desc) patch.desc = r.data.desc
      if (r.data.color && r.data.color !== cur.color) patch.color = r.data.color
      const fav = r.data.faviconUrl || r.data.favicon
      // 与 buildSiteFromDraft 同一条规则：只挂「图标来源域名 === 本站域名」的图标，宁可回落字母块
      if (fav && /^https?:\/\//i.test(fav) && hostOf(fav) === domain) patch.iconUrl = fav
      if (Object.keys(patch).length) sitesStore.updateSite(created.id, patch)
    })
    .catch(() => { /* 静默：升级是锦上添花，失败不打扰 */ })
}

function duplicateResult(duplicate) {
  return {
    ok: false,
    reason: AUTO_ADD_REASON.DUPLICATE,
    message: `「${duplicate.name}」已收录`,
    existing: { id: duplicate.id, name: duplicate.name, categoryId: duplicate.categoryId || '' },
  }
}

/**
 * @param {{ url: string }} input 搜索栏给出的原始网址
 * @returns {Promise<
 *   { ok: true, site: object, category: { id: string, label: string, created: boolean } } |
 *   { ok: false, reason: string, message: string, existing?: object }
 * >}
 */
export function autoAddSite({ url }) {
  const normalized = normalizeUrl(url)
  const key = hostOf(normalized) || normalized
  const pending = inFlight.get(key)
  if (pending) return pending
  const task = runAutoAdd(normalized).finally(() => inFlight.delete(key))
  inFlight.set(key, task)
  return task
}

async function runAutoAdd(normalized) {
  const sitesStore = useSitesStore()
  const categoriesStore = useCategoriesStore()

  const invalid = preflightOf({ url: normalized })
  if (invalid) return { ok: false, ...invalid }

  // 重复不进弹窗：把命中站点带回，App 用来定位已有卡片
  const duplicate = findDuplicate(sitesStore.sites, normalized)
  if (duplicate) return duplicateResult(duplicate)

  // **零延迟**：元数据改用本地推断（与服务端同一个 inferSite 引擎，传空 HTML）同步秒出，
  // 不再等最长 8s 的真实抓取 —— 添加动作即刻完成。真实信息随后在后台升级本条记录
  // （scheduleMetaUpgrade；用户若已手动编辑则不覆盖）。同域已收录时沿用真名，准确度不打折。
  const local = await localSiteMeta(normalized, {
    existingSites: sitesStore.sites,
    categoryMeta: categoriesStore.groups.reduce((m, g) => {
      for (const c of g.categories) m[c.id] = { label: c.label, color: c.dotColor, group: g.label }
      return m
    }, {}),
  })
  const meta = local.ok ? local.data : null

  // 本地推断是同步过程，但「识别窗口」里别的入口（弹窗手动添加）仍可能把同域名写进库：
  // 写库前复检一次，查重不能只发生在窗口之前
  const raced = findDuplicate(sitesStore.sites, normalized)
  if (raced) return duplicateResult(raced)
  // 分类决策：输入是元数据 + 本地分类表快照，输出「复用哪个」或「新建一个」。
  // 引擎（auto-category → pinyin-pro）是**按需加载**的（见文件顶部 loadSuggestCategory 的注释）。
  // 加载失败不阻断添加：退化为「未分类入库」，与「新建分类失败」的处理口径一致。
  let plan = null
  try {
    const suggestCategory = await loadSuggestCategory()
    plan = suggestCategory({
      categoryId: meta?.categoryId || '',
      categoryConfidence: meta?.confidence?.category || '',
      name: meta?.name || '',
      desc: meta?.desc || '',
      domain: meta?.domain || hostOf(normalized),
      purposes: meta?.purposes || [],
      existing: categoriesStore.categories.map(c => ({
        id: c.id,
        label: c.label,
        groupId: categoriesStore.getGroupByCategory(c.id)?.id || '',
      })),
      domainIds: categoriesStore.domains.map(d => d.id),
    })
  } catch {
    plan = null
  }

  try {
    let categoryId = ''
    let categoryLabel = ''
    let createdCategory = false

    if (plan && plan.kind === 'create') {
      // 新建分类失败（id 撞车 / 域不存在）不阻断添加：站点按未分类入库，Toast 照常出
      const r = categoriesStore.addCategory(plan.groupId, {
        id: plan.id, label: plan.label, dotColor: plan.dotColor,
      })
      if (r.ok) {
        categoryId = r.id
        categoryLabel = plan.label
        createdCategory = true
      }
    } else if (plan) {
      categoryId = plan.categoryId
      categoryLabel = plan.label
    }

    const draft = fallbackDraftFromMeta({ url: normalized, meta, categoryId })
    const { site } = buildSiteFromDraft(draft)
    const created = sitesStore.addSite(site)
    // 入库即刻返回，真实抓取放后台 —— 慢站（github.com 实测 ~9s）也不拖住添加动作
    scheduleMetaUpgrade(normalized, created)
    return {
      ok: true,
      site: created,
      category: { id: categoryId, label: categoryLabel, created: createdCategory },
    }
  } catch {
    // 落库阶段的任何异常都归为写库失败
    return { ok: false, reason: AUTO_ADD_REASON.WRITE_FAILED, message: '添加失败：本机存储写入被拒绝，请稍后重试。' }
  }
}
