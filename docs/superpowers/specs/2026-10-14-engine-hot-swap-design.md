# 引擎热拔插重构：注册表形态 · 九个引擎模块 · 三条链的语义差别

> 状态：**实施完成（含 `site-store` 生产接线）**
> 日期：2026-10-14

## 0. 需求与动机

这次没有走四问卡片，动机直接来自现状盘点：**同一件事在多处各写一遍，换一个供应商要改主流程代码**。

| 症状 | 具体表现 |
|---|---|
| 重复实现 | 「HEAD 不收就 GET 复核」在 `shared/health-probe.mjs` 与 `server/cron.mjs` 各写一遍，两边注释都写着「不能复用对方」 |
| 顺序硬编码 | MyMemory / Google 的先后与解析写在 `shared/translate.mjs` 的 `translateToZh()` 函数体里 |
| 逻辑内联 | `api/ai.js#chat()` 把 URL 拼法、鉴权头、`choices[0].message.content` 解析全写在函数体里 |
| 分级回退各写一套 | 图标三级回退在 `scripts/fetch-favicons.mjs`，封面抓取在 `api/cover.js`，形态几乎相同却互不复用 |
| 常量锁死 | 分类白名单是 `api/metadata.js` 的模块级常量 `CATEGORY_META`，云端改不了；部署命令 `npx vercel deploy --prod --yes` 与站点地址硬编码在 `scripts/publish.mjs` |

目标不是「加抽象层」，而是：**换供应商 = 改一个环境变量，不改代码、不重启进程**。

## 1. 现状（先量后改）

重构前每件事的落点与重复次数：

| 能力 | 原实现位置 | 重复/锁死情况 |
|---|---|---|
| 站点元信息抓取 | `api/metadata.js`、`tools/console/lib/sites.mjs` | 两处各一份，无法切外部引擎 |
| 站点探活 | `shared/health-probe.mjs` + `server/cron.mjs` | 两套探测实现；cron 在 Linux 沙箱无 `curl.exe`，只能用 fetch 再写一遍 |
| 翻译链 | `shared/translate.mjs` | 顺序与解析硬编码在函数体 |
| LLM 调用 | `api/ai.js` | 发送层内联 |
| 图片获取（图标 + 封面） | `scripts/fetch-favicons.mjs`、`api/cover.js` | 两套三级回退，本质同一件事 |
| 分类表 | `api/metadata.js` | 模块级常量，服务端侧无法云端下发 |
| 站点存储语义 | `api/sites.js` | 版本递增 / CAS / 快照保留策略长在接口里 |
| 发布通道 | `scripts/publish.mjs` | 厂商相关三步硬编码 |

> 关键观察：这些「重复」不是复制粘贴的粗心，而是**每处都在为不同的运行环境做适配**（serverless / 本机 console / Linux cron）。所以正确解法不是抽一个函数让所有人共用，而是抽出**注册表 + provider**，让每处注入自己的运行环境。

## 2. 方案

### 2.1 统一形态：注册表 + 有序链 + 回退

八个模块共用同一套骨架：

```
registerXxx(spec)      注册（同 id 覆盖 → 这就是「热替换」语义）
listXxx({check})       清单（控制台展示 / 切换用，含 available 与 capabilities）
xxxChain(explicit)     产出实际要跑的链
                        优先级：显式参数 → 环境变量 → 注册顺序
                        过滤：available === false 的剔除
resolveXxx(...)        跑链，按各自语义决定回退还是停
```

链配置的**容错三态**（`translate` / `image` / `category` / `probe` / `llm` 五个链一致）：

| 配置情况 | 行为 | 为什么 |
|---|---|---|
| 列出未注册的 id | 忽略该 id，其余照用 | 容忍拼写错误里的部分正确 |
| 列出的 id 一个都没匹配上 | **回退全量引擎** | 配置写错不能静默失效，变成「翻译全瘫」 |
| 显式 `none` / `off` / `0` | **清空链** | 显式表达「我就是要关掉」 |

> 第二条最容易被写错：一个「配置写错了 → 链为空 → 功能静默消失」的实现，比没有这个开关更糟。

### 2.2 三条链的「回退语义」刻意不同

同构不等于同语义。这是本次重构最需要说清的一点：

| 链 | 遇到失败时 | 理由 |
|---|---|---|
| 翻译 / 图片 / 分类表 | **静默换下一个** | 翻译失败回原文、图片失败回无图，都不该让调用方失败 |
| 探活 | **不重试** —— 拿到 `code` 就停（哪怕是 `ERR`） | 「站点 down」本身就是结论。把「探到宕机」误当「探针坏了」，会导致对着一个宕机站点反复换探针重试 |
| LLM 对话 | **单个失败换下一个，但全链失败必须抛错** | AI 助手的失败必须让用户看到，不能像翻译那样静默降级成空回答 |

> 探活链的回退条件因此只能是「这个探针在当前环境**不可用**」（如 Linux 无 curl），而不是「这个探针没探通」。

### 2.3 九个模块

| 模块 | 职责 | 内置 provider（id / order） | 测试脚本 |
|---|---|---|---|
| `site-engine.mjs` | 站点元信息抓取引擎（二选一 + auto 探活回退） | `native`（恒可用，最终回退）/ `siteprobe`（探活在线才可用） | `test-engine.mjs` |
| `translate-engine.mjs` | 翻译引擎链（只做机制，引擎由 `translate.mjs` 注册） | `llm`（order 300，配端点才出现） | `test-translate-engine.mjs` |
| `llm-engine.mjs` | LLM 后端注册表（发送层） | `openai`（100，恒可用）/ `gateway`（200，配端点才可用） | `test-llm-engine.mjs` |
| `image-engine.mjs` | 图片提供者（图标与封面共用的机制 + 格式探测 + 工具函数） | `page-links`(100) / `favicon-ico`(200) / `favicon-im`(300) | `test-image-engine.mjs` |
| `probe-engine.mjs` | 探活探针（「怎么探」与「怎么定性」分开） | `curl-http`(100，仅 win32) / `fetch-http`(200，跨平台带 SSRF 防护) | `test-probe-engine.mjs` |
| `category-source.mjs` | 分类表来源（云端 / 外部 URL / 内置） | `cloud`(100) / `url`(200) / `builtin`(900，最终回退) | `test-category-source.mjs` |
| `cover-source.mjs` | `og:image` 封面提供者**实现**（不含注册表） | `og-image`(100，cover) | 由 `test-image-engine.mjs` 覆盖 |
| `site-store.mjs` | 站点存储 provider + 三条硬不变量契约 | `kv`(100，CAS=true) / `fs`(200，CAS=false) | `test-site-store.mjs` |
| `publisher.mjs` | 发布通道（厂商相关三步） | `vercel`(100，行为零变化) / `rsync-static`(200，需配目标) | `test-publisher.mjs` |

### 2.4 三个刻意的「不合并」

> **`llm-engine.mjs` 的 `openai` 与 `translate-engine.mjs` 里的 `llm` 引擎**：两者都打 OpenAI 兼容的 `/chat/completions`，但用途与调参面不同（一个服务 AI 助手、一个服务站点翻译）。合并之后，为其中一个调参会改坏另一个，所以留两份薄适配。

> **`cover-source.mjs` 不做成注册表**：机制（注册、排序、回退）已在 `image-engine.mjs`；这里只提供实现。实现若留在 `api/cover.js` 里，注册表就**只在 serverless 进程内成立** —— 测试、控制台、其他消费方都看不到它。

> **`shared/translate.mjs` / `shared/health-probe.mjs` 不改成注册表**：它们分别是「内建两引擎的注册方」与「定性方」，本身就属于调用方一侧。命名上容易误认为注册表，实际不是。

### 2.5 契约与不变量

**存储三条硬不变量**（`site-store.mjs`，原文）：

| # | 条款 | 违反后果 |
|---|---|---|
| ① | CAS 是唯一闸门：read-modify-write 必须带 `ifMatch` | 并发静默丢更新 |
| ② | 版本单调递增：由调用方用 `nextVersion()` 构造 data，provider **不擅自改**传入的 data | 版本错乱、快照对不上 |
| ③ | 覆盖前先快照：`writeSnapshot` 落带版本号的一份，保留 `SNAPSHOT_KEEP` 份 | 误写无法回滚 |

> `capabilities` 必须**如实声明**：`fs` provider 没有原子 CAS，就声明 `cas: false`。谎报 `true` 会让并发写悄悄丢更新，比不支持更糟。调用方据此降级。

**接线时的契约加固**：把 `api/sites.js` 的存储语义搬进 provider 前，先逐条比对两者，发现 `kv` provider 有三处语义比生产实现「松」，会静默改行为。已全部对齐并写成断言：

| 差异 | 原 provider | 生产语义（`api/sites.js`） | 加固后 |
|---|---|---|---|
| 读失败 | `JSON.parse` 失败**静默返回 `null`** | 直接抛 → 上层 503 | 解析失败**原样抛**（否则一次读故障会被当成「首次部署」，用种子覆盖线上数据） |
| 写入覆盖 | `allowOverwrite: true` **硬编码** | 首次写 / 快照写都是 `false` | 新增 `createOnly` → `allowOverwrite: false`；`ifMatch` → `true`；都不给才 `true` |
| 快照裁剪 | 只返回 `{ deleted }` | 调用方需要 `ok` | 返回 `{ ok, deleted }`，失败 `{ ok: false, error }` |

> 另补两处能力：`readAt(pathname)`（读快照内容，供回滚预览）；`resolveSiteStore` 的**显式 id 也要满足 `available(ctx)`**（否则 `NAV_SITE_STORE` 误设为 `fs` 而 ctx 无 `dir` 时，会崩在 `path.join(undefined)`）。`fs` provider 同步对齐同一口径（`read` 抛错、`createOnly`、`readAt` 带越界防护、`writeSnapshot` 不覆盖、`listSnapshots` 补 `size` / `uploadedAt`）。

**ext 契约：一律不带点**（`image-engine.mjs`）。`detectExt` 返回 `'png'` 而非 `'.png'`；拼接点号、决定落盘路径是调用方的事。两处约定不同曾导致 `siteId + ext` 拼出看似一样、实则来源不同的扩展名。

**出网纪律由 ctx 注入**：provider 不自己抓网络，一律用调用方给的 `ctx`（`fetchBuf` / `fetchCapped` / `loadJson`…）。这样 SSRF 防护、超时、字节上限由调用方统一控制，provider 无法绕过。

> `cover-source.mjs` 的手动跟跳也是同一个理由：`fetchCapped` 刻意**不跟重定向**，自动跟随会把请求带到未校验的目标、绕过 SSRF 防护，所以逐跳重校验。

### 2.6 接线方式

| 文件 | 接的引擎 | 说明 |
|---|---|---|
| `api/ai.js` | `chatWithChain` | 只抽「怎么发一次请求」，配置读取仍在本文件 |
| `api/metadata.js` | `createCategoryResolver` + 动态 `probeViaSiteprobe` | 分类表改运行时解析；site-engine 用**动态 import**，未显式配置就不加载、不探活 |
| `api/cover.js` | `resolveImage` / `fetchHtmlFollowing` | 保留落盘、负缓存、诊断；另注册第二源 `favicon-as-cover` |
| `api/translate.js` | 经 `shared/translate.mjs` 间接使用 | 本文件不直接 import 引擎 |
| `server/cron.mjs` | `runProbe`（显式选 `fetch-http`） | Linux 沙箱无 curl，必须显式指定 |
| `scripts/publish.mjs` | `resolvePublisher` | 静态通道下跳过热更新与收敛验证 |
| `scripts/fetch-favicons.mjs` | `resolveImage`（kind=favicon） | 脚本只留批量调度与落盘 |
| `shared/health-probe.mjs` | `runProbe` | 只保留定性：`verdictOf` / `STATUS_LABEL` / attempts 口径 |
| `shared/translate.mjs` | `registerTranslator` / `translateWithChain` | 加载时注册 mymemory(100) 与 google(200) |
| `api/sites.js` | `resolveSiteStore`（显式 `kv`） | 版本递增 / CAS / 快照语义搬进 provider；HTTP 处理 / 校验 / 种子兜底 / 304 逻辑不动 |

## 3. 配置与存储

所有开关都走环境变量，取值优先级统一为：**显式参数 → 环境变量 → 注册顺序**。

| 模块 | 环境变量 | 默认 / 作用 |
|---|---|---|
| site-engine | `NAV_SITE_ENGINE` | `auto`；`native` / `siteprobe` / `auto` |
| site-engine | `SITEPROBE_ENDPOINT` | `http://127.0.0.1:8799` |
| translate-engine | `NAV_TRANSLATE_ENGINES` | 引擎链换序 / 裁剪 / `none` |
| translate-engine | `TRANSLATE_LLM_ENDPOINT`、`TRANSLATE_LLM_MODEL` | 未配则 `llm` 引擎不出现 |
| llm-engine | `NAV_LLM_BACKENDS` | 后端链换序 / 裁剪 |
| llm-engine | `AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL` | `openai` 后端配置 |
| llm-engine | `LLM_GATEWAY_ENDPOINT`、`LLM_GATEWAY_API_KEY`、`LLM_GATEWAY_MODEL` | 本机网关后端；未配则不出现 |
| image-engine | `NAV_ICON_PROVIDERS`、`NAV_COVER_PROVIDERS` | 按 kind 分别配置提供者链 |
| image-engine | `NAV_ICON_DISABLE_THIRD_PARTY` | `'1'` 时禁用 favicon.im |
| api/cover.js | `NAV_COVER_FAVICON_FALLBACK` | `'1'` 时启用 `favicon-as-cover` 第二源 |
| probe-engine | `NAV_HEALTH_PROBES` | 探针链（如 Linux 下选 `fetch-http`） |
| category-source | `NAV_CATEGORY_SOURCES` | 来源链换序 / 裁剪 |
| category-source | `NAV_CATEGORY_PATH`、`NAV_CATEGORY_URL` | 数据文件路径（默认 `sites.json`）/ 外部表 URL |
| site-store | `NAV_SITE_STORE` | `kv` / `fs` |
| publisher | `NAV_PUBLISHER` | `vercel`（默认）/ `rsync-static` |
| publisher | `NAV_SITE_URL`、`NAV_DEPLOY_TARGET`、`NAV_DEPLOY_SRC` | 站点地址覆盖 / rsync 目标与源（默认 `dist/`） |

> `publisher` 保存的是**取值函数**而不是取好的值：配置改了立刻生效，不会固化成进程启动那一刻的值。

## 4. 验收标准

### 4.1 自动化守卫

| 测试脚本 | 断言数 | 结果 |
|---|---|---|
| `test-engine.mjs` | 10 | ✅ |
| `test-translate-engine.mjs` | 22 | ✅ |
| `test-probe-engine.mjs` | 18 | ✅ |
| `test-publisher.mjs` | 13 | ✅ |
| `test-image-engine.mjs` | 35 | ✅ |
| `test-llm-engine.mjs` | 15 | ✅ |
| `test-site-store.mjs` | 16 | ✅ |
| `test-category-source.mjs` | 18 | ✅ |
| `test-pipeline-trace.mjs`（同日另一块工作） | 31 | ✅ |
| `test-sites-cas.mjs`（既有 CAS / 门禁守卫，接线后继续生效） | 19 | ✅ |
| **合计** | **197** | **0 失败** |

### 4.2 行为等价

| 项 | 判据 | 结果 |
|---|---|---|
| 默认发布通道 | `vercel` 部署命令与站点地址与改动**前逐字一致** | ✅（`test-publisher.mjs` 逐字比对） |
| 探活定性口径 | `verdictOf` / `STATUS_LABEL` 仍从 `health-probe.mjs` 导出，换探针不改变判定 | ✅（`test-probe-engine.mjs` 回归项） |
| 分类表消费方 | `categoryMetaFromGroups` 与内置 `categoryMeta()` 同形状 | ✅ |
| 引擎输出形状 | `native` 与 `siteprobe` 都产出 `inferSite` 形状，可互换 | ✅（`NAV_SHAPE` 契约） |

### 4.3 测试入口

8 条 npm 脚本已挂（`console:test:engine` / `translate-engine` / `probe-engine` / `llm-engine` / `image-engine` / `category-source` / `site-store` / `publisher`），并全部追加进 `console:test:all`（该脚本现有 45 个测试文件）。

> 收尾前这 8 个脚本**只存在于工作区、没有任何 npm 入口** —— 等于写了守卫但没接线。本次一并补上。

### 4.4 本轮范围

- **`api/sites.js` 生产写路径已完成接线**（本轮最后一步）。原文件内 6 个私有存储函数（读带 ETag / 条件写 / 读任意 pathname / 写快照 / 裁快照 / 列快照）已删除，改为注入 `resolveSiteStore({ explicit: 'kv', ctx: { kv, pathname } })` 并调用 provider；HTTP 处理 / 校验 / 种子兜底 / 304 可重验证缓存 / 409 判定全部不动，行为逐字等价。
- **接线前先做了一轮契约加固**：原 `kv` provider 有三处语义比生产实现更「松」（读故障静默返回 `null`、`allowOverwrite` 硬编码 `true`、`pruneSnapshots` 缺 `ok`），都会静默改变生产行为，已全部对齐并写成失败即红的断言（详见 2.5）。
- **为什么 `explicit` 固定为 `'kv'`**：存储是数据安全单点。若让 `NAV_SITE_STORE` 在此接口生效，一次误设（如指到 `fs`）就会让生产读到另一个空目录、进而用种子覆盖线上真实数据。换后端应在 provider 层显式切换，不经由这个接口的环境变量。
- **双护栏**：`test-site-store.mjs`（16 条契约断言）+ `test-sites-cas.mjs`（19 条既有 CAS / 门禁断言，`mock.module('#store')` 在 provider 注入下依然生效）两者全绿，确认接线零行为变化。
- 全量 `console:test:all` 已跑 —— 45 个脚本**全部通过**（含受影响的 `test-glossary` / `test-browser-translate` / `test-meta-fast` / `test-cron` / `test-health` 等），存储接线与引擎接线均未打破任何既有测试。

## 5. 不做的事

| 不做 | 理由 |
|---|---|
| 合并 `llm-engine` 的 `openai` 与 `translate-engine` 的 `llm` | 用途与调参面不同，合并会互相改坏 |
| 给 `cover-source.mjs` 加注册表 | 机制已在 `image-engine.mjs`，重复注册表只会分叉 |
| 改 `publish.mjs` 流水线的前四步（备份/校验/构建） | 它们与厂商无关，本次只动后三步 |
| 为「重复的探测实现」抽公共函数 | 两处是不同运行环境的适配，注册表比共用函数更合适 |
