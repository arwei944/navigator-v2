/**
 * 渲染列表重建：把「云端基底 + 本地覆盖层」拼成 cards 要用的数组。
 *
 * ## 为什么需要记忆表（memo）
 *
 * 渲染层按 **prop 的对象身份** 决定要不要跳过子组件更新。
 * 早期版本对每条站点都 `{ ...s, visitCount }` 展开出新对象，于是「改 1 个站点」
 * （置顶 / 归档 / 编辑 / 记一次访问）或一次 30s 云端轮询，都会让 300 张卡片的
 * `site` prop 全部换新 —— 300 个组件全部重渲染，而其中 299 个的内容一字未改。
 *
 * 现在的判据是三个来源标记的**身份**而非内容比对（O(1)，不做字符串拼接）：
 *   - src    云端数组里的那个对象 / 本地新增层里的那个对象
 *   - edit   该 id 的编辑补丁对象（updateSite 会整体换掉它）
 *   - visits 该 id 的本地访问计数（数字）
 * 三者都没变就沿用上次那个对象，未变的卡片因 prop 恒等被 Vue 跳过。
 *
 * ## ⚠️ 依赖的不变量
 *
 * **来源对象一律整体替换，绝不就地改字段。**
 *   - 云端 src 来自 `res.json()`，每次轮询都是新解析出来的新对象；
 *   - 本地新增层在 updateSite / batchUpdate 里是 `localAdds[i] = { ...old, ...patch }`；
 *   - 本地编辑层同理整体替换 `localEdits[id]`。
 * 若将来有人写下 `cloudSites.value[i].name = x` 这样的就地改，视图不会跟着变 ——
 * 因为 src 身份没变、memo 会照旧返回上一个对象。要改数据请走 updateSite /
 * applyCloudData 这条路，不要碰数组元素。
 *
 * 与 recordVisit 的配合：那里会直接改 `site.visitCount`（为了让卡片角标立刻 +1），
 * 于是 out 被就地改过、下一次 rebuild 的 visits 与记忆不符 → 那一条必然重建。
 * 这是刻意接受的：只重建被点的那一张，且顺带把记忆同步回真实值（改的是 out，
 * 不是 src，所以不违反上面那条不变量）。
 *
 * ## 为什么抽成纯函数
 *
 * memo 是「性能正确性」的一部分，但它此前是 `defineStore` 内部的闭包状态，
 * 只能在浏览器里靠肉眼观察判断有没有失效。抽出来后可以构造两个数组直接断言
 * 「未变的站点必须是同一个对象引用」—— 这条断言比任何注释都可靠。
 */

/**
 * @param {object} input
 * @param {any[]} input.cloudSites 云端基底
 * @param {any[]} input.localAdds 本地新增层
 * @param {object} input.localEdits 本地编辑层（id → patch）
 * @param {string[]} input.localDeletes 墓碑（被本地删除的 id）
 * @param {string[]} input.localOrder 本地排序（只描述这批 id 的相对顺序）
 * @param {object} input.visits 本地访问计数（id → number）
 * @param {Map<string, object>} input.prevMemo 上一次的记忆表
 * @param {any[]} input.prevList 上一次的渲染列表（用于恒等判断）
 * @returns {{ list: any[], memo: Map<string, object> }}
 */
export function rebuildSites({ cloudSites, localAdds, localEdits, localDeletes, localOrder, visits, prevMemo, prevList }) {
  const deleted = new Set(localDeletes)
  const edits = localEdits
  const next = new Map()

  /** 把一条来源对象物化成渲染用对象，能复用则复用 */
  function materialize(src, edit) {
    const id = src.id
    const v = visits[id] ?? src.visitCount ?? 0
    const prev = prevMemo.get(id)
    if (prev && prev.src === src && prev.edit === edit && prev.visits === v) {
      next.set(id, prev)
      return prev.out
    }
    const out = edit ? { ...src, ...edit, visitCount: v } : { ...src, visitCount: v }
    next.set(id, { src, edit, visits: v, out })
    return out
  }

  const base = cloudSites.filter((s) => !deleted.has(s.id)).map((s) => materialize(s, edits[s.id] || null))
  const adds = localAdds.filter((s) => !deleted.has(s.id)).map((s) => materialize(s, null))

  let list = [...base, ...adds]

  // localOrder 只描述这批 id 的相对顺序，未登记的站点（如云端新收录的）保持原有位置
  if (localOrder.length) {
    const pos = new Map(localOrder.map((id, i) => [id, i]))
    list = list
      .map((site, i) => ({ site, i }))
      .sort((a, b) => {
        const pa = pos.has(a.site.id) ? pos.get(a.site.id) : Infinity
        const pb = pos.has(b.site.id) ? pos.get(b.site.id) : Infinity
        return pa === pb ? a.i - b.i : pa - pb
      })
      .map((x) => x.site)
  }

  /*
   * 顺序与内容都逐项恒等时，连数组引用都不换：ref 赋值同一个数组不会触发任何
   * 依赖它的 computed / 渲染，省下一整趟 300 张卡的 diff。
   */
  const identical = prevList.length === list.length && list.every((s, i) => s === prevList[i])
  return { list: identical ? prevList : list, memo: next }
}
