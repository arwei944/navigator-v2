/**
 * 门禁信息提取：从 package.json 的 console:test:all 链与各脚本头注释里取事实。
 * 纯静态 —— 不执行任何门禁脚本（那要两分钟），保证 ledger 快速且无副作用。
 */
import { readFileSync } from 'node:fs'

/**
 * 门禁的「接入」判定口径。
 *
 * ## 为什么不再看 package.json 的长链
 *
 * 旧实现从 `console:test:all` 的 `&&` 链里正则抠脚本路径。2026-10 起这条链换成了
 * `node tools/console/run-all-gates.mjs`（分组并行执行器），链里只有一个入口 ——
 * 若继续用旧口径，台账会把 96 道门禁全判成「未接入」，而它们其实都在跑。
 *
 * 新口径只有一条：**脚本存在于 `tools/console/test-*.mjs` 或 `tools/mcp/test-*.mjs`**。
 * 这正是执行器的扫描范围（它读台账、台账读目录），两边同源。
 *
 * ## 启动参数从哪来
 *
 * 执行器需要知道每个脚本要不要 `--experimental-test-module-mocks`，而长链已不再是载体。
 * 改为**脚本自声明**：头注释里写一行
 *
 *     * @node-flags --experimental-test-module-mocks
 *
 * 这比藏在 package.json 的一条长命令里更靠近事实 —— 读脚本的人一眼能看到它依赖什么。
 */
const NODE_FLAGS_RE = /^\s*\*\s*@node-flags\s+(.+)$/m

/** 从脚本头注释解析 `@node-flags`；没有则空数组 */
export function nodeFlagsOf(file) {
  let text
  try {
    text = readFileSync(file, 'utf-8')
  } catch {
    return []
  }
  const m = NODE_FLAGS_RE.exec(text)
  return m ? m[1].trim().split(/\s+/).filter(Boolean) : []
}

/**
 * CI 跳过声明。
 *
 * 有些门禁依赖**本机专属资源**，在 GitHub Actions 的干净容器里跑不了（或跑起来
 * 验证的不是同一件事）。这类门禁必须**显式声明 + 说明原因**，而不是让 CI 静默
 * 不跑 —— 静默跳过与「忘了接」在结果上完全一样，都是假绿。
 *
 * 头注释写法：
 *
 *     * @ci-skip 需要本机 Chrome：用 CDP 驱动真实键盘，CI 无浏览器
 *
 * 解析出空串视为「写了标签但没写原因」，由校验器判为不合规（见 cli.mjs）。
 */
/*
 * 注意 `[ \t]*` 而非 `\s*`：`\s` 包含换行，会让 `@ci-skip` 独占一行时
 * 把**下一行注释**吞成「原因」（实测写成 `* @ci-skip` 后，下一行的 ` *`
 * 被解析成原因 `*`，空原因校验因此失效）。这里只允许行内空白。
 */
const CI_SKIP_RE = /^[ \t]*\*[ \t]*@ci-skip[ \t]*(.*)$/m

/**
 * CI 附加参数声明。
 *
 * 有些门禁在缺少前置产物时会**降级为跳过**而不是失败（例如 dist/ 没构建时，
 * 产物体积断言直接 `process.exit(0)`）。本地这样做是合理的——不想强迫每次跑门禁
 * 都先构建；但 CI 里会变成假绿：构建没产物 → 门禁跳過 → 报「全部通过」。
 *
 * 这类门禁自带 `--strict`（缺产物即失败），在这里声明后，执行器只会在 CI 模式下
 * 追加该参数：
 *
 *     * @ci-flags --strict
 */
const CI_FLAGS_RE = /^[ \t]*\*[ \t]*@ci-flags[ \t]*(.*)$/m

/** 从脚本头注释解析 `@ci-flags`；没有则空数组 */
export function ciFlagsOf(file) {
  let text
  try {
    text = readFileSync(file, 'utf-8')
  } catch {
    return []
  }
  const m = CI_FLAGS_RE.exec(text)
  return m ? m[1].trim().split(/\s+/).filter(Boolean) : []
}

/** 从脚本头注释解析 `@ci-skip <原因>`；没有声明返回 null */
export function ciSkipOf(file) {
  let text
  try {
    text = readFileSync(file, 'utf-8')
  } catch {
    return null
  }
  const m = CI_SKIP_RE.exec(text)
  return m ? m[1].trim() : null
}

/**
 * 取脚本的一句话用途：头注释里第一个非空行；若形如 `名字 —— 说明`，取破折号后的说明。
 * 没有头注释时返回 null（由调用方标注）。
 */
export function purposeOf(file) {
  let text
  try {
    text = readFileSync(file, 'utf-8')
  } catch {
    return null
  }
  const m = text.match(/\/\*\*([\s\S]*?)\*\//)
  if (!m) return null
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.replace(/^\s*\*\s?/, '').trim()
    if (!line || line.startsWith('@')) continue
    const idx = line.indexOf('——')
    return idx >= 0 ? line.slice(idx + 2).trim() : line
  }
  return null
}

/** 脚本行数（作为「体量」的粗指标，不猜断言数——那会不准） */
export function linesOf(file) {
  try {
    return readFileSync(file, 'utf-8').split(/\r?\n/).length
  } catch {
    return 0
  }
}

/**
 * 门禁分类规则（名称 + 用途关键词 → 域）。首个命中即归类，末位兜底「未分类」。
 *
 * 为什么按「域」分：台账原本只能逐条看，答不了「哪个域的守卫最薄」。
 * 分类让「某域只有 1 道门禁」这类结构性缺口一眼可见。
 */
const CATEGORY_RULES = [
  ['搜索与交互', /search|intent|command|omni|preview|input-focus/i],
  [
    '前端与体验',
    /frontend|a11y|mobile|contrast|bundle|ui|bgm|theme|chart|graph-layout|gridnav|panel|side-width|filter-chips|notes|undo|sw-refresh|visual|touch|gesture|format|safeStorage|share|inline-stability|split-wiring/i,
  ],
  ['部署与发布', /deploy|publish|release|botkeep|endpoint|manifest|schedule/i],
  ['安全与鉴权', /auth|security|netguard|session|secret|rate|token|dryrun/i],
  ['文档治理', /doc|readme/i],
  ['工作区治理', /hygiene|workspace|script|gate|env|deps|registry|hunks|robust|file-size/i],
  [
    '数据与内容',
    // backup：备份守的是数据资产本身（站点/点击/健康全在同一个库里），归这里而不是「部署与发布」
    // mirror：镜像是云端数据的本地副本，守的是「数据完整性 + 不丢变化」，同属数据资产
    /data|site|quality|desc|category|alias|seed|audit|translate|glossary|meta|auto-add|affinity|trust|url|visit|click|domain|flow|infer|backup|mirror|ingest/i,
  ],
  [
    '服务端与运行时',
    /server|route|api|store|cron|health|mcp|v10|stack|offline|sync|engine|ops|uptime|poll|http|image|llm|probe|alert|admin|net/i,
  ],
]

export function categoryOf(name, purpose = '') {
  const text = `${name} ${purpose}`
  for (const [label, re] of CATEGORY_RULES) if (re.test(text)) return label
  return '未分类'
}
