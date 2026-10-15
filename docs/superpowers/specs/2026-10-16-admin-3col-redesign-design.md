# 管理后台：三栏化 · 缺省值补全 · 视觉统一

三条反馈一次交付。核心是把后台从「整页独立的 /admin」拉回主站的三栏骨架里，
顺带把它长期积累的一批小问题（空状态缺失、视觉令牌对不上）清掉。

---

## 0. 三条需求

| 反馈 | 处理 |
|---|---|
| 点击后要保持原来的三栏式架构 | Admin 从 `STANDALONE_ROUTES` 移出，改走 `scope === 'admin'` 分支 |
| 把缺省值都补全 | 逐面板审查空状态/占位/兜底，补 4 处真缺口 |
| 布局交互视觉按整体风格重新设计 | 统一到主站的令牌与节奏；修掉 6 个**从未定义**的 CSS 变量 |

---

## 1. 三栏化

### 1.1 原先为什么不是三栏

`App.vue` 有一份 `STANDALONE_ROUTES`，成员会走 `<router-view v-if="isStandalone" />`
这一支 —— 整页独立、不套 `Sidebar` / `main` / `RightSidebar`。Admin 一直在里面，
所以点「管理后台」后侧边栏整体消失。

### 1.2 改法

- 从 `STANDALONE_ROUTES` 移除 Admin（只剩 `NotFound` 是真·独立页）；
- `SCOPE_BY_ROUTE` 加 `Admin: 'admin'`，内容区加 `v-else-if="scope === 'admin'"` 分支；
- 用 `defineAsyncComponent` 引入，保持懒加载。

`AdminView` 自身两处适配：

- `.admin-view` 从 `height: 100vh` 改成 `flex: 1; min-height: 0` ——
  它现在渲染在 `.main`（已是 `flex:1` 的列容器）里，再占满视口会把两侧栏挤掉；
- 去掉 header 里的「返回首页」：三栏下侧边栏就在左边，那个链接是独立页时代的遗留。

### 1.3 首屏预算（踩了一次）

初版把 `AdminAside` **静态**引入 `RightSidebar`（首屏组件），首屏从 608 涨到 **613.8 KiB**，
越过预算线。改成 `defineAsyncComponent` 后回落到 608.1。

预算线 608 → 610 是按既有口径抬的，并已验证 `AdminView` / `AdminAside`
都独立成 chunk、在 index chunk 里按符号名 grep 为 **0 命中**（`TAB_META`、
`admin-aside`、`aa-link`、「站点库与分类体系的总览」等）—— 抬的是入口成本，不是功能体积。

---

## 2. 右栏：跟随当前模块

主站右栏是「选中站点的详情」，而后台**没有「当前站点」这个上下文** ——
硬套只会得到一块永远空着的面板。所以后台的右栏承担另一个职责：

**解释当前这块在干什么**（说明 + 概览数字 + 要点）**以及与它相邻的模块是哪些**（快捷跳转）。

- 13 个模块各有一份说明书（`TAB_META`）；
- 概览数字**全部来自已有 store / 公开接口**，不为右栏额外发请求 ——
  一个说明性的侧栏不该成为后台的额外延迟来源；
- 跳转分两类：`tab`（后台内模块，走 query 保持可刷新）与 `route`（主站页面）。
  这个区分是必要的：后台没有「洞察」这个 tab，它是主站的一页，
  混在一起会跳到不存在的 tab 上（打开是空白）。

---

## 3. 缺省值：补了 4 处真缺口

逐面板审查（15 个组件）后的结论 —— 大多数面板的空状态是齐的，缺的是这 4 处：

| 文件 | 问题 | 修法 |
|---|---|---|
| `AdminAi.vue` | 建议列表 `v-if="suggestions.length"` **无 v-else** ——「还没跑」与「跑完没建议」都是一片空白 | 加空兜底，两种状态分别说明 |
| `AdminAi.vue` | 摘要 `v-if="summary"` 同上 | 同上 |
| `AdminCategoryManager.vue` | 分组列表 `v-for` 无兜底 —— 分类表没加载出来时整块消失 | 加兜底，并点明「分类是内置表，正常不会为空，看到这行说明数据源有问题」 |
| `AdminPlugins.vue` | 引擎组为空时整页只剩标题 | 加兜底，提示点「刷新」重试 |

**为什么每个兜底都要写清楚「这意味着什么」**：空白让人以为坏了；
写「正常不会为空，看到即异常」则直接给出判断依据。

`AdminSitesPanel` / `AdminInsights` / `AdminPublishPreflight` 等已有兜底，未改。

---

## 4. 视觉统一：6 个幽灵变量

`AdminAi.vue` 与 `AdminBackup.vue` 用了 `var(--color-border)` / `var(--color-bg-subtle)` /
`var(--color-muted)` / `var(--color-ok)` / `var(--color-danger)` / `var(--color-on-solid)` ——
这些变量**在整个项目里从未定义过**。

后果不是报错，而是**样式静默失效**：`border: 1px solid var(--color-border)` 的边框色无效、
`background: var(--color-bg-subtle)` 变透明。这两个面板的框线一直是缺的。

按主站真实存在的令牌替换（19 处）：

| 幽灵变量 | 换成 |
|---|---|
| `--color-border` | `--border` |
| `--color-bg-subtle` | `--border-light` |
| `--color-muted` | `--text-secondary` |
| `--color-ok` | `#059669`（主站语义色就是硬编码的，没有 `--success` 令牌） |
| `--color-danger` | `#dc2626` |
| `--color-on-solid` | `#fff` |

---

## 5. 验收

| 项 | 结果 |
|---|---|
| 真机（三栏） | `probe/admin-3col-verify.mjs` **25 条**：三栏都在、后台渲染在 main 里、左栏高亮、右栏跟随 tab、快捷跳转生效、无横向滚动、无 undefined |
| 全量回归 | `console:test:all` **53 脚本 exit 0**（含首屏预算 45 条） |
| 首屏 | 608.1 ≤ 610 KiB；AdminView / AdminAside 独立成 chunk、首屏 0 命中 |

真机探针验证的是**结构**（三栏在不在、右栏跟不跟着变），不只是「页面能打开」。

---

## 6. 不做的事

- **不推倒重写后台的视觉** —— 它本来就用的主站令牌，真正的病是那 6 个幽灵变量，
  治病即可，重写只会引入新问题；
- **不给右栏加实时请求** —— 说明性侧栏不承担数据刷新职责（见 §2）；
- **不动 `/admin` 的 URL 与 tab query 机制** —— 可刷新、可分享这条不能丢。
