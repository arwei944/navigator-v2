# 搜索栏一键添加 + 自动分类（无弹窗）— 设计规格

- 日期：2026-10-08
- 需求原文：「我需要可以直接通过在站内搜索栏输入站点可以实现一键添加网站并且自动分类，如果没有合适的分类则自动创建一个分类，不需要弹窗，直接以卡片形式添加」
- 补充口径（用户确认）：
  1. 自动分类依据 → **智能根据页面简介判断**
  2. 抓取失败 / 站名不可靠 → **照常添加，用域名兜底命名**
  3. 成功反馈 → **底部 Toast（带撤销）+ 新卡片高亮定位，两者都要**
  4. 定位方式 → **自动切到该分类并高亮**
  5. 自动新建分类的归属域 → **智能判断（按主题归入最合适的域）**
- 状态：**待用户批准（方案 A）**
- 上游依赖：本设计**扩展**已实现的《搜索栏自动执行添加 + 预览卡片 + 后台开关》规格（同目录 `2026-10-08-auto-add-preview-card-design.md`），不推翻其管道与开关设计。

## 1. 问题与目标

上一版已实现：「搜索栏粘网址 → 自动抓取元数据 → 入库 → 弹出一张居中预览卡片」，失败时回落 `AddSiteModal`。这解决了「跳过表单确认」，但没解决本次三点诉求：

1. 预览卡片是 `Teleport` 到 `body` 的居中浮层 + 遮罩，**形态上就是弹窗**；抓取失败还会直接弹出 `AddSiteModal`。
2. 分类未识别时**只是留空 + 提示条**，不会自动建分类。
3. 抓取失败 / 站名低置信时**不写入**，退回人工。

目标：

1. 搜索栏输入网址后，站点**直接以卡片形式落在列表里**，全程不出现任何浮层/弹窗。
2. 自动分类；本地表里**没有合适分类时自动新建一个**，并智能归入合适的域。
3. 抓取失败也**照常添加**，用域名兜底命名。
4. 成功后给出**可撤销的底部轻提示**，并**自动切到该分类、滚动定位、高亮**新卡片。
5. 关闭 `autoAddOnUrl` 开关时，行为与今天完全一致（回到弹窗路径）。

## 2. 现状勘查结论

| 关注点 | 现状 |
| --- | --- |
| 触发点 | `src/components/SiteSearchBar.vue#requestAdd(url)` → `emit('add-site', { url })` |
| 事件链路 | `MainToolbar.vue` 把 `add-site` 转成 `open-add` → `App.vue#openAddSite(payload)` |
| 自动管道 | `src/services/autoAdd.js#autoAddSite({ url })`：`preflightOf` → `fetchMeta`（8s 超时）→ `metaGuardrailOf` → `buildSiteFromDraft` → `sitesStore.addSite` |
| 成功出口 | `App.vue` 渲染 `AddSitePreviewCard`（`Teleport` 到 `body` 的居中浮层 + 遮罩）——**本次要移除的弹窗** |
| 失败出口 | `App.vue`：`addPrefillUrl` + `addNotice` + `showAddModal = true`——**本次要移除的弹窗** |
| 分类表 | `shared/categories.mjs#CATEGORY_GROUPS`：4 域 30 分类（ai 8 / crypto 15 / tools 4 / basics 3）；`stores/categories.js` 持运行时副本 |
| 分类写入口 | `stores/categories.js#addCategory(groupId, {id,label,dotColor})`：校验 `id` 非空、`^[a-z0-9][a-z0-9_-]*$`、不与任何分类 id / 域 id 重名、目标域存在；成功 `push` + `bump()` |
| id 派生范式 | `components/admin/AdminCategoryManager.vue#onDraftLabel`：`pinyin-pro` `pattern:'first'` + `toneType:'none'` + `separator:''` → 去非 `[a-z0-9]` → 冲突则 `base + n++` 自增 |
| 分类持久化 | 分类表是**本地草稿**：`categoriesStore.dirty` 为真时需管理员在后台 `publishToCloud()` 才同步到其他设备 |
| 推理引擎 | `shared/site-infer.mjs#inferCategory` → `{ categoryId, score, confidence, reasons, runnerUp }`；`confidence` = `score>=9` high / `score-runnerUp>=2` medium / 其余 low |
| 用途词表 | `shared/purposes.mjs#PURPOSE_TAGS` 12 项；`BY_CATEGORY` 提供「分类 → 基线用途」映射 |
| 卡片渲染 | `CardsContainer.vue#displaySites` → `SiteCard`；**当前无高亮、无 `scrollIntoView` 定位逻辑** |
| 全局提示 | 项目内**没有**通用 Toast 组件（已确认，全仓 `[Tt]oast` 无匹配） |
| 路由即事实源 | `App.vue`：范围（scope）由 `route.name` 派生；分类 = `route.query.c`；用途 = `route.query.p`；搜索 = `route.query.q` |
| 偏好开关 | `stores/preferences.js#autoAddOnUrl`（默认 `true`）已在 `versionedPersist` 白名单内，本次沿用不改 |

**结论**：写入点仍是 `stores/sites.js#addSite`，分类写入口是 `categoriesStore.addCategory`；真正的**新增基础设施**只有两块——底部 Toast（store + 宿主组件）与卡片定位/高亮（`highlightSiteId` + `CardsContainer` 滚动）。

## 3. 方案对比

| 方案 | 做法 | 取舍 |
| --- | --- | --- |
| **A（采纳）** | 管道从「回弹窗」改为「回决策」：纯函数产出分类建议 + store 落库；成功即静默入列表，用底部 Toast + 定位高亮反馈 | 卡片直接落在列表里，真正满足「无弹窗」；反馈通道可复用（后续删除/批量操作）。代价是要新建 Toast 与高亮两套基础设施，并**删除** `AddSitePreviewCard` |
| B | 保留预览卡片，只把它缩小成角标/浮标 | 「预览卡片」本质仍是浮层，不满足「不需要弹窗」；且与列表里的正式卡片重复渲染同一站点 |
| C | 只在「分类未识别」时新建分类，其余保持现状 | 未解决弹窗问题；成功走卡片、失败走弹窗，两条出口行为不一致，用户认知分裂 |

## 4. 设计（方案 A）

### 4.1 入口与出口总览

入口**不变**：`SiteSearchBar` 回车 → `App.openAddSite({ url })` → `preferencesStore.autoAddOnUrl` 为真 → `runAutoAdd(url)`；开关为假或工具栏「+」→ 仍是弹窗路径。

出口**改写**：`App.vue` 删除 `autoAddState` / `AddSitePreviewCard` 分支，`runAutoAdd` 改为「按结果分派」：

| `autoAddSite` 结果 | 反馈 | 是否开弹窗 |
| --- | --- | --- |
| `ok: true` | 底部 Toast「已添加…」+ 自动切分类 + 定位高亮 | 否 |
| `reason: 'duplicate'` | Toast「已收录」+ 定位高亮**已有**卡片 | 否 |
| `reason: 'invalid-url'` | Toast 错误提示「没能识别出有效网址」 | 否 |
| `reason: 'write-failed'` | Toast 错误提示 | 否 |

自动路径**任何分支都不再打开 `AddSiteModal`**。手工路径（工具栏「+」、开关关闭）完全不变，`AddSiteModal` 组件与其分类下拉行为不动。

### 4.2 管道改造（`src/services/autoAdd.js`）

新返回契约：

```js
{ ok: true,  site, category: { id, label, created } }
{ ok: false, reason: 'invalid-url' | 'duplicate' | 'write-failed', message, existing? }
```

执行顺序：

1. `normalizeUrl(url)` → `looksLikeUrl` 判定；不成立 → `reason: 'invalid-url'`（Toast 报错）。
2. `findDuplicate(sitesStore.sites, url)` 命中 → `reason: 'duplicate'`，并把命中站点带回：`existing: { id, name, categoryId }`（用于定位已有卡片）。去重判据仍是 `hostOf(s.url) === domainOf(url)`，与 `AddSiteModal#submit()` 同一把尺子。
   - 配套：`siteDraft.js#preflightOf` 简化为只判网址合法性（去掉其 `duplicate` 分支），因为重复分支现在需要带回站点对象，由 `autoAdd.js` 直接调 `findDuplicate` 拿。
3. `fetchMeta`（8s 超时）；失败 **不再是阻断条件**，`meta = null` 继续往下走。
4. **分类决策**（核心新增，见 4.3）→ 得到 `{ categoryId, label, created }`。
5. 组装草稿：新增纯函数 `fallbackDraftFromMeta({ url, meta })`（4.4）。
6. `sitesStore.addSite(site)` → `{ ok: true, site, category }`。

**退役项**：`metaGuardrailOf` 及其 `FETCH_FAILED` / `LOW_CONFIDENCE` 两个原因码在自动路径上不再需要（抓不到 / 名字不可信已改为「域名兜底照常添加」），一并从 `src/utils/siteDraft.js` 删除，`AUTO_ADD_REASON` 只保留 `INVALID_URL` / `DUPLICATE`。

### 4.3 自动分类（新增 `shared/auto-category.mjs` + `autoAdd.js` 编排）

#### 4.3.1 纯函数契约

```js
suggestCategory({ name, desc, domain, path, purposes, existing })
// existing: [{ id, label, groupId }]   ← categoriesStore 快照，保证纯函数可测
// →
{ kind: 'use',    categoryId, label }
{ kind: 'create', id, label, groupId, dotColor }
```

模块**不 import Vue / Pinia**，只依赖 `shared/categories.mjs`、`shared/purposes.mjs` 的常量与 `pinyin-pro`（npm 依赖，node 端可直接 `import`），因此可在 `tools/console/` 下用纯 node 直接测。

#### 4.3.2 决策表（自上而下，命中即止）

| 顺序 | 条件 | 结果 |
| --- | --- | --- |
| 1 | `meta.categoryId` 存在于本地表，且 `meta.confidence.categoryId !== 'low'` | `use` 该分类 |
| 2 | 主题表命中主题 T，且本地**已有同义分类**（label 归一后相等） | `use` 那个分类 |
| 3 | 主题表命中主题 T，本地无同义分类 | `create` T，归入 T 声明的域 |
| 4 | `purposes[0]` 存在，且本地已有同用途名的分类 | `use` 那个分类 |
| 5 | `purposes[0]` 存在，本地无 | `create`（用途名），域按 `BY_CATEGORY` 反查 |
| 6 | 以上皆无 | `use`／`create`「其他」，归入 `tools` 域 |

**label 归一**（用于「同义」判定）：小写 → 去所有空白 → 去 `/-_·、，,。.()（）[]【】+&`。主题表里若想复用某个内置分类，其 `label` **照抄内置文案**即可（如 `设计与创意`、`云服务器/VPS`），归一后必然相等。

**主题表 `THEMES`**（示例，落地时补全；每项 `{ label, domain, keywords }`，`keywords` 为双语正则）：

| label | domain | 触发关键词（示例） |
| --- | --- | --- |
| 设计与创意 | ai | 绘画 / 画图 / 作图 / text-to-image / midjourney / stable diffusion / flux |
| 编程与开发 | ai | 代码补全 / 编程助手 / copilot / cursor / ide |
| 写作与内容 | ai | 写作 / 文案 / 润色 / copywriting / writing |
| AI 视频 | ai | 文生视频 / 视频生成 / text-to-video / sora / runway / 可灵 |
| AI 音乐 | ai | 音乐生成 / 作曲 / text-to-music / suno / udio |
| AI 语音 | ai | 语音合成 / 配音 / TTS / 语音克隆 / elevenlabs |
| AI 搜索 | ai | AI 搜索 / 问答引擎 / perplexity / 联网问答 |
| AI 智能体 | ai | Agent / 智能体 / 多智能体 / workflow automation |
| 云服务器/VPS | basics | 云服务器 / VPS / 主机 / 云主机 |
| 代理/VPN | basics | 代理 / VPN / 机场 / 科学上网 |

前 3 行（设计与创意 / 编程与开发 / 写作与内容）刻意与内置分类同名 —— 命中即走第 2 条**复用**，不会产生重复分类。真正的「新建」只会发生在内置表覆盖不到的空白主题上（上表后 7 行）。

#### 4.3.3 id 与配色

- **id 派生**沿用 `AdminCategoryManager#onDraftLabel` 范式：`pinyin(label, { pattern:'first', toneType:'none', separator:'' })` → `toLowerCase()` → `replace(/[^a-z0-9]/g,'')` → 空则 `'cat'`；再对「所有分类 id + 所有域 id」做冲突检测，冲突则 `base + n++`（`n` 从 2 起）。
- **dotColor**：按「域内已有分类数 % 调色板长度」从统一调色板取值，避免新分类与相邻分类撞色：
  `['#3b82f6','#a855f7','#ec4899','#06b6d4','#22c55e','#f97316','#ef4444','#8b5cf6','#f59e0b','#0d9488']`

#### 4.3.4 落库编排（`autoAdd.js` 内）

```js
const categoriesStore = useCategoriesStore()
const existing = categoriesStore.categories.map(c => ({
  id: c.id, label: c.label, groupId: categoriesStore.getGroupByCategory(c.id)?.id,
}))
const plan = suggestCategory({ ...meta, purposes, existing })

let categoryId = '', label = '', created = false
if (plan.kind === 'create') {
  const r = categoriesStore.addCategory(plan.groupId, { id: plan.id, label: plan.label, dotColor: plan.dotColor })
  if (r.ok) { categoryId = r.id; label = plan.label; created = true }
  else { categoryId = ''; label = '' }   // 建失败 → 保底不阻断添加，站点按未分类入库
} else {
  categoryId = plan.categoryId
  label = categoriesStore.getCategoryLabel(categoryId)
}
```

`categoriesStore.addCategory` 自带校验与 `bump()`，新建后 `dirty` 变真 → 后台「分类管理」会显示未发布提示（**既有行为，直接复用，本设计不做自动发布**）。

### 4.4 域名兜底草稿（`src/utils/siteDraft.js` 新增纯函数）

```js
fallbackDraftFromMeta({ url, meta })
// name  = meta?.name || rawHostOf(url)        ← 抓不到 / 低置信时用域名兜底命名
// desc  = meta?.desc || ''
// color = meta?.color || colorFromHost(domain) ← 由域名稳定派生，保证同域同色
// faviconUrl / faviconHost 沿用 meta 原值（iconUrl 的 faviconHost===domain 门槛不变）
```

仍复用 `buildSiteFromDraft` 组装，三条既有规则（`url` 存去协议主机名、`initial` 取首字大写、`iconUrl` 仅在 `faviconHost === domain` 时写入）**一字不改**。

### 4.5 反馈一：底部 Toast

**新增 `src/stores/toast.js`**：

```js
items = ref([])                                  // [{ id, message, tone, actionLabel, onAction, duration, paused }]
push({ message, tone='ok'|'info'|'error', actionLabel, onAction, duration }) → id
dismiss(id) / clear()
```

- 同时最多保留 3 条，超出丢弃最旧。
- 成功 `tone:'ok'` 停留 5s；`tone:'error'` 停留 8s；悬停暂停倒计时。
- 手动关闭按钮，最长文案不换行截断（超出省略 + `title`）。

**新增 `src/components/ToastHost.vue`**：`<Teleport to="body">`，**底部居中**、纵向堆叠，`z-index` 高于现有弹窗层级。挂载点在 `src/App.vue` 主壳内（与 `AddSiteModal` 同级）。`prefers-reduced-motion` 下取消进出场动画。

**文案与动作**：

| 场景 | 文案 | 动作 |
| --- | --- | --- |
| 成功（未建分类） | 已添加「{name}」到「{categoryLabel}」 | 撤销 |
| 成功（新建分类） | 已添加「{name}」，并新建分类「{label}」 | 撤销 |
| 重复 | 「{name}」已收录 | 查看（等价于定位高亮） |
| 无效网址 / 写入失败 | 沿用 `preflightOf` 的 `message` | 无 |

**撤销语义**：`sitesStore.undoAdd(id)`；若本次同时**新建了分类**且该分类**现已无任何站点引用**，一并 `categoriesStore.removeCategory(createdId)` 回收空分类（`removeCategory` 的「域内至少保留一个分类」护栏原样生效，失败则静默跳过）。撤销后再弹一条 2s 轻提示「已撤销」。

### 4.6 反馈二：定位 + 高亮

- **`stores/sites.js`**：新增 `highlightSiteId = ref('')`、`highlightSite(id)`（赋值 + 2.5s 后自清，重复调用重置计时）、`clearHighlight()`；加入 store 的 return 列表。
- **`components/SiteCard.vue`**：根节点加 `:data-site-id="site.id"`；`isHighlighted = computed(() => sitesStore.highlightSiteId === props.site.id)`，根 class 追加 `card-highlight`；样式为 2.5s 呼吸描边（`outline` + `box-shadow`，取 `--accent`），`prefers-reduced-motion` 下退化为静态描边。
- **`components/CardsContainer.vue`**：`watch(() => sitesStore.highlightSiteId)`，为真时 `await nextTick()` → 容器内按 `[data-site-id="…"]` 查节点 → `el.scrollIntoView({ block: 'center', behavior: 'smooth' })`。
- **`App.vue#locateSite(site)`**（成功后调用，实现「自动切过去并高亮」，**无二次确认**）：
  1. 若 `route.name !== 'Home'`，或 `route.query.c` 与 `site.categoryId` 不一致，或 `route.query.p` / `route.query.q` 非空 → `router.push({ name: 'Home', query: site.categoryId ? { c: site.categoryId } : {} })`（清掉 `p`/`q`，否则新卡片会被筛选条件过滤掉、定位不到）。
  2. `await nextTick()` → `sitesStore.highlightSite(site.id)`。
- **重复分支**：`locateSite(existingSite)` 同理 —— 若已有卡片在别的分类下，也切过去再高亮。

### 4.7 边界与明确不做

- **删除 `src/components/AddSitePreviewCard.vue`**：其职责（展示 / 撤销 / 定位）被「列表卡片 + Toast + 高亮」完整取代，且其形态本身就是需求要消除的弹窗（需在评审时确认）。
- 自动新建的分类是**本地草稿**，需管理员在后台点「发布」才同步到其他设备。**不做自动发布**——无审核地改全局分类表风险过高。这是明确取舍。
- **不新增后台开关**（如「自动新建分类」）：需求是「没有合适分类就自动建」，不加条件开关；若后续要，另开单。
- 抓取失败 / 站名为空 / 低置信 → 域名兜底照常入库（用户已确认）。
- 关掉 `autoAddOnUrl` 开关 → 完全维持旧行为（弹窗），本设计不触碰该分支。
- 工具栏「+」→ 仍是弹窗路径，`AddSiteModal` 及其分类选择逻辑不动。
- 不改 `api/*`、不改 `api/sites-data.json` 站点结构、不新增云端配置字段。
- 连续触发沿用 `autoAddSeq` 丢弃过期结果。
- 撤销只回收「本次新建**且**已空」的分类；已被其他站点引用的分类不动。
- 自动添加成功后**不清空**搜索框已有输入（沿用现状），避免新增跨组件协议。

### 4.8 验证方式

- **新增 `tools/console/test-auto-category.mjs`**（沿用 `tools/console/` 测试风格与退出码约定），覆盖：
  - 决策表 6 条分支各一例；
  - label 归一——「AI 绘画」/「ai绘画」/「AI 绘画 」判定为同一分类，不重复新建；
  - 内置同名主题（`设计与创意`）走**复用**而非新建；
  - id 冲突自增（已存在 `aihuihua` 时派生 `aihuihua2`）；
  - id 不与域 id 撞名；
  - 「其他」兜底只建一次、后续复用。
- **改写 `tools/console/test-auto-add.mjs`**：新返回契约（成功带 `category`；`duplicate` 带 `existing`；`invalid-url`）；`fallbackDraftFromMeta` 在 `meta = null` 时 `name === rawHostOf(url)`；移除 `fetch-failed` / `low-confidence` 两例。
- **手动验证**：
  - 粘一个内置表覆盖不到的站（如 AI 音乐）→ 直接入列表 → 底部 Toast「已添加…并新建分类「AI 音乐」」→ 自动切到该分类并滚动高亮 → 点撤销 → 卡片消失、空分类被回收。
  - 粘已收录域名 → Toast「已收录」→ 自动切到该卡片并高亮。
  - 粘一个抓取失败的域名 → 仍入库，名字为域名。
  - 关掉开关 → 回到弹窗路径。
  - 后台「分类管理」的未发布提示正常出现。
- `npm run build` 与 `npm run console:test:all` 全绿。

## 5. 受影响文件清单

新增：

- `docs/superpowers/specs/2026-10-08-search-one-click-add-auto-category-design.md`（本文件）
- `shared/auto-category.mjs`（主题表 + 决策表 + label 归一 + id 派生 + 配色）
- `src/stores/toast.js`
- `src/components/ToastHost.vue`
- `tools/console/test-auto-category.mjs`

修改：

- `src/services/autoAdd.js`（新返回契约；抓取失败不再阻断；接入分类决策与落库；返回 `category`）
- `src/utils/siteDraft.js`（新增 `fallbackDraftFromMeta`；删除 `metaGuardrailOf` 与 `FETCH_FAILED` / `LOW_CONFIDENCE`）
- `src/App.vue`（移除 `autoAddState` / 预览卡片分支；接入 Toast 分派与 `locateSite`；挂载 `ToastHost`）
- `src/stores/sites.js`（`highlightSiteId` / `highlightSite` / `clearHighlight`）
- `src/components/CardsContainer.vue`（按 `highlightSiteId` 滚动定位）
- `src/components/SiteCard.vue`（`data-site-id` + `card-highlight` 样式）
- `tools/console/test-auto-add.mjs`（跟随新契约改写）

删除：

- `src/components/AddSitePreviewCard.vue`（职责被列表卡片 + Toast + 高亮取代）
