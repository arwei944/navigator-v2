/**
 * 站点二级页的操作列表（选中站点后按 Tab 展开）。
 *
 * ## 为什么独立成模块
 *
 * 它需要 site 参数，因此不能进命令注册表；但它的体量（约 125 行）与命令表相当，
 * 两者放一起时 commands.js 承担「注册表 + 站点动作」两份职责。
 * 拆分后 commands.js 只回答「有哪些全局命令」，这里只回答「对一个站点能做什么」。
 *
 * 对象在前、动作在后（选中站点 → Tab 展开），比 `>命令 <站点名>` 少一次心智切换，
 * 也不会在命令和站点名之间产生歧义。
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
        id: 'site.refresh',
        title: '重新获取信息',
        subtitle: '按网址重新抓取名称、描述与图标（别名、用途、分类不动）',
        icon: 'refresh',
        keywords: ['shuaxin', 'sx', 'refresh', 'chongxin', 'cx', 'gengxin', 'gx', 'zhuiqu'],
        run: async () => {
          toast.push({ message: `正在重新获取「${site.name}」…`, tone: 'info', duration: 2500 })
          const { refreshSiteMeta } = await import('@/services/siteRefresh')
          const r = await refreshSiteMeta({
            site,
            update: (p) => sites.updateSite(site.id, p),
          })
          if (!r.ok) {
            toast.push({ message: `重新获取失败：${r.message}`, tone: 'error', duration: 4500 })
            return
          }
          toast.push({
            message: r.changed ? `「${site.name}」${r.message}` : `「${site.name}」已是最新`,
            tone: r.changed ? 'ok' : 'info',
            duration: 2500,
          })
        }
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
