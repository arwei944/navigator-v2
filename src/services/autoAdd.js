/**
 * 自动添加管道：搜索栏粘网址 → 识别 → 入库，中间不给用户确认的机会。
 *
 * 因为跳过了确认，凡是「机器判断可能出错」的环节都必须退回人工（弹窗）：
 * 网址不成立、同域已收录、抓取失败、站名空或低置信 —— 一律不写库。
 * 判定本身在 src/utils/siteDraft.js 的纯函数里，这里只做编排与联网。
 */
import { useSitesStore } from '@/stores/sites'
import { normalizeUrl } from '@/utils/url'
import { findDuplicate, preflightOf, metaGuardrailOf, draftFromMeta, buildSiteFromDraft } from '@/utils/siteDraft'

const META_TIMEOUT_MS = 8000

/** 抓元数据：超时 / 非 2xx / 网络异常都当作「抓取失败」，由护栏决定回落弹窗 */
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

/**
 * @param {{ url: string }} input 搜索栏给出的原始网址
 * @returns {Promise<{ok: true, site: object} | {ok: false, reason: string, message: string}>}
 */
export async function autoAddSite({ url }) {
  const sitesStore = useSitesStore()
  const normalized = normalizeUrl(url)

  const blocked = preflightOf({
    url: normalized,
    duplicate: findDuplicate(sitesStore.sites, normalized),
  })
  if (blocked) return { ok: false, ...blocked }

  const meta = await fetchMeta(normalized)
  const guard = metaGuardrailOf({ meta })
  if (guard) return { ok: false, ...guard }

  const { site } = buildSiteFromDraft(draftFromMeta(meta))
  const created = sitesStore.addSite(site)
  return { ok: true, site: created }
}
