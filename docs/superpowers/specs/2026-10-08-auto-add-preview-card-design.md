# 搜索栏自动执行添加 + 预览卡片 + 后台开关 — 设计规格

- 日期：2026-10-08
- 需求原文：「我需要自动执行添加动作，默认开启自动执行添加，生成预览卡片，同时在管理后台新增这个功能开关」
- 状态：设计已获用户批准（方案 A）

## 1. 问题与目标

当前流程：在站内搜索框输入一个像网址的词 → 下拉里出现「按此网址自动抓取名称、描述与图标」→ 回车 → 打开 `AddSiteModal` 并预填网址 → 用户确认表单再点「添加」。

目标：

1. 识别到网址后可以**自动执行添加**，跳过弹窗确认环节。
2. 该自动行为**默认开启**。
3. 添加完成后**生成预览卡片**，展示刚入库的站点，并支持撤销 / 编辑 / 访问。
4. 在**管理后台新增一个功能开关**，可关闭该自动行为。

## 2. 现状勘查结论

| 关注点 | 现状 |
| --- | --- |
| 触发点 | `SiteSearchBar.vue` 的 `requestAdd(url)` → `emit('add-site', { url })`（第 195 行） |
| 事件链路 | `MainToolbar.vue` 把 `add-site` 转成 `open-add`；工具栏「+」按钮发 `open-add` 且不带 payload |
| 唯一入口 | `App.vue` 的 `openAddSite(payload)`：设 `addPrefillUrl` 并 `showAddModal = true` |
| 添加弹窗 | `AddSiteModal.vue`，`props.prefillUrl` 有值时挂载即 `fetchMeta()` 自动补全；`submit()` 组装 site 并 `sitesStore.addSite(site)` |
| 元数据接口 | `GET /api/metadata?url=…`，返回 `name/desc/categoryId/color/purposes/faviconUrl/domain/confidence/sources/scope/translated/warning` |
| 站点写入 | `stores/sites.js#addSite(site)`：生成 id 后 push 进 `localAdds`，**无返回值**；`removeLocally(id)` 可移除本地新增（未导出） |
| 编辑复用 | `EditSiteModal.vue` 接受 `:site`，emit `close` / `saved`（由 `CardsContainer.vue`、`AdminSitesPanel.vue` 使用） |
| 偏好存储 | `stores/preferences.js` 用 `versionedPersist('preferences', [...白名单])`，**键名不在白名单则刷新即丢** |
| 管理后台 | `views/AdminView.vue` 为 Tab 式控制台，`TABS` 数组登记 8 个模块；`components/admin/*` 为各面板；无「系统设置」模块，无云端配置字段 |
| 全局提示 | 项目内**没有**通用 Toast 组件 |

**结论**：最小接入点是 `App.vue#openAddSite`，最小写入点是 `sites.js#addSite`，开关的持久化必须同时改 `preferences.js` 的白名单。

## 3. 方案对比

| 方案 | 做法 | 取舍 |
| --- | --- | --- |
| **A（采纳）** | 新建无头「自动添加」管道 + 独立全局预览卡片；`App.vue` 在入口分叉 | 职责清晰，弹窗保持原状，卡片独立可复用 |
| B | 复用 `AddSiteModal`，让它自动填表并自动提交 | 弹窗语义被污染，「跳过弹窗」仍需另一条分支，等于维护两套流程 |
| C | 在 `SiteSearchBar` 内部完成抓取与写入，卡片嵌在下拉里 | 数据写入职责落到检索组件；下拉随焦点消失，卡片寿命不可控 |

## 4. 设计（方案 A）

### 4.1 入口分叉（`src/App.vue`）

`openAddSite(payload)` 改为：

- `payload?.url` 为空（工具栏「+」按钮）→ 维持原样，直接打开弹窗。
- `payload.url` 有值且 `preferencesStore.autoAddOnUrl` 为真 → 先展示预览卡片的 loading 态，调用 `autoAddSite({ url })`。
- 返回 `ok: true` → 预览卡片切到成功态（本流程结束，弹窗不打开）。
- 返回 `ok: false` → 关闭预览卡片，**带提示语**打开 `AddSiteModal` 并预填网址（用户无感降级）。
- 开关为假 → 完全维持现有行为，不做任何新动作。

工具栏「+」按钮永远是弹窗路径，不受开关影响。

### 4.2 无头添加管道（新增 `src/services/autoAdd.js`）

导出 `autoAddSite({ url })`，返回 `{ ok: true, site }` 或 `{ ok: false, reason, message }`。

执行顺序与护栏：

1. `normalizeUrl(url)` 与 `hostOf(url)` 归一化；无法解析 → `reason: 'invalid-url'`。
2. **域名去重**：与 `AddSiteModal#submit()` 同判据（`hostOf(s.url) === domain`，domain 去 `www.` 并小写）；命中 → `reason: 'duplicate'`，`message` 沿用现有文案「该域名已收录：X（url）」。
3. `GET /api/metadata?url=…`，8 秒超时（`AbortController`）；非 200 或异常 → `reason: 'fetch-failed'`。
4. **低置信护栏**：`!meta.name` 或 `meta.confidence?.name === 'low'` → `reason: 'low-confidence'`。
5. 组装 site 并 `sitesStore.addSite()`，返回 `{ ok: true, site }`。

护栏采用最保守口径（用户跳过该项提问，按保守默认）：**抓取失败 / 域名已收录 / 名称为空或低置信一律不自动入库**。分类未识别（`confidence.categoryId === 'low'` 或分类不在本地表中）、描述为推断值**不阻断**，改为在预览卡片上给出提示条，交由用户事后修正。

配套重构（避免规则漂移）：把 `AddSiteModal#submit()` 中「表单 → site 对象」的组装抽到新模块 `src/utils/siteDraft.js`，导出 `buildSiteFromDraft({ form, faviconUrl, faviconHost })`，`AddSiteModal` 与 `autoAdd` 共用。必须原样保留的三条规则：

- `url` 存 `rawDomain`（去协议、去路径），`initial` 取站名首字大写。
- `iconUrl` 仅在 `faviconHost === domain` 时才写入（抓取失败宁可不挂图）。
- `parseAliases()` 的别名归一与 `normalizePurposes()` 的用途归一。

### 4.3 站点 store 两处小改（`src/stores/sites.js`）

- `addSite(site)` 增加返回值：把组装后的对象赋给局部变量，push 后 `return created`。现有调用方忽略返回值，向后兼容。
- 新增 `undoAdd(id)`：仅从 `localAdds` 中 `splice` 并 `delete localEdits[id]`，随后 `rebuild()` + `saveOverlay()`。**不进回收站**（这是撤销误添加，不是删除操作）。同时把 `undoAdd` 加入 store 的 return 列表。

### 4.4 预览卡片（新增 `src/components/AddSitePreviewCard.vue`）

- 挂在 `App.vue` 主壳内（与 `AddSiteModal` 同级）；`Teleport` 到 `body`，居中浮层 + 半透明遮罩，`z-index` 与现有弹窗同级。
- 内部以只读模式复用 `SiteCard`（`:site`、`is-read-only`），保证与首页正式卡片视觉一致。
- 三种状态：
  - `loading`：骨架 + 「正在抓取站点信息…」（抓取期间遮罩不可点，避免重复触发）。
  - `ok`：卡片 + 头部标注「已添加 · 自动执行」+ 提示条（分类未识别时显示「分类未识别，建议核对」）。
  - 失败不渲染卡片（直接回落弹窗）。
- 动作按钮：**撤销**（`undoAdd(id)` + 关闭 + 轻提示「已撤销添加」）、**编辑**（关闭卡片并打开 `EditSiteModal`，`site` 取新建对象）、**访问**（`window.open` + `recordVisit(id)`）、**完成**（直接关闭）。
- 6 秒倒计时自动关闭，鼠标悬停暂停倒计时；`Esc` 关闭。

### 4.5 开关落点

- `src/stores/preferences.js`：新增 `const autoAddOnUrl = ref(true)`、`setAutoAdd(v)` 动作，并在 `versionedPersist('preferences', [...])` 白名单中追加 `'autoAddOnUrl'`。默认值 `true` 即「默认开启」。同时把新状态与动作加进 store 的 return 列表。
- 新增 `src/components/admin/AdminPreferences.vue`：管理后台「偏好设置」面板，首个开关项为「搜索栏识别网址后自动添加」，附一句说明（本机生效、不影响其他设备）与「恢复默认」按钮。
- `src/views/AdminView.vue`：`TABS` 数组插入 `{ id: 'preferences', label: '偏好设置' }`（排在「概览」之后），面板用 `v-else-if="activeTab === 'preferences'"` 懒挂载 `AdminPreferences`，与现有 8 个模块写法一致（保持 `v-if` 链，避免全量挂载）。

### 4.6 边界与明确不做

- 只在搜索栏识别到网址时自动执行；工具栏「+」永远打开弹窗。
- 不新增云端配置字段，不改 `api/*`，不改 `api/sites-data.json` 的站点数据结构。
- 不做批量自动添加、不做多网址排队、不做后台代其他设备开启（开关是本机偏好）。
- 自动添加成功后**不清空**搜索框里已有的输入（沿用现状：`requestAdd` 只关下拉），避免为此新增跨组件协议。
- 预览卡片已经在展示时再次触发自动添加：沿用"后者覆盖前者"，旧卡片直接卸载（撤销只对最后一张有效）。

### 4.7 验证方式

- 新增 `tools/console/test-auto-add.mjs`（沿用 `tools/console/` 现有测试风格与退出码约定），覆盖：网址归一化、域名去重、四条护栏分支（`invalid-url` / `duplicate` / `fetch-failed` / `low-confidence`）、成功路径的字段组装（`url` 去协议、`initial`、`iconUrl` 门槛、aliases、purposes）。
- 手动验证：开关开 → 贴网址回车 → 出卡片 → 撤销后列表消失；开关关 → 回落弹窗；抓取失败域名 → 回落弹窗并带提示。
- `npm run build` 与 `npm run console:test:all` 全绿。

## 5. 受影响文件清单

新增：

- `docs/superpowers/specs/2026-10-08-auto-add-preview-card-design.md`（本文件）
- `src/services/autoAdd.js`
- `src/utils/siteDraft.js`
- `src/components/AddSitePreviewCard.vue`
- `src/components/admin/AdminPreferences.vue`
- `tools/console/test-auto-add.mjs`

修改：

- `src/App.vue`（入口分叉 + 挂载预览卡片）
- `src/components/AddSiteModal.vue`（`submit()` 改用共享组装函数）
- `src/stores/sites.js`（`addSite` 返回值 + `undoAdd`）
- `src/stores/preferences.js`（新开关 + 持久化白名单）
- `src/views/AdminView.vue`（新增「偏好设置」Tab）
