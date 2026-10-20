/**
 * 密钥 / 凭据台账 —— 唯一事实来源。
 *
 * 为什么需要它：这个项目要对接多个外部平台，每家的凭据形态都不一样
 * （BotKeep 是 `bk_live_` 前缀的长 token，Vercel 是 24 位十六进制，LLM 是 `sk-`），
 * 而此前它们散落在 `.env.local`、`data/admin-key.txt`、`credentials.json` 三处，
 * 没有一处能回答「我到底配了哪些平台的凭据、哪些是必须的、哪些该轮换」。
 *
 * 与 `env-registry.mjs` 的分工：
 *   · env-registry 回答「代码认哪些环境变量」（用于生成 .env.example 与校验未登记变量）
 *   · 本台账回答「人需要配哪些平台的密钥」（用于密钥管理面板、体检、轮换提示）
 * 两者有交集（BOTKEEP_API_KEY 同时出现在两处），但视角不同：
 *   前者是代码契约，后者是运维清单。刻意不合并 —— 合并后任何一方新增都会污染另一方语义。
 *
 * 安全口径（贯穿全项目）：
 *   · 台账只描述「有哪些密钥、在哪读、什么形态」，**永不存放值**；
 *   · 面板只回后 4 位用于辨认「配的是哪一把」，绝不回完整值；
 *   · 审计只记「改了哪一项」，不记值。
 */

/** 平台分组，决定面板上的分区与排序 */
export const PLATFORM_LABELS = {
  deploy: '部署平台',
  ai: 'AI / LLM',
  data: '数据存储',
  auth: '本项目鉴权',
  media: '媒体 / 抓取',
}

/**
 * 字段：
 *   key        环境变量名（也是 .env.local 里的键）
 *   platform   所属平台分组，见 PLATFORM_LABELS
 *   label      人读的名字
 *   required   主链路是否必需（缺了会让某个功能整体不可用）
 *   prefix     期望前缀；用于「形态体检」——填错平台的 key 会被当场指出来
 *   minLength  最短长度；防手滑粘了半截
 *   where      取值入口（告诉用户去哪里拿）
 *   scope      影响范围（缺了会怎样），必须写清楚，否则用户不知道该不该配
 *   rotate     是否建议定期轮换
 *   aliases    同义变量名（代码里按 `主名 || 别名` 读取）
 */
export const SECRETS = [
  /* ── 部署平台 ─────────────────────────────────────────────── */
  {
    key: 'BOTKEEP_API_KEY',
    platform: 'deploy',
    label: 'BotKeep API 密钥',
    required: true,
    prefix: 'bk_live_',
    minLength: 40,
    where: 'BotKeep 控制台 → 开发者 → API 密钥',
    scope: '发布流水线（build → 打包 → 上传 → 重启 → 验证）与云端数据热更新；缺失时无法部署',
    rotate: true,
    aliases: ['BK_KEY'],
  },
  {
    key: 'BOTKEEP_WORKLOAD_ID',
    platform: 'deploy',
    label: 'BotKeep 工作负载 ID',
    required: true,
    prefix: '',
    minLength: 32,
    where: 'BotKeep 控制台 → 工作负载 → 详情页 URL 末段（UUID 形态）',
    scope: '决定部署到哪一台容器；与密钥不配套时会 404（工作负载不属于该密钥所在账号）',
    rotate: false,
    aliases: ['BK_WID'],
  },
  {
    key: 'VERCEL_TOKEN',
    platform: 'deploy',
    label: 'Vercel Token',
    required: false,
    prefix: '',
    minLength: 20,
    where: 'Vercel → Account Settings → Tokens',
    scope: '仅 Vercel 回退通道（NAV_PUBLISHER=vercel）需要；默认通道为 botkeep 时不用',
    rotate: true,
  },

  /* ── AI / LLM ─────────────────────────────────────────────── */
  {
    key: 'NAV_LLM_KEY',
    platform: 'ai',
    label: 'LLM 通用密钥',
    required: false,
    prefix: '',
    minLength: 16,
    where: '对应服务商控制台（OpenAI / DeepSeek / 智谱等）',
    scope: 'AI 描述改写、翻译、分类推断；缺失时这些功能走规则兜底或直接跳过',
    rotate: true,
  },
  {
    key: 'NAV_TRANSLATE_KEY',
    platform: 'ai',
    label: '翻译服务密钥',
    required: false,
    prefix: '',
    minLength: 8,
    where: '翻译服务商控制台（DeepL / 有道 / 百度等）',
    scope: '站点描述与标题翻译；缺失时保留原文',
    rotate: true,
  },

  /* ── 数据存储 ─────────────────────────────────────────────── */
  {
    key: 'BLOB_READ_WRITE_TOKEN',
    platform: 'data',
    label: 'Vercel Blob 读写令牌',
    required: false,
    prefix: 'vercel_blob_rw_',
    minLength: 20,
    where: 'Vercel → Storage → Blob → Tokens',
    scope: '旧平台遗留。迁到 SQLite 适配层后已非主链路，仅在回退到 Blob 存储时使用',
    rotate: true,
  },

  /* ── 本项目鉴权 ───────────────────────────────────────────── */
  {
    key: 'SITES_ADMIN_KEY',
    platform: 'auth',
    label: '站点管理密钥',
    required: true,
    prefix: '',
    minLength: 8,
    where: '本项目自定（本地生成即可）；线上需在平台环境变量里配同一把',
    scope: 'api/sites 写接口、CLI 写操作、后台登录之外的直连通道；缺失时所有写接口 401',
    rotate: true,
  },
  {
    key: 'SITES_ADMIN_KEY_PREVIOUS',
    platform: 'auth',
    label: '站点管理密钥（上一把）',
    required: false,
    prefix: '',
    minLength: 8,
    where: '轮换时把旧值填这里，过渡期双密钥同时有效',
    scope: '过渡期兼容。**确认切换完成后应删除**，否则等于多一把有效钥匙',
    rotate: false,
  },
  {
    key: 'ADMIN_PASSWORD_HASH',
    platform: 'auth',
    label: '后台登录口令哈希',
    required: false,
    prefix: '',
    minLength: 20,
    where: '用 `node scripts/hash-password.mjs <口令>` 生成，不要手填明文',
    scope: '后台 /admin 口令登录；缺失时只能靠 SITES_ADMIN_KEY 直连',
    rotate: true,
  },
  {
    key: 'AUTH_SECRET',
    platform: 'auth',
    label: '会话签名密钥',
    required: false,
    prefix: '',
    minLength: 16,
    where: '本项目自定（随机串即可）',
    scope: '登录态 token 的 HMAC 签名；缺省回退到 SITES_ADMIN_KEY（此时轮换管理密钥会让所有登录态失效）',
    rotate: true,
  },

  /* ── 媒体 / 抓取 ──────────────────────────────────────────── */
  {
    key: 'NAV_ALERT_WEBHOOK_URL',
    platform: 'media',
    label: '告警 Webhook 地址',
    required: false,
    prefix: 'http',
    minLength: 10,
    where: '企业微信 / 飞书 / Slack 的机器人 Webhook',
    scope: '站点连续失效时的站外告警出口；缺失时不推送（不影响站内判定）',
    rotate: false,
  },
]

/** 按 key 取登记项 */
export function findSecret(key) {
  return SECRETS.find(s => s.key === key || (s.aliases || []).includes(key)) || null
}

/** 按平台分组，保持 PLATFORM_LABELS 的顺序 */
export function groupedSecrets() {
  const order = Object.keys(PLATFORM_LABELS)
  const map = new Map(order.map(p => [p, []]))
  for (const s of SECRETS) {
    if (!map.has(s.platform)) map.set(s.platform, [])
    map.get(s.platform).push(s)
  }
  return order
    .filter(p => map.get(p)?.length)
    .map(p => ({ platform: p, label: PLATFORM_LABELS[p], items: map.get(p) }))
}

/**
 * 形态体检：只看「像不像这个平台的密钥」，不判真伪（真伪必须问平台）。
 *
 * 为什么值得做：把 A 平台的 key 填进 B 平台的变量，症状是「鉴权失败」，
 * 而错误信息通常只说 mismatch/unauthorized，排查会绕很远。
 * 这里能当场指出「这看着像另一家的密钥」。
 *
 * @returns {{ok: boolean, problems: string[]}}
 */
export function inspectShape(key, value) {
  const meta = findSecret(key)
  const problems = []
  if (!meta) return { ok: true, problems }
  const v = String(value ?? '').trim()
  if (!v) return { ok: true, problems }  // 空值不算形态问题（是否必需由 required 判定）

  if (meta.minLength && v.length < meta.minLength) {
    problems.push(`长度 ${v.length}，短于预期的 ${meta.minLength}（可能粘了半截，或折行被截断）`)
  }
  if (meta.prefix && !v.startsWith(meta.prefix)) {
    problems.push(`应以 \`${meta.prefix}\` 开头，实际以 \`${v.slice(0, 8)}\` 开头`)
  }
  // 常见手滑：把换行/空格带进来
  if (/\s/.test(v)) {
    problems.push('含空白字符（折行复制时常见，会原样发给平台导致鉴权失败）')
  }
  return { ok: problems.length === 0, problems }
}

/** 掩码：只保留后 4 位，用于面板辨认「配的是哪一把」 */
export function maskSecret(value) {
  const v = String(value ?? '')
  if (!v) return ''
  if (v.length <= 4) return '••••'
  return '••••••••' + v.slice(-4)
}
