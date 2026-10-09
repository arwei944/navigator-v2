# 站内搜索 + 站外搜索合并为统一搜索框 — 设计规格

- 日期：2026-10-09
- 需求原文：「现在我需要对站内搜索框和站外搜索进行合并」
- 补充口径（用户确认）：
  1. 整体形态 → **单框统一收口**：只留一个搜索框，站内结果与站外出口共用一个下拉
  2. 回车默认行为 → **站内有命中就打开站点，否则站外搜索**
  3. 搜索引擎选择器 → **搜索框内左侧前缀**（沿用 `ExternalSearchBox` 的形态）
- 状态：**已批准并实现（2026-10-09）**
- 上游依赖：与《搜索栏一键添加 + 自动分类（无弹窗）》（同目录 `2026-10-08-search-one-click-add-auto-category-design.md`）**共存**，其 `add-site` 事件链路与自动添加管道**一字不改**。

## 1. 问题与目标

### 1.1 现状

工具栏（`MainToolbar.vue`）里并排摆着两个互不相干的搜索：

| 组件 | 职责 | 形态 |
| --- | --- | --- |
| `SiteSearchBar.vue`（站内） | 搜站点（名称 / 别名 / 描述 / 用途 / 拼音），并把关键词同步到 `sitesStore.searchQuery` 过滤列表 | 一个大输入框 + 建议下拉；下拉底部**仅在无结果时**给一条「用 Google 搜索」外链 |
| `ExternalSearchBox.vue`（站外） | 用 Google / Bing / 百度 / DDG / PPLX 打开新标签页搜索 | 一个带引擎下拉 + 提交按钮的独立表单 |

问题：

1. **两个框抢同一件事**——用户输入「三体」「react hooks」时，第一反应分不清该往哪个框里打。
2. **两套视觉重量**——站内框是「主」（flex 撑开、600px），站外框是「副」（固定窄条），但它们其实同等重要。
3. **站内无结果时的出口是残缺的**——只硬编码了一条 Google 链接，既不跟随用户在设置里选的引擎，也不参与键盘导航（上下键选不到它）。
4. 站外框看不到站内结果，站内框用不了指定引擎，两者信息隔离。

### 1.2 目标

1. **一个框走天下**：输入后同时给出站内站点建议与站外搜索出口，不再需要先想「该用哪个框」。
2. **回车智能路由**：站内有命中 → 打开站点；站内无命中 → 用当前引擎搜站外。用户不需要先选模式。
3. **引擎可见可切**：当前引擎常驻框内左侧，一眼可见、随手可切。
4. **站外出口升为一等公民**：从「无结果才出现的兜底链接」变成下拉里**常驻**的一条，跟随所选引擎，可键盘选中。
5. **既有能力零丢失**：一键添加（粘贴网址 → 直接入库）、命令面板入口、Ctrl+F、上下键导航、结果计数、清除、高亮、别名提示，全部保留。

## 2. 现状勘查结论

| 关注点 | 现状 |
| --- | --- |
| 组件挂载点 | `src/components/MainToolbar.vue`：`<SiteSearchBar class="toolbar-search">` + `<ExternalSearchBox class="toolbar-external">` |
| 站内检索内核 | `src/utils/search.js#rankSites` —— 评分分档 + 拼音 + Fuse 模糊兜底；与 `CommandPalette` 共用 |
| 高亮工具 | `src/utils/search.js#splitHighlight`、`#matchedAlias` |
| 站内搜索副作用 | `SiteSearchBar` 防抖 300ms → `sitesStore.setSearchQuery(q)` → `App.vue` 同步到 `route.query.q` → `sitesStore.filteredSites` 过滤卡片 |
| 一键添加链路 | `SiteSearchBar#requestAdd(url)` → `emit('add-site')` → `MainToolbar` 转 `open-add` → `App.vue#openAddSite` → `autoAddOnUrl` 为真走 `runAutoAdd`，否则弹 `AddSiteModal` |
| 网址识别工具 | `src/utils/url.js#looksLikeUrl`、`#hostOf` |
| 已收录判定 | `SiteSearchBar#collected`：`sitesStore.sites.find(s => hostOf(s.url) === hostOf(q))` |
| 引擎表 | `src/stores/preferences.js#engines`：google/bing/baidu/duckduckgo/perplexity，各带 `url`；`searchEngine` 已在 `versionedPersist` 白名单 |
| 引擎短标签 | `ExternalSearchBox#SHORT_LABELS`：`{ google:'Google', bing:'Bing', baidu:'百度', duckduckgo:'DDG', perplexity:'PPLX' }` |
| 站外搜索方式 | `<form :action="engine.url" method="GET" target="_blank">` + `name="q"` —— 浏览器自动拼 `?q=…`。**新实现需等价复刻此拼接方式**（各引擎路径不同，`duckduckgo.com/` 无 `/search`） |
| 命令面板入口 | `SiteSearchBar#openPalette()`：`document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true}))` |
| 全局 Ctrl+F | `SiteSearchBar#onKeydown`：`document` 级监听，聚焦搜索输入框 |
| 移动端 | `MainToolbar` 在 `max-width:768px` 下 `flex-direction: column`；两个框各自 `width:100%`，合并后更整洁 |
| 其他引用 | 全仓 `grep` 确认：`SiteSearchBar` / `ExternalSearchBox` / `GoogleSearchBar` **只被 `MainToolbar.vue` 引用**（`GoogleSearchBar.vue` 是历史遗留，已无人引用） |

**结论**：合并的物理动作是「二合一 → 落地为一个 `UnifiedSearchBox.vue`」，无外部依赖改动；真正需要设计的是**下拉结构**与**回车路由**两件事。

## 3. 方案对比

| 方案 | 做法 | 取舍 |
| --- | --- | --- |
| **A（采纳）** | 单框统一收口：引擎选择器做框内左侧前缀，输入区仍是站内检索，下拉 = 站内建议（上）+ 常驻站外出口（下）；回车按「站点优先、否则站外」路由 | 彻底消灭「该用哪个框」的犹豫；站外出口升为一等公民。代价是站外搜索也要经过站内检索（会顺带过滤卡片，见 §4.6） |
| B | 视觉拼接：两个输入区贴合并去掉重复描边，拼成一个容器 | 改动最小、风险最低，但本质仍是两块，回车行为仍分裂，不满足「合并」的语义 |
| C | 单框 + Tab 切换「站内 / 站外」模式 | 边界清晰，但把「该用哪个框」的问题换成了「该用哪种模式」，多一步切换动作，未真正减负 |

## 4. 设计（方案 A）

### 4.1 组件形态

新建 `src/components/UnifiedSearchBox.vue`（由 `SiteSearchBar.vue` 改名而来，吸收 `ExternalSearchBox.vue` 的引擎能力），`MainToolbar.vue` 只挂它一个。

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [Google ▾] │ 🔍  搜索站点名称、别名、描述、拼音…  5 个结果 ✕  Ctrl+F  ⌘K │
└──────────────────────────────────────────────────────────────────────────┘
   引擎前缀     图标+输入区                        右侧信息/操作簇
```

- **引擎前缀** `select`：贴左边缘、`align-self: stretch`，浅底（`--border-light`）+ 右侧 1px 分隔线（`--border`），12px/600 次要色，hover 变强调色，右侧 12px caret。短标签沿用 `SHORT_LABELS`，避免 `DuckDuckGo` 撑宽（设置面板内仍是全称）。
- **输入区**：保持现有 `SiteSearchBar` 的一切（图标、`type=search`、防抖同步、placeholder）。
- **右侧簇**：`N 个结果` → 清除按钮 → `Ctrl+F` kbd → `⌘K` 按钮，顺序与行为均不变。
- 组件对外契约不变：`emit('add-site', { url })`。

### 4.2 下拉结构

出现条件不变：`focused && trimmedQuery`。

自上而下：

| # | 行 | 说明 | 是否变化 |
| --- | --- | --- | --- |
| 0 | 无结果提示 `未找到「x」相关站点` | 站内命中为 0 时显示 | 不变 |
| 1 | 站点行 | `rankSites(...)` 结果，favicon / 名称高亮 / 别名 chip / 描述高亮 / 分类 chip / 外链按钮 | 不变 |
| 2 | `添加站点` 行 | 输入像网址时置顶，回车带着网址进一键添加 | 不变 |
| 3 | `已收录` 行 | 域名已收录时置顶，点击定位到已有卡片 | 不变 |
| 4 | 淡入口 `添加一个还没收录的站点` | 有结果且非网址输入时，底部一条淡入口 | 不变 |
| 5 | **站外搜索行（新增，常驻）** | `用 Google 搜索「三体」` + 引擎图标；点击 → 用当前引擎新标签页搜索 | **新增，取代原「仅无结果时出现」的硬编码 Google 链接** |

第 5 行样式：整行可点、`border-top` 分隔，左侧放大镜图标，文案 `用 {引擎短标签} 搜索「{q}」`，hover 变强调色。定位上它是**下拉的固定页脚**，无论站内是否有结果都存在。

### 4.3 键盘导航

`navItems` 在现有基础上**追加一条** `{ kind: 'external' }`（有 query 时恒存在），因此上下键可以一路选到站外出口。

| 键 | 行为 | 变化 |
| --- | --- | --- |
| `↓` / `↑` | 在 `navItems` 内循环 | 不变（但列表末尾多了站外行） |
| `Esc` | 关闭下拉 | 不变 |
| `Enter` | 见 §4.4 | **变更** |

### 4.4 回车路由（核心）

```
onEnter():
  1. activeIndex >= 0            → activate(navItems[activeIndex])   // 用户用上下键显式选过，尊重选择
  2. 否则 collected              → activate(该站点)                    // 已收录 → 定位/打开
  3. 否则 domainCandidate        → requestAdd(url)                    // 粘的是网址 → 一键添加（既有能力，优先于站外）
  4. 否则 存在 kind==='site'     → jumpToSite(第一个站点)              // 站内有命中 → 打开站点
  5. 否则                        → externalSearch()                   // 站内无命中 → 站外搜索
```

关键点：

- **第 3 条在站外之前**：粘贴网址时的意图是「把这条站收进来」，不该被送去搜索引擎。这保住了《一键添加》规格的行为。
- **第 4 条只认 `kind==='site'`**：避免「无结果时那条『没找到？手动添加』行」抢走回车——无结果时回车应当走站外搜索（与用户确认的口径一致）。该行仍可点击、仍可被上下键选中后回车。
- 若用户已用上下键选中站外行（`activeIndex` 落在第 5 行）→ 第 1 条命中 → 站外搜索。符合直觉。

### 4.5 站外搜索执行

```js
function externalSearch() {
  const q = trimmedQuery.value
  if (!q) return
  const engine = preferencesStore.getCurrentEngine()
  window.open(`${engine.url}?q=${encodeURIComponent(q)}`, '_blank', 'noopener')
  focused.value = false
}
```

- 拼接方式与旧 `<form action method=GET name=q>` **等价**（`?q=` + encodeURIComponent），因此 `duckduckgo.com/` 这类无 `/search` 的引擎照常可用。
- 用 `window.open` 而非表单提交，是为了从键盘/点击/下拉行三个入口共用同一个函数。
- 搜索后**不清空输入框**（与站内搜索现状一致，避免新增跨组件协议）；只收起下拉。

### 4.6 明确取舍与边界

- **站外搜索也会经过站内检索**：在统一框里输入任何词都会（防抖后）同步 `searchQuery` 过滤卡片列表。这是「单框」的必然结果，也是合并的意义所在——但意味着「想纯搜站外、不想动列表」在合并后不再可能。**接受**（若日后要，可另开单加「不参与过滤」开关）。
- **`GoogleSearchBar.vue` 不动**：全仓确认无人引用，属历史遗留，本次不删不改（避免超出本次范围）。
- **设置面板不动**：引擎全称列表、`searchEngine` 持久化、`autoAddOnUrl` 开关均保持原样。
- **`autoAdd` 管道、Toast、高亮定位不动**：`add-site` 事件契约不变。
- **不新增快捷键**：Ctrl+F 仍是聚焦搜索框，⌘K 仍是命令面板。

## 5. 受影响文件清单

新增：

- `docs/superpowers/specs/2026-10-09-unified-search-box-design.md`（本文件）

修改：

- `src/components/MainToolbar.vue`：两个搜索组件替换为 `<UnifiedSearchBox class="toolbar-search" @add-site="$emit('open-add', $event)" />`；删除 `.toolbar-external` 类与 `ExternalSearchBox` 引入；`@media` 里 `toolbar-search` 的 flex-basis 断点保持

删除：

- `src/components/ExternalSearchBox.vue`（引擎能力被吸收）
- `src/components/SiteSearchBar.vue`（改名为 `UnifiedSearchBox.vue`，内容吸收站外部分）

> 落地方式：以 `git mv SiteSearchBar.vue UnifiedSearchBox.vue` 保留历史，再在组件内吸收 `ExternalSearchBox` 的引擎选择与提交逻辑，最后 `git rm ExternalSearchBox.vue`。

## 6. 验证方式

**手动验证清单**（`npm run dev`）：

| 场景 | 预期 |
| --- | --- |
| 输入已有站名（如「币安」）按回车 | 新标签页打开该站点 |
| 输入站内无结果的词（如「三体」）按回车 | 新标签页用当前引擎搜索该词 |
| 把引擎切到「百度」后再按回车搜无结果词 | 走百度，不是 Google |
| 点击下拉最后一行「用 XX 搜索「…」」 | 同上，走当前引擎 |
| 上下键一路选到站外行再回车 | 站外搜索 |
| 粘贴 `https://example.com` 回车 | 进入一键添加（Toast / 卡片），**不是**站外搜索 |
| 粘贴已收录域名回车 | 定位并高亮已有卡片 |
| 输入关键词 | 卡片列表与下拉同步过滤；`N 个结果` 数字正确 |
| 无结果时 | 下拉显示「未找到…」+ 手动添加行 + 站外行 |
| 点清除按钮 | 输入清空、下拉关闭、卡片列表恢复 |
| Ctrl+F | 聚焦搜索框 |
| ⌘K 按钮 | 打开命令面板 |
| 移动端（≤768px） | 单个搜索框占满一行，不折行、不溢出 |

**构建与回归**：

- `npm run build` 通过。
- `npm run console:test:all` 全绿（本次不触碰 `shared/*` 与 `utils/*`，应无影响；用于确认没有意外波及）。
