# 右边栏设置面板：显示模式 · 区块显隐 · 内联编辑

> 状态：**已确认（四问）→ 实施中**
> 日期：2026-10-13

## 0. 需求与确认结果

用户原话：

> 现在右边栏只有悬停的时候才显示网站信息，无法进行编辑，我需要新增一个右边栏设置面板，用来设置了右边栏有关的一切状态

四问确认（2026-10-13）：

| # | 问题 | 选择 |
|---|---|---|
| 1 | 显示时机怎么改 | **三种都做成设置项**（悬停预览 / 图钉固定 / 点击驱动） |
| 2 | 设置面板管哪些 | **全选**：显示时机与锁定、宽度与折叠、详情区块显隐、站点编辑入口 |
| 3 | 面板入口 | **并入现有「设置」抽屉** |
| 4 | 编辑形式 | **面板内直接内联编辑** |

## 1. 现状（先量后改）

| 位置 | 现状 |
|---|---|
| `stores/sidebar.js` | `hoveredSite` 由 `setHoveredSite` / `clearHoveredSite` 驱动；`rightCollapsed` **刻意不持久化**（每次进入都默认展开）；`rightWidth` 持久化（60~400，默认 280） |
| `components/RightSidebar.vue` | 渲染 `hoveredSite`；折叠按钮 + 拖拽调宽；≤1024 收起、≤768 隐藏 |
| `components/right/SiteDetailPanel.vue` | 区块：头部 / 分类 / 别名 / 用途 / 简介 / 备注 / 统计 / 时间线 / 操作；**没有任何编辑入口** |
| `SideCard` → 悬停 | `setHoveredSite(site)`，离开即 `clearHoveredSite()` → **面板随鼠标消失，"来不及编辑"** |
| 右键菜单 → `showDetail(site)` | 桌面：展开面板并塞 `hoveredSite`；窄屏：底部抽屉 |

**问题定性**：不是"功能缺失"，是**触发方式单一** —— 面板内容的存在与否完全由 hover 决定，
用户没有任何手段让它停下来。

## 2. 方案

### 2.1 三种显示模式（`rightPanelMode`）

**核心不是"加几种触发方式"，而是让面板不跟鼠标一起消失** —— 原设计里"面板移开即空"
正是用户抱怨的那一点（读一段描述、改一个字段都来不及）。一旦面板移开后保留内容，
「临时预览 / 锁定」这个维度就不存在了：只需要**一个**状态 `sidebar.rightSite`
（语义 = 面板当前显示谁），三种模式的差别退化成很轻的一件事 —— **谁来决定切换**：

| 模式 | 悬停卡片 | 主动打开（右键「查看详情」） | 面板会变空吗 | 适用 |
|---|---|---|---|---|
| `hover` **悬停预览**（默认） | 立即切换 | 切换 | 只有显式清空（图钉/关闭） | 与既有观感最接近 |
| `click` **点击驱动** | **不响应** | 切换 | 同上 | 不想要 hover 干扰 |
| `pin` **图钉固定** | **不响应** | **toggle**：再选同一张即收起 | 拔掉图钉后 | 边操作边对照某个站 |

> `pin` 与 `click` 的实际差别有两点，如实写在这里免得被当成"重复选项"：
> ① `pin` 在面板顶部显示**图钉按钮**（有明确的"已钉住"状态），`click` 没有；
> ② `pin` 下主动打开同一张 = 收起（"钉住 / 拔掉"的开关语义），`click` 下 = 无变化。
>
> **统一模型**：三种模式共用 `reduceRightPanel(mode, state, action)` 这一个纯函数
> （`shared/right-panel.mjs`），渲染层完全不做分支 —— 只订阅 `sidebar.rightSite`。
> 判断收成一条通道（`sidebar.applyRight`），避免"改了设置但某个入口不听话"。
>
> **为什么不能做"点击卡片锁定"**：点击卡片的既有语义是**打开网站**，这是核心操作，
> 不能挪作他用（改了两年的肌肉记忆会当场失效）。所以锁定只能走"主动打开"通道
> （右键菜单 →「查看详情」），而悬停那一路必须"移开不清空"才能真正解决抱怨。

### 2.2 详情区块显隐（`rightSections`）

逐项开关，默认全开：`desc` / `aliases` / `purposes` / `note` / `stats` / `timeline` / `actions`。

- 头部与分类标签**不可关**：面板总要有主体，关掉反而变成一块空白。
- 开关只控制"允不允许显示"，**空数据仍然整段不渲染**（沿用现有 `v-if="aliases.length"` 的口径）——
  否则会出现"标题下面什么都没有"的空壳。

### 2.3 宽度与折叠（`rightCollapsePolicy`）

| 选项 | 行为 |
|---|---|
| `always-expand`（默认，= 现状） | 每次进入都展开，不记折叠状态 |
| `remember` | 记住上次的折叠状态 |
| `always-collapse` | 每次进入都折叠（把右边栏当"按需查看"用） |

宽度不新增配置项：`sidebar.rightWidth` 本来就是持久化的用户值（拖拽即改），
再给一个"默认宽度"会变成两个真值源。设置里只提供**「重置为 280px」**按钮。

### 2.4 内联编辑

在 `SiteDetailPanel` 头部加一个铅笔按钮 → 切换**编辑态**（不是永远可编辑）：

- 可编辑：名称 / 网址 / 描述 / 分类 / 别名 / 用途。
- 底部「保存 / 取消」；**取消**恢复原值，**保存**调 `sitesStore.updateSite(id, patch)`。
- 不做"输入即存"：站点信息改动会进 overlay 并触发同步，逐键写入既浪费又危险
  （备注那种"输入即存"适合纯本地短文本，不适合会同步的结构化字段）。
- **字段归一逻辑必须与 `EditSiteModal` 共用一份**（抽 `shared/site-edit.mjs`）。
  否则两个入口会漂移：域名提取、别名去重、`purposes` 空值传 `undefined`（空数组会让卡片渲染空行）、
  `initial` 派生 —— 这些都是踩过坑才写下的规则，复制一份等于开两条会分叉的路。

### 2.5 入口

`components/settings/RightSidebarSection.vue`，插进 `SettingsPanel` 的 `DisplaySection` 之后。
沿用现有 `settings-section` / `section-header` / `setting-row` / `theme-toggle-btn` 样式，
不引入新的视觉语言。

## 3. 数据与存储

`stores/preferences.js` 新增（全部进 persist 白名单）：

| 键 | 类型 | 默认 |
|---|---|---|
| `rightPanelMode` | `'hover' \| 'click' \| 'pin'` | `'hover'` |
| `rightSections` | `Record<string, boolean>` | 全开 |
| `rightCollapsePolicy` | `'always-expand' \| 'remember' \| 'always-collapse'` | `'always-expand'` |

`stores/sidebar.js`：删掉 `hoveredSite` / `pinnedSite` / `displaySite` 一整套，
换成**单状态** `rightSite`；写入统一走 `applyRight(action)` → `reduceRightPanel`，
对外只暴露三个事件入口 `hoverSite(site)` / `selectSite(site)` / `clearRight()`。
另加 `applyCollapsePolicy()`（读持久化值，必须在 `App.vue` 的 `onMounted` 里调，
persistedstate 在 store setup 返回后才回填）+ 一条 watch 让改设置立即生效。

> **不给 `rightSections` 做 computed 收窄**（不像 `cardDisplay` 那样）：它只服务 1 个面板，
> 而 `cardDisplay` 收窄是因为 300 张卡片各自解算会重复计算。这里展开成本可忽略。

> **`rightSite` 刻意不进持久化**：面板每次进来都该是干净的空状态，
> 而不是上次残留的某个站点 —— 那会让人以为是数据错了。

## 4. 验收标准

| 项 | 判据 | 结果 |
|---|---|---|
| 自动化守卫 | 新增 `tools/console/test-right-panel.mjs`：`reduceRightPanel` 三模式真值表（含 `pin` 的 toggle、非法模式回退 `hover`、`frozen` 只拦悬停）、`siteToForm`/`buildSitePatch` 往返、持久化白名单、两个编辑入口共用归一 | ✅ 110 条 |
| 行为等价 | `hover` 模式 + 区块全开 + 不编辑 时，**与现状完全一致**（原有探针 `v8-verify-ui` / `add-modal-status` 不得回退） | ✅ 全量 36 脚本绿 |
| 分包 | `RightSidebarSection` 随 `SettingsPanel` 走异步 chunk，**不进首屏**（`console:test:bundle` LAZY_PARTS 口径不变） | ⚠ 见下方说明 |
| 真机 | `probe/right-panel-verify.mjs`：移开保留、编辑同步到卡片、编辑期冻结、区块开关、click 忽略悬停、pin toggle、折叠策略即时生效 | ✅ 32 项 |
| 门禁 | `console:test:all`（36 脚本）+ `validate` + `test-bundle --strict` | ✅ |

### 4.1 分包：一处计划外的改动（必须先说明）

改动本身净增首屏 **+5.7 KiB**（598.3 → 604.0），**越过了 600 KiB 预算**。

排查发现根因不在新代码，而是一处**既有**的加载方式问题：`EditSiteModal` 在
`App.vue` / `CardsContainer.vue` / `AdminSitesPanel.vue` 三处都是**静态**引入，
于是它连带 `PurposePicker` 一直压在首屏 —— 而它只在右键点「编辑」时才用得到。

按项目既定约定（「点开才用」的重组件一律 `defineAsyncComponent`）改成异步后，
首屏回到 **599.4 KiB raw / 210.1 KiB gz**（基线 598.3 / 209.7），本次净增仅 **+1.1 KiB**。

> **没有调阈值**。600 KiB 这个数一个字节都没动 —— 修的是加载方式，不是尺子。

### 4.2 顺带修掉的两个真问题（都不是本次需求，但会被本次需求踩到）

1. **面板内容按 id 现取**：`sitesStore.updateSite` 后 `rebuild()` 会为新内容生成**新对象**
   （memo 的 `edit` 身份变了），而 `sidebar.rightSite` 还攥着旧引用 → 内联编辑保存后
   面板会停在旧值上。改成按 id 从全量 `sites` 重取。
   纯函数用例测不到这条 —— **只有真机点一次保存才看得见**（探针里那条 ★）。
2. **编辑期冻结（`frozen`）**：`hover` 模式下点铅笔开始编辑后，鼠标划过任意一张卡片
   就会把面板换走、未保存的改动当场丢失。状态机加 `frozen`，**只拦悬停**，
   `select` / `clear` 照常生效（那是明确动作）。

## 5. 不做的事

- **不改 `hover` 模式下的既有观感**：悬停依旧即时预览，不引入延迟（延迟会让"快速扫一遍"变卡）。
- **不给头部/分类标签做开关**（理由见 2.2）。
- **不做"输入即存"**（理由见 2.4）。
- **不动窄屏（≤768）的底部抽屉**：触屏没有 hover，`pin`/`click` 在那边语义不同，本次不碰。
- **不新增第二套偏好存储**：一切走 `preferences` store，与「卡片设置」同源。
