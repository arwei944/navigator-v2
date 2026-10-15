# 插件管理面板

给九个引擎模块一个统一的管理面：看得见各自有哪些 provider、当前生效的是哪个、
为什么某个不可用，并且能就地切换。

---

## 0. 需求与动机

引擎热拔插重构（见 `2026-10-14-engine-hot-swap-design.md`）把散落各处的实现收成了
「注册表 + provider」形态。但重构只解决了**机制**，没解决**可见性**：

- 每个引擎各有一套 `register* / list* / chain`，彼此签名还不一样；
- 想知道「现在翻译走的是哪条链」「图标第三方兜底开没开」「探针为什么没生效」，
  只能逐个读源码或猜；
- 想换一条链，只能改环境变量再重启——而环境变量在哪儿配、叫什么，
  同样得从源码里翻。

所以缺的不是能力，是**一个把这些能力摊开的地方**。

---

## 1. 现状（动手前核实）

| 引擎模块 | 注册表 API | 配置变量 | 单选/链式 |
|---|---|---|---|
| `site-engine` | `listEngines` | `NAV_SITE_ENGINE` | 单选（auto 探活回退） |
| `translate-engine` | `listTranslators` | `NAV_TRANSLATE_ENGINES` | 链式 |
| `llm-engine` | `listLlms` | `NAV_LLM_BACKENDS` | 链式 |
| `image-engine` | `listImageProviders` | `NAV_ICON_PROVIDERS` | 链式 |
| `cover-source` | `listImageProviders({kind:'cover'})` | `NAV_COVER_PROVIDERS` | 链式 |
| `probe-engine` | `listProbes` | `NAV_HEALTH_PROBES` | 链式 |
| `category-source` | `listCategorySources` | `NAV_CATEGORY_SOURCES` | 链式 |
| `site-store` | `listSiteStores` | `NAV_SITE_STORE` | 单选（**锁定**） |
| `publisher` | `listPublishers` | `NAV_PUBLISHER` | 单选 |

**关键发现：清单列不全的风险是隐性的。** 有两个引擎的 provider **不是自注册**的 ——

- 翻译的内建两引擎由 `shared/translate.mjs` 在加载时注册；
- 封面 provider 由 `shared/cover-source.mjs` 注册。

少 import 一个文件，清单就缺项，**而且不报错**。这决定了清单必须集中加载（见 2.1）。

另外，全仓**没有任何接口**聚合这些清单 —— 前端根本看不到引擎状态。

---

## 2. 方案

### 2.1 统一目录层：`shared/plugin-registry.mjs`

只被服务端引用（`api/*.js` 与控制台），不进前端产物。做三件事：

1. **集中加载注册链**（上面那个隐性风险的正解）；
2. **归一形状**：9 组收敛到 `{ providers, current, available }`，每组的 `list*`
   只负责产出 provider 列表，`current` 由本模块统一解析；
3. **配置覆盖层的纯函数**：`sanitizeOverrides` / `applyOverrides` / `currentOverrides`。
   文件读写交给宿主 —— 保持纯函数才能被纯 node 测试覆盖。

`current` 里有两个容易混的字段，刻意都保留：

- `ids` —— **实际生效**的链（已过滤掉不可用的 provider）；
- `configured` —— **配置层面**的选中项（`null` = 默认全量 / `[]` = 关闭 / `[ids]` = 指定）。

面板回显必须用 `configured`：拿 `ids` 反推会把「配了但当前不可用」的项丢掉，
用户一保存就把它删了。

### 2.2 两个落点，两份配置

| | 站点后台（/admin「插件」） | 本地控制台（「插件」） |
|---|---|---|
| 改的是 | **线上那台**的引擎链 | **本机控制台**的引擎链 |
| 配置存 | 站点库 `plugins.json` | 本机 `plugins.local.json`（gitignore） |
| 生效 | 立即 + 重启保留 | 立即 + 重启保留 |

**刻意不共用一份配置。** 本机想用 siteprobe 抓取，不代表线上也该切过去 ——
两者是不同的事实，互相覆盖会造成「我明明没改线上，线上却变了」。

### 2.3 站点存储（`site-store`）锁定只读

`site-store` 是唯一 `writable: false` 的组，界面上不给控件，服务端白名单也拦。
理由：**存储是数据安全单点** —— 一次误设（比如 `NAV_SITE_STORE=fs` 而目录为空）
就会让种子数据覆盖线上真实站点库。换后端应当在 provider 层显式切换，
而不是界面上的一个下拉框。

三层防护都写了：界面不给控件、`WRITABLE_ENVS` 不含它、`sanitizeOverrides` 对它有专门
的拒绝原因文案（「数据安全单点，不允许在面板改写」）。

### 2.4 「回到默认」的表达

- 链式组：**全部勾选可用项 = 清空该变量**（回到默认全量），而不是记一串冗余 id；
- 单选组：选「自动」= 清空该变量。

这样用户不必知道默认值到底是什么。

### 2.5 接口与鉴权

- `GET /api/plugins` → 清单 + 当前覆盖配置；
- `POST /api/plugins` → 清洗 → **先落盘、再应用** → 返回实际应用/被拒的项。

**GET 也要鉴权**（Bearer：会话 token 或 `SITES_ADMIN_KEY`）。插件配置决定
「站点怎么抓、怎么翻、AI 走哪个后端」，是管理动作，与 `/api/ops` 同口径。

顺序刻意是「先落盘再应用」：写库失败就不该改变运行期行为 —— 否则刷新一次就打回原形。

### 2.6 启动时应用

`server/main.mjs` 在 `listen` **之前** `await ensureApplied()`，让第一个请求就带正确配置，
而不是「先按默认跑一会儿」。失败不阻塞启动（读不到配置就按环境变量默认值运行）。

`api/plugins.js` 里每次请求再兜一次底（幂等），覆盖「沙箱每请求新进程」的部署形态。

---

## 3. 配置

无新增必填配置。可选变量即上表 9 项，全部有默认值：

- 未配置 = 默认全量（链式）或 auto（单选）；
- `none` / `off` / `0` = 显式清空该链；
- 非法字符与超长值一律拒绝（值只允许 `[a-z0-9,\-_]`，≤200 字符）。

---

## 4. 验收

| 项 | 证据 |
|---|---|
| 目录层单测 | `test-plugin-registry.mjs` **23 条**（含「注册链加载完整」三条：少了就红） |
| 站内接口 | mock 驱动 handler **10 条**（鉴权 / 白名单 / 非法值 / 清除 / 405 / 400） |
| 真机（站内） | `probe/plugin-panel-verify.mjs` **15 条**：9 卡渲染、控件类型、锁定只读、生效标记 |
| 真机（控制台） | 同探针 **7 条** |
| 真机（写操作） | 同探针 **6 条**：关闭图标链 → 保存 → 接口回读为 `none` → 恢复默认 |
| 全量回归 | `console:test:all` 51 脚本 exit 0 |

真机验证逮到的两个问题（单测看不见）：

1. 「生效中 / 不可用」标记在链式组里跟 provider 的 `available` 是两件事 ——
   不可用的项必须仍可见（用户得知道它为什么没生效），只是勾不上；
2. 站内面板的登录时序：UI 表单登录在无头环境里不稳（点了按钮、提交了表单、
   页面停在原地不报错）。探针改成注入凭据再刷新。

---

## 5. 不做的事

- **不给 `site-store` 开关**（见 2.3）；
- **不做 provider 的重排拖拽** —— 链的顺序目前按注册顺序，够用；
  真要换序，环境变量里的逗号顺序本来就决定链序，面板不必承担拖拽交互；
- **不做「一键恢复出厂」** —— 逐项清除已经能表达，多一个全局按钮多一份误触风险；
- **不在前端渲染引擎详情**（如 siteprobe 的证书链）—— 那是排障出口的职责，
  面板只回答「谁生效、谁不可用、为什么」。
