/**
 * 全能框命令注册表。
 *
 * 设计要点：
 * 1. **纯工厂**：`buildCommands(ctx)` 接收宿主注入的 store 与回调，返回命令数组。
 *    命令本身不 import store —— 否则命令表与组件生命周期纠缠，也没法在测试里单独跑。
 * 2. **keywords 手写拼音是刻意的**：自动拼音会把「切换主题」转成 `qiehuantizhuti`，
 *    而用户实际打的是 `zt` / `zhuti`。命令名短、意图明确，手写几十个关键词比猜输入习惯可靠。
 * 3. **run 之后统一关闭**：全能框遵循 Raycast 的默认语义（执行即结束）。
 *    需要保持打开的场景（站点二级页）由 useOmniBox 的页面栈处理，不走命令表。
 *
 * section 决定结果分组：page（跳转页面）/ view（改外观与排序）/ action（执行动作）。
 */
import { PURPOSE_TAGS } from '../../shared/purposes.mjs'
import { SCHEMES } from './visualScheme'

/** 页面跳转：清掉 c/p/q，落到干净的整页 */
function gotoPage(router, path, name) {
  return () => {
    if (name) router.push({ name })
    else router.push(path)
  }
}

const SORTS = [
  { id: 'default', label: '默认排序', keywords: ['moren', 'mr', 'default'] },
  { id: 'name-asc', label: '名称 A-Z', keywords: ['mingcheng', 'mc', 'az', 'name'] },
  { id: 'name-desc', label: '名称 Z-A', keywords: ['mingcheng', 'mc', 'za', 'daoxu', 'dx'] },
  { id: 'clicks', label: '按点击量', keywords: ['dianjiliang', 'djl', 'remai', 'hot', 'clicks'] },
  { id: 'newest', label: '最新收录', keywords: ['zuixin', 'zx', 'shoulu', 'newest'] },
  { id: 'smart', label: '智能排序', keywords: ['zhineng', 'zn', 'smart', 'tuijian', 'tj', 'gerehua'] }
]

const DENSITIES = [
  { id: 'compact', label: '紧凑', keywords: ['jinchou', 'jc', 'compact'] },
  { id: 'standard', label: '标准', keywords: ['biaozhun', 'bz', 'standard'] },
  { id: 'rich', label: '丰富', keywords: ['fengfu', 'ff', 'rich'] }
]

export function buildCommands(ctx) {
  const { router, sites, categories, preferences, sidebar, omni, toast, favorites, notes, undo } = ctx

  const cmds = []
  const notesCount = notes?.count ?? 0

  /* ── page：跳转页面 ── */
  const pages = [
    { id: 'home', name: 'Home', title: '首页', icon: 'home', keywords: ['shouye', 'sy', 'home', 'all', 'quanbu'] },
    { id: 'favorites', name: 'Favorites', title: '收藏', icon: 'star', keywords: ['shoucang', 'sc', 'fav', 'favorites'] },
    { id: 'recent', name: 'Recent', title: '最近访问', icon: 'clock', keywords: ['zuijin', 'zj', 'recent', 'lishi', 'ls', 'history'] },
    { id: 'archived', name: 'Archived', title: '归档', icon: 'archive', keywords: ['guidang', 'gd', 'archived'] },
    { id: 'feed', name: 'Feed', title: '内容聚合', icon: 'feed', keywords: ['juhe', 'jh', 'feed', 'neirong'] },
    { id: 'trash', name: 'Trash', title: '回收站', icon: 'trash', keywords: ['huishouzhan', 'hsz', 'trash', 'laji'] },
    { id: 'insights', name: 'Insights', title: '洞察面板', icon: 'feed', keywords: ['dongcha', 'dc', 'insights', 'tongji', 'tj', 'fenxi', 'fx', 'tubiao', 'tb'] },
    { id: 'graph', name: 'Graph', title: '关联图谱', icon: 'graph', keywords: ['guanlian', 'graph', 'tupu', 'tp', 'guanxi', 'gx', 'xiangguan'] },
    { id: 'admin', name: 'Admin', title: '管理后台', icon: 'settings', keywords: ['guanli', 'gl', 'houtai', 'ht', 'admin'] }
  ]
  for (const p of pages) {
    cmds.push({
      id: `page.${p.id}`,
      title: p.title,
      subtitle: '切换页面',
      section: 'page',
      icon: p.icon,
      keywords: p.keywords,
      run: p.name === 'Admin' ? gotoPage(router, '/admin') : gotoPage(router, null, p.name)
    })
  }

  /* ── view：外观与排序 ── */
  cmds.push({
    id: 'view.theme',
    title: '切换主题',
    subtitle: preferences.theme === 'light' ? '当前：浅色 → 切到深色' : '当前：深色 → 切到浅色',
    section: 'view',
    icon: preferences.theme === 'light' ? 'moon' : 'sun',
    keywords: ['zhuti', 'zt', 'theme', 'qiehuanzhuti', 'dark', 'light', 'ansemoshi', 'shense', 'qianse'],
    run: () => preferences.toggleTheme()
  })

  cmds.push({
    id: 'view.mode',
    title: sites.viewMode === 'grid' ? '切换到列表视图' : '切换到网格视图',
    subtitle: sites.viewMode === 'grid' ? '当前：网格' : '当前：列表',
    section: 'view',
    icon: 'layout',
    keywords: ['shitu', 'st', 'wangge', 'wg', 'liebiao', 'lb', 'grid', 'list', 'view'],
    run: () => sites.setViewMode(sites.viewMode === 'grid' ? 'list' : 'grid')
  })

  cmds.push({
    id: 'view.clickboost',
    title: preferences.clickBoost ? '关闭常访问加权' : '开启常访问加权',
    subtitle: preferences.clickBoost ? '当前：开启 → 搜索将只按相关性排序' : '当前：关闭 → 同相关性时点得多的排前',
    section: 'view',
    icon: 'sort',
    keywords: ['changfangwen', 'cfw', 'jiaquan', 'jq', 'clickboost', 'reli', 'rl', 'paixu', 'px'],
    run: () => preferences.setClickBoost(!preferences.clickBoost)
  })

  for (const s of SORTS) {
    cmds.push({
      id: `view.sort.${s.id}`,
      title: `排序：${s.label}`,
      subtitle: sites.sortBy === s.id ? '当前排序方式' : '改变卡片排列顺序',
      section: 'view',
      icon: 'sort',
      keywords: [...s.keywords, 'paixu', 'px', 'sort'],
      run: () => sites.setSortBy(s.id)
    })
  }

  for (const d of DENSITIES) {
    cmds.push({
      id: `view.density.${d.id}`,
      title: `卡片密度：${d.label}`,
      subtitle: preferences.cardDensity === d.id ? '当前密度' : '控制卡片上显示多少信息',
      section: 'view',
      icon: 'card',
      keywords: [...d.keywords, 'midu', 'md', 'kapian', 'density'],
      run: () => preferences.setCardDensity(d.id)
    })
  }

  for (const sc of SCHEMES) {
    cmds.push({
      id: `view.scheme.${sc.id}`,
      title: `视觉方案：${sc.name}`,
      subtitle: sc.desc,
      section: 'view',
      icon: 'palette',
      keywords: [sc.id, sc.name, 'shijue', 'sj', 'fangan', 'fa', 'scheme'],
      run: () => preferences.setVisualScheme(sc.id)
    })
  }

  for (const p of Object.values(preferences.THEME_PRESETS)) {
    cmds.push({
      id: `view.preset.${p.id}`,
      title: `配色：${p.name}`,
      subtitle: '改变强调色与背景',
      section: 'view',
      icon: 'palette',
      keywords: [p.id, p.name, 'peise', 'ps', 'yanse', 'ys', 'preset', 'color'],
      run: () => preferences.setThemePreset(p.id)
    })
  }

  for (const e of preferences.engines) {
    cmds.push({
      id: `view.engine.${e.id}`,
      title: `搜索引擎：${e.label}`,
      subtitle: '站外搜索默认走这个引擎',
      section: 'view',
      icon: 'search',
      keywords: [e.id, e.label, 'sousuoyinqing', 'ssyq', 'yinqing', 'yq', 'engine'],
      run: () => preferences.setSearchEngine(e.id)
    })
  }

  cmds.push({
    id: 'view.sidebar',
    title: sidebar.collapsed ? '展开侧边栏' : '折叠侧边栏',
    subtitle: '收起左侧导航，把宽度还给卡片',
    section: 'view',
    icon: 'panel',
    keywords: ['cebianlan', 'cbl', 'zhankai', 'zk', 'zhedie', 'zd', 'sidebar', 'daohang'],
    run: () => sidebar.toggleCollapse()
  })

  /* ── action：执行动作 ── */
  cmds.push({
    id: 'action.add',
    title: '添加站点',
    subtitle: '手动录入一个新站点',
    section: 'action',
    icon: 'plus',
    keywords: ['tianjia', 'tj', 'xinjian', 'xj', 'add', 'new', 'zhandian'],
    run: () => omni.requestAdd('')
  })

  cmds.push({
    id: 'action.import',
    title: '导入 / 导出书签',
    subtitle: '从浏览器书签文件批量导入',
    section: 'action',
    icon: 'import',
    keywords: ['daoru', 'dr', 'daochu', 'dc', 'shuchu', 'shuchen', 'import', 'export', 'bookmark'],
    run: () => omni.requestPanel('bookmarkImport')
  })

  cmds.push({
    id: 'action.todo',
    title: '待办事项',
    subtitle: '打开待办面板',
    section: 'action',
    icon: 'todo',
    keywords: ['daiban', 'db', 'daibanshixiang', 'todo', 'renwu', 'rw'],
    run: () => omni.requestPanel('todo')
  })

  cmds.push({
    id: 'action.noteNew',
    title: '新建便利贴',
    subtitle: 'Ctrl+Alt+N · 钉住的便签会常驻桌面',
    section: 'action',
    icon: 'note',
    keywords: ['bianliqian', 'blq', 'bianqian', 'bq', 'xieyixia', 'note', 'sticky', 'noteNew'],
    run: () => omni.requestPanel('noteNew')
  })

  cmds.push({
    id: 'action.stickyBoard',
    title: '打开便签墙',
    subtitle: notesCount ? `已有 ${notesCount} 枚便签` : '还没有便签，新建一枚看看',
    section: 'action',
    icon: 'note',
    keywords: ['bianqianqiang', 'bqq', 'qiang', 'board', 'sticky', 'bianliqian'],
    run: () => omni.requestPanel('stickyBoard')
  })

  cmds.push({
    id: 'action.themeMarket',
    title: '主题与外观',
    subtitle: `当前：${preferences.THEME_PRESETS[preferences.themePreset]?.name || '默认'}`,
    section: 'action',
    icon: 'palette',
    keywords: ['zhuti', 'zt', 'theme', 'zhutishichang', 'waiguan', 'wg', 'peise', 'ps'],
    run: () => omni.requestPanel('settings')
  })

  cmds.push({
    id: 'action.smartBar',
    title: preferences.smartBar ? '关闭此刻推荐' : '开启此刻推荐',
    subtitle: '首页顶部那排按当前时段与你的习惯算出来的站',
    section: 'action',
    icon: 'sparkle',
    keywords: ['ciketuijian', 'ck tj', 'tuijian', 'tj', 'zhineng', 'smart', 'recommend'],
    run: () => {
      preferences.setSmartBar(!preferences.smartBar)
      toast.push({ message: preferences.smartBar ? '已开启此刻推荐' : '已关闭此刻推荐', tone: 'ok', duration: 2000 })
    }
  })

  /* ── 运维动作（#16 自然语言运维）────
   * 说一句话就能做的整理动作。**只收可撤销的**：
   *   · 归档「需处理」的站点 —— 归档可一键取回（下面的「恢复全部归档」就是反向操作）；
   *   · 恢复全部归档。
   * 删除 / 清空这类不可逆动作刻意不给入口：一句话误触的代价太高，
   * 它们仍只在后台面板里、并且带二次确认。 */
  if (ctx.health && typeof ctx.archiveDownSites === 'function') {
    cmds.push({
      id: 'ops.archiveDown',
      title: '归档所有失效站点',
      subtitle: '把探活判定为「需处理」的站点移入归档，可随时取消归档取回',
      section: 'action',
      icon: 'archive',
      keywords: ['guidang', 'gd', 'shixiao', 'sw', 'qingli', 'ql', 'archive-down', 'guidangshixiao', 'shixiaoguidang'],
      run: () => {
        const n = ctx.archiveDownSites()
        toast.push({ message: n ? `已归档 ${n} 个失效站点` : '没有失效站点需要归档', tone: n ? 'ok' : 'info', duration: 2600 })
      }
    })
  }
  if (typeof ctx.unarchiveAllSites === 'function') {
    cmds.push({
      id: 'ops.unarchiveAll',
      title: '恢复全部归档站点',
      subtitle: '把所有归档站点一次性取回默认列表',
      section: 'action',
      icon: 'archive',
      keywords: ['quxiaoguidang', 'qxgd', 'huifu', 'hf', 'unarchive', 'huifuguidang', 'quanbufuchu'],
      run: () => {
        const n = ctx.unarchiveAllSites()
        toast.push({ message: n ? `已恢复 ${n} 个归档站点` : '当前没有归档站点', tone: n ? 'ok' : 'info', duration: 2400 })
      }
    })
  }

  cmds.push({
    id: 'action.card',
    title: '卡片设置',
    subtitle: '排列方式、卡片大小与显示元素',
    section: 'action',
    icon: 'card',
    keywords: ['kapian', 'kp', 'shezhi', 'sz', 'card', 'peizhi', 'pz'],
    run: () => omni.requestPanel('cardSettings')
  })

  cmds.push({
    id: 'action.settings',
    title: '设置',
    subtitle: '主题、壁纸、视觉方案与数据',
    section: 'action',
    icon: 'settings',
    keywords: ['shezhi', 'sz', 'settings', 'peizhi', 'pz', 'xuanxiang', 'xx'],
    run: () => omni.requestPanel('settings')
  })

  cmds.push({
    id: 'action.pipeline',
    title: '管线日志',
    subtitle: '查看添加站点 / 抓取 / 翻译的实时进度流水线',
    section: 'action',
    icon: 'note',
    keywords: ['guanxian', 'gx', 'rizhi', 'rz', 'liushuixian', 'lsx', 'log', 'pipeline', 'jindu', 'jd'],
    run: () => omni.requestPanel('pipeline')
  })

  cmds.push({
    id: 'action.shortcuts',
    title: '查看快捷键',
    subtitle: '列出所有键盘快捷键',
    section: 'action',
    icon: 'keyboard',
    keywords: ['kuaijiejian', 'kjj', 'jianpan', 'jp', 'shortcuts', 'hotkey'],
    run: () => omni.requestPanel('shortcuts')
  })

  cmds.push({
    id: 'action.batch',
    title: sites.batchMode ? '退出批量选择' : '批量选择站点',
    subtitle: '多选后统一改分类 / 用途 / 删除',
    section: 'action',
    icon: 'check',
    keywords: ['piliang', 'pl', 'xuanze', 'xz', 'duoxuan', 'dx', 'batch', 'select'],
    run: () => sites.toggleBatchMode()
  })

  cmds.push({
    id: 'action.drag',
    title: sites.dragEnabled ? '完成手动排序' : '手动排序',
    subtitle: '拖拽卡片调整顺序',
    section: 'action',
    icon: 'drag',
    keywords: ['paixu', 'px', 'tuozhuai', 'tz', 'shoudong', 'sd', 'drag', 'reorder'],
    run: () => sites.toggleDragMode()
  })

  cmds.push({
    id: 'action.emptyTrash',
    title: '清空回收站',
    subtitle: sites.trash?.length ? `回收站现有 ${sites.trash.length} 条，清空后不可恢复` : '回收站是空的',
    section: 'action',
    icon: 'trash',
    keywords: ['qingkong', 'qk', 'huishouzhan', 'hsz', 'trash', 'empty', 'shanchu'],
    run: () => {
      const n = sites.trash?.length || 0
      sites.emptyTrash()
      toast.push({ message: n ? `已清空回收站（${n} 条）` : '回收站本来就是空的', tone: 'ok' })
    }
  })

  cmds.push({
    id: 'action.clearSearch',
    title: '清除搜索',
    subtitle: '清空当前搜索词，恢复完整列表',
    section: 'action',
    icon: 'close',
    keywords: ['qingchu', 'qc', 'qingkongsousuo', 'clear', 'chongzhi', 'cz'],
    run: () => sites.setSearchQuery('')
  })

  cmds.push({
    id: 'action.undo',
    title: '撤销上一步',
    subtitle: '撤回最近一次批量改分类/加用途/置顶/归档或删除（5 秒内有效）',
    section: 'action',
    icon: 'undo',
    // 后端（stores/undo.js）只留 5 秒窗口，所以这条命令天然会「过了就撤不了」——
    // 撤不动时 undo 自己会弹「这一步已经撤不回来了」，不用命令表操心
    keywords: ['chexiao', 'cx', 'undo', 'huitui', 'ht', 'shouhua'],
    run: () => undo?.()
  })

  /* ── 站点操作：不进注册表，因为需要 site 参数 ── */
  cmds.siteActions = buildSiteActions(ctx)
  cmds.purposes = PURPOSE_TAGS
  cmds.favorites = favorites

  return cmds
}

/**
 * 站点二级页的操作列表。对象在前、动作在后（选中站点 → Tab 展开），
 * 比 `>命令 <站点名>` 少一次心智切换，也不会在命令和站点名之间产生歧义。
 */
/* 站点二级页动作已抽到 src/utils/siteActions.js（它需要 site 参数，不属于全局注册表）。 */
import { buildSiteActions } from './siteActions';
export { buildSiteActions };
