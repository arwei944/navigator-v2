# 保存即部署（watch → Vercel 生产）— 设计规格

- 日期：2026-10-09
- 需求原文：「部署到云端，同时现在需要本地更改实时同步到云端」
- 补充口径（用户确认）：
  1. 同步方式 → **本地保存即部署到生产**（常驻监听进程，不做 push 触发的 CD）
  2. 同步范围 → **代码 + 站点数据**（`api/sites-data.json` 也要能推上云）
- 状态：**已实现（2026-10-09）**
- 交付物：`scripts/watch-deploy.mjs`、`package.json` 新增 `watch:deploy`

## 1. 背景与现状

| 关注点 | 现状 |
| --- | --- |
| 线上地址 | https://navigator-v2-two.vercel.app |
| 发布入口 | `scripts/publish.mjs`（备份 → 数据校验 → 构建 → `vercel deploy --prod --yes` → POST `/api/sites` 热更新 → 轮询验证），README 标注为「唯一发布入口」 |
| Vercel 项目 | `prj_zedmlgXIk6kbKBnhgybiT9EGiHnt`（team `todYhoZLhs8IJr1Qo6fF7A2L`），本地 `.vercel/project.json` 已关联 |
| Git 集成 | **未接**。`.env.local` 中 `VERCEL_GIT_PROVIDER/REPO_OWNER/REPO_SLUG` 全为空；`.github/workflows/` 只有 `ci.yml`（校验+构建）与 `release-please.yml`，无部署工作流 |
| vercel CLI | 未全局安装；`publish.mjs` 靠 `npx vercel`（首次会下载并缓存到 `_npx`） |
| 代理口径 | `shared/proxy.mjs#applyProxyEnv()` 探测本机实际监听的代理端口并写回 `process.env`，免疫 Clash 端口漂移；`publish.mjs` 的 curl 调用全部继承 |
| 数据真相源 | 云端 Vercel Blob 的 `sites.json`；本地 `api/sites-data.json` 只是 SEED 兜底与发布源，**可能落后于云端**（管理后台的编辑只写云端） |

问题：改一行代码要手动跑一次 `publish`，反馈慢；而一旦做成「无条件自动发布」，**纯代码改动会用过期的本地数据覆盖云端**。

## 2. 目标

1. 本地保存后自动构建并发布到生产，无需手动敲命令。
2. 只在对应内容真的变了时才做那一步——**改代码不动云端数据，改数据才写 Blob**。
3. 复用 `publish.mjs` 的受控数据链路（备份 / schema 校验 / 快照 / 热更新 / 收敛验证），不另造一套。
4. 连续保存能攒批（防抖），部署重叠时排队而不是并发。
5. 可预演（`--dry-run`），能核对「哪些文件会触发、触发后跑什么」。

## 3. 方案对比

| 方案 | 做法 | 取舍 |
| --- | --- | --- |
| **A（采纳）** | 常驻 watcher 监听本地变更，防抖后按内容类型分流：代码 → 构建+部署；数据 → 走 `publish --skip-build` | 真·保存即上云，零手动步骤；数据精确受控。代价是要常驻一个进程，且编辑中间态也会上云 |
| B | Vercel Git 集成（连仓库，push 即部署） | 标准 CD、云端构建、有回滚；但需 commit+push 才触发，不是「文件保存级」，且会绕过 `publish` 的数据与校验环节；还需在 Vercel 侧改项目配置 |
| C | GitHub Actions 部署工作流 | 同 B，可控性略好（可先校验再部署），依然是 push 触发 |
| D | 无条件跑完整 `publish`（含数据热更新） | 最简单，但每次代码改动都会把本地数据推到云端 —— 会覆盖管理后台的编辑，**明确否决** |

## 4. 设计（方案 A）

### 4.1 触发范围

| 类别 | 内容 |
| --- | --- |
| 监听目录 | `src/`、`shared/`、`api/`、`public/`（递归） |
| 监听文件 | `index.html`、`vite.config.js`、`vercel.json`、`package.json` |
| 忽略目录 | `node_modules`、`dist`、`backups`、`.git`、`.vercel`、`.workbuddy`、`tools`、`probe`、`docs`、`perf-report` |
| 忽略文件 | `~ / .swp / .swx / .tmp / .log / .bak` 结尾、`.#` 开头、`.DS_Store`、根目录 `_*.{json,txt,png,html}` 报告 |

改脚本本身（`scripts/`）**不触发**部署——工具链改动不该上线。

### 4.2 部署分流

```
停止编辑 8s（防抖）
  ├─ 只有代码变了 → ① npm run build        → ② npx --yes vercel deploy --prod --yes
  ├─ 只有数据变了 →                           ② node scripts/publish.mjs --skip-build
  └─ 两者都变了   → ① npm run build        → ② node scripts/publish.mjs --skip-build
```

- **数据为什么走 `publish --skip-build`**：数据写入涉及备份、`validate-data.mjs` schema 门禁、服务端快照、版本递增、收敛轮询，全在 `publish.mjs` 里。复用它是「单一数据写入口」原则的延续（HANDOVER 第 840 行同款理由），避免两套链路漂移。它在部署前会校验，校验失败即中止，不会把坏数据推上去。
- **为什么数据变更要重新部署一次**：`api/sites-data.json` 也是部署产物里的 SEED 兜底，重新部署让「Blob 数据」与「SEED」保持一致。代价是多一次部署，换取两条数据源不打架。
- 用 `npx --yes vercel`（而非 `publish.mjs` 里的 `npx vercel`）：常驻进程无人值守，必须避免 npx 的安装确认提示卡住。

### 4.3 并发与失败处理

- **攒批**：每次事件重置防抖计时器，连续保存只在停下来后跑一次。
- **排队**：部署进行中到来的变更只累积 `dirty` 标记，当前部署结束后自动补跑一次（不并发、不丢改动）。
- **失败不吞**：任一步失败即打印首行错误 + 审计记录，并把本次的变更标记**放回** `dirty`，下次改动会连同一起重试。
- **失败后不自动重排**（首版实现的缺陷，已修）：`dirty` 里既有「失败保留的标记」又有「部署期间新到的变更」，若一律据此重排，构建持续失败时就会变成**无限自动重试** —— 首版实测以约 50s 一轮空转 49 分钟。现在用独立的 `arrivedDuringDeploy` 区分：只有「部署进行中又来了新变更」才在结束后补跑一次；失败保留的标记静静等下一次真实改动。
- 审计：通过 `tools/console/lib/audit.mjs#record` 记录 `watch.start / watch.deploy.done / watch.deploy.fail`，与 publish 事件同一审计流。

### 4.4 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--debounce=ms` | `8000` | 停止编辑后等待多久再部署（最小 1000） |
| `--no-data` | 关 | 只同步代码，不推送 `api/sites-data.json` |
| `--dry-run` | 关 | 只打印将要执行的命令，不真正构建/部署 |

### 4.5 明确不做

- **不自动 commit / push**：部署与版本管理解耦。要入库仍走 `git`（或 `pnpm run nav` 的 git 域）。
- **不装开机自启**：常驻开发者进程不写进系统任务；要长期跑就在自己的终端里 `pnpm run watch:deploy`，或复用 `tools/console/launcher` 那套自启机制（本设计不代劳）。
- **不改 `publish.mjs`**：保持它是「一次性完整发布」的单一入口，watcher 只做编排。
- **不做 Git 集成 / Actions 部署**：用户明确选了「本地保存即部署」。

## 5. 受影响文件清单

新增：

- `docs/superpowers/specs/2026-10-09-watch-deploy-design.md`（本文件）
- `scripts/watch-deploy.mjs`

修改：

- `package.json`（新增 `"watch:deploy"` 脚本）
- `README.md`（命令表 + 保存即部署小节）
- `HANDOVER.md`（发布章节补 watcher 说明）

## 6. 验证方式

**已完成的验证**：

- `--dry-run` 实测触发分流：
  - 触碰 `src/components/UnifiedSearchBox.vue` → `检测到代码变更` → `npm run build` + `vercel deploy --prod`
  - 触碰 `api/sites-data.json` → `检测到数据变更` → `publish.mjs --skip-build`
  - 触碰 `dist/index.html`、`docs/*.md`、`probe/_probe.html`、根 `_chrome-report.json` → **零触发**（忽略规则生效）
- 组成步骤各自在真机跑通：`npm run build` ✅、`npx --yes vercel deploy --prod` ✅（本轮已把合并后的搜索框发布上线，线上 `assets/index-BtNrp2iL.js` 内含 `unified-search-input`）。
- **失败路径回归**：复现同一构建失败（本沙箱下 vite 清 `dist` 被删除保护拦下），确认**触发 1 次、失败 1 次、70s 内无重试** —— 修复前该场景会每 ~50s 无限重试。

**待用户环境确认**：

- 真机上改一个 `src/` 文件，确认 8s 后线上自动更新。
- 改 `api/sites-data.json`（如加一个站点）确认云端 `/api/sites` 的 `version` 递增。

**环境备注（非项目问题）**：本轮会话的 PTY 环境下 Node `child_process` 带管道输出的 spawn 一律 `EBUSY`（连 spawn node 自身都失败），导致 `publish.mjs` 第 4 步（`execFileSync('curl.exe', …, {encoding:'utf8'})` 捕获输出）无法在此环境完成；用户自有终端无此限制。`publish.mjs` 未因此改动。
