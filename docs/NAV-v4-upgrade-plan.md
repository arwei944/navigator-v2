# Navigator V4 升级方案 — 智能 · 透明 · 可视化 · 自动化

> 基于外部技术调研 + 本仓库体检的下一版本规划。目标版本 **V4**。
> 调研日期：2026-09-24 · 调研对象：`src/`、`api/`、`scripts/`、`vercel.json`、`package.json`、git 仓库现状、Vercel/Blob/GitHub 官方能力

---

## 一、外部技术调研结论（选型依据）

| 议题 | 候选 | 结论 | 依据 |
|------|------|------|------|
| Git 编程库 | `simple-git` 3.36.0 / `isomorphic-git` 1.41.9 / `nodegit` / 原生 `child_process` | **`simple-git`（结构化 status/diff）+ 原生 `spawn`（push/发布流式输出）** | simple-git 轻量且 ESM 友好；但其 push 无进度回调，流式场景用 `spawn` |
| 现成 Git GUI | lazygit / gitui / GitHub Desktop / Fork / GitKraken | **自建** | 现成工具均无法与 `publish.mjs` 发布链路打通，只能"提交"，不能"发布 + 验证" |
| 实时通道 | SSE / WebSocket | **SSE** | 本场景是服务端→浏览器单向推送；SSE 原生断线重连、实现更简 |
| 部署状态源 | Vercel REST API | **短轮询 `GET /v13/deployments/{id}?withGitRepoInfo=true`** | 本地无公网地址，Webhook 不可行；轮询 3~5s 即可达数秒级延迟 |
| 构建日志 | `GET /v2/deployments/{id}/events` | 事件列表轮询 | 官方无 SSE 流式日志端点 |
| 版本/CHANGELOG | semantic-release / Changesets / release-please | **release-please** | 全 CI 驱动、PR-based、对单人 GitHub 仓库摩擦最小 |
| 数据门禁 | zod v4 / ajv / valibot | **zod v4**（gzip ≈1.8KB） | TS 优先、报错可读；可扩展现有 `validate-data.mjs` |
| 健康看板 | Uptime Kuma / Upptime / 自建 JSON+图表 | **自建轻量**（复用 `check-sites.mjs` 落盘 JSON） | 300 站规模不值得引入自建服务 |

**关键发现（直接影响本项目）**：Vercel Blob 有两层缓存——浏览器约 1 年、Edge 约 5 分钟。**私有存储支持一致性读**：`get()` 传 `useCache: false`，或 HTTP 访问加 `?cache=0`，可绕过 CDN 直读最新写入。

> 本项目 `api/sites.js` 使用 `get(PATHNAME, { access: 'private' })`，**未传 `useCache: false`**。这正是历次发布"轮询 1~4 次才收敛到新版本"的根因，也是本方案最高性价比的修复点（见 M6）。

---

## 二、现状体检

### 2.1 工程现状

| 维度 | 现状 | 问题 |
|------|------|------|
| Git | 仓库 `arwei944/navigator-v2`，仅 **4 个 commit**，**42 处改动未提交** | 整个 V3 的 P0/P1/P2 成果游离在工作区，无版本锚点，回滚困难 |
| CI/CD | **无 `.github/`**，无任何自动化检查 | 数据校验仅靠本地 `publish.mjs` 门禁，PR/推送无防护 |
| 发布 | `scripts/publish.mjs` 五步（备份→校验→构建→部署→热更新→轮询） | 全流程在终端黑盒执行，过程不可见、失败定位靠翻日志 |
| 一致性 | `publish.mjs` 轮询 `/api/sites` 最多 5 次×2s | 因 Blob 缓存，常需 2~4 次才收敛，发布"何时算成功"不确定 |
| 版本号 | `package.json` 固定 `3.0.0`，站点数据用 Blob `version` 自增 | 代码版本与数据版本两套体系，无 CHANGELOG |
| 组件规模 | 7 个组件仍 >250 行（`ContentFeed` 433 / `TodoPanel` 415 / `Sidebar` 355 / `CardsContainer` 329 / `WeatherWidget` 315 / `SiteCard` 310 / `SiteSearchBar` 301） | P2-1 只处理了原四大巨型组件，其余仍超验收线 |

### 2.2 核心痛点

1. **不透明**：发布过程是黑盒，没有"当前进行到哪一步、每步耗时、失败在哪"的视图
2. **不可视化**：改动只能靠 `git status` 文本；站点数据变更（新增/删除/改字段）无 diff 摘要
3. **不自动化**：提交靠手写消息；无 CI 门禁；CHANGELOG 靠手写 HANDOVER
4. **不确定**：发布后云端是否真收敛，需人工盯轮询日志
5. **无智能**：无变更影响面提示（改了数据会不会影响图标/分类/排序）

---

## 三、V4 目标：四个维度的可验收定义

| 维度 | 目标定义 | 验收标准 |
|------|---------|---------|
| **智能** | 规则式变更理解：自动给出"改了什么、影响什么" | 提交前可见站点数据 diff 摘要（新增 N / 删除 M / 字段变更 K），并自动生成规范 commit 消息模板 |
| **透明** | 全链路每一步可见、可追溯、可重试 | 发布过程有端到端时间线（提交→推送→部署→热更新→验证），每步含状态、耗时、原始日志 |
| **可视化** | 图形化替代终端文本 | 改动以文件树 + 徽标 + diff 高亮呈现；发布以进度时间线呈现；云端版本以对比卡片呈现 |
| **自动化** | 减少手工步骤，关键节点有门禁 | 一键"提交并发布"；CI 自动跑数据校验 + 构建门禁；版本与 CHANGELOG 自动产出 |

---

## 四、核心交付：本地运维控制台（nav-console）

### 4.1 定位与形态

- **形态**：本地 Web 控制台（决策已确认）。`node tools/console/server.mjs` 起本地服务，浏览器访问 `http://localhost:5175`
- **边界**：**仅本地运行，绝不部署**。加入 `.vercelignore`，依赖放 `devDependencies`
- **原则**：复用现有 `scripts/*` 与 `publish.mjs`，不重写发布逻辑（单一真相源）

### 4.2 架构

```
┌──────────────────── 浏览器 http://localhost:5175 ────────────────────┐
│  改动面板 │ 提交面板 │ 同步面板 │ 历史面板 │ 数据面板                  │
│    ▲  fetch(JSON)          ▲  EventSource(SSE 实时日志)              │
└────┼───────────────────────┼─────────────────────────────────────────┘
     │                       │
┌────┴───────────────────────┴─────────────────────────────────────────┐
│  nav-console（node:http 原生服务，零框架依赖）                          │
│  ├─ lib/git.mjs        simple-git：status / diff / stage / commit      │
│  ├─ lib/jobs.mjs       长任务注册表 + SSE 广播（spawn → stdout → SSE）  │
│  ├─ lib/vercel.mjs     Vercel Deployments API（curl.exe，绕本机代理）   │
│  ├─ lib/changes.mjs    规则式站点数据 diff 摘要                         │
│  └─ lib/env.mjs        读取 .env.local（复用 publish.mjs 逻辑）          │
└────┬──────────────────────────────────────────────────────────────────┘
     │ spawn
     ├─▶ git push                    ──▶ GitHub
     ├─▶ node scripts/publish.mjs    ──▶ Vercel 部署 + Blob 热更新
     └─▶ node scripts/validate-data.mjs
```

### 4.3 目录结构

```
nav-v2/
├── tools/console/
│   ├── server.mjs           # HTTP 服务 + 路由 + SSE 端点
│   ├── lib/
│   │   ├── env.mjs          # .env.local 解析
│   │   ├── git.mjs          # simple-git 封装
│   │   ├── jobs.mjs         # 长任务 + 日志环形缓冲 + SSE 广播
│   │   ├── vercel.mjs       # Vercel Deployments API 客户端
│   │   └── changes.mjs      # 站点数据 diff 摘要 + commit 消息模板
│   └── ui/
│       ├── index.html       # 单页控制台（无构建步骤）
│       ├── app.js           # 原生 JS，fetch + EventSource
│       └── style.css        # 复用项目 CSS 变量风格
└── .github/workflows/ci.yml # CI 门禁（M5）
```

### 4.4 六大面板

| 面板 | 内容 | 对应维度 |
|------|------|---------|
| **改动** | 文件树（按目录分组）+ 状态徽标（M/A/D/?）+ 增删行数；点击看 diff 高亮 | 可视化 |
| **提交** | 勾选要提交的文件、commit 消息输入框（带**自动模板**）、`提交` / `提交并推送` / `提交并发布` | 智能 + 自动化 |
| **同步** | 端到端时间线：`本地改动 → 提交 → 推送 → Vercel 部署（含状态机）→ Blob 热更新 → 一致性验证`；每步状态 + 耗时 + 可展开原始日志 | 透明 |
| **历史** | 最近 N 条提交 + 每条关联的部署状态与 commit SHA（`withGitRepoInfo`） | 透明 |
| **数据** | 站点数据 diff 摘要、分类分布、图标缺失、`sortOrder` 重复/空洞检查 | 智能 |
| **站点**（M7） | 站点增删改 + 元信息抓取 + 图标抓取 + 一键同步云端（提交→推送→备份→门禁→热更新→收敛） | 自动化 |

### 4.5 接口设计

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 控制台 UI |
| GET | `/api/git/status` | 改动列表（路径、状态、增删行数） |
| GET | `/api/git/diff?path=` | 单文件 diff |
| POST | `/api/git/stage` | 暂存 / 取消暂存 `{paths, stage}` |
| POST | `/api/git/commit` | 提交 `{message, paths}` |
| POST | `/api/git/push` | 推送（流式日志） |
| GET | `/api/changes/summary` | 站点数据 diff 摘要 + 建议 commit 消息 |
| GET | `/api/sync/status` | 本地版本 / 云端版本 / 最近部署状态 |
| POST | `/api/sync/publish` | 触发全链路发布（流式日志） |
| GET | `/api/history` | 最近提交 + 部署状态 |
| GET | `/api/sites/list?q=&category=` | 站点列表（含分类标签/配色、未登记分类与缺图标标记） |
| GET | `/api/sites/meta?url=` | 抓取标题/描述/图标地址 + 分类建议 |
| POST | `/api/sites/add` \| `update` \| `remove` | 站点增 / 改 / 删（写本地 `api/sites-data.json`） |
| POST | `/api/sites/icon` | 抓取并落盘站点图标（流式日志） |
| POST | `/api/sites/sync` | 一键同步站点数据到云端（时间线：差异检查→提交→推送→备份→门禁→热更新→收敛） |
| GET | `/api/events?job=<id>` | **SSE** 实时日志流 |

### 4.6 实时日志实现要点

```js
// 服务端：SSE 头 + 心跳 + spawn 管道
res.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no'
})
const proc = spawn('node', ['scripts/publish.mjs'], { cwd: root })
proc.stdout.on('data', c => res.write(`event: log\ndata: ${JSON.stringify(String(c))}\n\n`))
proc.on('close', code => { res.write(`event: done\ndata: ${JSON.stringify({ code })}\n\n`); res.end() })
req.on('close', () => proc.kill())   // 客户端断开则终止子进程
setInterval(() => res.write(': ping\n\n'), 15000).unref()   // 心跳防代理断连
```

前端用 `new EventSource('/api/events?job=xxx')`，天然断线重连。

---

## 五、CI/CD 自动化

### 5.1 GitHub Actions 门禁（M5）

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: npm run validate   # 数据 schema 门禁
      - run: npm run build      # 构建门禁
```

**设计取舍**：Vercel 官方观点是 Git 集成已覆盖预览部署与回滚，Actions 更适合做测试/校验/性能预算，而非重复构建。因此 **CI 只做门禁，不重复部署**。

### 5.2 部署机制：保持本地 `publish.mjs` 为唯一发布入口

| 方案 | 说明 | 取舍 |
|------|------|------|
| **A（本版采用）** | 保持本地 `publish.mjs` 发布，CI 仅门禁 | 不改动已验证的可靠链路，风险最低；控制台负责触发与可视化 |
| B（后续可选） | 开启 Vercel Git 集成，push 即自动部署，控制台改为"监听部署状态" | 自动化更彻底，但发布入口变为两处（代码走 Git、数据走 Blob），需谨慎避免双重部署 |

> 本版采用 A；B 留作 V5 演进，届时需先验证"代码自动部署 + 数据热更新"不会相互覆盖。

### 5.3 版本与 CHANGELOG（M5）

- 采用 **Conventional Commits** 规范（`feat:` / `fix:` / `docs:` / `chore:`）
- 接入 **release-please**（GitHub Action）：从提交自动推断语义化版本、生成 `CHANGELOG.md`、开 release PR
- 控制台的"提交"面板按规范生成消息模板，从源头保证规范落地

---

## 六、透明与智能增强

### 6.1 Blob 一致性读修复（M6，最高性价比）

`api/sites.js` 的 `readStored()` 改为：

```js
const blob = await get(PATHNAME, { access: 'private', useCache: false })
```

**预期收益**：发布后首次轮询即读到最新版本，`publish.mjs` 的"轮询 1~4 次收敛"退化为 1 次，发布结果从"不确定"变为"确定"。

### 6.2 规则式变更摘要（M4）

对 `api/sites-data.json` 与 `git HEAD` 版本做结构化对比，输出：

```
站点数据变更摘要
  新增 3：ac16 VergeX / dt32 Arcturus / ex11 QFEX
  删除 0
  修改 2：fd1 描述变更；l6 图标补全
  完整性：图标缺失 0；sortOrder 重复 0；分类数 29
建议提交消息：
  feat(sites): 新增 VergeX/Arcturus/QFEX 三个站点，更新 RootData 描述
```

### 6.3 数据门禁升级为 zod schema（M6，可选）

现有 `validate-data.mjs` 为手写校验。可升级为 zod v4 schema，获得更可读的报错与类型推断；保留现有 CLI 形态，不改调用方。

### 6.4 站点管理闭环（M7）

原先前端「添加站点」后，新站点只落在浏览器 `localStorage`，必须切回前端页面才能入库，且云端生效依赖人工跑发布脚本。M7 把这条链路收进控制台：

```
控制台「站点」面板
  新增/编辑/删除  →  写 api/sites-data.json（原子写：tmp + rename）
  抓取元信息      →  curl.exe 抓标题/描述/图标 + 分类建议（多编码回退 utf-8→gb18030→big5）
  抓取图标        →  页面声明 → /favicon.ico → favicon.im 兜底，落盘 public/icons/<id>.<ext>
  一键同步云端    →  差异检查 → 提交（仅数据文件与图标）→ 推送 → 备份 → schema 门禁 → Blob 热更新 → 轮询收敛
```

沿用既有约定，避免产生第二套口径：

- **id 前缀**沿用该分类既有站点的字母前缀，序号全局递增（`pj3` → `pj4`）
- **`sortOrder`** 取全局最大值 +1，维持跨分类递增序列
- **`url` 只存域名**，去协议/查询串/尾斜杠（与 `AddSiteModal` 一致）
- **写盘 2 空格缩进 + 末尾换行**，避免无关 diff
- **热更新复用 `/api/sites` 与 `Authorization: Bearer <key>`**，与 `publish.mjs` 同一入口与鉴权方式
- **网络请求一律走 `curl.exe`**（本机 Node fetch 不走系统代理）

三个实测踩到的坑（已修）：

1. **`data:` 图标陷阱**：部分站点用 `<link rel="icon" href="data:,">` 抑制 favicon 请求（如 `example.com`），原实现会把这个无意义值当成图标地址返回，前端预览破图。现统一按「未声明」处理，继续回退到 `/favicon.ico`。
2. **`favicon.im` 占位图陷阱**：该服务对查不到图标的域名返回 **200 + 灰色圆底斜体 `f` 的 SVG**，格式合法、体积仅 257B，会被当成真图标落盘。全站排查发现 **14 个站点**中招（含域名迁移时"重新抓取"的 `md5`）。现于 `tools/console/lib/sites.mjs` 与 `scripts/fetch-favicons.mjs` 双侧加入占位图识别并拒收，宁缺勿错（无图标时前端回落为分类色首字母块）。
3. **内联 SVG 被引号截断**：站点把图标写成 `href="data:image/svg+xml,%3Csvg xmlns='…'"`——值由双引号包裹、内部含单引号，而属性取值正则用 `[^"']+`，会从第一个单引号处截断，解出 `"<svg xmlns="` 这个 **11 字节的坏文件**（`ac15.svg` 即由此产生）。现三处（`sites.mjs` / `scripts/fetch-favicons.mjs` / `api/metadata.js`）统一改用**按定界引号配对**的 `attrValue()`，并将 `data:image/…` 视为真实内联图标、由 `decodeDataUri()` 本地解码落盘。

图标清理收口结果：14 个占位图标已删、5 个重抓为真实图标、1 个坏文件修复、2 个孤儿文件清理；余 **9 个站点确认拿不到真实图标**（页面无声明 + `/favicon.ico` 404/SPA 兜底 + Google s2/gstatic 均为默认地球占位图），已清空 `icon` 字段由前端回落为分类色首字母块。

---

## 七、里程碑与验收标准

| 里程碑 | 交付物 | 验收标准 | 预估 |
|--------|--------|---------|------|
| **M0 基线** | 42 处改动整理为规范提交 | `git status` 干净；提交信息符合 Conventional Commits；有可回滚的版本锚点 | 0.5h |
| **M1 骨架** | `tools/console/server.mjs` + SSE + UI 壳 + `npm run console` | 浏览器打开 `localhost:5175` 见控制台骨架；SSE 能收到心跳与测试任务日志 | 2h |
| **M2 Git 面板** | 改动列表 / diff / 暂存 / 提交 / 推送 | 可在 UI 完成"查看改动→暂存→填写消息→提交→推送"，推送日志实时可见 | 3h |
| **M3 同步面板** | 全链路时间线与实时日志 | 一键发布后，UI 依次显示 提交→推送→部署状态机→热更新→验证 各步状态与耗时 | 3h |
| **M4 摘要 + 历史** | 规则式变更摘要 + 历史/部署关联 | 提交前可见数据 diff 摘要与建议消息；历史面板显示提交与其部署状态 | 2h |
| **M5 CI/CD** | `.github/workflows/ci.yml` + release-please | push/PR 自动跑校验+构建；合并后自动产出版本与 CHANGELOG | 2h |
| **M6 透明增强** | `useCache:false` 修复 + 文档 | 发布后**首次**轮询即收敛；README/HANDOVER 更新 | 1h |
| **M7 站点管理** | 控制台内增删改站点 + 图标抓取 + 一键同步云端 | 控制台内可"新增站点→本地落盘→云端热更新→收敛"闭环，无需回前端页面 | 3h |

**执行顺序**：严格串行 M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7，每个里程碑完成后验证通过再进入下一个。

---

## 八、风险与回滚

| 风险 | 影响 | 应对 |
|------|------|------|
| 控制台端口被占用 | 无法启动 | 端口可配置（`--port`），默认 5175，冲突时自动 +1 重试 |
| `simple-git` 新增依赖 | 依赖体积增加 | 仅 `devDependencies`，不进入生产构建产物 |
| 子进程失控（发布卡死） | 占用资源 | SSE 断开即 `proc.kill()`；任务设超时上限 |
| Vercel API Token 泄露 | 部署权限外泄 | Token 仅存 `.env.local`（已 gitignore）；控制台仅监听 `127.0.0.1` |
| CI 门禁过严阻塞提交 | 影响迭代节奏 | 门禁只做"数据校验 + 构建"，不引入 lint/测试强约束 |
| Blob `useCache:false` 增加回源 | 读延迟略升 | 仅用于发布验证与热更新读取；前端 30s 轮询收益远大于成本 |

**全局回滚**：M0 建立 git 基线后，任何里程碑失败均可 `git revert` / `git reset --hard <基线>` 回到干净状态；数据层改动（`sites-data.json`）另有 `backups/` 时间戳备份双保险。

---

## 附：调研中确认的关键事实

- Vercel 项目：`projectId=prj_zedmlgXIk6kbKBnhgybiT9EGiHnt`、`orgId=team_todYhoZLhs8IJr1Qo6fF7A2L`、`projectName=navigator-v2`
- Vercel 部署状态机：`QUEUED → BUILDING / INITIALIZING → READY / ERROR / CANCELED`
- Vercel 关键端点：`GET /v6/deployments`、`GET /v13/deployments/{id}?withGitRepoInfo=true`、`GET /v2/deployments/{id}/events`
- GitHub 关键端点：`GET /repos/{owner}/{repo}/commits`、`.../commits/{sha}/statuses`、`.../check-runs`
- 本机约束：Node `fetch` 不走系统代理，HTTP 调用一律用 `curl.exe`（沿用现有约定）
- `api/sites.js`：Blob 为**私有**存储，`get()` 未传 `useCache: false`（即 M6 修复点）
- 组件超 250 行者：`ContentFeed` 433 / `TodoPanel` 415 / `Sidebar` 355 / `CardsContainer` 329 / `WeatherWidget` 315 / `SiteCard` 310 / `SiteSearchBar` 301