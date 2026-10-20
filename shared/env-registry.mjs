/**
 * 环境变量台账 —— 唯一事实来源。
 *
 * 为什么需要它：此前配置存在「三套账」——
 *   - tools/console/lib/env.mjs#envSummary 只登记 7 个
 *   - .env.example 停在 Vercel 时代（有 BLOB_* 却缺 BOTKEEP_*）
 *   - 真实代码里 process.env.* 有 228 处、67 个文件
 * 没有任何一处能回答「这个项目到底认哪些变量」。
 *
 * 台账是三者的共同上游：
 *   - tools/console/lib/env.mjs#envSummary  从它读（后端概览，不泄露值）
 *   - scripts/gen-env-example.mjs           由它生成 .env.example
 *   - tools/console/test-env.mjs            用它校验「代码里用到的变量都已登记」
 *   - scripts/env-doctor.mjs                用它体检「本机 .env.local 与台账的差距」
 *
 * 字段：
 *   name      变量名
 *   scope     分组，见 SCOPE_LABELS
 *   required  主链路是否必需（缺了 doctor 会说「未配置」）
 *   example   写进 .env.example 的示例值；**存在即表示该变量需要用户配置**
 *   desc      一句话说明
 */
export const SCOPE_LABELS = {
  admin: '管理后台 / 鉴权',
  deploy: '部署 / 发布',
  engine: '引擎链（站点 / 翻译 / LLM / 图标 / 封面 / 探针 / 分类）',
  runtime: '运行时 / 服务端',
  legacy: '旧平台遗留（保留但已非主链路）',
  external: '外部 / 系统注入（不由本项目配置）',
}

export const ENV_VARS = [
  // ── 管理后台 / 鉴权 ────────────────────────────────────────────────
  {
    name: 'SITES_ADMIN_KEY',
    scope: 'admin',
    required: true,
    example: '""',
    desc: '站点数据发布管理密钥；api/sites 的 POST 鉴权，也是 CLI / 脚本的共享凭据',
  },
  {
    name: 'SITES_ADMIN_KEY_PREVIOUS',
    scope: 'admin',
    required: false,
    example: '""',
    desc: '过渡期保留的上一把共享密钥，与 SITES_ADMIN_KEY 同时有效。用于轮换时不让旧客户端被锁在外面；确认切换完成后应删除',
  },
  {
    name: 'ADMIN_PASSWORD_HASH',
    scope: 'admin',
    example: '""',
    desc: '后台登录口令的 scrypt 哈希；配齐后可在 /admin 用口令登录，未配则回 500（密钥直连照常可用）',
  },
  {
    name: 'AUTH_SECRET',
    scope: 'admin',
    example: '""',
    desc: '会话 token 的 HMAC 签名密钥；缺省回退到 SITES_ADMIN_KEY（单独设置后轮换密钥不会让登录态失效）',
  },

  // ── 部署 / 发布 ────────────────────────────────────────────────────
  {
    name: 'BOTKEEP_API_KEY',
    scope: 'deploy',
    required: true,
    example: '""',
    desc: 'BotKeep 部署 API 凭据（release run / deploy-botkeep）',
  },
  {
    name: 'BOTKEEP_WORKLOAD_ID',
    scope: 'deploy',
    required: true,
    example: '""',
    desc: 'BotKeep workload 标识；与 .deploy-manifest.json 比对可判断是否换端点',
  },
  { name: 'BK_KEY', scope: 'deploy', desc: 'BOTKEEP_API_KEY 的短别名（部署脚本按 `BOTKEEP_API_KEY || BK_KEY` 读取）' },
  { name: 'BK_WID', scope: 'deploy', desc: 'BOTKEEP_WORKLOAD_ID 的短别名（按 `BOTKEEP_WORKLOAD_ID || BK_WID` 读取）' },
  { name: 'BK_TAG', scope: 'deploy', desc: 'BotKeep 上传标签，默认 nav-deploy' },
  {
    name: 'DEPLOY_SITE_URL',
    scope: 'deploy',
    example: '"https://your-site.example"',
    desc: '发布后的站点地址；供线上验证与状态查询使用（发布通道也可提供，优先于本项）',
  },
  { name: 'NAV_SITE_URL', scope: 'deploy', desc: '站点线上地址（图标在线校验等脚本使用）' },
  { name: 'NAV_CATEGORY_URL', scope: 'deploy', desc: '分类表的远端地址（云端分类源）' },
  { name: 'NAV_DEPLOY_ENDPOINTS', scope: 'deploy', desc: '多端点注册表（N2）；供 `release run --endpoint <ids>` 单选 / 多选发布' },
  { name: 'NAV_DEPLOY_TARGET', scope: 'deploy', desc: '部署目标类型标识' },
  { name: 'NAV_DEPLOY_SRC', scope: 'deploy', desc: '部署源目录（默认 dist）' },
  { name: 'NAV_PUBLISHER', scope: 'deploy', desc: '发布通道选择：botkeep（默认）/ workbuddy / vercel / rsync-static' },
  { name: 'NAV_BACKUP_INTERVAL_HOURS', scope: 'deploy', desc: '本机控制台的自动备份间隔（小时）；0 表示禁用（已接外部备份时用）' },
  { name: 'NAV_MIRROR_INTERVAL_SEC', scope: 'deploy', desc: '本机控制台的云端→本地镜像同步间隔（秒），默认 60；0 表示禁用（只保留手动同步）' },
  { name: 'NAV_MIRROR_DIR', scope: 'deploy', desc: '本地镜像落盘目录（默认 backups/mirror）；门禁并行执行时用它隔离，避免互相删除' },
  { name: 'NAV_VERIFY_INTERVAL_MS', scope: 'deploy', desc: '线上验证轮询间隔，默认 1500 ms' },

  // ── 引擎链 ─────────────────────────────────────────────────────────
  { name: 'NAV_SITE_ENGINE', scope: 'engine', desc: '站点抓取引擎链覆盖项' },
  { name: 'NAV_TRANSLATE_ENGINES', scope: 'engine', desc: '翻译链覆盖项' },
  { name: 'NAV_LLM_BACKENDS', scope: 'engine', desc: 'LLM 后端清单覆盖项' },
  { name: 'NAV_ICON_PROVIDERS', scope: 'engine', desc: '图标链 provider 覆盖项' },
  { name: 'NAV_ICON_DISABLE_THIRD_PARTY', scope: 'engine', desc: '禁用第三方图标源（只走站点自身声明）' },
  { name: 'NAV_COVER_FAVICON_FALLBACK', scope: 'engine', desc: '封面缺失时回退到 favicon' },
  { name: 'NAV_CATEGORY_SOURCES', scope: 'engine', desc: '分类来源清单覆盖项' },
  { name: 'NAV_CATEGORY_PATH', scope: 'engine', desc: '本地分类表路径' },
  { name: 'TRANSLATE_LLM_ENDPOINT', scope: 'engine', desc: '翻译用 LLM 端点' },
  { name: 'TRANSLATE_LLM_MODEL', scope: 'engine', desc: '翻译用 LLM 模型' },
  { name: 'LLM_GATEWAY_ENDPOINT', scope: 'engine', desc: 'LLM 网关端点' },
  { name: 'LLM_GATEWAY_MODEL', scope: 'engine', desc: 'LLM 网关模型' },
  { name: 'LLM_GATEWAY_API_KEY', scope: 'engine', desc: 'LLM 网关 API 密钥' },
  { name: 'SITEPROBE_ENDPOINT', scope: 'engine', desc: '站点探针服务端点' },
  { name: 'AI_BASE_URL', scope: 'engine', desc: 'AI 服务基础地址（后台 AI 能力）' },
  { name: 'AI_API_KEY', scope: 'engine', desc: 'AI 服务密钥' },
  { name: 'AI_MODEL', scope: 'engine', desc: 'AI 模型名' },

  // ── 运行时 / 服务端 ────────────────────────────────────────────────
  { name: 'PORT', scope: 'runtime', desc: '服务端监听端口' },
  { name: 'SERVER_PORT', scope: 'runtime', desc: '服务端端口（PORT 的回退项；本地控制台用）' },
  { name: 'HOST', scope: 'runtime', desc: '服务端监听地址，默认 0.0.0.0' },
  { name: 'NAV_STORE_DIR', scope: 'runtime', desc: '数据存储目录' },
  { name: 'NAV_SITE_STORE', scope: 'runtime', desc: '站点存储实现选择' },
  { name: 'NAV_CRON', scope: 'runtime', desc: '容器内定时任务开关' },
  { name: 'NAV_UPTIME_LOG', scope: 'runtime', desc: '可用性日志路径（uptime.jsonl）' },
  { name: 'NAV_HEALTH_PROBES', scope: 'runtime', desc: '健康探针清单' },
  { name: 'NAV_AUTO_ARCHIVE_FAILS', scope: 'runtime', desc: '连续失效达到该次数时自动归档阈值' },
  { name: 'NAV_AUDIT_ACTOR', scope: 'runtime', desc: '审计日志的操作者标识' },
  { name: 'NAV_ALERT_WEBHOOK_URL', scope: 'runtime', example: '""', desc: '告警站外出口（G3）：巡检判出连续不可达时 POST 到此地址；逗号分隔即多渠道；留空则完全不推送' },
  { name: 'NAV_ALERT_WEBHOOK_FORMAT', scope: 'runtime', desc: '告警 webhook 载荷格式：json（默认，通用）/ text（飞书、钉钉文本机器人）' },

  // ── 旧平台遗留 ─────────────────────────────────────────────────────
  { name: 'VERCEL_TOKEN', scope: 'legacy', desc: 'Vercel 部署凭据（该通道 2026-10-11 已被平台停用，保留以备用）' },
  { name: 'VERCEL_API_TOKEN', scope: 'legacy', desc: 'Vercel API 凭据（同上）' },

  // ── 外部 / 系统注入 ────────────────────────────────────────────────
  { name: 'HTTP_PROXY', scope: 'external', desc: 'HTTP 代理（publish.mjs 会探测本机实际端口并回写）' },
  { name: 'HTTPS_PROXY', scope: 'external', desc: 'HTTPS 代理（同上）' },
  { name: 'http_proxy', scope: 'external', desc: 'HTTP 代理（小写形式，工具链各自约定）' },
  { name: 'https_proxy', scope: 'external', desc: 'HTTPS 代理（小写形式）' },
  { name: 'ProgramFiles', scope: 'external', desc: 'Windows 系统变量；用于定位 Chrome 可执行文件' },
  { name: 'LOCALAPPDATA', scope: 'external', desc: 'Windows 系统变量；用于定位 Chrome 可执行文件' },
  { name: 'LIMIT', scope: 'external', desc: 'fetch-favicons 的批量处理上限（0 = 不限）' },
]

/** 按分组返回（保持台账顺序） */
export function varsByScope() {
  const out = {}
  for (const v of ENV_VARS) (out[v.scope] ||= []).push(v)
  return out
}

/** 需要用户配置的条目（有 example 即视为需要填） */
export function exampleVars() {
  return ENV_VARS.filter((v) => typeof v.example === 'string')
}

/**
 * 生成 .env.example 全文。台账是唯一上游 —— 改台账后重新生成，不再手改。
 */
export function toExampleFile() {
  const lines = [
    '# 本文件由 shared/env-registry.mjs 生成 —— 请勿手工编辑。',
    '# 重新生成：npm run env:example',
    '# 用法：复制为 .env.local 并按需填写。',
    '',
  ]
  const grouped = varsByScope()
  // runtime 也要遍历：台账契约是「有 example 即表示需要用户配置」，而告警 webhook 这类
  // 运行时开关本就要用户去配 —— 漏了它就会出现「登了台账却不在示例里」的静默缺口。
  for (const scope of ['admin', 'deploy', 'engine', 'runtime']) {
    const vars = (grouped[scope] || []).filter((v) => typeof v.example === 'string')
    if (!vars.length) continue
    lines.push(`# ── ${SCOPE_LABELS[scope]} ──`)
    for (const v of vars) {
      lines.push(`# ${v.desc}${v.required ? '（主链路必需）' : '（可选）'}`)
      lines.push(`${v.name}=${v.example}`)
      lines.push('')
    }
  }
  return lines.join('\n').replace(/\n+$/, '\n')
}
