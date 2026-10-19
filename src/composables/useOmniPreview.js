/**
 * 全能框的「网址候选 + 下拉预览卡」—— 从 `useOmniBox.js` 抽出的子组合式。
 *
 * ## 它回答什么问题
 *
 * 用户在输入框里敲了一段可能是网址的文本时：
 *   1. 这是不是一个网址？（整串 / 夹在文字里，如 `Figma - 设计工具 https://figma.com`）
 *   2. 它是不是**已经收录**了？（收录了就不抓取，直接给本地数据）
 *   3. 没收录就抓一次，出一张预览卡（可添加）
 *   4. 卡片标题 / 描述是英文时，异步补一层中文译文，**不阻塞首屏、不因译不出而空卡**
 *
 * ## 三条容易写错的口径（都在这里收口）
 *
 * - **抓取与展示用同一把尺子**（`shouldPreview`）：否则会出现「抓了却不显示」或
 *   「显示了却没抓」——用户看到卡片在闪来闪去，不知道为什么。
 * - **`url` 取网址候选而不是 `urlPreview.url`**：已收录时不发抓取请求，后者会一直是空的，
 *   那样连本地就有数据的卡片都会被判成 idle、整张卡消失。
 * - **译文要防竞态**：用户快速改主意时，迟到的译文不能盖回新卡（序号比对）。
 *
 * ## 为什么拆出来
 *
 * 这 120 行与「命令搜索 / 分组输出 / 键盘导航」正交，只依赖输入文本与几个 store。
 * 留在 useOmniBox 里时，改译文逻辑要先翻过 200 行命令匹配。
 *
 * @param {object} deps
 * @param {import('vue').Ref<string>} deps.raw 原始输入
 * @param {import('vue').Ref<string>} deps.trimmed 去空白后的输入
 * @param {import('vue').Ref<string>} deps.prefix 前缀标记（`>` / `@` / `/`）
 * @param {import('vue').Ref<object|null>} deps.page 当前是否在站点二级页
 * @param {object} deps.sites sites store
 * @param {object} deps.categories categories store
 */
import { computed, ref, watch } from 'vue'
import { useUrlPreview } from '@/composables/useUrlPreview'
import { extractUrl, hostOf } from '@/utils/url'
import { shouldPreview, resolvePreviewState } from '@/utils/urlPreview'
import { PURPOSE_TAGS } from '../../shared/purposes.mjs'

export function useOmniPreview({ raw, trimmed, prefix, page, sites, categories }) {
  /* ---------------- 网址候选（沿用搜索框既有的决策链） ---------------- */

  const domainCandidate = computed(() => {
    const q = trimmed.value
    if (!q) return null
    // 整串是网址、或整段文本里含网址 —— 取其中那一个（`Figma - 设计工具 https://figma.com`）。
    // url 用抽出的那一段而不是原串：后面抓取与添加都只要网址本身，不该把「设计工具」也带上。
    const found = extractUrl(q)
    if (!found) return null
    const host = hostOf(found)
    return host ? { host, url: found } : null
  })

  const collected = computed(() => {
    const c = domainCandidate.value
    if (!c) return null
    return sites.sites.find((s) => hostOf(s.url) === c.host) || null
  })

  /* ---------------- 预览卡 ---------------- */

  const urlPreview = useUrlPreview()

  /**
   * 已收录卡片的附加信息（收在哪 / 用它干什么 / 去过没有）。
   * 分类标签与用途名都要按 id 查表 —— 纯函数拿不到 store，所以在这里算好再传下去。
   * 访问次数直接用 `site.visitCount`：`recordVisit` 会同步维护它（卡片角标就靠这个字段）。
   */
  const previewCardOpts = computed(() => {
    const col = collected.value
    if (!col) return {}
    return {
      categoryLabel: col.categoryId ? categories.getCategoryLabel(col.categoryId) : '',
      categoryColor: col.categoryId ? categories.getCategoryColor(col.categoryId) : '',
      purposes: (col.purposes || [])
        .slice(0, 2)
        .map((id) => PURPOSE_TAGS.find((p) => p.id === id)?.label || '')
        .filter(Boolean),
    }
  })

  /**
   * 卡片状态。`url` 取**网址候选**而非 `urlPreview.url`（理由见文件头注释）。
   */
  const previewState = computed(() =>
    resolvePreviewState({
      url: domainCandidate.value?.url || '',
      duplicate: collected.value,
      loading: urlPreview.loading.value,
      meta: urlPreview.meta.value,
      error: urlPreview.error.value,
      siteCardOpts: previewCardOpts.value,
    }),
  )

  /* ---------------- 中文译文（N1） ----------------
   * 卡片给的是站点原文名称与描述（多为英文）。这里**不阻塞首屏**地补一层译文：
   * 先按原文出卡，译文异步到位后响应式替换；未命中或翻译失败，一律回落原文 ——
   * 卡片不会因「译不出来」而空着。
   *
   * translateFields 必须动态 import：它是懒加载链路（test-bundle 第 7 节点名了
   * 「翻译编排」「离线词表」不许进首屏），静态 import 会把词表拖回首屏、顶穿预算。 */
  const previewTranslation = ref(null)
  let previewTranslateSeq = 0

  watch(
    () => {
      const st = previewState.value
      if (!st.card) return ''
      return JSON.stringify([st.kind, st.card.host, st.card.title, st.card.desc])
    },
    async (key) => {
      previewTranslation.value = null
      if (!key) return
      const card = previewState.value.card
      if (!card) return
      const my = ++previewTranslateSeq
      try {
        const { translateFields } = await import('@/services/translateFields')
        const res = await translateFields({ name: card.title, desc: card.desc })
        // 竞态保护：迟到的译文不能盖回新卡
        if (my !== previewTranslateSeq) return
        previewTranslation.value = {
          title: res.translated.name ? res.name : '',
          desc: res.translated.desc ? res.desc : '',
          source: res.source || '',
        }
      } catch {
        /* 翻译整链不可用 → 静默回落原文 */
      }
    },
    { immediate: true },
  )

  /** 把译文并进卡片（有译文才覆盖；没有就保持原文）。渲染层只看这个。 */
  const previewCardFinal = computed(() => {
    const st = previewState.value
    const t = previewTranslation.value
    if (!st.card || !t) return st
    return {
      ...st,
      card: {
        ...st.card,
        titleTranslated: t.title || '',
        descTranslated: t.desc || '',
        translationSource: t.source,
      },
    }
  })

  /**
   * 预取的触发条件，与卡片「该不该出现」共用同一把尺子（`shouldPreview`），
   * 否则会出现「抓了却不显示」或「显示了却没抓」两种对不上的情况。
   * 已收录时不抓：本地就有全部字段，联网纯属多余，还会让卡片白等一次往返。
   */
  watch(
    () => {
      if (!shouldPreview(trimmed.value, { prefix: prefix.value, hasPage: Boolean(page.value) })) return ''
      if (collected.value) return ''
      return domainCandidate.value?.url || ''
    },
    (target) => urlPreview.request(target),
  )

  return {
    domainCandidate,
    collected,
    previewState,
    previewCardFinal,
    /** 添加站点时取走当前抓到的元信息（供调用方拼草稿） */
    previewMeta: urlPreview.meta,
    previewLoading: urlPreview.loading,
  }
}
