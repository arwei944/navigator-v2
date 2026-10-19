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
 * `NAV_PUBLISHER=botkeep|workbuddy|vercel|rsync-static`（默认取 order 最小的 `botkeep`；
 * 另三条保留以便回退，见各自注册处的说明）。站点地址可单独用 `NAV_SITE_URL` 覆盖
 * （预览部署、自定义域名都要它）。
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
 * 优先级：显式 id → `NAV_PUBLISHER` → 按 `order` 升序的第一个 available 通道
 * （`botkeep` order 30 最小，因此它是默认；后三条按 50 / 100 / 200 依次回退）。
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

/**
 * 自有服务器（BotKeep）—— **当前默认通道**（order 最小，排在 workbuddy / vercel 之前）。
 *
 * 为什么是它：整站（静态资源 + 全部 `/api/*`）已经跑在这台自有服务器上，
 * 而 `SITE_URL` 由本注册表解析 —— 把它排在最前，`cloud.mjs` 的云端读取、
 * `scripts/publish.mjs` 的热更新与收敛验证、`verify-icons-online` 才会打到**真正活着的站点**。
 * （此前默认落在 workbuddy 通道，那些链路一直在打旧站点。）
 *
 * `available` 恒 true 是有意的：这个通道的可用性说的是「站点可达」，不是「能否部署」。
 * 读站点数据（verify / 同步面板）本来就不需要部署凭据；真去部署而没有凭据时，
 * `deploy-botkeep.mjs` 会明确报错，而不是静默换一条通道把数据发到别处。
 *
 * 能力两项都是 true：自有服务器就是完整的 Node 服务，`/api/sites` 的读与写都在。
 */
registerPublisher({
  id: 'botkeep',
  label: '自有服务器（BotKeep）',
  order: 30,
  capabilities: { hotUpdate: true, verify: true },
  available: () => true,
  deployCommand: 'node scripts/deploy-botkeep.mjs',
  siteUrl: () => String(process.env.NAV_SITE_URL || 'https://navigator-v2.bot-keep.xyz').replace(/\/+$/, ''),
})

/**
 * WorkBuddy 云端（Node 服务）—— **不再是默认**，保留以便回退。
 *
 * 为什么换默认：Vercel Hobby 团队在 2026-10-11 因 fair-use 被平台停用，全站（含静态资源
 * 与所有 `/api/*`）返回 `402 DEPLOYMENT_DISABLED`，前端因此读不到云端数据、补全抓取也全部
 * 拿到 402 正文。线上已迁到 WorkBuddy 云端（部署目录 `dist/`，同目录重发即覆盖同一链接），
 * 这里把默认通道切过去，控制台 / 发布脚本 / 校验脚本才会打到真正活着的站点。
 *
 * 上传这一步**不在本进程完成**：云端发布工具是外部工具（`.genie` 里的 appId），
 * `deployCommand` 交给 `scripts/deploy-cloud.mjs` —— 它只做**产物门禁**（完整性 +
 * 新鲜度），不假装自己上传了。新鲜度校验正是这次事故的守卫：线上跑了 19 小时的旧产物，
 * 期间修的缺陷"看起来没修"。
 */
registerPublisher({
  id: 'workbuddy',
  label: 'WorkBuddy 云端',
  order: 50,
  capabilities: { hotUpdate: true, verify: true },
  available: () => true,
  deployCommand: 'node scripts/deploy-cloud.mjs',
  siteUrl: () => String(process.env.NAV_SITE_URL || 'https://nav-dashboard-19166.app.workbuddy.host').replace(/\/+$/, ''),
})

/**
 * Vercel —— 保留但已不是默认（见上方说明）。命令与站点地址与迁移前**逐字一致**，
 * 显式 `NAV_PUBLISHER=vercel` 仍可回到这条通道。
 */
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
