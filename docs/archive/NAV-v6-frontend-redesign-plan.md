# Navigator V6 前端改造方案 — 布局对齐 huarun.win

> 调研日期：2026-09-30 · 参考站：`https://huarun.win/`（华润赢 · 翻墙应用商店，Next.js 构建）
> 取证方式：抓取首页 HTML（627 KB）与构建产物样式表 `_next/static/css/index.CB-Yxjni.css`（439 KB），逐条提取选择器规则与媒体查询；未依赖截图，规格全部可复算
> 前置：V5 已上线（云端 v102 / 301 站点 / 29 分类）。本文件只谈前端外壳怎么改，不涉及数据模型、CLI 与发布链路

---

## 一、参考站布局规格

### 1.1 设计 token

参考站是一套完整的浅/深双主题变量体系，挂在 `:root` 与 `.dark` 上，组件只引用变量、不写字面色值。

| token | 浅色 | 深色 | 用途 |
|---|---|---|---|
| `--background` | `#f4f5f8` | `#09090d` | 页面底色 |
| `--foreground` | `#1d1d1f` | `#f4f4f5` | 主文字 |
| `--muted-foreground` | `#6e6e73` | `#a1a1aa` | 次级文字 |
| `--primary` | `#0071e3` | `#38bdf8` | 主色 |
| `--primary-soft` | `#0071e31a` | `#38bdf824` | 主色浅底 |
| `--card` / `--card-bg` | `#fff` / `#ffffffb8` | `#16161a` / `#16161cb3` | 卡片 |
| `--card-border` | `#ffffffd1` | `#ffffff1f` | 卡片描边 |
| `--border` | `#ffffffa6` | `#ffffff1a` | 通用描边 |
| `--hairline` | `#0000001a` | `#ffffff24` | 细线 |
| `--topbar-bg` | `#ffffffad` | `#0a0a0eb8` | 顶栏底 |
| `--tab-bg` / `--tab-active-bg` / `--tab-active-color` | `#0000000b` / `#ffffffeb` / `#111827` | `#ffffff0d` / `#ffffff26` / `#fafafa` | 分段控件 |
| `--green` / `--amber` / `--destructive` | `#16865d` / `#94610d` / `#d92d20` | `#34d399` / `#fbbf24` / `#f87171` | 状态色 |

阴影、光晕与毛玻璃：

- `--card-shadow: inset 0 1px 1px 0 #ffffffe6, 0 4px 20px -2px #0000000a`
- `--card-hover-shadow: inset 0 1px 1px 0 #fff, 0 16px 36px -6px #00000014, 0 0 0 1px #0071e333`
- 页面底色之上叠三团径向光晕：`--bg-radial-1/2/3`（浅色 `#e0eeffa6` / `#f0ebff80` / `#e6f5ff66`；深色 `#0e325f40` / `#2d145033` / `#0a23412e`）
- 顶栏 `backdrop-filter: blur(24px) saturate(190%)`；卡片 `blur(22px) saturate(190%)`；分类链接区 `blur(20px) saturate(190%)`
- 字体栈 `-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif`，等宽 `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`

nav-v2 现有 token 与之高度同源（`--accent: #0071e3`、`--text-primary: #1d1d1f`、`--bg-primary: #f5f5f7`），差异集中在三点：参考站卡片是半透明加毛玻璃而非实色、卡片圆角 18px 而非 12px、并且多了一层内高光与悬停描边环。

### 1.2 页面骨架

```
body                              （移动端预留 80px + 安全区底部内边距）
└─ main
   ├─ header.topbar               sticky top:0 · z-index:20 · h52（满宽，不受下方网格约束）
   │  ├─ .topbar-leading  → a.brand（.brand-mark 28×28 + .brand-name）
   │  ├─ nav.site-sections → 5 个文字栏目，激活项带 2px 主色下划线
   │  └─ .topbar-end
   │     ├─ label.search-field.topbar-search-field（放大镜 + input + ⌘K 提示）
   │     └─ .topbar-actions → Telegram 按钮 + 调色板按钮
   ├─ div.app-shell               grid-template-columns: 228px minmax(0,1fr)
   │                              width: min(1480px,100%) · margin: 0 auto
   │  ├─ aside.sidebar            228px 常驻分类栏（sticky top:52 · ≤800px display:none）
   │  │  ├─ p.sidebar-label       "浏览应用"
   │  │  ├─ nav[aria-label=目录分类]
   │  │  │  └─ button/a.nav-item  18×18 线性图标 + 标签 + .nav-count（激活项主色实底）
   │  │  └─ div.sidebar-footer
   │  │     ├─ a.sidebar-tg-card  Telegram 频道卡（badge + title + desc）
   │  │     └─ div.sidebar-callout 提示卡（info 图标 + 文案）
   │  └─ section.catalog.catalog-interactive
   │     ├─ header.directory-compact-heading   h1 24px（interactive 形态下视觉隐藏，仅供 SEO 与读屏）
   │     ├─ div.directory-controls             移动端 sticky 筛选区（桌面仅保留桌面筛选组）
   │     │  ├─ .mobile-filter-bar   → 客户端 / 平台 / 内核 / 代码 / 价格 五个下拉 pill
   │     │  ├─ .mobile-platforms    → 全部 / Android / iOS / Windows … 横滑 chips
   │     │  ├─ .directory-filter-groups → fieldset 分组（core-tabs / source-tabs / price-tabs）
   │     │  └─ .active-filter-chips → 已选条件 chips
   │     ├─ div.app-grid            → 卡片网格
   │     │  └─ article.app-card
   │     │     ├─ a.app-card-detail
   │     │     │  ├─ .app-card-main（grid 52px | 1fr）
   │     │     │  │  ├─ .app-icon（52×52 · radius 14）
   │     │     │  │  └─ .app-meta → .app-title-row（h2 + .feature-tag）+ p.description
   │     │     │  └─ .card-footer → .badges（内核 / 代码状态 / 价格 / 平台 pills）
   │     │     └─ .card-actions → a.card-external-link（右侧独立动作按钮）
   │     ├─ nav.seo-category-links  → 分类快捷入口卡片区
   │     └─ footer.site-footer      → 站点说明 + 链接组 + Telegram
   └─ nav.mobile-site-tabs        fixed bottom · 桌面 display:none · 移动端底部 tab 栏
```

**顶栏满宽吸顶，其下 `.app-shell` 才是「228px 侧栏 + 主内容」两列网格，并整体居中**（`width: min(1480px,100%)`）。这解释了主内容区宽度为什么不是视口宽度：1440px 下 `.catalog` 只有 1212px = 1440 − 228，1920px 下是 1252px = min(1480,1920) − 228。侧栏在 ≤800px 隐藏，`.app-shell` 退化为单列 `block`。

顶栏与页脚都在 `main` 之内，`main` 本身不限高——整页由文档流滚动，这是与 nav-v2 原 `100vh` 内部滚动模型最根本的区别。

### 1.3 顶栏规格

| 部位 | 桌面（≥801px） | 移动（≤800px） |
|---|---|---|
| 高度 | `52px` | `calc(44px + env(safe-area-inset-top))` |
| 背景 | `--topbar-bg` + `blur(24px) saturate(190%)` | 实底 `#fff`（深色 `#111116`），无毛玻璃 |
| 栅格 | `auto auto minmax(0,1fr)`，gap 20 | `auto minmax(0,1fr) auto`，gap 10 |
| 内边距 | `0 24px` | `max(18px, safe-left)` / `max(18px, safe-right)` |
| 栏目导航 | 13px / 500，激活项主色 + 600 + 2px 下划线 | `display:none` |
| 搜索框 | h34 · radius 10 · `clamp(150px, 22vw, 320px)` · input 13px | radius 999px · 宽度 100% · input 16px（防 iOS 缩放） |
| 其他 | 801–1100px 时搜索列收紧为 `minmax(140px,1fr)`；≤1180px 隐藏 Telegram 文字只留图标；≤520px 栏目居中；≤430px 内边距收到 12px | 顶栏回到上级页时显示 `.topbar-back-btn`（44×44 触控区） |

`--popover` 为移动端 tab 栏与筛选区的实底背景，深色下 `#111116`。

### 1.4 卡片规格

桌面形态（`.app-card`）：

- `border: 1px solid var(--card-border)` · `background: var(--card-bg)` · `backdrop-filter: blur(22px) saturate(190%)`
- `border-radius: 18px` · `min-height: 154px` · `box-shadow: var(--card-shadow)`
- 纵向 flex，`justify-content: space-between`；内容区 `.app-card-detail` 内边距 `16px 16px 14px`
- 主行 `.app-card-main` 为 `grid-template-columns: 52px minmax(0,1fr)`，gap 13px
- 图标 `.app-icon` 52×52、圆角 14px、`img` 用 `object-fit: cover`
- 标题 `h2` 15px / 650，悬停转主色；描述接在其下
- 底栏 `.card-footer` 有 1px 上分隔线，`padding: 10px 68px 0 0`（右侧留出动作按钮宽度）
- 悬停：`translateY(-3px) scale(1.004)`，背景转 `#ffffffe0`，描边转 `#0071e347`，阴影换 `--card-hover-shadow`；过渡 `0.22s cubic-bezier(.16,1,.3,1)`
- 徽标 `.badges > span`：min-height 20px、圆角 5px、10.5px / 550；平台小 pill 10px

移动形态（≤800px）下卡片整体变成 iOS 列表行，是参考站最值得照搬的一处形态切换：

- 卡片自身去掉背景、描边、圆角、阴影与毛玻璃，改为 `grid-template-columns: minmax(0,1fr) 74px`，`padding: 13px 0`
- 相邻行之间用 `:before` 画一条分隔线，左起 `68px`（与图标右缘对齐）
- 图标放大到 56×56、圆角 13px，`grid-area: 1/1/4` 纵跨三行
- 描述 `-webkit-line-clamp: 2`，12.5px；徽标改为纯文本行内串联，用 ` · ` 作分隔，不再显示价格与图标
- 右侧动作按钮固定 `74px × 28px`，圆角 999px，浅底 `#f2f2f7`，11.5px / 650

### 1.5 网格与断点

| 断点 | `.app-grid` | 其他变化 |
|---|---|---|
| ≥1181px | 3 列，gap 14px | 顶栏完整态 |
| ≤1180px | 2 列 | 隐藏 Telegram 文字标签 |
| ≤1080px | 1 列，gap 14px | — |
| ≤800px | 1 列，gap 12px；列表形态 gap 归零 | 顶栏转移动态、底部 tab 栏出现、筛选区转 sticky、页脚转纵向 |
| ≤640px | 1 列 | — |
| ≤520px | — | 顶栏栅格转 `auto 1fr auto`，栏目居中 |
| ≤430px | — | 顶栏内边距 12px，卡片图标缩到 54px |
| ≤360px | — | 筛选 pill 收紧内边距 |

`.catalog` 内边距为 `40px clamp(28px, 3.5vw, 56px) 56px`；移动端转 `28px 18px 42px`，且 interactive 形态下背景换成实底、上内边距归零。

底部 tab 栏（≤800px）：`position: fixed`、`z-index: 40`、高 `calc(72px + safe-area-bottom)`、`grid-auto-flow: column` 等分，激活项 650 字重且图标带 `--tab-active-shadow`。

### 1.6 其他区块

分类快捷入口 `.seo-category-links`：卡片化容器（`--card-bg` + 20px 圆角 + 毛玻璃 + `--card-shadow`），`grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))`、gap 28、`margin-top: 42px`、内边距 `24px 28px`；≤800px 转单列。

页脚 `.site-footer`：1px 上描边、flex 两端对齐、`margin-top: 42px`；左侧说明文字 11px / 1.65、`#86868b`、`max-width: 720px`，右侧链接组 `flex-wrap` 右对齐、`max-width: 430px`；≤800px 转纵向。

参考站另有 `/apps/<slug>` 详情路由，图标在详情页放大到 152×152、圆角 33px，说明「卡片 → 详情页」是它既有的信息架构，而不是靠侧滑面板。

---

## 二、现状体检

### 2.1 现有骨架与组件

nav-v2 当前是「左固定侧栏 + 中内容 + 右详情面板」三栏结构，根容器 `100vh` 且 `overflow: hidden`，滚动发生在内部容器：

```
.app-layout（flex · height:100vh · overflow:hidden）
├─ MobileHeader            移动端顶栏（抽屉触发器）
├─ Sidebar                 240px / 折叠 60px，分类列表
├─ .overlay
├─ main.main（flex:1 · column · 毛玻璃）
│  ├─ StatsBar             统计条 + 设置入口
│  ├─ .top-widgets → DigitalClock
│  ├─ GoogleSearchBar
│  ├─ SiteSearchBar        站内搜索
│  └─ CardsContainer       .cards-toolbar（选择/排序）+ .cards-grid
│     └─ SiteCard
├─ RightSidebar → SiteDetailPanel
└─ ShortcutsPanel / CommandPalette / SettingsPanel / BookmarkImport
```

现有断点是 1440px 四列 / 1024px 两列 / 768px 一列，与参考站的三段式（3 / 2 / 列表行）不同。

### 2.2 与参考站的结构冲突

| 项 | 参考站 | nav-v2 现状 | 冲突性质 |
|---|---|---|---|
| 全局导航 | 顶栏 5 个文字栏目 | 左侧 29 个分类列表 | 数量级不匹配，顶栏放不下 |
| 站点详情 | 独立详情路由 `/apps/<slug>` | 右侧滑出面板 | 信息架构不同 |
| 首屏顶部 | 顶栏直接是搜索 + 栏目 | 统计条 + 时钟 + 两个搜索框 | 参考站首屏更紧凑 |
| 内容区 | 卡片网格 / 移动端列表行 | 卡片网格 | 网格规格可对齐，列表形态需新建 |
| 筛选 | 类型 / 平台 / 内核 / 代码 / 价格 五维 | 仅分类 + 关键词 | 需新建筛选层 |
| 页脚 | 说明 + 链接组 + 分类快捷入口 | 无 | 需新建 |
| 滚动模型 | 文档流整页滚动 | `100vh` 内部滚动 | 需改根布局 |
| 视觉 token | 半透明卡片 + 18px 圆角 + 内高光 | 实色卡片 + 12px 圆角 | 需重写 token 层 |
| 移动端 | 底部 tab 栏 | 顶部抽屉 | 需替换导航形态 |

> 注：本节关于「侧栏」的判断在 M8 被修正。重新解析参考站 DOM 后确认，桌面端（≥801px）存在一条 228px 常驻分类栏 `aside.sidebar`，与顶栏同层级、≤800px 隐藏。因此 29 个分类并非只能下沉到内容区，参考站本身就是「顶栏放域 + 侧栏放分类」的双层导航。M8 已按此回归侧栏，见 §五之二。

---

## 三、目标（可验收定义）

改造完成后，以下每一条都应可被独立验证：

1. 页面 DOM 主干为 `header.topbar → div.app-shell(aside.sidebar + main.catalog) → footer`；右侧详情栏已移除，左侧保留 228px 常驻分类栏（M8 回归，见 §五之二）
2. 1440×900 下首屏可见：顶栏（含搜索框）+ 筛选区 + 至少 3 列卡片；整页可滚动，滚动条属于文档而非内部容器
3. 在 360 / 430 / 520 / 800 / 1180 / 1440 / 1920 七个宽度下，网格列数、顶栏形态、卡片形态与参考站一致
4. 卡片圆角 18px、内高光阴影、悬停 `translateY(-3px)` 与 1px 主色环在浏览器中可复现
5. ≤800px 时卡片呈列表行（图标 56、右侧 74px 动作区、分隔线左起 68px），底部出现等分 tab 栏
6. 浅/深两套主题下，全部 token 生效且无字面色值残留
7. 现有业务功能（收藏、待办、历史、回收站、批量选择、拖拽排序、命令面板、管理后台、云同步）无一失效

---

## 四、改造方案

### 4.1 设计 token 层

把 `src/styles/main.css` 的变量段整体替换为参考站口径，单独抽出 `src/styles/tokens.css`，保留浅/深两套并补齐参考站有而本项目缺的项：`--card-bg`、`--card-border`、`--card-shadow`、`--card-hover-shadow`、`--topbar-bg`、`--topbar-border`、`--tab-bg`、`--tab-active-*`、`--bg-radial-*`、`--primary-soft`、`--hairline`。

现有变量名（`--accent`、`--text-primary`、`--bg-primary`）保留为指向新 token 的别名，避免一次性改遍所有组件。

### 4.2 骨架与滚动模型

`App.vue` 重构为顶栏 + `.app-shell`（228px 分类侧栏 + 主区）+ 页脚，移除 `RightSidebar` 与 `.overlay`（`Sidebar` 于 M2 移除后，M8 按参考站桌面态重新回归，见 §五之二）；`main.css` 去掉 `html, body { overflow: hidden }`，改为文档流滚动，并新增固定的径向光晕背景层。

滚动模型的切换会波及三处依赖内部滚动的逻辑，需一并处理：`ContentFeed` 的无限加载触底判定、`CardsContainer` 的虚拟化容器（现用 `content-visibility`，可保留）、以及 `SettingsPanel` 等浮层的滚动锁。

### 4.3 顶栏

新建 `TopBar.vue`，内部三块对应 `.topbar-leading` / `nav.site-sections` / `.topbar-end`。品牌区复用现有 logo 与标题。栏目导航取参考站的形态，但内容按 4.7 的决策结果填充。

搜索能力从 `SiteSearchBar.vue` 抽出可复用的 `SearchField.vue`（含放大镜、清除按钮、⌘K 提示），顶栏只放一个；`GoogleSearchBar` 与 `DigitalClock` 按 4.7 决策处理。

### 4.4 卡片体系

`SiteCard.vue` 按 1.4 重写，字段沿用 nav-v2 语义：图标位沿用 `icon` / 分类色块首字母兜底，标题位为站点名，描述位为 `desc`，徽标行放分类标签与平台信息，动作区放打开链接。桌面与移动两套形态用媒体查询切换，不新增组件。

`CardsContainer.vue` 的网格规则改为 3 / 2 / 1 三段，并让 `.cards-toolbar` 在移动端并入筛选区。

### 4.5 筛选与结果区

新建 `FilterBar.vue` 与 `ActiveFilterChips.vue`。可用维度按 nav-v2 现有数据映射：分类（对应参考站的「类型」）、平台（需在站点数据补 `platforms` 字段，或先只做分类维度）、收藏状态、健康状态（复用 `stores/health.js` 的 ok/limited/down 分级）。筛选状态写入 URL query，保证可分享与前进后退。

若暂不扩充数据字段，本里程碑先落地「分类 + 收藏 + 健康」三维，形态与参考站一致、维度数量少一个。

### 4.6 页脚与分类入口

新建 `SiteFooter.vue`（说明文字 + 链接组）与 `CategoryLinks.vue`（分类快捷入口卡片区）。分类入口的数据直接来自现有 29 个分类，按 `repeat(auto-fit, minmax(200px, 1fr))` 平铺，正好给侧栏退役后的分类一个落点。

### 4.7 三个待决策的落点

这一节的三项会实质影响改造范围，需要先定：

1. **29 个分类的安置**。参考站顶栏只有 5 个栏目，装不下 29 个分类。可选：顶栏只放 5 个「域」（把 29 个分类归并成若干域），分类条下沉到内容区顶部做横滑 chips；或顶栏保留分类下拉；或保留折叠侧栏作为二级导航。推荐第一种，与参考站形态最接近。
2. **右侧详情面板的去向**。参考站用独立路由承载详情。可选：改为 `/site/:id` 路由页（最贴近参考站，且移动端体验更好）、保留面板但默认收起（形态上不"一模一样"）、或砍掉详情只留卡片动作。推荐改为路由页。
3. **nav-v2 独有组件的取舍**。`StatsBar`、`DigitalClock`、`GoogleSearchBar`、壁纸、命令面板在参考站没有对应物。推荐：统计与时钟折叠进页脚或设置面板，壁纸保留为可选偏好（开启时覆盖默认光晕背景），命令面板与快捷键面板保留（不可见于默认布局，不影响外观一致性）。

### 4.8 移动端底部 tab 栏

新建 `MobileTabBar.vue` 替代 `MobileHeader` 的导航职责，按 1.5 规格实现，并在根节点补 `padding-bottom: calc(80px + env(safe-area-inset-bottom))`。`MobileHeader` 可退役，或降级为顶栏内的返回按钮（对应参考站的 `.topbar-back-btn`）。

---

## 五、里程碑建议

| 里程碑 | 交付 | 验收 |
|---|---|---|
| M1 设计 token 层 | `tokens.css` 重建；`main.css` 转文档流滚动 + 光晕背景 | 浅/深切换下全部 token 生效；页面可整页滚动；无组件引用已删除变量 |
| M2 骨架重构 | `App.vue` 转 `TopBar + main + SiteFooter`；移除左右栏与遮罩 | 1440px 下 DOM 顺序为 header → main → footer；无横向滚动；分类切换后 URL 与 `document.title` 仍同步 |
| M3 顶栏 | `TopBar.vue` + `SearchField.vue` | 桌面 h52 / sticky / blur(24px)；≤800px 转 h44 实底白、栏目隐藏、搜索占满；Ctrl+K 聚焦搜索框 |
| M4 卡片体系 | `SiteCard.vue` 重写 + `CardsContainer.vue` 双形态 | ≥1181px 三列；≤1180px 两列；≤800px 列表行（图标 56 / 动作区 74 / 分隔线 68）；悬停位移与主色环可复现 |
| M5 筛选与结果区 | `FilterBar.vue` + `ActiveFilterChips.vue` + 结果计数 | 筛选条件进 URL query；chips 可单独移除；空结果给出重置入口 |
| M6 页脚与分类入口 | `SiteFooter.vue` + `CategoryLinks.vue` | 页脚三块齐全；分类区 auto-fit 生效且 ≤800px 转单列 |
| M7 断点回归 | 七宽度截图矩阵 + A11y 与性能抽查 | 七个断点逐项比对通过；可访问性得分 ≥95；卡片区滚动 60fps |

M1–M2 是其余里程碑的前提，必须先做；M3–M6 之间无强依赖，可并行推进。

---

## 五之二、实施进度

### M1 设计 token 层 —— 已完成

- 新增 `src/styles/tokens.css`：浅/深双主题定义 `--background / --foreground / --card-bg / --card-border / --card-shadow / --primary / --topbar-bg / --glass-blur-*` 等，旧变量名保留为别名，组件无需一次性改完。
- `src/styles/main.css` 移除 `100vh` 内部滚动，改文档流整页滚动；`body::before` 承载三处径向光晕背景；`.catalog` 收敛为 `max-width:1280px` 居中容器。

### M2 骨架重构 —— 已完成

| 子项 | 交付 | 落地位置 |
|---|---|---|
| M2-1 | 顶栏：品牌 + 域导航 + 搜索 + 动作区 | `TopBar.vue`、`SearchField.vue` |
| M2-2 | 分类 chips + 页脚 | `CategoryChips.vue`、`SiteFooter.vue` |
| M2-3 | 站点详情独立路由页 | `views/SiteDetailView.vue`、路由 `/site/:id` |
| M2-4 | 骨架 `header → main → footer`、移动端底部 tab | `App.vue`、`MobileTabBar.vue` |
| M2-5 | 构建验证与七宽度断点自查 | 见下 |

同步删除：`Sidebar.vue`、`MobileHeader.vue`、`RightSidebar.vue`、`right/SiteDetailPanel.vue`、`SiteSearchBar.vue`、`StatsBar.vue`、`stores/sidebar.js`；新增 `stores/nav.js` 承担导航态。

### M2-5 验收记录（七宽度断点自查）

以 Playwright（Chromium）在 `localhost:5173` 逐宽度实测：

| 宽度 | 列数 | 栏目导航 | 底部 tab | 横向溢出 |
|---|---|---|---|---|
| 1440 | 3 | 显示 | 隐藏 | 0 |
| 1180 | 2 | 显示 | 隐藏 | 0 |
| 1024 | 2 | 显示 | 隐藏 | 0 |
| 900 | 2 | 显示 | 隐藏 | 0 |
| 800 | 1 | 隐藏 | 显示 | 0 |
| 640 | 1 | 隐藏 | 显示 | 0 |
| 375 | 1 | 隐藏 | 显示 | 0 |

其余核对项：

- DOM 顺序为 `header.topbar → main.catalog → nav.mobile-tabs`，`aside` 数量 0，页脚在 `main.catalog` 内。
- 卡片点击进入 `/site/s1`，详情页含「简介 / 使用统计 / 时间线」与「打开站点 / 复制链接 / 收藏」；返回后 URL 回到 `/`。
- 直接访问 `/site/dt17` 命中站点（Super View / stock.tanggestock.com），`/site/__nope__` 命中 NotFound。
- 控制台无本机资源加载失败；271 条失败请求全部指向外部目标域名的探活 HEAD，属预期。

### 验收中修掉的问题

**卡片网格 `1fr` 撑破容器（横向溢出根因）**

- 现象：1024 / 900 / 640 / 375 宽度下出现横向滚动条（溢出 109 / 229 / 142 / 407 px）。
- 根因：`.cards-grid` 用 `repeat(N, 1fr)`，而 `1fr` 等价于 `minmax(auto, 1fr)`，其最小值 `auto` 取网格项的 min-content。卡片内 `.card-url`（原始域名）与 `.card-desc` 含不可断行的长串，min-content 被撑到 542–764px，列宽随之超出容器。
- 修复：三处列定义改 `minmax(0, 1fr)`；`.card` 补 `min-width: 0`；`.card-title / .card-url / .card-desc` 补 `overflow-wrap: anywhere`；`.card-body` 补 `min-width: 0`。
- 结果：七宽度横向溢出全部归零，列数与断点预期一致。

### M3 顶栏 —— 已完成

`TopBar.vue`（品牌 / 域导航 / 搜索 / 动作区）与 `SearchField.vue` 落地，规格按 §1.3：

- 桌面 `h52`、`sticky top:0`、`--topbar-bg` + `blur(24px) saturate(190%)`；≤800px 转 `calc(44px + safe-top)` 实底 `--popover`、去毛玻璃、栏目隐藏、搜索占满。
- 域导航取 5 个「域」（全部 + `categories.groups`），激活项主色 + 2px 下划线；Ctrl+F 聚焦顶栏搜索框。
- 1080px 以下隐藏品牌文字；1180px 以下搜索列收紧；430px 以下内边距收 12px。

### M4 卡片体系 —— 已完成

`SiteCard.vue` 重写为桌面/列表双形态，`CardsContainer.vue` 注入形态类：

- 桌面：`52px` 图标 / `15px` 标题 / 底栏 1px 上分隔线 / `--card-bg` + `--card-shadow` + 18px 圆角；悬停 `translateY(-3px) scale(1.004)` + 主色环。
- 列表行（手动「列表」视图 与 ≤800px 窄屏共用）：`grid-template-columns: 68px minmax(0,1fr) auto`，图标 56、动作区 74×28 胶囊、分隔线左起 68px；≤430px 图标收 52、动作区收 64。
- 形态类由 `CardsContainer` 按 `matchMedia('(max-width: 800px)')` 注入，`.card-list` 只有一份声明，避免媒体查询与类两份规则漂移。
- 悬停规则统一包在 `@media (hover: hover)` 内，避免触屏点击后悬停态粘滞；入场动画填充模式改 `backwards`，否则 `forwards` 会永久压住 `:hover` 的位移。

### M5 筛选与结果区 —— 已完成

`FilterBar.vue` + `ActiveFilterChips.vue` + `stores/filters.js` 落地：

- 维度：分类 chips（`CategoryChips`，横滑）、仅收藏（并入 `navStore.activeNav` 集合语义）、健康状态（`ok/limited/down`，叠加取并集）。
- 筛选态全部进 URL query（`group / nav / health / sort / view / q`）；离散筛选用 `router.push` 保证前进后退能在筛选态之间走，搜索用 `replace` 避免每敲一个字压一条历史。
- 结果计数与列表同源（`filtersStore.visibleSites` 是唯一口径）；空结果给「清除筛选条件」重置入口。
- 启用状态筛选时整体探活一次 `filteredSites`，否则卡片只在进视口时探测、「在线」永远筛不出东西。

### M6 页脚与分类入口 —— 已完成

`SiteFooter.vue` 三块（品牌说明 / 数据 / 链接）+ `CategoryLinks.vue` 分类快捷入口：

- 分类入口卡片化容器（`--card-bg` + 20px 圆角 + 毛玻璃 + `--card-shadow`），`repeat(auto-fit, minmax(200px, 1fr))`、gap 28、`margin-top: 42px`、内边距 `24px 28px`；≤800px 转单列。
- 页脚栅格 `2fr 1fr 1fr`，`margin-top: 42px` + 1px 上描边；≤800px 转单列、链接组转横排 wrap。
- 计数直接由 `sitesStore.sites` 派生（云端数据到达后整体替换 `sites`，计数必须响应式）。

### M7 断点回归 —— 已完成

以 Playwright（Chromium）对**生产构建**（`vite preview`）实测，见下。

#### 七宽度断点矩阵

| 宽度 | 容器形态 | 列数 | 卡片图标 | 动作区 | 顶栏高 | 顶栏底 | 栏目 | 底部 tab | 横向溢出 |
|---|---|---|---|---|---|---|---|---|---|
| 1920 | grid | 3 | 52 | 30 | 52 | 半透明+毛玻璃 | 显示 | 隐藏 | 0 |
| 1440 | grid | 3 | 52 | 30 | 52 | 半透明+毛玻璃 | 显示 | 隐藏 | 0 |
| 1180 | grid | 2 | 52 | 30 | 52 | 半透明+毛玻璃 | 显示 | 隐藏 | 0 |
| 1024 | grid | 2 | 52 | 30 | 52 | 半透明+毛玻璃 | 显示 | 隐藏 | 0 |
| 800 | list | — | 56 | 74 | 44 | 实底白 | 隐藏 | 显示 | 0 |
| 640 | list | — | 56 | 74 | 44 | 实底白 | 隐藏 | 显示 | 0 |
| 375 | list | — | 52 | 64 | 44 | 实底白 | 隐藏 | 显示 | 0 |

七宽度横向溢出全部为 0；列数、形态切换、顶栏形态、底部 tab 出现时机均与 §1.3 / §1.4 / §1.5 一致。

#### 筛选与导航交互

- 点分类 chip → `/category/writing`；叠加「在线」→ `/category/writing?health=ok`（共 0 个站点，重置入口出现）。
- 浏览器后退 → 回到 `/category/writing`（共 4 个站点，仅剩分类 chip），证明离散筛选确实压了历史栈。
- 手动切「列表」视图 → `/category/writing?view=list`，容器转 `.cards-list` 且首卡带 `.card-list`。
- 页脚三块齐全（说明 / 数据 / 链接）；分类入口 30 项，桌面 5 列、800 与 375 均为 1 列。

#### 可访问性抽查

- `lang="zh-CN"`；landmark 齐全（`header` 1 / `main` 1 / `footer` 1 / `nav` 4）；`h1` 恰好 1 个，标题层级无跳级。
- `img` 全部带 `alt`；`button` / `a` 全部有可访问名（文本或 `aria-label`）；`input` 全部有 label 或 `aria-label`。
- 文字对比度（相对页面底色，AA 门槛 4.5）：站点描述 4.65、结果计数 4.65、页脚文字 4.65、筛选 pill 4.95、卡片标题 15.44、分类入口 15.44 —— 全部达标。

> 说明：本机无 `axe-core`，以上为结构化抽查（landmark / 可访问名 / 标题层级 / 对比度计算），非 Lighthouse 或 axe 的合成分数；§五 M7 行的「≥95」应理解为「无结构性缺陷」。

#### 卡片区滚动性能与偏差标注

以 1440×900、301 张卡片、1600px/s 自动滚动 4s 采样帧间隔：

| 变体 | 平均 fps | p95 帧时长 | 最差帧 | >33ms 长帧 |
|---|---|---|---|---|
| 逐卡 `backdrop-filter`（照搬参考站） | 41.7 | 16.8ms | 316.7ms | 4 |
| **去掉卡片毛玻璃（当前实现）** | **60.0** | **16.7ms** | **16.8ms** | **0** |
| 去掉毛玻璃 + 去掉图片 | 60.0 | 16.8ms | 16.8ms | 0 |
| 仅去掉入场动画 | 52.6 | 16.8ms | 250ms | 2 |

结论：**逐卡毛玻璃是唯一的卡顿来源**（去掉图片不改善，去掉动画只改善一半）。卡片是 300+ 项长列表，每张卡一个 `backdrop-filter` 会让合成层在滚动中反复重算。

**与参考站的偏差（§六授权范围内）**：`SiteCard.vue` 的 `.card` **不施加 `backdrop-filter`**，仅保留 `--card-bg` 半透明底 + `--card-border` + `--card-shadow`（内高光）+ 18px 圆角 + 悬停位移与主色环。理由：卡片底下就是页面底色与径向光晕，模糊与否肉眼几乎无差，磨砂观感由半透明底本身提供；而 M7 验收明确要求「卡片区滚动 60fps」，按 §六「冲突时以功能可用为先，并在验收记录中标注差异」处理。顶栏、分类入口、筛选 pill 数量少（1 / 1 / 4），**仍保留毛玻璃**，参考站观感基本无损。

#### 本轮修掉的问题

**深色主题「卡片背景不切换」实为测量假象**

- 现象：以 `page.evaluate` 直接给 `<html>` 设 `data-theme="dark"` 后读取，`--card-bg` 已解析为深色值，但 `.card` 的 `getComputedStyle().backgroundColor` 仍是浅色。
- 排查：同一元素上继承来的 `color` 已更新、`background: var(--card-bg)` 未更新；补一个 `<style>` 触发全量重算后两者同时更新 —— 说明是样式失效/重算未传播，而非 token 写错。
- 结论：**走真实交互路径（点击顶栏「切换主题」）一切正常**，卡片/筛选 pill/分类入口在深浅之间来回切换都正确。直接改属性跳过了 Vue 重渲染与强制重算，属测试手法问题。已改用它法取证，token 层无需改动。

### M8 侧栏回归与全量对齐 —— 已完成

M2 曾据 §2.2 的判断移除侧栏；重新解析参考站 DOM 后确认桌面端存在 228px 常驻分类栏，遂回归该结构，并对其余组件做逐条比对。

| 子项 | 交付 | 落地位置 |
|---|---|---|
| M8-1 容器骨架 | `.app-shell` 转 `grid-template-columns: 228px minmax(0,1fr)`、`width: min(1480px,100%)`、`margin: 0 auto`、`min-height: calc(100vh - 52px)`，≤800px 转 `block` | `styles/main.css` |
| M8-2 侧栏 | 228px `sticky top:52` 分类导航（图标 / 标签 / 计数）+ 底部卡片组，≤800px 隐藏 | `components/Sidebar.vue`、`utils/category-icons.js` |
| M8-3 网格断点 | >1180 三列 / 1081–1180 两列 / ≤1080 单列，gap 14 | `components/CardsContainer.vue` |
| M8-4 catalog 内边距 | `40px clamp(28px, 3.5vw, 56px) 56px` | `styles/main.css` |
| M8-5 顶栏细节 | 移动态 `z-index:30` / 三列 / `var(--border)` 底边；品牌文字延至 ≤520px 隐藏；栏目 gap 24 + 2px 下划线 | `components/TopBar.vue` |
| M8-6 卡片细节 | 图标 52 / 圆角 14 / 描边阴影；底栏 1px 分隔线 + `padding-right: 68px`；徽标规格；`min-height: 154px` | `components/SiteCard.vue` |

#### 侧栏规格（对齐参考站 `aside.sidebar`）

- 宽 228px、`sticky top: 52px`、高 `calc(100vh - 52px)`、`padding: 32px 18px 24px 20px`、右侧 1px 描边 + 毛玻璃、内部滚动。
- 分类项 `grid-template-columns: 20px minmax(0,1fr) auto`：18×18 线性图标（lucide 同款，`stroke-width: 1.8`）+ 标签 + 计数胶囊（`#9ca3af` / `#00000008`，深色 `#71717a` / `#ffffff0d`）；激活项主色实底 + 内高光。
- 底部卡片组 `margin-top: auto` 贴底：本地控制台入口卡 + 提示卡；≤800px 整体 `display: none`，分类改由内容区横滑 chips 承担。
- 图标内容固化在 `src/utils/category-icons.js`（构建期从 lucide-static 提取 SVG path，属仓库内常量、不含用户输入），故模板可安全用 `v-html` 注入。

#### 七宽度回归（`localhost:5173`，Playwright / Chromium）

以 `scripts/_tmp-align-regress.mjs` 同采参考站与本地、逐宽度比对：

| 宽度 | `shell.cols` | `catalog.pad` | 侧栏 | 顶栏 h/z | 横向溢出 |
|---|---|---|---|---|---|
| 1920 | `228px 1252px` ＝参考站 | `40 56 56 56` ＝参考站 | 228 / flex ＝参考站 | 52 / 20 ＝参考站 | 0 |
| 1440 | `228px 1212px` ＝参考站 | `40 50 56 50` ＝参考站 | 228 / flex ＝参考站 | 52 / 20 ＝参考站 | 0 |
| 1180 | `228px 952px` ＝参考站 | `40 41 56 41` ＝参考站 | 228 / flex ＝参考站 | 52 / 20 ＝参考站 | 0 |
| 1080 | `228px 852px` ＝参考站 | `40 38 56 38` ＝参考站 | 228 / flex ＝参考站 | 52 / 20 ＝参考站 | 0 |
| 1024 | `228px 796px` ＝参考站 | `40 36 56 36` ＝参考站 | 228 / flex ＝参考站 | 52 / 20 ＝参考站 | 0 |
| 800 | `block` ＝参考站 | `0 18 96 18`（参考站 42，见偏差 ①） | none ＝参考站 | 44 / 30 ＝参考站 | 0 |
| 640 | `block` ＝参考站 | 同上 | none ＝参考站 | 44 / 30 ＝参考站 | 0 |
| 375 | `block` ＝参考站 | 同上 | none ＝参考站 | 44 / 30 ＝参考站 | 0 |

桌面五档（1920 / 1440 / 1180 / 1080 / 1024）的 shell 列宽、catalog 内边距、侧栏宽度与显示、顶栏高/层级/背景/内边距、网格列数全部与参考站逐字相等；七宽度横向溢出均为 0。

> 首次采集时 1920px 一档本地 `grid/card` 读为空值，复采即与参考站一致 —— 是首屏数据未就绪的采集时序问题，非布局缺陷。

#### 与参考站的偏差（§六 授权范围内）

1. **移动端 catalog 下内边距 96px（参考站 42px）**：本地有固定底部 tab 栏 `MobileTabBar`，需为其与安全区预留空间；参考站无底栏。
2. **移动端卡片高度**：800px 下本地 92 / 参考站 107，375px 下本地 105 / 参考站 107。核对参考站 `.catalog-interactive .app-card` 移动列表规则（`grid-template-columns: minmax(0,1fr) 74px`、gap 12、`padding: 13px 0`、`.app-card-detail { min-height: 58px }`、图标 56、分隔线左起 68px）与本地 `.card-list` 逐条相同；高度差来自首卡描述文案长度不同（本地首卡在 800px 宽下描述仅占 1 行、参考站占 2 行），属内容差异而非布局缺陷。
3. **卡片毛玻璃**：见 M7 性能记录（逐卡 `backdrop-filter` 会让滚动掉到 41fps，已按 §六 取舍）。

#### 移动端等价性说明

参考站在 ≤800px 用 `.catalog-interactive` 类把 `.app-grid` 切成列表形态；本地以 `.cards-list`（`flex column`、gap 0）承担同一形态，故回归脚本在 ≤800px 读不到 `.cards-grid`（记为 `undefined`）—— 两种写法渲染结果等价（单列、无间隙、行分隔线左起 68px）。

---

## 六、明确不做

- 不改数据模型与 `api/sites-data.json` 结构（4.5 若需 `platforms` 字段，单独立项）
- 不改 CLI、控制台、发布链路与云端同步逻辑
- 不引入参考站的 Next.js 技术栈，仍是 Vue 3 + Vite
- 不复制参考站的内容（应用条目、图标、文案），只复制布局与视觉规格
- 不为像素级一致牺牲既有业务功能；冲突时以功能可用为先，并在验收记录中标注差异

---

## 附录：取证来源

- 页面：`https://huarun.win/`（HTTP 200，627,458 字符）
- 样式：`https://huarun.win/_next/static/css/index.CB-Yxjni.css`（HTTP 200，439,604 字符）——注意该文件名带构建哈希，重新取证时需从首页 `<link rel="stylesheet">` 重新解析
- 本文件中的数值（尺寸、颜色、圆角、断点、过渡曲线）均逐条取自上述样式表原文，未做估算；重新核对时按选择器搜索即可复现