# 搜索栏自动执行添加 + 预览卡片 + 后台开关 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在站内搜索栏识别到网址后跳过确认弹窗、自动完成入库并弹出预览卡片（可撤销 / 编辑 / 访问），该行为默认开启，并在管理后台新增「偏好设置」Tab 提供开关。

**Architecture:** 站内搜索栏的添加入口与右上角工具栏的「+」共用 `App.vue#openAddSite`。在入口处分叉：带网址且开关为开 → 走新增的 `src/services/autoAdd.js` 管道（归一 → 去重 → 抓元数据 → 护栏判定 → 入库），成功则渲染独立的 `AddSitePreviewCard`，失败则带提示语回落到既有 `AddSiteModal`；不带网址或开关为关 → 行为完全不变。弹窗与自动管道共用新抽出的纯函数模块 `src/utils/siteDraft.js`，保证「同域是否已收录」「站点对象怎么组装」两处只有一份判据。开关走本机 `preferences` store 持久化，不引入任何云端配置基础设施。

**Tech Stack:** Vue 3 `<script setup>`、Pinia（setup store + `versionedPersist`）、Vite、Node 22 零依赖控制台测试（`tools/console/test-*.mjs`）。

---

## 关键约束（动手前必读）

1. **`@/` 是 Vite 别名，纯 node 解析不了。** `tools/console/test-*.mjs` 用 `node` 直接跑，只能 import **相对路径**且自身不引入 `@/` 的模块。
   - 因此 `src/utils/siteDraft.js` **只允许** `./url.js` 与 `../../shared/purposes.mjs` 这两个相对导入（已验证两者均无其他依赖）。
   - **不得**在 `test-auto-add.mjs` 里 import `src/stores/*` 或 `src/services/autoAdd.js`（它们引 `@/`）。护栏判定必须落在纯函数里，才能被测试覆盖。
2. **`site.url` 存的是「去协议、去路径、保留大小写」的主机名**（`https://www.GitHub.com/a` → `www.GitHub.com`），**去重域名**才去 `www.` 并转小写。这三条规则是既有行为，重构时不得"顺手修正"。
3. **`versionedPersist('preferences', [...])` 是白名单制**：新开关的键名不写进数组，刷新即丢。
4. 提交信息用中文，遵循 `type: 描述` 形式（如 `feat: ...` / `refactor: ...` / `test: ...`）。

---

## Task 1: 抽出共享站点草稿模块（纯函数）+ 控制台测试

**Files:**
- Create: `nav-v2/src/utils/siteDraft.js`
- Create: `nav-v2/tools/console/test-auto-add.mjs`
- Modify: `nav-v2/package.json`

- [ ] **Step 1: 先写失败测试 `tools/console/test-auto-add.mjs`**

```js
/**
 * 站点草稿工具：自动添加管道与「添加站点」弹窗共用的判据。
 * 只测纯函数 —— src/stores 与 src/services 引 @/ 别名，纯 node 加载不了。
 */
import {
  AUTO_ADD_REASON, rawHostOf, domainOf, parseAliases, findDuplicate,
  buildSiteFromDraft, draftFromMeta, preflightOf, metaGuardrailOf,
} from '../../src/utils/siteDraft.js'

let pass = 0
const failures = []
function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}

/* ---- 域名口径 ---- */
eq(rawHostOf('https://www.GitHub.com/a/b'), 'www.GitHub.com', 'rawHostOf 去协议去路径、保留大小写')
eq(domainOf('https://www.GitHub.com/a/b'), 'github.com', 'domainOf 小写去 www')
eq(domainOf('github.com'), 'github.com', 'domainOf 无协议可解析')
eq(domainOf(''), '', 'domainOf 空值返回空串')

/* ---- 别名归一 ---- */
const aliasOut = parseAliases('GitHub,  GitHub、github.com\n代码托管', 'GitHub', 'github.com')
eq(aliasOut.length, 1, 'parseAliases 去重并剔除站名/域名后只剩 1 条')
eq(aliasOut[0], '代码托管', 'parseAliases 保留有效别名')

/* ---- 同域去重 ---- */
const lib = [{ id: 'a', url: 'github.com' }, { id: 'b', url: 'gitlab.com' }]
eq(findDuplicate(lib, 'https://www.github.com/')?.id, 'a', 'findDuplicate 命中同域（忽略 www 与协议）')
eq(findDuplicate(lib, 'gitee.com'), null, 'findDuplicate 未收录返回 null')

/* ---- 草稿 → 站点对象（三条既有规则） ---- */
const draft = {
  form: {
    name: 'GitHub', url: 'https://www.github.com/x', desc: 'd',
    categoryId: 'c1', color: '#111111', aliases: '', purposes: ['coding'],
  },
  faviconUrl: 'https://github.com/favicon.ico',
  faviconHost: 'github.com',
}
const built = buildSiteFromDraft(draft)
eq(built.site.url, 'www.github.com', 'buildSiteFromDraft url 保留 www 与大小写、去协议去路径')
eq(built.domain, 'github.com', 'buildSiteFromDraft 返回去重域名')
eq(built.site.initial, 'G', 'buildSiteFromDraft initial 取首字符大写')
eq(built.site.iconUrl, 'https://github.com/favicon.ico', 'buildSiteFromDraft 图标域名一致时写入 iconUrl')
ok(!('aliases' in built.site), 'buildSiteFromDraft 无有效别名时不写 aliases 字段')

const otherHost = buildSiteFromDraft({ ...draft, faviconHost: 'cdn.example.com' })
ok(!('iconUrl' in otherHost.site), 'buildSiteFromDraft 图标域名不一致时不写 iconUrl')

const noName = buildSiteFromDraft({ form: { ...draft.form, name: '' } })
eq(noName.site.initial, '', 'buildSiteFromDraft 站名为空时 initial 为空串')

/* ---- 元数据 → 草稿 ---- */
const fromMeta = draftFromMeta({
  name: 'GitHub', desc: 'd', categoryId: 'c1', color: '#222222',
  purposes: ['coding', 'not-a-real-purpose'], faviconUrl: 'https://github.com/f.ico', domain: 'github.com',
})
eq(fromMeta.form.name, 'GitHub', 'draftFromMeta 透传站名')
eq(fromMeta.form.url, 'github.com', 'draftFromMeta 用响应域名作 url')
eq(fromMeta.faviconHost, 'github.com', 'draftFromMeta 记录图标来源域名')
eq(fromMeta.form.purposes.length, 1, 'draftFromMeta 用途经 normalizePurposes 过滤')

/* ---- 发请求前的把关 ---- */
eq(preflightOf({ url: '不是网址', duplicate: null })?.reason, AUTO_ADD_REASON.INVALID_URL, 'preflightOf 拦下不像网址的输入')
eq(preflightOf({ url: 'https://github.com', duplicate: lib[0] })?.reason, AUTO_ADD_REASON.DUPLICATE, 'preflightOf 拦下已收录域名')
eq(preflightOf({ url: 'https://github.com', duplicate: null }), null, 'preflightOf 正常网址放行')

/* ---- 抓取结果的把关 ---- */
eq(metaGuardrailOf({ meta: null })?.reason, AUTO_ADD_REASON.FETCH_FAILED, 'metaGuardrailOf 抓取失败时拦下')
eq(metaGuardrailOf({ meta: { name: '  ' } })?.reason, AUTO_ADD_REASON.LOW_CONFIDENCE, 'metaGuardrailOf 站名为空时拦下')
eq(metaGuardrailOf({ meta: { name: 'GitHub', confidence: { name: 'low' } } })?.reason, AUTO_ADD_REASON.LOW_CONFIDENCE, 'metaGuardrailOf 名称低置信时拦下')
eq(metaGuardrailOf({ meta: { name: 'GitHub', confidence: { name: 'high' } } }), null, 'metaGuardrailOf 名称可信时放行')

if (failures.length) {
  console.error(`\n❌ 站点草稿工具测试失败 ${failures.length} 项：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 站点草稿工具全部通过：${pass} 条断言`)
```

- [ ] **Step 2: 跑测试，确认红灯**

```powershell
cd 'c:\work\solo work\new\nav-v2' ; node tools/console/test-auto-add.mjs
```
预期：非 0 退出，报 `Cannot find module ... src/utils/siteDraft.js`（模块还不存在）。

- [ ] **Step 3: 实现 `src/utils/siteDraft.js`**

```js
/**
 * 站点草稿 → 入库对象：站内搜索栏的「自动添加」管道与「添加站点」弹窗共用。
 *
 * 两边必须用同一把尺子判断「这个域名是否已收录」、用同一段代码组装站点对象，
 * 否则会出现搜索栏说没收录、弹窗却拦下来说重复的死路。
 *
 * 只允许相对路径导入：tools/console 下的纯 node 测试要直接加载本模块。
 */

import { hostOf, looksLikeUrl } from './url.js'
import { normalizePurposes } from '../../shared/purposes.mjs'

/** 自动添加被拦下的原因码 */
export const AUTO_ADD_REASON = {
  INVALID_URL: 'invalid-url',
  DUPLICATE: 'duplicate',
  FETCH_FAILED: 'fetch-failed',
  LOW_CONFIDENCE: 'low-confidence',
}

/** 存放用的主机名：去协议、去路径，保留用户输入的大小写与 www */
export function rawHostOf(raw) {
  return String(raw ?? '').replace(/^https?:\/\//i, '').split('/')[0]
}

/** 去重判据用的域名：小写、去 www */
export function domainOf(raw) {
  return rawHostOf(raw).toLowerCase().replace(/^www\./, '')
}

/** 别名入参归一：接受逗号 / 顿号 / 换行分隔；去重，并剔除与站名 / 域名同形的项 */
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

/** 列表里是否已收录同域站点；域名解析不出时一律视为不重复 */
export function findDuplicate(sites, url) {
  const domain = domainOf(url)
  if (!domain) return null
  return (sites || []).find(s => hostOf(s.url) === domain) || null
}

/**
 * 草稿 → 站点对象。三条规则与既有弹窗完全一致，不得改动：
 * 1) url 存去协议去路径的主机名（保留大小写与 www）；
 * 2) initial 取站名首字符大写；
 * 3) 图标只在「抓取来源域名 === 本站去重域名」时写入，宁可回落字母块也不挂错图。
 */
export function buildSiteFromDraft({ form, faviconUrl = '', faviconHost = '' }) {
  const rawDomain = rawHostOf(form.url)
  const domain = domainOf(form.url)

  const site = {
    name: form.name,
    url: rawDomain,
    desc: form.desc,
    categoryId: form.categoryId,
    color: form.color,
    initial: String(form.name || '').charAt(0).toUpperCase(),
  }
  if (/^https?:\/\//i.test(faviconUrl) && String(faviconHost).toLowerCase() === domain) {
    site.iconUrl = faviconUrl
  }
  const aliases = parseAliases(form.aliases, form.name, domain)
  if (aliases.length) site.aliases = aliases
  const purposes = normalizePurposes(form.purposes)
  if (purposes.length) site.purposes = purposes

  return { site, domain }
}

/** 元数据响应 → 表单草稿。自动添加无人工干预，故不做 touched 判断，直接取识别结果 */
export function draftFromMeta(meta) {
  const m = meta || {}
  return {
    form: {
      name: m.name || '',
      url: m.domain || '',
      desc: m.desc || '',
      categoryId: m.categoryId || '',
      color: m.color || '#3b82f6',
      aliases: '',
      purposes: normalizePurposes(m.purposes),
    },
    faviconUrl: m.faviconUrl || m.favicon || '',
    faviconHost: String(m.domain || '').toLowerCase(),
  }
}

/** 发请求前的把关：网址不成立 / 同域已收录 → 直接拦下，不必联网 */
export function preflightOf({ url, duplicate }) {
  if (!looksLikeUrl(url)) {
    return { reason: AUTO_ADD_REASON.INVALID_URL, message: '没能识别出有效网址，请检查后重试。' }
  }
  if (duplicate) {
    return {
      reason: AUTO_ADD_REASON.DUPLICATE,
      message: `该域名已收录：${duplicate.name}（${duplicate.url}）。如需变更请编辑该站点。`,
    }
  }
  return null
}

/** 抓取结果的把关：抓不到 / 站名不可信 → 不自动入库，交回人工确认 */
export function metaGuardrailOf({ meta }) {
  if (!meta) {
    return { reason: AUTO_ADD_REASON.FETCH_FAILED, message: '抓取站点信息失败，请手动确认后再添加。' }
  }
  const name = String(meta.name || '').trim()
  if (!name || meta?.confidence?.name === 'low') {
    return { reason: AUTO_ADD_REASON.LOW_CONFIDENCE, message: '没能可靠识别站点名称，请手动确认后再添加。' }
  }
  return null
}
```

- [ ] **Step 4: 跑测试，确认绿灯**

```powershell
cd 'c:\work\solo work\new\nav-v2' ; node tools/console/test-auto-add.mjs
```
预期：`✅ 站点草稿工具全部通过：22 条断言`（断言数按实际输出为准），退出码 0。

- [ ] **Step 5: 把脚本挂进 `package.json`**

在 `scripts` 里 `"console:test:url"` 一行之后新增：

```json
    "console:test:auto-add": "node tools/console/test-auto-add.mjs",
```

并把 `console:test:all` 改成（在 `test-url.mjs` 之后插入 `test-auto-add.mjs`）：

```json
    "console:test:all": "node tools/console/test-trust.mjs && node tools/console/test-infer.mjs && node tools/console/test-purposes.mjs && node tools/console/test-visual-scheme.mjs && node tools/console/test-url.mjs && node tools/console/test-auto-add.mjs && node tools/console/test-guard.mjs && node tools/console/test-hunks.mjs && node tools/console/test-ops.mjs && node --experimental-test-module-mocks tools/console/test-api-ops.mjs"
```

- [ ] **Step 6: 提交**

```powershell
cd 'c:\work\solo work\new\nav-v2' ; git add src/utils/siteDraft.js tools/console/test-auto-add.mjs package.json ; git commit -m "refactor: 抽出站点草稿纯函数模块并补控制台测试"
```

---

## Task 2: 「添加站点」弹窗复用草稿模块，并支持入口提示语

**Files:**
- Modify: `nav-v2/src/components/AddSiteModal.vue`

- [ ] **Step 1: 模板加提示条**

在 `AddSiteModal.vue` 第 10 行 `<form @submit.prevent="submit" class="modal-body">` 之后、第一个 `<div class="form-group">` 之前插入：

```html
        <div v-if="notice" class="status-line warn">
          <span class="status-dot"></span>
          <span>{{ notice }}</span>
        </div>
```

- [ ] **Step 2: props 增加 `notice`**

把

```js
const props = defineProps({
  prefillUrl: { type: String, default: '' }
})
```

改为

```js
const props = defineProps({
  prefillUrl: { type: String, default: '' },
  // 自动添加被护栏拦下时带过来的原因，讲清楚为什么又退回弹窗
  notice: { type: String, default: '' }
})
```

- [ ] **Step 3: 删除本地 `parseAliases`，改用共享模块**

删除 `AddSiteModal.vue` 中 `parseAliases` 的本地定义（`/** 别名入参归一… */ function parseAliases(...) {...}` 整段），并把导入行

```js
import { normalizeUrl, hostOf } from '@/utils/url'
import { normalizePurposes, MAX_PURPOSES } from '../../shared/purposes.mjs'
```

改为

```js
import { normalizeUrl, hostOf } from '@/utils/url'
import { normalizePurposes, MAX_PURPOSES } from '../../shared/purposes.mjs'
import { findDuplicate, buildSiteFromDraft } from '@/utils/siteDraft'
```

- [ ] **Step 4: `submit()` 改用共享模块**

把整个 `submit()` 替换为：

```js
function submit() {
  // 同域名已在库里就别再插一条：卡片与分类会重复，云端同步时还会被当作两个站点
  const dup = findDuplicate(sitesStore.sites, form.url)
  if (dup) {
    submitError.value = `该域名已收录：${dup.name}（${dup.url}）。如需变更请编辑该站点，避免重复条目。`
    return
  }
  submitError.value = ''

  const { site } = buildSiteFromDraft({
    form,
    faviconUrl: faviconUrl.value,
    faviconHost: faviconHost.value,
  })

  sitesStore.addSite(site)
  emit('saved', { name: site.name, url: site.url })
  emit('close')
}
```

> 若 `npm run build` 报多余导入（`hostOf` / `normalizeUrl` 等在本文件其它函数里仍在用，正常情况无需改动）；只按报错提示删真正未使用的即可。

- [ ] **Step 5: 构建验证**

```powershell
cd 'c:\work\solo work\new\nav-v2' ; npm run build
```
预期：构建成功，无未定义引用。

- [ ] **Step 6: 提交**

```powershell
cd 'c:\work\solo work\new\nav-v2' ; git add src/components/AddSiteModal.vue ; git commit -m "refactor: 添加站点弹窗复用站点草稿模块并支持入口提示"
```

---

## Task 3: 站点 store 支持返回新建对象与撤销新增

**Files:**
- Modify: `nav-v2/src/stores/sites.js`

- [ ] **Step 1: `addSite` 返回创建出来的对象**

把 `addSite` 替换为：

```js
  function addSite(site) {
    const now = Date.now()
    const created = {
      id: now.toString(36) + Math.random().toString(36).slice(2, 6),
      sortOrder: cloudSites.value.length + localAdds.value.length,
      visitCount: 0,
      createdAt: now,
      updatedAt: now,
      ...site
    }
    localAdds.value.push(created)
    rebuild()
    saveOverlay()
    // 自动添加需要拿这条记录去做预览卡片与撤销，故返回创建结果
    return created
  }
```

- [ ] **Step 2: 新增 `undoAdd`**

在 `removeLocally` 上方插入：

```js
  /**
   * 撤销一次「自动添加」：只从本地新增层摘掉，不进回收站。
   * 自动添加没有人工确认这一步，撤销就要能彻底当没发生过。
   * 返回是否真的摘掉了一条。
   */
  function undoAdd(id) {
    const idx = localAdds.value.findIndex(s => s.id === id)
    if (idx === -1) return false
    localAdds.value.splice(idx, 1)
    delete localEdits.value[id]
    rebuild()
    saveOverlay()
    return true
  }
```

- [ ] **Step 3: 把 `undoAdd` 加进 return 列表**

把

```js
    addSite, updateSite, updateSiteField, deleteSite, recordVisit, reorderSites,
```

改为

```js
    addSite, updateSite, updateSiteField, undoAdd, deleteSite, recordVisit, reorderSites,
```

- [ ] **Step 4: 构建验证**

```powershell
cd 'c:\work\solo work\new\nav-v2' ; npm run build
```
预期：构建成功。`addSite` 既有调用方都忽略返回值，行为不变。

- [ ] **Step 5: 提交**

```powershell
cd 'c:\work\solo work\new\nav-v2' ; git add src/stores/sites.js ; git commit -m "feat: 站点 store 返回新建对象并支持撤销新增"
```

---

## Task 4: 偏好 store 增加「网址自动添加」开关

**Files:**
- Modify: `nav-v2/src/stores/preferences.js`

- [ ] **Step 1: 声明状态（默认开启）**

在 `const wallpaperBlur = ref(true)` 之后插入：

```js
  // 网址自动添加：搜索栏粘贴网址时跳过确认弹窗，直接入库并弹预览卡片
  const autoAddOnUrl = ref(true)
```

- [ ] **Step 2: 增加 setter**

在 `function setSearchEngine(id) { ... }` 之后插入：

```js
  function setAutoAdd(v) {
    autoAddOnUrl.value = Boolean(v)
  }
```

- [ ] **Step 3: 加进 return 列表**

把

```js
    theme, themePreset, searchEngine, wallpaper, wallpaperBlur, engines,
```

改为

```js
    theme, themePreset, searchEngine, wallpaper, wallpaperBlur, autoAddOnUrl, engines,
```

并把这行

```js
    toggleTheme, setSearchEngine, getCurrentEngine,
```

改为

```js
    toggleTheme, setSearchEngine, setAutoAdd, getCurrentEngine,
```

- [ ] **Step 4: 加进持久化白名单（关键，漏了刷新就丢）**

把 `persist` 行改为：

```js
  persist: versionedPersist('preferences', ['theme', 'themePreset', 'searchEngine', 'wallpaper', 'wallpaperBlur', 'autoAddOnUrl', 'visualScheme', 'visualOverrides'])
```

- [ ] **Step 5: 构建验证**

```powershell
cd 'c:\work\solo work\new\nav-v2' ; npm run build
```

- [ ] **Step 6: 提交**

```powershell
cd 'c:\work\solo work\new\nav-v2' ; git add src/stores/preferences.js ; git commit -m "feat: 偏好新增网址自动添加开关（默认开启）"
```

---

## Task 5: 新增自动添加服务

**Files:**
- Create: `nav-v2/src/services/autoAdd.js`

- [ ] **Step 1: 实现 `autoAddSite`**

```js
/**
 * 自动添加管道：搜索栏粘网址 → 识别 → 入库，中间不给用户确认的机会。
 *
 * 因为跳过了确认，凡是「机器判断可能出错」的环节都必须退回人工（弹窗）：
 * 网址不成立、同域已收录、抓取失败、站名空或低置信 —— 一律不写库。
 * 判定本身在 src/utils/siteDraft.js 的纯函数里，这里只做编排与联网。
 */
import { useSitesStore } from '@/stores/sites'
import { normalizeUrl } from '@/utils/url'
import { findDuplicate, preflightOf, metaGuardrailOf, draftFromMeta, buildSiteFromDraft } from '@/utils/siteDraft'

const META_TIMEOUT_MS = 8000

/** 抓元数据：超时 / 非 2xx / 网络异常都当作「抓取失败」，由护栏决定回落弹窗 */
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
 * @returns {Promise<{ok: true, site: object} | {ok: false, reason: string, message: string}>}
 */
export async function autoAddSite({ url }) {
  const sitesStore = useSitesStore()
  const normalized = normalizeUrl(url)

  const blocked = preflightOf({
    url: normalized,
    duplicate: findDuplicate(sitesStore.sites, normalized),
  })
  if (blocked) return { ok: false, ...blocked }

  const meta = await fetchMeta(normalized)
  const guard = metaGuardrailOf({ meta })
  if (guard) return { ok: false, ...guard }

  const { site } = buildSiteFromDraft(draftFromMeta(meta))
  const created = sitesStore.addSite(site)
  // addSite 恒返回带 id 的新建对象（Task 3 契约），故无需 !created 兜底分支；
  // 早先版本曾在此复用 'fetch-failed'，与护栏③「抓取失败」撞码，已删除（见 Ruling 5）。
  return { ok: true, site: created }
}
```

> **注意：** `src/utils/url` 与 `src/utils/siteDraft` 都要用 `@/` 别名导入（本文件是 Vite 侧代码，不是 `tools/console` 下的纯 node 测试，不受「只能相对导入」的限制）。

- [ ] **Step 2: 构建验证（确认无未使用导入）**

```powershell
cd 'c:\work\solo work\new\nav-v2' ; npm run build
```
预期：构建成功。

- [ ] **Step 3: 提交**

```powershell
cd 'c:\work\solo work\new\nav-v2' ; git add src/services/autoAdd.js ; git commit -m "feat: 新增网址自动添加服务（含四道护栏）"
```

---

## Task 6: 新增预览卡片组件

**Files:**
- Create: `nav-v2/src/components/AddSitePreviewCard.vue`

- [ ] **Step 1: 写组件**

```vue
<template>
  <Teleport to="body">
    <div class="preview-overlay" @click.self="close">
      <div class="preview-card" @mouseenter="paused = true" @mouseleave="paused = false">
        <template v-if="state.phase === 'loading'">
          <div class="preview-loading">
            <span class="preview-spinner"></span>
            <div class="preview-loading-text">
              <strong>正在识别并添加…</strong>
              <span class="preview-url">{{ state.url }}</span>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="preview-head">
            <span class="preview-ok">已自动添加</span>
            <span class="preview-countdown">
              {{ paused || editing ? '已暂停，不会自动关闭' : `${countdown} 秒后自动关闭` }}
            </span>
          </div>

          <!-- 只读复用站点卡片：看到的就是入库后真实的样子 -->
          <SiteCard :site="state.site" is-read-only />

          <div v-if="!state.site.categoryId" class="preview-note">
            分类未识别。可点「编辑」补充，或稍后在站点管理里调整。
          </div>

          <div class="preview-actions">
            <button type="button" class="btn btn-cancel" @click="undo">撤销添加</button>
            <button type="button" class="btn btn-cancel" @click="editing = true">编辑</button>
            <button type="button" class="btn btn-primary" @click="close">完成</button>
          </div>
        </template>
      </div>

      <EditSiteModal v-if="editing" :site="state.site"
                     @close="editing = false" @saved="onSaved" />
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch, onUnmounted } from 'vue'
import SiteCard from '@/components/SiteCard.vue'
import EditSiteModal from '@/components/EditSiteModal.vue'
import { useSitesStore } from '@/stores/sites'

const props = defineProps({
  // { phase: 'loading' | 'ok', url: string, site?: object }
  // 失败态不渲染本组件（由 App 直接退回弹窗），故这里不处理 error
  state: { type: Object, required: true }
})
const emit = defineEmits(['close'])

const sitesStore = useSitesStore()
const editing = ref(false)
const paused = ref(false)
const countdown = ref(6)
let timer = null

function stopTimer() {
  if (timer) { clearInterval(timer); timer = null }
}

function startTimer() {
  stopTimer()
  countdown.value = 6
  timer = setInterval(() => {
    // 悬停或正在编辑时不倒计时：用户显然在处理这张卡片
    if (paused.value || editing.value) return
    countdown.value -= 1
    if (countdown.value <= 0) { stopTimer(); emit('close') }
  }, 1000)
}

// 只在成功态计时；loading 态没有可关闭的内容
watch(() => [props.state.phase, props.state.site?.id], () => {
  if (props.state.phase === 'ok') startTimer()
  else stopTimer()
}, { immediate: true })

/** 编辑中不允许被遮罩 / Esc 关掉，否则用户正在填的表单会凭空消失 */
function close() {
  if (!editing.value) emit('close')
}

/**
 * 保存编辑后关闭卡片。EditSiteModal 是先 emit('saved') 再 emit('close')，
 * 走到这里时 editing 仍为 true，若复用 close() 会被编辑守卫拦下、卡片不关；
 * 故这里显式清掉 editing 再关闭。
 */
function onSaved() {
  editing.value = false
  emit('close')
}

function onKey(e) {
  if (e.key === 'Escape') close()
}
window.addEventListener('keydown', onKey)

onUnmounted(() => {
  stopTimer()
  window.removeEventListener('keydown', onKey)
})

/** 撤销：把刚入库的这条彻底摘掉（不进回收站），当没发生过 */
function undo() {
  if (props.state.site) sitesStore.undoAdd(props.state.site.id)
  emit('close')
}
</script>

<style scoped>
.preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 240;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(2px);
}

.preview-card {
  width: min(420px, 100%);
  max-height: 90vh;
  overflow-y: auto;
  padding: 18px;
  border-radius: 14px;
  background: var(--bg-white, #fff);
  border: 1px solid var(--border, #e2e8f0);
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.28);
}

.preview-loading {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 2px;
}

.preview-spinner {
  width: 22px;
  height: 22px;
  flex: none;
  border: 2px solid var(--border, #e2e8f0);
  border-top-color: var(--accent, #2563eb);
  border-radius: 50%;
  animation: preview-spin 0.8s linear infinite;
}

@keyframes preview-spin { to { transform: rotate(360deg); } }

.preview-loading-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.preview-url {
  font-size: 12px;
  color: var(--text-muted, #64748b);
  word-break: break-all;
}

.preview-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

.preview-ok {
  font-size: 14px;
  font-weight: 600;
  color: var(--accent, #2563eb);
}

.preview-countdown {
  font-size: 12px;
  color: var(--text-muted, #64748b);
}

.preview-note {
  margin-top: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: #92400e;
  background: #fef3c7;
}

.preview-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}

/* 全局样式表 src/styles/main.css 只提供 CSS 变量，并未定义 `.btn` 系类；
   它们只存在于各弹窗组件自己的 scoped 样式里，故本组件必须自带这几条
   （取值对齐 AddSiteModal.vue）。 */
.btn {
  padding: 8px 20px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all .15s ease;
}
.btn-cancel { background: var(--border-light); color: var(--text-secondary); }
.btn-cancel:hover { background: var(--border); }
.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover { filter: brightness(1.1); }
</style>
```

- [ ] **Step 2: 构建验证**

```powershell
cd 'c:\work\solo work\new\nav-v2' ; npm run build
```
预期：构建成功。

- [ ] **Step 3: 提交**

```powershell
cd 'c:\work\solo work\new\nav-v2' ; git add src/components/AddSitePreviewCard.vue ; git commit -m "feat: 新增自动添加预览卡片（可撤销/编辑/倒计时关闭）"
```

---

## Task 7: App 入口分叉 + 挂载预览卡片

**Files:**
- Modify: `nav-v2/src/App.vue`

- [ ] **Step 1: 模板挂载预览卡片与提示语**

把第 56 行

```html
    <AddSiteModal v-if="showAddModal" :prefill-url="addPrefillUrl" @close="closeAddSite" />
```

改为

```html
    <AddSiteModal v-if="showAddModal" :prefill-url="addPrefillUrl" :notice="addNotice" @close="closeAddSite" />

    <!-- 自动添加的预览卡片：只在成功/进行中渲染，失败直接退回上面的弹窗 -->
    <AddSitePreviewCard v-if="autoAddState" :state="autoAddState" @close="closeAutoAddCard" />
```

- [ ] **Step 2: 脚本导入**

把

```js
import AddSiteModal from '@/components/AddSiteModal.vue'
```

改为

```js
import AddSiteModal from '@/components/AddSiteModal.vue'
import AddSitePreviewCard from '@/components/AddSitePreviewCard.vue'
import { autoAddSite } from '@/services/autoAdd'
```

- [ ] **Step 3: 入口分叉**

把

```js
const showAddModal = ref(false)
// 搜索框里输入的网址：打开弹窗时带过去预填；从右上角按钮进来则为空
const addPrefillUrl = ref('')

function openAddSite(payload) {
  addPrefillUrl.value = payload?.url || ''
  showAddModal.value = true
}

// 关掉就清空预填，否则下次从按钮打开还会带着上一次的网址
function closeAddSite() {
  showAddModal.value = false
  addPrefillUrl.value = ''
}
```

替换为

```js
const showAddModal = ref(false)
// 搜索框里输入的网址：打开弹窗时带过去预填；从右上角按钮进来则为空
const addPrefillUrl = ref('')
// 自动添加被护栏拦下时，带进弹窗的原因提示
const addNotice = ref('')

// 自动添加进行中/成功的状态；为 null 表示没有卡片
const autoAddState = ref(null)
// 连续触发时丢弃过期结果，避免旧请求把新卡片覆盖回去
let autoAddSeq = 0

function openAddSite(payload) {
  const url = payload?.url || ''
  // 带网址且开关为开 → 走自动添加；工具栏「+」（无网址）与关掉开关时，行为与从前完全一致
  if (url && preferencesStore.autoAddOnUrl) {
    runAutoAdd(url)
    return
  }
  addPrefillUrl.value = url
  showAddModal.value = true
}

async function runAutoAdd(url) {
  const seq = ++autoAddSeq
  autoAddState.value = { phase: 'loading', url }

  const res = await autoAddSite({ url })
  if (seq !== autoAddSeq) return

  if (res.ok) {
    autoAddState.value = { phase: 'ok', url, site: res.site }
    return
  }
  // 护栏拦下：不留半截卡片，带原因退回弹窗让用户自己确认
  autoAddState.value = null
  addPrefillUrl.value = url
  addNotice.value = res.message
  showAddModal.value = true
}

function closeAutoAddCard() {
  autoAddState.value = null
}

// 关掉就清空预填与提示，否则下次从按钮打开还会带着上一次的内容
function closeAddSite() {
  showAddModal.value = false
  addPrefillUrl.value = ''
  addNotice.value = ''
}
```

- [ ] **Step 4: 构建验证**

```powershell
cd 'c:\work\solo work\new\nav-v2' ; npm run build
```
预期：构建成功（`preferencesStore` 已在 App.vue 注入，无需新增导入）。

- [ ] **Step 5: 提交**

```powershell
cd 'c:\work\solo work\new\nav-v2' ; git add src/App.vue ; git commit -m "feat: 搜索栏网址默认自动添加并出预览卡片，失败回落弹窗"
```

---

## Task 8: 管理后台新增「偏好设置」Tab

**Files:**
- Create: `nav-v2/src/components/admin/AdminPreferences.vue`
- Modify: `nav-v2/src/views/AdminView.vue`

- [ ] **Step 1: 新增 `AdminPreferences.vue`**

```vue
<template>
  <div class="admin-section">
    <div class="admin-section-header">
      <h2>偏好设置</h2>
      <span class="admin-cloud-version">本机生效，不同步到云端</span>
    </div>

    <div class="pref-list">
      <label class="pref-row">
        <div class="pref-text">
          <span class="pref-title">网址自动添加</span>
          <span class="pref-desc">
            在站内搜索框粘贴网址时，跳过确认弹窗，直接识别并入库，随后弹出预览卡片（可撤销、可编辑）。
            网址不像网址、该域名已收录、抓取失败或站名识别不出来时，仍会退回弹窗请你确认。
          </span>
        </div>
        <input type="checkbox" class="pref-switch"
               :checked="preferencesStore.autoAddOnUrl"
               @change="preferencesStore.setAutoAdd($event.target.checked)">
      </label>
    </div>
  </div>
</template>

<script setup>
import { usePreferencesStore } from '@/stores/preferences'

const preferencesStore = usePreferencesStore()
</script>

<style scoped>
/* 区块外壳必须自带一份：这些类名在本项目里都是各组件 scoped 定义的，
   父级 AdminView.vue 的 scoped 样式只能命中子组件根节点，命中不了 header、
   标题 h2 与版本号，不自带就会出现「标题栏掉样式」，与兄弟面板不一致。
   取值对齐 AdminInsights.vue。 */
.admin-section { padding: 0 32px 32px; }

.admin-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

/* h2 也必须自带：全局样式 src/styles/main.css 只做 `* { margin:0; padding:0 }` 重置，
   未定义 h2 的字号/字重，缺失会落回浏览器默认（≈1.5em/bold），与兄弟面板的 16px/600 不一致。 */
.admin-section-header h2 { font-size: 16px; font-weight: 600; }

.admin-cloud-version { font-size: 12px; color: var(--accent); font-weight: 600; }

.pref-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pref-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 16px 18px;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 10px;
  background: var(--bg-white, #fff);
  cursor: pointer;
}

.pref-text {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.pref-title {
  font-size: 14px;
  font-weight: 600;
}

.pref-desc {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted, #64748b);
}

.pref-switch {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 2px;
  accent-color: var(--accent, #2563eb);
  cursor: pointer;
}
</style>
```

- [ ] **Step 2: 在 `AdminView.vue` 注册 Tab**

把

```js
  { id: 'overview', label: '概览' },
```

改为

```js
  { id: 'overview', label: '概览' },
  { id: 'preferences', label: '偏好设置' },
```

- [ ] **Step 3: 加入 import**

在 `AdminView.vue` 现有的 admin 组件 import 区（与 `AdminInsights` / `AdminNotifications` 等相邻处）新增一行：

```js
import AdminPreferences from '@/components/admin/AdminPreferences.vue'
```

- [ ] **Step 4: 加面板挂载（懒挂载，紧随概览之后）**

把

```html
          <AdminSitesPanel v-else-if="activeTab === 'sites'" :admin-key="adminKey" />
```

改为

```html
          <AdminPreferences v-else-if="activeTab === 'preferences'" />

          <AdminSitesPanel v-else-if="activeTab === 'sites'" :admin-key="adminKey" />
```

- [ ] **Step 5: 构建验证**

```powershell
cd 'c:\work\solo work\new\nav-v2' ; npm run build
```
预期：构建成功。

- [ ] **Step 6: 提交**

```powershell
cd 'c:\work\solo work\new\nav-v2' ; git add src/components/admin/AdminPreferences.vue src/views/AdminView.vue ; git commit -m "feat: 管理后台新增偏好设置 Tab 与网址自动添加开关"
```

---

## Task 9: 全量验证

**Files:** 无（只跑命令）

- [ ] **Step 1: 全量控制台测试**

```powershell
cd 'c:\work\solo work\new\nav-v2' ; npm run console:test:all
```
预期：全部 `✅`，退出码 0。若 `test-auto-add.mjs` 报 `Cannot find package '@/...`，说明 `siteDraft.js` 里混入了 `@/` 导入，回去改成相对路径。

- [ ] **Step 2: 生产构建**

```powershell
cd 'c:\work\solo work\new\nav-v2' ; npm run build
```
预期：构建成功，产物无警告阻塞。

- [ ] **Step 3: 手工验收（逐条对照规格 §4）**

```powershell
cd 'c:\work\solo work\new\nav-v2' ; npm run dev
```

按顺序核验：

1. 在搜索框输入一个未收录网址并点「添加」→ **不出现弹窗**，先出 loading 卡片，随后变成成功卡片，站点已在列表里。
2. 卡片上点「撤销添加」→ 站点从列表消失，**回收站里没有它**。
3. 再触发一次 → 点「编辑」→ 修改名称保存 → 卡片关闭，列表中是修改后的名称。
4. 再触发一次 → 不操作，6 秒后卡片自动关闭，站点保留；鼠标悬在卡片上时倒计时暂停。
5. 输入一个**已收录**域名 → 退回「添加站点」弹窗，顶部有黄色提示条说明已收录，网址已预填。
6. 输入一个会被抓取失败的地址（如 `https://this-domain-should-not-exist-xyz.com`）→ 退回弹窗，顶部提示抓取失败。
7. 点右上角工具栏「+」→ **直接打开原弹窗**，行为与改动前一致。
8. 管理后台 → 偏好设置 → 关闭「网址自动添加」→ 回首页在搜索框添加网址 → **直接打开预填弹窗**（不再自动入库）。
9. 刷新页面（第 8 步的开关状态保持为关）→ 确认开关**没有**被重置为开（验证持久化白名单生效）。
10. 打开浏览器新标签/重新进入 → 后台修改开关后，前台行为随之变化。

- [ ] **Step 4: 收尾提交（若手工验收中有修补）**

```powershell
cd 'c:\work\solo work\new\nav-v2' ; git status --short
```
预期：干净（无待提交改动）。若有修补，`git add` 对应文件后 `git commit -m "fix: 自动添加预览卡片验收修补"`。

---

## 自审

**规格覆盖检查**（对照 `docs/superpowers/specs/2026-10-08-auto-add-preview-card-design.md`）：

| 规格条目 | 落在哪个 Task |
| --- | --- |
| §4.1 入口分叉（无网址走原路、有网址且开关开走管道、失败带提示回落） | Task 2 Step 1–2（notice）、Task 7 |
| §4.2 `autoAdd.js` 契约与四道护栏（invalid-url/duplicate/fetch-failed/low-confidence） | Task 1（判定纯函数）、Task 5（编排） |
| §4.2 抽出 `siteDraft.js`，保留三条既有规则 | Task 1 |
| §4.3 `addSite` 返回值 + `undoAdd`（不进回收站） | Task 3 |
| §4.4 预览卡片三态、撤销/编辑/访问/完成、6s 倒计时悬停暂停、Esc、分类未识别提示 | Task 6 |
| §4.5 偏好开关默认开 + 白名单 + 后台 Tab | Task 4、Task 8 |
| §4.7 `test-auto-add.mjs` + `console:test:all` | Task 1 Step 1/4/5、Task 9 |
| 边界：不清空搜索框输入、重复触发后者覆盖前者、开关仅本机 | Task 7（分叉不触碰搜索框状态；`autoAddSeq` 覆盖旧卡片） |
| 边界：不做批量、不做多网址排队、不做后台代其他设备开启 | 全计划未引入对应逻辑 |

**占位符扫描：** 已逐 Task 检查，无 TBD / TODO / 占位导入 / 省略号代码；所有步骤均给出可整段粘贴的代码。

**类型一致性：**
- `autoAddSite({ url })` 返回 `{ ok: true, site }` 或 `{ ok: false, reason, message }` —— 与 Task 7 `runAutoAdd` 的消费方式一致（只读 `res.ok` / `res.site` / `res.message`）。
- `AUTO_ADD_REASON` 四个取值在 Task 1 定义，Task 5 未新增其它 reason 字面量（入库失败兜底分支已按 Ruling 5 删除，成功支直接返回 `{ ok: true, site: created }`）。
- `buildSiteFromDraft` 入参 `{ form, faviconUrl, faviconHost }` —— Task 2 传的是 `form` / `faviconUrl.value` / `faviconHost.value`，Task 5 传的是 `draftFromMeta()?.form/faviconUrl/faviconHost`，字段名一致。
- `AddSitePreviewCard` 的 props `state` 形状 `{ phase, url, site? }` —— Task 7 三处赋值全部符合。
- `preferences.autoAddOnUrl` / `setAutoAdd` —— Task 4 定义，Task 7 与 Task 8 消费。
- `sitesStore.undoAdd(id)` —— Task 3 定义并导出，Task 6 消费。
