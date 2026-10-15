# 后台功能扩展 21 项 —— 设计文档

日期：2026-10-16
范围：管理后台（`/admin`）的功能扩展，共 21 项，按主题分 5 批
决策来源：`docs/admin-redesign-proposal.html`（用户勾选「布局：暂不处理；功能扩展 21 项」）

---

## 0. 需求

用户在决策页勾选 21 项功能扩展。**布局方案暂不处理**（保留既有三栏）。

分 5 批：

| 批次 | 项数 | 内容 |
|---|---|---|
| 1 · 站点数据 | 5(+1) | 书签导入 / 批量编辑多字段 / 智能去重 / 失效自动归档 / 拖拽排序 |
| 2 · 发布部署 | 4 | 定时发布 / 字段级 diff 预览 / 失败重试+断点续传 / 部署对比 |
| 3 · 监控告警 | 3 | 告警规则自定义 / 可用性曲线 / 响应时间趋势 |
| 4 · 智能自动化 | 3 | 批量生成描述 / 分类建议自动应用 / 近似重复检测 |
| 5 · 平台体验 | 6 | 自然语言运维 / 暗色核查 / 移动端 / 快捷键 / 布局切换 / 全局搜索 |

---

## 1. 现状（改动前）

- 去重口径分叉：`normalizeUrl`（落库）保留 `www`，而 `hostOf`（判重）去 `www` → 同一站可能入库两条；`autoAdd` 的 `buildSiteFromDraft` 也保留 `www`
- 无书签导入、无拖拽、无近重复检测
- 连续失败次数没有记录（只有「最新一次」判定），无法区分「一直坏」与「刚坏」
- 发布预检只报「改了哪些字段」，看不到新旧值
- 部署失败要整个人工重来（上传 4 片要排队数分钟）
- 后台无搜索（只能搜站点列表）、无快捷键、硬编码色值在暗色下不可读

---

## 2. 方案（按项）

### 2.1 站点数据

**智能去重**：`shared/ops/site-ops.mjs#normalizeUrl` 加去 `www`（与 `hostOf` 同源）；`src/utils/siteDraft.js` 的 `buildSiteFromDraft` / `fallbackDraftFromMeta` 落库改裸域名。新增 `dedupeKey` / `findDupe` / `findNearDuplicates`（按注册域分组）。

**书签导入**：新增 `shared/bookmark-import.mjs#prepareBookmarkImport`（纯函数：归一 → 批内去重 → 已收录判重 → 分类推断 → 草稿）。浏览器侧解析仍用既有的 `src/utils/bookmarks.js`（DOMParser）。两者都**动态加载**。

**批量编辑多字段**：`BATCH_OPS` 加 `fieldset`（只写填了的字段）、`desc`、`pin` / `unpin` / `archive` / `unarchive`；`BATCH_COMPARE_FIELDS` 让置顶/归档也能被认成「有变化」。

**失效自动归档**：`shared/health-rules.mjs#nextResult` 维护 `fails`（连续不可达）；`server/cron.mjs#autoArchiveFailing` 在巡检后按 `shared/alert-rules.mjs` 的阈值挑出站点，**CAS 写**（`ifMatch`）sites.json，只归档不删除（可一键取回）。

**拖拽排序**：`AdminSitesPanel` 手写 HTML5 拖拽（不引依赖），拖动后同时写 `applySortOrder`（落库 sortOrder）与 `reorderSites`（本机顺序）。

### 2.2 发布部署

**字段级 diff 预览**：`AdminPublishPreflight` 用 `cloudSites`（线上）与 `sites`（待发布）算 before/after，分屏对照。

**定时发布**：`tools/console/lib/schedule.mjs` 加 `isPublishDue`（纯函数，一天只触发一次）+ 每分钟 tick 检查。**默认只提醒、不自动执行**，`publishAuto` 显式打开才跑 `startRelease` 流水线。

**断点续传**：`deploy.mjs` 加 `sliceFingerprint`（分片名+字节数）/ `shouldResumeUpload` / checkpoint 落盘。指纹一致且上一轮传完才跳过上传；重启后清除。

**部署对比**：后台 `AdminDeploy` 顶部加「一致性摘要」（构建 / 上游 / 线上三方对齐），控制台侧 `deployStatus` 早就返回 `{source, build, remote, drift}`。

### 2.3 监控告警

**告警规则**：新增 `shared/alert-rules.mjs`（`normalizeRules` / `ruleFor` / `evaluateAlerts`），匹配优先级 **host > categoryId > fallback**。新增 `api/alert-rules.js`（鉴权读写）+ 后台「偏好设置」编辑区。cron 的自动归档用同一套阈值。

**可用性曲线 / 响应时间趋势**：`server/cron.mjs#appendHistoryPoint` 每跑完一轮巡检追加一个点（`ops/health-history.json`，保留 336 个）；新增公开只读 `api/health-history.js`；`AdminInsights` 用 `chartkit#sparkline` 画趋势。

### 2.4 智能自动化

**批量生成描述**：`api/ai.js` 加 `describe` 动作（只依据站名/域名/分类推断，明确禁止编造）；`AdminBatchBar` 加按钮（分批 12 条）。

**分类建议自动应用**：`AdminAi` 加「一键应用复用已有分类」—— 只自动应用 `kind === 'use'`，`new`（新建分类）留给人。

**近似重复检测**：`findNearDuplicates` + `AdminSitesPanel` 的「疑似重复 N 组」面板（只提示，不自动改）。

### 2.5 平台体验

**自然语言运维**：`commands.js` 加 `ops.archiveDown` / `ops.unarchiveAll`（只收**可撤销**动作；删除类不给自然语言入口）；`phraseAliases` 加中文说法。

**暗色核查**：`main.css` 加语义令牌（`--ok-fg/bg/border` 等，`[data-theme="dark"]` 覆盖），批量替换 17 个后台组件里的硬编码色值。

**移动端**：`AdminView` 加 `@media (max-width: 820px)`（搜索框换行、tab 横滚、`:deep(.admin-section)` 收窄 padding）。

**快捷键**：`shared/admin-shortcuts.mjs`（`g` 前缀序列）+ `AdminView` 注册 keydown。

**布局切换**：`AdminView` 加 tab 横排/竖排切换（偏好存本机）。

**全局搜索**：`shared/admin-search.mjs`（`buildAdminIndex` / `searchAdminIndex`，跨模块/设置项/站点/分类）+ `AdminView` 搜索框。

---

## 3. 配置

| 配置 | 位置 | 说明 |
|---|---|---|
| 告警规则 | `alert-rules.json`（服务端库） | 后台「偏好设置」编辑；`{ rules: [{match:{host\|categoryId}, downThreshold}], fallback }` |
| 定时发布 | `tools/console/.data/schedule.json` | `publishEnabled` / `publishAt` / `publishAuto` |
| 断点续传 | `tools/console/.deploy-checkpoint.json` | 发布成功后自动清除 |
| 布局偏好 | `localStorage: nav_admin_layout` | `top` / `side` |
| 自动归档阈值 | 环境变量 `NAV_AUTO_ARCHIVE_FAILS`（默认 5）+ 告警规则表覆盖 | |

---

## 4. 验收

| 项 | 结果 |
|---|---|
| `test-site-dedupe.mjs` | 42 条 |
| `test-health-fails.mjs` | 20 条 |
| `test-deploy-resume.mjs` | 13 条 |
| `test-schedule-publish.mjs` | 17 条 |
| `test-alert-rules.mjs` | 23 条 |
| `test-admin-tools.mjs` | 26 条 |
| 全量 `console:test:all` | **59 个脚本 exit 0**，2149 条断言 |
| 首屏预算 | 610 → 612 KiB（后台模块 grep 0 命中首屏） |

**回归中逮到的问题**（都是只有真跑才发现）：
- `server/cron.mjs` 的 `autoArchiveFailing(health, sites)` 参数名与函数体内 `const sites` 冲突 → SyntaxError（全量回归才暴露）
- 首屏预算因命令面板新增运维命令而超 0.7 KiB

---

## 5. 不做的事

- **布局方案**：用户明确「暂不处理」，保留既有三栏；只加了 tab 排布的横/竖切换
- **删除类动作的自然语言入口**：一句话误触代价太高，仍只在后台面板里
- **正则/向量去重的模糊匹配**：`findNearDuplicates` 用注册域 + 同名，可解释、零依赖
- **告警规则的置信度打分**：LLM 不吐可靠分数，编一个只会误导；`use` / `new` 的区分本身就是规则
