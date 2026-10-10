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
  const { router, sites, categories, preferences, sidebar, omni, toast, favorites, notes } = ctx

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
export function buildSiteActions(ctx) {
  const { sites, favorites, sidebar, omni, toast, openSite, siteNotes } = ctx

  return function actionsFor(site) {
    if (!site) return []
    const fav = favorites.isFav(site.id)
    const list = [
      {
        id: 'site.open',
        title: '打开站点',
        subtitle: site.url,
        icon: 'external',
        keywords: ['dakai', 'dk', 'open', 'visit'],
        run: () => openSite(site)
      },
      {
        id: 'site.detail',
        title: '查看详情',
        subtitle: site.desc || site.url,
        icon: 'info',
        keywords: ['xiangqing', 'xq', 'chakan', 'ck', 'detail', 'info'],
        run: () => sidebar.showDetail(site)
      },
      {
        id: 'site.copy',
        title: '复制链接',
        subtitle: `https://${site.url}`,
        icon: 'copy',
        keywords: ['fuzhi', 'fz', 'lianjie', 'lj', 'copy', 'url'],
        run: async () => {
          try {
            await navigator.clipboard.writeText(`https://${site.url}`)
            toast.push({ message: '链接已复制', tone: 'ok', duration: 2000 })
          } catch {
            toast.push({ message: '复制失败，浏览器拒绝了剪贴板访问', tone: 'error' })
          }
        }
      },
      {
        id: 'site.favorite',
        title: fav ? '取消收藏' : '收藏站点',
        subtitle: fav ? '从收藏里移除' : '加入收藏',
        icon: 'star',
        keywords: ['shoucang', 'sc', 'favorite', 'fav', 'xihuan'],
        run: () => {
          favorites.toggle(site.id)
          toast.push({ message: fav ? '已取消收藏' : '已收藏', tone: 'ok', duration: 2000 })
        }
      },
      {
        id: 'site.pin',
        title: site.pinned ? '取消置顶' : '置顶站点',
        subtitle: site.pinned ? '取消后回到默认排序位置' : '钉在当前列表最前',
        icon: 'pin',
        keywords: ['zhiding', 'zd', 'pin', 'guding', 'gd'],
        run: () => {
          const next = sites.togglePin(site.id)
          toast.push({ message: next ? '已置顶' : '已取消置顶', tone: 'ok', duration: 2000 })
        }
      },
      {
        id: 'site.archive',
        title: site.archived ? '取消归档' : '归档站点',
        subtitle: site.archived ? '放回日常列表' : '不再日常使用，但保留',
        icon: 'archive',
        keywords: ['guidang', 'gd', 'archive', 'yincang', 'yc'],
        run: () => {
          const next = sites.toggleArchive(site.id)
          toast.push({ message: next ? '已归档' : '已取消归档', tone: 'ok', duration: 2000 })
        }
      },
      {
        id: 'site.note',
        title: siteNotes?.has(site.id) ? '编辑备注' : '添加备注',
        subtitle: siteNotes?.has(site.id)
          ? siteNotes.textOf(site.id)
          : '记下额度、注意事项 —— 备注只存在你自己的设备上',
        icon: 'comment',
        keywords: ['beizhu', 'bz', 'note', 'pizhu', 'pz', 'jilu', 'jl'],
        run: () => sidebar.showDetail(site)
      },
      {
        id: 'site.edit',
        title: '编辑站点',
        subtitle: '改名称、网址、描述、分类与用途',
        icon: 'edit',
        keywords: ['bianji', 'bj', 'xiugai', 'xg', 'edit', 'gengxin'],
        run: () => omni.requestEdit(site)
      },
      {
        id: 'site.delete',
        title: '删除站点',
        subtitle: '移入回收站，可在回收站恢复',
        icon: 'trash',
        danger: true,
        keywords: ['shanchu', 'sc', 'delete', 'remove', 'yichu'],
        run: () => omni.requestDelete(site)
      }
    ]
    return list
  }
}
