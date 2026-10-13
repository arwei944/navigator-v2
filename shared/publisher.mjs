/**
 * 发布 / 部署通道 **注册表（热拔插）**。
 *
 * ## 为什么需要
 *
 * `scripts/publish.mjs` 的流水线是：备份 → 数据校验 → 构建 → **部署** → **热更新** → **验证**。
 * 六步里只有后三步是**厂商相关**的，而它们原本硬编码在脚本里
 * （`npx vercel deploy --prod --yes` 与一个常量站点地址）。
 * 换 Netlify / 静态托管就要改发布脚本 —— 那恰恰是最不该随手改、也最需要灰度的那段。
 *
 * ## 能力声明（决定后两步还跑不跑）
 *
 *   `hotUpdate` —— 是否支持「部署后单独 POST 站点数据到 `/api/sites`」。
 *      Vercel 部署带 serverless 函数，支持；纯静态托管没有接口，整站重发即可。
 *   `verify`    —— 是否可用「轮询站点接口直到收敛」作为发布成功判据（静态托管没有这个接口）。
 *
 * ## 热拔插
 *
 * `NAV_PUBLISHER=vercel|rsync-static`（默认 `vercel`，**行为与改动前逐字一致**）。
 * 站点地址可单独用 `NAV_SITE_URL` 覆盖（预览部署、自定义域名都要它）。
 */

const registry = new Map()
let seq = 0

/**
 * 注册一个发布通道。
 *
 * @param {{
 *   id: string,
 *   label?: string,
 *   order?: number,
 *   capabilities?: { hotUpdate?: boolean, verify?: boolean },
 *   available?: () => boolean,
 *   deployCommand: string | (() => string),
 *   siteUrl?: () => string,
 * }} spec
 */
export function registerPublisher(spec) {
  if (!spec || !spec.id) throw new Error('发布通道必须提供 id')
  if (typeof spec.deployCommand !== 'function' && typeof spec.deployCommand !== 'string') {
    throw new Error(`发布通道 ${spec.id} 缺少 deployCommand`)
  }
  const entry = {
    id: String(spec.id),
    label: spec.label ? String(spec.label) : String(spec.id),
    order: Number.isFinite(spec.order) ? spec.order : 100 + seq,
    capabilities: { hotUpdate: false, verify: false, ...(spec.capabilities || {}) },
    available: typeof spec.available === 'function' ? spec.available : () => true,
    /**
     * 保存**取值函数**而不是取好的值：命令与地址都依赖运行时环境变量
     * （`NAV_DEPLOY_TARGET` / `NAV_SITE_URL`），注册时求值会把它们固化成
     * 进程启动那一刻的值 —— 于是「改了配置却不生效」会变成一个很难查的坑。
     */
    deployCommandOf: typeof spec.deployCommand === 'function' ? spec.deployCommand : () => String(spec.deployCommand),
    siteUrlOf: typeof spec.siteUrl === 'function' ? spec.siteUrl : () => String(spec.siteUrl || ''),
  }
  seq += 1
  registry.set(entry.id, entry)
  return entry
}

/** 通道清单（供控制台/接口展示） */
export function listPublishers({ check = true } = {}) {
  return [...registry.values()]
    .sort((a, b) => a.order - b.order)
    .map(p => ({
      id: p.id, label: p.label, order: p.order,
      capabilities: p.capabilities,
      available: check ? Boolean(p.available()) : true,
      siteUrl: String(p.siteUrlOf() || '').replace(/\/+$/, ''),
    }))
}

/**
 * 解析出当前生效的发布通道。
 * 优先级：显式 id → `NAV_PUBLISHER` → 第一个 available 的通道（默认 vercel 永远可用）。
 */
export function resolvePublisher(explicit) {
  const all = [...registry.values()].sort((a, b) => a.order - b.order)
  const want = String(explicit || process.env.NAV_PUBLISHER || '').trim().toLowerCase()
  const chosen = want
    ? (all.find(p => p.id === want) || all.find(p => p.available()))
    : all.find(p => p.available())
  const p = chosen || all[0]
  if (!p) throw new Error('没有可用的发布通道')
  return {
    id: p.id,
    label: p.label,
    // 每次解析都重新求值 —— 配置改了立刻生效，不必重启
    deployCommand: p.deployCommandOf(),
    siteUrl: String(p.siteUrlOf() || '').replace(/\/+$/, ''),
    ...p.capabilities,
  }
}

/* ---------------- 内建通道 ---------------- */

registerPublisher({
  id: 'vercel',
  label: 'Vercel',
  order: 100,
  capabilities: { hotUpdate: true, verify: true },
  available: () => true,
  deployCommand: 'npx vercel deploy --prod --yes',
  siteUrl: () => String(process.env.NAV_SITE_URL || 'https://navigator-v2-two.vercel.app').replace(/\/+$/, ''),
})

registerPublisher({
  id: 'rsync-static',
  label: '静态托管（rsync）',
  order: 200,
  /** 纯静态托管没有 /api/sites，热更新与收敛验证都不适用 */
  capabilities: { hotUpdate: false, verify: false },
  available: () => Boolean(String(process.env.NAV_DEPLOY_TARGET || '').trim()),
  deployCommand: () => {
    const target = String(process.env.NAV_DEPLOY_TARGET || '').trim()
    const src = String(process.env.NAV_DEPLOY_SRC || 'dist/').trim()
    return `rsync -az --delete ${src} ${target}`
  },
  siteUrl: () => String(process.env.NAV_SITE_URL || '').replace(/\/+$/, ''),
})
