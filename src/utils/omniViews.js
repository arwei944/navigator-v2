/**
 * 全能框的两类「结构简单但拼装琐碎」的视图：默认视图 与 站点二级页。
 *
 * ## 为什么单独成文件
 *
 * 它们与「搜索匹配 / 分组排序 / 键盘导航」无关，只是把已有数据**摆成列表**：
 *   - 默认视图（palette 空输入）：最近访问 5 条 + 常用命令 6 条
 *   - 二级页：对某个站点的操作列表（按关键词过滤 + 评分排序）
 *
 * 放在 useOmniBox 里时，改「常用命令选哪几条」要先翻过 300 行搜索逻辑；
 * 而这两段恰好是最常被产品侧调整的部分。
 */

/** 结果分组的中文标签 —— 分组顺序由 useOmniBox 的 ORDER 决定，这里只给文案 */
export const GROUP_LABEL = {
  preview: '网址预览',
  page: '页面',
  view: '视图',
  action: '操作',
  site: '站点',
  domain: '方向',
  category: '分类',
  purpose: '用途',
  external: '站外',
  recent: '最近访问',
  common: '常用命令',
  siteAction: '站点操作',
  phrase: '理解',
}

/** 默认视图里固定展示的常用命令（顺序即展示顺序） */
export const COMMON_COMMAND_IDS = [
  'action.add',
  'view.theme',
  'page.favorites',
  'page.recent',
  'action.settings',
  'action.card',
]

/**
 * 默认视图：palette 空输入时展示「最近访问 + 常用命令」。
 *
 * 这里**不展开全部命令**：空输入时用户还没表达意图，铺开一屏命令只会让他更慢。
 * 最近访问排前面 —— 回到「刚才在看的站」是全能框最高频的用途之一。
 *
 * @param {object} deps
 * @param {any[]} deps.sites 全部站点
 * @param {any[]} deps.commands 命令表
 * @param {(sites:any[]) => any[]} deps.getRecentSites 取最近访问（由 history store 提供）
 * @param {(site:any)=>void} deps.openSite 打开一个站点
 */
export function buildDefaultGroups({ sites, commands, getRecentSites, openSite }) {
  const groups = []
  const recent = getRecentSites(sites).slice(0, 5)
  if (recent.length) {
    groups.push({
      type: 'recent',
      label: GROUP_LABEL.recent,
      items: recent.map((s) => ({
        key: `site:${s.id}`,
        type: 'site',
        title: s.name,
        subtitle: s.url,
        site: s,
        icon: '',
        run: () => openSite(s),
      })),
    })
  }

  const common = COMMON_COMMAND_IDS.map((id) => commands.find((c) => c.id === id))
    .filter(Boolean)
    .map((c) => ({
      key: `cmd:${c.id}`,
      type: c.section,
      title: c.title,
      subtitle: c.subtitle,
      icon: c.icon,
      run: c.run,
    }))
  if (common.length) groups.push({ type: 'common', label: GROUP_LABEL.common, items: common })
  return groups
}

/** 命令评分：主字段（标题+关键词）命中优先，副标题命中按权重折算 */
export function commandScore(c, q, { matchAny, scoreText, subWeight }) {
  const main = matchAny([c.title, ...(c.keywords || [])], q)
  const sub = scoreText(c.subtitle || '', q) * subWeight
  return Math.max(main, sub)
}

/**
 * 站点二级页的操作列表。
 *
 * 无输入时按命令表原顺序（对象在前、动作在后，见 siteActions.js 的说明）；
 * 有输入时按 `commandScore` 过滤 + 降序 —— 过滤为空的项直接不出现，
 * 而不是留一行「无匹配」占位。
 */
export function buildSiteActionItems({ pageSite, commands, query, scoreCtx }) {
  if (!pageSite) return []
  const all = commands.siteActions(pageSite)
  const q = query
  if (!q) return all.map((a) => ({ ...a, key: `act:${a.id}`, type: 'action' }))
  return all
    .map((a) => ({ a, score: commandScore(a, q, scoreCtx) }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .map((x) => ({ ...x.a, key: `act:${x.a.id}`, type: 'action' }))
}
