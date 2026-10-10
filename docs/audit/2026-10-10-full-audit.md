# nav-v2 全面体检报告

**日期**：2026-10-10
**范围**：`src/`（80 文件）、`api/`（serverless 8 文件）、`shared/`、`scripts/`、`vite.config.js`、`vercel.json`、`package.json`
**方法**：四路并行只读代码审查（状态层 / 渲染性能 / 网络与安全 / 工具与工程化）+ 线上实测复核
**状态**：待修复

---

## 0. 执行摘要

共发现 **4 个 P0、23 个 P1、约 30 个 P2**。其中 3 个 P0 已在线上实测复现，不是理论风险：

| # | P0 | 实证方式 |
|---|---|---|
| 1 | **Blob 读一次失败 → 用构建期种子覆盖生产数据**，且不落快照 | 读码确认 `api/sites.js:122-143` |
| 2 | **PWA Service Worker 完全失效**：线上 `/sw.js` 返回的是 index.html | 线上 `curl` 实测：HTTP 200 / `Content-Type: text/html` / 874 字节 |
| 3 | **PWA 不可安装**：manifest 引用两个不存在的图标 | `ls public/pwa-*.png` → No such file |
| 4 | **抓取图标失败会永久删掉站点的 `icon` 字段**并直接回写文件 | 读码确认 `scripts/fetch-favicons.mjs:184-201` |

> 说明：第 2 条意味着这个项目当前**没有任何离线能力**，且每次访问都可能拿到被 SW 缓存策略干扰的旧资源（本次全能框验证时就踩了一次）。

### 量化基线（实测）

| 指标 | 数值 |
|---|---|
| 站点数据 | 300 条 / 115 KB（gzip 33 KB） |
| 主 chunk | **746 KB**，无分包 |
| SW 预缓存 | **280 条 / 6.25 MB**，其中 278 个是图标 |
| 轮询流量 | ~**4 MB/小时/标签页**（一天挂机约 95 MB） |
| 每次 rebuild 后首次搜索 | 重算 **1552 次 pinyin**，40–55 ms（Node）/ 60–150 ms（移动端） |
| 全量重渲染 | 300 卡 × 18 computed = **5400 个 computed 实例** |

---

## 一、🔴 P0 必修（4 条）

| # | 位置 | 问题 | 后果 |
|---|---|---|---|
| **P0-1** | `api/sites.js:122-143` | `try { await readStored() } catch { /* 种子兜底 */ }` —— 空 catch 吞掉**所有**异常，随后无条件 `put(PATHNAME, 种子)`。**Blob 任何一次抖动（5xx／超时／token 失效）都会被当成"没存过"**，用部署包里的构建期快照覆盖线上真实数据 | 数据丢失：`version` 从 42 退回 1、`categories` 字段丢失、所有热更新蒸发。**这条路径不写快照**，回滚链也没有。Blob 抖动期间每个并发冷 GET 还会各写一次 |
| **P0-2** | `vercel.json:5-11` | `routes` 只有 `/api/`、`/assets/`、`/icons/`、`/favicon.svg`、`/(.*)→index.html`，**缺 `{"handle":"filesystem"}`**。自定义 routes 时 Vercel 不做文件系统兜底 | `/sw.js`、`/manifest.webmanifest`、`/workbox-*.js` 全部被重写成 index.html。**SW 注册失败 → PWA 离线能力全失效**。线上已实测确认 |
| **P0-3** | `vite.config.js:20-23` | manifest 声明 `/pwa-192x192.png`、`/pwa-512x512.png`，但 `public/` 下根本不存在这两个文件 | Chrome 判定 manifest 不合规 → **PWA 无法安装**（「添加到桌面」不可用） |
| **P0-4** | `scripts/fetch-favicons.mjs:184-187` + `:201` | 抓取失败即 `delete site.icon`，最后 `fs.writeFileSync(dataPath, ...)` 直接回写；脚本开头**无备份**（与同目录 `seed-aliases.mjs` 先备份的写法不一致） | 网络抖动会把站点图标字段从 `sites-data.json` 里**永久删掉**。当前数据已有 8 条无 icon（`l1, ch6, df8, dt13, bs3, acc3, pj1, ac14`），很可能就是这么来的 |

---

## 二、🟠 P1 应修（23 条）

### 2.1 数据一致性与竞态

| # | 位置 | 问题 | 后果 |
|---|---|---|---|
| P1-1 | `src/stores/sites.js:472` | `data.version !== cloudVersion.value` —— **只判"不等"，不判"更新"**；且 `pollCloudSites` 无 inflight 锁、无 AbortController。切标签页触发 `App.vue:405-410` 的立即重拉，与 30s 定时轮询可并发 | 慢响应后到 → 整站（含分类表）**静默回滚到旧版本**，最长持续 30s，用户完全无感 |
| P1-2 | `src/stores/sites.js:444-452` | `applyCloudData` 只校验 `Array.isArray(data.sites)`，**没有等价于分类表 `sanitizeGroups` 的站点清洗**。空数组也通过（`Array.isArray([])` 为真） | 一次脏发布（1 条站点 / 元素缺 id / 空数组）= 全站前端白屏，且无回退 |
| P1-3 | `src/stores/sites.js:434-441` + `src/views/AdminView.vue:331-336` | 回滚时 `applyCloudData(旧快照)` 后紧接着 `clearLocalOverlay()`，把 `localDeletes` 墓碑一起清掉 → 用户已删的站点复活；此时从回收站再恢复一次，因 `dIdx === -1` 会 push 进 `localAdds` | 列表出现**两条同 id 记录**，`item-key="id"` 重复，后续删除/编辑/批量只命中一条，另一条成删不掉的幽灵卡片 |
| P1-4 | `src/stores/sites.js:140-152`、`clicks.js:50-52`、`categories.js:34-36`、`todos.js:10-12` | **全部 `localStorage.setItem` 无 try/catch**。配额溢出（无痕模式/存储写满）时抛 `QuotaExceededError` | `recordVisit` 抛错 → 下一行 `clicksStore.record(id)` **不执行**，这次点击完全不计；`deleteSite` 抛错 → 墓碑与回收站都不落盘，**视图已删、存储未删**，刷新后站点复活 |
| P1-5 | `src/stores/history.js:8-14` / `:20-25` | `addRecord` 每次访问都 `unshift` 且**不按 siteId 去重**（50 条配额会被同一站点占满）；`addRawRecord` 走 `push` 到**末尾**，与"最新在前"方向相反 | 「最近」列表条目数远少于预期、顺序错乱 |
| P1-6 | `src/components/bookmarks/ExportPanel.vue:39` | `historyStore.visitHistory` —— store 只导出 `records`，**全项目仅此一处出现该名字** | 恒为 `undefined`，`JSON.stringify` 直接丢键 → **导出的备份完全没有访问记录**，用户以为备份了其实没有 |

### 2.2 渲染性能

| # | 位置 | 问题 | 后果 |
|---|---|---|---|
| P1-7 | `src/stores/sites.js:155-181` | `rebuild()` 对 300 条**逐条展开成新对象**（`:158`、`:162`）并整体替换数组 | **改 1 个站点（置顶/归档/编辑）→ 300 张卡全量重渲染**；云端 30s 轮询版本变化同样如此。12 个调用点全覆盖 |
| P1-8 | `src/utils/search.js:18` + `sites.js:155-181` | `keyCache` 是 **WeakMap，以 site 对象身份为 key**，而 rebuild 每次生成新对象 → **缓存每次全失效** | 下一次搜索要重算 300 站点的 1552 次 `pinyin()`（40–55 ms Node / 60–150 ms 移动端） |
| P1-9 | `src/utils/search.js:86-102` | `fuzzySites` **每次调用都 `new Fuse(...)`**（O(n) 建索引）；`useOmniBox.js:147` 的 `siteResults` 是实时 computed，**300ms 防抖只保护同步到 store 的 `searchQuery`，不保护它** | 敲拼音串时前几个字符零命中 → 每敲一键建一次索引（3–10 ms）+ 搜索（6–26 ms），累计最坏 100–280 ms 输入阻塞 |
| P1-10 | `src/components/SiteCard.vue:124-181` | 每张卡 **18 个 computed** × 300 实例 = 5400 个；其中 `visited/isFav/clickCount/healthState` 订阅全表 store | 任一 store 变更 → 1200 次逐卡重算 + 依赖收集/释放 |
| P1-11 | `src/components/SiteCard.vue:55-56` | 模板里直接调 `categoriesStore.getCategoryColor/getCategoryLabel`，各自先遍历 groups 再嵌套遍历 categories | 单次全量重渲染 ≈ **300 × 2 × (6 域 + 37 分类) ≈ 25,000 次字符串比较** |
| P1-12 | `src/components/CardsContainer.vue:64`、`86` | `@select="sitesStore.toggleSelect(site.id)"` 内联箭头函数 → 每次插槽重建生成**新闭包** | 链条：数组新引用 → 300 插槽重建 → 300 新闭包 → `props.onSelect` 身份变化 → **300 张卡全量重渲染**（即使 site 内容一模一样） |
| P1-13 | `src/components/Sidebar.vue:114-117`、`RightSidebar.vue:64-66` | 调宽 `mousemove` **无 rAF 节流**，每次都 `setWidth` → 响应式 → 内联 style → flex 重排 | 60–120 Hz 的每次 mousemove 触发一次 **300 项 grid 重排** |
| P1-14 | `src/components/MobileTabBar.vue:76-77`、`MobileHeader.vue:26-27` | 固定定位 + `backdrop-filter: blur(20px)`，**不在 `main.css:195-200` 的 `no-blur` 覆盖列表里** | 移动端滚动时，这两个浮层背后内容每帧变化 → **每帧重算 20px 模糊**。与当初为 `.main` 修掉的是同一类问题，只是换了个位置复发 |

### 2.3 网络与流量

| # | 位置 | 问题 | 后果 |
|---|---|---|---|
| P1-15 | `src/stores/sites.js:469-474` + `api/sites.js:80-85` | 轮询比对 `version` 但**请求体仍全量下载解析**；服务端只发 `Cache-Control: no-store`，从不发 `ETag`，也不读 `If-None-Match` | version 比对只省了 `rebuild()`，**一字节流量没省**。~4 MB/h/标签页，服务端每次还要回源读 115 KB Blob |
| P1-16 | `api/clicks.js:60-70` + `:123` | 每次匿名点击上报都要 `knownSiteIds()` 读一遍 115 KB 站点表（`useCache:false`） | 一次点击 = 3 次 Blob 操作、~230 KB 内网传输。限流 60 次/分钟/IP → 单 IP 每分钟可制造 ~14 MB Blob 流量 |
| P1-17 | `src/stores/sites.js:454-478` | `catch {}` 全空实现，`!res.ok` 直接 return；`cloudLoaded` 不区分成功/失败 | 断网时用户看到的是**构建期种子**（可能比云端旧很多），界面无任何提示；无 `navigator.onLine`、无退避重试 |
| P1-18 | `src/stores/sites.js:467` | `fetch` 无超时、无 abort；`App.vue:405-410` 每次 visibilitychange 都发一次，可并发叠加 | 弱网下请求堆积、响应乱序、流量翻倍 |

### 2.4 安全

| # | 位置 | 问题 | 后果 |
|---|---|---|---|
| P1-19 | `api/metadata.js:50-64` | `isBlockedHost` **只做字面 hostname 匹配，从不 `dns.lookup`**。协议白名单、私网段、云元数据 IP、逐跳重定向校验都做了，唯独缺 DNS 解析 | 用 `internal.evil.com`（A 记录指向 `169.254.169.254`）即可绕过；DNS rebinding 同样有效。这是一个**无鉴权、无限流的公网抓取代理**，可打内网/云元数据/做端口扫描与放大 |
| P1-20 | `api/session.js:37`、`:47-85` | 访问凭证 key 放 **query string**；无任何鉴权、无限流、**无 body 体积上限** | key 进入 Vercel 函数日志 / CDN 日志 / 浏览器历史 / Referer；任何人可无限次 POST 任意大小 JSON 灌满 Blob |
| P1-21 | `src/services/opsApi.js:9-23` | `SITES_ADMIN_KEY` 明文存 `localStorage`，且 `api/auth.js:134-139` 的 logout 是空实现（无状态会话、无吊销表） | XSS 或恶意扩展可拿到**永久明文共享密钥**，泄露后只能轮换密钥 + 重新部署 |

### 2.5 工程化

| # | 位置 | 问题 | 后果 |
|---|---|---|---|
| P1-22 | `vite.config.js:26` | `globPatterns` 含 `ico/png/svg` → SW 预缓存 **278 个图标 / 6.25 MB**（其中 72 个 `.ico` 就占 1.8 MB） | SW 安装阶段一次性下载 6.25 MB，首访带宽与安装耗时被拖垮；而多数图标用户永远不会看到。反向漏洞：glob 不含 `jpg/webp`，10+4 个图标离线时裂图 |
| P1-23 | `vite.config.js:6-34` + `sites.js:3` + `search.js:1-2` | 无 `manualChunks`；300 条种子数据静态 import、`fuse.js` + `pinyin-pro`（含拼音字典）静态 import | 主 chunk **746 KB**，首屏必须全量下载解析，而拼音字典和种子数据在首屏根本用不上 |

---

## 三、🟡 P2 技术债（节选，约 30 条）

**状态层**
- `sites.js:291/399` 回收站无容量上限（300 站全删 ≈ 150 KB+，是 P1-4 抛异常的源头）
- `sites.js:47` `visitCounts` 无清理路径，`clearLocalOverlay` 独独不清它
- `sites.js:279-287` 删除站点后 id 永久留在 `localOrder`；`reorderSites` 每次重写全量 300 条 id
- `sites.js:289-296` 单条 `deleteSite` 不摘 `selectedIds`，切换分类/范围也不清空 → **在 A 分类选了 3 个站，走到 B 分类点批量删除会删掉 3 个看不见的站**
- `sites.js:331-346` `togglePin` 与 `toggleArchive` 无互斥：归档的置顶站取消归档后会**突然弹到列表最前**
- `sites.js:472` `data.version` 为假值（0/缺失）时热更新**永久静默失效**
- `storeVersioning.js:36-44` 迁移只进不退：回滚部署时 v2 数据被 v1 代码原样读取并回写
- `storeVersioning.js:75-83` `decodeStored` 不做形状校验（`todos` 可被塞成对象 → TypeError；`clicks.pending` 被塞成字符串 → 向云端上报 `'0'`/`'1'` 假 siteId）
- `sites.js:19-28` `loadOverlay` 只校验顶层容器，不校验 `adds` 元素（`categories.js:13-23` 做了逐条过滤，`sites.js` 没做）→ 一条 null 会导致**首屏永久白屏**
- `favorites.js:8` `isFavorite` 是"假 computed"（getter 只返回闭包，依赖在调用方建立）

**点击上报**
- `clicks.js:95` `flushing` 守卫在 beacon 分支**之前** → 页面卸载时若 fetch 在途，sendBeacon 根本执行不到
- `clicks.js:67-70` flush 在途时产生的新增量可能长期滞留（`flushTimer` 已置空且不会重排）
- `clicks.js:104-108` `sendBeacon` 返回 true 只代表已排队，代码随即清空队列 → 失败即永久丢失

**生命周期**
- `clicks.js:183`、`health.js:86` `setInterval` 无句柄无清理；`clicks.js:176-179` 监听器无移除
- `sites.js:485-490` `stopPolling` **全项目无调用点**；`App.vue:410/412` document 监听无解绑（keydown 还是匿名箭头函数）

**渲染**
- `Sidebar.js:38-39` `markAnimating(140)` 短于实际 280ms 宽度过渡 → 收尾阶段重新背上 blur 重算
- `sidebar.js:30` `toggle()` 未调 `markAnimating()` → 移动端抽屉滑入期间享受不到 no-blur
- `SiteCard.vue:238` `transition: all` × 300
- `SiteCard.vue:31` 等 6 处 `@error="$event.target.remove()"` 直接摘 DOM 节点，与 Vue 失同步（rebuild 后图标也回不来）
- `SiteCard.vue:349` `flamePulse` infinite 动画 × 每张热门卡，7×24 常驻
- `CardsContainer.vue:48-89` 两个互斥 `<Draggable>` 分支 → 切换拖拽模式时 300 卡整体卸载重建；`vuedraggable` 每次 updated 向 300 节点写属性
- `CardsContainer.vue:204-219` `:list` 直接绑 computed 缓存数组，vuedraggable 会**就地 splice 计算值**（响应式反模式）
- 300 卡无虚拟滚动：`package.json` 已装 `vue-virtual-scroller` 但 0 处引用；现有 `content-visibility: auto` 只跳过绘制，不跳过 5400 个 computed 的创建

**服务端**
- `api/sites.js:158-160/229-244` 并发写入 read-modify-write 无 CAS → 两个并发 POST 都写 version+1，后写覆盖先写
- `shared/snapshots.mjs` 快照按 `version + 秒级 ts` 命名 + `allowOverwrite: true` → 同秒并发会**覆盖掉用于回滚的快照本身**
- `api/metadata.js:140/247` 抓取 8s + 翻译 6s = 14s，超过 Hobby 默认 10s 且 `vercel.json` 无 `maxDuration` → 504
- `api/auth.js:100-102` `GET /api/auth` 不鉴权且返回 `username`（虽有 scrypt + 失败锁定兜底）
- `shared/auth.mjs:43-48` 长度不等时直接 return，存在长度侧信道
- `api/sites.js:128-143` 错误路径返回 200 + 种子，前端无法区分"读取失败"与"真的没数据"
- `api/clicks.js:95-99` 同理返回 200 + 空数据 → 前端把"读失败"当"没有点击"写入，角标瞬间掉 0

**工程与脚本**
- 死依赖 4 个：`@vueuse/core`、`uuid`、`vue-virtual-scroller`、`workbox-window`（`src/` 下 0 处 import）
- 死文件 4 个：`GoogleSearchBar.vue`、`StatsBar.vue`、`WeatherWidget.vue`、`DigitalClock.vue`
- 三份 `hostOf` 重复实现（`utils/url.js:16`、`shared/site-infer.mjs:98`、`shared/ops/site-ops.mjs:32`），`url.js` 注释里写着"两边必须用同一把尺子"，实际有三把
- `validate-data.mjs:20` `knownCats` 定义后**从未使用** → 未登记分类可绕过校验，但运行时 `preflight.mjs:54` 会拦 → 本地通过、发布被卡
- `validate-data.mjs` 完全不校验 `desc`；不校验重复 host（实测已有 4 组：`github.com`、`okx.com`、`coinmarketcap.com`、`hero-sms.com` 各 ×2）
- `bookmarks.js:77` 未 HTML 转义（站点名含 `<`/`&` 会破坏导出文件）；`createdAt` 缺失时导出 `ADD_DATE="NaN"`
- `bookmarks.js:2-13` `FileReader` 只设 `onload` 未设 `onerror` → 读取失败静默无反应
- `scripts/publish.mjs:99` / `watch-deploy.mjs:128` 生产部署带 `--yes` 跳过确认，watch 模式保存一次就上生产
- `scripts/fetch-favicons.mjs:189-190` `fs.rmSync(path.join(root,'public',prev))`，`prev` 直接取自数据文件，含 `../` 可越权删除

---

## 四、修复方案（分三批）

### 第一批：急诊（改动小、止损快，建议今天就做）

| 序 | 修复 | 位置 | 改动量 |
|---|---|---|---|
| 1 | **区分"不存在"与"读取异常"**：只有确认为空（404/null）时才写种子且**先写快照**；读异常一律返回 503 或带 `degraded: true` 的种子响应，**绝不写 Blob** | `api/sites.js:122-143` | ~15 行 |
| 2 | **补 `{"handle":"filesystem"}`**，并为 `sw.js` / `manifest.webmanifest` 加显式路由 + `Cache-Control` | `vercel.json:5-11` | 3 行 |
| 3 | **补真实 PWA 图标**：生成 `public/pwa-192x192.png`、`pwa-512x512.png`（可从现有 favicon.svg 转） | `public/` | 2 个文件 |
| 4 | **图标抓取失败保留原 `icon`**；写文件前先备份；改 `tmp + renameSync` 原子写；`prev` 路径做 `path.resolve` 前缀校验 | `scripts/fetch-favicons.mjs:184-201` | ~10 行 |
| 5 | **version 单调递增 + inflight 单例 + AbortController 超时**：`if (Number(data.version) > cloudVersion.value)`，并共享一把在途锁 | `sites.js:467-478`、`App.vue:405-410` | ~12 行 |
| 6 | **统一 `safeSetItem` 包装**（try/catch + 降级提示），并调整 `deleteSite` 落盘顺序（先 `saveTrash` 再 `saveOverlay`） | `sites.js:140-152`、`clicks.js:50`、`categories.js:34`、`todos.js:10` | ~20 行 |
| 7 | **导出补 history**：`historyStore.visitHistory` → `historyStore.records` | `ExportPanel.vue:39` | 1 行 |

> 第 1、2、3 条做完需要重新部署才能验证；第 2 条不修，第 1 条的价值也会打折（SW 挂了，用户拿到的还是缓存旧包）。

### 第二批：性能与流量

> **已完成**（2026-10-10）。实施前先做了实测基线，结果**推翻了几条估算**（`pinyin-pro` 的拼音重算实测是 0.7 ms，不是 40–150 ms），因此本表已按下表的「处置」重排。
> 基线与对照数据、复现命令见 [`2026-10-10-batch2-baseline.md`](./2026-10-10-batch2-baseline.md)。

| 序 | 修复 | 位置 | 处置 | 实测结果 |
|---|---|---|---|---|
| 8 | `rebuild()` 按来源对象身份复用渲染对象；全表恒等时不换数组引用 | `sites.js` | ✅ 已做 | 单站改动脚本耗时 **7.31 → 1.88 ms** |
| 9 | `keyCache` 改按 id + 内容指纹 | `search.js` | ⛔ **不做** | 被序 8 覆盖（引用稳定后 WeakMap 不再失效）；改全局 Map 反而会为已删站点永久留条目 |
| 10 | Fuse 实例按 `sites` 引用缓存 **／** omni 输入加 150–200ms 防抖 | `search.js`、`useOmniBox.js` | ✅ 前半已做<br>⛔ 后半不做 | 缓存：零风险消除每键 O(n) 建索引<br>防抖：实测每键仅 0.13 ms，加防抖是**负优化** |
| 11 | `@select` 改稳定方法引用 **／** `SiteCard` 加 `v-memo` | `CardsContainer.vue`、`SiteCard.vue` | ✅ 前半已做<br>⛔ 后半不做 | v-memo 依赖数组漏项会**静默渲染陈旧内容**，而单卡改动全量重渲染实测仅 1.88 ms，风险 > 收益 |
| 12 | 分类表建 Map 索引；`visited/isFav/clickCount` 提到 store 建表 | `categories.js`、`SiteCard.vue` | ⛔ **不做** | 切分类脚本成本实测 0.31 ms，其余 5–14 ms 全是**布局**成本，建索引解决不了 |
| 13 | ETag / If-None-Match，命中 304 空体 | `api/sites.js`、`sites.js` | ✅ 已做 | 轮询传输 **34,180 B → 0 B**（线上下断实测） |
| 14 | mousemove 用 rAF 合并，mouseup 再写回 | `Sidebar.vue`、`RightSidebar.vue` | ✅ 已做 | 同一帧内 20 次 mousemove 只写 1 次（`test-resize.mjs` 6/6） |
| 15 | `markAnimating(140)` → 300；`toggle()` 补 `markAnimating` | `sidebar.js` | ✅ 已做 | `toggleCollapse`/`toggleRightCollapse` **原本就有**，无需补<br>「移动端固定栏纳入 no-blur」**不做**：固定栏尺寸不变，不产生模糊重算，关掉只会白白改掉它的玻璃观感 |
| 16 | SW 预缓存只留应用外壳，图标改运行时缓存，补 `jpg,webp` | `vite.config.js` | ✅ 已做 | **294 条 / 7.17 MB → 16 条 / 1.07 MB** |
| — | （基线上新增）Google Fonts 样式表改非阻塞 | `index.html` | ✅ 已做 | 首卡出现 **573 → 478 ms**；该域名在国内网络下不可达，却是渲染阻塞项 |

**顺带记录两条「体检报告估错了」的结论**，避免以后照旧数字做决策：`pinyin-pro` 的实际吞吐比预估高约两个数量级；Vue 的响应式是微任务批处理，用 `dispatchEvent` 的同步栈去测检索耗时会得到 0.1 ms 的假象（真正的计算在 flush 里）。

### 第三批：安全加固与架构（排期）

| 序 | 修复 | 位置 |
|---|---|---|
| 17 | **DNS 解析校验**：`fetch` 前 `dns.promises.lookup(hostname, {all:true})`，每个 IP 都过一遍私网规则；`/api/metadata` 加鉴权 + 限流 | `api/metadata.js:50-64` |
| 18 | **`/api/session` 的 key 改 Authorization 头**，加 IP 限流 + body 体积上限（256 KB） | `api/session.js:37-85` |
| 19 | **浏览器端只走会话 token**（可过期、可轮换），禁用"页面里粘贴 SITES_ADMIN_KEY"；token 放 sessionStorage + 短 TTL | `src/services/opsApi.js:9-23` |
| 20 | **`sanitizeSites`**：站点表加元素级校验（`length >= N` 且每条有非空 `id/name/url`），非法则保留上一版；服务端同步加 | `sites.js:444-452`、`api/sites.js:210-213` |
| 21 | **修 `clearLocalOverlay` 与 `restoreFromTrash`**：不清墓碑 / 恢复前判 id 是否已存在 | `sites.js:434-441`、`409-421` |
| 22 | **history 去重 + 方向统一**；`addRawRecord` 按 timestamp 有序插入 | `history.js:8-25` |
| 23 | **主 chunk 分包**：`search.js`（fuse + pinyin）与种子数据改动态 import + `manualChunks` | `vite.config.js`、`sites.js:3`、`search.js:1-2` |
| 24 | **清死依赖 + 死文件**：卸载 `@vueuse/core`/`uuid`/`vue-virtual-scroller`/`workbox-window`；`git rm` 4 个死组件 | `package.json`、`src/components/` |
| 25 | **`validate-data.mjs` 补 `desc` 校验、重复 host 校验、接上真实分类白名单** | `scripts/validate-data.mjs` |
| 26 | **并发写入 CAS + 快照 `addRandomSuffix`**；`vercel.json` 补 `maxDuration` 与 `regions` | `api/sites.js`、`shared/snapshots.mjs`、`vercel.json` |
| 27 | **离线状态可见**：暴露 `cloudError`，UI 提示"离线中，展示本地数据"；加 `online` 事件 + 指数退避 | `sites.js:454-478` |
| 28 | **接虚拟滚动**（或先做分页/无限滚动，每页 60 张） | `CardsContainer.vue:48-89` |
| 29 | **`hostOf` 收敛为一份**，前端与脚本统一引用 | `url.js`、`site-infer.mjs`、`site-ops.mjs` |
| 30 | **`selectedIds` 跨范围清理**；`togglePin`/`toggleArchive` 互斥 | `sites.js:289-346` |

---

## 五、已排查但未发现问题的方向

避免重复排查，以下方向本次已确认**没问题**：

- **600 个 document 监听的历史问题**：未复发。`SiteCard` 全文无 `addEventListener`，右键菜单已收敛为全局单例 `ContextMenuHost`（且监听在 `onUnmounted` 全部移除）
- **`sidebarStore.animating → no-blur` 优化**：链路完整、选择器命中、特异性足够（0,3,0 且写在壁纸规则之后）。**不要删这条**
- **v-for key 稳定性**：全部用稳定 id（`item-key="id"`、`:key="site.id"`、`:key="item.key"`）
- **`splitHighlight`**：大小写、空串、多次出现、结尾兜底全部正确
- **`resolveTokens` / `tokensToCssVars`**：键集恒等，range 夹取、toggle/select 处理正确，无覆盖错误
- **`normalizePurposes`**：大表全是模块级常量，无性能问题
- **写接口鉴权绕过**：`checkAuthHeader` 覆盖完整，无 query 传密钥旁路、无 cookie/CSRF 面
- **快照路径穿越**：`isSnapshotPathname` 严格校验命名
- **health 的浏览器端探测**：完全不探测，只读云端结论，TTL + inflight 去重完整
- **autoAdd 重复入库**：按域名 in-flight 锁 + 写库前二次查重，并发连按回车安全
- **未节流 resize**：全项目无 `window.addEventListener('resize')`，自适应列数走 CSS
- **`will-change` 滥用**：0 处使用
- **rebuild 调用路径**：所有写操作都有 `rebuild()`，无漏调
- **`toggleBatchMode`/`toggleDragMode` 互斥**：双向互斥且 UI 层有 disabled 兜底
- **store 循环依赖**：单向依赖，无环
