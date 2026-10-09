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
import {
  AUTO_ADD_REASON, findDuplicate, preflightOf, fallbackDraftFromMeta, buildSiteFromDraft,
} from '@/utils/siteDraft'
import { suggestCategory } from '../../shared/auto-category.mjs'

const META_TIMEOUT_MS = 8000

/**
 * 在途锁：并发提交共享同一次执行，锁键是**域名** —— 与查重口径（findDuplicate 按域名
 * 去重）对齐，同域不同路径的提交也落进同一次执行。连按两次回车时第二次若重跑全流程，
 * 查重会扑在「首次还在抓元数据」的异步窗口上 —— 两次都判无重复、各写一条，就重复入库了。
 */
const inFlight = new Map()

/** 抓元数据：超时 / 非 2xx / 网络异常都返回 null，由后续「域名兜底」接手，不再拦人 */
async function fetchMeta(url) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), META_TIMEOUT_MS)
  try {
    const res = await fetch('/api/metadata?url=' + encodeURIComponent(url), { signal: ctrl.signal })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
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

  const meta = await fetchMeta(normalized)

  // 抓取的整个异步窗口里，别的入口（弹窗手动添加）可能已把同域名写进库：
  // 写库前复检一次，查重不能只发生在窗口之前
  const raced = findDuplicate(sitesStore.sites, normalized)
  if (raced) return duplicateResult(raced)

  try {
    // 分类决策：输入是元数据 + 本地分类表快照，输出「复用哪个」或「新建一个」
    const plan = suggestCategory({
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

    let categoryId = ''
    let categoryLabel = ''
    let createdCategory = false

    if (plan.kind === 'create') {
      // 新建分类失败（id 撞车 / 域不存在）不阻断添加：站点按未分类入库，Toast 照常出
      const r = categoriesStore.addCategory(plan.groupId, {
        id: plan.id, label: plan.label, dotColor: plan.dotColor,
      })
      if (r.ok) {
        categoryId = r.id
        categoryLabel = plan.label
        createdCategory = true
      }
    } else {
      categoryId = plan.categoryId
      categoryLabel = plan.label
    }

    const draft = fallbackDraftFromMeta({ url: normalized, meta, categoryId })
    const { site } = buildSiteFromDraft(draft)
    const created = sitesStore.addSite(site)
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
