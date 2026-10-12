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
import { localSiteMeta } from '@/services/localMeta'
import {
  AUTO_ADD_REASON, findDuplicate, preflightOf, fallbackDraftFromMeta, buildSiteFromDraft,
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
 *   { ok: true, site: object, upgrade: Promise<object>,
 *     category: { id: string, label: string, created: boolean } } |
 *   { ok: false, reason: string, message: string, existing?: object }
 * >}
 *   `upgrade` 是后台真实抓取 + 翻译的完成信号（`{ changed, real, reason, name }`），
 *   调用方可以据此给用户一条「信息已补全」的回执；不 await 它也不会阻塞添加。
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
    /**
     * 入库即刻返回，真实抓取 + 翻译放后台 —— 慢站（github.com 实测 ~10s）也不拖住添加动作。
     * 返回这个 Promise 而不是就地 await：调用方（App）拿它挂「信息已补全」的回执，
     * 添加动作本身仍然是毫秒级完成。
     *
     * `services/metaUpgrade` 走**动态 import**：它只在「用户真的粘了网址并且加成功」这条
     * 路径上才需要，首屏一次都用不到 —— 而它连带引入的 `services/meta.js`（抓取容错与
     * 文案表）同理。两者一起离开首屏静态图，把这条链路的开销整个让出首屏预算。
     *
     * ⚠️ 历史教训：这段逻辑原先就在**本文件里**，是模块级函数却引用了下面这个 `sitesStore`
     * 局部变量 —— 每跑必抛 ReferenceError，又被 `.catch(() => {})` 吞掉，于是抓取 / 翻译 /
     * 改写全程静默失败整整一个版本，用户永远停在秒加那份草稿上。现在编排在
     * `services/metaUpgrade.js` 里、store 由这里显式传入，代码级异常会在那边走
     * `console.warn`，不再有第二次。
     */
    const upgrade = import('@/services/metaUpgrade')
      .then(m => m.runMetaUpgrade({ store: sitesStore, url: normalized, created }))
      // 只兜「异步 chunk 加载失败」这种基础设施问题（陈旧的 SW 缓存 / 部署缺口）：
      // 它不在 runMetaUpgrade 的职责范围内，但同样不许静默
      .catch((e) => {
        console.warn('[auto-add] 后台升级模块加载失败，本次不做真实信息补全：', e)
        return { changed: false, real: false, reason: 'error', name: created.name, patch: null }
      })
    return {
      ok: true,
      site: created,
      category: { id: categoryId, label: categoryLabel, created: createdCategory },
      upgrade,
    }
  } catch (e) {
    /**
     * 落库阶段的异常归为写库失败 —— 但**必须留下痕迹**。
     *
     * 存储配额溢出走的是 `safeSetItem`（它自己 catch 并告警），根本到不了这里；
     * 所以能走到这里的几乎都是**代码级缺陷**（脏数据、字段名打错、store 未就绪）。
     * 静默地把它们一律说成「本机存储写入被拒绝」，就是后台升级那次事故的同款病灶：
     * 一个必然复现的错误伪装成「偶尔的环境问题」，谁也不会去查。
     */
    console.warn('[auto-add] 添加站点在落库阶段抛错：', e)
    return { ok: false, reason: AUTO_ADD_REASON.WRITE_FAILED, message: '添加失败：本机存储写入被拒绝，请稍后重试。' }
  }
}
