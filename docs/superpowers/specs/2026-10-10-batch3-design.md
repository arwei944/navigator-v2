# 第三批：安全加固与架构 —— 设计

**日期**：2026-10-10
**状态**：已实现（实施记录见 `.workbuddy/memory/2026-10-10.md`）
**来源**：`docs/audit/2026-10-10-full-audit.md` §四「第三批」序 17–30

---

## 0. 这一批的取舍口径

沿用第二批立下的规矩：**先看代码里的真实形态与实测，再决定做不做**，并把「不做」的理由写成文档，
避免以后照旧清单重做。第三批与前两批的区别是：这一批**绝大多数是「确实该修」**（安全与并发是实打实的洞），
只有序 28 是收益待证的优化项。

与前两批一致的三条硬约束：

1. **不改数据**。本批只改代码；发布只做「构建 + 部署」，不碰 `api/sites-data.json` 与云端 Blob。
2. **不加无法验证的改动**。本机没有直连公网的能力（出站要走 7897 代理，Node 的 fetch 不认代理），
   所以凡涉及「真去公网抓页面」的路径，要么用本地服务器做传输层集成测试，要么明确写清它是线上才生效的改动。
3. **不引入新依赖**（序 24 反而是在减依赖）。条件写用的是 `@vercel/blob` 2.8.0 已有的 `ifMatch`。

---

## 一、逐项决定

| 序 | 项 | 决定 | 做法要点 |
|---|---|---|---|
| 17 | `/api/metadata` SSRF（DNS） | ✅ 做（加强版） | 不只做「fetch 前 `dns.lookup` 预检」，而是让校验发生在**实际连接**的解析回调里 → 连 DNS rebinding 的 TOCTOU 窗口一起关掉 |
| 18 | `/api/session` 凭据与体积 | ✅ 做 | key 从 query 移入 `Authorization` 头；body 上限 256KB；合并后快照体积门禁；per-instance 限流 |
| 19 | 浏览器端凭据 | ✅ 做 | 会话 token 存 `sessionStorage`；删掉「粘贴 SITES_ADMIN_KEY」的入口 |
| 20 | `sanitizeSites` | ✅ 做 | 新增 `shared/sanitize.mjs`，前后端共用同一把尺子 |
| 21 | 覆盖层 / 回收站 | ✅ 做 | `clearLocalOverlay` 不再清墓碑；`restoreFromTrash` 恢复前判 id 是否已存在 |
| 22 | history 去重与方向 | ✅ 做 | `addRecord` 按 siteId 去重；`addRawRecord` 按 timestamp 有序插入 |
| 23 | 主 chunk 分包 | ✅ 做（改动范围收窄） | `pinyin-pro` 改按需加载；vendor 分包。**种子数据保留静态**（见 §三） |
| 24 | 死依赖 / 死文件 | ✅ 做 | 移除 4 个 0 引用依赖、`git rm` 4 个死组件 |
| 25 | `validate-data.mjs` | ✅ 做 | 接上真实分类白名单；补 `desc`；补重复 host（warning，`--strict` 升级为 error） |
| 26 | 写入并发 / 快照 / 超时 | ✅ 做（两项偏离） | `ifMatch` 条件写；快照名加随机后缀；**不改 `maxDuration`/`regions`**（见 §三） |
| 27 | 离线状态可见 | ✅ 做 | `cloudError` 上抬到 UI；`online/offline` 事件 + 指数退避 |
| 28 | 虚拟滚动 | ⏸ 实测后定 | 先量化 300 卡的挂载/滚动成本，再决定（结论见 §四） |
| 29 | `hostOf` 收敛 | ✅ 做 | 以 `shared/site-infer.mjs` 的一份为唯一实现，其余 re-export |
| 30 | 选择集 / 置顶归档互斥 | ✅ 做 | 切范围时清理不可见选择；`togglePin` 与 `toggleArchive` 互斥 |

---

## 二、关键设计决策

### 2.1 序 17：为什么不做「fetch 前预检」这一版

审计给的做法是「`fetch` 前 `dns.lookup(hostname, {all:true})`，每个 IP 都过一遍私网规则」。
它挡得住 `internal.evil.com → 169.254.169.254` 这种**静态**指向，但挡不住 **DNS rebinding**：
预检拿到的是一批公网 IP，而 `fetch` 发起连接时会**再解析一次**，攻击者只要让第二次解析返回内网地址就能过。
两次解析之间就是 TOCTOU 窗口 —— 而这正是审计点名的攻击手法。

正确的位置是**连接层的解析回调**：`http(s).request({ lookup })` 允许我们替换解析器。
把校验放进这个回调，那么「用于校验的 IP」与「用于连接的 IP」一定是同一个，窗口归零。

代价是不再能用全局 `fetch`（它不接受自定义 lookup，Node 也没导出内置的 undici `Agent`）。
因此新增 `shared/http-fetch.mjs`：基于 `node:http`/`node:https` 的最小 GET 实现，负责

- 自定义 `lookup`（先 `dns.lookup(all:true)`，逐个校验，任一命中私网段即拒；默认只回第一个合法地址）；
- **`Accept-Encoding: identity`**，并在服务端无视该头返回压缩体时用 `node:zlib` 兜底解压；
- `MAX_BYTES` 字节上限、`signal` 超时、`redirect: manual`（重定向仍由 `api/metadata.js` 手动逐跳跟随，
  每一跳都重新走一次校验，包括 hostname 变化后重新解析）。

**保留** `isBlockedHost` 的同步字面检查并导出：它仍是第一道门（零成本挡掉字面内网地址），
且 `tools/console/test-guard.mjs` 依赖它。

### 2.2 序 18/19：凭据的存放位置

| 位置 | 改前 | 改后 |
|---|---|---|
| session key | `GET /api/session?key=xxx`（query） | `Authorization: Bearer xxx` |
| 后台凭据 | `localStorage['nav_admin_key']` = 共享密钥明文 | `sessionStorage` = 登录签发的会话 token |

- **`sessionStorage` 而不是「加密后存 localStorage」**：浏览器里没有能挡住 XSS 的加密（密钥本身也在 XSS 可达范围内）。
  真正有效的只有两条：**缩短有效期**（token 有 TTL）+ **缩短暴露窗口**（关标签页即失效），
  而 `sessionStorage` 天然满足后者。共享密钥不再进浏览器，泄露后也就不需要轮换密钥 + 重新部署。
- **CLI / 脚本不受影响**：`shared/auth.mjs#checkAuthHeader` 同时接受会话 token 与共享密钥，
  CLI 用密钥这条路保持不变。
- `/api/session` 的 key 是**用户自定的隔离名**，与后台凭据不是一回事，因此仍由用户持有；
  挪进请求头的目的是不让它进 Vercel 函数日志 / CDN 日志 / 浏览器历史 / Referer。

### 2.3 序 20：`sanitizeSites` 的判据

放在 `shared/sanitize.mjs`，前后端同一份（`api/sites.js` 与 `src/stores/sites.js` 都 import 它）：

```
合法 = 非空数组 ∧ 每条是对象 ∧ id/name/url 都是非空字符串 ∧ id 不重复
不合法 → 返回 null，调用方保留上一版，绝不写入
```

「保留上一版」比「清洗成半张表」更重要：一次脏发布让前端白屏，比拒绝这次发布严重得多。
服务端同样用它做写入前门禁 —— 脏数据落盘后，靠快照回滚是第二道，但那次发布本该被拒。

### 2.4 序 23：为什么种子数据不做延迟加载

审计原文是「300 条种子数据静态 import + fuse/pinyin 静态 import → 首屏全量下载解析」。
但这两者在首屏的**角色不同**：

- `pinyin-pro`（317 KB raw）是**纯能力**：不搜索就完全用不到 → 延迟加载没有代价，收益直接。
- 种子数据（115 KB raw）是**首屏兜底**：它是 `/api/sites` 返回之前唯一的内容来源，
  也是接口 503 时用户还能看到东西的原因。改成延迟加载 = 首屏先白一屏、等接口回来才有卡片，
  弱网与离线场景直接变差。

因此只做 pinyin 的按需加载，种子保留静态，并在本文档记下这个偏离。

### 2.5 序 26：`ifMatch` 的边界

`@vercel/blob@2.8.0` 的 `put` 支持 `ifMatch`（ETag 条件写），冲突抛 `BlobPreconditionFailedError`。
实现为：

```
读 prev（含 etag）→ 改 → put(PATHNAME, body, { ifMatch: prev.etag, allowOverwrite: true })
                                   ↓ 失败
                                   409 冲突，前端提示「数据已被其他写入更新，请刷新后重试」
```

**首次写入**（无 prev）走 `allowOverwrite: false`，与既有种子初始化路径一致：
并发的冷启动里只有一个能成功。

回滚路径同样带 `ifMatch`：回滚是最需要防并发的操作。

---

## 三、明确不做 / 偏离（附理由）

| 项 | 决定 | 理由 |
|---|---|---|
| 序 26 的 `vercel.json` 补 `maxDuration` | ⛔ 不做，改为收内部预算 | `maxDuration` 超过账户计划上限会让**整个部署失败**；而真实问题是「抓取 8s + 翻译 6s = 最坏 14s」超过默认 10s。改成给 `api/metadata.js` 一个**总预算 9s**：抓取占前 6s，翻译用剩余时间（并保证至少 2s），任何超时都退回原文。这既解决了 504，又不赌账户计划 |
| 序 26 的 `vercel.json` 补 `regions` | ⛔ 不做 | 指定区域在 Hobby 计划上不生效（函数固定 iad1，线上 `X-Vercel-Id` 实测 `sfo1::iad1`）。收益不确定、失败代价是部署被拒 —— 属于「用整站可部署性去换一个可能被忽略的字段」 |
| 序 23 的「种子数据延迟加载」 | ⛔ 不做 | 见 §2.4：它是首屏兜底与离线韧性，延迟加载等于拿弱网下的可用性换几十 KB |
| 序 28 虚拟滚动 | ⏸ 见 §四 | 需实测收益与回归风险后才能定 |

---

## 四、序 28 的评估口径

要回答的只有一个问题：**「300 张卡都没虚拟化」在真机上到底贵多少？** 分三段量：

1. **挂载**：300 张卡从零渲染到首卡可见的耗时（`ScriptDuration` + `LayoutDuration` 差值）；
2. **滚动**：连续滚动一屏的帧间隔与 longtask 数（判断卡在 JS 还是绘制）；
3. **已有机制的实际效果**：`content-visibility: auto` 跳过了绘制的哪一部分、有没有跳过
   5400 个 computed 的**创建**（审计断言「只跳过绘制」）。

只有当 (1)+(2) 的量级真的构成用户可感知的卡顿时才引入虚拟滚动；否则写明实测数字不做，
理由是虚拟滚动与 `vuedraggable`（需要全部节点在 DOM 里）、瀑布流的 CSS 多栏（`column-count`
不支持虚拟化）**天然冲突**，为一个不成立的收益去拆掉两个既有能力不划算。

### 4.1 实测结论：**不引入虚拟滚动**（保留 `content-visibility`）

探针 `probe/perf-virtual.mjs` 用「零依赖 CDP 驱动 headless Chrome」量了四轮。结论与依据：

| 观测 | 结果 | 说明 |
|---|---|---|
| 空闲基线帧间隔（无滚动） | 中位 16.6 ms / 最大 19.4 ms | 本机 `--disable-gpu` 软件光栅下也有抖动，这是**噪声下限** |
| 滚动 40 步期间 `longtask` | **0 条** | 主线程完全没被阻塞 —— 卡顿若有，也在光栅/合成，不在 JS |
| 滚动帧间隔（`content-visibility: auto` 开） | 中位 121.9 ms | 受软件光栅支配 |
| 滚动帧间隔（关掉该属性，对照） | 中位 147.1 ms | 说明**该属性确实起作用，保留** |
| 站点数 300 → 40 后的挂载脚本成本 | 357.8 ms → 410.3 ms | 噪声内，**没有下降**；且对照组受「种子先渲 300 卡」污染（已如实标注） |

**方法论上的一次自我纠正**：第一版探针用 rAF 帧间隔下结论，测出「滚动中位 291.9 ms」并据此
倾向引入虚拟滚动；补上「先量空闲基线」之后才发现基线本身就有 180 ms 级的偶发帧 ——
判据随即换成 `Page.getMetrics()` 的确定性计数器（`LayoutCount`/`RecalcStyleCount`/
`LayoutDuration`/`RecalcStyleDuration`，浏览器自己记的账，不受调度抖动影响）。
这与第二批「用 `dispatchEvent` 同步栈测检索耗时得到 0.1 ms 假象」是同一类错误。

**复访触发条件**（写下来，免得以后照旧清单重做）：当且仅当出现下列之一时重新评估 ——
站点数超过 ~1200 条；或真机（非 headless / 有 GPU）实测滚动出现**可感知掉帧**且 `longtask` > 0；
或卡片内引入每卡监听器/定时器等非纯渲染成本。届时优先做「按视口分页 + 保留拖拽」而不是直接上虚拟列表。

---

## 五、验收标准

| # | 标准 |
|---|---|
| 1 | 新增守卫脚本覆盖：SSRF（字面 + DNS + 重定向 + rebinding）、sanitizeSites、history 去重、选择集清理、pin/archive 互斥、快照命名防覆盖 |
| 2 | `tools/console/test-guard.mjs`（SSRF 既有用例）保持全绿 |
| 3 | `npm run console:test:all` 退出码 0 |
| 4 | `npm run validate` 退出码 0（新增检查不得让既有数据失败） |
| 5 | 构建产物：主 chunk 不再含 `pinyin-pro`；首屏资源总量与首卡时间有前/后对照 |
| 6 | 线上验收：`/api/metadata` 对 `internal.evil.com` 类目标返回 400；`/api/session?key=` 旧路径不再工作而带 Authorization 头可用；站点表 version 未因本次发布变化 |
| 7 | 数据一条未动（发布前后 `version` 相同） |

---

## 六、实施记录与实测

### 6.1 计划外的发现（都已修，且都已加守卫）

**发现 1：`workbox-window` 不是死依赖。**
序 24 的清单把它列为「0 引用」。移除后构建直接失败：

```
[vite]: Rollup failed to resolve import "workbox-window" from "/@vite-plugin-pwa/virtual:pwa-register"
```

它是 `virtual:pwa-register`（`src/main.js` 的 `registerSW` 就来自这里）的运行时依赖，改前的产物里
本来就有一个 `workbox-window.prod.es5-*.js` chunk —— **产物里存在的 chunk 就是「被用到」的硬证据**，
静态 grep 找不到 import 只是因为引用发生在虚拟模块里。已恢复为 devDependency。
教训：删依赖前除了 grep 源码，还要看一眼**上一个构建产物里有没有对应 chunk**。

**发现 2：序 23 只改 `utils/search.js` 不够 —— 入口 chunk 里仍有一条静态 import。**
改完 search.js 后，产物里：

```js
// dist/assets/index-*.js（入口）
import{pinyin as La}from"./pinyin-DIyzB9yW.js";   // ← 静态！首屏照样下载 226 KB
```

原因是 `src/services/autoAdd.js` 顶层静态 import 了 `shared/auto-category.mjs`，
而后者顶层静态 import 了 `pinyin-pro` —— 于是 pinyin-pro 经由「autoAdd → auto-category」
重新进入**首屏静态图**，且 Vite 还为此在 `index.html` 里注入了一条
`<link rel="modulepreload" href="/assets/pinyin-*.js">`。分包等于没做。

修法：`autoAdd.js` 改为在调用点 `await import('../../shared/auto-category.mjs')`
（`suggestCategory` 本来只在用户粘网址时才用）。修完后：

- `index.html` 不再有 pinyin 的 modulepreload；
- 入口里只剩 `import("./pinyin-*.js")`（动态）；
- 新增了 `tools/console/test-bundle.mjs` 把这三条都钉成产物断言 —— 这一项**必须测产物**，
  因为在源码层面「看起来做对了」太容易了。

**发现 3：`fetchCapped` 的字面主机检查不能只留给调用方。**
对**字面 IP**（`http://127.0.0.1/`），Node 的 `net.connect` 根本不做 DNS —— pinned lookup 不会被调用。
实测不挡的话它真去连、报 `ECONNREFUSED`/`ETIMEDOUT` 而不是 `BLOCKED_HOST`。
所以 `shared/http-fetch.mjs` 自己补了一次 `isBlockedHost`（注入 `lookup` 时跳过，那是显式的测试路径）。
现在两层防线**各自自足**：字面规则在 fetchCapped 内，解析规则在 pinned lookup 内。

**发现 4：`autoTranslate(info, ua, timeoutMs)` 收了 `timeoutMs` 却仍用硬编码 6000。**
handler 精心计算的「剩余预算」被无声忽略 —— 翻译仍可能吃满 6s，把总耗时顶回 12s，
即 §三 里那条「不改 `maxDuration` 而要收内部预算」的改动**实际上没生效**。已改为用传入值，
并保证下限 1s。

**发现 5（被自己的守卫抓到）：`textKeys` 里的 `const py` 遮蔽了 `py()` 函数** → TDZ 报错
`Cannot access 'py' before initialization`。`tools/console/test-frontend.mjs` 一跑就炸，
是这一批里「守卫真的拦住了东西」的实例。

### 6.2 序 23 的前/后对照（产物实测）

| | 改前 | 改后 |
|---|---|---|
| 入口 chunk | `index-BJD5H8t6.js` 861.2 KB | `index-*.js` 402.6 KB |
| vendor（vue/router/pinia） | 与入口混在一起 | `vendor-vue-*.js` 147.0 KB（独立，业务改动不再让它失效） |
| `pinyin-pro` | 混在入口里 | `pinyin-*.js` 226.4 KB（**动态**，且不在 modulepreload 里） |
| 首屏 JS 合计 | 887.6 KB raw / 332.1 KB gz | **566.5 KiB raw / 196.0 KiB gz** |
| 首屏节省 | — | **−332.2 KB raw（−37%）/ −130.1 KB gz（−39%）** |

（「改前」取自上一版产物；本次同时删掉了 4 个死组件与 3 个死依赖，故两者共同贡献这个差额。
`sizes on disk` 与 Vite 日志的 kB 口径不同：Vite 报字符数，拼音词典全是多字节 CJK，差约 38%。）

### 6.3 新增守卫脚本

| 脚本 | 覆盖 | 量 |
|---|---|---|
| `tools/console/test-netguard.mjs` | 序 17：IPv6 展开写法、`createPinnedLookup` 语义、**反 rebinding 断言**、`fetchCapped` 真实传输层（本地服务器实测截断/不跟重定向/解压/拒绝） | 90 条 |
| `tools/console/test-robust.mjs` | 序 20/22/29：`sanitizeSites` 全部反例 + **返回原数组** 不变量、`hostOf` 四处 re-export 的**函数身份相等**、快照命名与裁剪 | 70 条 |
| `tools/console/test-frontend.mjs` | 序 23/20：拼音**降级 → 就绪 → 缓存作废重算** 全链路、history 去重（含「连点 80 次不占满配额」的旧 bug 回归点）、有序灌入 | 28 条 |
| `tools/console/test-session.mjs` | 序 18/19：query/body 里的 key 一律 400、体量硬上限（含**合并后**超限）、字段级合并语义、限流 | 13 例 |
| `tools/console/test-sites-cas.mjs` | 序 20/22：读失败 ≠ 无数据、脏数据 503、`ifMatch` 真的被传、**并发冲突 409**、回滚门禁与 version 不回退 | 17 例 |
| `tools/console/test-bundle.mjs` | 序 23：**产物**断言（首屏无拼音引擎、动态而非静态引用、无 modulepreload、vendor 分包生效、首屏体积预算） | 15 条 |

全部并入 `npm run console:test:all`。`test-bundle.mjs` 依赖 `dist/`：缺产物时默认**跳过并显眼告警**，
`--strict` 下视为失败（发布/验收流程用）。

### 6.4 偏离清单的最终形态

| 项 | 状态 |
|---|---|
| 序 17 的「fetch 前预检」 | 偏离为「连接层校验」，理由见 §2.1（预检挡不住 rebinding） |
| 序 23 的「种子数据延迟加载」 | 不做，见 §2.4 |
| 序 26 的 `maxDuration` / `regions` | 不做，改为收内部预算；**且修掉了预算没有真正生效的 bug**（发现 4） |
| 序 28 虚拟滚动 | 不做，实测依据见 §4.1 |
