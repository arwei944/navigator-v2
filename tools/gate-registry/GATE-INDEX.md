# 门禁台账（自动生成）

> 生成命令：`npm run gate:index` ｜ 校验：`npm run console:test:gate-registry`
> 共 **87** 道门禁，其中已接入 `console:test:all` 的 **87** 道。

✅ 所有门禁脚本均已接入 `console:test:all`。

## 清单

| # | 门禁 | 守护什么 | 行数 |
|---|---|---|---|
| 1 | `test-a11y` | 无障碍（a11y）守卫（F3）：零依赖、静态检查、不联网。 | 100 |
| 2 | `test-admin-tools` | 后台快捷键与全局搜索守卫：纯函数，不碰 DOM。 | 91 |
| 3 | `test-affinity` | 网站关联度用例：零依赖、不联网。 | 218 |
| 4 | `test-alert-rules` | 告警规则引擎守卫：纯函数，不联网。 | 88 |
| 5 | `test-api-ops` | 线上运维面 `api/ops.js` 的用例：鉴权、查询分支、写入动作。 | 205 |
| 6 | `test-auto-add` | 站点草稿工具：自动添加管道与「添加站点」弹窗共用的判据。 | 138 |
| 7 | `test-auto-category` | 自动分类决策：6 条优先级分支 + label 归一 + id 派生与冲突自增。 | 111 |
| 8 | `test-bgm` | 背景音乐的音符生成：noteFreq / chordAt / notesForBar / barSeconds / clampVolume / fmtClock。 | 109 |
| 9 | `test-browser-translate` | 浏览器本地翻译（L2，`src/services/browserTranslate.js`）用例：零依赖、不联网。 | 267 |
| 10 | `test-bundle-size` | 产物体积门禁（NAV-v8 · 任务 4pnj9g） | 116 |
| 11 | `test-bundle` | 第三批 · 序 23 的守卫：首屏分包**产物**断言（不是源码断言）。 | 259 |
| 12 | `test-category-consistency` | 归类一致性体检用例（F5①）：零依赖、不联网。 | 76 |
| 13 | `test-category-source` | 分类表来源注册表（热拔插）自测：不联网。 | 155 |
| 14 | `test-chartkit` | src/utils/chartkit.js 用例：零依赖、不联网、纯字符串断言。 | 119 |
| 15 | `test-cloud-poll` | 云端轮询的**节奏语义**用例：零依赖、不联网（假时钟 + 打桩 fetch）。 | 333 |
| 16 | `test-command-phrases` | I3 守卫：自然语言 → 命令。 | 209 |
| 17 | `test-contrast` | 对比度守卫（F3）：从 `src/styles/main.css` 的变量**实算** WCAG 2.1 对比度并断言。 | 239 |
| 18 | `test-cron` | `server/cron.mjs` 巡检路径守卫（v10 第三批）。 | 88 |
| 19 | `test-data-quality` | 数据质量体检用例（F1）：零依赖、不联网。 | 123 |
| 20 | `test-deploy-manifest` | 门禁：增量上传的「产物指纹」与「增量集判据」。 | 77 |
| 21 | `test-deploy-resume` | 断点续传判据守卫：纯函数，不联网、不落盘。 | 53 |
| 22 | `test-deploy-status` | 部署状态接口用例：零依赖、不联网（读的是本机 store 与构建产物）。 | 103 |
| 23 | `test-desc-junk` | desc「机器垃圾」形态检测用例：零依赖、不联网。 | 77 |
| 24 | `test-doc-manager` | doc-manager 自测（门禁） | 133 |
| 25 | `test-dual-stack` | 双栈一致性门禁（kd7y5b）：`api/*.js`（Vercel 签名源）与 `server/main.mjs`（自托管宿主） | 76 |
| 26 | `test-endpoints-run` | 部署多端点发布链路用例（N2 补齐）：零依赖、不联网、**绝不触发真实上传**。 | 226 |
| 27 | `test-endpoints` | 部署端点注册表用例（N2）：零依赖、不联网、不触发真实发布会。 | 115 |
| 28 | `test-engine` | 抓取引擎（热拔插）自测：不联网、不依赖 siteprobe 在线。 | 100 |
| 29 | `test-env` | 环境变量台账门禁（防「三套账」漂移回潮）。 | 95 |
| 30 | `test-filter-chips` | 筛选条第二行取数：pickInlineChips。 | 87 |
| 31 | `test-frontend` | 第三批 · 序 18 / 20 / 23 的前端守卫。 | 224 |
| 32 | `test-glossary` | 离线词表（`shared/glossary.mjs`）用例：零依赖、不联网、零延迟。 | 188 |
| 33 | `test-graph-layout` | 关系图布局用例：零依赖、不跑浏览器。 | 204 |
| 34 | `test-gridnav` | src/utils/gridnav.js 用例：零依赖、不联网、纯函数穷举。 | 111 |
| 35 | `test-guard` | api/metadata.js 的 SSRF 防护用例：确认内网 / 回环 / 链路本地地址一律被拒。 | 52 |
| 36 | `test-health-fails` | 「连续不可达」计数与自动归档判据守卫：零依赖、不联网。 | 82 |
| 37 | `test-health` | 健康判定的**合并口径**守卫（v10）。 | 112 |
| 38 | `test-http-fetch` | `shared/http-fetch.mjs` 的**传输层**用例：零依赖，起本地服务器实测。 | 302 |
| 39 | `test-hunks` | hunk 级暂存 / 取消暂存用例。 | 281 |
| 40 | `test-hygiene` | 工作区 5S 门禁（防废料失控回涨）。 | 72 |
| 41 | `test-image-engine` | 图片提供者注册表（热拔插）自测：不联网。 | 261 |
| 42 | `test-infer` | shared/site-infer.mjs 用例：全部用内联 fixture，不联网、零依赖。 | 368 |
| 43 | `test-intent` | 智能化的两个内核用例：意图解析与场景排序。零依赖、不联网。 | 232 |
| 44 | `test-livesync` | 实时通道用例：零依赖、不联网。 | 90 |
| 45 | `test-llm-engine` | LLM 后端注册表（热拔插）自测：不联网（端到端跑本地假 OpenAI 服务）。 | 187 |
| 46 | `test-local-key` | 本机密钥端点（`api/_local-key.js`）的闸门自测：不联网、不起服务。 | 82 |
| 47 | `test-local-meta` | 本地推断兜底（`src/services/localMeta.js`）用例：零依赖、不联网。 | 153 |
| 48 | `test-meta-fast` | `/api/metadata` 的**快路径**用例：抓取早断、预算收紧、默认不翻译、同域缓存。 | 404 |
| 49 | `test-meta-fetch` | 站点元信息抓取的**响应容错**用例：零依赖、不联网（打桩 globalThis.fetch）。 | 230 |
| 50 | `test-meta-upgrade` | 「秒加之后的真实补全」（`src/services/metaUpgrade.js`）用例：零依赖、不联网。 | 246 |
| 51 | `test-mobile` | 移动端触摸目标守卫（F4）：零依赖、静态检查。 | 84 |
| 52 | `test-netguard` | 第三批 · 序 17 的守卫：SSRF 防线的**连接层**部分。 | 282 |
| 53 | `test-notes` | 便利贴 / 站点备注的同步内核用例：零依赖、不联网、不起浏览器。 | 189 |
| 54 | `test-offline-queue` | 离线编辑队列用例（F8）：零依赖、不联网、不碰 DOM（localStorage 用内存桩）。 | 130 |
| 55 | `test-ops` | 发布 / 管理内核用例：站点数据、发布流水线、发布历史、通知、审计。 | 996 |
| 56 | `test-pipeline-trace` | 管线日志总线（`src/utils/pipelineTrace.js`）用例：零依赖、不联网、不碰 UI。 | 164 |
| 57 | `test-plugin-registry` | 插件目录（统一注册表视图）自测：不联网。 | 208 |
| 58 | `test-preview-translate` | N1：搜索框网址预览卡片显示**译文**（`src/services/translateFields.js` + `useOmniBox` 的并卡逻辑）。 | 170 |
| 59 | `test-probe-engine` | 探针注册表（热拔插）自测：不联网（除最后两条端到端跑本地回环）。 | 150 |
| 60 | `test-publisher` | 发布通道注册表（热拔插）自测：不联网、不部署。 | 184 |
| 61 | `test-purposes` | shared/purposes.mjs 与 shared/translate.mjs 用例：内联 fixture，不联网、零依赖。 | 363 |
| 62 | `test-release` | 开发流水线自测：纯函数为主，不联网、不起子进程。 | 175 |
| 63 | `test-right-panel` | 右边栏设置面板用例：显示模式状态机（shared/right-panel.mjs）+ | 265 |
| 64 | `test-robust` | 第三批 · 序 20 / 29 / 30 的守卫：跨端共享的**纯函数**不变量。 | 146 |
| 65 | `test-schedule-publish` | 定时发布判据守卫：纯函数，不起定时器、不落盘。 | 54 |
| 66 | `test-search` | 检索内核用例（F2）：别名扩充（域名主体）/ 命中位置×频次排序 / 搜索历史。 | 103 |
| 67 | `test-session-merge` | 会话冲突口径一致性用例（F8）：零依赖、不联网、不碰 DOM。 | 134 |
| 68 | `test-session` | 第三批 · 序 18/19 的守卫：会话凭据的传递方式与体量门禁。 | 174 |
| 69 | `test-side-width` | 侧栏宽度取值范围：clampSideWidth。 | 60 |
| 70 | `test-site-aliases` | 站点别名数据守卫（F2①）：零依赖（只读本地 JSON，不联网）。 | 134 |
| 71 | `test-site-dedupe` | 站点去重 / 书签导入 / 批量编辑用例：零依赖、不联网。 | 159 |
| 72 | `test-site-refresh` | 「重新获取信息」用例：零依赖、不联网（抓取 / 翻译 / 写回都是注入的）。 | 166 |
| 73 | `test-site-store` | 站点存储 provider 自测：不联网（kv 用内存替身，fs 用临时目录）。 | 278 |
| 74 | `test-sites-cas` | 第三批 · 序 20 / 22 的守卫：站点数据的**写入安全**。 | 287 |
| 75 | `test-store` | `server/store.mjs`（Blob 同名同签名适配层）用例：**真库真表**，不 mock。 | 147 |
| 76 | `test-sw-refresh` | A1 守卫：PWA 新版本提示不许自动刷新。 | 112 |
| 77 | `test-theme-boot` | 主题「启动时序」守卫：持久化回填 → 补应用的那一段。 | 282 |
| 78 | `test-theme` | 主题模型用例：零依赖、不联网、不起浏览器。 | 192 |
| 79 | `test-translate-engine` | 翻译引擎（热拔插）自测：不联网，全部用注入的假 fetchText。 | 212 |
| 80 | `test-trust` | nav-console 来源校验用例（零依赖）。 | 112 |
| 81 | `test-undo` | E4b 守卫：撤销栈内核。 | 192 |
| 82 | `test-uptime` | 本站可用性内核：判定一次探测、折叠掉线区间、汇总可用率。 | 152 |
| 83 | `test-url-preview` | 网址预览纯函数：搜索框下拉里那张预览卡片的数据来源与状态判定。 | 141 |
| 84 | `test-url` | src/utils/url.js 用例：零依赖、不联网。 | 127 |
| 85 | `test-v10` | v10-P3/P4/P5 的接口守卫：备份恢复、封面提取、AI 降级。 | 193 |
| 86 | `test-visual-scheme` | src/utils/visualScheme.js 用例：零依赖、不联网、不起浏览器。 | 257 |
| 87 | `test-mcp` | nav-mcp 端到端用例：用官方 SDK 的 Client 走真实 stdio 握手，逐条断言工具契约。 | 270 |
