# Navigator V2 → V3 升级方案

> 基于完整代码调研的下一大版本规划。目标版本 **V3**。
> 调研日期：2026-09-21 · 调研对象：全部 `src/`、`api/`、`scripts/`、`vercel.json`、`vite.config.js`、`README.md`、`HANDOVER.md`

---

## 一、现状体检（调研结论）

### 1.1 架构现状

| 维度 | 现状 | 备注 |
|------|------|------|
| 前端 | Vue 3.4 + Vite 5 + Pinia + Vue Router | 单体 SPA，组件全在 `src/` |
| 数据 | `api/sites-data.json`（293 站点）+ Vercel Blob 热更新 | Blob 是官方数据源，SEED 兜底 |
| Cloud | `api/sites.js`（GET/POST + Blob）、`api/metadata.js`（元信息代理） | 站点热更新走 30s 轮询 |
| 同步 | **遗留 KV 同步 `api/sync/*` 已失效** | 见风险 1 |
| 图标 | 293 个真实 favicon（`public/icons/`） | 全量补全完成 |
| 部署 | Vercel + vercel.json 路由 | PWA 已启用 |
| 自动化 | `publish.mjs` / `check-sites.mjs` / `fetch-favicons.mjs` | 演进良好 |

### 1.2 关键风险与断点

**风险 1（高）— 失效的 KV 同步残留**：`src/services/sync.js` 和 `api/sync/{key,merge,upload,download}.js` 依赖 `@vercel/kv`，但该项目已因鉴权问题弃用 KV、改走 Blob（记录于项目记忆）。然而 `BookmarkImport.vue` 的"同步"Tab 仍直接调用 `syncService.generateKey()/mergeSnapshot()`，指向一个**不回源、无环境变量的 /api/sync 端点** → 用户点击"生成同步密钥"必然失败。这是遗留死代码，且入口仍暴露给用户。

**风险 2（中）— 运行时基础设施混淆**：README 声称"基于 Vercel KV 多设备同步"，与真实 Blob 架构不符；`api/sites-data.json` 同时被当作构建种子（`sites.js` store 直接 import）和 Vercel Serverless 读取（`api/sites.js` 读文件），角色不清。

**风险 3（中）— 单文件巨型组件**：`SiteCard.vue(301)`、`RightSidebar.vue(556)`、`CommandPalette.vue(518)`、`SettingsPanel.vue(528)`、`BookmarkImport.vue(855)` 等单文件超 300 行，耦合度高、测试性差。

**风险 4（低-中）— 关键字符串硬编码**：`publish.mjs` 中管理密钥 `5da8071e3bcf4629` 回退写死（虽然环境变量优先）；仓库存在 `.env.local`（未跟踪）。

**风险 5（低）— git 分支疏于管理**：大量未提交改动（含 `api/sites-data.json`、`public/icons/`、`scripts/`）均处于 `??/M` 未提交状态，仅有 2 个历史 commit。

### 1.3 已具备的能力（可在 V3 继承/强化）

- 真实 favicon 全量（293/293）
- 云端热更新 + 30s 轮询（含 `Cache-Control: no-store`）
- 站点增删改/回收站/批量/拖拽/收藏/访问历史/书签导入导出
- 4 组主题 + 明暗模式 + 自定义壁纸
- 命令面板 Ctrl+K、数字时钟、待办、天气、多语言搜索
- 管理后台 + 一键发布脚本

---

## 二、升级目标（V3 定位）

在保留 V2 全部能力的前提下，解决三大主线：

1. **架构清理**：消灭失效 KV 同步，统一一份数据真相源
2. **能力跃升**：从"静态导航"走向"智能导航"（实时在线状态、智能推荐、数据分析）
3. **体验与工程**：组件拆分、性能优化、真正的多设备会话级同步

---

## 三、升级方案（分 P0/P1/P2 三个批次）

### P0 — 架构止血（必须，交付基础）

| # | 事项 | 说明 | 验收标准 |
|---|------|------|---------|
| P0-1 | **移除失效 KV 同步** | 删除 `api/sync/`、`sync.js` 中失效调用，关闭 BookmarkImport 的同步 Tab，改由 V3 会话同步替代 | `npm run build` 无 kv 相关依赖；BookmarkImport 无死链同步入口 |
| P0-2 | **统一数据真相源** | 明确 Blob 为唯一运行时数据源；`sites-data.json` 仅作 SEED/备份；`api/sites.js` 读取 + `scripts/*` 写入都基于同一 PATHNAME | 单一写入入口（publish），无两处逻辑 |
| P0-3 | **修复/校验元信息代理** | 强化 `api/metadata.js`（js 渲染站点、Apple touch icon、多编码），作为 V3 智能抓取的基础 | 对 293 站 favicon 抓取成功率 ≥ 98% |
| P0-4 | **全量数据校验 + 持续完整性** | 加 schema 校验脚本（id 前缀唯一、sortOrder 连续、createdAt 存在、icon 存在）到 `publish.mjs` 门禁 | 发布前若数据不合法则拒绝发布 |
| P0-5 | **密钥与配置安全** | 移除 `publish.mjs` 硬编码回退 key；密钥仅从环境变量读取；`.env.local` 加入忽略确认 | 无任何密钥硬编码；README 说明环境变量设置 |
| P0-6 | **基建统一提交 + 文档校正** | 整理 git：提交当前改动基线；删除失效 README KV 描述，更新为 Blob 架构 | git 状态干净；README/HANDOVER 与新架构一致 |

### P1 — 智能导航能力（核心增值）

| # | 事项 | 说明 | 验收标准 |
|---|------|------|---------|
| P1-1 | **站点实时在线状态（健康指示器）** | 前端批量探活：按需对**当前可见**站点发 HEAD/GET 探活（复用 check-sites 判定，客户端轻量版），在卡片角标显示在线/离线/限流 | 载荷受限（仅探测可见卡片，二级缓存 60s），离线站点角标可见 |
| P1-2 | **智能推荐发现** | 基于访问历史 + 分类共现，在"内容聚合 Feed"新增"为你推荐"区块，替代纯随机"推荐发现" | 推荐结果含至少一个同类/相关站点，可解释 |
| P1-3 | **云端会话级同步（替代 KV）** | 用 Blob 实现"用户会话同步"：将**收藏、待办、历史、偏好**以会话 key 存入 Blob（非站点数据），实现多设备一致 | 两台设备同 prefer key 可同步收藏/待办；与站点热更新互不冲突 |
| P1-4 | **实时热更新即时可见** | 除 30s 轮询外，增加首次加载 + 后台的即时 fetch，减少新站上线的可见延迟 | 新站发布后 ≤5s 在已开标签页出现 |
| P1-5 | **批量数据洞察** | 管理后台新增"数据"Tab：分类数量分布、访问热度 TOP、失效站点清单（对接 check-sites 报告格式） | 后台可见 5 类统计图表/清单 |

### P2 — 体验与工程工程化

| # | 事项 | 说明 | 验收标准 |
|---|------|------|---------|
| P2-1 | **巨型组件拆分** | 拆分 `RightSidebar`/`CommandPalette`/`SettingsPanel`/`BookmarkImport` 为业务子组件 | 单文件 ≤ 250 行（组件主体） |
| P2-2 | **虚拟滚动 + 卡片虚拟化** | 293→正在增长，网格/列表启用 `vue-virtual-scroller`（已依赖）或 CSS `content-visibility` | 1000 站点仍 60fps 滚动 |
| P2-3 | **敏感信息与鉴权强化** | `/api/sites` POST 改 header Token；支持 `minimist` 化 CLI 参数；管理后台 webhook 通知可选 | POST 不再依赖 body.key 明文 |
| P2-4 | **本地数据版本与迁移** | 为 localStorage 引 stores 引入 schema 版本号 + 迁移函数，防未来结构变更 | 结构变更可平滑迁移，无数据丢失 |
| P2-5 | **README/HANDOVER 知识库化** | 一键命令、架构图、环境变量表集中文档化；加桌面端自适应打磨 | 全新开发者按 README 10 分钟内跑通 |

---

## 四、架构演进建议（V3 目标形态）

```
浏览器(PWA 离线)                          Vercel Serverless
┌─────────────────┐          ┌──────────────────────────────┐
│ Vue3 SPA        │  30s 轮询│ /api/sites        (Blob 数据) │
│ · 卡片/网格虚拟化│ ────────▶│ /api/metadata     (抓取代理)  │
│ · 在线状态角标   │          │ /api/session       (合集同步) │
│ · 智能Feed      │          │ (弃用) /api/sync/* (KV 死代码) │
└────────┬────────┘          └──────────────┬───────────────┘
         ▲                                   ▲
         └── 本地 stores（版本化持久化）       └─ scripts(publish/check/icons) 写入
```

**关键决策**：
- **数据源唯一性**：站点数据 = Blob；个人会话数据（收藏/待办等）= 新增 `/api/session` Blob 域。两者隔离。
- **在线状态探活**：复用 `check-sites.mjs` 的分级判定思路，客户端做轻量版并缓存，避免打爆反爬站。

---

## 五、工作量与优先级建议

| 批次 | 定位 | 预估工作量 | 建议 |
|------|------|-----------|------|
| P0 | 架构止血 | 0.5~1 天 | **本版本必须**，先做 |
| P1 | 核心增值 | 2~3 天 | **本版本重点**，建议做 P1-1/P1-3/P1-5 |
| P2 | 体验工程 | 1~2 天 | 视迭代节奏选择性排期 |

**推荐落地顺序**：P0 全量 → P1-1 在线状态 → P1-3 会话同步 → P1-5 数据洞察 → P1-2/4 → P2 中按需裁剪。

> 注：P1-1 需在浏览器中做轻量探活设计，避免对 293 站全量并发请求触发 WAF；建议仅探测当前可见卡片 + LRU 缓存。

---

## 附：调研中确认的关键事实

- `api/sites-data.json`：293 站点，全部带 `createdAt` + `icon`（293/293）
- `api/sites.js`：GET 带 `Cache-Control: no-store`；POST 用 `SITES_ADMIN_KEY` 环境变量校验 + body.key 双校验
- `scripts/publish.mjs`：5 步（备份→构建→部署→热更新→轮询），含 key 硬编码回退
- `api/sync/*`：全部 `import { kv } from '@vercel/kv'`，无环境变量回退 → 部署后必失败
- `vite.config.js`：PWA(workbox) 已配；`globPatterns` 含 html，SW 会缓存入口
- 组件规模 TOP5：`BookmarkImport(855)` / `RightSidebar(556)` / `SettingsPanel(528)` / `CommandPalette(518)` / `TodoPanel(472)`