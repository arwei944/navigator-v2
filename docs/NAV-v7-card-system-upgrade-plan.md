# nav-v2 卡片体系升级迭代方案

- 日期：2026-10-09
- 需求：「调研现有卡片体系，制定升级迭代方案」
- 状态：**P0 + P1 + 部分 P2/P3 已实施（2026-10-09）**，未完成项见 §8
- 决策（用户 2026-10-09 确认「全部按建议改」）：① 卡片左键点击 = 打开站点；② 详情入口 = 桌面右侧面板 + 移动端底部抽屉
- 关联文档：`docs/NAV-v5-nav-optimization.html`、`docs/archive/NAV-v6-frontend-redesign-plan.md`、`docs/archive/NAV-frontend-3way-comparison.html`、`HANDOVER.md`

---

## 0. 结论速览

卡片体系的**功能覆盖已经相当完整**：双视图、批量选择、拖拽排序、收藏、回收站、右键菜单、悬停详情面板、在线角标、热度徽章、用途标签、虚拟化、6 套视觉方案联动。所以本次升级的主线**不是"加功能"，而是补齐三处断层**：

| 断层 | 具体表现 | 影响面 |
| --- | --- | --- |
| **① 主要动作断层** | 卡片主体左键点击**什么都不做**（`.card { cursor: default }`），打开站点只能点右下角 30×30 的小箭头 | 300 张卡片全部；**移动端没有 hover，等于主入口只剩那个小箭头** |
| **② 设计令牌断层** | 卡片里 **15 处硬编码颜色**（热度橙红、收藏黄、健康角标绿黄红…），6 套视觉方案与深色主题**驱动不了它们** | 深色主题下 `.card-fav-btn.favorited` 会是一块 `#fefce8` 亮黄 |
| **③ 可访问性断层** | 卡片是 `<div>`，**0 处** `tabindex` / `role` / 键盘事件 | 键盘用户完全无法遍历与打开站点 |

建议节奏：**P0 补断层（小改动、高收益）→ P1 信息架构（卡片该显示什么）→ P2 能力扩展 → P3 技术债**。

---

## 1. 现状勘查

### 1.1 组件拓扑

| 组件 | 行数 | 职责 |
| --- | --- | --- |
| `src/components/SiteCard.vue` | 381 | 单卡渲染：favicon+健康角标、标题、域名、描述(2 行截断)、用途标签、分类 chip、热度徽章、收藏/访问按钮、右键菜单、批量复选框、拖拽手柄、高亮描边、列表模式 |
| `src/components/CardsContainer.vue` | 354 | 网格/列表布局、`vuedraggable` 排序、批量浮动栏、回收站视图、编辑/删除确认弹窗、高亮滚动定位、`content-visibility` 虚拟化 |
| `src/components/right/SiteDetailPanel.vue` | 238 | 悬停详情：图标、名称、域名、分类标签、用途、简介、统计（全网点击/已添加/上次访问）、时间线（添加/更新）、操作（打开/复制/收藏） |
| `src/components/RightSidebar.vue` | — | 承载详情面板，可折叠 + 可拖拽调宽；**≤768px 整体隐藏** |

相关 store：`sites`（过滤/搜索/排序/本地覆盖层）、`favorites`、`history`、`health`、`clicks`、`categories`、`sidebar`。

### 1.2 卡片当前呈现的字段（含"数据里有但没上卡"）

站点数据模型共 14 个字段（`api/sites-data.json`，300 条 / 29 分类）：

| 字段 | 覆盖率 | 卡片 | 详情面板 | 备注 |
| --- | --- | --- | --- | --- |
| `name` | 100% | ✅ 标题 | ✅ | |
| `url` | 100% | ✅ 域名 | ✅ | |
| `desc` | 100% | ✅ 2 行截断 | ✅ 全文 | |
| `icon` / `iconUrl` | 292/300 | ✅ | ✅ | |
| `color` / `initial` | 100% | ✅ 图标底色/兜底字 | ✅ | |
| `categoryId` | 100% | ✅ chip | ✅ 标签 | |
| `purposes` | 100% | ✅ 标签行 | ✅ | |
| `aliases` | **135/300 (45%)** | ❌ | ❌ | **只在搜索建议里用**，卡片与详情都看不到 |
| `visitCount` | 100% | ❌ | ❌ | 本机访问次数，仅"推荐发现"用；卡片热度走的是云端全局 `clicks` |
| `createdAt` / `updatedAt` | 100% | ❌ | ✅ 时间线 | |
| `sortOrder` | 100% | — | — | 内部排序；**存在历史重复值** |

### 1.3 已具备的能力（本次不动）

网格/列表双视图 · 批量选择+批量删除 · 拖拽手动排序 · 收藏 · 回收站+恢复+永久删除 · 右键菜单（收藏/新窗口/复制链接/编辑/删除）· 悬停右侧详情面板（零点击查看）· 在线状态角标（云端快照 + TTL 去重，**不会打爆接口**）· 热度徽章分级 · 用途标签 · 卡片虚拟化（`content-visibility`）· 高亮描边+滚动定位 · 卡片入场动画开关。

### 1.4 视觉令牌覆盖情况

`src/utils/visualScheme.js` 提供 6 套方案（苹果原生 / 极简扁平 / 玻璃拟态 / 紧凑高密度 / 宽松舒适 / 高对比硬朗），卡片已正确响应的令牌：`--radius`、`--radius-sm`、`--shadow-card`、`--shadow-hover`、`--card-padding`、`--grid-cols`、`--grid-gap`、`--title-weight`、`--card-anim`。

**未贯穿的**：卡片内 15 处硬编码色（`#22c55e`/`#f59e0b`/`#ef4444`/`#94a3b8`/`#eab308`/`#fefce8`/`#b45309`/`#dc2626` 等），其中 `.card-fav-btn.favorited` 的背景 `#fefce8` 与健康角标的 `#fff` 描边在深色主题下不成立。

### 1.5 数据层存量问题

- `sortOrder` 存在历史重复（如 sm6/sm7 同为 198），排序可能不稳定。
- 存量 20 条 URL 带 `www.` 前缀，与"只存域名"的约定不符（卡片会剥 www，属数据不齐）。
- 已知失效站 `sm3` 仍列在列表中（当时按指示保留），但**没有"停用"这类状态可表达**。

---

## 2. 问题诊断（按严重度排序）

### P0-1 主要动作藏在 30×30 按钮里 ⚠️ 最严重

`SiteCard.vue`：

```js
function onCardClick() {
  if (props.batchMode) emit('select')   // 非批量模式下：什么都不做
}
```
```css
.card { cursor: default; }              /* 明确宣告「本卡不可点」 */
```

一个**网址导航**的卡片，点主体无反应，必须精准命中右下角那个 30×30 的箭头才能打开——这违反最基础的可用性预期。移动端更糟：`RightSidebar` 在 ≤768px 整体隐藏，hover 不存在，于是移动用户面对的是「点卡片没反应 / 长按出菜单 / 只有小箭头能打开」。

> ⚠️ 需确认设计意图：`cursor: default` 看起来是**有意为之**（可能是为了配合"悬停看详情"的零点击模型）。但即使如此，也建议至少让**卡片主体可点开**，因为它是该产品最核心的动作。

### P0-2 设计令牌未贯穿

15 处硬编码色导致：换视觉方案时卡片"只有骨架变、语义色不变"；深色主题下收藏态是刺眼亮黄块。正确做法是把它们提升为语义 token（`--color-ok` / `--color-warn` / `--color-danger` / `--color-favorite` 等），按主题给出明暗两套值。

### P0-3 键盘与无障碍不可用

卡片无 `tabindex` / `role` / `keydown`（实测 0 处），无焦点样式。键盘用户无法把焦点移到卡片上，更谈不上打开。这是硬性缺陷，与 P0-1 一并修最省事。

### P0-4 右键菜单每卡一份实例

每张卡片都：`<Teleport to="body">` 渲染一份菜单容器 + 在 `onMounted` 里注册 **2 个 document 监听**（`click` + `scroll` 捕获）。300 张卡片 ⇒ **600 个 document 级监听器**，每次点击/滚动全部触发。应提升为**全局单例菜单**（一个 Teleport + 一组监听，用 store/composable 传坐标与目标站点）。

### P1-1 信息密度无分层，用途标签常驻

卡片固定渲染"描述 2 行 + 用途标签行（最多 4 个 chip）+ 分类 chip"，在 3~5 列网格里相当拥挤。而用途本质是**筛选轴**，不是"扫一眼"的内容。用途标签是上次有意加的（HANDOVER §42），因此**不建议直接删**，而应做成"信息密度"档位（简洁 / 标准 / 详细），默认保持现状。

### P1-2 别名（aliases）在卡片与详情里都不出现

45% 的站点有别名（GPT / 小狐狸 / 抱抱脸），这是**人们实际称呼这些站的方式**，却只在搜索建议里露过面。详情面板加一段「别名」成本极低、收益直接。

### P1-3 没有"已访问"状态，300 个站无从分辨

`history` store 已有浏览记录，但卡片与列表都不体现。300 条规模下，"哪些我还没看过"是高频诉求。且文档早已提出：**「最近」视图应改为浏览历史，收录时间另立「最新收录」排序**（`NAV-v5-nav-optimization.html` L751），至今未落地。

### P1-4 移动端详情不可达

`RightSidebar` ≤768px 隐藏 ⇒ 别名、统计、时间线在移动端**完全没有入口**。P0-1 修好"点卡片打开"后，移动端仍缺一个看详情的方式。

### P2 能力缺口

- **无"停用/归档"状态**：失效站（sm3）只能硬留在列表里，既污染"全部"也干扰健康统计。
- **无置顶**：常用站只能靠拖拽排到分类最前，切分类/换设备后不复现。
- **批量操作只有删除**：缺"批量改分类""批量加用途"，改 20 个站要开 20 次弹窗。
- **`/site/:id` 详情路由** 与 **≥1181px 悬停预览浮层**：两份文档推荐过，一直没做（见 §5 决策）。

### P3 技术债

- `SiteCard.vue`(381) / `CardsContainer.vue`(354) 超项目自订的 250 行红线。
- `CardsContainer.vue` L336–340 **复制了一份** `.card-favicon` / `.card-title` / `.card-desc` 给回收站用，两处会各自漂移。
- `sortOrder` 重复值、20 条 `www.` 前缀。
- 侧栏/详情面板折叠过渡会触发 300 张卡整体重排 + 毛玻璃每帧重算（HANDOVER §49 遗留观察）。
- `content-visibility: contain-intrinsic-size: auto 200px`：卡片实际高度随用途标签/描述长度在 ~150–220px 波动，滚动条可能轻微跳动。

---

## 3. 升级方案（分期）

### P0 —— 补三处断层（建议本轮先做）

| # | 事项 | 做法 | 收益 |
| --- | --- | --- | --- |
| P0-1 | **卡片可点开 + 可聚焦** | 卡片加 `role="button"` `tabindex="0"` `@click` 打开站点（`batchMode` 下仍为选择）、`@keydown.enter/.space` 同效、`:focus-visible` 焦点环；`cursor` 改 `pointer`；卡片内的收藏/访问按钮继续 `@click.stop` 防止冒泡 | 主动作回到"点卡片"这一常识；顺带解决移动端 |
| P0-2 | **语义色 token 化** | 在 `visualScheme.js` 增补语义色 token（ok/warn/danger/favorite/heat-warm/heat-hot），给明暗两套值；替换卡片内 15 处硬编码 | 6 套方案 + 深色主题**完整**驱动卡片；修掉深色下的亮黄块 |
| P0-3 | **右键菜单单例化** | 新增全局 `ContextMenuHost`（一个 Teleport + 一组 document 监听），用 store 传 `{x, y, site}`；`SiteCard` 只负责 `@contextmenu` 上报（批量模式用同一份菜单换项目集） | document 监听 600 → 2；每卡省一个 Teleport 容器；滚动关闭菜单的行为集中一处 |
| P0-4 | **回归验证** | 键盘可遍历；深色 + 6 方案无穿帮；批量模式行为不变 | — |

### P1 —— 信息架构：卡片该显示什么

| # | 事项 | 做法 |
| --- | --- | --- |
| P1-1 | **卡片信息密度三档** | 设置项「简洁 / 标准 / 详细」：简洁=图标+名称+域名；标准=当前形态；详细=+别名+完整描述。默认"标准"，**任何现有内容都不丢** |
| P1-2 | **别名浮出** | 详情面板新增「别名」段（`aliases` 非空时）；卡片 `title` 属性带别名，hover 原生提示 |
| P1-3 | **访问状态 + 最近访问** | 卡片对"从未访问"的站点加极淡标记（可由 P1-1 的"详细"档承接）；「最近」视图改用 `history` 浏览历史，新增「最新收录」排序项（对齐 nav-optimization L751 的既定建议） |
| P1-4 | **移动端详情可达** | 长按菜单增加「查看详情」；或点击卡片后在移动端弹底部抽屉承载 `SiteDetailPanel` |

### P2 —— 能力扩展

| # | 事项 | 说明 |
| --- | --- | --- |
| P2-1 | **站点停用/归档** | 新增 `status: 'archived'`（或 `archivedAt`）：灰显、默认不进"全部"、不参与健康告警。直接对应当前 sm3 失效仍列出的现实 |
| P2-2 | **置顶（pin）** | `pinned: true`，固定在分类/范围顶部；与拖拽排序共存（置顶区内部仍可拖） |
| P2-3 | **批量操作扩展** | 批量改分类、批量加用途（复用现有批量栏） |
| P2-4 | **详情入口收敛** | 见 §5 决策：`/site/:id` 路由 vs 悬停浮层 vs 维持现状 |

### P3 —— 技术债

| # | 事项 |
| --- | --- |
| P3-1 | 拆分 `SiteCard.vue`：右键菜单（已被 P0-3 抽走）、卡片样式、列表模式各自独立 |
| P3-2 | 消除 `CardsContainer.vue` 里重复的卡片样式（回收站视图改用共享类或抽 `CardChrome`） |
| P3-3 | `sortOrder` 重复值清理 + 纳入发布门禁连续性校验（`nav-v3` P0-4 已提过） |
| P3-4 | 20 条 `www.` 前缀数据统一 |
| P3-5 | 侧栏折叠过渡性能：改瞬时切换或 `transform` 动画，避免 300 卡重排 |

---

## 4. 明确不做

- **卡片毛玻璃**：V6 实测掉到 41.7fps，已被明确否决（`NAV-v6` L387–398）。维持"半透明底 + 描边 + 内高光"。
- **改数据模型语义**：`visitCount`（本机）与 `clicks`（云端全局）的分工保持现状，不合并。
- **不动已验收的骨架**：双视图、批量、拖拽、回收站、搜索联动、URL 状态化、虚拟化——本轮只做增量。

---

## 5. 需用户决策（2 项）—— 已决策

1. **卡片左键点击的默认动作** → **改为打开站点**（用户确认）。
2. **详情入口最终形态** → **桌面保留右侧悬停面板 + 移动端新增底部抽屉**（方案 ③，用户确认）。

---

## 6. 验收方式

- **键盘**：Tab 可遍历卡片，Enter/Space 打开，焦点环清晰可见。
- **主题**：切到"高对比硬朗"（深色）与另外 5 套方案，卡片无任何硬编码色穿帮（收藏态、热度徽章、健康角标逐项核对）。
- **性能**：300 卡片场景下 document 级监听数量为常量（2 个）；快速划过数十张卡片无卡顿。
- **能力回归**：批量选择、拖拽排序、收藏、回收站恢复、右键菜单五项、悬停详情、高亮定位**逐项不得缺失**（沿用项目「能力无回归清单」惯例）。
- `npm run build` 通过；`npm run console:test:all` 全绿。

---

## 7. 受影响文件（预估）

P0：`src/components/SiteCard.vue`、新增 `src/components/ContextMenuHost.vue` + `src/stores/contextMenu.js`、`src/utils/visualScheme.js`、`src/components/CardsContainer.vue`

P1：`src/components/right/SiteDetailPanel.vue`、`src/components/CardsContainer.vue`（recent 分支）、`src/components/MainToolbar.vue`（排序项）、`src/stores/preferences.js`（密度偏好）、`src/views/SettingsPanel` 相关 section

P2：`src/stores/sites.js`（archived/pinned 字段与过滤）、`src/components/AddSiteModal.vue`/`EditSiteModal.vue`（新字段）、批量栏

P3：`src/components/SiteCard.vue`、`src/components/CardsContainer.vue`、`scripts/fix-sortorder.mjs`、数据文件

---

## 8. 实施结果（2026-10-09）

### 已落地

| 项 | 落地内容 | 可复核指标 |
| --- | --- | --- |
| **P0-1** 卡片可点开 + 键盘 | `SiteCard` 加 `role="button"` / `tabindex="0"` / `@keydown.enter.space` / `:focus-visible` 焦点环；`cursor: default` → `pointer`；主体点击、回车、空格、右下角箭头统一走 `openSite()`（同一条 `recordVisit` + `addRecord` 口径）；拖拽手柄与健康角标 `@click.stop` | `tabindex/role/keydown` 4 处 |
| **P0-2** 语义色 token 化 | `visualScheme.js` 新增 12 个语义 token（`--color-ok/warn/danger/muted/favorite/favorite-bg/favorite-border/heat-warm[-bg]/heat-hot[-bg]/on-solid`），**明暗两套值**；`SiteCard` 全部替换 | **`SiteCard` 硬编码色 15 → 0** |
| **P0-3** 右键菜单单例 | 新增 `stores/contextMenu.js` + `components/ContextMenuHost.vue`（全局挂一次） | **`SiteCard` 的 `addEventListener` 2 → 0**（300 卡 = 600 → 0 个 document 监听） |
| **P1-1** 信息密度三档 | `preferences.cardDensity`（持久化）+「设置 → 显示 → 卡片信息密度」；简洁 / 标准 / 详细（详细含别名与三行描述），默认"标准" | — |
| **P1-2** 别名浮出 | 详情面板新增「别名」段（chip 列表）；卡片 `title` 原生提示带别名 | 详情面板 `aliases` computed |
| **P1-3** 访问状态 | 卡片对未访问站点显示「未访问」淡徽章（`history.getLastVisitTime`）；「最近」视图改为**浏览历史倒序**（只列访问过的）；原「最近添加」排序更名**「最新收录」** | `CardsContainer` recent 分支 |
| **P1-4** 移动端详情 | 新增 `MobileDetailDrawer.vue`（底部抽屉，复用 `SiteDetailPanel`，Esc/遮罩关闭，≤768px 生效）；右键菜单新增「查看详情」，由 `sidebarStore.showDetail()` 按视口分流（宽屏→右侧面板，窄屏→抽屉） | — |
| **P2-2** 置顶 | `pinned` 字段 + `sitesStore.togglePin`；右键菜单「置顶/取消置顶」；底栏置顶徽章；`filteredSites` 在不搜索时把置顶项浮到最前 | — |
| **P2-3** 批量操作 | `sitesStore.batchUpdate / batchSetCategory / batchAddPurpose`（一次遍历、只 rebuild 一次）；批量栏新增「改分类」「加用途」下拉 + Toast 反馈 | — |
| **P3-2** 样式去重 | 回收站行不再借用 SiteCard 的 `.card-favicon/.card-title/.card-desc`（这些类名在 7 个组件里各自 scoped 且语义不同，故不全局收编），改为自有 `trash-favicon/-name/-desc` | — |
| **P3-1** 部分拆分 | 右键菜单（约 85 行）从 `SiteCard` 整体外移 | 见下方未完项说明 |

### 未完成（需下一批，附原因）

| 项 | 为什么没做 |
| --- | --- |
| **P2-1 站点停用/归档** | 需要新的**查看入口**（nav scope 或筛选 chip）＋ 数据 schema 与 `validate-data.mjs` 门禁同步 ＋ 后台表单，涉及 300 条线上记录的契约。半接线（能归档但看不到归档）比不做更糟，故留给独立一批 |
| **P3-1 深度拆分** | 本次新增了密度/别名/置顶/未访问/键盘等能力，`SiteCard` 381→394 行、`CardsContainer` 354→435 行；进一步拆需要抽 `FaviconBadge`（跨 7 个组件）——**本环境无法做视觉回归**，风险高于收益 |
| **P3-3 `sortOrder` 去重** | 会一次改写 300 条线上数据，需配套发布验证 |
| **P3-4 `www.` 前缀统一** | 改 `url` 会影响去重口径与 favicon 归属，需先定"id/url 谁准"的口径 |
| **P3-5 折叠过渡性能** | 属性能项，**本环境无法测帧率**（无浏览器），盲改布局动画风险高 |
| **`/site/:id` 路由、悬停浮层** | §5 已决策走"面板 + 抽屉"，不再需要 |

### 验证

- `npm run build` 通过（`✓ built in 16.16s`）。
- 目标指标已用 grep 复核（见上表"可复核指标"列）。
- **待补**：键盘 Tab 遍历与 Enter 打开的实机验证、深色主题 + 6 套方案的视觉核对、300 卡滚动帧率。
