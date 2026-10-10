import { defineStore } from 'pinia'
import { ref } from 'vue'
import { setVisibleInterval } from '@/utils/visibility'

/**
 * 站点在线状态 store —— **只读云端判定**，前端不做任何探测。
 *
 * 为什么不自己探：浏览器 fetch 是跨域的，读不到对方的状态码（几乎全落 `ERR` → 误判「失效」）；
 * 而且浏览器的出网路径与「本机代理环境」不是一回事 —— 判定必须由本机探活
 * （`shared/health-probe.mjs` 走 curl.exe / 系统代理）产出，发布到云端 `ops/health.json`，
 * 前端只读结论。这样前台角标、管理后台失效清单、控制台看板、CLI 四处口径完全一致。
 *
 * 状态等级（由云端下发，规则见 `shared/health-rules.mjs`）：
 *  - ok      : 2xx / 3xx 可访问
 *  - limited : 429/403/405/401 反爬/限流（可忽略，但非正常）
 *  - down    : 连接失败 / ERR / 000 / 404 / 402 / 410 等真实失效
 *  - unknown : 云端还没有这个站点的判定
 */
const CLOUD_TTL = 5 * 60 * 1000 // 云端判定 5 分钟内不重复拉取

export const useHealthStore = defineStore('health', () => {
  const statusMap = ref({})   // { [siteId]: { status, code, ms, ts } }
  const counts = ref(null)    // { total, ok, limited, down }
  const updatedAt = ref(null) // 判定产出时间（本机探活那一刻）
  const actor = ref('')       // 谁发布的
  const proxy = ref('')       // 判定所依据的本机代理环境
  const loading = ref(false)
  const loadedAt = ref(0)

  let inflight = null

  async function load({ force = false } = {}) {
    if (!force && loadedAt.value && Date.now() - loadedAt.value < CLOUD_TTL) return
    if (inflight) return inflight
    loading.value = true
    inflight = (async () => {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' })
        if (!res.ok) return
        const j = await res.json()
        const ts = j.updatedAt ? Date.parse(j.updatedAt) : 0
        const map = {}
        for (const [id, r] of Object.entries(j.results || {})) {
          map[id] = { status: r.status, code: r.code, ms: r.ms ?? null, ts }
        }
        statusMap.value = map
        counts.value = j.counts || null
        updatedAt.value = j.updatedAt || null
        actor.value = j.actor || ''
        proxy.value = j.proxy || ''
        loadedAt.value = Date.now()
      } catch {
        // 网络失败保留旧值：宁可显示上一次判定，也不要闪回「未探测」
      } finally {
        loading.value = false
        inflight = null
      }
    })()
    return inflight
  }

  /** 读某站判定；云端没有该站记录即「未探测」 */
  function getStatus(siteId) {
    return statusMap.value[siteId] || { status: 'unknown', code: null, ms: null, ts: 0 }
  }

  /**
   * 兼容旧调用点（卡片挂载 / 进入后台时调用）：不再逐站探测，只确保云端判定已加载。
   * TTL 内重复调用是零成本 no-op，因此 300 张卡片各调一次也不会打爆接口。
   */
  function probeSites() {
    return load()
  }

  /** 强制拉取最新判定（管理后台进入时用，避免看到 5 分钟内的旧值） */
  function refresh() {
    return load({ force: true })
  }

  /** 供卡片使用：含义化节点 */
  function nodeFor(status) {
    return { ok: 'green', limited: 'amber', down: 'red' }[status] || 'gray'
  }

  // 判定是云端快照，页面长开时不轮询就会一直显示开局那一份；已加载过才轮询。
  // 后台标签页不轮询（理由同 clicks.js：会白烧云端额度，额度打满会被平台暂停部署）
  if (typeof window !== 'undefined') {
    setVisibleInterval(CLOUD_TTL, () => { if (loadedAt.value) load({ force: true }) })
  }

  return { statusMap, counts, updatedAt, actor, proxy, loading, getStatus, probeSites, refresh, nodeFor }
})