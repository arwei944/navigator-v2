# 卡片设置面板 — 设计说明

- 日期：2026-10-09
- 需求：「新增一个卡片设置面板，设置卡片的大小，每行排列数量，瀑布流还是固定卡片数量，以及一些其他可以设置的元素」
- 状态：**已实现并真机验证**

## 1. 关键约束：不立第二个真值来源

卡片的「每行卡片数 / 卡片间距 / 内边距 / 圆角 / 入场动画」**早就是 `utils/visualScheme.js` 的既有令牌**，只是入口在「设置 → 视觉方案」。因此本面板**复用同一批令牌**：

- 同一个 store（`preferences.visualOverrides`）、同一套取值校验（`resolveTokens` 按 TOKENS 类型与范围裁剪）、同一份持久化。
- 因此改动会记为「方案微调」，换视觉方案时回到新方案的预设，与「视觉方案」面板的微调是同一份数据 —— 只是换了入口，不是第二套设置。
- 新令牌加 `panel: 'card'` 标记，`VisualSchemeSection` 过滤掉它们，避免在视觉方案面板里重复堆叠。

## 2. 新增令牌

| 令牌 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `layoutMode` | select | `fixed` | `fixed` 固定列数 / `auto` 自适应宽度 / `masonry` 瀑布流 |
| `cardScale` | range 80–130% | 100 | 卡片大小：整体缩放图标与字号（间距另由 `cardPadding`/`gridGap` 管） |
| `cardMinWidth` | range 200–420px | 300 | 自适应排列下的卡片最小宽度，决定自动分几列 |
| `showHealth` | toggle | on | 在线状态角标 |
| `showHeat` | toggle | on | 热度（全网点击）徽章 |
| `showCategoryTag` | toggle | on | 分类标签 |
| `showPurposes` | toggle | on | 用途标签 |
| `showBadges` | toggle | on | 置顶 / 未访问徽章 |

派生 CSS 变量：`--card-scale`（无单位乘数，供 `calc()`）、`--card-min`。

## 3. 三种排列的实现与取舍

```css
.layout-fixed   { grid-template-columns: repeat(var(--grid-cols,3), minmax(0,1fr)); }
.layout-auto    { grid-template-columns: repeat(auto-fill, minmax(var(--card-min,300px), 1fr)); }
.layout-masonry { display: block; column-count: var(--grid-cols,3); column-gap: var(--grid-gap); }
```

**瀑布流用 CSS 多栏（`column-count`）而非 grid** —— `grid-template-rows: masonry` 至今未落地。由此带来两个必须告诉用户的代价，都已写进面板提示：

1. **阅读顺序变成「逐列自上而下」**，与逐行扫不同（CSS 多栏的固有行为，改不了）。
2. **拖拽排序被强制关闭**（`dragEnabled` 叠加 `layoutMode !== 'masonry'`），工具栏的「手动排序」按钮同时置灰并给出原因 —— 分栏后拖拽落点与视觉顺序对不上。

另外让瀑布流的描述**取消 2 行截断**（`:deep(.card-desc) { display:block; -webkit-line-clamp:unset }`）：否则卡片清一色等高，「瀑布」只是把逐行阅读换成逐列阅读，得不偿失。

**各模式的生效范围**在面板里明确标注（`is-inactive` 置灰 + 「当前排列下不生效」），避免「改了没反应」：

| 控件 | fixed | auto | masonry |
| --- | --- | --- | --- |
| 每行卡片数 | ✅ | ❌ | ✅（作为分栏数） |
| 卡片最小宽度 | ❌ | ✅ | ❌ |
| 卡片大小 / 间距 / 内边距 / 圆角 / 元素开关 | ✅ | ✅ | ✅ |

## 4. 形态：右侧抽屉而非居中弹窗

布局类设置**必须能即时看到效果**才能调。因此做成右侧抽屉（380px，不遮罩网格），调一次就能在左边直接看结果；移动端占满宽度。入口在工具栏的「卡片设置」按钮（网格+加号图标）。

## 5. 性能

卡片元素的显隐解算收在 `preferences.cardDisplay` 一个 computed 里（300 张卡片各自去读 `activeTokens` 这个深比较对象会重复解算），卡片只订阅这几个布尔值。

## 6. 真机验证（CDP 驱动 Chrome 154，1440×1000）

| 断言 | 结果 |
| --- | --- |
| 面板结构 | 4 组 14 行：排列 / 尺寸与间距 / 显示的元素 / 动效 |
| 固定列数 | `display:grid`，3 列，300 张卡高度全为 202px |
| 自适应 | `display:grid`，2 列（容器 ~900px ÷ 最小 300px） |
| 瀑布流 | `display:block`，`column-count:3`，高度分布 202×26 / 222×2 / 238×270 / 242×2，描述 `-webkit-line-clamp:none` |
| 卡片大小 130% | `--card-scale:1.3` → 图标 49.4px（38×1.3）、标题 18.2px（14×1.3） |
| 元素开关全关 | 在线角标 300→0、分类标签 300→0、用途标签 300→0 |

## 7. 受影响文件

新增：`src/components/CardSettingsPanel.vue`、本文件

修改：`src/utils/visualScheme.js`（令牌 + `CARD_PANEL` + CSS 变量）、`src/stores/preferences.js`（`cardLayoutMode` / `cardDisplay`）、`src/components/CardsContainer.vue`（三种排列的 CSS、瀑布流下禁用拖拽）、`src/components/SiteCard.vue`（元素显隐 + `--card-scale` 缩放）、`src/components/settings/VisualSchemeSection.vue`（过滤 `panel:'card'`）、`src/components/MainToolbar.vue`（入口按钮 + 瀑布流下置灰拖拽）、`src/App.vue`（渲染面板）
