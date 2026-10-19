/**
 * 站点的本地改动（单站 / 批量 / 排序 / 回收站）。
 *
 * ## 这一层解决什么问题
 *
 * 覆盖层有两层：`localAdds`（本地新增）与 `localEdits`（对云端站点的补丁）。
 * 「改一条站」到底是改哪一层，取决于它是不是本地新增的 —— 这个判断此前在
 * `addSite / updateSite / batchUpdate / batchPatch / applySortOrder` 里各写了一遍，
 * 五份几乎相同、但不完全相同的分支。错一份就是「改了不生效」或「改到错误的地方」。
 *
 * 现在收敛成两个原语：
 *   - `patchOne`：改一条（自动判断落在哪一层）
 *   - `commit`  ：重建 + 落盘（批量操作只在最后调一次）
 *
 * ## 为什么是工厂而不是纯函数
 *
 * 它需要读写 ref 并调用 rebuild/saveOverlay —— 这些是 store 的所有权。
 * 工厂接收这些依赖，自己不持有任何状态；于是「改哪一层」的规则只有一份，
 * 而调用方仍是 store。
 *
 * @param {object} deps
 * @param {object} deps.localAdds ref
 * @param {object} deps.localEdits ref
 * @param {object} deps.localDeletes ref
 * @param {object} deps.localOrder ref
 * @param {object} deps.historyStore 访问记录 store（唯一存储，recordVisit 写这里）
 * @param {object} deps.trash ref
 * @param {object} deps.selectedIds ref
 * @param {object} deps.sites ref（渲染列表，只读）
 * @param {object} deps.cloudSites ref（只读，用于取 id）
 * @param {() => void} deps.rebuild
 * @param {() => void} deps.saveOverlay
 * @param {() => void} deps.saveTrash
 */
export function createSiteMutations({
  localAdds,
  localEdits,
  localDeletes,
  localOrder,
  historyStore,
  trash,
  selectedIds,
  sites,
  cloudSites,
  rebuild,
  saveOverlay,
  saveTrash,
}) {
  /** 一条 id 是否在本地新增层（决定补丁写哪一层） */
  function isLocalAdd(id) {
    return localAdds.value.some((s) => s.id === id)
  }

  /** 把补丁落到正确的层。返回是否真的命中。 */
  function patchOne(id, patch) {
    const idx = localAdds.value.findIndex((s) => s.id === id)
    if (idx !== -1) {
      localAdds.value[idx] = { ...localAdds.value[idx], ...patch }
      return true
    }
    // 不在新增层：只有确实存在于当前列表的才记补丁，避免给不存在的 id 写垃圾
    if (sites.value.some((s) => s.id === id)) {
      localEdits.value[id] = { ...(localEdits.value[id] || {}), ...patch }
      return true
    }
    return false
  }

  /**
   * 提交：重建渲染列表并落盘。
   * 批量操作只在循环之后调用一次 —— 逐条提交会触发 N 次全量 rebuild + N 次 localStorage 写。
   */
  function commit({ overlay = true } = {}) {
    rebuild()
    if (overlay) saveOverlay()
  }

  /* ---------------- 新增 ---------------- */

  function makeId(now, salt = '') {
    return now.toString(36) + Math.random().toString(36).slice(2, 6) + salt
  }

  function addSite(site) {
    const now = Date.now()
    const created = {
      id: makeId(now),
      sortOrder: cloudSites.value.length + localAdds.value.length,
      visitCount: 0,
      createdAt: now,
      updatedAt: now,
      ...site,
    }
    localAdds.value.push(created)
    /*
     * 新收录的站排在**最前面**：localOrder 只描述这批 id 的相对顺序，把新 id 放到
     * 位置 0 即可让它在默认顺序（云端原序）里排第一 —— 「最新收录一眼看到」，
     * 且不影响其余站点的相对顺序，用户随后仍可拖拽调整。
     */
    localOrder.value = [created.id, ...localOrder.value]
    commit()
    return created
  }

  /**
   * 批量新增（书签导入用）：一次写完再 rebuild 一次 —— 逐条调 addSite 会触发 N 次
   * 全量 rebuild + saveOverlay，导入几百条书签就是几百次重算 + 几百次 localStorage 写。
   */
  function addSites(list) {
    const created = []
    for (const site of list || []) {
      const now = Date.now()
      const rec = {
        id: makeId(now, created.length.toString(36)),
        sortOrder: cloudSites.value.length + localAdds.value.length + created.length,
        visitCount: 0,
        createdAt: now,
        updatedAt: now,
        ...site,
      }
      localAdds.value.push(rec)
      created.push(rec)
    }
    if (!created.length) return created
    // 与 addSite 同一口径：新收录的排最前，且保持导入文件里的相对顺序
    localOrder.value = [...created.map((c) => c.id), ...localOrder.value]
    commit()
    return created
  }

  /* ---------------- 修改 ---------------- */

  function updateSite(id, data) {
    patchOne(id, { ...data, updatedAt: Date.now() })
    commit()
  }

  function updateSiteField(id, key, value) {
    updateSite(id, { [key]: value })
  }

  /**
   * 批量改字段：一次遍历写出，最后只 rebuild 一次。
   * @returns {number} 实际改动的条数（不存在的 id 静默忽略）
   */
  function batchUpdate(ids, patch) {
    const p = { ...patch, updatedAt: Date.now() }
    let touched = 0
    for (const id of new Set(ids)) if (patchOne(id, p)) touched++
    if (touched) commit()
    return touched
  }

  /** 批量改分类 */
  function batchSetCategory(ids, categoryId) {
    return categoryId ? batchUpdate(ids, { categoryId }) : 0
  }

  /** 批量加用途：已有该用途的跳过，避免标签重复堆叠 */
  function batchAddPurpose(ids, purposeId) {
    if (!purposeId) return 0
    const now = Date.now()
    let touched = 0
    for (const id of new Set(ids)) {
      const site = sites.value.find((s) => s.id === id)
      if (!site) continue
      const purposes = Array.isArray(site.purposes) ? site.purposes : []
      if (purposes.includes(purposeId)) continue
      if (patchOne(id, { purposes: [...purposes, purposeId], updatedAt: now })) touched++
    }
    if (touched) commit()
    return touched
  }

  /**
   * 批量应用**各不相同**的补丁：`[{ id, patch }, ...]`。
   *
   * 与 `batchUpdate`（同一个 patch 给所有 id）分工明确：
   *   - 前进用 batchUpdate（语义清晰，调用方不必构造每条的补丁）；
   *   - 撤销用本函数（每个站要恢复成各自不同的原值）。
   */
  function batchPatch(ops) {
    const now = Date.now()
    let touched = 0
    for (const o of Array.isArray(ops) ? ops : []) {
      if (!o || !o.id || !o.patch || typeof o.patch !== 'object') continue
      if (patchOne(o.id, { ...o.patch, updatedAt: now })) touched++
    }
    if (touched) commit()
    return touched
  }

  /* ---------------- 删除 / 访问 / 排序 ---------------- */

  /** 从本地视图移除：本地新增的连数据一起删，云端来的记一条「本地隐藏」墓碑 */
  function removeLocally(id) {
    const idx = localAdds.value.findIndex((s) => s.id === id)
    if (idx !== -1) {
      localAdds.value.splice(idx, 1)
      delete localEdits.value[id]
      return
    }
    if (!localDeletes.value.includes(id)) localDeletes.value.push(id)
  }

  function deleteSite(id) {
    const site = sites.value.find((s) => s.id === id)
    if (site) trash.value.push({ ...site, deletedAt: Date.now() })
    removeLocally(id)
    /*
     * 顺手把这条从批量选择里摘掉：否则「已选 3 个」的计数会含一条不存在的站，
     * 后续批量操作会拿它去匹配，结果既删不动也清不掉。
     */
    if (selectedIds.value.has(id)) {
      const next = new Set(selectedIds.value)
      next.delete(id)
      selectedIds.value = next
    }
    rebuild()
    /*
     * 先落回收站再落覆盖层：回收站是「删过什么」的唯一证据，
     * 万一配额溢出只能写入一处，宁可丢墓碑也不能让这条记录凭空消失。
     */
    saveTrash()
    saveOverlay()
  }

  /**
   * 记一次访问：本机记录 + 云端口径上报。
   *
   * 改动前这里要写三处（visitCounts、site.visitCount、history.records），
   * 因为「次数」和「时间」分属两份存储。现在本机只写 `historyStore` 一份：
   * `visits[id] = { count, lastAt }` 同时承载计数与时间，`visitCounts` 是它的投影，
   * rebuild 会自动跟上，不再需要就地改 `site.visitCount` 来「让角标立刻 +1」。
   */
  function recordVisit(id, clicksStore) {
    const site = sites.value.find((s) => s.id === id)
    if (!site) return
    historyStore.addRecord(id)
    saveOverlay()
    // 云端口径：所有访客的全局点击量（卡片角标 / 排行的权威来源），攒批后匿名上报
    clicksStore.record(id)
  }

  function reorderSites(newOrderedSites) {
    // 只调整这批 id 的相对位置，其余站点原地不动。渲染按数组顺序，
    // 故不改 sortOrder —— 它是云端的全局序号，前端重排不应覆盖它。
    const target = newOrderedSites.map((s) => s.id)
    const targetSet = new Set(target)
    const next = []
    let injected = false
    for (const s of sites.value) {
      if (targetSet.has(s.id)) {
        if (!injected) {
          next.push(...target)
          injected = true
        }
        continue
      }
      next.push(s.id)
    }
    if (!injected) next.push(...target)
    localOrder.value = next
    commit()
  }

  /**
   * 按给定顺序重写这批站点的 `sortOrder`（后台拖拽排序用）。
   *
   * 只改**被拖动的这批**：把它们的 sortOrder 按新顺序连续编号，起点沿用其中最小的原值，
   * 未参与拖拽的站点一律不动。为什么不整体重排 —— 拖一次就把全库 300 条的 sortOrder
   * 全改，会产生一次巨大的数据 diff（云端同步、发布预演、审计都被它淹没）。
   *
   * 与 `reorderSites` 的分工：那个改的是**本机视角**的相对顺序（localOrder，不同步），
   * 这个写的是**落库的 sortOrder**（会随数据发布同步给所有人）。
   */
  function applySortOrder(orderedIds) {
    const ids = [...(orderedIds || [])]
    if (!ids.length) return 0
    const byId = new Map(sites.value.map((s) => [s.id, s]))
    const base = Math.min(...ids.map((id) => Number(byId.get(id)?.sortOrder) || 0))
    const now = Date.now()
    let touched = 0
    for (let i = 0; i < ids.length; i++) {
      const s = byId.get(ids[i])
      if (!s) continue
      const want = base + i
      if (Number(s.sortOrder) === want) continue
      if (patchOne(ids[i], { sortOrder: want, updatedAt: now })) touched++
    }
    if (touched) commit()
    return touched
  }

  /**
   * 撤销一次「自动添加」：只从本地新增层摘掉，不进回收站。
   * 自动添加没有人工确认这一步，撤销就要能彻底当没发生过。
   */
  function undoAdd(id) {
    const idx = localAdds.value.findIndex((s) => s.id === id)
    if (idx === -1) return false
    localAdds.value.splice(idx, 1)
    delete localEdits.value[id]
    commit()
    return true
  }

  return {
    isLocalAdd,
    patchOne,
    commit,
    addSite,
    addSites,
    updateSite,
    updateSiteField,
    batchUpdate,
    batchSetCategory,
    batchAddPurpose,
    batchPatch,
    removeLocally,
    deleteSite,
    recordVisit,
    reorderSites,
    applySortOrder,
    undoAdd,
  }
}
