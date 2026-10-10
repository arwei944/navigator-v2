# v8 升级方案：智能化 + 主题体系 + 便利贴 / 实时备注

**日期**：2026-10-11
**状态**：**已实施**（P0–P4 全部落地；P5「数据自愈 + AI 增强」按 §13 的拍板暂缓，视效果决定）
**范围**：三条主线 —— ① 让导航站从「能搜」进化到「懂你要什么」；② 把散落三处的主题能力收敛成一套可造、可换、可分享的主题体系；③ 新增便利贴与站点实时备注（输入即存、多标签页/多设备可见）。

---

## 1. 目标与验收口径

| 诉求 | 可验收的口径 |
| --- | --- |
| 更智能 | 输入「免费的 AI 画图工具」能自己落到 `分类=AI × 用途=图像 × 免费`，而不是返回一堆包含「免费」二字的卡；工作日晚 20 点打开首页，前排是昨晚那几个常开的站，不是按收录顺序排的站 |
| 主题功能 | 用户能在 30 秒内**造出**一个自己的主题（选色 / 从壁纸取色 / 调令牌），一键导出分享；能跟随系统明暗、能在日落自动换深色；**老用户升级后外观不能变** |
| 便利贴 | Ctrl+Alt+N 出一枚便签，拖动/改色/钉住/Markdown-lite，关掉浏览器再开还在，换设备（开了会话同步）也在 |
| 实时备注 | 在站点详情里打字，300ms 内落盘；同一浏览器开两个标签页，A 页改完 B 页 1 秒内跟着变；开了会话同步则在另一台设备上看得到；备注内容能被全能框搜到 |

### 非目标（明确排除，防止范围失控）

| 排除项 | 理由 |
| --- | --- |
| 多人协作 / 评论 @ 人 / 权限 | 本项目是个人导航站，会话数据按 session key 隔离，没有账号体系；协作需要另建身份层，不在本版 |
| 富文本编辑器（加粗工具栏、图片、表格） | 便签与备注的定位是「顺手记一句」，Markdown-lite + 纯文本够用；引入富文本会带进体积与 XSS 面 |
| 自建大模型推理 / 向量库 | 站内 300 条数据，规则 + 统计足够；AI 只做**可选增强**，无 key 时全功能降级 |
| 把便利贴和待办合并成一种数据 | 两者语义不同：待办是要做完的事（有 done 状态、有进度），便利贴是要看见的信息（有位置、有颜色）。合并会让两边都别扭 |
| 主题改版顺手重做视觉 | **行为等价铁律**：现有 4 套配色 + 6 套方案的观感必须逐项对齐，迁移后截图比对不得有差异 |

---

## 2. 现状诊断

### 2.1 主题：三套机制并存，用户搞不清谁管什么

| 现状 | 位置 | 问题 |
| --- | --- | --- |
| `THEME_PRESETS`（默认蓝/极客绿/赛博紫/日落橙） | `stores/preferences.js` | 只管 5 个颜色变量，硬编码在 JS 里，**用户造不出新配色**；切换靠 `applyPreset()` 直接 `setProperty`，与令牌系统各写一套 |
| `visualScheme`（6 套：苹果原生/极简扁平/玻璃拟态/紧凑/宽松/高对比） | `utils/visualScheme.js` | 管形状与质感（圆角/阴影/毛玻璃/字号/动效），**与配色是两套 UI**（设置面板「外观」vs「视觉方案」），用户不知道该先点哪个 |
| `visualOverrides` | 同上 | 令牌微调，但**换方案会被清空**（`setVisualScheme` 里 `visualOverrides = {}`），用户调了半天一换方案全丢 |
| 明暗 | `preferences.theme` + `data-theme` | 没有跟随系统、没有定时切换 |
| 壁纸 | `preferences.wallpaper` | 只能填 URL，没有内置图库、没有遮罩（浅色壁纸会把字吃掉） |

结论：不是缺功能，是**缺一个统一的主题对象**。三套机制应当收敛成「一份主题快照 = 配色 + 令牌 + 壁纸 + 切换策略」。

### 2.2 便利贴 / 备注：完全没有

- `stores/todos.js` 是唯一接近的「随手记」，但它是**列表模型**（无位置、无颜色、无富信息），且只停在 localStorage。
- 站点上没有任何个人化附着信息：想记「这个站免费额度每月 50 次」只能记在别处。
- 会话同步已覆盖 favorites / todos / history / preferences，但**字段白名单写死**在 `services/session.js#snapshotFromStores`，加字段要改两处（快照 + 回填）。

### 2.3 智能化：有「状态感知」，没有「意图理解」

| 现有 | 评价 |
| --- | --- |
| `stores/health.js` 在线状态角标 | 有用，但只是 HTTP 状态码，探测出 404 也不会有任何后续动作 |
| `ContentFeed.vue` 最近访问 / 热门站点 | 是**统计**不是**推荐**：热门是全局点击量，与「你」无关；没有时间衰减，半年前点过的站永远在前排 |
| `utils/search.js` 14 档评分 + 拼音 | 检索内核扎实，但只接受关键词，**不接受一句话** |
| 自动分类 / 自动添加 | 是入库侧的自动化，不是使用侧的智能化 |
| `api/metadata.js` 元信息抓取 | 只在添加站点时用一次；库里缺描述的站没人管 |

结论：智能化要做的是把「你已经采集到的信号」（history / clicks / health / purposes）**用起来**，而不是先去接一个大模型。

---

## 3. 总体架构

```
┌────────────────────────────────────────────────────────────────┐
│ 表现层                                                          │
│  ThemeMarket.vue   ThemeEditor.vue     ← 设置面板「主题」        │
│  StickyBoard.vue   StickyNote.vue      ← 便签墙（全局浮层）      │
│  NoteBadge / SiteNoteEditor.vue        ← 卡片角标 + 详情面板      │
│  SmartBar.vue（此刻推荐横条）           ← 首页顶部                │
│  IntentChip.vue（智能筛选提示条）       ← 全能框下方              │
├────────────────────────────────────────────────────────────────┤
│ 状态层（Pinia，全部版本化持久化）                                │
│  stores/theme.js   ← 新增：主题真值（合并 preset + scheme + 壁纸）│
│  stores/notes.js   ← 新增：便利贴（含位置/尺寸/颜色/钉住）        │
│  stores/siteNotes.js ← 新增：站点备注 + 墓碑 + LWW 合并           │
│  stores/preferences.js ← 保留，主题字段改为转发 theme store       │
├────────────────────────────────────────────────────────────────┤
│ 计算层（纯函数，可单测）                                         │
│  utils/themeSchema.js  主题定义 / 校验 / 序列化 / 分享码          │
│  utils/intent.js       自然语言 → 结构化筛选                     │
│  utils/smartRank.js    时段×频次衰减×共现 → 此刻推荐              │
│  utils/noteSync.js     BroadcastChannel 协议 + LWW 合并           │
├────────────────────────────────────────────────────────────────┤
│ 传输层                                                          │
│  BroadcastChannel('nav-live')  同浏览器多标签页，秒级             │
│  /api/session（扩展字段）       跨设备，沿用现有 key 鉴权与体积门禁│
│  /api/ai（可选，P5）            有 key 才启用，无 key 全功能降级   │
└────────────────────────────────────────────────────────────────┘
```

**三条数据归属的铁律**（决定了后面所有实现细节）：

1. **站点表（`sites.json`，云端公共）不存任何个人数据。** 备注、便签、推荐权重一律不放进去 —— 否则一次发布就会把个人的批注冲掉，而且 300 人的批注互相可见。
2. **个人数据走 session（`/api/session`，按 key 隔离）**，与站点热更新互不干扰，这是现有设计已经铺好的路。
3. **本地 localStorage 永远是第一落点**，云端只是同步目标。离线也能写，联网后补推。

---

## 4. 主题体系 v2

### 4.1 主题对象（唯一真值）

```js
// utils/themeSchema.js
{
  id: 'user:my-ink',            // builtin:* 为内置，user:* 为用户自建
  name: '水墨',
  version: 1,
  base: 'light',                // light | dark —— 该主题「设计于」哪种模式
  follow: 'manual',             // manual | system | schedule
  schedule: { from: '19:00', to: '07:00', fallback: 'manual' },
  colors: {                     // 明暗两套都要给，缺失则按 base 反推
    light: { primary, bg, bgWhite, sidebarBg, accent, accentLight, text, textSub },
    dark:  { ... }
  },
  tokens: { radiusCard: 12, shadowLevel: 100, glassBlur: 20, ... },  // 复用现有 TOKENS 表
  wallpaper: { type: 'none'|'url'|'gradient'|'builtin', value, blur: 8, mask: 0.35, fit: 'cover' },
  builtin: false
}
```

关键点：**`colors` 与 `tokens` 合成一份**，一次切换整体换装。现有「配色预设」与「视觉方案」两个 UI 合并为设置面板里的一个「主题」分区：上面是主题卡片网格（市场），下面是「编辑当前主题」（编辑器）。

### 4.2 内置主题（8 套 = 6 套现有方案 + 2 套新增）

| 主题 | base | 对应现有资产 | 说明 |
| --- | --- | --- | --- |
| 苹果原生 | light | scheme `apple` + accent `default` | 当前默认，逐项对齐 |
| 极简扁平 | light | scheme `flat` + accent `default` | |
| 玻璃拟态 | light | scheme `glass` + accent `purple` | |
| 紧凑高密度 | light | scheme `compact` + accent `green` | |
| 宽松舒适 | light | scheme `cozy` + accent `orange` | |
| 高对比硬朗 | dark | scheme `contrast` + accent `default` | |
| 宣纸 | light | **新增**（暖白底 + 墨色字 + 松石绿点缀 + 衬线标题） | |
| 夜航 | dark | **新增**（深墨蓝 + 低饱和青 + 关闭毛玻璃） | |

> 「宣纸」的取值需与用户确认（用户偏好中式纸感美学），本版先按 `#faf8f3` 底 + `#1f2328` 字 + `#0f766e` 点缀落地。

### 4.3 迁移：`preferences` → `theme`（**行为等价**）

现有持久化字段 `theme / themePreset / visualScheme / visualOverrides / wallpaper / wallpaperBlur` 必须原样迁移，用户升级后看到的界面**一帧都不许变**：

```
读旧值 → scheme = SCHEMES[visualScheme]，preset = THEME_PRESETS[themePreset]
       → 造一个 id='user:migrated' 的主题：
           colors = preset（含 .dark 两套）
           tokens = resolveTokens(scheme.id, visualOverrides)   // 微调并进去，不再丢
           wallpaper = { type: wallpaper ? 'url' : 'none', value: wallpaper, blur: wallpaperBlur?8:0 }
       → 写入 theme store，旧字段保留一个版本周期后移除（storeVersioning 已有迁移钩子）
```

迁移后 `visualOverrides` 不再被换方案清空（这是旧实现的一个真实缺陷，见 §2.1）。

### 4.4 主题编辑器

- **取色**：`accent` 主色 + 4 个语义色（成功/警告/危险/收藏）可调，其余色由主色按 OKLCH 明度反推（避免用户调出不可读的浅字浅底）。
- **从壁纸取色**：`<canvas>` 缩到 32×32 取样，取 3 个主色（k-means 简化为亮度分桶取均值），一键应用到 accent / sidebarBg / bgWhite。**零依赖**。
- **令牌滑块**：复用现有 `TOKENS` 表与 `VisualSchemeSection` 的控件渲染，新增 `panel:'theme'` 标记的令牌（壁纸模糊/遮罩/强调强度）。
- **实时预览**：编辑器是右侧抽屉（与 `CardSettingsPanel` 同形态），改动即时落到 `:root`，取消则回滚快照。
- **分享**：主题序列化 → JSON 下载；或压缩成分享码（`btoa(JSON)` 精简字段）塞进 `?theme=` 链接，打开即应用预览。

### 4.5 切换策略

| 模式 | 实现 |
| --- | --- |
| 手动 | Ctrl+D（现成绑定，改走 theme store） |
| 跟随系统 | `matchMedia('(prefers-color-scheme: dark)')` + `change` 事件；用户手动切过则临时覆盖，直到系统再次变化 |
| 定时 | 本地时间落在 `[from, to]` 区间内取深色；跨零点区间按 `from > to` 处理。日落时间不做（要经纬度/网络，收益不抵复杂度） |

**落地优先级**：手动 → 跟随系统 → 定时。前两个 P3，定时 P3 尾部。

---

## 5. 便利贴（Sticky Notes）

### 5.1 数据模型

```js
// stores/notes.js
{
  id: 'n_a1b2',
  text: 'Vercel 免费额度：每月 100GB 流量',
  color: 'yellow',           // 6 色板，取值走语义 token，不写死
  x: 320, y: 180,            // 便签墙坐标（px，相对墙左上角）
  w: 240, h: 180,
  z: 3,
  pinned: false,             // 钉住 = 常驻首页浮层，不随墙折叠
  collapsed: false,
  boardId: 'default',        // 预留多墙
  createdAt, updatedAt, rev: 1
}
```

### 5.2 两种形态

| 形态 | 触发 | 行为 |
| --- | --- | --- |
| **便签墙** | 工具栏按钮 / 命令「便利贴」/ `Ctrl+Alt+N` | 全屏浮层（挂 `app-layout` 之外，与命令面板同级），自由拖拽/缩放/改色/删除，背景网格吸附 |
| **停靠模式** | 便签上「钉到桌面」 | 常驻右下角小条，点击展开；`pinned` 的便签在首页以浮层直接显示（不进墙） |

> 移动端：便签墙退化为列表（拖拽在触屏上体验差，且 300 卡页面已有拖拽排序），钉住的便签折叠成底部一条。

### 5.3 编辑体验

- Markdown-lite：`**粗体**`、`- [ ] 清单`、`# 标签`、`https://` 自动链接。**渲染走纯文本转义 + 白名单**，绝不 `v-html` 原始输入。
- 清单项勾选 → 一键「转成待办」（写入 `todos` store，便签里保留原文）。
- 自动保存：输入 300ms 防抖落 localStorage；失焦/关闭立即落盘。

---

## 6. 实时备注（Site Notes）

### 6.1 数据模型与「实时」的三层

```js
// stores/siteNotes.js
notes: {
  'site-123': {
    text: '免费额度每月 50 次，超出要绑卡',
    updatedAt: 1760123456789,
    rev: 7,
    pinned: false,          // 钉住的备注直接在卡片上露出一角
    deletedAt: null         // 墓碑：删了要留痕，否则旧设备一同步就复活
  }
}
```

| 层次 | 机制 | 时延 |
| --- | --- | --- |
| ① 输入即存 | 300ms 防抖 → `localStorage`（版本化） | < 0.5s |
| ② 同浏览器多标签页 | `BroadcastChannel('nav-live')` 广播 `{type:'siteNote', id, text, updatedAt, rev}`；收到后按 LWW 合并 | < 1s |
| ③ 跨设备 | 并入 session 同步（新增 `siteNotes` 字段），沿用现有 key 鉴权与字段级合并；改动后 5s 防抖推一次 | 秒级~轮询周期 |

### 6.2 冲突消解（LWW + 墓碑）

```
合并(本地, 远端) 按 siteId 逐条：
  两端都有 → updatedAt 大者胜（相等取 rev 大者，再相等取本地）
  一端 deletedAt 更新 → 删（墓碑胜出生效）
  只在远端 → 补进本地（这是「换设备看到备注」的来源）
```

墓碑保留 30 天后清理，避免 session 快照无限膨胀。

### 6.3 入口与呈现

| 入口 | 交互 |
| --- | --- |
| 卡片角标 | 有备注 → 右下角小圆点；`pinned` → 卡片底部露出一行摘要（受 `cardDensity` 约束：compact 档只显示圆点） |
| 详情面板 | `SiteDetailPanel.vue` 底部「备注」区：textarea + 保存状态（「已保存 · 刚刚」）+ 历史版本回退（保留上一 `rev`） |
| 右键菜单 | `ContextMenuHost` 增加「添加/编辑备注」（走现有单例菜单，不加监听） |
| 全能框 | 命令「给 X 加备注」；搜索时**备注内容参与检索**（权重档位见 §8.4） |

### 6.4 300 卡性能约束（必须遵守）

- 卡片**不得**各自去读 `notes[site.id]`（会在 300 张卡上建立 300 条深层依赖）。改由 store 暴露一个 `noteMarks: Set<siteId>` 与 `pinnedNotes: Map<siteId, 摘要>`，卡片只做 `noteMarks.has(id)` —— 与 `preferences.cardDisplay` 同一手法。
- 摘要在写入时**预算好存进 Map**（截断 40 字），不在渲染时截断。

---

## 7. 智能化

按「先把已有信号用起来，再谈模型」的顺序分四步。

### 7.1 S1 意图检索（自然语言 → 结构化筛选）

```js
// utils/intent.js —— 纯函数，零依赖
parseIntent('免费的 AI 画图工具')
// → { categories: ['ai'], purposes: ['image'], price: 'free', sort: null, confidence: 0.86 }
```

- 词典从**现有分类与用途表自动派生**（`stores/categories.js` + `PurposeTags`），外加一张同义词映射（`AI→人工智能/ai`、`画图→绘图/图像/生图/绘画`、`免费→free/不要钱/白嫖`）。
- 输出落到全能框下方一条 **IntentChip**：「已理解：AI · 图像 · 免费 × 清除」，点 χ 回到普通搜索。**永远可退回**，不做不可解释的黑箱。
- 未命中（confidence < 0.5）时不显示 chip，行为与今天完全一致。

### 7.2 S2 场景感知排序（此刻推荐）

```js
// utils/smartRank.js
score(site, ctx) =
    0.45 × 时段类目偏好     // 把一天切 4 段（晨/午/晚/夜），统计各段各类目访问占比
  + 0.35 × 个人频次衰减     // count × 0.5^(ageDays / 7)   半衰期 7 天，老数据自然下沉
  + 0.20 × 会话共现         // 5 分钟窗口内一起访问过的站点对，互相加权
```

- 全部基于 `stores/history.js` 与 `stores/clicks.js` 的**本地**数据，不上云、不采集。
- 冷启动（无历史）自动降级为现有「热门」，不出现空推荐区。
- 呈现：首页顶部一条横向 `SmartBar`（8 张小卡 + 「换一批」），可在设置里关闭；排序项新增「智能」（`sortBy: 'smart'`）。

### 7.3 S3 数据自愈（把 health 的探测结果用起来）

- `stores/health.js` 探到 404 / 超时连续 3 次 → 站点标 `stale`，卡片角标变「疑似失效」。
- 管理后台新增「体检」清单：失效站点、缺描述、缺图标、疑似重复（同域名不同路径 / 名称相似度 > 0.9）四类，逐条给出**一键修复**（调 `api/metadata.js` 重新抓取 / 合并 / 归档）。
- 修复动作走现有 ops 通道（`api/ops.js`），带审计日志（`services/auditLog.js`）。

### 7.4 S4 AI 增强（可选，默认关闭）

`api/ai.js` —— 只在环境变量 `AI_API_KEY` 存在时启用，前端检测到不可用则**隐藏全部 AI 入口**，不显示「AI 功能未开启」的死按钮：

| 能力 | 无 key 时的降级 |
| --- | --- |
| 一句话找站（把 S1 的解析交给模型） | 退回规则引擎 `intent.js` |
| 新站点自动写描述 / 自动选用途标签 | 退回现有 `shared/site-infer.mjs` |
| 每周使用洞察（自然语言总结） | 退化成统计表格（复用 AdminInsights） |

**硬性约束**：AI 只做「建议」，所有写库动作必须经过与现在相同的 ops 校验与人工确认，不得自动落库。

---

## 8. 数据、同步与配额

### 8.1 session 字段扩展

`services/session.js#snapshotFromStores` 现在字段写死，改为**注册表式**：

```js
const SYNC_FIELDS = [
  { key: 'favorites', get: s => [...s.favorites.favoriteIds],              apply: ... },
  { key: 'todos',     get: s => s.todos.todos,                             apply: ... },
  { key: 'history',   get: s => s.history.records.slice(0, 100),           apply: ... },
  { key: 'siteNotes', get: s => s.siteNotes.notes,                         apply: mergeSiteNotes },  // 新增
  { key: 'notes',     get: s => s.notes.items,                             apply: mergeNotes },      // 新增
  { key: 'theme',     get: s => s.theme.serialize(),                       apply: ... },             // 新增
]
```

新增字段只需登记一次，不再两处改。

### 8.2 配额（现有服务端门禁 256KB，必须同时放宽与收紧）

| 项 | 限制 |
| --- | --- |
| 单条站点备注 | 2 KB（超出前端截断并提示） |
| 备注总量 | ≤ 80 KB（约 400 条 200 字备注） |
| 单枚便利贴 | 8 KB |
| 便利贴总量 | ≤ 80 KB |
| 服务端 `MAX_BODY_BYTES` | 256 KB → **512 KB**，且客户端推送前自检，超限弹「请先清理」而不是被 413 打回 |

历史记录仍限 100 条（现有口径），不因扩容而放宽。

### 8.3 搜索索引

`utils/search.js` 的检索字段增加备注，权重置于「描述」之上、「别名」之下（备注是用户自己写的，命中率高但覆盖少）。**约束**：`pinyin-pro` 只能经由动态 import 到达（首屏分包不变量），备注变化用 800ms 防抖做索引增量重建，不做全量重算。

### 8.4 命令与快捷键

| 新增 | 键位 / 关键词 |
| --- | --- |
| 新建便利贴 | `Ctrl+Alt+N`；`bianliqian / blq / note` |
| 打开便签墙 | `Ctrl+Shift+N`；`qiang / bq` |
| 给站点加备注 | 站点二级页内；`beizhu / bz` |
| 打开主题面板 | `zhuti / zt / theme`（现成，改指向新面板） |
| 切换主题 | `Ctrl+D`（现成，改走 theme store） |
| 智能排序 | `zhineng / zn / smart` |

命令一律登记进 `utils/commands.js#buildCommands`，**不在任何组件里另写一份检索/命令逻辑**（全能框不变量）。

---

## 9. 分期实施计划

| 批次 | 内容 | 主要改动文件 | 验收 |
| --- | --- | --- | --- |
| **P0 地基** | `stores/notes.js`、`stores/siteNotes.js`、`utils/noteSync.js`（BroadcastChannel + LWW + 墓碑）、session 字段注册表化、store 版本迁移钩子 | 新增 3，改 2（`services/session.js`、`api/session.js` 配额） | 两标签页互改可见；断网可写、联网补推；旧数据升级无感 |
| **P1 实时备注** | 卡片角标 + 详情面板备注区 + 右键菜单项 + 搜索索引接入 + 全能框命令 | `SiteCard.vue`、`SiteDetailPanel.vue`、`ContextMenuHost.vue`、`utils/search.js`、`utils/commands.js` | §1 备注四条口径全绿；300 卡滚动帧率无退化（与基线对比） |
| **P2 便利贴** | `StickyBoard.vue` / `StickyNote.vue` / 便签墙入口 / 钉住与停靠 / 转待办 | 新增 2，改 `App.vue`（浮层挂壳外）、`MainToolbar.vue` | 拖拽/改色/持久化/同步；移动端退化为列表 |
| **P3 主题 v2** | `utils/themeSchema.js`、`stores/theme.js`、`ThemeMarket.vue`、`ThemeEditor.vue`、内置 8 套、跟随系统、迁移 | 新增 4，改 `preferences.js`、`VisualSchemeSection.vue`、`SettingsPanel.vue` | **迁移前后截图逐项比对无差异**；导出→导入还原一致；跟随系统生效 |
| **P4 智能化 S1+S2** | `utils/intent.js`、`utils/smartRank.js`、`IntentChip.vue`、`SmartBar.vue` | 新增 4，改 `useOmniBox.js`、`App.vue` | 「免费的 AI 画图工具」命中预期筛选；冷启动降级为热门 |
| **P5 智能化 S3+S4** | 体检清单（管理后台）、`api/ai.js` + `services/ai.js`（可选） | 新增 3，改 `AdminInsights.vue` | 无 key 时 AI 入口完全隐藏且功能不降级；体检四类问题可一键修复 |

每批独立可发布、可回滚；P0~P3 之间无硬依赖（P2/P3 可并行）。

**实施状态**：P0–P4 已全部落地（2026-10-11）；P5 暂缓。落地时新发现的两处缺陷见 §14。

---

## 10. 必须守住的不变量

| 不变量 | 本版新增风险点 |
| --- | --- |
| 卡片颜色只许用语义 token | 便利贴 6 色板、备注角标必须新增 `--color-note-*` 语义 token，**不得写死**；深色主题下要另给一套 |
| 全局浮层挂 `app-layout` 之外 | 便签墙、主题编辑器同 `CommandPalette` 处理，否则 `/admin` 下失效 |
| 右键菜单全局单例 | 「添加备注」走 `ContextMenuHost` 的 handlers，不加 `document` 监听 |
| `pinyin-pro` 只走动态 import | 备注进搜索索引时不得让索引模块进入首屏静态图；改完跑 `npm run console:test:bundle` |
| 卡片元素显隐挂 `cardDisplay` | 备注角标与钉住摘要并入同一个 computed，不新增 300 份订阅 |
| 折叠动画期间摘毛玻璃 | 便签浮层不得自带 `backdrop-filter`，否则折叠掉帧 |
| 数据门禁 | 备注/便签**不进** `sanitizeSites` 的站点表；若将来要进公共表，必须先过门禁与 `validate-data.mjs` |
| 凭据 | session key 只走 `Authorization` 头，新字段沿用，不得回退到 query/body |
| SSRF | S3 重新抓取元信息复用 `shared/net-guard.mjs` 两层校验，**不再新写预检** |
| 「点开才用」的重组件必须异步 | 新增抽屉 / 浮层一律 `defineAsyncComponent`（常驻浮标如 `StickyDock` 例外），改完跑 `test-bundle` 第 7 节 —— 这条是首屏预算的兜底 |
| 预设配色不得覆盖自建主题 | 任何延迟落色（watcher、`setTimeout` 重放）都要先看 `colorsOwner !== 'custom'`（§14.2），否则切一次明暗就丢一次用户配色 |
| 主题的启动动作不能写在 setup 主体里 | 持久化回填晚于 setup，启动判断必须走 `queueMicrotask(bootstrap)`，且 App 要 `useThemeStore()`（§14.1） |

---

## 11. 测试与验收

新增测试套件（已并入 `npm run console:test:all`，全套 **22 个套件**）：

| 套件 | 覆盖 | 结果 |
| --- | --- | --- |
| `test-notes` | LWW 合并（含时钟回拨/相等取 rev）、墓碑胜出、配额截断 | 59 条 |
| `test-livesync` | BroadcastChannel 消息格式、合并幂等（同一消息重复到达结果一致） | 11 条 |
| `test-theme` | 8 套内置主题完整取值（沿用「每套方案必须完整取值」的守卫思路）、迁移等价、序列化往返、非法取值被忽略 | 49 条 |
| `test-theme-boot` | **持久化回填 → 补应用**的时序、启动接线、`bootActions` 决策表、跨零点区间 | 29 条 |
| `test-intent` | 同义词命中、多意图组合、低置信度不误触发 | 57 条 |

另有两处既有守卫被本版触碰并更新：`test-visual-scheme` 的 CSS 变量键集快照（新增备注与六色便签令牌，
并补上「便签底色随明暗切换」的断言，共 75 条）；`test-session` 的上限常量（256KB → 512KB，与 `api/session.js` 同步）；
`test-bundle` 新增第 7 节「点开才用的组件不许回首屏」（共 19 条）。

线上/真机验收：`node probe/v8-verify-ui.mjs <cdp-port> [base]` —— 零依赖 CDP 驱动 headless Chrome，
29 项全绿（详见 §14.4）。

---

## 12. 风险与回滚

| 风险 | 应对 |
| --- | --- |
| 主题迁移改坏老用户外观（最严重） | P3 单独一个发布批次，先出迁移前后截图比对报告再合；`preferences` 旧字段保留一个版本周期，出问题可一键回落 |
| 备注/便签把 session 撑爆 | 客户端预检 + 服务端 512KB 硬门禁 + 墓碑 30 天清理；413 时前端提示「清理历史记录」而非静默失败 |
| 多标签页互相覆盖（LWW 打字丢失） | 备注编辑以**站点**为最小粒度（不是以字符），两个标签页改同一站点才可能冲突，概率极低；冲突时保留上一 `rev` 可一键回退 |
| 便签墙拖垮 300 卡页面 | 便签墙是独立浮层，默认关闭，不渲染时零开销；钉住的便签限制 ≤ 6 枚 |
| 智能化「推荐得莫名其妙」 | 所有智能结果**必须可解释**：SmartBar 每条带理由标签（「你常在晚上打开」「与 X 一起用过」），且可关闭 |
| AI 依赖外部服务拖慢首屏 | AI 只在用户显式触发时请求，且带 8s 超时与失败降级提示，绝不进首屏关键路径 |

**回滚**：每批次前 `scripts/publish.mjs` 自动备份（现成能力）；主题/备注相关均为新增 store 与字段，删除即回到旧行为，不需要数据迁移回滚。

---

## 13. 拍板结论（原「待定夺」）

| # | 问题 | 结论 |
| --- | --- | --- |
| 1 | 「宣纸 / 夜航」色值 | **A**：按本文 §4.2 建议值先落地再调 |
| 2 | 智能化重心 | **A**：先做 S1+S2（规则 + 统计，零依赖、可解释），S4 AI 留到 P5 |
| 3 | 便利贴默认形态 | **C**：便签墙与侧栏停靠都做，**默认停靠** |
| 4 | 备注是否钉到卡片 | **B**：支持钉住露摘要（受卡片密度档约束） |

---

## 14. 实施记录（落地时才发现的两处缺陷，务必先读）

两处都不是设计遗漏，而是「写了但不会生效」的时序/覆盖问题 —— 静态看代码是对的，只有真机点一遍才现形。

### 14.1 主题的启动行为一条都没跑过（已修）

pinia-plugin-persistedstate 是在 store 的 setup **返回之后**才回填持久化状态
（`hydrateStore → store.$patch`，同步执行）。而 `stores/theme.js` 的启动动作原先写在 setup 主体里直接读
`follow` / `activeId`，拿到的永远是默认值，于是刷新后：

- 「跟随系统」不生效（要等系统明暗变化才跟）
- 「日落自动换深色」要等第一次 60s 轮询才纠回来
- 「自建主题刷新后补应用」完全不生效，直接退回基础方案

**修法**：启动动作抽成纯函数 `bootActions({follow, activeId, customIds})`，用 `queueMicrotask(bootstrap)` 延后一个微任务
（回填是同步的，微任务已晚于它、又早于绘制，不会闪）。同时 App 启动时必须 `useThemeStore()` ——
主题设置面板是按需加载的，只靠它创建 store 的话，上面三条同样一次都不会发生。

守卫：`tools/console/test-theme-boot.mjs`（29 条）。它垫一层最小 browser 替身（document / localStorage / matchMedia），
用 Vite `ssrLoadModule` 加载真实 store 并走一遍回填。**注意**：`pinia.use(plugin)` 在 `createApp().use(pinia)` 之前
只是排队，漏了 install 这一步插件根本不会跑（本套件会「全绿但什么都没测到」）。

### 14.2 预设配色会把自建主题的配色盖掉（已修）

预设落色有两条**延迟**路径：`themePreset` 的 watcher、以及明暗切换后 `setTimeout(() => applyPreset(...), 10)` 的重放。
自建主题是在 `apply()` 里同步写好配色的，这两条会在下一个微任务 / 10ms 后把用户的 accent 盖回预设值 ——
切一次明暗就丢一次自定配色。

**修法**：`preferences` 里加 `colorsOwner`（`preset` / `custom`）标记：`applyColors()` 记为 `custom`，
`applyPreset()` / `setVisualScheme()` / `setThemePreset()` 记为 `preset`；那两条延迟路径发现配色已被接管就跳过。
顺序也是约定：`apply()` 里必须先 `setVisualScheme` 再 `applyColors`。

守卫：`test-theme-boot.mjs` 的第 2、3 条（自建主题 accent 生效 + 切暗色后仍是自建主题的暗色配色）。

### 14.3 首屏预算被顶出线，靠拆分收口（未放宽预算）

P0–P4 落地后首屏 JS 从 566.5 KiB 涨到 **627.0 KiB**，越过 `test-bundle` 的 600 KiB 绊线。
**没有放宽预算**，而是把「点开才用」的组件改成异步组件（`defineAsyncComponent`）：`SettingsPanel`、
`ThemeEditor`、`StickyBoard`、`StickyNote`（含 Markdown-lite 解析）。
`StickyDock` 保持同步 —— 它是常驻浮标，异步会让它晚一拍出现。

结果：**589.3 KiB raw / 206.4 KiB gz**（v8 四条新功能的净增约 23 KiB）。
`test-bundle` 新增第 7 节守卫：用组件内独有的 UI 文案定位，断言这些界面**不在首屏下载清单里** ——
预算有余量时它是不会报警的，所以必须单独点名。

### 14.4 真机验收

`node probe/v8-verify-ui.mjs <cdp-port> [base]`：29 项，**全绿**。覆盖异步面板是否还能打开、
意图 chip、便签落盘、便签墙、主题市场切换（形状令牌 + 配色两条路径）、主题编辑器、备注落盘 + 卡片角标、无未捕获错误。

**探针自身的两个坑**（假失败来源）：① 搜索框靠 `@mousedown` 认定「用户进来了」，
只做 `el.focus()` 不足以打开下拉 → 必须先派发 `mousedown`；② 苹果原生与极简扁平共用 `default` 取色，
切这两张卡 `--accent` 本来就不该变，要拿 `--radius` 判「换装了」。
