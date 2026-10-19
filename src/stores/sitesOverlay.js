/**
 * 站点「本地覆盖层」的读写 —— 从 `stores/sites.js` 抽出的纯函数层。
 *
 * ## 覆盖层解决什么问题
 *
 * 云端数据是**基底**，访客自己的增 / 改 / 删 / 排序叠加其上并持久化。
 * 没有这一层时，30 秒轮询的 `applyCloudData` 会用云端数组整体替换 sites，
 * 访客新增的站点、改过的字段、删掉的条目会被全部冲掉（只有 visitCount 侥幸保留）。
 * 云端下架的站点不在基底里、也不在覆盖层里，自然从视图消失 —— 下架仍能正常传导。
 *
 * ## 为什么单独成文件
 *
 * 它是**纯数据整形**：读盘时逐条净化、写盘时统一编码。没有任何响应式或 store 依赖，
 * 因此可以在 Node 侧直接断言「存储被改坏时不会让首屏白屏」——
 * 这在 store 内部是测不到的（要先建 Pinia、还要 mock localStorage）。
 */
import { encodeStored, decodeStored } from '../utils/storeVersioning.js'
import { safeSetItem } from '../utils/safeStorage.js'

const OVERLAY_KEY = 'nav-sites-overlay'

/** 覆盖层里一条「足够像站点」的记录：有非空字符串 id 是重建列表的最低要求 */
export function isOverlaySite(x) {
  return Boolean(x) && typeof x === 'object' && !Array.isArray(x) && typeof x.id === 'string' && x.id
}

/**
 * 读盘并净化。
 *
 * `adds` **逐条过滤**（不是只判顶层是不是数组）：存储被外部改坏时，一条 null 就足以让
 * rebuild 在 materialize 里读 src.id 抛错，而那是首屏路径 —— 结果是永久白屏。
 * 过滤掉坏条目、保住其余数据，比整体丢弃或崩溃都好。
 */
export function loadOverlay() {
  const d = decodeStored(OVERLAY_KEY, localStorage.getItem(OVERLAY_KEY), null)
  return {
    adds: Array.isArray(d?.adds) ? d.adds.filter(isOverlaySite) : [],
    edits: d?.edits && typeof d.edits === 'object' ? d.edits : {},
    deletes: Array.isArray(d?.deletes) ? d.deletes.filter((x) => typeof x === 'string' && x) : [],
    order: Array.isArray(d?.order) ? d.order.filter((x) => typeof x === 'string' && x) : [],
    visits: d?.visits && typeof d.visits === 'object' ? d.visits : {},
  }
}

/** 写盘（带 schema 版本号）。所有 overlay 改动最终都汇到这里，不散在各函数里。 */
export function saveOverlay({ adds, edits, deletes, order, visits }) {
  safeSetItem(
    OVERLAY_KEY,
    encodeStored({
      adds,
      edits,
      deletes,
      order,
      visits,
    }),
  )
}

export { OVERLAY_KEY }
