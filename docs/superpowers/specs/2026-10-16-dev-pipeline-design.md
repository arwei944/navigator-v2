# 开发流水线

一条命令跑完一次「改完代码 → 上线」的全过程：**测试门禁 → 提交 → 推送 → 构建 → 产物门禁 → 打包 → 上传 → 重启容器 → 线上验证**。

控制台面板（「流水线」tab）与 CLI（`nav release`）共用同一套编排引擎，行为完全一致。

---

## 0. 现状：能力都在，但没有一条闭环

动手前先把三块能力的位置摸清楚 —— 结论是**它们各有一个入口，但没有一个入口把它们串起来**：

| 能力 | 在哪 | 缺什么 |
|---|---|---|
| 测试门禁 | `npm run console:test:all`（52 脚本） | **纯手工**，不在任何流水线里 |
| 版本管理 | `nav git *` / 控制台「改动」「提交」面板 | 与发布脱节，要手动衔接 |
| 发布到服务器 | `deploy.mjs` + 控制台「发布」面板 | **不管提交与推送**，也不管测试 |
| 端到端（旧） | `nav publish run` | 部署环节走 **Vercel**，且不含测试 |

也就是说：`nav publish run` 端到端九步但**部署到了错的地方**（线上早已迁到自有服务器），
控制台「发布」走对了地方但**只覆盖后半段**。

### 顺带发现的两处脱节（**已于同日收敛**）

1. **两条部署路径并存**：`package.json#deploy`、`sync.mjs`、`nav publish run` 仍走 Vercel；
   而线上实际跑的是 BotKeep（自有服务器）。
2. **云端链路指向旧平台**：`cloud.mjs` 的 `SITE_URL = resolvePublisher().siteUrl`，
   当时解析到 **workbuddy** 通道（`nav-dashboard-19166.app.workbuddy.host`），
   于是 `publish verify` / `publish sync-data` 验证与推送的仍是**旧站点**。

流水线的部署段刻意没复用 `cloud.mjs`（直接复用 `deploy.publish` 打 BotKeep API），
所以它本身不受这两条影响；但**其余链路受影响**，因此当天做了一轮收敛：

| 改什么 | 怎么改 |
|---|---|
| **通道默认值**（根因） | `publisher.mjs` 新增 `botkeep` 通道（order 30，排最前）→ `SITE_URL` 与所有下游自动收敛 |
| 部署命令 | 新增 `scripts/deploy-botkeep.mjs`（通道需要一条**真实存在**的命令，测试会断言它存在） |
| `npm run deploy` | 改指 BotKeep，Vercel 保留为 `deploy:vercel` |
| 「历史」面板 | `history.mjs` 数据源从 Vercel 部署列表换成本机发布记录（`.deploy-history.json`），对外 shape 不变 |
| 同步面板 / CLI 状态 | 字段从写死的 `vercel.*` 换成通道无关的 `publisher.*` |
| doctor 自检 | 列出真正需要的 `BOTKEEP_*`（原先只列 Vercel 时代的变量，导致误报「未配置」） |
| watch-deploy / publish.mjs | 部署分支改走 BotKeep，并标注不再是推荐路径 |

**防复发**：`test-publisher.mjs` 加了两条守卫 —— 默认通道必须与线上实际所在一致、
通道的部署命令指向的脚本必须真实存在。否则「默认悄悄落回旧平台」会让整条数据链路
静默打到一个没人维护的站点上。

---

## 1. 方案

### 1.1 十步一条闭环

| # | 步骤 | 关键点 |
|---|---|---|
| 1 | 检查工作区 | 分支 / 改动数 / 领先提交；detached HEAD 直接拒 |
| 2 | 测试门禁 | `console:test:all`；失败即中止（可显式跳过并留痕） |
| 3 | 提交 | 工作区干净则跳过；有改动必须给提交消息 |
| 4 | 推送 | 无领先提交则跳过；`GIT_TERMINAL_PROMPT=0` 保证凭据缺失时快速失败而非挂起 |
| 5 | 构建 | `vite build` + 后置脚本 |
| 6 | 产物门禁 | 完整性与**新鲜度**（产物须新于源码） |
| 7 | 打包 | tar 切片，**排除 `data/`**（里面有管理密钥与本机站点库） |
| 8 | 上传 | 分片上传到平台（限流下自带重试） |
| 9 | 重启容器 | 删 `server.js` 触发重新解压 |
| 10 | 线上验证 | 轮询线上自述版本，直到与新构建一致 |

### 1.2 部署段不重写，用日志标记推进

5–10 步**直接复用 `deploy.publish`**（一行没改它）。它只用回调打日志、不吐结构化事件，
所以这里按它的 `· xxx` 标记把日志映射成步骤状态 —— 与 `sync.mjs` 解析
`=== N/5 ===` 是同一手法。好处：部署那段的实现零改动，面板上却能看到子步骤。

代价是**对日志措辞有隐性依赖**。因此 `markerKeyOf()` 被单独导出，并由
`test-release.mjs` 用**真实日志行**逐条断言 —— 万一那边改了字样，测试立刻红，
而不是流水线静默地不再推进步骤（这种「安静地坏掉」正是本项目踩过最多的一类坑）。

### 1.3 面板与 CLI 同源

`tools/console/lib/release.mjs` 是唯一编排处：

- CLI `nav release run` / `nav release plan`；
- 控制台「流水线」面板（预检回显 + 开关 + 时间线 + 实时日志）。

两者调用同一个 `preflight()` 与 `startRelease()`，**不存在「面板能跑但 CLI 不行」这类偏差**。

### 1.4 跳过必须留痕

三个开关（`--skip-test` / `--no-push` / `--skip-build`）都把对应步骤标成 `skipped`
并在 note 里写明是哪个开关跳的，同时向日志打一条 stderr 提示。跳过的步骤在时间线上**仍然可见**，
不会被悄悄抹掉。

---

## 2. 配置

无新增必填配置。`nav release run` 的开关：

| 开关 | 作用 |
|---|---|
| `--message/-m` | 提交消息（工作区有改动时必填） |
| `--skip-test` | 跳过测试门禁（留痕） |
| `--no-push` | 不推送远端（本地演练） |
| `--skip-build` | 复用现有 dist |
| `--dry-run` | 只跑预检，不产生任何副作用 |

依赖既有凭据：`BOTKEEP_API_KEY` / `BOTKEEP_WORKLOAD_ID`（`.env.local`，已 gitignore）。

---

## 3. 验收

| 项 | 证据 |
|---|---|
| 纯函数单测 | `test-release.mjs` **17 条**（步骤定义 / 三态 / **日志标记逐条** / preflight 形状） |
| CLI | `nav release plan --pretty` 与 `nav release run --dry-run` 实跑通过 |
| 真机（面板） | `probe/release-panel-verify.mjs` **13 条**：tab / 摘要 / 十步顺序与编号 / 控件 / 无 undefined |
| 全量回归 | `console:test:all` **52 脚本 exit 0** |
| **自我发布** | 用 `nav release run` 把本轮改动本身跑完整闭环上线（见下） |

最有说服力的一条是最后一条：**这个工具用它自己发布它自己**。

探针**刻意不点「开始流水线」** —— 那个按钮会真的提交、推送、部署。渲染层由探针覆盖，
编排逻辑由纯函数测试与 `--dry-run` 覆盖，真跑则由「自我发布」这一次完成。

---

## 4. 不做的事

- **不合并 `cloud.mjs` 的云端链路**（数据热更新仍走它）—— 它指向旧平台的问题见 0 节，
  属于另一条链路，本轮不夹带；
- **不删 Vercel 相关命令** —— 只把 `publish run` / `publish deployments` 的 summary 标为已废弃；
  删除是破坏性改动，且平台切换尚未完全收敛；
- **不做自动重试与断点续跑** —— 失败信息已足够定位，重跑一次的成本远低于维护一套续跑状态机；
- **不在流水线里跑 `npm run build` 之外的构建**（如单独的类型检查）—— 项目没有独立的类型检查门禁。
