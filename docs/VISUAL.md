---
# 历史溯源引用：卡片体系的令牌由这份计划引入，文档本身已归档，不再作为现行依据。
historical-links:
  - docs/NAV-v7-card-system-upgrade-plan.md
---

# 视觉契约（VISUAL）

> 这份文档是「项目所有和视觉有关的实现与设置」的统一入口。
> **改任何颜色 / 圆角 / 间距 / 字号 / 阴影 / 动效之前，先读这里。**
> 由 `tools/console/test-visual-layer.mjs` 守卫（门禁清单见文末）。

---

## 一句话模型：三道接力，单一真值

```
真值来源   src/utils/visualScheme.js        ← 令牌登记表 → 令牌 → CSS 变量（tokensToCssVars）
   │        每套方案（SCHEMES）是完整取值，用户微调存 overrides
   ▼ 运行时由 src/stores/preferences.js 写到 :root 行内样式
运行落地   浏览器 :root 上的 CSS 变量         ← 全站 40+ 组件消费这些变量
   │        深色时 [data-theme="dark"] 覆盖
   ▼ JS 尚未执行时
首帧兜底   src/styles/main.css 的 :root       ← 防止首帧闪一个无样式空壳
```

**改视觉 = 改真值来源（`visualScheme.js` 或它的设置入口），不要在组件里另写一份。**
`main.css` 的 `:root` 只是首帧兜底，**它必须与真值逐一相等** —— 由门禁 ① 校验（归一化比较：
`#e5e5e7 ≡ rgb(229,229,231)`、`0.15s ≡ 150ms`、`0.72 ≡ 0.720`）。

---

## 令牌体系

- **22 个令牌 · 7 个维度 · 8 套预设方案**（`SCHEMES`）。每套方案都是**完整取值**，不依赖继承，切换即整体换装。
- 用户可在方案基础上逐项微调，微调值存 `overrides`，与方案合并后生效（`resolveTokens`）。
- 令牌 → CSS 变量的映射在 `tokensToCssVars()`。

| 维度 | 令牌 |
|---|---|
| 形状 shape | `radiusCard` `radiusControl` `borderStrength` |
| 层次 elevation | `shadowLevel` |
| 密度 density | `cardPadding` `gridGap` `gridCols` `navItemHeight`（+ 卡片面板：`layoutMode` `cardMinWidth` `cardScale`） |
| 玻璃 glass | `glassBlur` `glassAlpha` |
| 字体 type | `fontFamily` `fontSizeBase` `titleWeight` |
| 动效 motion | `motionDuration` `cardAnim`（+ 显隐：`showHealth` `showHeat` `showCategoryTag` `showPurposes` `showBadges`） |
| 图表 chart | `chartRadius` `chartHeight` `chartArea` |

> 「卡片设置」面板**复用同一批令牌**（同一个 store / 同一套校验 / 同一份持久化），
> 不是第二套设置 —— 因此面板里改的每一项都能被方案预设覆盖、被「恢复方案默认」重置。

---

## 语义色两套（**刻意不合并**，别混用）

| 体系 | 定义处 | 用途 | 随什么变 |
|---|---|---|---|
| `--color-ok` `--color-warn` `--color-danger` `--color-muted` `--color-favorite` … | `visualScheme.js` 的 `SEMANTIC` | 卡片的状态点 / 热度徽章 / 收藏星 | 主题明暗 |
| `--ok-fg` `--ok-bg` `--ok-border` `--warn-*` `--danger-*` `--info-*` | `main.css` | 后台提示条 / 状态徽章（固定的「深字浅底」可读组合） | 主题明暗 |

两者是**同一语义（ok/warn/danger）的两种用法**，用途与生命周期不同，所以不合并；
但两者**都必须随明暗切换**（门禁 ② 校验），否则暗色下会亮底刺眼、深字不可读。
`--color-ok` 不是「上游」，`--ok-fg` 也不是它的别名 —— 换配色时两处都要顾及。

### 彩色底上的前景色：`--on-accent`

主按钮、危险按钮、状态徽章、头像字母这类**有彩色底**的表面，文字与图标一律用
`var(--on-accent)`，不要再写 `#fff`。

此前是 40 处散落的 `#fff`，语义完全相同（“在强调色上反白”）却没有任何地方表达它，
于是每个新组件都重新写一遍。收敛后换强调色或做高对比主题时，改一处即可。

它**刻意不进 `visualScheme`**：与 `--z-*` / `--dur-*` 同理，是固定架构常量，
不是用户可调的视觉方案参数。

---

## 层级（z-index）—— 第三套「刻意不进 TOKENS」的真值

浮层叠放次序的真值**只有一处**：`main.css` 的 `:root` 里那 24 个 `--z-*`。

- **为什么不在 `visualScheme.js`**：层级是**固定的架构不变量**，不是用户可调项。
  把 `--z-modal` 放进 `TOKENS`，用户就能把模态框调到卡片下面 —— 那不是「个性化」，
  是「弄坏」。它与「后台徽章语义色」同类：同属视觉，但生命周期不同，刻意分开。
- **组件里只许写 `var(--z-*)`**，不许写 `z-index: 960`。此前 37 处硬编码散落 27 个文件、
  值域 1–9999，新增浮层只能猜数字（**两个 1000 同值是现成的反例**：谁在上面取决于引入顺序）。
- 令牌的**数值与收敛前逐一相等** —— 这次只做命名化，叠放次序零变化。

| 令牌 | 值 | 用途 |
|---|---|---|
| `--z-content` / `--z-card` / `--z-inline` | 1 / 2 / 5 | 内容与卡片内的小元素 |
| `--z-handle` / `--z-pin` / `--z-dropdown` | 10 / 20 / 40 | 栏内把手、固定件、下拉 |
| `--z-rail` / `--z-header` / `--z-scrim` / `--z-bar` / `--z-tabbar` | 50 / 60 / 90 / 100 / 150 | 主壳：右栏、顶栏、遮罩、侧栏、底栏 |
| `--z-float` / `--z-modal-sm` / `--z-dialog` | 200 / 300 / 400 | 浮层、小模态、对话框 |
| `--z-dock` / `--z-editor` / `--z-board` / `--z-menu` | 420 / 470 / 480 / 500 | 便签坞、主题编辑器、便签板、右键菜单 |
| `--z-toast` / `--z-sheet` / `--z-panel` / `--z-modal` | 700 / 900 / 960 / 1000 | 提示、抽屉、设置面板、顶层模态 |
| `--z-command` / `--z-top` | 2000 / 9999 | 命令面板、最高层（跳转链接） |

---

## 动效时长 —— 第四套「在 main.css、不在 TOKENS」的真值

transition 的时长只有 **3 档**，定义在 `main.css` 的 `:root`：

| 令牌 | 值 | 用途 |
|---|---|---|
| `--dur-fast` | 0.15s | 悬停 / 颜色 / 边框（主力档） |
| `--dur-base` | 0.2s | 出现 / 消失 / 位移 |
| `--dur-slow` | 0.28s | 面板展开收起 / 布局变化 |

- 此前组件里散落 **93 处**硬编码时长（`.1s/.12s/.15s/.18s/.2s/.24s/.25s/.28s/.3s/.35s`），
  且只改得动一半（另一半早走了 `var(--transition)`）。现已全部归并到这 3 档，
  各档与原值偏差 ≤ 0.07s（观感一致）。
- **为什么不在 `visualScheme`**：与层级同理 —— 时长是设计常量，不是用户可调项。
  （`visualScheme` 里那个 `motionDuration` 是「整体动效开关」，与此不同。）
- **`--transition` 保持字面量**（`0.15s ease`）：它是「时长 + 缓动」的完整值、被 58 处
  按完整值引用，且门禁 ① 要求它与 `visualScheme` 真值逐一相等 —— 所以**不写成 `var()`**。

---

## 响应式断点 —— 第五套「不能做成 CSS 变量」的真值

**技术约束**：媒体查询条件里**不能用 `var()`**（CSS 自定义属性在 `@media` 中无效），
所以断点无法像颜色/时长那样令牌化。统一方式是**两条腿**：

| 腿 | 做法 |
|---|---|
| **JS 侧** | 一律 `import { MOBILE_QUERY, NARROW_QUERY, isMobileWidth, safeMatchMedia } from '@/utils/breakpoints'`，**不在组件里写死数字** |
| **CSS 侧** | `@media` 的值必须来自 `src/utils/breakpoints.js` 的 `LOCKED_VALUES`（门禁 ⑥ 守卫）——**新增断点必须先登记** |

真值来源 `src/utils/breakpoints.js` 的档位清单（值 = 现有在用值，纯登记）：

| 值 | 语义名 | 归属 |
|---|---|---|
| 520 | `xs` | AdminLogin 窄屏表单 |
| 560 | `sm` | AboutView 窄屏排版 |
| **768** | `md` | **主断点**：移动端切换（全局 20+ 处） |
| 820 | `md-alt` | AdminView 双栏折叠 |
| 900 | `lg` | 后台三栏折叠（AdminInsights / InsightsView 等） |
| 1024 | `xl` | 右栏折叠 + MainToolbar 换挡 |
| 1300 / 1360 / 1500 | `tb-1/2/3` | MainToolbar 间距微调 |
| 769 | — | **互补表达**：`min-width:769px ≡ 非移动端`（与 768 同一档，登记防误判为新断点） |

- 此前 JS 侧有 **4 处硬编码 `768`**（`App.vue` ×2、`StickyBoard.vue`、`sidebar.js`），
  且 `MOBILE_QUERY` / `NARROW_QUERY` 是 `Sidebar.vue` / `RightSidebar.vue` **各定义一份**。
  现已全部收敛到 `breakpoints.js`，JS 侧硬编码清零。
- **`RightSidebar` 的 `NARROW_QUERY` 是承重墙**：右栏宽度由内联样式下发，内联宽度会盖掉
  媒体查询，所以这个断点**必须同时**由 JS 判断 —— 改它前先读该组件注释。

---

## 展示格式（时间 / 字节 / 时长）—— 真值在 `shared/format.mjs`

数字怎么显示也是视觉的一部分：同一个时间在侧栏、后台、控制台里格式各样，观感就散了。
全项目**唯一实现**是 `shared/format.mjs`，三边都从它取（与 `host.mjs` 同一套路）：

| 侧 | import 写法 |
|---|---|
| 前端组件 | `import { fmtDateTime } from '@/utils/format'` —— `src/utils/format.js` 只做**转发** |
| 控制台 UI | `import { fmtDateTimeCompact } from '/shared/format.mjs'`（服务器有 `/shared/` 静态路由） |
| CLI | `import { fmtDateTimeShort } from '../../../shared/format.mjs'` |

| 函数 | 输出 |
|---|---|
| `fmtDateTime(ts)` | `2026/10/19 17:23:49`；非法值**回落原值** |
| `fmtDateTimeSec(ts, fb)` | 同上 + 24 小时制；空 / 非法 → `fb`（默认 `—`） |
| `fmtDateTimeShort(ts, fb)` | `2026-10-19 17:23` |
| `fmtDateTimeCompact(ts, fb)` | 年内 `10/19 17:23`，跨年补 `2025/` 前缀 |
| `fmtClockTime(ts, fb)` | `17:23:49` |
| `fmtRelative(ts, { fallback })` | 刚刚 / N 分钟前 / N 小时前 / N 天前；超 30 天走 `fallback` |
| `fmtBytes(n)` | `953.7 KB` / `1.0 MB`（一位小数） |
| `fmtDurationZh(sec)` | `5 分 12 秒`（**入参是秒**） |
| `fmtMillis(ms, fb)` | `85ms` / `1.2s` |

**刻意不在这里**（同名或近名，但语义不同，别混）：

- `shared/uptime.mjs#fmtDuration(ms)` —— CLI 的监控停机时长，英文缩写（`5m12s`）、
  **入参是毫秒**。所以中文版命名为 `fmtDurationZh`，避免同名不同义。
- `src/utils/bgmScore.js#fmtClock(sec)` —— 音乐播放进度 `mm:ss`，是 `test-bgm` 的契约。
- `shared/host.mjs#hostOf` / `siteDraft.rawHostOf` / `search.hostMainOf` —— 三种域名口径
  （小写去 www / 保留原文 / 只取主体），**各有用途不是重复**，别合并。

---

## 改视觉该改哪（决策表）

| 想改什么 | 改哪里 |
|---|---|
| 某套预设方案的整体观感 | `SCHEMES` 里那套的 `tokens` |
| 加一个可调项 | `TOKENS` 登记 → 每套 `SCHEMES` 补默认 → `tokensToCssVars` 加映射 |
| 明暗两套的语义色 | `SEMANTIC`（卡片侧）／`main.css` 的 `:root` + `[data-theme="dark"]`（后台徽章侧） |
| 内置配色预设 | `src/utils/themeSchema.js`（`THEME_PRESETS`） |
| 用户默认值 | `TOKENS[k].default`（`DEFAULT_TOKENS` 随之生成） |
| 首帧兜底 | 一般**不改**；真值变了才同步 `main.css`（门禁 ① 会验） |
| **浮层叠放次序** | `main.css` 的 `:root` 里那 24 个 `--z-*`（**唯一真值**，组件只许引用） |
| **动效时长** | `main.css` 的 `:root` 里那 3 个 `--dur-*`（**唯一真值**，组件只许引用） |
| **响应式断点** | `src/utils/breakpoints.js`（JS 侧 import；CSS 侧新增值必须先登记） |
| **时间 / 字节 / 时长的显示** | `shared/format.mjs`（**唯一实现**；前端经 `@/utils/format` 转发） |

---

## 加一个新令牌的流程

1. 在 `TOKENS` 登记：`{ dim, label, type, min, max, step, unit, default }`
2. **每套 `SCHEMES` 都要显式带上它** —— 测试守卫要求「方案完整取值」，
   防的是「方案漏定义 → 悄悄继承默认 → 谁生效说不清」。无个性时统一展开中性常量。
3. 在 `tokensToCssVars()` 里加 `--变量` 映射。
4. 若需要首帧兜底，在 `main.css` 的 `:root` 同步一份（否则门禁 ① 红）。
5. 跑 `npm run console:test:visual-scheme` + `npm run console:test:visual-layer`。

---

## 硬编码颜色政策

- **该走令牌**：跟随主题 / 方案变化的颜色 —— 背景、文字、边框、状态色。组件里只许
  写 `var(--x)`，不许写死 `#xxxxxx` / `rgb(...)`。
- **可以硬编码**：**不随主题变**的布局值 —— 纯黑/白遮罩、结构性透明叠加（这些是 `rgba(...)`）、
  以及 favicon 图片的白色衬底（它必须恒白，跟随主题反而会让深色图标消失）。
  它们不计入门禁基线。
- **`var(--token, #fallback)` 里的兜底值不计入**：那恰恰说明作者走了令牌，只是考虑了
  变量缺失时的表现。把它计入会让计数虚高、并稀释真正该还的裸实色。
- 门禁 ③ 统计「不透明实色（`hex` / `rgb()`）」的**存量，只减不增**：
  - `total` 是存量上限，**只许下调**（门禁用 `loweredFrom` 拦住“抬高基线”）。
  - `target` 是本季要还到的值。实际值达到后，把它写回 `target` 让闸门继续下压 ——
    否则基线会变成一个永久地板，数字满格反而诱导“改基线”而不是“用令牌”。
- 确有新增（布局必需），更新 `tools/console/visual-layer-baseline.json` 的 `history`
  并在 commit 里补一句为什么。

---

## 门禁

| 门禁 | 守什么 |
|---|---|
| `test-visual-scheme` | 令牌登记表自洽、方案完整取值、合并与落变量的纯函数行为 |
| `test-visual-layer` | ① 兜底 `==` 真值（防双源漂移）② 语义色明暗成对 ③ 硬编码不超**递减目标**（口径排除 var 兜底；基线只许下调）④ **层级走令牌** ⑤ **动效时长走令牌** ⑥ **响应式断点走登记档位** ⑦ 本契约存在 |
| `test-color-tokens-real` | 真机读计算样式：令牌可解析、彩色底按钮真的反白、无失效的 `var()`、**真实切换主题后令牌跟着变**（静态检查抓不到 `var()` 静默失效） |
| `test-format` | 格式化实现只住在 `shared/format.mjs`（`src/` 与 `tools/` 运行代码内无散落指纹） |
| `test-theme` / `test-theme-boot` | 主题切换与首屏引导（防闪烁） |
| `test-contrast` | 明暗两套对比度达 WCAG AA |

---

## 相关文档

- [卡片设置面板设计](2026-10-09-card-settings-panel-design.md) —— 卡片令牌的聚焦入口
- [卡片体系升级计划](NAV-v7-card-system-upgrade-plan.md) —— 令牌体系的由来
