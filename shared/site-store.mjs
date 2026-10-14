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
 *   `read()`                               → `{ data, etag }`（无数据 `{ data: null, etag: null }`）
 *   `readAt(pathname)`                     → 任意 pathname 的 JSON 对象；不存在 → `null`
 *   `write(data, { ifMatch, createOnly })` → `{ etag }`（**原样写入**；`ifMatch` 与当前 etag 不符 → 抛错；
 *                                            `createOnly` → 只在不存在时创建，已存在 → 抛错）
 *   `listSnapshots()`                      → `[{ pathname, size, uploadedAt }]`
 *   `writeSnapshot(data)`                  → `{ ok, pathname }`（**撞名不覆盖**；失败 `{ ok: false, error }`）
 *   `pruneSnapshots()`                     → `{ ok, deleted }`（失败 `{ ok: false, error }`）
 *   `nextVersion(data)`                    → `number`（纯函数）
 *
 * **`read()` / `readAt()` 解析失败必须抛，不得吞成 `null`。** 上层把「读不出来」与「没有数据」
 * 分成两条路：前者 503 保留现场，后者才允许种子初始化。provider 若把半截 JSON 静默变成 `null`，
 * 上层就会把一次读故障当成「首次部署」，用种子覆盖掉线上真实数据 —— 这正是 `api/sites.js`
 * 注释里反复强调的那条口径，provider 必须与它逐字对齐。
 *
 * **`write` 的三种模式**：`ifMatch` 给出 → 条件写（`allowOverwrite: true`）；
 * `createOnly` → 只在不存在时创建（`allowOverwrite: false`，首次部署的并发保护）；
 * 都不给 → 无条件覆盖写。前两种「失败宁可报错也不覆盖」。
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
  // 显式命中的 provider **也要**满足 available(ctx)：否则会返回一个 create() 当场崩掉的实例
  // （如 ctx 没给 dir 却选到 fs，会抛在 path.join(undefined) 上）。
  // 不可用时回落到 ctx 真正支持的那个 —— 回落目标由 ctx 决定，不会静默换到别的存储后端。
  const chosen = want
    ? (all.find(p => p.id === want && p.available(ctx)) || all.find(p => p.available(ctx)))
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
    /**
     * 读一个 pathname 的 JSON：不存在 → `{ data: null, etag: null }`；
     * **解析失败原样抛**（见文件头「read() 解析失败必须抛」）。
     */
    async function readJsonAt(pathnameToRead) {
      const blob = await kv.get(pathnameToRead, { access: 'private', useCache: false })
      if (!blob || !blob.stream) return { data: null, etag: null }
      const text = await new Response(blob.stream).text()
      const data = JSON.parse(text)
      // sites.js 读 (blob.blob && blob.blob.etag) || blob.etag —— 两个位置都认
      const etag = (blob.blob && blob.blob.etag) || blob.etag || null
      return { data, etag }
    }
    return {
      read() { return readJsonAt(pathname) },
      /** 读任意 pathname（快照内容）；不存在 → null，解析失败 → 抛 */
      async readAt(p) { return (await readJsonAt(String(p))).data },
      async write(data, { ifMatch, createOnly } = {}) {
        const opts = { access: 'private', addRandomSuffix: false, contentType: 'application/json' }
        if (ifMatch != null) { opts.ifMatch = ifMatch; opts.allowOverwrite = true }
        // 只在不存在时创建：两个冷启动同时读到「没有数据」，只有一个能写成功，
        // 另一个失败而不是互相覆盖（与 api/sites.js 原本的 putGuarded 逐字对齐）
        else if (createOnly) { opts.allowOverwrite = false }
        else { opts.allowOverwrite = true }
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
          // 名字里已带随机后缀（见 shared/snapshots.mjs），这里**不该**再允许覆盖：
          // 万一真撞名，报错比「悄无声息地盖掉一份用于回滚的快照」安全得多。
          await kv.put(p, JSON.stringify(data), { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' })
          return { ok: true, pathname: p }
        } catch (e) {
          return { ok: false, pathname: p, error: String((e && e.message) || e) }
        }
      },
      async pruneSnapshots() {
        try {
          const { blobs } = await kv.list({ prefix: SNAPSHOT_PREFIX, limit: 1000 })
          const doomed = prunableSnapshots((blobs || []).map(b => b.pathname), SNAPSHOT_KEEP)
          if (doomed.length) await kv.del(doomed)
          return { ok: true, deleted: doomed.length }
        } catch (e) {
          return { ok: false, deleted: 0, error: String((e && e.message) || e) }
        }
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
    const snapshotFile = (name) => path.join(snapDir, name)
    /** 用 mtime+size 当 etag：够用且不引入额外状态文件 */
    const etagOf = () => {
      try { const st = fs.statSync(file); return `fs-${st.mtimeMs}-${st.size}` } catch { return null }
    }
    /** 不存在 → null；**解析失败原样抛**（与 kv provider 同一口径，也与 api/sites.js 对齐） */
    const readJsonFile = (p) => {
      if (!fs.existsSync(p)) return null
      return JSON.parse(fs.readFileSync(p, 'utf8'))
    }
    return {
      async read() {
        const data = readJsonFile(file)
        if (data == null) return { data: null, etag: null }
        return { data, etag: etagOf() }
      },
      async readAt(p) {
        const name = String(p)
        if (name === SITES_PATHNAME) return readJsonFile(file)
        if (name.startsWith(SNAPSHOT_PREFIX)) {
          const base = name.slice(SNAPSHOT_PREFIX.length)
          // 只认裸文件名，挡住 `../../` 这类越界读取
          if (!base || base.includes('/') || base.includes('\\') || base.includes('..')) return null
          return readJsonFile(snapshotFile(base))
        }
        return null
      },
      async write(data, { ifMatch, createOnly } = {}) {
        if (ifMatch != null && etagOf() !== ifMatch) {
          throw new Error('PreconditionFailed（本地目录存储不支持安全并发写）')
        }
        // 只在不存在时创建：与 kv provider 的 createOnly 同义
        if (createOnly && fs.existsSync(file)) {
          throw new Error('This blob already exists')
        }
        fs.mkdirSync(dir, { recursive: true })
        const tmp = `${file}.tmp`
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
        fs.renameSync(tmp, file)
        return { etag: etagOf() }
      },
      async listSnapshots() {
        try {
          if (!fs.existsSync(snapDir)) return []
          return fs.readdirSync(snapDir).sort().reverse().map(name => {
            let size = 0
            let uploadedAt = null
            try {
              const st = fs.statSync(snapshotFile(name))
              size = st.size
              uploadedAt = new Date(st.mtimeMs).toISOString()
            } catch { /* 单个文件 stat 失败不影响清单 */ }
            return { pathname: `${SNAPSHOT_PREFIX}${name}`, size, uploadedAt }
          })
        } catch { return [] }
      },
      async writeSnapshot(data) {
        try {
          fs.mkdirSync(snapDir, { recursive: true })
          const name = snapshotPathname(Number(data && data.version) || 0).slice(SNAPSHOT_PREFIX.length)
          const target = snapshotFile(name)
          // 与 kv provider 同一口径：快照撞名宁可报错，也不覆盖一份回滚兜底
          if (fs.existsSync(target)) return { ok: false, pathname: `${SNAPSHOT_PREFIX}${name}`, error: '快照已存在' }
          fs.writeFileSync(target, JSON.stringify(data, null, 2) + '\n', 'utf8')
          return { ok: true, pathname: `${SNAPSHOT_PREFIX}${name}` }
        } catch (e) {
          return { ok: false, error: String((e && e.message) || e) }
        }
      },
      async pruneSnapshots() {
        try {
          if (!fs.existsSync(snapDir)) return { ok: true, deleted: 0 }
          const names = fs.readdirSync(snapDir).map(n => `${SNAPSHOT_PREFIX}${n}`)
          const doomed = prunableSnapshots(names, SNAPSHOT_KEEP)
          for (const p of doomed) {
            try { fs.rmSync(snapshotFile(p.slice(SNAPSHOT_PREFIX.length)), { force: true }) } catch { /* 忽略单个失败 */ }
          }
          return { ok: true, deleted: doomed.length }
        } catch (e) {
          return { ok: false, deleted: 0, error: String((e && e.message) || e) }
        }
      },
    }
  },
})
