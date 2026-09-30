# nav —— 智能体运维 CLI

给智能体（和脚本）调用项目能力的统一命令行入口。业务逻辑全部复用 `tools/console/lib/*`，
与控制台面板、`scripts/*.mjs` 同源，因此**不存在第二套实现**：CLI 只做参数解析、输出契约与编排。

```bash
node tools/cli/nav.mjs <命令域> <子命令> [选项]      # 直接运行
pnpm run nav <命令域> <子命令> [选项]                # 等价（package.json 的 nav 脚本）
nav <命令域> <子命令> [选项]                        # pnpm link / 全局安装 bin 后可用
```

## 输出契约（智能体友好）

| 通道 | 内容 |
|------|------|
| **stdout** | 只有一份结果文档。默认**单行 JSON**，`--pretty` 时转人类可读文本 |
| **stderr** | 进度提示、长任务子进程日志、告警。可 `--quiet` 抑制 |

成功与失败共用同一外层信封，调用方无需分支判断结构：

```json
{"ok":true,"command":"sites list","data":{...},"meta":{"durationMs":11}}
{"ok":false,"command":"sites add","error":{"code":"REJECTED","message":"该域名已收录：l2 Kaggle","hint":"","detail":null},"data":null,"meta":{"durationMs":6}}
```

因为 stdout 只有 JSON，可直接管道解析：

```bash
node tools/cli/nav.mjs sites list --category data | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).data.sites.length))"
```

### 退出码

| 码 | 名称 | 含义 |
|----|------|------|
| 0 | `OK` | 成功 |
| 1 | `INTERNAL` | 未预期的内部异常 |
| 2 | `USAGE` | 参数或用法错误（未知命令/选项、缺必填参数） |
| 3 | `ENV` | 环境/配置缺失（管理密钥、工具链、非 git 仓库） |
| 4 | `REMOTE` | 远端或网络失败（推送、部署、热更新、超时） |
| 5 | `REJECTED` | 业务规则拒绝（校验不通过、域名重复、`--strict` 探活失败） |

例外：`nav help`、`nav schema` 之外，**无参数运行 `nav` / `nav <命令域>` 输出纯文本帮助**，不遵循 JSON 契约。
机器可读清单请用 `nav schema`。

## 全局选项

| 选项 | 说明 |
|------|------|
| `--pretty` | 人类可读输出（表格 / 对齐文本） |
| `--json` | 显式声明 JSON 输出（默认即 JSON，便于脚本自述） |
| `--quiet, -q` | 抑制 stderr 进度与日志 |
| `--dry-run` | 预演写操作：只校验并展示将要发生的变化，**不落盘 / 不推送**（对只读命令无效果，会提示） |
| `--timeout <ms>` | 长任务超时毫秒数，超时强制终止（默认 900000） |
| `--help, -h` | 帮助；`nav <命令域> <子命令> --help` 看单命令 |
| `--version, -v` | 输出版本号 |

### 元命令

```bash
nav help                  # 全部命令总览
nav help sites            # 单个命令域的命令清单
nav help sites add        # 单个命令的完整用法
nav schema                # 机器可读清单：命令 / 选项 / 退出码 / 输出约定
```

`nav schema` 是智能体自述入口 —— 每条命令都带 `mutating` 标记，据此决定是否需要先 `--dry-run`。

## 命令清单（35 条）

### 站点管理 `sites`

| 命令 | 说明 | 写 |
|------|------|----|
| `sites list` | 列出站点，`--q` 关键字（名称/描述/域名/精确 ID）、`--category`、`--limit` | |
| `sites get <id>` | 读取单个站点完整字段 | |
| `sites add` | 新增站点：`--url --name --desc --category`（`--color --initial --icon` 可选） | ● |
| `sites update <id>` | 改字段，仅传入的字段生效；`--sort-order` 调权重 | ● |
| `sites remove <id>` | 删除（返回被删条目，可从 git 历史恢复） | ● |
| `sites categories` | 分类树 + 各分类站点数（选 `--category` 用） | |
| `sites meta <url>` | 抓标题/描述/图标地址 + 分类建议 | |
| `sites icon <id>` | 抓图标落盘 `public/icons` 并回写 `icon` 字段；`--favicon-url` 指定来源 | ● |
| `sites check` | 批量探活；`--ids`/`--limit`/`--timeout`/`--concurrency`/`--strict` | |

`sites check` 分级与 `scripts/check-sites.mjs` 同口径：**429/405/403/401 视为「可忽略」**（限流/反爬，站点实际可用），
`ERR`/404/402/410 才算「需处理」。加 `--strict` 时存在需处理站点即以退出码 5 结束，可直接做 CI / 智能体门禁。

### 发布与云端 `publish`

| 命令 | 说明 | 写 |
|------|------|----|
| `publish status` | 本地 / 云端版本对比、分支领先落后、热更新是否就绪 | |
| `publish run` | 一键发布全链路：检查 → 提交 → 推送 → 备份 → 门禁 → 构建 → 部署 → 热更新 → 验证 | ● |
| `publish verify` | 轮询云端直到站点数与本地一致（只读，不触发发布） | |
| `publish sync-data` | 只同步站点数据：差异检查 → 提交 → 推送 → 门禁 → 热更新 → 验证 | ● |
| `publish deployments` | 最近 Vercel 部署（状态机 / 环境 / 关联提交），需 `VERCEL_TOKEN` | |
| `publish preflight` | 发布预检：将提交文件 / 待推送提交 / 云端版本对比 / 数据增删统计，产出绑定工作区指纹的放行凭证（10 分钟有效） | |
| `publish snapshots` | 云端数据快照清单（新 → 旧），并对照本机 `backups/` | |
| `publish rollback` | 把指定快照写回生产数据，`version` 继续递增不回退；`--dry-run` 只预演差异 | ● |

`publish preflight` 只读：不改工作区、不写云端。放行凭证与工作区指纹强绑定 —— 分支、HEAD、
改动路径集合或数据文件摘要任一变化，凭证立即作废，避免「预检时看的是 A，放行时提交的是 B」。

`publish rollback` 前会先算「当前云端 → 目标快照」的站点增删改差异供确认；实际回滚时会把
「回滚前的当前数据」也存一份快照，因此**回滚本身可撤销**。注意：该命令依赖线上已部署 V5 代码
（`/api/sites` 的快照接口），线上仍是旧版本时会直接以退出码 4 提示「先发布 V5 代码」。

### Git 工作流 `git`

| 命令 | 说明 | 写 |
|------|------|----|
| `git status` | 分支、领先/落后、文件列表（含增删行数） | |
| `git diff <path>` | 单文件 diff（未跟踪文件按新增构造；超限截断） | |
| `git hunks <path>` | 列出单个文件的 hunk 边界与序号（0 起），供分块暂存 | |
| `git log` | 提交历史，`--limit`（默认 20） | |
| `git suggest` | 按改动生成 Conventional Commits 提交消息 + 站点数据差异摘要 | |
| `git stage <path...>` | 暂存指定文件 | ● |
| `git unstage <path...>` | 取消暂存 | ● |
| `git stage-hunks <path>` | 只暂存指定 hunk（`--hunks 0,2`），其余块留在工作区 | ● |
| `git unstage-hunks <path>` | 只取消暂存指定 hunk，其余块留在索引 | ● |
| `git commit` | 提交：`-m <消息>`，`--paths a,b` 只提交这些文件 | ● |
| `git push` | 推送 origin，`--branch` 指定分支 | ● |
| `git remote` | origin 地址与上游分支 | |

路径参数一律经 `assertSafePath` 校验，**拒绝绝对路径与目录穿越**。

分块暂存等价于终端的 `git add -p`：先用 `git hunks` 拿序号，再把序号传给 `stage-hunks`。
实现是手写 unified diff 解析 + `git apply --cached`，**只改索引，工作区文件不动**。
二进制文件、未跟踪文件、跨多文件的 diff 以及超出展示上限的差异不支持分块（显式拒绝而非静默降级）。
补丁应用失败时会把索引回退到操作前状态，避免留下半暂存的中间态。

### 数据体检与环境 `data`

| 命令 | 说明 |
|------|------|
| `data stats` | 站点总数与分类分布（含未登记分类告警） |
| `data integrity` | 图标/配色/描述缺失、sortOrder 重复与空洞、重复域名 |
| `data diff` | 站点数据工作区 vs HEAD 的结构化差异 |
| `data validate` | schema 门禁（与 `npm run validate` / 发布门禁 / CI 同一脚本） |
| `data doctor` | 环境自检：Node/git/curl/密钥/数据文件/图标目录 |
| `data audit` | 操作审计日志查询（`--limit` / `--action` / `--result`），新 → 旧 |

`data doctor` 是排障首选 —— 某条命令跑不动时先跑它，输出 `checks[].level`（`ok`/`warn`/`fail`），
存在 `fail` 项时退出码为 3，`hint` 里直接给出缺什么、影响哪些命令。

## 写操作与预演

写操作（上表「写」列，`nav schema` 里 `mutating: true`）**默认直接执行**，加 `--dry-run` 则只预演：

```bash
nav sites add --url example.com --name 示例 --desc 描述 --category learning --dry-run
# → {"ok":true,"command":"sites add","data":{"dryRun":true,"applied":false,
#     "wouldAdd":{"id":"l15","url":"example.com","sortOrder":299,...},"totalAfter":299}}

nav sites update ex11 --desc 新描述 --dry-run   # data.before / data.after 对比
nav sites remove ex11 --dry-run                # 返回将被删除的条目
nav git commit -m "feat: x" --dry-run          # 列出将提交的路径
nav git push --dry-run                         # 真实 git push --dry-run
nav publish run --dry-run                      # 分支/暂存数/plan/blockers（前置条件是否满足）
nav publish sync-data --dry-run                # 数据差异 + 计划
```

预演不是「另写一套校验」：`sites.mjs` 的 `addSite` / `updateSite` / `removeSite` / `downloadIcon`
都接受 `{ dryRun }`，**走完全部校验与 ID 计算后提前返回**，因此预演出的 `id` / `sortOrder` / 报错与实写完全一致，不存在口径漂移。

`publish run --dry-run` 的 `blockers` 会直接告诉你「为什么真跑会失败」，例如已暂存改动但没给 `--message`。

预演**不需要 `SITES_ADMIN_KEY`**：密钥与并发校验都排在预演分支之后，只在真正启动 job 时才执行。
缺密钥时 `publish run --dry-run` 会把这一条列进 `blockers` —— 预演放行，但不掩盖真跑会失败。

## 长任务

`git push` / `publish run` / `publish sync-data` / `publish verify` 是长任务：

- 复用 `lib/jobs.mjs`，**与 CLI 同进程**，直接轮询内存 job 对象，无需 SSE
- 子进程日志实时打到 **stderr**，`--quiet` 可静默；stdout 只在结束时输出一份结果
- 结果里带 `steps[]`（时间线步骤与耗时）、`logs[]`、`cloudVersion`、`deploymentUrl`
- 超时默认 15 分钟，`--timeout <ms>` 可调；超时按退出码 4 返回并终止子进程
- 同一时刻只允许一个同名发布任务，并发调用会以退出码 5 拒绝

## MCP 服务（智能体原生接入）

CLI 是给人（和脚本）用的；MCP 是给**智能体**用的同一套能力的另一种暴露方式。
`tools/mcp/server.mjs` 通过官方 `@modelcontextprotocol/sdk` 以 stdio 传输提供服务：

```bash
pnpm run mcp          # 启动 MCP 服务（stdio，供 MCP 客户端拉起）
pnpm run mcp:test     # 端到端用例：真实 stdio 握手 + 逐条断言工具契约
```

**工具收敛到 5 个域级工具**，而不是把 35 条命令平铺成 35 个工具 —— 工具数膨胀会显著拉低
智能体的选择准确率：

| 工具 | 覆盖 | 代表动作 |
|------|------|----------|
| `nav_status` | 智能体第一问 | 环境自检、本地/云端版本、分支状态、工作区概况 |
| `nav_sites` | 站点域 | `list` / `get` / `add` / `update` / `remove` / `meta` / `icon` / `check` |
| `nav_publish` | 发布域 | `status` / `run` / `verify` / `sync-data` / `preflight` / `snapshots` / `rollback` |
| `nav_git` | Git 域 | `status` / `diff` / `hunks` / `log` / `suggest` / `stage` / `stage-hunks` / `commit` / `push` |
| `nav_data` | 数据域 | `stats` / `integrity` / `diff` / `validate` / `audit` |

**写操作闸门**：所有写操作（`add` / `update` / `remove` / `icon` / `stage` / `stage-hunks` /
`commit` / `push` / `publish run` / `sync-data` / `rollback`）默认**只预演**，返回 `gate.preview = true`
与将要发生的变化；必须显式传 `confirm: true` 才真正执行。这挡住了智能体最常见的两类事故：
把「看一眼会怎样」当成「已经做了」，以及在没确认的情况下真的改了生产数据。

预演同样走完整校验：预演阶段被拒绝的请求（未登记分类、域名重复、缺名称）在真跑时也一样会被拒绝，
不存在「预演放行、真跑翻车」。测试用一条不存在的 id 触发业务拒绝，验证带 `confirm` 后确实进入了
执行路径，而不是又返回了一份预演结果。

## 目录结构

```
tools/cli/
├── nav.mjs              # 入口：分发、help/schema、退出码（命令清单来自 lib/registry.mjs）
├── lib/
│   ├── core.mjs         # 内核：输出契约、退出码、参数解析、长任务等待、表格渲染
│   └── registry.mjs     # 命令注册表：命令域 → 命令列表（CLI 与 MCP 共用的唯一真相源）
└── commands/
    ├── sites.mjs        # 站点管理（9）
    ├── publish.mjs      # 发布与云端（5）
    ├── snapshots.mjs    # 云端快照与回滚（3）
    ├── git.mjs          # Git 工作流（12）
    └── data.mjs         # 数据体检与环境（6）
```

`lib/registry.mjs` 是「有哪些命令」的唯一真相源，两个消费方都从它取：CLI 入口（help / schema / 分发）
与 MCP 服务（把命令映射成智能体工具）。新增命令只需在 `commands/*.mjs` 里定义并加入该文件的
`commands` 数组，CLI 与 MCP 同时可见，不会出现两边清单漂移。

## 新增一条命令

1. 在对应 `commands/*.mjs` 里定义对象并加入该文件的 `commands` 数组：

```js
const fooCmd = {
  path: 'data foo',              // 必须 "<命令域> <子命令>"，与所在域一致
  summary: '一句话说明',          // 出现在 help 与 schema
  usage: 'nav data foo <id> [--dry-run]',
  mutating: true,                // 写操作才标；标记后 help 会提示 --dry-run
  positionals: [{ name: 'id', required: true, desc: '站点 ID' }],
  flags: { 'some-flag': { desc: '选项说明', type: 'boolean' } },
  async run(argv, ctx) {         // ctx: { pretty, quiet, dryRun, timeoutMs }
    const { values } = parseCommandArgs(argv, buildOptions(fooCmd.flags), { usage: fooCmd.usage })
    return { data: {...} }       // 也可返回 { ok:false, exitCode, error, data } 自行判定成败
  },
}
```

2. 无需改 `nav.mjs` —— 入口按 `path` 自动建注册表，重复或前缀不匹配会直接抛错。
3. 文档只需改本文件与 `HANDOVER.md`。

约定：**不要在这里重写业务逻辑**，一律复用 `tools/console/lib/*`；需要新能力就先加进 lib，
再让控制台与 CLI 共用。