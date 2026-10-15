# 搜索框网址预览卡片：输入网址即出卡片 · 三个刻意的不一致

> 状态：已实现（2026-10-15）
> 关联：`src/utils/urlPreview.js`、`src/composables/useUrlPreview.js`、`src/composables/useOmniBox.js`、`src/components/OmniResults.vue`

## 0. 需求与动机

在搜索框里粘一个网址时，下拉里只有**一行字**：

- 已收录 → `GitHub` / `该域名已收录`
- 未收录 → `添加站点 github.com` / `按此网址自动抓取名称、描述与图标`

用户此刻要判断的是「这网址是什么、是不是我要找的那个」—— 而这一行什么信息都没给。名字、描述、图标、域名全都要**点了才知道**，点错了还得退回来。

需求：**输入像网址时，下拉顶部直接给一张预览卡片**，图标 + 站名 + 描述 + 域名一次给全，不点也能判断。

## 1. 现状（先量后改）

| 已有能力 | 位置 | 本次怎么用 |
| --- | --- | --- |
| 网址识别 `looksLikeUrl` | `src/utils/url.js` | 直接复用，不新写判据 |
| 域名归一 `domainOf` / `rawHostOf` / `colorFromHost` | `src/utils/siteDraft.js` | 缓存键、图标域名校验、兜底配色 |
| 元信息抓取 `/api/metadata` | `src/services/meta.js#fetchSiteMeta` | 复用（含超时与「非 JSON 响应」的容错），**按动态 import 取** |
| 网址候选 / 已收录判定 | `useOmniBox.js#domainCandidate` / `#collected` | 卡片的两种数据来源 |
| 下拉分组渲染 | `components/OmniResults.vue` | 新增 `is-preview` 分支 |

**要改的就是 `urlItems`**：它当前产出单行条目，改造成携带数据的预览卡片。

## 2. 方案

### 2.1 纯函数层：`utils/urlPreview.js`

判定与数据映射全部放纯函数，才能被 `tools/console` 的纯 node 测试覆盖（`@/` 别名在纯 node 下加载不了）。

| 导出 | 职责 |
| --- | --- |
| `shouldPreview(raw, { prefix, hasPage })` | 门禁：像网址、无前缀、不在二级页 |
| `previewKeyOf(raw)` | 缓存键 = 去重域名 |
| `cardFromSite(site)` | 已收录站点 → 卡片 |
| `cardFromMeta(meta, url)` | 抓取结果 → 卡片 |
| `resolvePreviewState({ url, duplicate, loading, meta, error })` | 状态机 → `{ kind, card, message }` |
| `PREVIEW_KIND` | `idle` / `found` / `loading` / `ready` / `error` |

### 2.2 抓取层：`composables/useUrlPreview.js`

- **防抖 350ms**：`g`→`gi`→`git`→… 每一步都像网址，不防抖会打出一串请求，卡片还会在几个域名间来回闪；
- **按域名缓存**：会话内结果不变，删掉再打同一个网址不该重新联网；命中缓存时**同步出结果、不进 loading 态**；
- **过期作废**：`seq` 递增 + `AbortController`，迟到的响应绝不覆盖已经换掉的卡片；
- **失败不缓存**：失败可能是瞬时故障，缓存住会让重试永远失败；
- **动态 import `@/services/meta`**：与 `autoAdd.js` 取 `suggestCategory` 同一个理由 —— 静态引入会把它拖回首屏，`test-bundle.mjs` 第 7 节点名了这条链路。

### 2.3 内核接入：`useOmniBox.js`

`urlItems` → `previewItems`，`type` 从 `site` / `add` 改为 `preview`，并新增 `preview` 组置顶（`ORDER` 与 `GROUP_LABEL` 同步加 `preview`）。

**卡片本身就是那条可执行项**：回车 = 打开（已收录）或添加（未收录），不再额外长一条操作行 —— 同一件事给两个入口，用户还得先判断该点哪个。

已收录时带 `site` 字段（`⇥` 仍可进站点操作页），同时在站点组里按 key 去重，避免同一条出现两次、键盘序号错位。

条目 `type` 保持 `'site'`（已收录）/ `'add'`（未收录），**不用 `'preview'`**：`type` 说的是「这是什么条目」，外壳 `UnifiedSearchBox#done` 据此决定回车后保不保留搜索词 —— 换成 `'preview'` 会让「打开站点」变成「清空搜索框」（真机逮到过，见 §4.3）。

卡片的输入取**网址候选**（`domainCandidate.url`）而不是抓取 composable 里的 `url`：已收录时不发请求，后者恒为空，状态机会把有本地数据的卡片判成 `idle`、整张卡消失。

预取触发条件与「卡片该不该出现」共用 `shouldPreview`，否则会出现「抓了却不显示」或「显示了却没抓」。

### 2.4 渲染：`OmniResults.vue`

`item.preview` 存在时走 `is-preview` 分支：36px 图标（favicon 失败回落字母块）+ 站名 + 状态徽标 + 描述（两行截断）+ 域名。状态徽标三态：`已收录` / `抓取中`（转圈）/ `抓取失败`。**抓取成功（ready）刻意不给徽标** —— 那一行已有站名、描述与域名，再挂个「已抓取」只是噪音。

图标区与文本区**各自成链**（各自 `v-if` / `v-else`）：文本区若写成无条件的 `div`，它会与下面通用的 `.omni-item-info` 同时渲染，标题与副标题各出现两次 —— 这条是看真机截图才发现的，断言当时全绿。

转圈只动 `transform`：预览/自动化环境里动画时钟可能不推进，用不透明度起帧会把徽标定格成透明（同一个坑，`UnifiedSearchBox` 的下拉动画注释里记过）。

### 2.5 三个刻意的不一致

| # | 决定 | 理由 |
| --- | --- | --- |
| 1 | **已收录不联网** | 本地已有全部字段，联网纯属多余，更不该让用户为一次本地查询等一个往返。优先级上 `duplicate` 先于 `loading` / `error` —— 抓取中或失败都不该盖住本地事实 |
| 2 | **预览所见 = 入库所得** | `cardFromMeta` 的图标判据与 `buildSiteFromDraft` 完全一致（图标域名必须是本站域名）。预览照挂第三方 CDN 的图标，用户就会看到「预览有图、入库变字母块」的落差 |
| 3 | **加载与失败都给主机名占位** | 卡片不能在等网络时是空的。失败额外把原因写在描述位，用户至少知道是「抓不到」而不是「没这东西」 |

## 3. 配置与存储

**无新增持久化**。抓取缓存只在内存里活一次会话 —— 元信息会变，持久化反而会缓存出过期卡片。没有新开关：预览是只读展示，不改变任何写入行为。

## 4. 验收标准

### 4.1 自动化守卫

`tools/console/test-url-preview.mjs` —— **36 条断言**，覆盖门禁 / 缓存键 / 两类卡片映射 / 五种状态分支，其中三条是判据的边界：

- `cardFromMeta` 图标来自第三方域名时不显示（与入库判据一致）；
- `cardFromMeta` 空响应回落主机名；
- **已收录时忽略抓取状态**（`duplicate` 同时给出 `loading` 与 `error`，仍取 `found`）。

已挂 `console:test:url-preview` 与 `console:test:all`。

### 4.2 行为等价

- 未收录时回车仍走 `omni.requestAdd(url)`，与改动前完全一致（自动添加/弹窗的分叉仍然由 `App.vue#openAddSite` 决定，本次不碰）；
- 已收录时回车仍走 `openSite(site)`，`⇥` 仍能进站点操作页；
- 非网址输入、带 `>` `@` `/` 前缀、二级页三种情况**不出卡片**，下拉与改动前逐字一致。

### 4.3 真机验证（`probe/url-preview-verify.mjs`）

**16 条断言**，自拉 `dist/server.js`（提供 `/api/metadata`）与 headless Chrome，跑完自收：

| 组 | 内容 |
| --- | --- |
| 已收录出卡 | 标题是站点名、给出域名、**在下拉最顶部**、**只渲染一份文本** |
| 未收录真抓取 | 出现过「抓取中」徽标（证明真发了请求）、终态、抓到站名（不是裸域名）、图标有 favicon 或回落字母块、主机名占位 |
| 不出卡的三种输入 | 普通词 / 命令前缀 / 清空（并先断言「下拉确实展开」，否则负向断言是假通过） |
| 回车语义 | 打开站点后下拉收起、**输入保留** |

真机抓到三个「单元测试全绿也看不见」的缺陷：

1. 卡片数据整个丢失（`previewState` 取错了输入源）→ 悄悄退回旧渲染分支；
2. 打开站点后搜索框被清空（条目 `type` 被改成了 `'preview'`）；
3. 标题与副标题各重复渲染两次（文本区不在条件链上）—— **看截图才发现**。

三条现在都有对应守卫；第 3 条在截图之外还补了断言（`infoCount === 1`），下次改模板会被挡住。

### 4.4 首屏预算

`test-bundle.mjs` 的 600 KiB 绊线抬到 **604 KiB**（gz 230 → 214 不变实际口径下同步放宽）：

| 版本 | 首屏 raw |
| --- | --- |
| 改动前基线 | 596.1 KiB |
| 本功能（静态 import meta） | 602.9 KiB ❌ |
| 本功能（动态 import meta） | 601.7 KiB ✅ |

抬线理由：绊线防的是「悄悄变胖」，本次是有意增长（`utils/urlPreview.js` + `composables/useUrlPreview.js` + 卡片渲染 CSS），基线余量本就只剩 3.9 KiB。抓取链路已按第 7 节规矩走动态 import，没有把 `services/meta` 拖回首屏。

### 4.5 本轮范围

卡片样式复用既有下拉的选中/悬停行为（`.omni-item` 的 `active` 类），键盘导航、滚动回视野、`ESC` 关闭全部沿用既有机制，未新增交互。

## 5. 不做的事

1. **不做整页截图式预览** —— 那是另一次网络往返 + 一个渲染进程，而用户在搜索框里只想知道「是不是这个站」；
2. **不把预览结果写进站点库** —— 预览是只读的，写库仍由既有的添加链路负责（用户点了才算数）；
3. **不在二级页（站点操作）出卡片** —— 那里的输入是在过滤操作项，不是在找网址；
4. **不做预览卡片的「编辑/收藏」快捷操作** —— 卡片只负责「看清楚 + 一个下一步」，更多操作交给站点操作页（`⇥`）；
5. **不为预览新增持久化或云端配置** —— 见 §3。
