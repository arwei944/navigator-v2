/**
 * 自然语言 → 命令：把「切换到深色」这类口语直接解析成一条命令。
 *
 * ## 为什么不用 intent.js
 *
 * `utils/intent.js` 的 `parseIntent` 返回的是**筛选条件**（分类/用途/价格/排序），
 * 落到路由 query；这里要的是**命令**（切换主题/打开洞察/清空回收站），直接执行。
 * 两者输出结构不同，硬凑在一起会让「理解」变得说不清。
 *
 * ## 为什么命令关键词不够用
 *
 * `commands.js` 的 keywords 是**拼音与英文**（「切换主题」→ `zhuti`/`zt`/`theme`），
 * 用户打中文「深色」一个都命中不上。所以这里补一层**中文说法**——
 * 与 commands.js 头部「手写拼音是刻意的」是同一条路线：命令名短、意图明确，
 * 手写别名比猜输入习惯可靠。
 *
 * ## 三级匹配（分数越高越可信）
 *
 * 1. **完整标题**：输入包含整条 title（「设置」→ 命令「设置」）→ `len * 3`
 * 2. **手写别名**：最长被包含的别名（「深色」）→ `len * 2`
 * 3. **标题特征名**：title 形如「配色：墨绿」时，只拿**冒号后的特征部分**参与
 *    子串匹配（≥ PHRASE_MIN）→ `len`
 *
 * 第三级是**兜底**：`view.scheme.*` / `view.preset.*` / `view.sort.*` 这类动态 id
 * 的别名不可能手写全，但它们的 title 带中文特征名（「视觉方案：苹果」），
 * 子串匹配让它们自动获得中文覆盖。
 *
 * **为什么第三级只认冒号后的部分**：前缀（「配色」「排序」）是命令的**分类名**，
 * 不是特征。用户搜「配色网站」是想找配色类站点，若让「配色」参与匹配就会被猜成
 * 「切换配色」—— 误判的代价是这条搜索结果整段消失。只认特征名后：
 * 「配色网站」不再命中任何 preset，而「墨绿配色」仍能命中。
 *
 * ## 意图不明确就不猜
 *
 * 多个命令同分、且没有一个来自完整标题时返回 null —— 例如输入「排序」会同时命中
 * 多条 `view.sort.*` 的特征名，此时猜任何一条都是自作主张。宁可不出现「理解」，
 * 让用户用 ↓ 去看搜索结果或继续打字。
 *
 * 同分时的取舍：先看 `matched` 谁更长（更具体），再优先完整标题，最后按 id 稳定序。
 * 这样「收藏夹」会赢在别名（3 字）而不是标题「收藏」（2 字）——
 * 「理解为：收藏夹 → 收藏」比「理解为：收藏 → 收藏」说得清楚。
 *
 * 纯函数、零依赖：不 import store、不 import commands.js（按命令 id 对应，解耦）。
 * 别名**表**本身（`utils/phraseAliases.js`）也不 import —— 它由调用方作为参数传进来，
 * 因为那张表只为「用户打中文」这一种情况服务，首屏不需要，拆成独立模块懒加载。
 */

/** 别名命中的最短长度：单字「暗」「统」不足以认定意图 */
export const PHRASE_MIN = 2

/** 归一化：小写 + 去首尾空白。中文不受影响，但英文别名需要 */
function norm(q) {
  return String(q || '').trim().toLowerCase()
}

/**
 * title 里**可参与子串匹配**的部分：冒号后的特征名。
 *
 * 「配色：墨绿」→ 「墨绿」；「视觉方案：苹果」→ 「苹果」；没有冒号 → 整个 title。
 * 前缀是命令的分类名（配色/排序/视觉方案），用户搜它时想找的是**站点**，
 * 让前缀参与匹配就会把搜索猜成命令（「配色网站」→ 切换配色）。
 */
function featureOf(title) {
  const t = String(title || '')
  for (const sep of ['：', ':']) {
    const i = t.indexOf(sep)
    if (i !== -1) {
      const feat = t.slice(i + sep.length).trim()
      return feat || t
    }
  }
  return t
}

/**
 * 给一条命令打分，并记下用户实际说的那个词（用于「理解为：深色 → 切换主题」）。
 */
function scoreCmd(cmd, q, aliases) {
  const title = String(cmd?.title || '')
  const feat = featureOf(title)
  let best = 0
  let kind = ''
  let matched = ''

  // 1. 完整标题：最强信号
  if (title && q.includes(title)) {
    best = title.length * 3
    kind = 'title'
    matched = title
  }

  // 2. 手写别名：取最长的那个（「深色模式」比「深色」更具体）。
  //    同分时让别名覆盖标题：alias 权重 ×2 对 title ×3，能同分说明别名比标题长
  //    （「收藏夹」3 字 vs 标题「收藏」2 字）—— 更长的那一个更贴近用户原话，
  //    「理解为：收藏夹 → 收藏」比「理解为：收藏 → 收藏」说得清楚。
  for (const a of aliases?.[cmd?.id] || []) {
    if (!a) continue
    const s = a.length * 2
    if (q.includes(a) && s >= best) { best = s; kind = 'alias'; matched = a }
  }

  // 3. 标题特征名兜底：从长到短找第一个被输入包含的。同分同样让更长的赢。
  if (feat.length >= PHRASE_MIN) {
    const maxLen = Math.min(q.length, feat.length)
    for (let len = maxLen; len >= PHRASE_MIN; len--) {
      let hit = ''
      for (let i = 0; i + len <= feat.length; i++) {
        const seg = feat.slice(i, i + len)
        if (q.includes(seg)) { hit = seg; break }
      }
      if (hit) {
        if (len >= best) { best = len; kind = 'sub'; matched = hit }
        break
      }
    }
  }

  return { score: best, kind, matched }
}

/**
 * 把一句自然语言解析成一条命令。
 *
 * @param {string} q 用户输入（不含前缀）
 * @param {Array<{id:string,title:string}>} cmds buildCommands(ctx) 的产物
 * @param {Record<string,string[]>} [aliases] 命令 id → 中文说法（`utils/phraseAliases.js`）。
 *   由调用方注入而**不是**在这里 import：那张表是纯数据、2.5 KiB 中文串，
 *   压在首屏入口里就把 600 KiB 预算吃满了；调用方按需动态取（见 useOmniBox.js）。
 *   为空时只是少了第二级信号，标题与特征名两级照常工作。
 * @returns {{cmd:object, score:number, kind:string, phrase:string}|null}
 *   null = 不猜（输入太短 / 无命中 / 意图不明确）
 */
export function matchPhrase(q, cmds, aliases = {}) {
  const text = norm(q)
  if (text.length < PHRASE_MIN || !Array.isArray(cmds) || !cmds.length) return null

  const scored = cmds
    // 没有 id 的命令进不了命令表（run 无从执行），直接不参与匹配
    .filter(c => c && typeof c.id === 'string' && c.id)
    .map(c => ({ c, ...scoreCmd(c, text, aliases) }))
    .filter(x => x.score > 0)

  if (!scored.length) return null

  const top = Math.max(...scored.map(x => x.score))
  const winners = scored.filter(x => x.score === top)

  // 意图不明确：同分且没有一条来自完整标题 → 不猜
  if (winners.length > 1 && !winners.some(w => w.kind === 'title')) return null

  // 同分取舍：matched 更长（更具体）→ 完整标题优先 → id 稳定序（保证可重现）
  const rank = { title: 1, alias: 0, sub: 0 }
  const win = winners
    .slice()
    .sort((a, b) =>
      (b.matched.length - a.matched.length) ||
      (rank[b.kind] - rank[a.kind]) ||
      String(a.c.id).localeCompare(String(b.c.id))
    )[0]

  return { cmd: win.c, score: win.score, kind: win.kind, phrase: win.matched }
}

/**
 * 「理解为」的一句话说明：`切换到深色 → 切换主题`。
 * 用户在点回车之前就能看到系统理解成了什么，这是「可解释」的最低要求。
 */
export function describePhrase(hit) {
  if (!hit) return ''
  return `${hit.phrase} → ${hit.cmd?.title || ''}`
}
