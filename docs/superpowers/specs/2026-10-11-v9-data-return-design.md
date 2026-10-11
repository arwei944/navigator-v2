# v9 设计方案：数据回归 —— 在自建服务上重建后端，补全智能闭环

状态：**已批准（待实施）** ｜ 日期：2026-10-11 ｜ 前置：v8 已实施（`2026-10-11-v8-smart-theme-notes-design.md`），
发布形态已从 Vercel 迁至自建 Node 服务（`server/main.mjs`）。

> **拍板结果（2026-10-11）**：① 数据层 = **SQLite（node:sqlite）**；② 管理后台 = **全套 10 组件复活**；
> ③ 卡片封面 = **做（og:image 服务端落盘）**；④ AI = **接 OpenAI 兼容接口**（key 在服务端环境变量）。
> 四项均按本文推荐值执行。

---

## 1. 背景与现状诊断

Vercel 团队因 fair-use 超限被封（代码侧无解），站点已迁移到 WorkBuddy 沙箱的自建 Node 服务。
迁移的直接代价是：**凡依赖 `@vercel/blob` 的能力全部蒸发**。实测 6 个接口文件全部中招：

| 能力 | 原实现 | 现状 |
|---|---|---|
| 站点表云同步（增删改多设备一致） | `api/sites.js` + Blob | **丢失**，前端只剩本机数据 |
| 会话同步（便签/实时备注跨设备） | `api/session.js` + Blob | **丢失**，liveSync 退化为同浏览器 BroadcastChannel |
| 点击统计（`sortBy:newest`/频次/热门） | `api/clicks.js` + Blob | **丢失**，sendBeacon 静默 404 |
| 健康巡检（卡片健康角标） | `api/health.js` + Blob | **丢失**，角标无数据来源 |
| 管理后台（10 个组件：站点/分类/快照/审计/通知/发布历史/偏好） | `api/ops.js` 等 + Blob | **死亡**，整页不可用 |
| 登录鉴权 | `api/auth.js` + Blob | **丢失** |
| 元信息抓取 | `api/metadata.js`（零 Blob 依赖） | ✅ 已在 Node 服务上复活（真实抓取） |

**关键判断**：丢的这些没有一个是真的需要 Vercel —— 它们需要的是「一个能持久化的存储 + 一个 HTTP 入口」，
而这两样自建服务都有。沙箱实测支持 SQLite（`node:sqlite`，Node 22.22 内置，仅实验性警告），**数据层可以零 npm 依赖**。

同时，v8 有两个明确搁置项（P5）：S3 数据自愈、S4 AI 可选。健康巡检复活后 S3 的地基才存在。

## 2. 目标与非目标

**目标**
1. 恢复全部丢失的数据能力：云同步、会话同步、点击、健康、管理后台、鉴权 —— 换存储引擎，不换行为。
2. 借存储重建，把 v8 搁置的 S3（数据自愈）做上；S4 AI 做成可选开关。
3. 数据安全兜底：沙箱文件系统的持久性没有 SLA，必须有「可导出的全量备份」。

**非目标**
- 不做多租户/多用户体系（保持单管理员 + 访客只读的既有形态）。
- 不做卡片截图缩略图（沙箱内无无头浏览器，不承诺做不到的事）。
- 不迁移回 Vercel（封禁无解）；Vercel 相关脚本保留但冻结。

## 3. 方案要点

### 3.1 存储适配层（核心：沿用「源码最小改动」经验）

六个接口对 Blob 的使用面收敛在 `get / put / list / del / BlobPreconditionFailedError` 五个符号上。
新增 `server/store.mjs` 提供**同名同签名**的实现（底层 SQLite），各接口只把
`from '@vercel/blob'` 换成 `from '../server/store.mjs'` —— **每个文件一行改动**，
校验/CAS/快照/限流等全部逻辑原样保留，既有测试（`test-sites-cas` 的 CAS 语义、`test-session` 的门禁）
继续保护这些逻辑，只需把 mock 目标指到适配层。

**表结构**（kv + 追加两类，克制）：
- `kv(pathname TEXT PRIMARY KEY, etag TEXT, body TEXT, updated_at)` —— 承载 sites.json、session/*、
  快照等「整读整写」对象，`ifMatch` 条件写语义与 Blob 对齐（CAS 防丢更新，这是踩过坑的不变量）。
- `clicks(site_id, at)`、`health(site_id, ok, latency, checked_at)`、`audit(...)`、`notifications(...)`
  —— 追加/聚合类，用 SQL 聚合代替过去「整包 JSON 读改写」。
- 数据迁移：现有 `api/sites-data.json`（300 条，即原 Blob 的最后已知快照）首启自动导入，version 延续。

### 3.2 接口与鉴权复活

`/api/sites`、`/api/session`、`/api/clicks`、`/api/ops`、`/api/auth` 原样恢复。
鉴权沿用「口令 hash + 会话 token」既有设计，口令与密钥走**服务端环境变量**（发布时注入），
前端不持任何密钥。`server/main.mjs` 的路由表从「只认 /api/metadata」扩为全量 ——
**其余 /api/* 回 404 JSON 的约定同步取消**，前端 `CLOUD_FATAL` 对这些码的语义自然回落为正常。

### 3.3 服务端定时任务（新增能力，Vercel 时代没有的）

自建常驻进程第一次可以跑**进程内定时器**：
- **健康巡检**：每 6h 对全部站点做一次 HEAD 探测（复用 `shared/http-fetch.mjs` + net-guard，
  并发受控、失败退避），结果落 `health` 表 —— 卡片角标重新有数据，且这是 S3 的输入。
- **自动快照**：站点表每次写入前后照旧落快照（沿用现有逻辑），另加每日一份全量 JSON 导出到
  `backups/`（保留最近 N 份）。
- **metadata 限流**：公网抓取代理补 IP 限流（沿用 `api/session.js` 里现成的滑动窗口模式）。

### 3.4 数据自愈 S3（v8 搁置项）

巡检结果 → 管理后台「体检清单」：不可达/超时/重定向异常的站点聚合展示，一键置归档或重测。
配合已有的 `archived` 范围轴，死链处理形成闭环。

### 3.5 卡片封面（视觉升级，可选拍板）

`shared/site-infer.mjs` 的 HTML 解析基建上加 `og:image / twitter:image` 提取，
**服务端下载封面图落盘 `covers/<siteId>`**（不热链：防盗链与 referer 泄漏都规避），
卡片在 `rich` 密度档按 `cardDisplay` 开关展示，加载失败降级 favicon。
沿用信息密度档纪律：**新增信息必须挂档，不无条件铺开**。

### 3.6 S4 AI（可选拍板）

OpenAI 兼容接口（`baseURL + key` 均为服务端环境变量），能力限定三件：
批量分类建议、名称/描述润色、巡检结果的异常摘要。key 不存在时入口整体隐藏（沿用 v8 的降级纪律）。
前端不新增依赖，直接 `fetch`。

### 3.7 数据安全（新增，沙箱特有风险）

发布沙箱的磁盘持久性没有 SLA。三层兜底：① 每次写入落 SQLite（WAL）；② 每日全量 JSON 快照；
③ 管理后台提供**一键下载全量备份**与**从备份恢复**。可选：定时推送备份到 GitHub 私库
（需 token，见拍板项）。

## 4. 分期

| 期 | 内容 | 可独立发布 |
|---|---|---|
| P0 | `server/store.mjs`（SQLite 适配层）+ 首启迁移 + `/api/sites` `/api/session` 复活 → **云同步回归** | ✅ |
| P1 | `/api/clicks` `/api/ops` `/api/auth` + 管理后台 10 组件复活 + metadata 限流 | ✅ |
| P2 | 定时任务框架 + 健康巡检 + `/api/health` + **S3 体检清单** | ✅ |
| P3 | og:image 封面（抓取落盘 + 卡片展示档位） | ✅ |
| P4 | S4 AI（可选开关，无 key 隐藏） | ✅ |
| P5 | 一键备份/恢复 + （可选）GitHub 备份推送 | ✅ |

每期交付即跑全量测试 + 线上真机探针，保持「每批可独立发布回滚」。

## 5. 风险与不变量

- **CAS 语义不能丢**：并发写防丢更新是被真实踩过的坑（Blob 时代 409 重试），适配层的 `ifMatch`
  必须与 Blob 行为逐一对齐，`test-sites-cas` 全量迁移过来。
- **写放大**：SQLite WAL + 事务，避免 Blob 时代「整包 JSON 读改写」的写放大；clicks/health 改为行级追加。
- **首屏预算**：管理后台是 `/admin` 独立路由（`isStandalone`），不得进入口静态图；封面组件挂 `rich` 档。
- **SSRF 面扩大**：巡检 + 封面抓取都出网，一律走 `fetchCapped` + net-guard 两层校验，并发与超时封顶。
- **node:sqlite 是实验特性**：封装在 `server/store.mjs` 单文件内，若沙箱 Node 升级导致行为变化，替换面最小。

## 6. 验收

- 真机探针扩展：登录 → 改站点 → 另一设备（第二浏览器 profile）看到同步 → 点击统计 → 健康角标有值。
- 压力面：300 站点全量巡检一轮的耗时与失败率；SQLite 文件体积；连续写入的内存占用。
- 既有 25 套件全绿 + 新增 store/巡检/备份套件。

## 7. 拍板记录

| 项 | 选项 | 结果 |
|---|---|---|
| 数据层 | SQLite（node:sqlite）/ JSON 文件+CAS | **SQLite** —— 零 npm 依赖，行级写入适合 clicks/health 高频追加，聚合走 SQL |
| 管理后台 | 全套 10 组件 / 精简三块 | **全套** —— S3 体检清单需要完整的管理面做展示 |
| 卡片封面 | og:image 服务端落盘 / 不做 | **做** —— rich 密度档 + cardDisplay 开关，失败降级 favicon |
| AI（S4） | OpenAI 兼容接口 / 暂不做 | **接** —— baseURL+key 全在服务端环境变量，无 key 入口隐藏 |

## 8. 实施注意（开工前重读）

- `server/store.mjs` 的 `ifMatch` 必须与 Blob 的 CAS 行为逐一对齐，`test-sites-cas` 的 mock 目标
  改指适配层后全量迁移用例 —— 防丢更新是踩过坑的不变量。
- 六接口**只改 import 一行**，校验/快照/限流逻辑不动；任何「顺手重构」都先过问。
- 首启迁移：`api/sites-data.json` → SQLite 一次导入，`version` 延续不归零（归零会让全部客户端
  拒绝应用云端数据，`applyIfNewer` 的单调递增判据会把它当成回滚）。
- 巡检与封面抓取一律 `fetchCapped` + net-guard，并发与超时封顶；`/api/metadata` 限流同批落地。
- 管理后台不得进入口静态图（`/admin` 是 `isStandalone` 独立路由）；封面组件挂 `rich` 档。
