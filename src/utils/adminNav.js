/**
 * 管理后台的导航表 —— 唯一真相源。
 *
 * ## 为什么从 AdminView.vue 里搬出来
 *
 * 这张表同时被四件事消费：Tab 切换、左动作栏、全局搜索索引（`shared/admin-search.mjs`）、
 * 键盘快捷键（`shared/admin-shortcuts.mjs` 的 tab 字段）。放在组件里时，
 * "加一个模块"要改组件、快捷键表、搜索、动作栏四处，而且没有任何一处能回答
 * 「后台一共几个模块、分别归哪组」。
 *
 * 这里是**纯数据**（无 Vue、无副作用），所以 Node 侧也能直接断言 ——
 * 这让「快捷键指向了不存在的 tab」「动作栏引用了未登记的 tab」这类漂移变成可测的。
 */

/** Tab 分组：按「看 → 管 → 发 → 系统」的顺序，分组必须对应一个连贯顺序才有意义 */
export const TAB_GROUPS = [
  { id: 'overview', label: '总览' },
  { id: 'data', label: '数据' },
  { id: 'ops', label: '运维' },
  { id: 'release', label: '发布' },
  { id: 'system', label: '系统' },
]

export const TABS = [
  { id: 'overview', label: '仪表盘', group: 'overview' },
  { id: 'sites', label: '站点管理', group: 'data' },
  { id: 'categories', label: '分类体系', group: 'data' },
  { id: 'deploy', label: '部署', group: 'ops' },
  { id: 'plugins', label: '插件', group: 'ops' },
  { id: 'backup', label: '备份与恢复', group: 'ops' },
  { id: 'publish', label: '云端发布', group: 'release' },
  { id: 'snapshots', label: '快照与回滚', group: 'release' },
  { id: 'history', label: '发布历史', group: 'release' },
  { id: 'preferences', label: '偏好设置', group: 'system' },
  { id: 'notify', label: '通知中心', group: 'system' },
  { id: 'audit', label: '操作审计', group: 'system' },
  { id: 'ai', label: 'AI 助手', group: 'system' },
]

export const DEFAULT_TAB = 'overview'
export const TAB_IDS = new Set(TABS.map((t) => t.id))

/**
 * 一句话说明：让「这个模块是干什么的」在进去之前就能读到。
 * 同时用于仪表盘卡片与动作栏的 title，因此必须是短句（不是描述段落）。
 */
export const DASH_DESC = {
  sites: '增删改、批量操作、书签导入',
  categories: '全部方向下的分类表',
  deploy: '本地 / 上次构建 / 线上三方对照',
  plugins: '九个引擎模块的统一管理面',
  backup: '备份与恢复站点库',
  publish: '把站点库推到线上，30 秒内热更新',
  snapshots: '发布前快照与一键回滚',
  history: '发布记录与结果',
  preferences: '主题、卡片、告警规则',
  notify: '需要你处理的事',
  audit: '谁在何时做了什么',
  ai: '分类、摘要、描述这些对话能力',
}

/**
 * 左动作栏：栏里列的是「能做的事」，点一下即达。
 *
 * `kind: 'act'` 的是**只读或安全**的动作（检查更新 / 导出备份 / 看巡检结果）；
 * 发布、回滚、恢复备份这类不可逆动作**刻意不绑在导航点击上** ——
 * 误触一次就是线上事故，它们仍然要求「进入面板 → 再点执行」这层确认。
 */
export const RAIL_GROUPS = [
  {
    id: 'act',
    label: '常用动作',
    items: [
      { id: 'publish', kind: 'tab', tab: 'publish', label: '发布到云端', icon: '⇪' },
      { id: 'act:check', kind: 'act', action: 'check', label: '检查更新', icon: '⟳' },
      { id: 'act:backup', kind: 'act', action: 'backup', label: '导出备份', icon: '⛁' },
      { id: 'act:health', kind: 'act', action: 'health', label: '巡检结果', icon: '◎' },
    ],
  },
  {
    id: 'batch',
    label: '批量',
    items: [
      { id: 'batch-sites', kind: 'tab', tab: 'sites', label: '批量刷新描述', icon: '✎' },
      { id: 'batch-ai', kind: 'tab', tab: 'ai', label: 'AI 生成描述', icon: '✦' },
    ],
  },
  {
    id: 'mod',
    label: '模块',
    items: [
      { id: 'overview', kind: 'tab', tab: 'overview', label: '概览', icon: '◱' },
      { id: 'sites', kind: 'tab', tab: 'sites', label: '站点管理', icon: '☰' },
      { id: 'categories', kind: 'tab', tab: 'categories', label: '分类体系', icon: '◇' },
      { id: 'deploy', kind: 'tab', tab: 'deploy', label: '部署', icon: '⇪' },
      { id: 'plugins', kind: 'tab', tab: 'plugins', label: '插件', icon: '◈' },
      { id: 'snapshots', kind: 'tab', tab: 'snapshots', label: '快照与回滚', icon: '⟲' },
      { id: 'history', kind: 'tab', tab: 'history', label: '发布历史', icon: '≡' },
      { id: 'audit', kind: 'tab', tab: 'audit', label: '操作审计', icon: '▤' },
      { id: 'notify', kind: 'tab', tab: 'notify', label: '通知中心', icon: '◔' },
      { id: 'preferences', kind: 'tab', tab: 'preferences', label: '偏好设置', icon: '⚙' },
      { id: 'backup', kind: 'tab', tab: 'backup', label: '备份与恢复', icon: '⛁' },
    ],
  },
]

/** 动作的标题与说明（动作结果区用） */
export const RAIL_TITLE = { check: '检查更新', backup: '导出备份', health: '巡检结果' }
export const RAIL_TIP = {
  check: '对比线上版本与上游仓库。只读检查，点一下即执行。',
  backup: '把当前站点库与分类打包下载到本机，点一下即开始下载。',
  health: '最近一轮服务端巡检的结果。巡检由服务端按间隔自动跑，这里只读快照。',
}

/**
 * 自检：动作栏 / 快捷键表里引用的 tab 必须都登记在 TABS 中。
 * 返回问题列表（空 = 一致）。AdminView 挂载时调用，开发期立刻暴露漂移。
 */
export function auditAdminNav(shortcuts = []) {
  const problems = []
  for (const g of RAIL_GROUPS) {
    for (const it of g.items) {
      if (it.kind === 'tab' && !TAB_IDS.has(it.tab)) {
        problems.push(`动作栏「${g.label}」的 ${it.id} 指向未登记的 tab：${it.tab}`)
      }
    }
  }
  for (const s of shortcuts) {
    if (!TAB_IDS.has(s.tab)) problems.push(`快捷键 ${s.keys.join('')} 指向未登记的 tab：${s.tab}`)
  }
  return problems
}
