# 搜索栏一键添加 + 自动分类（无弹窗）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 站内搜索栏粘网址后直接静默入库并自动分类（无合适分类则按页面简介新建分类），用底部 Toast（带撤销）+ 自动切分类 + 滚动高亮反馈，全程不出现任何弹窗。

**Architecture:** 把 `autoAddSite` 的出口从「回弹窗」改成「回决策」：纯函数 `shared/auto-category.mjs` 产出 `use` / `create` 分类计划，`autoAdd.js` 编排落库并返回 `category`，`App.vue` 分派到新的 Toast store + 路由定位，`sites` store 提供 `highlightSiteId` 供卡片描边与列表滚动。抓取失败 / 站名低置信不再阻断，改为域名兜底命名照常入库。

**Tech Stack:** Vue 3 `<script setup>` + Pinia（`defineStore` setup 风格）+ Vue Router 4；纯函数模块放 `shared/*.mjs` 供 node 直测；`pinyin-pro` 派生分类 id；纯 node 冒烟测试在 `tools/console/`。

**Spec:** `docs/superpowers/specs/2026-10-08-search-one-click-add-auto-category-design.md`（已批准）

---

## 关键事实（实现前必须知道，别再重新侦查）

1. **元数据接口的真实字段**（`api/metadata.js` → `shared/site-infer.mjs` 返回）：
   - 分类 id 是 `meta.categoryId`；**没有信号时它是空串**（`inferSite` 未传 `fallbackCategory`）。
   - 置信度在 `meta.confidence.category`（值 `high|medium|low`），**不是** `meta.confidence.categoryId`。
   - 站名置信度在 `meta.confidence.name`。
   - 抓取失败时 `/api/metadata` **仍返回 200**，只有 `meta` 在前端 `fetch` 异常/非 2xx 时才是 `null`。
2. **分类表是本地草稿**：`categoriesStore.addCategory()` 成功后 `dirty` 变真，需管理员在后台「发布」才同步其他设备。本计划**不做自动发布**（已批准的取舍）。
3. **id 派生的既有范式**在 `src/components/admin/AdminCategoryManager.vue#onDraftLabel`：`pinyin-pro` 首字母 → 小写 → 去非 `[a-z0-9]` → 冲突 `base + n++`。`shared/auto-category.mjs` 复用同一段逻辑，避免两处漂移。
4. **拼音首字母实测**（写测试断言时别猜）：
   `AI 音乐→aiyy`、`AI 语音→aiyy`（两个主题**同名撞车**，靠运行时 `existing` 快照自增化解）、`AI 视频→aisp`、`AI 搜索→aiss`、`AI 智能体→aiznt`、`其他→qt`、`看视频→ksp`、`写作与内容→xzynr`、`AI→ai`。
5. **分类文案**（`shared/categories.mjs`）：内置同名可复用的三个主题是 `写作与内容`(id `writing`)、`编程与开发`(id `coding`)、`设计与创意`(id `design`)；`云服务器/VPS`(id `cloud`)、`代理/VPN`(id `proxy`) 同理。
6. **项目没有 Toast 组件**，`src/App.vue` 是自动添加的唯一宿主；`AddSitePreviewCard.vue` 只被 `App.vue` 引用。
7. `src/components/CardsContainer.vue` 根节点是 `.cards-container`（`overflow-y: auto` 的滚动容器），`SiteCard` 根节点是 `.card`。
8. 提交信息用中文 `type: 描述`（对照 `git log`：`feat: 管理后台新增偏好设置 Tab 与网址自动添加开关`）。

## 与 spec 的两处细化（已按实现需要收敛，非行为变更）

- **`suggestCategory` 不再接收 `path`**：主题匹配只看 `name / desc / domain`（用户指定的判断依据是「页面简介」），`path` 无信号且元数据接口根本不返回它，留着就是死参数。
- **`draftFromMeta` 被 `fallbackDraftFromMeta` 完全取代并删除**：后者的入参增加 `url` 与已解析的 `categoryId`，meta 缺失时同样能出草稿，前者已无调用方。

## 文件结构

| 文件 | 职责 |
| --- | --- |
| Create `shared/auto-category.mjs` | 纯决策：label 归一、主题表、6 条优先级分支、id 派生、配色 |
| Create `tools/console/test-auto-category.mjs` | 上述纯函数的 node 冒烟测试 |
| Create `src/stores/toast.js` | Toast 队列（push/dismiss/pause/resume，含倒计时） |
| Create `src/components/ToastHost.vue` | 底部居中渲染队列（Teleport + TransitionGroup） |
| Modify `src/utils/siteDraft.js` | 退役抓取护栏；新增 `fallbackDraftFromMeta` |
| Modify `src/services/autoAdd.js` | 接入分类决策，返回 `category` / `existing` |
| Modify `src/stores/sites.js` | `highlightSiteId` + `highlightSite` / `clearHighlight` |
| Modify `src/components/SiteCard.vue` | `data-site-id` + `card-highlight` 描边 |
| Modify `src/components/CardsContainer.vue` | 按高亮 id `scrollIntoView` |
| Modify `src/App.vue` | Toast 分派 + `locateSite`；删预览卡片 |
| Modify `tools/console/test-auto-add.mjs` | 跟随新契约改写 |
| Modify `package.json` | 注册新测试脚本 |
| Delete `src/components/AddSitePreviewCard.vue` | 职责被列表卡片 + Toast + 高亮取代 |

---

### Task 0: 提交已批准的设计规格

**Files:**
- Add: `docs/superpowers/specs/2026-10-08-search-one-click-add-auto-category-design.md`

- [ ] **Step 0.1: 确认规格文件是唯一待提交内容**

Run: `git status --short`
Expected: 只有 `?? docs/superpowers/specs/2026-10-08-search-one-click-add-auto-category-design.md`

- [ ] **Step 0.2: 提交**

```bash
git add docs/superpowers/specs/2026-10-08-search-one-click-add-auto-category-design.md
git commit -m "docs: 搜索栏一键添加与自动分类设计规格"
```

---

### Task 1: 自动分类决策内核 `shared/auto-category.mjs`

**Files:**
- Create: `shared/auto-category.mjs`
- Test: `tools/console/test-auto-category.mjs`
- Modify: `package.json`（注册脚本；`console:test:all` 链在 Task 8 再接）

- [ ] **Step 1.1: 写失败测试**

Create `tools/console/test-auto-category.mjs`:

```js
/**
 * 自动分类决策：6 条优先级分支 + label 归一 + id 派生与冲突自增。
 * 纯 node 直跑：node tools/console/test-auto-category.mjs
 *
 * existing 用内置分类表真实构造，保证测的是「新分类会不会被误建」这个真问题。
 */
import { categoryList, domainList, domainOfScope } from '../../shared/categories.mjs'
import { purposeLabel } from '../../shared/purposes.mjs'
import { suggestCategory, normalizeLabel, categoryIdFor, DOT_PALETTE } from '../../shared/auto-category.mjs'

let pass = 0
const failures = []
function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}

const existing = categoryList().map(c => ({ id: c.id, label: c.label, groupId: domainOfScope(c.id) }))
const domainIds = domainList().map(d => d.id)

/* ① 元数据分类可信且在本地表 → 直接复用 */
const t1 = suggestCategory({ categoryId: 'design', categoryConfidence: 'high', existing, domainIds })
eq(t1.kind, 'use', '① 可信分类走复用')
eq(t1.categoryId, 'design', '① 复用 design')

/* ① 低置信不采信 → 转主题判断 */
const t1b = suggestCategory({ categoryId: 'design', categoryConfidence: 'low', desc: 'AI 音乐生成平台', existing, domainIds })
eq(t1b.kind, 'create', '① 低置信不采信')
eq(t1b.label, 'AI 音乐', '① 转主题后落到 AI 音乐')

/* ① 本地表里没有的分类 id（云端自定义表下发）→ 转主题判断 */
const t1c = suggestCategory({ categoryId: 'not-in-local', categoryConfidence: 'high', desc: 'AI 音乐生成', existing, domainIds })
eq(t1c.kind, 'create', '① 未知分类 id 转主题')

/* ② 主题命中 + 本地已有同名 → 复用内置，不重复建 */
const t2 = suggestCategory({ desc: '在线写作助手，支持文案润色', existing, domainIds })
eq(t2.kind, 'use', '② 同名主题复用')
eq(t2.categoryId, 'writing', '② 复用内置「写作与内容」')

/* ② 主题命中 + 本地没有 → 新建（核心新能力） */
const t3 = suggestCategory({ desc: 'AI 音乐生成，输入歌词自动作曲，支持 suno 风格', existing, domainIds })
eq(t3.kind, 'create', '② 新建主题分类')
eq(t3.label, 'AI 音乐', '② 主题标签')
eq(t3.groupId, 'ai', '② 主题智能归入 ai 域')
eq(t3.id, 'aiyy', '② 拼音首字母派生 id')
ok(DOT_PALETTE.includes(t3.dotColor), '② 配色取自调色板')

/* ② id 冲突自增（AI 音乐 / AI 语音 拼音同为 aiyy，这是真实撞车场景） */
const t3b = suggestCategory({
  desc: 'AI 音乐生成',
  existing: [...existing, { id: 'aiyy', label: 'AI 语音', groupId: 'ai' }],
  domainIds,
})
eq(t3b.id, 'aiyy2', '② id 冲突自增到 aiyy2')

/* ③ 用途兜底 → 新建 */
const t4 = suggestCategory({ name: 'StreamX', desc: '在线观看高清影视内容', purposes: ['video'], existing, domainIds })
eq(t4.kind, 'create', '③ 用途兜底新建')
eq(t4.label, purposeLabel('video'), '③ 标签取用途文案')
eq(t4.groupId, 'tools', '③ 用途智能归入 tools 域')

/* ③ 用途同名 → 复用 */
const t4b = suggestCategory({
  name: 'StreamX', desc: '在线观看', purposes: ['video'],
  existing: [...existing, { id: 'ksp', label: '看视频', groupId: 'tools' }],
  domainIds,
})
eq(t4b.kind, 'use', '③ 用途同名复用')
eq(t4b.categoryId, 'ksp', '③ 复用已有「看视频」')

/* ④ 无任何信号 → 「其他」，且只建一次 */
const t5 = suggestCategory({ name: 'mystery', desc: '', existing, domainIds })
eq(t5.kind, 'create', '④ 无信号落到其他')
eq(t5.label, '其他', '④ 标签为其他')
eq(t5.groupId, 'tools', '④ 其他归入 tools 域')
const t6 = suggestCategory({
  name: 'mystery2', desc: '',
  existing: [...existing, { id: t5.id, label: t5.label, groupId: t5.groupId }],
  domainIds,
})
eq(t6.kind, 'use', '④ 其他只建一次')
eq(t6.categoryId, t5.id, '④ 复用已建的其他')

/* label 归一：归一后相等才算「已有同名」，否则会重复建同类 */
eq(normalizeLabel('AI 绘画'), normalizeLabel('ai绘画'), '归一忽略大小写与空格')
eq(normalizeLabel('AI 绘画'), normalizeLabel('AI绘画'), '「AI 绘画」与「AI绘画」判定为同一分类')
eq(normalizeLabel('DeFi 借贷/收益'), normalizeLabel('defi 借贷 收益'), '归一忽略符号与空格')

/* id 派生与冲突自增 */
eq(categoryIdFor('AI 音乐', new Set()), 'aiyy', 'categoryIdFor 拼音首字母')
eq(categoryIdFor('AI 音乐', new Set(['aiyy'])), 'aiyy2', 'categoryIdFor 冲突自增')
eq(categoryIdFor('AI 音乐', new Set(['aiyy', 'aiyy2'])), 'aiyy3', 'categoryIdFor 连续冲突继续自增')
eq(categoryIdFor('其他', new Set(['qt'])), 'qt2', 'categoryIdFor 中文标签派生')
const noDomain = categoryIdFor('AI', new Set(domainIds))
ok(noDomain !== 'ai' && /^ai\d+$/.test(noDomain), 'categoryIdFor 避开域 id，不与 ai 域重名', `实得 ${noDomain}`)

/* 空表也要能跑（首次使用、云端表未下发） */
const bare = suggestCategory({ desc: 'AI 音乐生成', existing: [], domainIds })
eq(bare.kind, 'create', '空分类表同样能新建')
eq(bare.dotColor, DOT_PALETTE[0], '空表时取调色板第一个颜色')

if (failures.length) {
  console.error(`\n❌ 自动分类决策测试失败 ${failures.length} 项：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 自动分类决策全部通过：${pass} 条断言`)
```

- [ ] **Step 1.2: 跑测试确认失败**

Run: `node tools/console/test-auto-category.mjs`
Expected: FAIL — `Cannot find module ... shared/auto-category.mjs`

- [ ] **Step 1.3: 实现模块**

Create `shared/auto-category.mjs`:

```js
/**
 * 自动分类决策：搜索栏一键添加时判断「这个站点该放进哪个分类」。
 *
 * 纯函数 + 零副作用（只 import 同目录的 .mjs 词表与 pinyin-pro），
 * 与 shared/purposes.mjs 同规矩 —— 一旦引入 node:* 或碰 I/O，
 * 前端 Vite 打包会直接失败。
 *
 * 判断依据的优先级是用户指定的口径：**先看页面简介**（主题表），
 * 再退到用途，最后才落「其他」。元数据自带的分类只有在可信且存在于本地表时才算数 ——
 * 否则低置信的关键词命中会盖过简介，新分类就永远建不出来。
 */
import { purposeLabel } from './purposes.mjs'
import { pinyin } from 'pinyin-pro'

/* ---------------- 标签归一 ---------------- */

/**
 * label 归一：只留小写字母 / 数字 / 汉字，其余（空格、斜杠、加号、标点）全部丢掉。
 * 「AI 绘画」「ai绘画」「AI绘画」归一后必须相等，否则同义分类会被重复新建。
 */
export function normalizeLabel(s) {
  return String(s ?? '').toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, '')
}

/* ---------------- 主题表 ---------------- */

/**
 * 内置表覆盖不到的主题。label 分两种：
 *   - 与内置分类**同文案**（设计与创意 / 编程与开发 / 写作与内容 / 云服务器/VPS / 代理/VPN）
 *     → 归一后必然相等，走「复用」，不会重复建；
 *   - 内置表没有的（AI 音乐 / AI 视频 …）→ 走「新建」，这是本功能的核心能力。
 * 顺序即优先级：更具体的主题写在前面，泛词写在后面。
 */
export const THEMES = [
  { label: '设计与创意', domain: 'ai', keywords: /绘画|画图|作图|文生图|插画|midjourney|stable[\s-]?diffusion|text-to-image|\bflux\b/i },
  { label: '编程与开发', domain: 'ai', keywords: /代码补全|编程助手|开发工具|代码生成|copilot|cursor|replit|\bide\b/i },
  { label: '写作与内容', domain: 'ai', keywords: /写作|文案|润色|copywriting|writing/i },
  { label: 'AI 视频', domain: 'ai', keywords: /文生视频|视频生成|视频创作|text-to-video|\bsora\b|\brunway\b|可灵|\bkling\b/i },
  { label: 'AI 音乐', domain: 'ai', keywords: /音乐生成|作曲|歌曲生成|text-to-music|\bsuno\b|\budio\b/i },
  { label: 'AI 语音', domain: 'ai', keywords: /语音合成|语音克隆|配音|text-to-speech|\btts\b|elevenlabs/i },
  { label: 'AI 搜索', domain: 'ai', keywords: /ai搜索|智能搜索|答案引擎|联网问答|perplexity|搜索摘要/i },
  { label: 'AI 智能体', domain: 'ai', keywords: /智能体|多智能体|\bn8n\b|\bdify\b|\bagent\b/i },
  { label: '云服务器/VPS', domain: 'basics', keywords: /云服务器|云主机|\bvps\b|虚拟主机|dedicated\s+server/i },
  { label: '代理/VPN', domain: 'basics', keywords: /\bvpn\b|代理|机场|科学上网|节点订阅|clash|v2ray|shadowrocket/i },
]

/** 用途没有「域」的天然归属，这里给一张固定映射，保证新建时域一定合法 */
const PURPOSE_DOMAIN = {
  'ai-chat': 'ai', coding: 'ai', design: 'ai', learning: 'ai',
  trading: 'crypto', data: 'crypto',
  reference: 'tools', tool: 'tools', news: 'tools', video: 'tools',
  community: 'tools', productivity: 'tools',
}

/** 新建分类的配色：按「域内已有分类数 % 调色板长度」取，避免与相邻分类撞色 */
export const DOT_PALETTE = [
  '#3b82f6', '#a855f7', '#ec4899', '#06b6d4', '#22c55e',
  '#f97316', '#ef4444', '#8b5cf6', '#f59e0b', '#0d9488',
]

/* ---------------- id 派生 ---------------- */

/**
 * 分类 id 派生：label 拼音首字母 → 只留 a-z0-9 → 冲突则 base + n++。
 * 口径与 AdminCategoryManager#onDraftLabel 完全一致，两处必须同时改。
 * `taken` 要同时装下「已有分类 id」与「域 id」——域与分类同轴，重名会让筛选歧义。
 */
export function categoryIdFor(label, taken) {
  const base = pinyin(String(label || ''), { pattern: 'first', toneType: 'none', separator: '' })
    .toLowerCase().replace(/[^a-z0-9]/g, '') || 'cat'
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(base + n)) n++
  return base + n
}

/* ---------------- 决策表 ---------------- */

/**
 * 6 条优先级分支，命中即止。
 *
 * @param {{categoryId?: string, categoryConfidence?: string, name?: string, desc?: string,
 *          domain?: string, purposes?: string[], existing?: object[], domainIds?: string[]}} input
 *   `existing` 是本地分类表快照 [{ id, label, groupId }]，`domainIds` 是域 id 列表 ——
 *   两者由调用方（Pinia store）提供，保证本函数可脱离框架单测。
 * @returns {{kind: 'use', categoryId: string, label: string}
 *         | {kind: 'create', id: string, label: string, groupId: string, dotColor: string}}
 */
export function suggestCategory({
  categoryId = '', categoryConfidence = '', name = '', desc = '', domain = '',
  purposes = [], existing = [], domainIds = [],
} = {}) {
  const list = Array.isArray(existing) ? existing : []
  const byNorm = (label) => list.find(c => normalizeLabel(c.label) === normalizeLabel(label)) || null
  const taken = new Set([...list.map(c => c.id), ...domainIds])
  const countIn = (groupId) => list.filter(c => c.groupId === groupId).length

  const create = (label, groupId) => ({
    kind: 'create',
    id: categoryIdFor(label, taken),
    label,
    groupId,
    dotColor: DOT_PALETTE[countIn(groupId) % DOT_PALETTE.length],
  })
  const use = (c) => ({ kind: 'use', categoryId: c.id, label: c.label })

  // ① 元数据给出的分类：可信且本地表里有 → 直接用
  if (categoryId && categoryConfidence !== 'low') {
    const hit = list.find(c => c.id === categoryId)
    if (hit) return use(hit)
  }

  // ② 主题表（页面简介 + 域名）：同名复用，没有就新建 —— 这条是「没有合适分类就自动建」的落点
  const hay = `${name} ${desc} ${domain}`.toLowerCase()
  const theme = THEMES.find(t => t.keywords.test(hay))
  if (theme) {
    const same = byNorm(theme.label)
    if (same) return use(same)
    return create(theme.label, theme.domain)
  }

  // ③ 用途兜底：用途是「拿来干嘛」，拿它的文案当分类名
  const firstPurpose = Array.isArray(purposes) ? purposes[0] : ''
  const purposeName = firstPurpose ? purposeLabel(firstPurpose) : ''
  if (purposeName) {
    const same = byNorm(purposeName)
    if (same) return use(same)
    return create(purposeName, PURPOSE_DOMAIN[firstPurpose] || 'tools')
  }

  // ④ 无任何信号：统一落「其他」，且全站只建这一次
  const other = byNorm('其他')
  if (other) return use(other)
  return create('其他', 'tools')
}
```

- [ ] **Step 1.4: 跑测试确认通过**

Run: `node tools/console/test-auto-category.mjs`
Expected: `✅ 自动分类决策全部通过：N 条断言`（exit code 0；有 `❌` 说明实现与断言不符，逐条修）

- [ ] **Step 1.5: 在 package.json 注册脚本**

Modify `package.json` — 在 `"console:test:auto-add"` 后面加一行：

```json
    "console:test:auto-add": "node tools/console/test-auto-add.mjs",
    "console:test:auto-category": "node tools/console/test-auto-category.mjs",
```

- [ ] **Step 1.6: 确认脚本能跑**

Run: `npm run console:test:auto-category`
Expected: `✅ 自动分类决策全部通过`

- [ ] **Step 1.7: 提交**

```bash
git add shared/auto-category.mjs tools/console/test-auto-category.mjs package.json
git commit -m "feat: 新增自动分类决策内核（主题表 + 6 条优先级分支 + 拼音 id 派生）"
```

---

### Task 2: 草稿工具改为域名兜底（退役抓取护栏）

**Files:**
- Modify: `src/utils/siteDraft.js`
- Test: `tools/console/test-auto-add.mjs`

- [ ] **Step 2.1: 先改测试，确认失败**

Rewrite `tools/console/test-auto-add.mjs` —— 保留「域名口径 / 别名 / 同域去重 / 草稿组装」四段原样，替换掉末尾两段：

把 import 行改成：

```js
import {
  AUTO_ADD_REASON, rawHostOf, domainOf, parseAliases, findDuplicate,
  buildSiteFromDraft, preflightOf, fallbackDraftFromMeta, colorFromHost,
} from '../../src/utils/siteDraft.js'
```

删掉原来的 `/* ---- 发请求前的把关 ---- */` 与 `/* ---- 抓取结果的把关 ---- */` 两段（共 6 条断言），以及 `draftFromMeta` 那段，替换成：

```js
/* ---- 发请求前的把关：只判网址，不再管抓取结果 ---- */
eq(preflightOf({ url: '不是网址' })?.reason, AUTO_ADD_REASON.INVALID_URL, 'preflightOf 拦下不像网址的输入')
eq(preflightOf({ url: 'https://github.com' }), null, 'preflightOf 正常网址放行')
ok(!('FETCH_FAILED' in AUTO_ADD_REASON), '抓取失败已不再拦下，原因码退役')
ok(!('LOW_CONFIDENCE' in AUTO_ADD_REASON), '站名低置信已不再拦下，原因码退役')
eq(AUTO_ADD_REASON.WRITE_FAILED, 'write-failed', '保留写库失败原因码')

/* ---- 元数据 → 草稿（正常路径） ---- */
const okMeta = fallbackDraftFromMeta({
  url: 'https://www.github.com/x',
  meta: {
    name: 'GitHub', desc: 'd', categoryId: 'coding', color: '#222222',
    purposes: ['coding', 'not-a-real-purpose'], faviconUrl: 'https://github.com/f.ico', domain: 'github.com',
    confidence: { name: 'high' },
  },
  categoryId: 'coding',
})
eq(okMeta.form.name, 'GitHub', 'fallbackDraftFromMeta 透传可信站名')
eq(okMeta.form.url, 'github.com', 'fallbackDraftFromMeta 用响应域名作 url')
eq(okMeta.form.categoryId, 'coding', 'fallbackDraftFromMeta 用调用方解析出的分类')
eq(okMeta.form.purposes.length, 1, 'fallbackDraftFromMeta 用途经 normalizePurposes 过滤')
eq(okMeta.faviconHost, 'github.com', 'fallbackDraftFromMeta 记录图标来源域名')

/* ---- 抓取失败 → 域名兜底照常出草稿 ---- */
const noMeta = fallbackDraftFromMeta({ url: 'https://www.GitHub.com/x', meta: null })
eq(noMeta.form.name, 'www.GitHub.com', '抓取失败用域名兜底命名')
eq(noMeta.form.url, 'www.GitHub.com', '抓取失败仍存主机名')
eq(noMeta.form.desc, '', '抓取失败描述为空')
eq(noMeta.form.categoryId, '', '抓取失败分类由决策层决定，此处不写')
eq(noMeta.faviconUrl, '', '抓取失败不挂图标来源')
const noMetaBuilt = buildSiteFromDraft(noMeta)
ok(!('iconUrl' in noMetaBuilt.site), '图标来源域名为空时不写 iconUrl')
eq(noMetaBuilt.domain, 'github.com', '抓取失败仍算出去重域名')

/* ---- 站名不可靠 → 域名兜底命名 ---- */
const lowName = fallbackDraftFromMeta({
  url: 'https://suno.ai',
  meta: { name: 'Suno', domain: 'suno.ai', confidence: { name: 'low' } },
})
eq(lowName.form.name, 'suno.ai', '名称低置信时用域名兜底命名')
const noName = fallbackDraftFromMeta({
  url: 'https://suno.ai',
  meta: { name: '   ', domain: 'suno.ai' },
})
eq(noName.form.name, 'suno.ai', '名称为空时用域名兜底命名')

/* ---- 兜底配色：同域稳定、不同域不同 ---- */
ok(/^#[0-9a-f]{6}$/.test(noMeta.form.color), '兜底色是合法十六进制色值')
eq(noMeta.form.color, fallbackDraftFromMeta({ url: 'https://www.GitHub.com/y', meta: null }).form.color,
  '同一域名每次兜底色一致')
eq(colorFromHost('a.com') === colorFromHost('b.com'), false, '不同域名兜底色不同')
```

- [ ] **Step 2.2: 跑测试确认失败**

Run: `node tools/console/test-auto-add.mjs`
Expected: FAIL — 导入 `fallbackDraftFromMeta` / `colorFromHost` 报错，且 `AUTO_ADD_REASON` 缺 `WRITE_FAILED`

- [ ] **Step 2.3: 改实现**

Modify `src/utils/siteDraft.js`：

(a) 顶部 import 行加上 `hashColor`（与已有 `../../shared/purposes.mjs` 同风格的相对路径）：

```js
import { hostOf, looksLikeUrl } from './url.js'
import { normalizePurposes } from '../../shared/purposes.mjs'
import { hashColor } from '../../shared/site-infer.mjs'
```

(b) `AUTO_ADD_REASON` 改成：抓取失败 / 低置信两个「退回弹窗」的原因码退役，补一个写库失败码。

```js
/** 自动添加被拦下的原因码。抓取失败与站名低置信已改为域名兜底照常入库，故退役。 */
export const AUTO_ADD_REASON = {
  INVALID_URL: 'invalid-url',
  DUPLICATE: 'duplicate',
  WRITE_FAILED: 'write-failed',
}
```

(c) `colorFromHost`（紧跟 `AUTO_ADD_REASON` 之后）：

```js
/** 无品牌色时按域名派生稳定色：同一域名每次一致，不同域名不会撞成一片 */
export function colorFromHost(domain) {
  return hashColor(domain)
}
```

(d) `preflightOf` 只留网址判定（重复判据已由 `autoAdd` 直接调 `findDuplicate` 拿命中站点）：

```js
/** 发请求前的把关：网址不成立就直接拦下，不必联网。重复判据见 autoAdd 里的 findDuplicate */
export function preflightOf({ url }) {
  if (!looksLikeUrl(url)) {
    return { reason: AUTO_ADD_REASON.INVALID_URL, message: '没能识别出有效网址，请检查后重试。' }
  }
  return null
}
```

(e) 删掉 `draftFromMeta` 与 `metaGuardrailOf` 两个函数（前者被 `fallbackDraftFromMeta` 完全取代、无其他调用方，后者是本次退役的护栏），在原位置写上：

```js
/**
 * 站点草稿：抓到了就用元数据，抓不到 / 站名不可靠就用域名兜底 —— 自动添加不再退回人工。
 * `categoryId` 由调用方（autoAdd）经分类决策解析后传入，本函数不猜分类。
 */
export function fallbackDraftFromMeta({ url, meta = null, categoryId = '' }) {
  const m = meta || {}
  const rawName = String(m.name || '').trim()
  // 站名不可靠 = 没抓到名字，或抓到的是「按域名拼的」低置信结果 → 一律退回域名兜底
  const nameReliable = Boolean(rawName) && m?.confidence?.name !== 'low'

  return {
    form: {
      name: nameReliable ? rawName : rawHostOf(url),
      url: String(m.domain || '').trim() || rawHostOf(url),
      desc: m.desc || '',
      categoryId,
      color: m.color || colorFromHost(domainOf(url)),
      aliases: '',
      purposes: normalizePurposes(m.purposes),
    },
    faviconUrl: m.faviconUrl || m.favicon || '',
    faviconHost: String(m.domain || '').toLowerCase(),
  }
}
```

> 文件头注释里「自动添加」的描述也要同步。把开头第 1–8 行的块注释中
> 「两边必须用同一把尺子…」段落末尾追加一句即可，改法：
> 把 `* 只允许相对路径导入：tools/console 下的纯 node 测试要直接加载本模块。`
> 保持不动，在其**前面**插入一行 `* 抓取失败与站名低置信在自动路径上不拦人，统一走域名兜底（fallbackDraftFromMeta）。`

- [ ] **Step 2.4: 跑测试确认通过**

Run: `node tools/console/test-auto-add.mjs`
Expected: `✅ 站点草稿工具全部通过：N 条断言`（0 failures）

- [ ] **Step 2.5: 确认没有残留引用**

Run: `rg -n "metaGuardrailOf|draftFromMeta|FETCH_FAILED|LOW_CONFIDENCE" src tools`
Expected: 无输出（`rg` 找不到即为空）

- [ ] **Step 2.6: 提交**

```bash
git add src/utils/siteDraft.js tools/console/test-auto-add.mjs
git commit -m "feat: 自动添加改为域名兜底入库，退役抓取失败与低置信护栏"
```

---

### Task 3: 底部 Toast（store + 宿主组件）

**Files:**
- Create: `src/stores/toast.js`
- Create: `src/components/ToastHost.vue`
- Modify: `src/App.vue`（本任务只挂载宿主，分派逻辑在 Task 7）

- [ ] **Step 3.1: 实现 store**

Create `src/stores/toast.js`:

```js
/**
 * 全局轻提示：站内没有第二个「全局瞬时状态」的去处，故独立成 store，
 * 由 App.vue 挂一次 ToastHost 渲染。项目里没有通用 Toast 组件，这是新建的基础设施。
 *
 * 倒计时要能被悬停暂停 —— 提示里有「撤销」按钮，用户读到一半被自动收掉是最糟的体验。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

const MAX_ITEMS = 3
const TONE_DURATION = { ok: 5000, info: 4000, error: 8000 }
const FALLBACK_DURATION = 5000

let seq = 0

export const useToastStore = defineStore('toast', () => {
  const items = ref([])
  const timers = new Map()

  function arm(item, ms) {
    item.remaining = ms
    item.expiresAt = Date.now() + ms
    timers.set(item.id, setTimeout(() => dismiss(item.id), ms))
  }

  function dismiss(id) {
    const timer = timers.get(id)
    if (timer) { clearTimeout(timer); timers.delete(id) }
    const idx = items.value.findIndex(t => t.id === id)
    if (idx !== -1) items.value.splice(idx, 1)
  }

  function push({ message, tone = 'ok', actionLabel = '', onAction = null, duration = 0 }) {
    const item = {
      id: ++seq,
      message: String(message || ''),
      tone: ['ok', 'info', 'error'].includes(tone) ? tone : 'ok',
      actionLabel: String(actionLabel || ''),
      onAction,
      remaining: 0,
      expiresAt: 0,
    }
    items.value.push(item)
    // 超出上限丢最旧的，绝不让提示堆满屏幕
    while (items.value.length > MAX_ITEMS) dismiss(items.value[0].id)
    arm(item, duration || TONE_DURATION[item.tone] || FALLBACK_DURATION)
    return item.id
  }

  function pause(id) {
    const item = items.value.find(t => t.id === id)
    const timer = timers.get(id)
    if (!item || !timer) return
    clearTimeout(timer)
    timers.delete(id)
    item.remaining = Math.max(0, item.expiresAt - Date.now())
  }

  function resume(id) {
    const item = items.value.find(t => t.id === id)
    if (!item || timers.has(id)) return
    arm(item, item.remaining || FALLBACK_DURATION)
  }

  return { items, push, dismiss, pause, resume }
})
```

- [ ] **Step 3.2: 实现宿主组件**

Create `src/components/ToastHost.vue`:

```vue
<template>
  <Teleport to="body">
    <div class="toast-host" role="status" aria-live="polite">
      <TransitionGroup name="toast">
        <div v-for="t in toastStore.items" :key="t.id"
             class="toast" :class="'toast-' + t.tone"
             @mouseenter="toastStore.pause(t.id)" @mouseleave="toastStore.resume(t.id)">
          <span class="toast-msg">{{ t.message }}</span>
          <button v-if="t.actionLabel" class="toast-action" @click="runAction(t)">{{ t.actionLabel }}</button>
          <button class="toast-close" aria-label="关闭提示" @click="toastStore.dismiss(t.id)">×</button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup>
import { useToastStore } from '@/stores/toast'

const toastStore = useToastStore()

function runAction(t) {
  toastStore.dismiss(t.id)
  if (typeof t.onAction === 'function') t.onAction()
}
</script>

<style scoped>
/* 底部居中；z-index 高于右键菜单(500)与批量栏(200)，任何弹窗出现时都压得住 */
.toast-host {
  position: fixed;
  left: 50%;
  bottom: calc(24px + env(safe-area-inset-bottom));
  transform: translateX(-50%);
  z-index: 700;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
  max-width: 96vw;
}
.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(92vw, 560px);
  padding: 10px 14px;
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-left-width: 3px;
  border-radius: var(--radius-sm);
  box-shadow: 0 8px 30px rgba(0, 0, 0, .16);
  font-size: 13px;
  color: var(--text-primary);
}
.toast-ok { border-left-color: #22c55e; }
.toast-info { border-left-color: var(--accent); }
.toast-error { border-left-color: #ef4444; }
.toast-msg { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.toast-action {
  flex-shrink: 0;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #fff;
  cursor: pointer;
  transition: opacity .15s ease;
}
.toast-action:hover { opacity: .85; }
.toast-close {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
.toast-close:hover { color: var(--text-primary); }

.toast-enter-active, .toast-leave-active { transition: all .25s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(12px); }
.toast-move { transition: transform .25s ease; }

/* 移动端抬到 tab 栏与批量栏之上，否则会被盖住 */
@media (max-width: 768px) {
  .toast-host { bottom: calc(76px + env(safe-area-inset-bottom)); }
}
@media (prefers-reduced-motion: reduce) {
  .toast-enter-active, .toast-leave-active, .toast-move { transition: none; }
}
</style>
```

- [ ] **Step 3.3: 挂载宿主**

Modify `src/App.vue`：

(a) import 区（`AddSiteModal` 那行后面）加：

```js
import AddSiteModal from '@/components/AddSiteModal.vue'
import ToastHost from '@/components/ToastHost.vue'
```

(b) 模板里 `AddSiteModal` 那行后面加：

```html
    <AddSiteModal v-if="showAddModal" :prefill-url="addPrefillUrl" :notice="addNotice" @close="closeAddSite" />

    <!-- 全局轻提示：自动添加的成功 / 重复 / 失败反馈都从这里出，替代原预览卡片 -->
    <ToastHost />
```

- [ ] **Step 3.4: 构建确认无编译错误**

Run: `npm run build`
Expected: `built in ...`，无 error（warning 不算失败）

- [ ] **Step 3.5: 提交**

```bash
git add src/stores/toast.js src/components/ToastHost.vue src/App.vue
git commit -m "feat: 新增底部 Toast 提示基础设施（store + 宿主组件）"
```

---

### Task 4: 站点 store 增加高亮定位状态

**Files:**
- Modify: `src/stores/sites.js`

- [ ] **Step 4.1: 加状态与动作**

Modify `src/stores/sites.js` —— 在 `// 批量选择 / 手动拖拽排序（工具栏移出列表后，两者需跨组件共享）` 那段（`const selectedIds = ref(new Set())`）后面加：

```js
  // 正在高亮的卡片 id：跨组件共享（App 发起 → SiteCard 描边 → CardsContainer 滚动定位）
  const highlightSiteId = ref('')
  let highlightTimer = null

  function highlightSite(id) {
    clearTimeout(highlightTimer)
    highlightSiteId.value = id || ''
    if (!id) return
    // 自动消失，避免用户滚动时还挂着一圈描边
    highlightTimer = setTimeout(() => { highlightSiteId.value = '' }, 2500)
  }

  function clearHighlight() {
    clearTimeout(highlightTimer)
    highlightSiteId.value = ''
  }
```

- [ ] **Step 4.2: 暴露到 store 返回值**

Modify `src/stores/sites.js` 的 `return`：把

```js
    sites, cloudSites, searchQuery, currentCategory, currentPurpose, sortBy, viewMode,
```

改成

```js
    sites, cloudSites, searchQuery, currentCategory, currentPurpose, sortBy, viewMode,
    highlightSiteId, highlightSite, clearHighlight,
```

- [ ] **Step 4.3: 构建确认**

Run: `npm run build`
Expected: `built in ...`

- [ ] **Step 4.4: 提交**

```bash
git add src/stores/sites.js
git commit -m "feat: 站点 store 新增卡片高亮定位状态"
```

---

### Task 5: 卡片高亮描边 + 列表滚动定位

**Files:**
- Modify: `src/components/SiteCard.vue`
- Modify: `src/components/CardsContainer.vue`

- [ ] **Step 5.1: SiteCard 挂 `data-site-id` 与高亮类**

Modify `src/components/SiteCard.vue` 模板第一行，把

```html
  <div class="card" :class="{ 'card-list': isList, 'card-batch': batchMode, 'card-selected': selected }"
       @click="onCardClick" @contextmenu.prevent="batchMode ? null : showContextMenu($event)"
       @mouseenter="onHover" @mouseleave="onHoverLeave">
```

改成

```html
  <div class="card"
       :class="{ 'card-list': isList, 'card-batch': batchMode, 'card-selected': selected, 'card-highlight': isHighlighted }"
       :data-site-id="site.id"
       @click="onCardClick" @contextmenu.prevent="batchMode ? null : showContextMenu($event)"
       @mouseenter="onHover" @mouseleave="onHoverLeave">
```

- [ ] **Step 5.2: SiteCard 加 computed**

Modify `src/components/SiteCard.vue` script —— 在 `const purposeIds = computed(...)` 后面加：

```js
// 自动添加 / 定位复看时的高亮描边：由 sitesStore 统一计时清除
const isHighlighted = computed(() => sitesStore.highlightSiteId === props.site.id)
```

- [ ] **Step 5.3: SiteCard 加样式**

Modify `src/components/SiteCard.vue` scoped style —— 在 `.card-selected { ... }` 那行后面加：

```css
/* 高亮：描边 + 一圈光晕。走 transition 而非 animation —— .card 已占了 animation（fadeInUp），
   再叠一个会互相覆盖，导致卡片入场跳变。2.5s 后由 store 清掉 class，自然淡出。 */
.card.card-highlight {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-left-color: var(--accent);
  box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 18%, transparent), var(--shadow-hover);
  transform: translateY(-2px);
}
@media (prefers-reduced-motion: reduce) {
  .card.card-highlight { transform: none; }
}
```

- [ ] **Step 5.4: CardsContainer 按高亮 id 滚动**

Modify `src/components/CardsContainer.vue`：

(a) 模板根节点加 ref：

```html
  <div class="cards-container" ref="containerRef">
```

(b) script 的 import 行改成（补 `watch` 与 `nextTick`）：

```js
import { ref, computed, watch, nextTick } from 'vue'
```

(c) 在 `function openEdit(site) {` 之前加：

```js
// 自动添加成功后要把新卡片滚到视野中间，否则列表长时「加了但看不见」
const containerRef = ref(null)

watch(() => sitesStore.highlightSiteId, async (id) => {
  if (!id) return
  await nextTick()
  const el = containerRef.value?.querySelector(`[data-site-id="${id}"]`)
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
})
```

- [ ] **Step 5.5: 构建确认**

Run: `npm run build`
Expected: `built in ...`

- [ ] **Step 5.6: 提交**

```bash
git add src/components/SiteCard.vue src/components/CardsContainer.vue
git commit -m "feat: 卡片高亮描边与列表滚动定位"
```

---

### Task 6: `autoAdd.js` 接入分类决策

**Files:**
- Modify: `src/services/autoAdd.js`

> 本文件 import 了 `@/stores/*`，纯 node 加载不了，故不写单测（与既有 `test-auto-add.mjs` 的注释一致：只测纯函数）。行为由 Task 8 的全量测试 + 手动验收覆盖。

- [ ] **Step 6.1: 整体重写服务**

Replace 全部内容 of `src/services/autoAdd.js`:

```js
/**
 * 自动添加管道：搜索栏粘网址 → 识别 → 决定分类 → 入库，中间不给用户确认的机会。
 *
 * 出口是「决策结果」而不是「弹窗」：只有网址不成立、同域名已收录、写库失败这三种情况
 * 才返回 ok:false，由 App 分派到底部 Toast；抓取失败 / 站名不可信一律域名兜底照常入库，
 * 分类没把握就按页面简介新建一个。判定本身都在纯函数里，这里只做编排与联网。
 */
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { normalizeUrl, hostOf } from '@/utils/url'
import {
  AUTO_ADD_REASON, findDuplicate, preflightOf, fallbackDraftFromMeta, buildSiteFromDraft,
} from '@/utils/siteDraft'
import { suggestCategory } from '../../shared/auto-category.mjs'

const META_TIMEOUT_MS = 8000

/** 抓元数据：超时 / 非 2xx / 网络异常都返回 null，由后续「域名兜底」接手，不再拦人 */
async function fetchMeta(url) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), META_TIMEOUT_MS)
  try {
    const res = await fetch('/api/metadata?url=' + encodeURIComponent(url), { signal: ctrl.signal })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * @param {{ url: string }} input 搜索栏给出的原始网址
 * @returns {Promise<
 *   { ok: true, site: object, category: { id: string, label: string, created: boolean } } |
 *   { ok: false, reason: string, message: string, existing?: object }
 * >}
 */
export async function autoAddSite({ url }) {
  const sitesStore = useSitesStore()
  const categoriesStore = useCategoriesStore()
  const normalized = normalizeUrl(url)

  const invalid = preflightOf({ url: normalized })
  if (invalid) return { ok: false, ...invalid }

  // 重复不进弹窗：把命中站点带回，App 用来定位已有卡片
  const duplicate = findDuplicate(sitesStore.sites, normalized)
  if (duplicate) {
    return {
      ok: false,
      reason: AUTO_ADD_REASON.DUPLICATE,
      message: `「${duplicate.name}」已收录`,
      existing: { id: duplicate.id, name: duplicate.name, categoryId: duplicate.categoryId || '' },
    }
  }

  const meta = await fetchMeta(normalized)

  // 分类决策：输入是元数据 + 本地分类表快照，输出「复用哪个」或「新建一个」
  const plan = suggestCategory({
    categoryId: meta?.categoryId || '',
    categoryConfidence: meta?.confidence?.category || '',
    name: meta?.name || '',
    desc: meta?.desc || '',
    domain: meta?.domain || hostOf(normalized),
    purposes: meta?.purposes || [],
    existing: categoriesStore.categories.map(c => ({
      id: c.id,
      label: c.label,
      groupId: categoriesStore.getGroupByCategory(c.id)?.id || '',
    })),
    domainIds: categoriesStore.domains.map(d => d.id),
  })

  let categoryId = ''
  let categoryLabel = ''
  let createdCategory = false

  if (plan.kind === 'create') {
    // 新建分类失败（id 撞车 / 域不存在）不阻断添加：站点按未分类入库，Toast 照常出
    const r = categoriesStore.addCategory(plan.groupId, {
      id: plan.id, label: plan.label, dotColor: plan.dotColor,
    })
    if (r.ok) {
      categoryId = r.id
      categoryLabel = plan.label
      createdCategory = true
    }
  } else {
    categoryId = plan.categoryId
    categoryLabel = plan.label
  }

  try {
    const draft = fallbackDraftFromMeta({ url: normalized, meta, categoryId })
    const { site } = buildSiteFromDraft(draft)
    const created = sitesStore.addSite(site)
    return {
      ok: true,
      site: created,
      category: { id: categoryId, label: categoryLabel, created: createdCategory },
    }
  } catch {
    // 本机存储写入被拒（配额 / 隐私模式）是唯一可能的写库失败
    return { ok: false, reason: AUTO_ADD_REASON.WRITE_FAILED, message: '添加失败：本机存储写入被拒绝，请稍后重试。' }
  }
}
```

- [ ] **Step 6.2: 构建确认**

Run: `npm run build`
Expected: `built in ...`

- [ ] **Step 6.3: 确认旧护栏没有残留**

Run: `rg -n "metaGuardrailOf|draftFromMeta|phase: 'loading'|AddSitePreviewCard" src`
Expected: 只剩 `src/App.vue` 里的 `AddSitePreviewCard` / `autoAddState`（Task 7 删）

- [ ] **Step 6.4: 提交**

```bash
git add src/services/autoAdd.js
git commit -m "feat: 自动添加接入分类决策并返回分类结果"
```

---

### Task 7: App.vue 改为静默入库 + Toast 分派 + 定位高亮

**Files:**
- Modify: `src/App.vue`
- Delete: `src/components/AddSitePreviewCard.vue`

- [ ] **Step 7.1: 删掉预览卡片组件**

Run: `rg -n "AddSitePreviewCard" src`
Expected: 只有 `src/App.vue` 两处（import + 模板），确认无其他引用后再删：

```bash
git rm src/components/AddSitePreviewCard.vue
```

- [ ] **Step 7.2: 模板删预览卡片**

Modify `src/App.vue` —— 删掉这两行：

```html
    <!-- 自动添加的预览卡片：只在成功/进行中渲染，失败直接退回上面的弹窗 -->
    <AddSitePreviewCard v-if="autoAddState" :state="autoAddState" @close="closeAutoAddCard" />
```

- [ ] **Step 7.3: script 换 import 与状态**

Modify `src/App.vue`：

(a) import 区：

```js
import { computed, nextTick, onMounted, ref, watch } from 'vue'
```
```js
import AddSiteModal from '@/components/AddSiteModal.vue'
import ToastHost from '@/components/ToastHost.vue'
import { autoAddSite } from '@/services/autoAdd'
import { AUTO_ADD_REASON } from '@/utils/siteDraft'
import { useToastStore } from '@/stores/toast'
```

并删掉这一行：

```js
import AddSitePreviewCard from '@/components/AddSitePreviewCard.vue'
```

(b) 在 `const clicksStore = useClicksStore()` 后面加：

```js
const toastStore = useToastStore()
```

(c) 删掉 `autoAddState` 与 `closeAutoAddCard`：

```js
// 自动添加进行中/成功的状态；为 null 表示没有卡片
const autoAddState = ref(null)
```
```js
function closeAutoAddCard() {
  autoAddState.value = null
}
```

- [ ] **Step 7.4: 重写 `runAutoAdd` 并新增 `locateSite` / `undoAutoAdd`**

Replace `async function runAutoAdd(url) { ... }` 整段 with:

```js
async function runAutoAdd(url) {
  const seq = ++autoAddSeq
  // 抓取最长 8s，先给一条「进行中」提示，否则用户按回车后会以为没反应
  const pendingId = toastStore.push({ message: '正在识别站点信息…', tone: 'info', duration: 60000 })

  let res
  try {
    res = await autoAddSite({ url })
  } catch {
    res = { ok: false, reason: AUTO_ADD_REASON.WRITE_FAILED, message: '添加失败，请稍后重试。' }
  }
  toastStore.dismiss(pendingId)
  if (seq !== autoAddSeq) return

  if (res.ok) {
    toastStore.push({
      message: res.category.created
        ? `已添加「${res.site.name}」，并新建分类「${res.category.label}」`
        : `已添加「${res.site.name}」到「${res.category.label}」`,
      tone: 'ok',
      actionLabel: '撤销',
      onAction: () => undoAutoAdd(res.site.id, res.category),
    })
    await locateSite(res.site)
    return
  }

  if (res.reason === AUTO_ADD_REASON.DUPLICATE) {
    const existing = res.existing
    toastStore.push({
      message: res.message,
      tone: 'info',
      actionLabel: '查看',
      onAction: () => locateSite({ id: existing.id, categoryId: existing.categoryId }),
    })
    await locateSite({ id: existing.id, categoryId: existing.categoryId })
    return
  }

  // 网址不成立 / 写库失败：报错即可，自动路径不再退回弹窗
  toastStore.push({ message: res.message, tone: 'error' })
}

/**
 * 自动切到站点所属分类并高亮定位。路由是唯一事实来源，改范围 / 分类都走这里。
 * 清掉 p、q 是必须的：不清掉用途与搜索词，新卡片会被筛掉，定位就落空了。
 */
async function locateSite(site) {
  const target = site.categoryId || 'all'
  const current = (route.query.c && route.query.c !== 'all') ? route.query.c : 'all'
  const needNav = route.name !== 'Home' || current !== target || Boolean(route.query.p) || Boolean(route.query.q)
  if (needNav) {
    await router.push({ name: 'Home', query: site.categoryId ? { c: site.categoryId } : {} })
  }
  await nextTick()
  sitesStore.highlightSite(site.id)
}

/** 撤销一次自动添加；本次顺带新建、且现已无人使用的分类一并回收 */
function undoAutoAdd(siteId, category) {
  const undone = sitesStore.undoAdd(siteId)
  if (undone && category?.created && category.id) {
    const stillUsed = sitesStore.sites.some(s => s.categoryId === category.id)
    if (!stillUsed) categoriesStore.removeCategory(category.id)
  }
  toastStore.push({ message: '已撤销', tone: 'info', duration: 2000 })
}
```

- [ ] **Step 7.5: 构建确认无残留引用**

Run: `npm run build`
Expected: `built in ...`

Run: `rg -n "autoAddState|closeAutoAddCard|AddSitePreviewCard" src`
Expected: 无输出

- [ ] **Step 7.6: 提交**

```bash
git add src/App.vue
git commit -m "feat: 搜索栏一键添加改为静默入库 + Toast 反馈 + 自动定位高亮"
```

---

### Task 8: 全量测试、构建与手动验收

**Files:**
- Modify: `package.json`（把新测试接进 `console:test:all`）

- [ ] **Step 8.1: 接进全量链**

Modify `package.json` 的 `"console:test:all"`，在 `node tools/console/test-auto-add.mjs` 后面插入 `&& node tools/console/test-auto-category.mjs`：

```json
    "console:test:all": "node tools/console/test-trust.mjs && node tools/console/test-infer.mjs && node tools/console/test-purposes.mjs && node tools/console/test-visual-scheme.mjs && node tools/console/test-url.mjs && node tools/console/test-auto-add.mjs && node tools/console/test-auto-category.mjs && node tools/console/test-guard.mjs && node tools/console/test-hunks.mjs && node tools/console/test-ops.mjs && node --experimental-test-module-mocks tools/console/test-api-ops.mjs",
```

- [ ] **Step 8.2: 跑全量测试**

Run: `npm run console:test:all`
Expected: 所有 `✅`，exit code 0（任一 `❌` 都要修到绿）

- [ ] **Step 8.3: 构建**

Run: `npm run build`
Expected: `built in ...`

- [ ] **Step 8.4: 手动验收（`npm run dev`）**

按顺序逐条验，每条都要看到对应现象：

1. **静默添加 + 自动切分类 + 高亮**：搜索框输入一个内置表覆盖不到的站（如 `suno.ai`）→ 回车 → **无任何弹窗/浮层** → 底部出现「正在识别站点信息…」→ 随后变成「已添加「…」，并新建分类「AI 音乐」」→ 页面**自动切到 AI 音乐分类**、新卡片滚到视野中间并有描边高亮。
2. **撤销**：点 Toast 上的「撤销」→ 卡片消失 → 再弹一条 2s「已撤销」→ 后台「分类管理」里若该分类已无站点则不再存在。
3. **抓取失败兜底**：输一个抓不到的域名 → 仍入库，卡片名是域名。
4. **重复**：输一个已收录域名 → 不开弹窗 → Toast「「某站」已收录」+ 「查看」→ 自动切到该站所在分类并高亮已有卡片。
5. **无效网址**：输 `不是网址` → 搜索框本就不给「添加站点」入口；若直接触发则出错误 Toast，不开弹窗。
6. **开关关闭**：管理后台「偏好设置」关掉「网址自动添加」→ 搜索框加站回到 `AddSiteModal` 弹窗，行为与从前一致。
7. **工具栏「+」**：点右上角添加按钮 → 仍是弹窗（未改动的手工路径）。
8. **分类未发布**：自动新建分类后，后台「分类管理」出现未发布提示，且**不自动发布**。
9. **首屏无回归**：刷新后新站点仍在（本地覆盖层已落盘），`/favorites`、`/recent`、搜索词、拖拽排序均正常。

- [ ] **Step 8.5: 提交**

```bash
git add package.json
git commit -m "test: 自动分类测试接入全量链并跑通构建"
```

---

## 自查记录（writing-plans Self-Review）

1. **Spec 覆盖**
   - §4.1 无弹窗出口 → Task 6（只返回三种 ok:false）+ Task 7（分派到 Toast，失败也不开弹窗）✅
   - §4.2 管道改造 / 退役 `metaGuardrailOf` 与两个原因码 → Task 2 ✅；`preflightOf` 简化为只判网址 → Task 2 Step 2.3(d) ✅
   - §4.3 决策表 6 条 / label 归一 / id 派生 / 配色 / 落库编排 → Task 1 + Task 6 ✅
   - §4.4 域名兜底草稿（`url` 存主机名、`initial` 首字大写、`iconUrl` 门槛三条不变 —— 仍走 `buildSiteFromDraft`）→ Task 2 ✅
   - §4.5 Toast（3 条上限、5s/8s、悬停暂停、文案与撤销、回收空分类）→ Task 3 + Task 7 Step 7.4 ✅
   - §4.6 定位高亮（store / SiteCard / CardsContainer / `locateSite` 清 `p`·`q`）→ Task 4、5、7 ✅；重复分支定位已有卡片 → Task 6 返回 `existing` + Task 7 ✅
   - §4.7 边界：删预览卡片 ✅（Task 7）、不自动发布 ✅（未引入）、不新增后台开关 ✅、工具栏「+」与关开关走弹窗 ✅（`openAddSite` 未改）、`autoAddSeq` 丢弃过期结果 ✅（保留）、不清空搜索框 ✅（只在 `locateSite` 里通过路由清 `q`，不动输入框以外状态）
   - §4.8 验证 → Task 8 ✅

2. **占位符扫描**：无 TBD / TODO / 「同 Task N」；每个改码步骤都给了完整代码块或精确的 old→new 行。

3. **类型与命名一致性**
   - `suggestCategory({ ... , domainIds })` → Task 1 定义、Task 6 传参一致；返回 `{kind:'use'|'create', ...}` 两边一致 ✅
   - `categoryIdFor(label, taken)` 单参列表 `Set`，Task 1 定义与测试一致 ✅
   - `fallbackDraftFromMeta({ url, meta, categoryId })` → Task 2 定义、Task 6 调用一致 ✅
   - `AUTO_ADD_REASON.{INVALID_URL, DUPLICATE, WRITE_FAILED}` → Task 2 定义、Task 6 / Task 7 使用一致 ✅
   - `highlightSiteId` / `highlightSite(id)` → Task 4 定义、Task 5（两处）与 Task 7 使用一致 ✅
   - `toastStore.push/dismiss/pause/resume` → Task 3 定义、Task 7 使用一致；`push` 返回 id ✅
   - `category: { id, label, created }` → Task 6 返回、Task 7 消费一致 ✅
