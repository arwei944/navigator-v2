# Navigator V5 升级方案 — 智能体驱动 · 发布可回退

> 调研日期：2026-09-25 · 调研对象：`tools/cli/`（M9 新交付）、`tools/console/`、`scripts/`、`api/`、git 仓库现状，以及 MCP / Vercel / Uptime Kuma / Gatus / git 官方能力
> 前置：M1–M7 控制台六大面板、M8 安全收口 + 日志增强、M9 智能体 CLI（28 命令 / 4 域）均已落地。M9 的代码**尚未提交**（工作区 10 改 4 增）。本文件只讨论**下一版往哪走**。

---

## 一、外部调研结论（选型依据）

| 议题 | 候选 | 结论 | 依据 |
|------|------|------|------|
| 智能体集成 | 自建 REST / MCP 服务 / 让智能体直调 CLI | **MCP 服务化**，但按域收敛工具数 | MCP 规范 `2026-07-28` 已为 Current，官方 SDK 支持 stdio；社区实测工具数超过 30–50 后选择准确率明显下降 [1][2][3][5] |
| CLI→MCP 封装 | 官方封装器 / 社区桥接 / 自研 | **自研薄封装**（直接引 SDK，不引桥接） | 官方未提供通用 CLI→MCP 封装器；现成桥接（`cli2mcp`、`mcp-stdio-bridge`）均为社区项目，生产落地仍需自控安全边界 [6][7] |
| 发布门禁 | Vercel 原生审批 / Deployment Checks / 自建预检 | **自建「预检 → 人工放行」+ Vercel staged deploy** | Vercel 无原生「审批后才上生产」；Hobby 可用的是 staged deployment（`--skip-domain`）与手动 promote [13][14] |
| 回滚能力 | `vercel rollback` / 自建数据回滚 | **代码回滚只当兜底**（Hobby 仅一步）；重点做**云端数据快照** | Hobby 回滚超出上一个生产部署会报 `upgrade to pro`；Blob **无内置对象版本控制** [10][11][16] |
| 云端数据版本化 | Blob 内置版本 / 应用层快照 | **应用层版本化 pathname 快照** | Blob 只有 `allowOverwrite` / `addRandomSuffix` / `ifMatch`（ETag 乐观锁，只防冲突不存历史） [16][17] |
| CDN 缓存 | `vercel cache purge` | 纳入发布后置步骤 | 官方文档标注 cache purging 在所有 plan 可用 [18][19] |
| 可用性看板 | Uptime Kuma / Gatus / 自建 | **自建轻量**（复用 `check-sites.mjs`） | 300 站规模不值得再引一个自托管服务；Kuma/Gatus 均以 SQLite 存历史，重在其「重试后才判宕机」的口径 [22][26] |
| WAF 误报抑制 | 状态码白名单 / 重试 / 二次确认 | **重试 + 可接受状态码**（沿用现有 ok/limited/down 分级） | Kuma 用 `maxretries`/`retryInterval`/`accepted_statuscodes`；Gatus 用 `[STATUS] == any(200, 429)`，两者都无「确认后才告警」的内置默认 [22][23][25] |
| hunk 级暂存 | `git add -p` / 补丁应用 | **`git diff` 取 hunk → `git apply --cached`** | `--cached` 只改索引不动工作树；无上下文补丁需配 `--unidiff-zero` [28] |
| 统一 diff 解析 | 手写 hunk 头解析 / `jsdiff` | **先手写**（只需 hunk 边界） | `jsdiff` 的 `parsePatch`/`applyPatch` 更全，但本场景只需 `@@ -a,b +c,d @@` 边界，引库不划算 [34] |

**关键发现（直接影响本项目）**：**云端数据没有历史。** `api/sites.js` 写入 Blob 用的是 `addRandomSuffix: false` + `allowOverwrite: true`，并维护一个只增不减的 `version` 计数——**覆盖即丢失**，Blob 侧也没有对象版本控制可用 [16]。唯一的恢复源是本机 `backups/sites-data-*.json`（现有 25 份），既不上云、也不带版本语义。这意味着：一旦误发布（例如批量删站、字段写坏），**代码能回滚一步 [10]，数据却回不来**。这是本方案性价比最高的补洞点（见方向②）。

---

## 二、现状体检

### 2.1 能力盘点

| 层 | 现状 | 缺口 |
|----|------|------|
| 前端站点 | Vue 3 + Vite，Vercel 托管，数据经 Blob 热更新；`/api/sites` 带 `Cache-Control: no-store` + `useCache:false` | — |
| 本地控制台 | 零依赖 Node + 原生 JS；5 面板（改动 / 提交 / 同步 / 历史 / 数据）+ 站点面板；SSE 实时日志（多任务 / 过滤 / 搜索） | 无审计、无可用性看板、diff 只读 |
| 控制台接口 | 24 条路由（13 读 + 11 写），入口统一 `isTrusted` 三重校验（Host / Origin / 自定义头），13 条用例全绿 | — |
| 智能体 CLI | `tools/cli/`，28 命令 / 4 域：`sites` 9 · `publish` 5 · `git` 9 · `data` 5；stdout 单行 JSON，stderr 出日志；6 退出码 / 9 error.code；8 条写命令支持 `--dry-run` | 只有命令行入口，智能体需自行拼 shell；无 MCP |
| 发布链路 | `scripts/publish.mjs`：备份 → schema 门禁 → 构建 → 部署 → Blob 热更新 → 收敛轮询 | 无发布前人工放行；无回滚入口；无 CDN 清理 |
| 数据备份 | `backups/sites-data-*.json`（25 份，仅本地） | 不上云、无版本语义、无保留策略 |
| 云端数据 | Blob `sites-data.json` + 递增 `version` | **无历史版本**（覆盖即丢） |
| 数据脚本 | `validate-data.mjs` / `check-sites.mjs` / `fetch-favicons.mjs` / `fix-sortorder.mjs` / `verify-icons-online.mjs` / `perf-scroll.mjs` | — |
| 环境 | 只有生产一条链路 | 无 staging（Hobby 可用 CLI 自定义环境，收益有限） |

### 2.2 核心痛点

1. **智能体够不着**：CLI 已就绪，但智能体只能靠 shell 调用，拿不到工具语义（描述 / 参数 schema），易拼错、难发现
2. **发布不可逆**：数据覆盖即丢，代码回滚在 Hobby 上也只有一步
3. **发布不透明**：没有「先看将发生什么 → 再放行」的环节
4. **动作不可追溯**：`jobs` 事件只在内存，重启即失，答不了「谁在何时做了什么」
5. **对外状态看不见**：站点「管理」很全，但「线上通不通」要另跑 `npm run check`
6. **改动不够细**：只想暂存某个 hunk，得回终端 `git add -p`

---

## 三、V5 目标（可验收定义）

| 维度 | 目标定义 | 验收标准 |
|------|---------|---------|
| **智能** | 从「智能体能调 CLI」升级到「智能体原生可发现、可安全调用」 | 暴露 MCP 服务；工具数控制在 7 个以内；每个工具有清晰描述与参数 schema；写操作可被智能体显式声明意图 |
| **透明** | 发布前可见「将发生什么」 | 发布前有预检步骤：展示将提交文件 / 待推送提交 / 云端当前版本 / 目标站点数 / 数据增删统计；人工放行后才执行 |
| **可回退** | 代码与数据都能回到已知好状态 | 每次热更新前落一份云端快照；可一键把指定快照写回云端；回滚后 `version` 继续递增（不回退计数） |
| **可追溯** | 关键动作有持久化记录 | 提交 / 推送 / 发布 / 热更新 / 回滚 / 门禁拒绝等落盘为 `audit.jsonl`，可按时间与类型检索 |
| **可视化** | 对外状态可「看」 | 站点可用性看板：状态徽标 + 响应时间 + 图标可达性，沿用 ok/limited/down 分级并抑制 WAF 误报 |

---

## 四、候选升级方向（按性价比排序）

### ① MCP 服务化：把 28 条命令变成智能体原生工具　【成本：中低 · 风险：低】

- **痛点**：CLI 是「为智能体而生」的，但智能体只能 shell 调用——发现成本高、参数易错、无法声明意图
- **做法**：
  - 新增 `tools/mcp/`，用官方 `@modelcontextprotocol/sdk`（stdio 传输）包一层，**不引社区桥接** [3][6]
  - **工具数收敛是关键**：28 条命令**不**一一映射成 28 个工具（社区实测超过 30–50 个后选择准确率明显下降；一个 5 服务 / 58 工具的设置，仅工具定义就约占 55k token）[4][5]。改为 **4 个域级网关工具** + 少量高频读工具：
    | 工具 | 形态 | 覆盖 |
    |------|------|------|
    | `nav_sites` | `{action, ...}` | list/get/add/update/remove/categories/meta/icon/check |
    | `nav_publish` | `{action, ...}` | status/run/verify/sync-data/deployments |
    | `nav_git` | `{action, ...}` | status/diff/log/suggest/stage/unstage/commit/push/remote |
    | `nav_data` | `{action, ...}` | stats/integrity/diff/validate/doctor |
    | `nav_status` | 无参读工具 | 聚合环境 + 云端版本 + 工作区概览，作为智能体的「第一问」 |
    合计 **5 个工具**，远离膨胀阈值
  - **实现复用**：MCP 层只做「参数映射 + 结果透传」，业务逻辑仍走 `tools/cli/commands/*`，与 CLI 同源，不产生第二套语义
  - **安全**：写操作（`add`/`update`/`remove`/`run`/`sync-data`/`commit`/`push`）要求显式 `confirm: true` 才真跑，否则返回 dry-run 结果；工具描述保持简短；工具结果沿用现有契约（`envSummary` 只暴露「是否已配置」，不泄露值），缩小 prompt injection 面 [8][9]
- **价值**：M9 的投入直接变现；智能体从「拼 shell」升级为「调工具」
- **依赖**：`@modelcontextprotocol/sdk`（需引入依赖，与「控制台零依赖」边界不冲突——MCP 是独立进程，不进控制台）
- **风险**：MCP 规范仍在演进（`2026-07-28` 引入无状态协议核心 / 多轮请求 / header 路由）[1][2]，SDK 升级可能带来破坏性变更；需锁版本，并保留 CLI 直调作为降级路径

### ② 发布门禁 + 云端数据快照 + 一键回滚　【成本：中 · 风险：中】

- **痛点**：数据覆盖即丢；Hobby 回滚只有一步；发布前没有放行环节
- **做法**（三段，可分别验收）：
  1. **云端数据快照（最高优先）**：热更新前，把「当前云端数据」与「本次待写入数据」各落一份到 `sites-data.snapshots/<version>-<ts>.json`（`addRandomSuffix: false`），保留最近 N 份（如 20）。**这是把 `backups/` 从「仅本地」升级为「云端可回退」** [16][17]
  2. **发布门禁**：控制台同步面板加「预检 → 放行」两步。预检展示：将提交文件、待推送提交、云端当前版本与站点数、本次数据增删统计；沿用 Hobby 可行的 staged 路线：
     ```
     vercel deploy --prod --skip-domain      # 生成 staged 生产部署，不分配生产域名
     # 预检展示 + 人工放行
     vercel promote <deployment-url> --yes   # 手动提升为当前生产
     vercel cache purge --type cdn           # 后置清理 CDN
     ```
     （Vercel 无原生审批门禁：Deployment Checks 是「等检查通过」而非「等人点确认」，Rolling Releases 需 Pro；GitHub Actions 的 required reviewers 是可参考的门禁模式 [14][15][21]。`--skip-domain` 必须与 `--prod` 同用，作用是关闭生产域名的自动分配，之后再用 `vercel promote` 完成分配 [12][35]）
  3. **回滚**：`vercel rollback`（Hobby 仅能回滚到上一个生产部署，更早需 Pro）[10][11] + **数据回滚**（把指定快照写回主 pathname）。**关键约束：回滚写入时 `version` 必须继续递增，不得回退计数**——前端与 `sync.mjs` 的收敛判定都依赖 `version >= expected`，回退计数会让轮询误判为「未收敛」
- **价值**：把「误发布」的代价从「手工救火 / 数据丢失」降到「一次点击」
- **依赖**：`sync.mjs` 已有部署列表与云端读取能力；`vercel` CLI 可用
- **风险**：快照会增加 Blob 对象数（需保留策略）；回滚作用于生产别名，UI 必须明确展示「将把生产指向哪个部署 / 哪个数据版本」

### ③ 操作审计日志（持久化）　【成本：低 · 风险：低】

- **痛点**：`jobs` 事件只在内存，重启即失
- **做法**：新增 `tools/console/.data/audit.jsonl`（当前无 `.data/` 目录，需新建），记录 `{ts, actor, action, target, result, detail}`；接入提交 / 推送 / 发布 / 热更新 / 回滚 / 门禁拒绝 / 校验失败等关键动作；历史面板增加「操作审计」视图（按时间 / 类型筛选）
- **价值**：与方向②的门禁形成闭环——「谁放行的、放行了什么」可回答
- **依赖**：无
- **风险**：文件增长，需按月或按条数轮转；注意审计写入失败不能阻断主流程

### ④ 站点可用性看板　【成本：中 · 风险：低】

- **痛点**：线上可用性要另跑 `npm run check`
- **做法**：复用 `check-sites.mjs` 的分级口径（ok / limited / down），控制台按需探活并落盘快照，站点面板与概览展示状态徽标 + 响应时间趋势
- **误报抑制（本方向的关键）**：Kuma 用 `maxretries`/`retryInterval`/`accepted_statuscodes`，Gatus 用 `[STATUS] == any(200, 429)`；两者都**没有**「确认后才告警」的内置默认 [22][23][25]。本项目的对应做法是：**连续 N 次失败才判 down**，并把 429/403/405/401 归入 `limited` 而非 `down`（沿用现有 `health.js` 分级）；对 `Retry-After` 做解析与退避 [27]
- **规模控制**：Gatus endpoint `interval` 范围为 30s–1h，Kuma 可到 ~20s [24][22]；300 站规模应设并发上限（现有 `probeSites` 为 6 并发）+ 轮次间隔，不做高频全量探活
- **存储取舍**：Kuma/Gatus 均以 SQLite 存历史 [22][26]；本项目为「零依赖 + 短时趋势」，先落 **JSONL 快照**（按天一个文件）即可，若后续要长周期查询再评估 SQLite
- **价值**：从「管理站点」到「运维站点」
- **依赖**：已有探活脚本与 `nav sites check`
- **风险**：本机对 WAF 站点会误报（已知 kaggle / 一言 / stepfun 等），需沿用「重验再定性」的口径

### ⑤ hunk 级暂存 / 取消暂存　【成本：中 · 风险：中】

- **痛点**：细粒度暂存要回终端 `git add -p` [29]
- **做法**：解析 `git diff` 的 hunk 边界 → 生成子集补丁 → `git apply --cached`（暂存）/ `git apply --reverse --cached`（取消）；无上下文补丁须配 `--unidiff-zero` [28]。这是 lazygit 的同款路径（解析 unified diff 生成 subset patch，再 `git apply --cached`）[31][32][33]
- **实现取舍**：本场景只需 `@@ -a,b +c,d @@` 边界，**先手写解析**；`jsdiff` 的 `parsePatch`/`applyPatch` 更全但引库不划算，若后续要做行级选择再引 [34]
- **失败回滚**：补丁部分应用会留脏索引，失败时对**该文件**执行 `git restore --staged <file>`（或 `git reset -- <file>`）恢复，不用宽泛的 `git reset` [30]
- **坑位**：空白 / CRLF 差异会导致上下文不匹配，必要时加 `--ignore-whitespace`；补丁生成后工作树再变动也会失配 [28]
- **价值**：对标 lazygit 的核心体验，把「回终端」这一步消掉
- **依赖**：`git.mjs` 需新增 hunk 解析与 patch 应用

### ⑥ 多环境发布（staging → promote → production）　【成本：高 · 风险：中高】建议后置

- **现状**：Hobby **可以**用 CLI 配自定义环境（`vercel deploy --target=staging`、`vercel pull --environment=staging`、`vercel env add KEY staging`）[20]，技术上可行
- **判断**：本项目是单人维护的导航站，方向②的「staged + promote」已覆盖「先验证再上生产」的核心诉求；再引入完整 staging 环境模型，收益相对有限
- **结论**：**非本期必做**，等方向②落地后视实际需要再定

---

## 五、里程碑建议

| 里程碑 | 范围 | 定位 | 预估 |
|--------|------|------|------|
| **V5-M1** | ① MCP 服务化（5 工具 + stdio + 写操作 confirm 闸门） | 让 M9 的投入变现，智能体原生可调 | 中低 |
| **V5-M2** | ② 云端数据快照 + 发布门禁 + 回滚 | 补「数据覆盖即丢」这个真实风险洞 | 中 |
| **V5-M3** | ③ 操作审计日志 | 低成本，与 M2 门禁形成闭环 | 低 |
| **V5-M4** | ④ 站点可用性看板 | 可视化，复用现有探活能力 | 中 |
| **V5-M5** | ⑤ hunk 级暂存 | 体验深化 | 中 |

**建议先做 M1 + M2**：M1 复用 M9 成果、成本集中在「工具收敛」这一处设计决策；M2 的**云端快照**子项是唯一「不做会持续暴露数据丢失风险」的项，且与 M1 无耦合，可并行推进。③ 体量最小，建议搭 M2 一起交付。

**关于原 M9/M10 编号**：`nav-console-next-plan.md` 原定 M9 = 发布门禁 + 审计、M10 = 看板 + hunk 暂存；**M9 实际被智能体 CLI 占用**。本方案以 `V5-M*` 重新编号，原计划文档的 ③④⑤⑥ 顺延至 V5-M2 / M4 / M3 / M5。

---

## 六、明确不做（边界）

- **不把控制台部署到公网**：本地工具定位不变，`.vercelignore` 继续排除
- **不为 MCP 引入 Web 框架 / HTTP 传输**：stdio 足够覆盖本地智能体场景；Streamable HTTP 留到真有远程调用需求时再评估 [3]
- **不引社区 CLI→MCP 桥接**：`cli2mcp` / `mcp-stdio-bridge` 是社区项目，语义不可控、安全边界不明，自研薄封装更稳 [6][7]
- **不做 28 个一对一工具**：工具数须收敛到个位数，避免智能体工具选择退化 [4][5]
- **不引 SQLite**：可用性历史先用 JSONL 快照，避免给零依赖控制台加原生依赖 [22][26]
- **不做完整 staging 环境**：见方向⑥，后置
- **不引重型 diff 库**：hunk 边界手写解析，够用即可 [34]

---

## 七、来源

1. MCP 版本与规范状态（`2026-07-28` 为 Current） — https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning.md
2. MCP `2026-07-28` 规范 Release Candidate（无状态核心 / 多轮请求 / header 路由） — https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
3. `@modelcontextprotocol/sdk`（Node/TS 官方 SDK，stdio + Streamable HTTP） — https://www.npmjs.com/package/@modelcontextprotocol/sdk
4. Anthropic Engineering：Code execution with MCP（工具定义与结果占上下文） — https://www.anthropic.com/engineering/code-execution-with-mcp
5. 工具数膨胀与选择退化（58 工具 ≈ 55k token；30–50 阈值） — https://startdebugging.net/2026/05/how-to-reduce-the-number-of-mcp-tools-claude-loads/
6. `cli2mcp`（社区：CLI `--help` → MCP 工具） — https://www.npmjs.com/package/cli2mcp
7. `mcp-stdio-bridge`（社区：任意 CLI 包装为 MCP server） — https://pypi.org/project/mcp-stdio-bridge/1.5.0/
8. MCP 安全：tool poisoning / prompt injection / 沙箱 — https://aiworkflowlab.dev/article/mcp-security-production-tool-poisoning-prompt-injection-defense
9. MCP Server 安全最佳实践（本地进程 / 受限运行） — https://apiscout.dev/guides/anthropic-mcp-server-security-2026
10. Vercel CLI：`rollback`（Hobby 仅能回滚到上一个生产部署） — https://vercel.com/docs/cli/rollback
11. Vercel：Instant Rollback（Pro/Enterprise 可回滚任意合格部署） — https://vercel.com/docs/instant-rollback
12. Vercel CLI：`promote` — https://vercel.com/docs/cli/promote
13. Vercel：Promoting Deployments（staged + promote 工作流） — https://vercel.com/docs/deployments/promoting-a-deployment
14. Vercel：Deployment Checks（等检查通过才分配生产域名） — https://vercel.com/docs/deployment-checks
15. Vercel：Rolling Releases（需 Pro / Enterprise） — https://vercel.com/docs/rolling-releases/rolling-release-deployment
16. Vercel Blob（`allowOverwrite` / `addRandomSuffix`；无内置对象版本控制） — https://vercel.com/docs/vercel-blob
17. Vercel Blob：CLI 管理存储 — https://vercel.com/docs/vercel-blob/manage-blob-storage
18. Vercel CLI：`cache`（purge / invalidate） — https://vercel.com/docs/cli/cache
19. Vercel：Purging CDN Cache（所有 plan 可用） — https://vercel.com/docs/caching/cdn-cache/purge
20. Vercel：配置 staging 环境（Hobby 可用 CLI 自定义环境） — https://vercel.com/kb/guide/set-up-a-staging-environment-on-vercel
21. GitHub Actions：部署与环境（required reviewers / prevent self-review 门禁模式） — https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
22. Uptime Kuma（自托管监控，SQLite 存储） — https://github.com/louislam/uptime-kuma
23. Uptime Kuma API：`maxretries` / `accepted_statuscodes` 语义 — https://uptime-kuma-api.readthedocs.io/en/latest/api.html
24. Gatus：endpoint 与监控类型、`interval` 范围 — https://gatus.io/docs/endpoints
25. Gatus：条件表达式（`[STATUS] == any(200, 429)`） — https://gatus.io/docs/conditions
26. Gatus：存储配置（`storage.type: sqlite`） — https://pkg.go.dev/github.com/TwiN/gatus/v5
27. IETF RateLimit headers 草案（429 / `Retry-After` / RateLimit-Limit） — https://www.ietf.org/archive/id/draft-ietf-httpapi-ratelimit-headers-03.html
28. git-apply（`--cached` 只改索引 / `--unidiff-zero` / `--ignore-whitespace` / `--whitespace`） — https://git-scm.com/docs/git-apply
29. git-add（`-p` 分段暂存的交互项） — https://git-scm.com/docs/git-add
30. git-reset / `git restore --staged`（撤销暂存并保留工作树） — https://git-scm.com/docs/git-reset
31. lazygit 官方指南（hunk / 行级 stage） — https://lazygit.dev/docs/guide/
32. lazygit 包文档（Stage individual lines / range / hunk） — https://pkg.go.dev/github.com/jesseduffield/lazygit
33. lazygit 分段暂存实现分析（解析 diff → subset patch → `git apply --cached`） — https://instagit.com/jesseduffield/lazygit/how-does-lazygits-staging-view-handle-partial-file-staging-and-hunk-management/
34. `jsdiff`（`parsePatch` / `applyPatch`） — https://www.npmjs.com/package/diff
35. Vercel CLI：`deploy`（`--prod --skip-domain` 关闭生产域名自动分配，须与 `--prod` 同用） — https://vercel.com/docs/cli/deploy