# 第二批（性能与流量）实测基线

> 2026-10-10。测量环境：`vite preview` @ `http://localhost:4173`（HEAD `7feaaf8` 的构建产物）+ 无头 Chrome 154，视口 1440×1000。
> 脚本：`probe/perf-batch2.mjs`、`probe/perf-cloud-update.mjs`、`probe/perf-firstpaint.mjs`、`probe/_sw-stats.mjs`。

## 一、结论先行：体检报告的性能估算需要修正

体检报告（`2026-10-10-full-audit.md` §2.2）里几条 P1 的耗时估算**在真实浏览器里无法复现，高估了约两个数量级**。实测：

| 报告断言 | 报告估算 | 实测 | 倍差 |
| --- | --- | --- | --- |
| 「rebuild 后首次搜索要重算 1552 次 `pinyin()`」 | 40–55 ms（Node）/ 60–150 ms（移动端） | **0.7 ms**（冷）、0.1 ms（热） | ~70× |
| 「敲拼音串每敲一键 `new Fuse` + search」 | 3–10 ms + 6–26 ms，累计 100–280 ms | **0.2 ms** | ~100× |
| 「切分类触发 filteredSites 重算」 | 未给 | 脚本 **0.3 ms**（成本全在布局：9.7 ms） | — |
| 「改 1 个站点 → 300 张卡全量重渲染」 | 「代价从 300 降到 1」 | 脚本 **2.2 ms** + 布局 **3.5 ms**，每 30 s 一次 | 总量已可忽略 |

**根因**：`pinyin-pro` 是 O(字数) 的哈希查表，300 个站点名的拼音全量重算是亚毫秒级；报告的数应该在 Node 冷启动 / 逐次 `performance.now()` 包裹的测法下得到的，把 JIT 预热与计时开销算进了业务成本。
**推论**：`keyCache` 失效、Fuse 重建索引这两个「问题」客观存在，但**不构成用户可感知的性能缺口**。据此把这两项降级（见「不做什么」）。

## 二、真正的大头（实测、可复现）

### 1. SW 预缓存 294 条 / **7.17 MB**，其中图标 6.11 MB

```
precache 清单 294 条：icons/ 占 278 条 = 6.11 MB，assets+html 仅约 0.4 MB
```

首访实测（`perf-firstpaint.mjs`，冷缓存轮）：

```
第 1 轮: 传输 4637 KB     ← SW 安装期在后台拉图标
第 2–4 轮: 传输 498–813 KB
```

**首访白下约 4.6 MB**，而绝大多数图标用户一辈子看不到。反向漏洞：`globPatterns` 不含 `jpg/webp`，而 `icons/` 里有 10+4 个这两种格式 —— 离线时裂图。

### 2. 轮询流量 **34,180 B / 30 s / 标签页**（= 4.1 MB/小时）

线上实测（`curl` 经本机代理）：

```
无 If-None-Match : HTTP 200  transferred=34180 B   (Brotli；原始 JSON 118,216 B)
带 If-None-Match : HTTP 304  transferred=0 B       ← Vercel 已自动打 ETag，且认这个头
```

客户端 `fetchCloud()` **从不发条件请求**，`api/sites.js` 又显式 `no-store`，于是每次轮询都完整下载 + 完整解析 118 KB JSON。**服务端能力已经具备，缺的只是客户端这一个头。**

### 3. `mousemove` 拖拽无 rAF 合并

`Sidebar.vue:114-126`、`RightSidebar.vue:64-75` 每次 `mousemove` 直接 `setWidth()` → 响应式 → 内联 style → 300 项 grid 重排（60–120 Hz）。切分类的布局成本实测 9.7 ms，可推知拖拽期间每帧都在付这个量级。

### 4. 首屏时间线（中位）

| 指标 | 值 |
| --- | --- |
| TTFB | 7 ms |
| domInteractive | 49 ms |
| domContentLoaded | 601 ms |
| 卡片出现 | **901 ms** |
| 首屏传输（稳态） | 813 KB |

主 chunk `index-*.js` = **860.4 KB raw / 330.9 KB gz**，其中 `pinyin-pro` 单独就 317 KB raw。资源明细显示 `index.js` 在 43→158 ms 完成下载，其余到 601 ms 的 440 ms 花在**脚本求值 + 300 卡的样式/布局**上。

**附带发现**：`index.html` 里 Google Fonts 样式表是**渲染阻塞**的第三方资源（`<link rel="stylesheet" href="https://fonts.googleapis.com/...">`，无 `media`/`onload`)。而 `Inter` 只被 `visualScheme.js` 的 `sans` 方案栈引用，基础 `--font` 是系统字体栈 —— 为一个可选视觉方案付了首屏阻塞的代价，且国内网络下该域名不可达。

## 三、据此定下的第二批范围

### 做（有实测支撑）

| 序 | 项 | 依据 |
| --- | --- | --- |
| 16 | SW 预缓存只留 `assets/**` + `index.html` + 两个 PWA 图标 + favicon，图标改运行时缓存，补 `jpg,webp` | 首访 −4.6 MB |
| 13 | 客户端带 `If-None-Match`；服务端去掉 `no-store` 改可重验证 | 4.1 MB/h → ~24 KB/h |
| 14 | `mousemove` 用 rAF 合并，`mouseup` 再写回 store | 拖拽期每帧重排 |
| 15 | `markAnimating(140)` → 300；`toggle()` 补 `markAnimating()`；移动端固定栏纳入 `no-blur` | 14 的配套；`markAnimating(140)` 短于拖拽中的停顿会让模糊中途弹回 |
| — | Google Fonts 样式表改非阻塞（`preload` + `media="print"` + `onload`） | 首屏阻塞项 |
| 8 | `rebuild()` 按 id 复用对象引用（内容未变的沿用旧对象） | 消掉每 30 s 的 2.2 ms 无用功，并把「改 1 条 → 300 卡重渲染」收敛到 1 张；同时让 9 的缓存重新有意义 |
| 10a | Fuse 实例按 `sites` 数组引用缓存 | 零成本消除每键 O(n) 建索引 |
| 11a | `@select` 改稳定方法引用（`emit('select', site)`） | 消除每次渲染 300 个内联闭包 |

### 不做（附实测理由）

| 序 | 项 | 不做的理由 |
| --- | --- | --- |
| 9 | `keyCache` 改「id + 内容指纹」的全局 Map | **被序 8 覆盖**：对象引用稳定后 WeakMap 缓存不再失效，天然正确。改成全局 Map 反而要为已删站点永久留条目，是引入泄漏风险去解决一个已经被解决的问题 |
| 10b | omni 输入加 150–200 ms 防抖 | 实测每键 0.7 ms。加防抖只会让「打第一个字到出结果」多等 150–200 ms，是**负优化** |
| 11b | `SiteCard` 加 `v-memo` | 实测单卡改动全量重渲染仅 2.2 ms；而 `v-memo` 依赖数组漏项会**静默渲染陈旧内容**，风险大于收益 |
| 12 | 分类表建 Map 索引 / `visited`、`isFav`、`clickCount` 提到 store 建表 | 切分类的脚本成本实测 0.3 ms，其余 9.7 ms 全是布局成本 —— 建索引解决不了布局 |

## 四、改完之后的对照（同一套探针，干净 Chrome 配置）

A/B 方法：`probe/_ab-run.mjs` 每次都新建一个 Chrome `user-data-dir`。原因是用同一个
profile 测新旧两版，上一版的 Service Worker 会留在里面，两版的预缓存行为会混在一起。

| 指标 | 改前 | 改后 | 变化 |
| --- | --- | --- | --- |
| SW 预缓存条目 | 294 条 | **16 条** | −278 条 |
| SW 安装期须下载字节 | **7.17 MB** | **1.07 MB** | **−6.10 MB（−85%）** |
| 首卡出现（中位 5 轮） | 573 ms | **478 ms** | −95 ms（−17%） |
| 单站改动脚本耗时（右键置顶，中位 6 轮） | 7.31 ms | **1.88 ms** | **−5.4 ms（3.9×）** |
| 轮询传输（内容未变） | 34,180 B | **0 B（304）** | −100% |
| 拼音搜索每键 | 0.17 ms | 0.13 ms | 噪声内，无实质差别 |
| 切分类脚本 / 布局 | 0.54 / 13.85 ms | 0.31 / 5.40 ms | 布局波动大，脚本在噪声内 |
| 应用外壳 gz | 389.5 KB | 386.2 KB | 基本不变（没做分包） |

说明两处容易误读的地方：

- **「首访下载」没有做 A/B 对比。** 文档侧 resource timing 统计不到 Service Worker
  自己发起的预缓存请求，而旧版 SW 因为要下 7 MB、在测量窗口内根本跑不完，于是旧版
  数字反而更「好看」。可靠的硬数字是**预缓存清单本身**（构建输出 + `probe/_sw-stats.mjs`）：
  SW 的 install 事件必须逐条下载清单里的条目，7.17 MB → 1.07 MB 是确定的账。
- **检索与切分类的差异都落在噪声里**，与「一、结论先行」的判断一致 —— 这两处本来就不是瓶颈，
  之所以还是改了（Fuse 实例缓存、`@select` 稳定引用），是因为它们零风险且是明确的浪费，
  而不是因为测出了收益。

### 新引入的不变量（改这块前必读）

`rebuild()` 现在按**来源对象身份**复用渲染对象，依赖一条不变量：**来源对象一律整体替换，
绝不就地改字段**。云端 `src` 来自 `res.json()`（每次轮询都是新对象），本地新增层 / 编辑层
在写操作里都是 `{ ...old, ...patch }` 整体替换，所以成立。**若将来写下
`cloudSites.value[i].name = x` 这类就地改，视图不会跟着变** —— memo 会因为 src 身份未变
而照旧返回上一个对象。详见 `src/stores/sites.js` 的 `rebuildMemo` 注释。

### 新增的守卫脚本

| 脚本 | 断言数 | 覆盖 |
| --- | --- | --- |
| `probe/test-etag-poll.mjs` | 12 | 条件请求发出、304 命中、内容变化能恢复、脏响应不被 304 钉死 |
| `probe/test-resize.mjs` | 6 | 同一帧内 20 次 mousemove 只写一次、mouseup 补写、光标复位 |
| `probe/test-visit-memo.mjs` | 6 | recordVisit 与 memo 的交互、访问计数不被无关 rebuild 冲掉、持久化 |
| `probe/perf-card-edit.mjs` | — | 单站改动的 A/B 代价（含徽章 / 卡片数 / 落盘校验） |
| `probe/_ab-run.mjs` | — | 干净 Chrome 配置下跑一轮 `perf-batch2` |

## 五、复现命令

```bash
npx vite preview --port 4173 --strictPort            # 后台
chrome --headless=new --remote-debugging-port=9345 --user-data-dir=.chrome-perf --no-proxy-server
node probe/_ab-run.mjs "标签"                                  # 首屏 / 检索 / 切分类 / 产物（干净配置）
node probe/perf-card-edit.mjs 9345 http://localhost:4173 6      # 单站改动代价 A/B
node probe/perf-cloud-update.mjs 9345 http://localhost:4173 5   # 云端更新 → 全量重渲染（打桩 fetch）
node probe/_sw-stats.mjs                                        # SW 预缓存规模
node probe/test-etag-poll.mjs 9345 http://localhost:4173        # 12 项
node probe/test-resize.mjs 9345 http://localhost:4173           # 6 项
node probe/test-visit-memo.mjs 9345 http://localhost:4173       # 6 项
node probe/omni-verify.mjs 9345 http://localhost:4173           # 18 项（全能框回归）
```
