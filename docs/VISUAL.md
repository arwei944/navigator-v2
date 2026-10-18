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
- **可以硬编码**：**不随主题变**的布局值 —— 纯黑/白遮罩、结构性透明叠加（这些是 `rgba(...)`）。
  它们不计入门禁基线。
- 门禁 ③ 统计「不透明实色（`hex` / `rgb()`）」的**存量，只减不增**。确有新增，
  更新 `tools/console/visual-layer-baseline.json` 并在 commit 里补一句为什么。

---

## 门禁

| 门禁 | 守什么 |
|---|---|
| `test-visual-scheme` | 令牌登记表自洽、方案完整取值、合并与落变量的纯函数行为 |
| `test-visual-layer` | ① 兜底 `==` 真值（防双源漂移）② 语义色明暗成对 ③ 硬编码不超基线 ④ 本契约存在 |
| `test-theme` / `test-theme-boot` | 主题切换与首屏引导（防闪烁） |
| `test-contrast` | 明暗两套对比度达 WCAG AA |

---

## 相关文档

- [卡片设置面板设计](2026-10-09-card-settings-panel-design.md) —— 卡片令牌的聚焦入口
- [卡片体系升级计划](NAV-v7-card-system-upgrade-plan.md) —— 令牌体系的由来
