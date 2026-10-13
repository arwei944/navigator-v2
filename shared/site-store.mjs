/**
 * 站点数据存储 **提供者注册表（热拔插）** + 接口契约。
 *
 * ## 为什么需要（先盘点现状）
 *
 * 底层其实**已经可移植**：`server/store.mjs` 是「Blob 同名同签名适配层」，
 * 用 `node:sqlite` 实现了 `get / put / list / del` + CAS —— 「脱离 Vercel」这件事已做到。
 *
 * 真正缺的是**上一层**：站点数据的语义（版本递增、CAS 防并发丢更新、发布前快照、
 * 快照保留策略）现在**长在 `api/sites.js` 里**，与 HTTP 处理缠在一起。
 * 想换一个存储形态（GitHub 仓库 / D1 / 外部 API / 纯静态托管）就得动那个 362 行的接口文件。
 * 本模块把这份语义抽成可替换的 provider。
 *
 * ## 接口契约（三条硬不变量）
 *
 *   `read()`                     → `{ data, etag }`（无数据时 `{ data: null, etag: null }`）
 *   `write(data, { ifMatch })`   → `{ etag }`（**原样写入**；`ifMatch` 与当前 etag 不符 → 抛错）
 *   `listSnapshots()`            → `[{ pathname, ... }]`（新到旧）
 *   `writeSnapshot(data)`        → `{ ok, pathname }`
 *   `pruneSnapshots()`           → `{ deleted }`
 *   `nextVersion(data)`          → `number`（纯函数）
 *
 * ① **CAS 是唯一闸门**：read-modify-write 必须带 `ifMatch`，否则并发会静默丢更新；
 * ② **版本单调递增**：由调用方用 `nextVersion()` 构造 data —— provider **不擅自改**传入的 data，
 *    这样接入时与 `api/sites.js` 现有语义**逐字对齐**（那里的 version 就是 handler 算的）；
 * ③ **覆盖前先快照**：`writeSnapshot` 落一份带版本号的文件，保留 `SNAPSHOT_KEEP` 份。
 *
 * ## capabilities 声明
 *
 * 不是每个后端都支持全部能力（纯静态托管没有 `list`，文件系统没有原子 CAS）。
 * provider **必须如实声明**，调用方据此降级，而不是撞上一个「方法不存在」。
 *
 * ## 本轮范围（刻意保守 —— 与原设计清单的「谨慎批」口径一致）
 *
 * **接口与 provider 就位、契约测试到位，但暂不替换 `api/sites.js` 的生产写路径。**
 * 那里还叠着种子兜底 / 304 条件请求 / 快照裁剪等边角语义，搬家需要单独一轮灰度与双跑对账。
 * 本模块的 `kv` provider 就是那套逻辑的可替换实现，而 `tools/console/test-sites-cas.mjs`
 * （CAS 语义的既有 12 条断言）正是将来对账的标准。
 */
import { SNAPSHOT_PREFIX, SNAPSHOT_KEEP, snapshotPathname, prunableSnapshots } from './snapshots.mjs'

const registry = new Map()
let seq = 0

/**
 * 注册一个站点存储 provider。
 *
 * @param {{
 *   id: string,
 *   label?: string,
 *   order?: number,
 *   capabilities?: { cas?: boolean, snapshots?: boolean, listable?: boolean },
 *   available?: (ctx: object) => boolean,
 *   create: (ctx: object) => object,     // 返回绑定了 ctx 的实例方法
 * }} spec
 */
export function registerSiteStore(spec) {
  if (!spec || !spec.id) throw new Error('站点存储 provider 必须提供 id')
  if (typeof spec.create !== 'function') throw new Error(`站点存储 provider ${spec.id} 缺少 create`)
  const entry = {
    id: String(spec.id),
    label: spec.label ? String(spec.label) : String(spec.id),
    order: Number.isFinite(spec.order) ? spec.order : 100 + seq,
    capabilities: { cas: false, snapshots: false, listable: false, ...(spec.capabilities || {}) },
    available: typeof spec.available === 'function' ? spec.available : () => true,
    create: spec.create,
  }
  seq += 1
  registry.set(entry.id, entry)
  return entry
}

/** provider 清单（供控制台/接口展示） */
export function listSiteStores({ check = true, ctx = {} } = {}) {
  return [...registry.values()]
    .sort((a, b) => a.order - b.order)
    .map(p => ({
      id: p.id, label: p.label, order: p.order,
      capabilities: p.capabilities,
      available: check ? Boolean(p.available(ctx)) : true,
    }))
}

/** 版本递增（纯函数）：调用方构造 data 时用，provider 不改传入的 data */
export function nextVersion(data) {
  return (Number(data && data.version) || 0) + 1
}

/**
 * 解析出当前生效的站点存储实例。
 * 优先级：显式 id → `NAV_SITE_STORE` → 第一个 `available(ctx)` 为真的 provider。
 */
export function resolveSiteStore({ explicit, ctx = {} } = {}) {
  const all = [...registry.values()].sort((a, b) => a.order - b.order)
  const want = String(explicit || process.env.NAV_SITE_STORE || '').trim().toLowerCase()
  const chosen = want
    ? (all.find(p => p.id === want) || all.find(p => p.available(ctx)))
    : all.find(p => p.available(ctx))
  const provider = chosen || all[0]
  if (!provider) throw new Error('没有可用的站点存储 provider')
  return { id: provider.id, label: provider.label, ...provider.capabilities, ...provider.create(ctx) }
}

/* ---------------- 内建 provider 一：键值存储（#store：Blob / SQLite） ---------------- */

const SITES_PATHNAME = 'sites.json'

registerSiteStore({
  id: 'kv',
  label: '键值存储（#store：SQLite / Blob）',
  order: 100,
  capabilities: { cas: true, snapshots: true, listable: true },
  /** 需要一个实现了 get/put/list/del 的 kv（由调用方注入：#store 或测试替身） */
  available: (ctx) => Boolean(ctx && ctx.kv && typeof ctx.kv.put === 'function' && typeof ctx.kv.get === 'function'),
  create: (ctx) => {
    const kv = ctx.kv
    const pathname = String((ctx && ctx.pathname) || SITES_PATHNAME)
    return {
      async read() {
        const blob = await kv.get(pathname, { access: 'private', useCache: false })
        if (!blob || !blob.stream) return { data: null, etag: null }
        const text = await new Response(blob.stream).text()
        let data = null
        try { data = JSON.parse(text) } catch { data = null }
        // sites.js 读 (blob.blob && blob.blob.etag) || blob.etag —— 两个位置都认
        const etag = (blob.blob && blob.blob.etag) || blob.etag || null
        return { data, etag }
      },
      async write(data, { ifMatch } = {}) {
        const opts = { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' }
        if (ifMatch != null) opts.ifMatch = ifMatch
        const res = await kv.put(pathname, JSON.stringify(data), opts)
        return { etag: (res && res.etag) || null }
      },
      async listSnapshots() {
        const { blobs } = await kv.list({ prefix: SNAPSHOT_PREFIX, limit: 1000 })
        return (blobs || []).map(b => ({ pathname: b.pathname, size: b.size, uploadedAt: b.uploadedAt }))
      },
      async writeSnapshot(data) {
        const p = snapshotPathname(Number(data && data.version) || 0)
        try {
          await kv.put(p, JSON.stringify(data), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' })
          return { ok: true, pathname: p }
        } catch (e) {
          return { ok: false, pathname: p, error: String((e && e.message) || e) }
        }
      },
      async pruneSnapshots() {
        const { blobs } = await kv.list({ prefix: SNAPSHOT_PREFIX, limit: 1000 })
        const doomed = prunableSnapshots((blobs || []).map(b => b.pathname), SNAPSHOT_KEEP)
        if (!doomed.length) return { deleted: 0 }
        await kv.del(doomed)
        return { deleted: doomed.length }
      },
    }
  },
})

/* ---------------- 内建 provider 二：本地目录（JSON 文件，离线/自托管） ---------------- */

registerSiteStore({
  id: 'fs',
  label: '本地目录（JSON 文件）',
  order: 200,
  /**
   * 文件系统**没有原子 CAS**：如实声明 cas=false，调用方据此约束「单写者」场景。
   * 谎报 true 会让并发写悄悄丢更新，比不支持更糟。
   */
  capabilities: { cas: false, snapshots: true, listable: true },
  available: (ctx) => Boolean(ctx && ctx.dir),
  create: (ctx) => {
    const dir = ctx.dir
    const fs = ctx.fs
    const path = ctx.path
    const file = path.join(dir, SITES_PATHNAME)
    const snapDir = path.join(dir, 'snapshots')
    const readJson = (p) => {
      try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null } catch { return null }
    }
    return {
      async read() {
        const data = readJson(file)
        if (!data) return { data: null, etag: null }
        // 用 mtime+size 当 etag：够用且不引入额外状态文件
        let etag = null
        try { const st = fs.statSync(file); etag = `fs-${st.mtimeMs}-${st.size}` } catch { etag = null }
        return { data, etag }
      },
      async write(data, { ifMatch } = {}) {
        if (ifMatch != null) {
          let cur = null
          try { const st = fs.statSync(file); cur = `fs-${st.mtimeMs}-${st.size}` } catch { cur = null }
          if (cur !== ifMatch) throw new Error('PreconditionFailed（本地目录存储不支持安全并发写）')
        }
        fs.mkdirSync(dir, { recursive: true })
        const tmp = `${file}.tmp`
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
        fs.renameSync(tmp, file)
        let etag = null
        try { const st = fs.statSync(file); etag = `fs-${st.mtimeMs}-${st.size}` } catch { etag = null }
        return { etag }
      },
      async listSnapshots() {
        try {
          if (!fs.existsSync(snapDir)) return []
          return fs.readdirSync(snapDir).sort().reverse().map(name => ({ pathname: `${SNAPSHOT_PREFIX}${name}` }))
        } catch { return [] }
      },
      async writeSnapshot(data) {
        try {
          fs.mkdirSync(snapDir, { recursive: true })
          const name = snapshotPathname(Number(data && data.version) || 0).slice(SNAPSHOT_PREFIX.length)
          fs.writeFileSync(path.join(snapDir, name), JSON.stringify(data, null, 2) + '\n', 'utf8')
          return { ok: true, pathname: `${SNAPSHOT_PREFIX}${name}` }
        } catch (e) {
          return { ok: false, error: String((e && e.message) || e) }
        }
      },
      async pruneSnapshots() {
        try {
          if (!fs.existsSync(snapDir)) return { deleted: 0 }
          const names = fs.readdirSync(snapDir).map(n => `${SNAPSHOT_PREFIX}${n}`)
          const doomed = prunableSnapshots(names, SNAPSHOT_KEEP)
          for (const p of doomed) {
            try { fs.rmSync(path.join(snapDir, p.slice(SNAPSHOT_PREFIX.length)), { force: true }) } catch { /* 忽略单个失败 */ }
          }
          return { deleted: doomed.length }
        } catch { return { deleted: 0 } }
      },
    }
  },
})
