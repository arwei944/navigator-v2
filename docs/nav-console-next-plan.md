# nav-console 下一版升级方向调研（M8+）

> 调研日期：2026-09-25 · 调研对象：`tools/console/`（服务端 `lib/*.mjs` + 前端 `ui/*.js`）、`scripts/publish.mjs`、`scripts/check-sites.mjs`，以及 Vercel / GitHub / Jupyter / lazygit / Dozzle 等外部资料
> 前置：控制台已完成 M1–M7（改动 / 提交 / 同步 / 历史 / 数据 / 站点六大面板 + SSE 实时日志），本文件只讨论**下一版往哪走**。

---

## 一、外部调研结论（选型依据）

| 议题 | 结论 | 依据 |
|------|------|------|
| 实时通道 | **继续用 SSE**，不上 WebSocket | 本场景是「服务端高频推、浏览器低频发」；SSE + HTTP 足够，且原生断线重连。只有需要双向低延迟交互（如浏览器内跑交互式终端）才值得换 WS [5] |
| 日志体验 | 对标 **Dozzle**：实时日志 + 过滤 / 搜索 / 多任务视图 | Dozzle 是「不用终端也能看日志」的轻量方案，其过滤与多容器视图正是本控制台日志区缺的 [2] |
| 改动操作 | 对标 **lazygit**：hunk 级暂存（单行 / 范围 / 整个 hunk）、交互式 rebase | 本控制台 diff 目前**只读**；lazygit 证明「在 GUI 里做 hunk 级 stage/unstage」是高频刚需 [1] |
| 发布控制 | 借鉴 **Vercel CLI**：`logs --follow` / `alias` / `promote` / `rollback` / `env` / `cache purge` | 部署日志、别名、回滚、环境变量、CDN 缓存清理均有官方 CLI/API 能力，可封装进面板 [3] |
| 发布门禁 | 借鉴 **GitHub Actions environment approval**：发布前人工确认 | 现流程是一键直达生产，缺「展示将发生什么 → 人工放行」的环节 [9] |
| 变更摘要 | 借鉴 **Changesets / release-please** 的「先收集变更事实 → 再生成摘要」pipeline | 现有规则式摘要只覆盖站点数据，未覆盖代码改动的影响面 [9] |
| 状态看板 | 对标 **Uptime Kuma / Homepage / Dashy** | 站点面板偏「管理」，缺「对外可用性」的实时观察 [4] |
| 本地控制台安全 | **必须校验 `Host` 头**；Origin 白名单 + token 是配套措施 | Host 头校验被列为 DNS rebinding 的主要服务端控制手段；Jupyter 默认拒绝 Host 不指向本地的请求，并默认启用 token 认证 [6][7][8] |

**关键发现（直接影响本项目）**：本控制台当前写操作已做 `Origin` + `X-Nav-Console` 双重校验，但 **GET 读接口完全没有校验，`Host` 头也从未校验**。仅监听 `127.0.0.1` 并不足以防 DNS rebinding——攻击者页面可通过 rebinding 让自身域名解析到 `127.0.0.1`，从而以「同源」身份读取 `/api/sites/list`、`/api/env`、`/api/git/status` 等接口。这是本方案**性价比最高**的修复点（见 M8）。

---

## 二、现状体检

### 2.1 能力现状

| 维度 | 现状 | 缺口 |
|------|------|------|
| 安全 | 写操作：`Origin` 主机名白名单 + `X-Nav-Console: 1`；静态服务已防目录穿越 | 读接口零校验；无 `Host` 校验；无 token |
| 实时日志 | SSE + 心跳 + 环形缓冲 + 事件回放；Windows 子进程树终止 | 无过滤 / 搜索；同时只呈现一个任务，多任务需切换；日志不持久化 |
| 改动 | 文件树 + 徽标 + 逐行 diff 高亮 + 全部/单文件暂存 | 无 hunk 级暂存 / 取消暂存；无行级丢弃 |
| 提交 | 规则式站点数据摘要 + Conventional Commits 模板 | 摘要不含「影响面」（如改字段是否影响图标 / 分类 / 排序） |
| 同步 | 9 步全链路时间线 + Vercel 部署状态机 + 一致性轮询（数量 + 版本号） | 无发布前确认门禁；无回滚入口；无 CDN 缓存清理 |
| 历史 | 提交与生产部署关联 + 部署基线 | 无按时间 / 任务 / 环境的检索 |
| 数据 | 分类分布 / 完整性 / sortOrder 空洞 / 重复域名 | 无「改动的数据影响面」推演 |
| 站点 | CRUD + 元信息抓取 + 图标三源兜底 + Blob 热更新 | 无可用性看板（状态码 / 响应时间 / 图标可达性） |
| 主题 | 深色 / 浅色 / 跟随系统（2026-09-25 新增） | — |
| 环境 | 只有生产一条链路 | 无 staging / promote 流程 |

### 2.2 核心痛点

1. **不安全**：读接口可被 DNS rebinding 读取（本机项目路径、环境变量摘要、站点库全部暴露）
2. **日志难用**：长任务输出几百行时，只能靠肉眼翻；多任务无法并排对照
3. **发布不可逆**：一键直达生产，出错只能手工 `git revert` + 重新发布
4. **改动不可细**：想只暂存某个 hunk，得回终端用 `git add -p`
5. **看不见对外状态**：站点「管理」很全，但「线上到底通不通」要另跑 `npm run check`

---

## 三、下一版目标（可验收定义）

| 维度 | 目标定义 | 验收标准 |
|------|---------|---------|
| **安全** | 控制台的所有入口都有来源校验 | 读 / 写接口一律要求可信 `Host` + 可信 `Origin`；DNS rebinding 场景下（伪造 Host / 跨站 Origin）返回 403；有自动化用例覆盖 |
| **智能** | 从「改了什么」升级到「影响什么」 | 提交前可见数据改动的**影响面**（受影响的图标 / 分类计数 / sortOrder 连续性），并给出风险提示 |
| **透明** | 发布前可见「将发生什么」 | 发布前有确认步骤：展示将提交的文件、将推送的提交、云端当前版本、预计影响；人工放行后才执行 |
| **可视化** | 对外状态与日志都可「看」 | 站点可用性看板（状态 / 响应时间 / 图标可达）；日志支持关键字过滤与多任务切换 |
| **自动化** | 关键风险节点有门禁、可回退 | 发布门禁；一键回滚到上一个 READY 部署；CDN 缓存清理纳入发布后置步骤 |

---

## 四、候选升级方向（按性价比排序）

### ① 安全收口：Host 校验 + 读接口鉴权　【成本：极低 · 风险：极低】✅ 已落地（M8）

- **痛点**：读接口裸奔 + `Host` 头未校验，DNS rebinding 可窃取本机项目信息
- **做法**：在 `server.mjs` 入口统一加 `assertTrustedHost(req)`（白名单 `127.0.0.1` / `localhost` / `[::1]`，含端口）；`handleApi` 对 GET 也走 `isTrusted`；对不带 `Origin` 的非浏览器请求（`curl` / 脚本）放行需谨慎，可用 `Sec-Fetch-Site` 辅助判定
- **价值**：堵住唯一真实的外部攻击面
- **依赖**：无
- **风险**：白名单过严会误伤本机 `curl` 调试（需保留显式豁免路径）

### ② 日志增强：过滤 / 搜索 / 多任务切换　【成本：低 · 风险：极低】✅ 已落地（M8）

- **痛点**：长任务日志靠肉眼翻，多任务无法对照
- **做法**：`core.js` 的日志区加关键字高亮过滤、`stdout/stderr/error` 分级筛选；`jobs.mjs` 已有 `listJobs()`，前端加任务下拉切换 + 保留各自缓冲
- **价值**：日常调试效率直接提升（对标 Dozzle）
- **依赖**：无（复用现有环形缓冲）
- **风险**：无

### ③ 发布门禁 + 一键回滚　【成本：中低 · 风险：中】

- **痛点**：一键直达生产不可逆
- **做法**：`syncpanel` 增加「预检 → 确认」两步，预检展示将提交文件 / 待推送提交 / 云端版本 / 目标站点数；回滚封装 `vercel rollback`（或部署别名 API），并在 UI 里二次确认 + 结果回显
- **价值**：把「误发布」的代价从「手工救火」降到「一次点击」
- **依赖**：Vercel 认证（`vercel` CLI 已可用）；`sync.mjs` 已有部署列表能力
- **风险**：回滚作用于生产别名，UI 必须明确展示「将把生产指向哪个部署」，避免点错

### ④ 站点运行状态看板　【成本：中 · 风险：低】

- **痛点**：线上可用性要另跑 `npm run check`
- **做法**：复用 `check-sites.mjs` 的分级口径（ok / limited / down），在控制台按需探活并落盘 JSON 历史，站点面板与概览展示状态徽标 + 响应时间趋势
- **价值**：从「管理站点」到「运维站点」
- **依赖**：已有探活脚本；注意 300 站规模的并发与频率控制
- **风险**：本机对 WAF 站点会误报（已知：kaggle / 一言 / stepfun 等），需沿用「重验再定性」的口径

### ⑤ 操作审计日志（持久化）　【成本：中 · 风险：低】

- **痛点**：`jobs` 事件只在内存，重启即失；无法回答「谁在何时做了什么」
- **做法**：把提交 / 推送 / 发布 / 热更新 / 回滚 / 校验失败等关键动作落盘为 `tools/console/.data/audit.jsonl`，历史面板增加「操作审计」视图（按时间 / 类型筛选）
- **价值**：可追溯，配合门禁形成闭环
- **依赖**：无
- **风险**：文件增长需轮转（按月或按条数）

### ⑥ hunk 级暂存 / 取消暂存　【成本：中 · 风险：中】

- **痛点**：细粒度暂存要回终端 `git add -p`
- **做法**：解析 `git diff` 的 hunk 边界，生成反向补丁后 `git apply --cached`（或 `--reverse`）实现单 hunk 暂存 / 取消
- **价值**：对标 lazygit 的核心体验
- **依赖**：`git.mjs` 需新增 hunk 解析与 patch 应用
- **风险**：补丁应用失败会留下脏索引，需在失败时自动 `git reset` 回滚该文件

### ⑦ 多环境发布（staging → promote → production）　【成本：高 · 风险：中高】

- **痛点**：只有一条生产链路，没有「先预览再上」
- **做法**：引入 staging 部署 + `vercel promote` / `rollback`，UI 体现阶段差异
- **价值**：发布更稳，但当前项目是单人维护的导航站，收益相对有限
- **依赖**：需理清 staging deployment / production alias 模型
- **风险**：环境模型理解成本高，易误发；**建议后置，非本期必做**

---

## 五、里程碑建议

| 里程碑 | 范围 | 定位 |
|--------|------|------|
| **M8** ✅ | ① 安全收口 + ② 日志增强 | 低成本、高收益、零依赖，先把地基与体验补上 |
| **M9** | ③ 发布门禁 + 一键回滚 + ⑤ 操作审计 | 让「发布」这件事可控、可追溯 |
| **M10** | ④ 状态看板 + ⑥ hunk 级暂存 | 体验深化；⑦ 多环境视实际需要再定 |

**建议先做 M8**：安全收口是唯一「不做会持续暴露风险」的项，且改动集中在 `server.mjs` / `api.mjs` 两个文件；日志增强与其无耦合，可同批交付。

> **编号顺延（2026-09-25 更新）**：M9 的槽位实际被**智能体 CLI**（`tools/cli/`，28 命令 / 4 域）占用。本文件的 ③ 发布门禁 + 回滚、⑤ 操作审计、④ 状态看板、⑥ hunk 级暂存已顺延，并以 `V5-M*` 重新编号 —— 见 [`NAV-v5-upgrade-plan.md`](NAV-v5-upgrade-plan.md)（③→V5-M2、⑤→V5-M3、④→V5-M4、⑥→V5-M5；⑦ 多环境后置）。V5 另新增「MCP 服务化」作为最高优先方向（V5-M1），用于承接 M9 的 CLI 成果。

---

## 六、明确不做（边界）

- **不引入前端框架 / 构建步骤**：控制台的价值在于零依赖、`node server.mjs` 即用；引入 Vite + Vue 会让它从「工具」变成「第二个项目」
- **不上 WebSocket**：当前无双向低延迟需求，SSE 足够
- **不把控制台部署到公网**：本地工具的定位不变，`.vercelignore` 继续排除
- **不做容器 / 多机管理**：Portainer / Dozzle 那类能力超出本项目边界

---

## 七、来源

1. lazygit features — https://lazygit.dev/features/
2. Dozzle — https://dozzle.dev/guide/what-is-dozzle
3. Vercel CLI（logs / alias / promote / rollback / env） — https://vercel.com/docs/cli
4. Uptime Kuma / Homepage / Dashy — https://github.com/louislam/uptime-kuma 、 https://gethomepage.dev 、 https://dashy.to
5. WebSocket vs Server-Sent Events — https://vercel.com/i/websocket-vs-server-sent-events
6. DNS Rebinding 防护 — https://appsecbrief.com/articles/dns-rebinding-attacks-web-application-security-prevention-guide-2026/
7. Jupyter Notebook 配置（allow_origin / Host 校验） — https://jupyter-notebook.readthedocs.io/en/5.6.0/config.html
8. Jupyter Server 安全（token 认证） — https://jupyter-server.readthedocs.io/en/latest/operators/security.html
9. Changesets / release-please / GitHub Actions 环境审批 — https://github.com/changesets/changesets 、 https://github.com/googleapis/release-please
10. Vercel CDN 缓存清理 — https://vercel.com/docs/caching/cdn-cache/purge

---

## 八、M8 实施记录（2026-09-25）

### 8.1 ① 安全收口

**落点**：`tools/console/lib/api.mjs`（校验实现）+ `tools/console/server.mjs`（入口统一应用）

`isTrusted(req)` 三重判定，覆盖**所有**请求（含静态资源与读接口）：

| 判定 | 规则 | 挡住的攻击 |
|------|------|-----------|
| ① Host | 剥离端口后必须命中回环白名单 `127.0.0.1` / `localhost` / `::1` / `[::1]` | **DNS rebinding**（浏览器发出的 Host 仍是攻击者域名，仅监听回环挡不住） |
| ② Origin | 若存在，其主机名也必须在同一白名单 | 跨站页面直接 fetch / XHR |
| ③ 自定义头 | 非 GET 必须带 `X-Nav-Console: 1` | 跨站表单/简单请求伪造（携带该头会触发预检，而本服务不返回 CORS 许可） |

要点与取舍：

- 用 `hostNameOf()` 剥离端口并兼容 `[::1]:5175` 这类 IPv6 字面量，避免白名单被端口击穿
- **本机 `curl` / 脚本调试不受影响**：天然满足 ①②（Host 回环、无 Origin）；调写接口需自行加 `-H "X-Nav-Console: 1"`，无需豁免路径（消除了候选方案里「白名单过严误伤调试」的风险）
- 静态资源同样过校验：`/ui/*`、`/icons/*`、`/` 与读接口共用同一入口判定，不留旁路

**自动化用例**：`tools/console/test-trust.mjs`（`pnpm run console:test`，零依赖，用 `node:http` 精确控制 Host 头），在独立端口拉起真实服务进程断言 13 条矩阵 —— 实测 **13/13 通过**：放行 4 条（本机 / `localhost` / `[::1]` / 同源 Origin）、拒绝 7 条（伪造 Host 读接口与静态资源、跨站 Origin、POST 缺自定义头、跨站 Origin 带自定义头、伪造 Host 带自定义头）、兜底 2 条（目录穿越尝试 404、未知接口 404）。

### 8.2 ② 日志增强

**落点**：`tools/console/ui/core.js`（日志模块重写）+ `ui/index.html`（`.log-bar`）+ `ui/style.css`

- **多任务切换**：前端按任务 id 各留一份缓冲（`Map<id, {title, status, lines}>`），`#job-select` 列出全部任务（状态符号 + 起始时间 + 标题）。切换时经 SSE 重放服务端环形缓冲重建，因此**先清掉该任务的非本地行再回放**，避免重复；本地生成的行（如「已提交 abc」）标记 `local: true` 予以保留。每 15s 轮询 `/api/jobs` 同步状态，因此**控制台之外启动的任务也能被看到**；`isBusy()` / 「终止任务」按「是否存在运行中任务」判定，而非仅看当前流
- **过滤与搜索**：`#log-filter` 输入 150ms 去抖后生效，支持 `/正则/flags` 语法（解析失败回落字面量）；命中区间用 `<mark>` 包裹（`DocumentFragment` + `createTextNode` 构建，不经 `innerHTML`，避免日志内容注入）；`#log-count` 显示 `显示 N / M 行`
- **分级筛选**：`输出 / 信息 / 成功 / 错误` 四枚 chip 对应 `stdout / info / success / stderr`，至少保留一级防止空视图
- **性能**：命中行增量追加（O(1)），仅在切换任务或改动过滤条件时全量重绘，避免长日志下 O(n²)
- **跟随**：默认滚到底部；用户手动上滚自动暂停并取消勾选，滚回底部自动恢复

**端到端验证**（浏览器实测）：自检任务产出 5 行 → 过滤「检查」得 `显示 4 / 5 行` 且 4 处 `<mark>` → 清空恢复 5 行 → 关掉「输出」chip 可见行归零、再开恢复 → 任务下拉含 2 个任务且切换互不串行 → 深浅两态日志区（时间戳 / 分级 chip / `<mark>` / 计数）对比度均清晰可读 → 收起态高度自适应、不裁切按钮。

**一处遗留观察**：页面加载时 `/api/changes/summary` 与 `/api/sync/status` 偶现 `net::ERR_ABORTED`。复测确认是**页面重载中断了在途的慢请求**（两者都要起 git 子进程），并非服务端拒绝——直接请求（含同源 Origin 头）均返回 200，与本次改动无关。

### 8.3 明确不做（本轮）

- 日志**持久化**到磁盘（属 M9 的 ⑤ 操作审计范畴）
- 关键字**前后跳转**（`上一个 / 下一个命中`）——过滤后命中即全部可见，收益有限
- 用例脚本**不引入测试框架**：保持 `node xxx.mjs` 即跑的零依赖形态