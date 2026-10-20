# 门禁台账（自动生成）

> 生成命令：`npm run gate:index` ｜ 校验：`npm run console:test:gate-registry`
> 共 **114** 道门禁，其中已接入 `console:test:all` 的 **114** 道。

✅ 所有门禁脚本均已接入 `console:test:all`。

## 按分类汇总

| 分类 | 道数 | 最慢一道 | 耗时 |
|---|---|---|---|
| 文档治理 | 2 | `test-doc-facts` | 0.4s |
| 安全与鉴权 | 6 | `test-netguard` | 0.3s |
| 搜索与交互 | 6 | `test-search` | 0.4s |
| 工作区治理 | 8 | `test-hunks` | 4.5s |
| 部署与发布 | 9 | `test-endpoints-run` | 2.8s |
| 服务端与运行时 | 23 | `test-mcp` | 34.6s |
| 数据与内容 | 29 | `test-trust` | 0.8s |
| 前端与体验 | 31 | `test-frontend` | 3.9s |

## 清单

| # | 门禁 | 分类 | 守护什么 | 行数 | 耗时 |
|---|---|---|---|---|---|
| 1 | `test-a11y` | 前端与体验 | 无障碍（a11y）守卫（F3）：零依赖、静态检查、不联网。 | 100 | 0.3s |
| 2 | `test-admin-tools` | 服务端与运行时 | 后台快捷键与全局搜索守卫：纯函数，不碰 DOM。 | 91 | 0.2s |
| 3 | `test-affinity` | 数据与内容 | 网站关联度用例：零依赖、不联网。 | 218 | 0.5s |
| 4 | `test-alert-notify` | 服务端与运行时 | 告警站外出口门禁（G3 / L1-3）。 | 78 | 0.2s |
| 5 | `test-alert-rules` | 服务端与运行时 | 告警规则引擎守卫：纯函数，不联网。 | 88 | 0.2s |
| 6 | `test-api-layer` | 服务端与运行时 | 接口层门禁：组件层不得绕过 services 直连 /api | 71 | 0.2s |
| 7 | `test-api-ops` | 服务端与运行时 | 线上运维面 `api/ops.js` 的用例：鉴权、查询分支、写入动作。 | 207 | 0.2s |
| 8 | `test-api-routes-live` | 服务端与运行时 | 控制台路由覆盖用例：真实启动控制台，逐条打全部路由，确认每条都**被路由识别**。 | 180 | — |
| 9 | `test-auto-add` | 数据与内容 | 站点草稿工具：自动添加管道与「添加站点」弹窗共用的判据。 | 138 | 0.2s |
| 10 | `test-auto-category` | 数据与内容 | 自动分类决策：6 条优先级分支 + label 归一 + id 派生与冲突自增。 | 111 | 0.3s |
| 11 | `test-backup` | 数据与内容 | 线上数据库备份：校验强度 + 保留策略 + 部署闸门 + 真实面板渲染。 | 444 | — |
| 12 | `test-bgm` | 前端与体验 | 背景音乐的音符生成：noteFreq / chordAt / notesForBar / barSeconds / clampVolume / fmtClock。 | 109 | 0.2s |
| 13 | `test-browser-translate` | 数据与内容 | 浏览器本地翻译（L2，`src/services/browserTranslate.js`）用例：零依赖、不联网。 | 267 | 0.6s |
| 14 | `test-bundle-size` | 前端与体验 | 产物体积门禁（NAV-v8 · 任务 4pnj9g） | 118 | 0.3s |
| 15 | `test-bundle` | 前端与体验 | 第三批 · 序 23 的守卫：首屏分包**产物**断言（不是源码断言）。 | 262 | 0.7s |
| 16 | `test-category-consistency` | 数据与内容 | 归类一致性体检用例（F5①）：零依赖、不联网。 | 76 | 0.4s |
| 17 | `test-category-source` | 数据与内容 | 分类表来源注册表（热拔插）自测：不联网。 | 155 | 0.2s |
| 18 | `test-chartkit` | 前端与体验 | src/utils/chartkit.js 用例：零依赖、不联网、纯字符串断言。 | 119 | 0.2s |
| 19 | `test-clicks-reset-ui` | 前端与体验 | 点击清空按钮的真机验证：登录后台 → 找到按钮 → 点击 → 数据归零。 | 145 | — |
| 20 | `test-clicks-reset` | 数据与内容 | 点击清空端点守卫：真实启动服务，验证 DELETE /api/clicks 的鉴权与行为。 | 117 | — |
| 21 | `test-cloud-poll` | 服务端与运行时 | 云端轮询的**节奏语义**用例：零依赖、不联网（假时钟 + 打桩 fetch）。 | 333 | 2.9s |
| 22 | `test-color-tokens-real` | 安全与鉴权 | 真机守卫：令牌替换后**实际渲染出的颜色没变**。 | 249 | — |
| 23 | `test-command-phrases` | 搜索与交互 | I3 守卫：自然语言 → 命令。 | 209 | 0.2s |
| 24 | `test-contrast` | 前端与体验 | 对比度守卫（F3）：从 `src/styles/main.css` 的变量**实算** WCAG 2.1 对比度并断言。 | 239 | 0.2s |
| 25 | `test-cron` | 服务端与运行时 | `server/cron.mjs` 巡检路径守卫（v10 第三批）。 | 88 | 1.2s |
| 26 | `test-data-quality` | 数据与内容 | 数据质量体检用例（F1）：零依赖、不联网。 | 123 | 0.2s |
| 27 | `test-deploy-manifest` | 部署与发布 | 门禁：增量上传的「产物指纹」与「增量集判据」。 | 77 | 0.2s |
| 28 | `test-deploy-resume` | 部署与发布 | 断点续传判据守卫：纯函数，不联网、不落盘。 | 53 | 0.2s |
| 29 | `test-deploy-status` | 部署与发布 | 部署状态接口用例：零依赖、不联网（读的是本机 store 与构建产物）。 | 103 | 0.3s |
| 30 | `test-deps` | 工作区治理 | 依赖 / 供应链门禁（来料检验）。 | 195 | 0.4s |
| 31 | `test-desc-junk` | 数据与内容 | desc「机器垃圾」形态检测用例：零依赖、不联网。 | 77 | 0.2s |
| 32 | `test-doc-facts` | 文档治理 | 文档「事实断言」门禁（防 README / HANDOVER 叙事漂移）。 | 345 | 0.4s |
| 33 | `test-doc-manager` | 文档治理 | doc-manager 自测（门禁） | 133 | 0.3s |
| 34 | `test-domain-flow` | 数据与内容 | 领域流水线：纯函数契约 + 真实页面渲染。 | 267 | — |
| 35 | `test-dryrun-purity` | 安全与鉴权 | 预演纯净性门禁：dryRun 分支不得产生外部副作用 | 104 | — |
| 36 | `test-dual-stack` | 服务端与运行时 | 双栈一致性门禁（kd7y5b）：`api/*.js`（Vercel 签名源）与 `server/main.mjs`（自托管宿主） | 89 | 0.2s |
| 37 | `test-endpoints-run` | 部署与发布 | 部署多端点发布链路用例（N2 补齐）：零依赖、不联网、**绝不触发真实上传**。 | 236 | 2.8s |
| 38 | `test-endpoints` | 部署与发布 | 部署端点注册表用例（N2）：零依赖、不联网、不触发真实发布会。 | 115 | 0.2s |
| 39 | `test-engine` | 数据与内容 | 抓取引擎（热拔插）自测：不联网、不依赖 siteprobe 在线。 | 100 | 0.3s |
| 40 | `test-env` | 工作区治理 | 环境变量台账门禁（防「三套账」漂移回潮）。 | 104 | 0.5s |
| 41 | `test-file-size` | 工作区治理 | 单文件体量守卫（防「拆完又长回去」）。 | 125 | — |
| 42 | `test-filter-chips` | 前端与体验 | 筛选条第二行取数：pickInlineChips。 | 87 | 0.2s |
| 43 | `test-format` | 前端与体验 | 格式化门禁：时间 / 字节 / 时长 / 耗时的展示实现只许住在 `shared/format.mjs` | 121 | 0.3s |
| 44 | `test-frontend` | 前端与体验 | 第三批 · 序 18 / 20 / 23 的前端守卫。 | 236 | 3.9s |
| 45 | `test-glossary` | 前端与体验 | 离线词表（`shared/glossary.mjs`）用例：零依赖、不联网、零延迟。 | 188 | 0.5s |
| 46 | `test-graph-layout` | 前端与体验 | 关系图布局用例：零依赖、不跑浏览器。 | 204 | 0.7s |
| 47 | `test-gridnav` | 前端与体验 | src/utils/gridnav.js 用例：零依赖、不联网、纯函数穷举。 | 111 | 0.2s |
| 48 | `test-guard` | 数据与内容 | api/metadata.js 的 SSRF 防护用例：确认内网 / 回环 / 链路本地地址一律被拒。 | 52 | 0.3s |
| 49 | `test-health-fails` | 服务端与运行时 | 「连续不可达」计数与自动归档判据守卫：零依赖、不联网。 | 82 | 0.2s |
| 50 | `test-health` | 服务端与运行时 | 健康判定的**合并口径**守卫（v10）。 | 112 | 0.2s |
| 51 | `test-http-fetch` | 前端与体验 | `shared/http-fetch.mjs` 的**传输层**用例：零依赖，起本地服务器实测。 | 302 | 1.1s |
| 52 | `test-hunks` | 工作区治理 | hunk 级暂存 / 取消暂存用例。 | 281 | 4.5s |
| 53 | `test-hygiene` | 工作区治理 | 工作区 5S 门禁（防废料失控回涨）。 | 98 | 0.4s |
| 54 | `test-image-engine` | 服务端与运行时 | 图片提供者注册表（热拔插）自测：不联网。 | 261 | 0.2s |
| 55 | `test-infer` | 前端与体验 | shared/site-infer.mjs 用例：全部用内联 fixture，不联网、零依赖。 | 368 | 0.2s |
| 56 | `test-inline-stability` | 前端与体验 | 「输入态不许驱动父级 v-if」的结构守卫。 | 106 | — |
| 57 | `test-input-focus-real` | 搜索与交互 | 真机按键守卫：搜索框逐字符输入不得失焦。 | 160 | — |
| 58 | `test-intent` | 搜索与交互 | 智能化的两个内核用例：意图解析与场景排序。零依赖、不联网。 | 232 | 0.2s |
| 59 | `test-livesync` | 服务端与运行时 | 实时通道用例：零依赖、不联网。 | 90 | 0.4s |
| 60 | `test-llm-engine` | 服务端与运行时 | LLM 后端注册表（热拔插）自测：不联网（端到端跑本地假 OpenAI 服务）。 | 187 | 0.4s |
| 61 | `test-local-key` | 服务端与运行时 | 本机密钥端点（`api/_local-key.js`）的闸门自测：不联网、不起服务。 | 82 | 0.2s |
| 62 | `test-local-meta` | 数据与内容 | 本地推断兜底（`src/services/localMeta.js`）用例：零依赖、不联网。 | 153 | 0.2s |
| 63 | `test-meta-fast` | 数据与内容 | `/api/metadata` 的**快路径**用例：抓取早断、预算收紧、默认不翻译、同域缓存。 | 406 | 0.2s |
| 64 | `test-meta-fetch` | 数据与内容 | 站点元信息抓取的**响应容错**用例：零依赖、不联网（打桩 globalThis.fetch）。 | 230 | 0.2s |
| 65 | `test-meta-upgrade` | 数据与内容 | 「秒加之后的真实补全」（`src/services/metaUpgrade.js`）用例：零依赖、不联网。 | 246 | 0.2s |
| 66 | `test-mirror` | 数据与内容 | 门禁：云端 → 本地实时镜像同步（含「本地离线期间补齐」这条核心能力）。 | 295 | — |
| 67 | `test-mobile` | 前端与体验 | 移动端触摸目标守卫（F4）：零依赖、静态检查。 | 85 | 0.2s |
| 68 | `test-netguard` | 安全与鉴权 | 第三批 · 序 17 的守卫：SSRF 防线的**连接层**部分。 | 282 | 0.3s |
| 69 | `test-notes` | 前端与体验 | 便利贴 / 站点备注的同步内核用例：零依赖、不联网、不起浏览器。 | 189 | 0.2s |
| 70 | `test-offline-queue` | 服务端与运行时 | 离线编辑队列用例（F8）：零依赖、不联网、不碰 DOM（localStorage 用内存桩）。 | 130 | 0.2s |
| 71 | `test-ops` | 服务端与运行时 | 发布 / 管理内核用例：站点数据、发布流水线、发布历史、通知、审计。 | 1026 | 0.8s |
| 72 | `test-pipeline-trace` | 前端与体验 | 管线日志总线（`src/utils/pipelineTrace.js`）用例：零依赖、不联网、不碰 UI。 | 164 | 0.3s |
| 73 | `test-plugin-registry` | 工作区治理 | 插件目录（统一注册表视图）自测：不联网。 | 208 | 0.3s |
| 74 | `test-preview-translate` | 搜索与交互 | N1：搜索框网址预览卡片显示**译文**（`src/services/translateFields.js` + `useOmniBox` 的并卡逻辑）。 | 170 | 0.2s |
| 75 | `test-probe-engine` | 服务端与运行时 | 探针注册表（热拔插）自测：不联网（除最后两条端到端跑本地回环）。 | 150 | 0.4s |
| 76 | `test-publisher` | 部署与发布 | 发布通道注册表（热拔插）自测：不联网、不部署。 | 184 | 0.2s |
| 77 | `test-purposes` | 前端与体验 | shared/purposes.mjs 与 shared/translate.mjs 用例：内联 fixture，不联网、零依赖。 | 363 | 0.3s |
| 78 | `test-release-please` | 部署与发布 | 版本号与发布配置门禁（生产记录的可验证部分）。 | 96 | 0.4s |
| 79 | `test-release` | 部署与发布 | 开发流水线自测：纯函数为主，不联网、不起子进程。 | 175 | 1.8s |
| 80 | `test-right-panel` | 前端与体验 | 右边栏设置面板用例：显示模式状态机（shared/right-panel.mjs）+ | 277 | 0.2s |
| 81 | `test-robust` | 工作区治理 | 第三批 · 序 20 / 29 / 30 的守卫：跨端共享的**纯函数**不变量。 | 146 | 0.2s |
| 82 | `test-schedule-publish` | 部署与发布 | 定时发布判据守卫：纯函数，不起定时器、不落盘。 | 54 | 0.3s |
| 83 | `test-scripts` | 工作区治理 | 仓库脚本台账门禁（`scripts/` 的生命周期管理）。 | 143 | 0.3s |
| 84 | `test-search` | 搜索与交互 | 检索内核用例（F2）：别名扩充（域名主体）/ 命中位置×频次排序 / 搜索历史。 | 103 | 0.4s |
| 85 | `test-secrets` | 安全与鉴权 | 密钥管理：登记表契约 + 形态体检 + **不泄露** + 真实面板渲染。 | 205 | — |
| 86 | `test-server-routes` | 服务端与运行时 | 服务端路由门禁：`api/` 目录 ↔ 构建产物 ↔ 路由表 三者同源 | 98 | — |
| 87 | `test-session-merge` | 安全与鉴权 | 会话冲突口径一致性用例（F8）：零依赖、不联网、不碰 DOM。 | 134 | 0.2s |
| 88 | `test-session` | 安全与鉴权 | 第三批 · 序 18/19 的守卫：会话凭据的传递方式与体量门禁。 | 176 | 0.2s |
| 89 | `test-share-target` | 前端与体验 | 分享目标门禁（G4 / L0-2）。 | 59 | 0.2s |
| 90 | `test-side-width` | 前端与体验 | 侧栏宽度取值范围：clampSideWidth。 | 60 | 0.2s |
| 91 | `test-site-aliases` | 数据与内容 | 站点别名数据守卫（F2①）：零依赖（只读本地 JSON，不联网）。 | 134 | 0.4s |
| 92 | `test-site-dedupe` | 数据与内容 | 站点去重 / 书签导入 / 批量编辑用例：零依赖、不联网。 | 159 | 0.2s |
| 93 | `test-site-refresh` | 数据与内容 | 「重新获取信息」用例：零依赖、不联网（抓取 / 翻译 / 写回都是注入的）。 | 166 | 0.3s |
| 94 | `test-site-store` | 数据与内容 | 站点存储 provider 自测：不联网（kv 用内存替身，fs 用临时目录）。 | 278 | 0.3s |
| 95 | `test-sites-cas` | 数据与内容 | 第三批 · 序 20 / 22 的守卫：站点数据的**写入安全**。 | 289 | 0.2s |
| 96 | `test-sites-split` | 数据与内容 | sites store 拆分后的纯函数守卫：覆盖层净化 / 回收站三道闸 / 云端错误分类。 | 245 | — |
| 97 | `test-split-wiring` | 前端与体验 | 大文件拆分后的「接线」守卫。 | 244 | — |
| 98 | `test-storage-guard` | 前端与体验 | 存储安全门禁（localStorage 写入必须走 safeStorage） | 72 | 0.2s |
| 99 | `test-store` | 服务端与运行时 | `server/store.mjs`（Blob 同名同签名适配层）用例：**真库真表**，不 mock。 | 147 | 0.3s |
| 100 | `test-sw-refresh` | 前端与体验 | A1 守卫：PWA 新版本提示不许自动刷新。 | 112 | 0.2s |
| 101 | `test-theme-boot` | 前端与体验 | 主题「启动时序」守卫：持久化回填 → 补应用的那一段。 | 282 | 3.2s |
| 102 | `test-theme` | 前端与体验 | 主题模型用例：零依赖、不联网、不起浏览器。 | 192 | 0.2s |
| 103 | `test-translate-engine` | 数据与内容 | 翻译引擎（热拔插）自测：不联网，全部用注入的假 fetchText。 | 212 | 0.2s |
| 104 | `test-trust` | 数据与内容 | nav-console 来源校验用例（零依赖）。 | 112 | 0.8s |
| 105 | `test-undo` | 前端与体验 | E4b 守卫：撤销栈内核。 | 192 | 0.2s |
| 106 | `test-uptime` | 服务端与运行时 | 本站可用性内核：判定一次探测、折叠掉线区间、汇总可用率。 | 152 | 0.4s |
| 107 | `test-url-preview` | 搜索与交互 | 网址预览纯函数：搜索框下拉里那张预览卡片的数据来源与状态判定。 | 141 | 0.2s |
| 108 | `test-url` | 数据与内容 | src/utils/url.js 用例：零依赖、不联网。 | 127 | 0.2s |
| 109 | `test-v10` | 服务端与运行时 | v10-P3/P4/P5 的接口守卫：备份恢复、封面提取、AI 降级。 | 193 | 0.3s |
| 110 | `test-visit-tracking-real` | 数据与内容 | 访问追踪真机验证：在真实浏览器里跑一遍「点击 → 本机记录 → 云端上报」。 | 163 | — |
| 111 | `test-visit-tracking` | 数据与内容 | 访问追踪守卫：并发写入语义 + 限流淘汰 + 本地存储收敛。 | 165 | — |
| 112 | `test-visual-layer` | 前端与体验 | 视觉层门禁（统一视觉层） | 368 | 0.4s |
| 113 | `test-visual-scheme` | 前端与体验 | src/utils/visualScheme.js 用例：零依赖、不联网、不起浏览器。 | 257 | 0.2s |
| 114 | `test-mcp` | 服务端与运行时 | nav-mcp 端到端用例：用官方 SDK 的 Client 走真实 stdio 握手，逐条断言工具契约。 | 338 | 34.6s |
