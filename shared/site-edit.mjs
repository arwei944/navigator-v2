/**
 * 站点编辑的**字段归一内核** —— 唯一实现。
 *
 * ## 为什么要有这个文件
 *
 * 「编辑站点」现在有两个入口：卡片右键菜单打开的 `EditSiteModal`，以及右边栏详情面板里的
 * **内联编辑**。两者改的是同一批字段、走同一条 `sitesStore.updateSite` 落库路径。
 *
 * 如果各写一份归一规则，迟早会漂移 —— 而这里的每一条规则都是**踩过坑才写下的**：
 *
 *   - **域名要脱协议、脱路径、脱 `www.`**：落库口径全站统一为裸域名（`scripts/normalize-www.mjs`
 *     也是同一口径）。漏了这一步，`https://www.example.com/a/b` 会被原样存进去，
 *     卡片显示、去重、同域缓存全部对不上。
 *   - **别名要去重、并剔除与站名/域名同形的项**：别名参与搜索命中，把站名本身塞进别名
 *     等于给每次搜索加噪声（搜什么都命中自己）。
 *   - **`purposes` 清空时必须传 `undefined` 而不是空数组**：空数组会让卡片渲染出
 *     「有用途但一个标签都没有」的空行 —— 这是显示层的既有约定（见 `EditSiteModal` 原注释）。
 *   - **`initial` 由站名派生**：无 favicon 时卡片与详情面板都拿它当兜底字。
 *
 * 所以这些规则必须只有一处。本文件保持 **纯函数 + 零依赖**（不 import node:*，不碰
 * fs / 网络），可被浏览器侧（src/）与 Node 侧（tools/ 测试）同时引用，与
 * `shared/purposes.mjs` 同一约定。
 */

import { normalizePurposes } from './purposes.mjs'

/**
 * 从任意 URL 输入提取**落库用的裸域名**。
 *
 * 容错到"用户还没打完"的程度：`example.com`、`https://www.example.com/path?q=1`
 * 都得到 `example.com`。这里刻意不校验是否合法 URL —— 校验是表单的事，
 * 本函数只负责把能提取的部分提取干净，保证落库口径一致。
 */
export function toDomain(raw) {
  return String(raw || '')
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .toLowerCase()
    .replace(/^www\./, '')
}

/**
 * 别名归一：接受逗号 / 顿号 / 换行分隔；去重（大小写不敏感），
 * 并剔除与**站名**或**域名**同形的项。
 *
 * 大小写不敏感地去重是必要的：`Binance` 与 `binance` 是同一个别名，
 * 都留下会让搜索命中两次、也让别名区看起来像出了 bug。
 */
export function parseAliases(raw, name, host) {
  const nameLower = String(name || '').trim().toLowerCase()
  const out = []
  const seen = new Set()
  for (const part of String(raw || '').split(/[,，、\n]/)) {
    const a = part.trim()
    if (!a) continue
    const lower = a.toLowerCase()
    if (seen.has(lower) || lower === nameLower || lower === host) continue
    seen.add(lower)
    out.push(a)
  }
  return out
}

/**
 * 站点记录 → 表单初值。两个编辑入口共用，保证"打开时看到的东西"一致。
 *
 * 别名在这里**拼成顿号分隔的字符串**（表单控件是文本框，不是数组控件）；
 * 存回去时由 `parseAliases` 再切开 —— 往返不对称是刻意的，因为人在文本框里
 * 天然用「、」「,」分隔，让它直接跑数组只会多一层无谓的序列化。
 */
export function siteToForm(site) {
  if (!site) {
    return { name: '', url: '', desc: '', categoryId: 'ai', color: '#3b82f6', aliases: '', purposes: [], pinned: false, archived: false }
  }
  // 这里**刻意不补默认值**（不写 `site.color || '#…'`）：本函数是从 `EditSiteModal.onMounted`
  // 原样搬过来的，补默认值会悄悄改变那个弹窗的既有行为（原本 site.color 缺失就存 undefined）。
  // 需要兜底的是调用方，不是归一函数 —— 归一函数只做「转换」，不做「修正」。
  return {
    name: site.name,
    url: site.url,
    desc: site.desc,
    categoryId: site.categoryId,
    color: site.color,
    aliases: Array.isArray(site.aliases) ? site.aliases.join('、') : '',
    purposes: normalizePurposes(site.purposes),
    pinned: site.pinned === true,
    archived: site.archived === true,
  }
}

/**
 * 表单值 → `sitesStore.updateSite` 的 patch。
 *
 * 两个编辑入口唯一的落库出口：调用方只管把表单值传进来，
 * 「域名怎么取、别名怎么切、空用途怎么传」全部在这里定死。
 */
export function buildSitePatch(form = {}) {
  const name = form.name
  const domain = toDomain(form.url)
  const purposes = normalizePurposes(form.purposes)
  return {
    name,
    url: domain,
    // desc 原样回传（不做 `|| ''` 兜底）：与 `EditSiteModal` 原实现逐字一致。
    // 归一函数不替调用方改值，否则「等价重构」就变成了「顺手修正」。
    desc: form.desc,
    categoryId: form.categoryId,
    color: form.color,
    // 原实现直接 `name.charAt(0)`：name 为 undefined 时会抛类型错。包一层 String 只为不让它崩，
    // 正常数据（name 恒为字符串）下结果完全一致。
    initial: String(name || '').charAt(0).toUpperCase(),
    aliases: parseAliases(form.aliases, name, domain),
    // 清空时传 undefined 而不是空数组：空数组会让卡片渲染出「有用途但一个标签都没有」的空行
    purposes: purposes.length ? purposes : undefined,
    // false 显式写回，便于用户在这里取消置顶 / 取消归档
    pinned: form.pinned === true,
    archived: form.archived === true,
  }
}
