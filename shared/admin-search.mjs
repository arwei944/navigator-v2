/**
 * 后台全局搜索的索引与检索（纯函数，可在 Node 侧断言）。
 *
 * 解决什么：后台的搜索框原来只搜**站点列表**，想找「哪个面板能改抓取引擎」
 * 得靠记忆翻 tab。这里把「模块 / 站点 / 分类 / 插件组 / 设置项」放进同一个索引，
 * 一次输入就能命中任意一类，并按「模块 > 设置 > 站点」的优先级给出结果。
 *
 * 为什么不做模糊匹配库：目标是几百条量级（12 个模块 + 若干设置项 + 300 站点），
 * 一个 `includes` 完全够；引入打分库只会多一个依赖，而排序靠「优先级 + 前缀命中」更可解释。
 */

/** 后台各模块的一句话说明（搜索用；与 AdminAside 的说明分开维护，因为用途不同：这里是「找得到」，那里是「看得懂」） */
export const ADMIN_TAB_KEYWORDS = {
  overview: '概览 总览 统计 首页 dashboard',
  deploy: '部署 版本 构建 发布状态 线上 deploy',
  plugins: '插件 引擎 抓取 翻译 llm 图标 探针 存储 plugin',
  preferences: '偏好 设置 开关 告警规则 preference settings',
  sites: '站点 网站 导入 书签 批量 排序 去重 site',
  categories: '分类 体系 域 group category',
  'data-manager': '数据 体检 质量 覆盖率 重复 孤儿分类 低置信度 修复 导出 csv json',
  sync: '同步 三端 本地 botkeep workbuddy vercel 一致 冲突 选主 sync',
  'data-ingest': '浏览器 历史 书签 标签页 临时工作区 工作区 导入 批次 分类 ingest staging',
  'content-sources': '内容 动态 情报 rss atom feed 抓取 源 调度 失败 content',
  publish: '云端发布 热更新 预检 publish',
  snapshots: '快照 回滚 恢复 snapshot rollback',
  history: '发布历史 记录 history',
  audit: '审计 操作日志 audit log',
  notify: '通知 提醒 告警 notify',
  backup: '备份 恢复 导出 backup restore',
  ai: 'ai 助手 分类建议 摘要 描述 llm',
}

/** 后台里那些「不在 tab 上、但用户会去找」的设置项 */
export const ADMIN_SETTINGS_ENTRIES = [
  { id: 'set:auto-add', title: '网址自动添加', tab: 'preferences', keywords: '粘贴 网址 秒加 自动 添加 弹窗 开关' },
  { id: 'set:alert-rules', title: '告警规则（连续几次不可达）', tab: 'preferences', keywords: '告警 阈值 不可达 归档 分类 域名' },
  { id: 'set:plugins-env', title: '引擎与 provider 配置', tab: 'plugins', keywords: 'NAV_ 环境变量 provider 切换 引擎' },
  { id: 'set:sites-import', title: '导入浏览器书签', tab: 'sites', keywords: '书签 html 导入 批量 迁移' },
  { id: 'set:sites-dedupe', title: '疑似重复站点', tab: 'sites', keywords: '重复 同族 同名 去重 合并' },
  { id: 'set:sites-reorder', title: '手动拖拽排序', tab: 'sites', keywords: '排序 拖拽 调整 顺序' },
  { id: 'set:publish-preflight', title: '发布预检与字段级对照', tab: 'publish', keywords: '预检 diff 对照 变更 门禁' },
  { id: 'set:deploy-upstream', title: '检查更新（比对上游 Git）', tab: 'deploy', keywords: '上游 落后 版本 更新' },
]

/**
 * 构建索引。
 * @param {{ tabs?: {id,label}[], sites?: object[], categories?: object[], plugins?: object[] }} input
 */
export function buildAdminIndex({ tabs = [], sites = [], categories = [], plugins = [] } = {}) {
  const items = []
  for (const t of tabs) {
    items.push({
      kind: 'tab', id: `tab:${t.id}`, target: t.id, title: t.label,
      subtitle: '后台模块',
      keywords: String(ADMIN_TAB_KEYWORDS[t.id] || ''),
      weight: 3,
    })
  }
  for (const e of ADMIN_SETTINGS_ENTRIES) {
    items.push({
      kind: 'setting', id: e.id, target: e.tab, title: e.title,
      subtitle: '设置项',
      keywords: String(e.keywords || ''),
      weight: 4,   // 找「改某个开关的地方」比找模块更常发生，给它更高优先级
    })
  }
  for (const c of categories) {
    items.push({
      kind: 'category', id: `cat:${c.id}`, target: 'categories', title: c.label,
      subtitle: `分类 · ${c.id}`, keywords: String(c.id || ''),
      weight: 2,
    })
  }
  for (const s of sites) {
    items.push({
      kind: 'site', id: `site:${s.id}`, target: 'sites', title: s.name,
      subtitle: s.url || '',
      keywords: [s.url, s.desc, ...(Array.isArray(s.aliases) ? s.aliases : [])].filter(Boolean).join(' '),
      weight: 1,
    })
  }
  for (const g of plugins) {
    items.push({
      kind: 'plugin', id: `plug:${g.id || g.kind}`, target: 'plugins',
      title: g.title || g.label || g.id || '',
      subtitle: '插件组',
      keywords: String(g.keywords || g.id || ''),
      weight: 3,
    })
  }
  return items.filter(it => it.title)
}

/**
 * 检索：命中标题或关键词即算，按「权重降序 → 标题前缀命中优先 → 标题长度」排序。
 * 标题**前缀命中**排在同权重的前面 —— 打「站点」时「站点管理」应该比「站点导入」靠前。
 */
export function searchAdminIndex(index, query, limit = 20) {
  const q = String(query || '').trim().toLowerCase()
  if (!q) return []
  const hits = []
  for (const it of index || []) {
    const title = String(it.title || '').toLowerCase()
    const kw = String(it.keywords || '').toLowerCase()
    const sub = String(it.subtitle || '').toLowerCase()
    const titleHit = title.includes(q)
    const kwHit = kw.includes(q)
    const subHit = sub.includes(q)
    if (!titleHit && !kwHit && !subHit) continue
    hits.push({
      ...it,
      score: (it.weight || 1) * 10 + (title.startsWith(q) ? 5 : 0) + (titleHit ? 3 : kwHit ? 2 : 1),
    })
  }
  hits.sort((a, b) => b.score - a.score || a.title.length - b.title.length || a.title.localeCompare(b.title))
  return hits.slice(0, Math.max(1, limit))
}
