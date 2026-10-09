# Navigator V2 项目交接文档

> 最后更新：2026-10-07
> 线上地址：https://navigator-v2-two.vercel.app
> 仓库本地路径：`c:\work\solo work\new\nav-v2`

---

## 一、项目概述

Navigator V2 是一个现代化的网站导航中心，聚合了 AI 工具、加密货币、基础服务等领域的优质站点。基于 Vue 3 + Vite + Pinia 构建，部署在 Vercel，支持 PWA 离线使用。

**核心数据：**
- 站点总数：301 个
- 分类总数：4 个大类（域）、29 个子分类
- 技术栈：Vue 3 + Vite 5 + Pinia + Vue Router + Tailwind CSS 变量

---

## 二、技术架构

### 2.1 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| 框架 | Vue 3 | ^3.4.0 |
| 构建工具 | Vite | ^5.0.0 |
| 状态管理 | Pinia + pinia-plugin-persistedstate | ^2.1.0 |
| 路由 | Vue Router | ^4.3.0 |
| 搜索 | Fuse.js（模糊搜索 + 拼音） | ^7.5.0 |
| 拼音 | pinyin-pro | ^3.28.2 |
| 拖拽 | vuedraggable | ^4.1.0 |
| 虚拟滚动 | vue-virtual-scroller | ^3.0.4 |
| PWA | vite-plugin-pwa | ^0.17.0 |
| 云端存储 | @vercel/blob | ^2.8.0 |

### 2.2 项目结构

```
nav-v2/
├── api/                        # Vercel Serverless Functions
│   └── sync/                   # 云同步 API
│       ├── upload.js           # 上传站点数据到 Vercel KV
│       ├── download.js         # 从 KV 下载数据
│       ├── merge.js            # 合并云端和本地数据
│       └── key.js              # 密钥管理
├── src/
│   ├── components/             # Vue 组件（巨型组件已拆分，单文件 ≤250 行）
│   │   ├── AddSiteModal.vue       # 添加网站弹窗
│   │   ├── BookmarkImport.vue     # 书签导入导出（壳，拆为 bookmarks/）
│   │   ├── bookmarks/             # 书签子组件
│   │   │   ├── ImportPanel.vue    # 导入面板（拖拽/文件解析/预览）
│   │   │   └── ExportPanel.vue    # 导出面板（JSON / HTML 书签）
│   │   ├── CardsContainer.vue     # 卡片容器（网格/列表/content-visibility 虚拟化）
│   │   ├── command/               # 命令面板子组件
│   │   │   ├── CommandSearchBar.vue  # 搜索输入栏
│   │   │   └── CommandResults.vue    # 分组结果区（页面/分类/站点/操作）
│   │   ├── CommandPalette.vue     # 全局命令面板（Ctrl+K，壳 + 逻辑）
│   │   ├── ConfirmDialog.vue      # 确认对话框
│   │   ├── ContentFeed.vue        # 内容聚合视图
│   │   ├── DigitalClock.vue      # 数字时钟
│   │   ├── EditSiteModal.vue      # 编辑网站弹窗
│   │   ├── GoogleSearchBar.vue   # 搜索引擎栏
│   │   ├── MobileHeader.vue       # 移动端顶部栏
│   │   ├── right/                 # 右侧详情子组件
│   │   │   └── SiteDetailPanel.vue  # 站点详情（统计/时间线/操作按钮）
│   │   ├── RightSidebar.vue       # 右侧站点详情面板（壳 + 折叠/空状态）
│   │   ├── SettingsPanel.vue      # 统一设置面板（壳，拆为 settings/）
│   │   ├── settings/              # 设置子组件
│   │   │   ├── AppearanceSection.vue # 外观（主题模式/配色）
│   │   │   ├── DisplaySection.vue    # 显示/搜索/壁纸
│   │   │   └── SessionSyncSection.vue # 数据管理/会话同步
│   │   ├── ShortcutsPanel.vue     # 快捷键面板
│   │   ├── Sidebar.vue            # 左侧导航栏（可拖拽宽度）
│   │   ├── SiteCard.vue           # 站点卡片
│   │   ├── UnifiedSearchBox.vue   # 统一搜索框（站内检索 + 站外引擎搜索）
│   │   ├── StatsBar.vue           # 顶部状态栏
│   │   ├── ThemePicker.vue        # 主题选择器
│   │   └── TodoPanel.vue         # 待办事项面板
│   ├── router/
│   │   └── index.js             # 路由配置（Home / Category / Admin / 404）
│   ├── services/
│   │   └── sync.js              # 前端同步服务
│   ├── stores/                  # Pinia 状态管理（7 个 store）
│   │   ├── categories.js        # 分类体系（4 大类 22 子分类）
│   │   ├── favorites.js         # 收藏管理
│   │   ├── history.js           # 访问历史（最近 50 条）
│   │   ├── preferences.js       # 偏好设置（主题/引擎/壁纸）
│   │   ├── sidebar.js           # 侧边栏状态（宽度/悬停/折叠）
│   │   ├── sites.js             # 站点数据（核心，210+ 条目）
│   │   └── todos.js             # 待办事项
│   ├── styles/
│   │   └── main.css             # 全局样式 + CSS 变量
│   ├── views/
│   │   ├── HomeView.vue         # 首页
│   │   ├── AdminView.vue        # 管理后台
│   │   └── NotFoundView.vue     # 404 页
│   ├── App.vue                  # 根组件
│   └── main.js                  # 入口
├── docs/                        # 设计文档
├── vercel.json                  # Vercel 配置
├── vite.config.js               # Vite + PWA 配置
└── package.json
```

### 2.3 路由

| 路径 | 组件 | 说明 |
|------|------|------|
| `/` | HomeView | 首页，展示全部站点 |
| `/category/:id` | HomeView | 按分类筛选 |
| `/admin` | AdminView | 管理后台 |
| `/:pathMatch(.*)*` | NotFoundView | 404 |

---

## 三、分类体系

### 3.1 完整分类结构

分类定义在 `src/stores/categories.js` 的 `groups` 数组中。

**AI 学习**（8 个子分类）
- `starter` 入门对话 — dotColor: `#22c55e`
- `prompt` 提示词工程 — dotColor: `#3b82f6`
- `writing` 写作与内容 — dotColor: `#a855f7`
- `coding` 编程与开发 — dotColor: `#f97316`
- `design` 设计与创意 — dotColor: `#ec4899`
- `workflow` 深度工作流 — dotColor: `#06b6d4`
- `learning` 学习与前沿 — dotColor: `#ef4444`
- `aideals` AI 优惠比价 — dotColor: `#ff6a00`

**币圈**（15 个子分类）
- `cex` 交易所 CEX — dotColor: `#f0b90b`
- `dex` 去中心化交易所 DEX — dotColor: `#ff007a`
- `defi` DeFi 借贷/收益 — dotColor: `#00a3ff`
- `data` 数据与研究 — dotColor: `#3861fb`
- `funding` 投融资 — dotColor: `#ff4500`
- `wallet` 钱包 — dotColor: `#8b5cf6`
- `chain` 链上工具 — dotColor: `#3c3c3d`
- `infra` 基础设施 L1/L2 — dotColor: `#06b6d4`
- `nft` NFT 市场 — dotColor: `#ec4899`
- `security` 安全审计 — dotColor: `#ef4444`
- `media` 媒体与研究 — dotColor: `#1a1a2e`
- `staking` 挖矿/节点 — dotColor: `#f97316`
- `stable` 稳定币/RWA — dotColor: `#22c55e`
- `aicrypto` AI + Crypto — dotColor: `#a855f7`
- `airdrop` 空投/Airdrop — dotColor: `#ff6a00`

**工具**（2 个子分类）
- `sms` 短信接码 — dotColor: `#22c55e`
- `aiapi` AI API 平台 — dotColor: `#2563eb`

**基础服务**（3 个子分类）— 本次新增大类
- `cloud` 云服务器/VPS — dotColor: `#3b82f6`
- `domain` 域名服务 — dotColor: `#8b5cf6`
- `proxy` 代理/VPN — dotColor: `#a855f7`

---

## 四、站点数据格式

站点定义在 `src/stores/sites.js` 的 `SEED_SITES` 数组中，每条记录格式：

```javascript
{
  id: 's1',              // 唯一 ID（字符串，按分类前缀编号）
  name: 'ChatGPT',       // 站点名称
  url: 'chat.openai.com', // 域名（不含 https://）
  desc: '描述文字',       // 一句话描述
  categoryId: 'starter', // 所属分类 ID
  color: '#22c55e',      // 图标背景色
  initial: 'C',          // 图标首字母（支持中文）
  purposes: ['ai-chat', 'learning'], // 用途标签（受控词表，可多选，最多 4 个；见 §42）
  sortOrder: 0,          // 排序权重
  visitCount: 0,         // 访问次数
  createdAt: Date.now(),
  updatedAt: Date.now()
}
```

### 4.1 ID 命名规范

按分类使用不同前缀：
- `s1, s2...` — 入门对话
- `p1, p2...` — 提示词工程
- `w1, w2...` — 写作与内容
- `c1, c2...` — 编程与开发
- `d1, d2...` — 设计与创意
- `wf1, wf2...` — 深度工作流
- `l1, l2...` — 学习与前沿
- `al1, al2...` — AI 优惠比价
- `ex1, ex2...` — 交易所 CEX
- `dx1, dx2...` — DEX
- `df1, df2...` — DeFi 借贷/收益
- `dt1, dt2...` — 数据与研究
- `fn1, fn2...` — 投融资
- `wl1, wl2...` — 钱包
- `ch1, ch2...` — 链上工具
- `if1, if2...` — 基础设施
- `nf1, nf2...` — NFT 市场
- `se1, se2...` — 安全审计
- `md1, md2...` — 媒体与研究
- `st1, st2...` — 挖矿/节点
- `sb1, sb2...` — 稳定币/RWA
- `ac1, ac2...` — AI + Crypto
- `ad1, ad2...` — 空投/Airdrop
- `sm1, sm2...` — 短信接码
- `aiapi1, aiapi2...` — AI API 平台
- `bs1, bs2...` — 基础服务

### 4.2 本次会话新增站点

| ID | 名称 | URL | 分类 | sortOrder | 说明 |
|----|------|-----|------|-----------|------|
| `d3` | RunningHub | `runninghub.cn` | design | 38 | AI 视频生成（Seedance）与图像生成（Seedream）平台 |
| `bs1` | 良心云 | `xn--9kqz23b19z.com` | cloud | 200 | 云服务器与 VPS 服务商 |
| `bs2` | Kitty Network | `kitty.fo` | proxy | 201 | 代理节点订阅服务 |
| `bs3` | 三毛机场 | `xn--ehqx35aimmzwv.com` | proxy | 202 | 机场导航站，聚合多家代理节点 |
| `dt15` | Alpha Wallet Finder | `alphawallets.fun` | data | 203 | 多链聪明钱查找工具，按 PNL 排名顶级交易者 |
| `df9` | MöB | `mob.exchange` | defi | 204 | 链上 Prime Brokerage，跨 DEX 统一保证金 |
| `dx11` | Entropy | `entropy.io/trade/io:ANTH` | dex | 205 | Solana 生态去中心化交易所，链上 CLOB 订单簿，支持永续合约、跨链和合成资产交易 |
| `fd9` | Outbid | `outbid.lol` | funding | 180 | 付费竞价推广平台，出价竞争网站排行榜名次获取曝光，适合创业产品冷启动获客 |
| `dt16` | TradingBeats | `www.tradingbeats.xyz` | data | 206 | 链上监控与聪明钱跟踪工具（原名 Hyperinsight），持续监控大额地址持仓与盈利排行 |
| `dx12` | Hyperbot | `www.hyperbot.network` | dex | 207 | Hyperliquid 生态 AI 聚合交易网关，统一接入 perp DEX，集成聪明钱跟踪、一键复制交易与 Telegram 机器人 |
| `aiapi4` | xAPI | `www.xapi.to` | aiapi | 208 | 面向 AI Agent 的通用 API 网关，一次付费调用所有 API（搜索、Twitter、AI 模型、链上数据），也可发布自有 API 按调用分成 |
| `sm9` | 233合集 | `233heji.com/28.html` | sms | 209 | 国内外短信接码平台合集导航，聚合免费/收费接码平台、API、TG 接码频道及避坑黑名单 |
| `sm10` | 闪电接码 | `www.k20.cc` | sms | 210 | 实卡短信接码平台，聚合境内号码，可注册任何 APP/网站，SIM 卡可复接，支持接码、短信代发一体化，失败不扣费 |
| `sm11` | USAPI 美卡接码 | `www.usapi6.com` | sms | 211 | 美卡/美国接码 API 平台，长期供应 TG、WhatsApp、PayPal、亚马逊、抖音等冷热项目接码，号码可复接、可定制号段、支持语音接码 |
| `sm12` | 快客接码 | `www.kuaikejm.com/kk/index.html` | sms | 212 | 实卡短信接码平台，号码可在 7 天内重复使用、到期续费，支持国内与国外号码，接码/短信代发一体化，失败不扣费 |
| `sm13` | haozhuma | `h5.haozhuma.com/index.php` | sms | 213 | 实卡短信接码平台（H5 会员登录入口），支持多项目接码与号码复用服务 |
| `aiapi5` | TeamoRouter | `www.teamorouter.com` | aiapi | 214 | OpenAI 兼容的 AI 模型 API 路由平台，聚合 DeepSeek、GPT 等模型接口，支持一键接入多国智能体工具（含 DeepSeek Harness 集成） |
| `aiapi6` | StepFun | `www.stepfun.com` | aiapi | 215 | 阶跃星辰大模型开放平台，提供 Step 系列语言、语音、多模态/GUI 模型 API（Step 1/2、Step 3.5 Flash 等） |
| `aiapi7` | Agnes AI | `www.agnes-ai.com` | aiapi | 216 | 新加坡 Sapiens AI 全模态大模型 API 平台，同一 Key 与 Base URL 调用文本、图像、视频及多模态理解 |
| `acc1` | 牛牛苹果ID | `www.id10.cn` | account | 217 | 苹果 Apple ID 账号批发/出租商城，全球各地区 ID 现货（双重号、密保号、余额号、小火箭成品号等），量大优惠，支持定制任意地区 |
| `acc2` | 苹果ID批发 | `www.idpifa.net` | account | 218 | 全球苹果 Apple ID 账号批发商城，24 小时极速自动发货，各区域双重号/老号/小火箭成品号，批发 1.5 元起，量大优惠 |
| `aiapi8` | 云码 | `www.jfbym.com` | aiapi | 219 | 专业图像验证码云识别服务，AI 深度学习识别图片验证码（数字/字母/汉字/图像），秒级返回，提供多语言 API 接口与开发者分成 |
| `dx13` | FOMO | `fomo.family` | dex | 220 | 社交优先的加密货币交易应用，memecoin/热门代币秒级多链交易（免 gas），排行榜 + 跟单热门交易者，实时买入提醒，Apple Pay 一键购买，网页与 App 跨端同步 |
| `ac12` | Trader.dev | `trader.dev` | aicrypto | 221 | 面向开发者的 AI 交易平台，通过 MCP 接入 Claude/GPT/Cursor 等 AI，用自然语言描述策略并回测真实数据，可部署到 Bybit/Blofin/Toobit/WeeX，支持限价/预警/急停保护 |
| `bs4` | Clash Plus | `clashplus.io` | proxy | 222 | 完全免费的开源 Clash 内核代理客户端，覆盖 iOS/Android/鸿蒙/Windows/macOS 全平台，支持 SS/VMess/VLESS/Trojan/Hysteria2 等全协议，规则路由、订阅管理、TUN 模式、加密 DNS，零数据收集 |
| `bs5` | 挂梯子 | `guatizi.com` | proxy | 238 | 专业的“梯子”导航站，集中收录顶级机场、老牌机场与新晋机场，可按 Shadowsocks/V2ray/Trojan/Hysteria/多协议/定制客户端等维度筛选，并有简洁的常用/工具/社区/生活/求职导航，适合挑选和对比 VPN 代理机场服务 |
| `bs6` | 一分机场 | `xn--4gqx1hgtfdmt.com` | proxy | 239 | 低价定位的 VPN 代理机场服务，即“一分”强调其亲民的订阅价格，提供机场（代理）服务站点，支持注册、套餐购买与订阅管理 |
| `bs7` | 机场推荐 | `jichangtuijian.uk` | proxy | 240 | 2026 年机场推荐与评测汇总站，长期更新便宜好用的翻墙机场、专线机场（IEPL/IPLC）、各价位套餐与机场优惠券，覆盖扬帆云、优信云、Runway、光年梯、影子机场、山水云、白羊星、闪狐云、全球云等几十家机场评测与折扣码，并附 Clash、Shadowrocket 客户端使用教程，适合挑选对比高性价比机场 |
| `aiapi9` | Venice AI | `venice.ai` | aiapi | 223 | 注重隐私与无审查的聚合 AI 平台，接入 Claude/DeepSeek/OpenAI/Qwen/Kimi 等众多模型，支持文本/图像/视频/音频/代码生成与联网搜索，另有 OpenAI 兼容 API 供智能体接入 |
| `aiapi10` | B.AI | `chat.b.ai` | aiapi | 224 | 孙宇晨团队推出的 Web3 大模型 API 聚合平台，OpenAI 兼容单接口聚合 GPT-5.x/Claude 4.x/Gemini/DeepSeek/MiniMax/Kimi 等顶尖模型，支持钱包登录与加密支付，并为 AI Agent 提供链上经济基础设施 |
| `sm14` | Mail.td | `mail.td/zh` | sms | 225 | 专为收邮件而构建的临时邮箱服务，实时接收、密码保护、只收不发，免费版每封邮件保留 1 小时、Pro 保留 7 天，适合匿名接收验证邮件保护隐私 |
| `aiapi11` | AIHubMix | `aihubmix.com` | aiapi | 226 | Agent 经济的统一 AI API 网关聚合平台，用一套 API 即可接入 DeepSeek/GPT-5 等顶尖模型（含官方/推理/网页多套接口）及各种 API 工具，一次密钥统一调用、按量付费，适合开发者与 AI Agent 接入 |
| `cd10` | MetalForge | `metalforge.xyz` | coding | 227 | 为 SwiftUI 与 React Native 生成 shader 效果的可视化工具，无需写 Metal 代码，调滑块即可预览并导出真实 .metal 文件或 Skia shader，内置 49 种炫丽效果，免费编辑、Pro 导出代码 |
| `cd11` | Pi Packages | `pi.dev/packages` | coding | 236 | Pi 编码智能体的官方包市场，聚合 5000+ 扩展、技能、提示模板与主题，发布到 npm 生态，通过 `pi install` 一键安装；涵盖 MCP 适配器、多模型 Provider、子代理编排、沙箱安全、代码审查等各类插件，适合为 Pi AI 编程助手扩展功能 |
| `ac13` | Minara | `minara.ai` | aicrypto | 228 | AI 原生的加密金融交易操作系统，内置 AI Copilot、策略生成与回测、实时行情/链上数据（巨鲸/代币解锁/聪明钱）、Polymarket 预测、衍生品资金费率与清算监控、DeFi 数据，并支持工作流自动化与价格/地址提醒，帮你随时交易任何资产 |
| `dt17` | Super View | `stock.tanggestock.com` | data | 229 | 全球实时行情与交易数据工作台，聚合加密货币/美股/贵金属实时行情，收录 113 标的、52 内置指标与实时数据流，专业级 K 线工作台支持多周期切换、指标叠加与画图工具，从看盘到复盘的一站式盯盘工具 |
| `aiapi12` | GoRouter | `gorouter.app` | aiapi | 230 | AI 应用基础设施与统一 API 网关，通过标准统一 API 协议接入海量 AI 模型（OpenAI/Claude/Gemini/DeepSeek/Qwen/Llama 等），支持 NewAPI 多协议一键配置、负载均衡、限流、成本追踪与多用户权限管理，开源可自托管，适合团队与开发者统一管理 AI 调用 |
| `sc7` | Hackers Arise | `hackers-arise.com` | security | 231 | 知名黑客与渗透测试在线学习平台（OccupyTheWeb 出品），提供渗透测试、网络攻击与防御、Metasploit、Python 黑客、移动设备黑客、信息收集、网络战争、社会工程等系统的安全教程与付费课程，适合从零入门网络安全与渗透测试的攻防学习 |
| `dt18` | Derivatives Monkey | `www.derivativesmonkey.com` | data | 232 | 领先的加密货币期权分析平台，跨多交易所（Derive/Deribit/Bybit/OKX/Binance/Thalex/Paradex/Aevo/Delta）统一呈现实时期权链、Greeks 希腊值、GEX 做市商 delta 曝险、隐含波动率微笑与期限结构，支持策略回测与对冲模拟，数据均标注交易所与时间戳，免费使用 |
| `g14` | Elera Dashboard | `dribbble.com/shots/27288205-Elera-Healthcare-MedTech-Admin-Dashboard` | design | 233 | 医疗健康管理后台仪表盘 UI 设计稿（Dribbble 作品，Meya Lab Studio 出品）：模块化组件布局与高数据墨水比，实时展示患者占用、入院量、人员配比与临床授权概览，针对医疗高压力场景优化信息可扫读性，适合医疗 SaaS 后台与数据密集型仪表盘的设计参考 |
| `aiapi13` | GMI Cloud | `console.gmicloud.ai` | aiapi | 234 | 自持 GPU（H100/H200/B200）的 AI 推理引擎与模型 API 平台，统一 OpenAI 兼容端点接入 200+ 模型（LLM/视频/图像/音频/3D），支持 Playground 测试、专属 Deploy 端点与 Batch 批量推理，0.1 GPU 粒度弹性分配，按分钟计费，适合企业与开发者快速部署 AI 模型推理服务 |
| `aiapi14` | TokenBom | `tokenbom.com` | aiapi | 235 | 连接 API 提供者与消费者的去中心化 AI 模型调用平台，支持 40+ 主流模型（OpenAI/Anthropic/Google/DeepSeek 等）；用户可将闲置 API Key 放上平台自动赚取积分，也可用积分调用各类模型，密钥加密存储、稳定安全，适合盘活闲置额度或低价调用多模型 |
| `aiapi15` | TinyFish AI | `www.tinyfish.ai` | aiapi | 237 | 面向 AI Agent 的一站式网页能力 API 平台，提供 Search（实时浏览器渲染搜索，永不过期缓存）、Fetch（将任意页面转为干净结构化内容）、Browser（真实浏览器自动化）与 Agents 部署能力，一套 API 覆盖 AI 接入网页所需的全部工具，Search 与 Fetch 永久免费，适合智能体开发者快速接入网页能力 |
| `cd12` | ego (lite) | `lite.ego.app` | coding | 241 | Citro Labs 出品的 AI 代理浏览器，基于 Chromium 让 Claude Code、Codex、Cursor 等代理并行运行 100+ 浏览器自动化任务，免费免配置；可一键继承 Chrome 书签/密码/登录态与扩展，Space 隔离工作区与人类浏览器互不干扰，通过 ego-browser 对外部代理开放快照/点击/填表等网页自动化能力，本地优先存储数据、节省 token |
| `dt19` | OpenTheRank | `opentherank.com` | data | 242 | 数字订阅区域价格对比工具，实时对比 ChatGPT、X、Netflix、YouTube 等 AI/流媒体/游戏订阅在各国（土耳其、印度、埃及等低价区）的 App Store 与 Google Play 价格差异，追踪汇率差并给出最便宜的购买区域，附带低价区账号与支付指南，适合按需订阅前比价省钱 |
| `dt20` | Frontrun | `frontrun.pro` | data | 243 | Crypto Twitter 情报 Chrome 扩展，在推特个人主页查看任意钱包的跟随者画像，覆盖 600 万+ KOL 与鲸鱼标签、智能关注者追踪、钱包 CA 历史，费率 90% 返现，Solana 用户免费，辅助交易者识别聪明钱动向与链上情报 |
| `aiapi16` | Monid | `monid.ai` | aiapi | 244 | AI 智能体工具网关平台，一项技能即可解锁 1800+ 工具与 API，无需逐个注册订阅，智能体按需自动发现并按次付费调用，统一管理智能体所需的各种能力与数据源 |
| `cd13` | Semi Design | `semi.design` | coding | 245 | 由抖音前端与 UED 团队维护的现代化设计系统与 React 组件库，包含 60+ 高质量组件、主题定制、国际化与暗色模式，易于自定义，帮助设计师与开发者打造高质量产品 |
| `sm15` | Sunls Temporary Mail | `sunls.de` | sms | 246 | 匿名临时邮箱服务，无需注册即开即用，支持多域名后缀与自定义邮箱地址，保护个人邮箱免遭垃圾邮件骚扰，适合注册账号、接收一次性验证码等场景 |
| `dt21` | 熊猫寨套利工具管理系统 | `pandazhai.com` | data | 247 | 套利工具集中管理控制台，一个入口管理所有套利节点，可集中查看节点状态、启停套利工具并安全访问各交易界面，账号、会话与节点令牌统一保护，支持微信社区，账号密码+动态验证码登录 |
| `cd14` | Linux Do | `linux.do` | coding | 248 | 中文 Linux 与编程技术社区，基于 Discourse 论坛，涵盖 Linux 使用与运维、编程开发、AI 与智能体、开发工具及资源分享等板块，是开发者交流技术、提问与分享的高质量技术社区 |
| `dt22` | 呱呱助手 · 实时信号 | `www.yss-signal.com` | data | 249 | 呱呱助手实时交易信号与行情工具，提供实时 K 线数据与交易信号推送，辅助交易者跟踪行情、捕捉买卖机会，是面向量化与合约/现货交易的中文实时信号平台 |
| `dt23` | Visa Atlas | `visaatlas.org` | data | 250 | 移民与签证路线智能筛选工具，回答关于职业、担保、定居意向与资金的问题，即可获得按匹配度排序的签证路线推荐列表，并附各路线官方原始来源链接，辅助规划移民路径 |
| `sm16` | 四方接码平台 | `sz-fang.cc` | sms | 251 | 四方接码平台，提供临时手机号与短信验证码接收服务，含网页端控制台、用户端（卡号端）与卡商端客户端下载，支持 API 接入，常用于账号注册、短信验证码接收等场景 |
| `acc3` | 车久 X Premium 代开 | `chejiu888.online` | account | 252 | X Premium 蓝V代开服务平台，支持多种支付方式，提交 X ID 即可快速下单开通 X Premium 订阅，为用户提供便捷的 X 会员代开服务 |
| `bs8` | 极点云 PolarNode | `www.cpolar.com` | cloud | 253 | 极点云 PolarNode 高性能 VPS 云服务器服务商，机器即将上线，官网开放内测预约，前 5,000 名预约用户可获免费 VPS，适合有 VPS 建站、代理、自建节点等需求的用户 |
| `l13` | 书格 | `www.shuge.org` | learning | 254 | 有品格的数字图书馆，专注于公开版权领域的古籍善本、绘画、艺术品等高清数字图书资源，免费开放浏览与下载，让每个人都能自由地看到人类文明 |
| `dt24` | Dubforvet Terminal | `dubforvet.com` | data | 255 | 交易信号终端，提供实时市场数据与交易信号推送，登录后持续跟踪市场行情与信号流动，支持注册与早期访问，辅助交易决策 |
| `acc4` | RON Premium | `ronvip.pages.dev` | account | 256 | X Premium 独立下单与订单管理平台，提供 X Premium 会员代开服务，可独立下单并查询订单状态，方便用户开通 X 蓝V 会员 |
| `cd15` | AICSS | `www.aicss.dev` | coding | 257 | AI 智能体 UI 组件库，提供漂亮且可复制粘贴的 AI 对话界面组件：思考状态、工具调用、流式文本、引用、表格等，支持 React、Vue、Svelte，方便快速构建 AI 应用界面 |
| `l14` | 小山学堂 | `xueai.miyang.cn` | learning | 258 | 洛小山主讲的免费 AI 培训课程平台，覆盖零基础入门到大模型底层原理、Prompt 工程、RAG、Agent 工程、成本优化、AI 产品心理学等，358 个交互知识点，帮助普通用户与 AI 产品经理建立完整认知框架 |
| `sm17` | HeroSMS 接码平台 | `hero-sms.com` | sms | 259 | HeroSMS 接码平台，提供虚拟手机号接收短信验证码，支持 WhatsApp、Telegram、微信、TikTok 等 700+ 平台，覆盖 180+ 国家，即时到码，匿名可靠，常用于账号注册与验证 |
| `aiapi17` | Free AI Tokens | `freetokens.custats.info` | aiapi | 260 | 聚合当前所有可免费认领的 AI 额度与 API Token 优惠清单，如 AMD Radeon Cloud 免费模型 API、Inception Mercury 100M 免费 Token、Groq Cloud 等，逐一标注审核状态、验证等级与注册需求 |
| `acc5` | 116212 社媒营销 | `116212.vip` | account | 261 | 社交媒体营销服务面板（SMM Panel），支持多平台营销服务，提供注册登录与 API 接入，可按需购买各类社交媒体营销套餐 |
| `aiapi18` | Flatkey | `flatkey.ai` | aiapi | 262 | 统一 AI API 网关，一个 Key 路由到 GPT、Claude、Gemini、DeepSeek、Qwen、GLM 等官方 API，聚合 100+ 前沿模型与 1000+ AI 工具，成本更低、接入更省心 |
| `dt25` | X榜单 | `xbangdan.com` | data | 263 | X（推特）中文区数据门户，提供账号榜、推文榜、海外榜、话题榜、长文榜、黑马榜等每日更新榜单，捕捉 X 中文圈流量热点与趋势数据 |
| `dt26` | AI订阅价格雷达 | `airadar.vip` | data | 264 | AI 订阅价格雷达：跨源价格对照，聚合 PriceAI 卡网、CardNav 官方区价、LDXP 货源、GoAIHop 中转套餐等多源 AI 订阅价格，支持原始店铺直采与盯盘提醒 |
| `dt27` | JokkiMon 听风 | `jokkimon.club` | data | 265 | 链上实时监控看板集合：主站提供多套只读实时链上盯盘看板，旗下“听风”聚合全平台风声，消息秒级入耳，助力留在牌桌随时掌握市场动态 |
| `sc8` | Tsecbench | `tsecbench.zc.tencent.com` | security | 266 | 腾讯安全出品的智能攻防 AI 跑分基准平台，提供安全的智能攻防测评基准与排行榜，评估和对比各类 AI 在攻防对抗场景中的能力表现 |
| `aiapi19` | OrcaRouter | `www.orcarouter.ai` | aiapi | 267 | 统一 AI 网关（OpenAI 兼容）：自适应路由、负载均衡、护栏、Agent 防火墙、可观测性与治理，一个网关接入 200+ 模型，适合生产环境集中管理模型调用 |
| `dt28` | BlockHorizon | `blockhorizon.io` | data | 268 | 比特币链上数据分析与周期信号平台，提供地址积累等每日更新的链上指标图表，辅助跟踪链上筹码分布与市场周期信号 |
| `aiapi20` | Kira AI | `kiraai.vn` | aiapi | 269 | Kira AI 人工智能生态平台：提供 AI 聊天、文生图、文生视频、自然语音合成等生成服务，并开放高质量高速 API 与 API Key 管理，支持开发者一键接入 |
| `f11` | Indent | `indent.com` | workflow | 270 | 全公司共享的 AI 同事工作台：人人可教、团队共用，集众人反馈不断进化的团队级 AI 协作助手，辅助团队高效协作与知识沉淀 |
| `cd16` | DESIGN.md | `designmd.ai` | coding | 271 | 为 AI 编码工具打造的设计系统文件库：收录上百个社区制作的 DESIGN.md 文件，供 Cursor、Claude Code 等 AI 编码工具直接读取，快速为 AI 开发搭建设计规范 |
| `nf6` | 集卡 | `card.lengziyu.cn` | nft | 272 | 卡片组合整理与收藏排行工具：帮你整理卡片组合、收藏与管理排行，适合爱好者收集、归类与查看各类卡片图鉴 |
| `dt29` | FlyWire | `flywire.ai` | data | 273 | 果蝇大脑全脑连接组图谱（Connectome）科研项目：AI 分割与专家校对重建成年雌性果蝇大脑，140K 神经元、5000 万+ 突触（含神经递质信息）、10 万+ 注释，提供 Codex 数据探索工具，开放神经科学数据集与研究社区 |
| `dt30` | livabble | `livabble.com` | data | 274 | 数字游民宜居城市指南（中文站）：发现适合华人数字游民的全球宜居城市，对比全球生活成本、签证政策、社区信息与教育资源，提供自由工作生活攻略 |
| `pj1` | 双盲K线训练器 | `kking2020.com/trainer` | projects | 275 | 双盲 K 线训练器：随机抽取一段真实加密货币历史行情，屏蔽标的、日期与价格轴，训练盘面判断、下单计划与执行纪律；免费免注册，训练记录仅存本地浏览器 |
| `ac14` | TradingKit | `tradingkit.com` | aicrypto | 276 | AI 驱动的交易工具聚合站（DaviddTech 出品）：Trader.dev 策略回测、PropFirm AI 应对自营资金挑战、Strategy Factory 复制成熟策略，一站式 AI 交易工具箱 |
| `ac15` | TapeOut 生态导航 | `tapeout.link` | aicrypto | 280 | TapeOut 生态导航（中英双语）：把链上硬件/TapeOut 协议里值得一看的官方入口、链上数据、交易市场、教程解读与电路链游收在一处，点开即用，快速进入 vsl 生态 |
| `s12` | Assistant Benchmark | `assistantbenchmark.com` | starter | 277 | AI 助手公开评测榜：按 15 个统一维度为可发短信的各大 AI 助手打分，每一项都附真实公开引用来源，帮你对比优选出最适合的助手 |
| `dt31` | Traderax 资金费率 | `io.traderax.net/monitor/funding` | data | 278 | Traderax 资金费率多所聚合监控：实时汇总 Binance、Bybit、OKX 等各主流交易所永续合约资金费率，支持按交易所/币种筛选对比，捕捉费率套利与持仓转向信号 |
| `dx14` | Hyperdash | `hyperdash.com` | dex | 279 | Hyperliquid 高级交易终端与分析平台：地址级实时盈亏、持仓追踪（copy trading）、成交与仓位分析，深度看板帮你在 Hyperliquid 上发现并跟随顶级交易员 |

---

## 五、核心功能

### 5.1 站点管理
- 添加站点：点击"添加网站"按钮或右键卡片编辑
- 编辑/删除：右键卡片弹出菜单，删除进回收站可恢复
- 批量操作：批量选择模式，支持批量删除
- 拖拽排序：卡片支持拖拽调整顺序
- 访问统计：点击访问自动记录 `visitCount`

### 5.2 搜索
- 站点搜索：支持名称、描述、URL、拼音（全拼 + 首字母）模糊搜索
- 搜索引擎：集成 Google/Bing/百度/DuckDuckGo/Perplexity 切换

### 5.3 界面与交互
- 双视图：网格视图 / 列表视图切换
- 主题系统：4 套预设（默认蓝/极客绿/赛博紫/日落橙）+ 明暗模式
- 壁纸：支持自定义背景图 + 模糊效果
- 侧边栏：左侧可拖拽调节宽度（160px - 400px），右侧站点详情面板
- 命令面板：Ctrl+K 快速搜索和导航
- PWA：可安装为桌面/移动应用，支持离线使用

### 5.4 云数据（站点热更新）
- （2026-09-21 移除失效的 Vercel KV 同步，下为当前正确架构）
- 运行时站点数据唯一来源：**Vercel Blob**（`sites.json`），前端每 30s 轮询 `/api/sites`（`Cache-Control: no-store`）实现热更新
- 写入入口：`scripts/publish.mjs`（发布）或管理后台「发布到云端」，POST 到 `/api/sites`（`SITES_ADMIN_KEY` 鉴权）
- 本地 `api/sites-data.json` 作为 Blob 空的 SEED 兜底与发布源，由 publish 保持同步

### 5.5 数据持久化
使用 `pinia-plugin-persistedstate`，以下 store 开启了持久化：
- `preferences`：主题、引擎、壁纸
- `sidebar`：宽度、折叠状态
- `favorites`：收藏列表
- `history`：访问记录
- `todos`：待办事项

---

## 六、主题系统

主题定义在 `src/stores/preferences.js` 的 `THEME_PRESETS` 对象中：

| ID | 名称 | 主色 | 侧边栏色 | 适用场景 |
|----|------|------|----------|---------|
| `default` | 默认蓝 | `#2563eb` | `#0f172a` | 通用 |
| `green` | 极客绿 | `#10b981` | `#064e3b` | 技术向 |
| `purple` | 赛博紫 | `#8b5cf6` | `#2e1065` | 创意向 |
| `orange` | 日落橙 | `#f59e0b` | `#431407` | 暖色调 |

每个预设包含 light 和 dark 两套色值，通过 CSS 变量动态注入 `:root`。

---

## 七、部署流程

### 7.1 前置条件
- Node.js 24+
- Vercel CLI（`npm i -g vercel` 或使用 `npx`）
- Vercel 项目已关联，项目名 `navigator-v2`

### 7.2 本地开发

```bash
cd nav-v2
npm install
npm run dev
```

### 7.3 构建部署

```bash
# 一键构建 + 部署（package.json 中的 deploy 脚本）
npm run deploy

# 或手动构建后用 npx 部署
npx vercel deploy --prod --yes
```

### 7.4 Vercel 配置

`vercel.json` 配置要点：
- `buildCommand`: `npm run build`
- `outputDirectory`: `dist`
- 路由：SPA fallback 到 `index.html`，`/api/*` 走 Serverless Functions

### 7.5 Vercel Blob 配置（热更新存储）
站点数据热更新依赖 Vercel Blob，需在 Vercel 项目设置中配置：
1. 创建 Blob Store（CLI：`vercel blob create-store nav-sites --access private --yes`）
2. 设置环境变量 `BLOB_READ_WRITE_TOKEN`（Production）
3. 设置环境变量 `SITES_ADMIN_KEY`（Production，管理后台发布用密钥）

### 7.6 热更新机制
- 前端启动时拉取 `/api/sites` 云端数据，之后每 30 秒轮询一次
- 管理后台（AdminView）可输入 `SITES_ADMIN_KEY` 将本地站点数据发布到云端
- 发布后所有已打开页面在 30 秒内自动更新，无需刷新、无需重新部署
- 代码更新通过 PWA 自动更新（`registerType: 'autoUpdate'`）在部署后自动刷新
- 本地访问统计（visitCount）在热更新时保留，不会被云端数据覆盖

---

## 八、新增站点操作指南

### 8.1 添加一个新站点

1. 打开 `src/stores/sites.js`
2. 找到对应分类的 `// ── 分类名 ──` 注释区块
3. 在区块末尾追加新条目：

```javascript
{ id: 'bs4', name: '新站点名', url: 'example.com', desc: '一句话描述，突出核心功能。', categoryId: 'cloud', color: '#3b82f6', initial: '新', sortOrder: 205, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
```

4. 确保 `id` 唯一，`sortOrder` 递增
5. 部署：`npx vercel deploy --prod --yes`

### 8.2 添加新分类

1. 在 `src/stores/categories.js` 对应大类的 `categories` 数组中添加：
```javascript
{ id: 'newcat', label: '新分类名', dotColor: '#3b82f6' }
```

2. 在 `src/stores/sites.js` 添加对应站点，`categoryId` 设为新分类 ID
3. 部署

### 8.3 添加新大类

在 `categories.js` 的 `groups` 数组中追加：
```javascript
{
  id: 'newgroup',
  label: '新大类',
  collapsed: false,
  categories: [
    { id: 'subcat1', label: '子分类1', dotColor: '#3b82f6' }
  ]
}
```

---

## 九、已知问题与注意事项

1. **sortOrder 冲突**：部分历史数据存在 sortOrder 重复（如 `sm6/sm7` 都是 198），不影响功能但排序可能不稳定
2. **构建体积警告**：主 chunk 超过 500KB（约 633KB gzip 285KB），Vite 会发出警告，可考虑代码分割优化
3. **PWA 图标缺失**：`vite.config.js` 引用了 `pwa-192x192.png` 和 `pwa-512x512.png`，但 `public/` 目录下只有 `favicon.svg`，PWA 图标可能缺失
4. **中文域名**：`xn--9kqz23b19z.com`（良心云）和 `xn--ehqx35aimmzwv.com`（三毛机场）是 Punycode 编码的中文域名，访问时浏览器会自动解码

---

## 十、后续可优化方向

- 代码分割：将 AdminView 等路由级组件动态导入，减小主 chunk
- 站点健康检查：定期检测失效链接（现有 favicon 抓取已迁移至 `scripts/fetch-favicons.mjs`，见「十二、真实网站图标」）
- 排序权重去重：清理重复的 sortOrder 值
- PWA 图标补充：生成 192px 和 512px 的 PNG 图标
- 移动端优化：进一步适配小屏幕交互

---

## 十一、关键文件速查

| 需求 | 文件 |
|------|------|
| 新增/修改站点 | `src/stores/sites.js` → `SEED_SITES` 数组 |
| 新增/修改分类 | `src/stores/categories.js` → `groups` 数组 |
| 修改主题配色 | `src/stores/preferences.js` → `THEME_PRESETS` |
| 全局样式变量 | `src/styles/main.css` |
| Vercel 部署配置 | `vercel.json` |
| Vite/PWA 配置 | `vite.config.js` |
| 云同步 API | `api/sync/` 目录 |
| 路由配置 | `src/router/index.js` |
| 根组件布局 | `src/App.vue` |

---

## 十二、真实网站图标（favicon）

> 2026-09-14 上线：288 个站点中 285 个使用真实网站 favicon，3 个失败自动回退首字母。

### 12.1 实现方式

- **抓取脚本**：`scripts/fetch-favicons.mjs` 批量抓取全部站点图标，支持并发（默认 6）与 LIMIT 参数
- **多级回退**：页面 HTML icon link → `/favicon.ico` → `favicon.im`（Google s2 不可达已弃用）
- **存储**：图标文件保存至 `public/icons/{siteId}.{ext}`（png/ico/svg/webp 等原始格式）
- **数据字段**：`api/sites-data.json` 每个站点新增 `icon` 字段（如 `"icon": "icons/p1.png"`）
- **前端显示**：所有图标组件采用"底层首字母色块 + 上层 img 覆盖"结构，图片加载失败自动移除并回退首字母

### 12.2 已知限制

- 3 个站点图标抓取失败（所有来源不可达），前端回退首字母：
  - `dt12` arkhamintelligence.com
  - `ac8` aix.bot
  - `ad5` airdropking.io
- 新增站点后需运行 `node scripts/fetch-favicons.mjs` 补抓图标，再重新构建部署

### 12.3 Vercel 路由（重要）

`vercel.json` 的 routes 必须包含 `/icons/(.*)` 规则，否则 `/icons/` 静态资源会被 SPA fallback 捕获并返回 index.html：

```json
{ "src": "/icons/(.*)", "dest": "/icons/$1" }
```

### 12.4 验证命令

```bash
node -e "const d=require('./api/sites-data.json'); console.log(d.length, d.filter(s=>s.icon).length)"
```

---

## 十三、自动化与体验优化（2026-09-14）

### 13.1 一键发布

`node scripts/publish.mjs`（或 `npm run publish`）一条命令完成：**备份 → 构建 → 部署 → 热更新数据 → 轮询验证**。

- 发布前自动备份 `api/sites-data.json` 到 `backups/sites-data-{时间戳}.json`
- 自动提醒缺失 favicon 的站点（可运行 `npm run icons` 补抓）
- 参数：`--skip-build` 跳过本地构建、`--key xxx` 覆盖管理密钥
- 发布数据默认使用内置管理密钥，也可用环境变量 `SITES_ADMIN_KEY` 覆盖
- **保存即部署（2026-10-09）**：`npm run watch:deploy`（`scripts/watch-deploy.mjs`）常驻监听
  `src/ shared/ api/ public/` 与 `index.html / vite.config.js / vercel.json / package.json`，
  停止编辑 8s 后自动发布。**按变更类型分流**——只有代码变 → 构建 + `vercel deploy --prod`（不碰云端数据）；
  `api/sites-data.json` 变了 → 走 `publish --skip-build`（复用备份 / 校验 / 快照 / 热更新 / 收敛验证）。
  连续保存攒批、部署重叠排队、失败保留标记下次重试。参数 `--debounce=ms` / `--no-data` / `--dry-run`。
  详见 `docs/superpowers/specs/2026-10-09-watch-deploy-design.md`。

### 13.2 站点健康检查

`node scripts/check-sites.mjs`（或 `npm run check`）批量检测站点可访问性：

- 并发 12、超时 15s（可调），HEAD 优先、失败回退 GET
- 输出正常/异常统计与异常站点清单（含状态码）
- 参数：`--limit N` 限量测试、`--timeout 秒`、`--only-bad` 只输出异常、`--report` 生成 markdown 报告
- `npm run check:report` 一键生成 `backups/check-report-{时间}.md`（区分"需处理"与"可忽略"）
- 异常分级：429/405/403/401 视为"可忽略"（多为反爬/WAF 拦截，站点实际可用）；`ERR`/404/402/410 视为"需处理"
- 已知误报：`kaggle.com`、`yiyan.baidu.com`、`stepfun.com`、`theblockbeats.info`、`sz-fang.cc`、`blur.io`、`learnprompting.com` 等对公网可访问，check 脚本因本机无代理+WAF 拦截误报 ERR/404，**删除站点前务必用 metadata API 或浏览器二次复核**

### 13.3 添加站点自动抓取

- 新增 Serverless API `/api/metadata?url=xxx`：代理抓取页面标题/描述/favicon，支持 gbk 中文站、截断读取（256KB）、8s 超时
- `AddSiteModal` 输入 URL 后自动抓取并填充名称/描述/图标预览，并按关键词自动推荐分类（dex/cex/defi/data/aiapi 等 15 组映射）
- 添加站点从"填 6 个字段"缩减为"输入 URL + 确认分类"

### 13.4 前端操作路径优化

| 优化点 | 说明 |
|--------|------|
| 卡片右键菜单增强 | 新增「收藏/取消收藏」「新窗口打开」（原有复制链接/编辑/删除） |
| 搜索键盘导航 | ↑/↓ 选择建议项，回车直达选中项（未选择时直达第一个结果） |
| 管理后台密钥记忆 | 发布密钥保存在 localStorage，下次自动填充，可一键清除 |

### 13.5 package.json 便捷命令

```bash
npm run publish      # 一键发布（备份+构建+部署+热更新+验证）
npm run check        # 站点健康检查
npm run check:report # 健康检查并生成 markdown 报告
npm run icons        # 抓取/补抓 favicon
```

### 13.6 favicon 全量补全（2026-09-20）

- 此前有 3 个站点（`dt12` arkhamintelligence、`ac8` aix.bot、`ad5` airdropking）无图标
- 本次重试：`dt12` 通过脚本重跑补上；`ac8`/`ad5` 因首页反爬，改用直接请求 `favicon.im` 下载ico/png 写入 `public/icons/`
- **现在 292/292 站点全部带真实 favicon，无首字母回退**
- 经验：`fetch-favicons.mjs` 对个别反爬站首页失败时，可手动 `curl favicon.im/{domain}?format=png&size=128` 兜底

### 13.7 站点核实与域名迁移（2026-09-20）

针对健康检查报告中的存疑站点，用 Explore 权威来源逐站核实，结论与动作：

| 站点 | ID | 核实结论 | 动作 |
|------|----|---------|------|
| Learn Prompting | p1 | **已迁移** .com→.org，媒体持续运营（月活33万） | URL 更新为 `learnprompting.org` |
| 吴说区块链 | md5 | **已迁移** .com 挂售，新域 `wublockchain.xyz` 活跃 | URL 更新为 `wublockchain.xyz` |
| 极点云 PolarNode | bs8 | 原 `polarnode.vip` 失效，真官网为 `cpolar.com`（内网穿透站） | URL 更新为 `www.cpolar.com` |
| 疾驰短信 | sm2 | 公网可访问，误报 | 保留 |
| 四方接码 | sm16 | 公网可访问，误报 | 保留 |
| Xtemporary | sm3 | 已失效（域名打不开、无运营证据） | **按用户指示暂不删除**，记录待后续确认 |

数据已更新，favicon 已随新域重抓（p1/png、md5/svg、bs8/png）。新域名均经 metadata API 二次验证真实可用。

### 13.8 侧边栏"最近"栏目重定义（2026-09-21）

- **问题**：侧边栏"最近"原为"最近访问"（基于 history 记录），只有点击访问过的站才显示，导致新收录站点在"最近"中不出现
- **修复**：`CardsContainer.vue` 的 `recent` 分支改为**"最近添加"**——按 `createdAt` 倒序取最新 24 个站点
- 空态文案由"还没有访问记录"改为"还没有收录的站点"
- 数据面验证：293 站点全部带 `createdAt`，顶层 8 个即最近收录（ac15/dx14/dt31/...），符合预期
- 说明：`history.js` 的 `getRecentSites` 已无调用方（保留为纯函数未删除）；真正"最近访问"仍存在于"内容聚合/feed"的独立区块，未受影响

### 13.9 P0 架构升级批次（2026-09-21，Nav V3）

按 [NAV-v3-upgrade-plan.md](docs/NAV-v3-upgrade-plan.md) 的 P0 批次完成架构止血：

**P0-1 移除失效 KV 同步**
- 删除 `api/sync/*`（key/merge/upload/download）与 `src/services/sync.js`
- `BookmarkImport.vue` 移除"云同步" Tab，仅保留"导入/导出"
- 线上 `/api/sync/*` 已确认 404，构建产物无 sync 残留

**P0-2 统一数据真相源**
- 明确 Vercel Blob `sites.json` 为运行时唯一来源，`api/sites.js` 补充架构注释
- 单一写入入口（publish / admin POST），`sites-data.json` 仅作 SEED

**P0-3 强化 metadata 代理**（`api/metadata.js`）
- 优先 apple-touch-icon/mask-icon，其次 icon，最后 favicon.ico
- 多编码回退：utf-8 → gbk → gb18030 → big5 → latin1（含 charset 声明识别）
- 实测 GitHub 正确返回高清 SVG 图标

**P0-4 发布门禁校验**
- 新增 `scripts/validate-data.mjs`：校验 id 唯一/必填字段/createdAt/sortOrder 等，附 `npm run validate`
- `publish.mjs` 步骤 1b 接入门禁，校验失败即中止（用 execFileSync 修复含空格路径问题）

**P0-5 密钥安全**
- `publish.mjs` 移除硬编码回退 key，仅从 `.env.local`/环境变量/`--key=` 读取，缺失即报错中止
- 新增 `.env.example` 文档化环境变量

**P0-6 基线整理**
- README 全面校正（去掉失效 KV、对齐 Blob 架构/命令/目录/LICENSE）
- `.gitignore` 补充 `backups/`、`tmp-payload.json`、`.env.example` 特例
- `package.json` 升级至 `3.0.0`，新增 `validate` 脚本
- git 建立 V3 基线提交 `c642eac`

**验证**：发布成功 v85（293 站点 / 293 图标 / 数据校验通过 / 轮询一次收敛）；浏览器确认书签面板云端 Tab 移除（PWA 旧缓存需刷新后消失）

**P1-1 站点实时在线状态角标**（2026-09-21）
- 新增 `src/stores/health.js`：按需探活（仅探测传入的可见卡片），60s 缓存 + 6 路并发信号量
- 状态分级 `ok/limited/down/unknown`（2xx/3xx 在线；429/403/405/401 限流；ERR/404/402/410 失效），口径与 `scripts/check-sites.mjs` 一致
- `SiteCard.vue` 卡片图标右下角新增 `.health-dot` 圆点角标（绿/黄/红/灰）
- 前端直接 HEAD/GET 探测目标域名，不经过本站 Serverless，避免触发自身限流

**P1-3 云端会话级同步**（2026-09-21）
- 新增 `api/session.js`：基于 Vercel Blob（`session/<key>.json`）读写个人会话数据，以 session key 为隔离凭证（**不下发管理密钥到浏览器**），字段级合并 + 版本递增
- 新增 `src/services/session.js`：key 存取（localStorage `nav-session-key`）、快照收集/应用、`fetchSession`/`pushSession`
- 涉及 store 补齐原始合并方法：`favorites.add`、`todos.addRaw`、`history.addRawRecord`
- `SettingsPanel.vue`「数据管理」新增云端会话同步 UI：密钥输入 + 生成密钥 + 上传到云端 + 从云端下载 + 状态提示
- ⚠️ `api/session.js` POST 已移除 `adminKey` 校验，改为纯 key 隔离（个人导航站可接受；密钥越长越安全）

**验证**：发布 v86（293 站点 / 校验门禁通过 / 热更新 / 轮询一次收敛）；浏览器实测健康角标颜色分布正常、会话同步生成密钥→上传→下载全流程通过、Console 无 JS 运行时错误

**P1-2 智能推荐发现**（2026-09-21）
- `ContentFeed.vue`「推荐发现」由随机洗牌改为基于访问历史 + 分类共现：未访问且未收藏的站点作候选，按与近期访问站点的同分类权重（时间近者权高）加权，热度作次级信号
- 访问历史为空时退化为热度（visitCount 降序）未收藏站点兜底

**P1-4 实时热更新即时可见**（2026-09-21）
- `App.vue` 新增 `visibilitychange` 监听：标签页回到前台立即 `pollCloudSites()`，发布后切回页面无需等满 30s 即可见

**P1-5 管理后台数据洞察**（2026-09-21）
- `AdminView.vue` 新增「数据洞察」区块：分类分布横向条形图（按站点数降序）、热度 TOP10、失效站点清单
- 进入后台即 `healthStore.probeSites(全部)` 全量探测，顶栏显示探测进度；失效清单无内容时显示"暂未发现失效站点"
- 清单带"删除前用浏览器复核，谨防 WAF/限流误判"提示（沿用 check-sites.mjs 的 false-ERR 经验）
- AdminView 为懒加载路由，洞察代码在其独立 chunk

**验证**：发布 v87（293 站点 / 校验门禁通过 / 热更新；轮询读到 v86 属 Blob 读一致性短暂延迟，站点数据未变、无影响）。浏览器实测：feed 视图「推荐发现」正常显示推荐站点（历史为空退化热度兜底：Claude/DeepSeek/Kimi 等）；Console 无运行时错误（仅健康探测 net::ERR_FAILED 属正常噪音）；`/admin` 返回 200 且 AdminView chunk 含全部洞察代码。
⚠️ 技术说明：/admin 为客户端路由，需经命令面板 Ctrl+K→管理后台 或 SPA 内部跳转进入；直接地址栏访问依赖 vercel.json 的 `/(.*) → /index.html` 兜底（已验证 200）。

**旧数据清理：sortOrder 去重**（2026-09-21）
- 现象：`npm run validate` 持续报 10 处 `sortOrder` 重复（18、137、143-146、148、151×3、180、198×3）
- 根因：前端 `sites.js#addSite` 用 `sortOrder = sites.value.length` 生成，配合既有排序值/删除重排会导致碰撞；且前端渲染用**数组顺序**而非 sortOrder，故重复仅存在于元数据
- 处理：新增 `scripts/fix-sortorder.mjs` 一次性脚本——执行前自动备份到 `backups/sites-data-sortorder-{ts}.json`，按数组顺序把 sortOrder 重排为 1..N 连续序列
- 验证：本地校验 **0 警告**；发布 v88 热更 + 轮询一次收敛；云端校验 `sortOrder_dups=0`、`array_order_unchanged=True`（站点展示顺序与修复前逐位完全一致，零扰动）
- 备注：若日后继续用 addSite 新增站点仍可能再产生重复，可重跑 `npm` 对应的 `node scripts/fix-sortorder.mjs` 一键清理

---

## 十四、P2 体验工程批次（2026-09-21，Nav V3）

按 [NAV-v3-upgrade-plan.md](docs/NAV-v3-upgrade-plan.md) 的 P2 批次完成体验工程：

### 14.1 P2-1 巨型组件拆分（验收：单文件 ≤250 行）

四个巨型组件拆为"壳 + 业务子组件"，逻辑归一、（部分）样式随子组件下沉：

| 组件 | 原行数 | 主文件 | 拆出子组件 |
|------|--------|--------|-----------|
| `SettingsPanel` | 683 | ~105 | `settings/AppearanceSection`、`settings/DisplaySection`、`settings/SessionSyncSection` |
| `CommandPalette` | 518 | 163 | `command/CommandSearchBar`（输入栏）、`command/CommandResults`（分组结果区） |
| `RightSidebar` | 556 | 50 | `right/SiteDetailPanel`（统计/时间线/操作按钮） |
| `BookmarkImport` | 530 | 49 | `bookmarks/ImportPanel`、`bookmarks/ExportPanel`，解析/导出逻辑抽到 `utils/bookmarks.js` |

- **CommandPalette**：Shell 保留可见性/键盘导航/过滤/执行逻辑；`CommandResults` 接收 `groups`（含 label/type/items）+ `getIndex` 函数，用 `emit('select'/'hover')` 回传；`getIndex` 由壳注入保证全局索引一致
- **RightSidebar**：主件只留折叠按钮 + 空状态；`SiteDetailPanel` 通过 `site` prop 接收悬停站点，自行引 stores 计算统计/点赞/访问记录
- **BookmarkImport**：解析（JSON/HTML/去重）与导出模板（JSON/Netscape 书签）下沉到 `utils/bookmarks.js` 纯函数，便于单测
- 验证：`npm run build` 通过；发布 v89（293 站点 / 293 图标 / 校验门禁通过 / 热更新 / 轮询一次收敛）；浏览器实测命令面板 Ctrl+K 搜索/ESC 正常、右侧详情字段完整、收藏按钮切换正常、Console 无运行时错误

### 14.2 P2-2 卡片虚拟化（content-visibility）

- 未引入重型虚拟滚动库，改用 CSS `content-visibility: auto` + `contain-intrinsic-size`：离屏卡片跳过布局/绘制，站点增多滚动依旧流畅
- `CardsContainer.vue`：网格 `.card` 预设 `auto 200px`、列表 `.card` 预设 `auto 64px`；保留语义化访问结构，非用户不可见
- **压测**：新增 `npm run perf`（`scripts/perf-scroll.mjs`）生成 `perf-report/scroll-bench.html`（默认 1000 张较复杂卡片，可 `--count N`），浏览器实测 ON 平均 ~60fps、OFF 跌至 ~49fps（最低 ~43fps），差距 ~11fps，达标"1000 站点 60fps"目标（实测 v89）

### 14.3 P2-3 敏感信息与鉴权强化

- `/api/sites` POST 鉴权由"请求体 `key` 明文"改为 **`Authorization: Bearer <token>` 请求头**
- 同步更新三处调用方：`scripts/publish.mjs`（curl `-H "Authorization: Bearer $key"`）、`AdminView.vue`（管理后台发布）、`CommandPalette` 无涉及
- `publish.mjs` 支持 `--key=` 显式传（读 `.env.local`/环境变量优先），缺失即中止
- **CLI 参数解析改造**：`publish.mjs`、`check-sites.mjs` 弃用手写 `args.includes/find`，统一改用 **Node 内置 `parseArgs`**，支持短参数别名
  - `publish.mjs`：`--skip-build`、`-k/--key`、`-w/--webhook`
  - `check-sites.mjs`：`-l/--limit`、`-t/--timeout`、`--only-bad`、`--report`
- **webhook 可选通知**：`publish.mjs -w <url>` 或管理后台「发布到云端」上方的 webhook URL 输入框（localStorage 记住），发布成功后向该 URL `POST` 通知 `{ event, version, count, time }`；通知失败不影响发布结果（静默忽略）

### 14.4 P2-4 本地数据版本化与迁移

- 新增 `src/utils/storeVersioning.js`：`STORE_VERSION` 常量 + `versionedPersist`/`encodeStored`/`decodeStored`，storage 读写附加 schema 版本号，支持迁移函数表（`MIGRATIONS` 按 key 注册）
- 接入 stores：`sidebar`/`preferences` 用 `versionedPersist`；`todos`/`favorites`/`history` 用 `encode/decodeStored`
- 效果：未来 localStorage 结构变更可平滑迁移，降级逻辑兜底避免解析失败丢数据

### 14.5 P2-5 桌面端自适应打磨 + README/HANDOVER 知识库化

- **桌面端自适应**：现有响应式断点已较完整——`CardsContainer` 网格列数随宽度自适应（`≥1440px→4列`、`≤1024px→2列`、`≤768px→1列`），侧边栏可折叠至 60px、移动端顶栏（`MobileHeader`）+ 遮罩抽屉模式；本次仅核对断点与桌面缩放表现，未做过度改动，补充文档说明即可
- `README.md` 补：架构图（PWA ↔ Serverless ↔ Blob）、常用命令与发布参数（`-k/--key`、`-w/--webhook`、`npm run perf`）、环境变量表、智能能力/会话同步/卡片虚拟化特性、响应式断点说明
- `HANDOVER.md` 项目结构更新为拆分后的子目录形态（`command/`、`settings/`、`bookmarks/`、`right/`），补齐 P1/P2 批次记录

### 14.6 P2 验证汇总

- 发布 **v89** 一次成功：部署完成 + 云端热更新 293 站点 / 293 图标 / 校验通过 / 轮询一次收敛到 `version=89`
- 浏览器实测：主界面正常无报错；`Ctrl+K` 命令面板搜索与关闭正常；右侧详情面板字段完整 + 收藏/复制交互正常
- 卡片虚拟化压测：1000 卡片 ON ~60fps / OFF ~49fps，达标"1000 站点 60fps"（`npm run perf`）
- CLI 参数：`publish.mjs --skip-build / -k / -w`、`check-sites.mjs -l/-t/--only-bad/--report` 均用 Node `parseArgs` 解析生效

## 十五、站点收录：bestjev（2026-09-22）

新增站点 `pj2`（projects 项目参考分类，前缀 `pj`）：

| 字段 | 值 |
|------|----|
| id | `pj2` |
| name | bestjev |
| url | `jevbest.com`（根域名，未收 `/zh/projects/jev-like-models/` 子页） |
| desc | 精选 640 个 Jev/TypeSafe AI 开源项目（SDK、Agent、集成、应用、基准），多语言浏览 + GitHub Star 对比，聚合 Jev 生态 |
| categoryId | `projects`（项目参考） |
| color | `#0d9488` |
| sortOrder | 294（全局递增，追加到数组末尾） |
| icon | `icons/pj2.png`（`npm run icons --only pj2` 抓取，HTTP 200 可达） |

- 数据源：用户在 `jevbest.com/zh/projects/jev-like-models/` 提交，经确认收录**根域名**而非子页
- 校验：`npm run validate` 通过（294 条 / 29 分类）
- 说明：同一 URL 无重复收录；favicon 落地为 png（非 svg/webp），数据 `icon` 字段已与实际文件名对齐

## 十六、站点收录：VergeX（2026-09-22）

新增站点 `ac16`（aicrypto AI+Crypto 分类，前缀 `ac`）：

| 字段 | 值 |
|------|----|
| id | `ac16` |
| name | VergeX |
| url | `vergex.trade`（根域名，未收 `/chart?symbol=BTC` 交易图子页） |
| desc | 加密交易的 AI 层：可部署自主 AI 代理，使用社区策略在任意交易所智能交易 |
| categoryId | `aicrypto`（AI + Crypto） |
| color | `#8b5cf6` |
| sortOrder | 295（全局递增，追加到数组末尾） |
| icon | `icons/ac16.jpg`（`npm run icons --only ac16` 抓取） |

- 数据源：用户在 `vergex.trade/chart?symbol=BTC` 提交，经确认收录**根域名**而非交易图子页
- 可达性：根域名无 UA 时 403（Cloudflare/WAF），带浏览器 UA 返回 HTTP 200；favicon 对应页内 `/vergex/favicon.svg`
- 校验：`npm run validate` 通过（295 条 / 29 分类；无重复收录）
- 说明：favicon 落地为 jpg（数据 `icon` 字段已与实际文件名对齐）

## 十七、站点收录：Awesome Jev / PUNK2898（2026-09-22）

新增站点 `pj3`（projects 项目参考分类，前缀 `pj`）：

| 字段 | 值 |
|------|----|
| id | `pj3` |
| name | Awesome Jev |
| url | `jev.punk2898.xyz`（punk2898 个人根域 `punk2898.xyz` 下的子应用，收录子应用域名） |
| desc | 聚合 788 个真正调用 Jev 的开源项目（非照 README 收录），按分类浏览、搜索，其中 182 个可在页面当场运行 |
| categoryId | `projects`（项目参考） |
| color | `#0d9488` |
| sortOrder | 296（全局递增，追加到数组末尾） |
| icon | `icons/pj3.png`（`npm run icons --only pj3` 抓取） |

- 数据源：用户在 `https://jev.punk2898.xyz/` 提交；站点 canonical 指 `jev-playground-five.vercel.app`（主托管域），`jev.punk2898.xyz` 为可用访问域，按此收录
- 与 bestjev（pj2）同属 Jev 生态目录，但来源不同（bestjev 按收录核验、PUNK2898 强调源码真实调用 + 在线可跑），分别收录
- 校验：`npm run validate` 通过（296 条 / 29 分类；无重复收录）
- 说明：favicon 落地为 png（数据 `icon` 字段已与实际文件名对齐）

## 十八、站点收录：Arcturus（2026-09-23）

新增站点 `dt32`（data 数据与研究分类，前缀 `dt`）：

| 字段 | 值 |
|------|----|
| id | `dt32` |
| name | Arcturus |
| url | `arcturus.watch`（根域名，未收 `/ ?theme=light` 主题参数） |
| desc | Arc 链上的 alpha 研究站：哪些项目有真人在用、钱往哪里走、Arc 团队在看谁，全部来自链上数据，独立站点 |
| categoryId | `data`（数据与研究） |
| color | `#5a6bff` |
| sortOrder | 297（全局递增，追加到数组末尾） |
| icon | `icons/dt32.svg`（`npm run icons --only dt32` 抓取，favicon 本身为 svg） |

- 数据源：用户在 `https://arcturus.watch/?theme=light` 提交，经确认收录**根域名**（`?theme=light` 为前端主题参数，非内容路径）
- 站点支持 `?lang=zh`/`?lang=en` 双语切换（页面 lang=zh-CN 默认中文）
- 分类归属：链上数据分析研究，归入 `data`（最新 id `dt31` 之后，续为 `dt32`）
- 校验：`npm run validate` 通过（297 条 / 29 分类；无重复收录）
- 说明：favicon 落地为 svg（数据 `icon` 字段已与实际文件名对齐）

## 十九、站点收录：QFEX（2026-09-23）

新增站点 `ex11`（cex 中心化交易所分类，前缀 `ex`）：

| 字段 | 值 |
|------|----|
| id | `ex11` |
| name | QFEX |
| url | `www.qfex.com`（根域名，未收 `/trade/US100-USD` 交易对子页） |
| desc | 首家 24/7 仅面向美股、大宗商品与外汇的交易所，无需券商即可高频直连交易（股票、黄金、白银、永续合约） |
| categoryId | `cex`（中心化交易所） |
| color | `#1a9e6c` |
| sortOrder | 298（全局递增，追加到数组末尾） |
| icon | `icons/ex11.png`（`npm run icons --only ex11` 抓取） |

- 数据源：用户在 `https://www.qfex.com/trade/US100-USD` 提交（US100 指数永续合约交易对），经确认收录**根域名**
- canonical 为 `https://www.qfex.com`，本站为 PWA（`favicon2.svg`）
- 分类归属：中心化交易平台，归入 `cex`（最新 id `ex10` 之后，续为 `ex11`）
- 校验：`npm run validate` 通过（298 条 / 29 分类；无重复收录）
- 说明：favicon 落地为 png（数据 `icon` 字段已与实际文件名对齐）
- 发布：v94（2026-09-24）上线；首次发布曾因后台任务环境异常中断（exit -1），后于 v94 重新发布成功确认

## 二十、更新：RootData（fd1）描述（2026-09-24）

用户提交 `https://cn.rootdata.com/projects/detail/Arc?k=...`（RootData 上 Arc 链项目详情子页）。经确认 `cn.rootdata.com` 已收录（`fd1`），按规则不重复新增条目。仅微调 `fd1.desc` 以贴合用户关注点：

- 旧：`Web3 项目数据平台，热榜、融资、空投日历、代币解锁追踪，投融资研究必备。`
- 新：`Web3 项目数据平台：热榜、融资、空投日历、代币解锁追踪，可查看单个项目（如 Arc 链）激励计划与详情，投融资研究必备。`
- `updatedAt` 同步刷新
- 随 v94 一并发布上线

---

## 二十一、Nav V4 升级：本地运维控制台 + CI/CD + 一致性修复（2026-09-25）

### 21.1 需求与方案

用户诉求两条：① 版本升级方案要**更智能、透明、可视化、自动化**；② 要一个**可视化的本地提交 + 远程实时同步**工具。

经选项确认，工具形态定为 **本地 Web 控制台**，同步范围覆盖 **全链路 + CI/CD**，智能化程度为 **规则式 + 变更摘要**。完整方案见 `docs/NAV-v4-upgrade-plan.md`。

关键取舍：

- **单一发布入口**：控制台只编排并可视化 `scripts/publish.mjs`，不重复实现发布逻辑，避免两套链路漂移
- **零新增依赖**：Git 封装直接调 `git` CLI（`simple-git` 因 npm arborist 崩溃弃用），HTTP 用 `node:http`，实时推送用 SSE
- **CI 只做门禁不部署**：Vercel Git 集成未开启，避免「代码自动部署」与「数据热更新」互相覆盖

### 21.2 交付物

| 里程碑 | 交付物 |
|--------|--------|
| M1 骨架 | `tools/console/server.mjs`（node:http + SSE 端点）、`ui/` 单页壳、`npm run console` |
| M2 Git 面板 | `lib/git.mjs`（状态/diff/暂存/提交/推送）、`ui/gitpanel.js`、`ui/diffview.js` |
| M3 同步面板 | `lib/jobs.mjs`（长任务 + 自定义事件 + 事件回放）、`lib/vercel.mjs`（部署状态机）、`lib/sync.mjs`（9 步全链路编排）、`ui/syncpanel.js` |
| M4 摘要 + 历史 | `lib/changes.mjs`（规则式 diff + 建议消息）、`lib/history.mjs`（提交×部署关联）、`lib/data.mjs`（数据体检）、`ui/historypanel.js`、`ui/datapanel.js` |
| M5 CI/CD | `.github/workflows/ci.yml`（validate + build 门禁）、`.github/workflows/release-please.yml`、`release-please-config.json`、`.release-please-manifest.json` |
| M6 透明增强 | `api/sites.js` 的 `useCache: false` 修复、README/HANDOVER 更新 |
| M7 站点管理 | `tools/console/lib/sites.mjs`（站点 CRUD + 元信息抓取 + 图标下载 + 云端同步编排）、`tools/console/ui/sitespanel.js`、`api/sites/list|meta|add|update|remove|icon|sync` 路由、`server.mjs` 的 `/icons/` 静态服务 |

控制台 7 个面板：概览 / 站点 / 改动 / 提交 / 同步 / 历史 / 数据。

### 21.3 关键实现要点

- **SSE 任务结束必须主动关连接**：`jobs.mjs#finish` 遍历订阅者 `res.end()` 并清空集合，否则客户端（curl 等）会挂到超时（exit 28）
- **子进程路径含空格**：`publish.mjs` 调用校验脚本必须用 `execFileSync(process.execPath, [scriptPath])`，不能 shell 拼接（`C:\work\solo work\...` 会被拆开）
- **Vercel 部署关联按 commit SHA 精确匹配**，不做近似推断；无匹配时在历史面板顶部展示「当前生产部署」基线，避免整屏「未关联部署」而无参照
- **面板懒加载**：历史面板会打 Vercel API，故仅在首次切到该标签时加载，且不纳入 30s 轮询
- **状态行吸顶**：`#panel-sync / #panel-history / #panel-data > .card.tight` 设 `position: sticky; top: 0`，保证刷新入口不被长列表挤出视口

### 21.4 验收结果

- `node scripts/validate-data.mjs`：298 站点 / 29 分类，**通过**
- `pnpm install --frozen-lockfile`：锁文件一致，**通过**（仓库锁定 pnpm，`pnpm-lock.yaml` 为唯一锁文件）
- `pnpm run build`：约 10s 构建成功
- `/api/history`、`/api/data/report`：返回真实数据（14 次提交 / 2 次已推送 / 2 条部署关联；数据体检全绿）
- 浏览器实测：6 个面板渲染正常、标签切换正常、吸顶生效、**新标签页控制台零错误**

### 21.5 排障记录

浏览器实测时控制台一度报 `SyntaxError: Invalid regular expression: missing /` 与 `/ui/app.js ERR_CONNECTION_FAILED`。经三重证伪确认为**假阳性**：

1. 服务端字节与磁盘文件逐字节比对全部 MATCH
2. 对**服务端返回的字节**跑 `node --check`，7 个模块全部 parse-OK
3. 新开标签页复测，控制台**零消息**

根因是排查过程中多次重启控制台服务，浏览器控制台缓冲区保留了重启窗口期的陈旧条目（且报错行号指向 `gitpanel.js:243` 的右花括号，并非网络调用点）。**结论：控制台消息缓冲跨导航保留，排查时须以新标签页为准。**

### 21.6 M7 站点管理闭环（2026-09-25）

**诉求**：在前端页面「添加站点」后，新站点只进浏览器 `localStorage`，必须切回前端才能入库；且云端生效依赖人工跑发布脚本。要求「在控制台上添加网站后能实时同步到远程服务器」。

**闭环**（控制台「站点」面板）：

```
新增/编辑/删除 → 写 api/sites-data.json（原子写 tmp+rename）
抓取元信息     → curl.exe 抓标题/描述/图标 + 分类建议（多编码回退）
抓取图标       → 页面声明 → /favicon.ico → favicon.im 兜底 → public/icons/<id>.<ext>
一键同步云端   → 差异检查 → 提交（仅数据+图标）→ 推送 → 备份 → schema 门禁 → Blob 热更新 → 轮询收敛
```

**沿用的项目口径**（避免第二套标准）：id 前缀沿用该分类既有前缀、序号全局递增；`sortOrder` 取全局最大 +1；`url` 只存域名；写盘 2 空格缩进 + 末尾换行；热更新复用 `/api/sites` + `Authorization: Bearer`。

**关键实现要点**：

- **提交范围收敛**：同步只 `stage` `api/sites-data.json` 与 `public/icons/*`，不裹挟工作区其他改动
- **图标可预览**：`server.mjs` 新增 `/icons/` 静态服务（复用仓库 `public/icons`），面板内直接看到本地图标
- **`hostOf` 需兼容裸域名**：数据里存的是无协议域名，`data.mjs#hostOf` 补全 `https://` 后再解析，否则域名查重失效
- **分类建议表与前端同源**：`sites.mjs` 的 `CATEGORY_HINTS` 与 `AddSiteModal.vue` 保持一致；两处均已修正 `design` 的 `ui` 误匹配（"b**ui**ld" 曾把 github.com 判成设计类）

**验收结果（本地 + 浏览器实测）**：

- 站点增删改：新增 → 落盘 `pj4`/`sortOrder 299`/继承分类色 → 删除后 `api/sites-data.json` 与 HEAD **零差异**（298 条）
- 图标双路径：`example.org`（无真实图标）→ 任务 `failed`、**0 文件落盘**；`vuejs.org` → 任务 `success`、落盘真实 Vue logo SVG
- 浏览器：站点面板 298 行渲染正常，搜索 `github`→3 条、分类 `coding`→16 条，新增表单可开可关，**控制台零报错**

**发现并修复的三个图标陷阱**（`sites.mjs` + `fetch-favicons.mjs` + `api/metadata.js` 三侧同步加固）：

1. `data:` 图标：`example.com` 等用 `<link rel="icon" href="data:,">` 抑制请求，原实现把它当图标地址返回 → 前端破图。现按「未声明」处理继续回退。
2. `favicon.im` 占位图：查不到的域名返回 **200 + 灰圆斜体 `f` 的 SVG**（257B，格式合法），会被当真实图标落盘。全站排查 **14 个站点**中招（含迁移时重抓的 `md5`）→ 现识别并拒收，宁缺勿错。
3. **内联 SVG 被引号截断**：`tapeout.link` 等把图标写成 `href="data:image/svg+xml,%3Csvg xmlns='…'"`——值由双引号包裹、内部含单引号，而取值正则用的是 `[^"']+`，会从第一个单引号处截断，解出 `"<svg xmlns="` 共 **11 字节的坏文件**（`ac15.svg` 即由此产生）。现统一改为**按定界引号配对**的 `attrValue()`，并把 `data:image/…` 视为真实内联图标、由 `decodeDataUri()` 本地解码落盘（不再交给 curl）。

### 21.7 图标清理收口（2026-09-25）

**结果**：占位图标已全量清理，`public/icons` 无占位图、无孤儿、无悬空引用。

| 项 | 数量 | 说明 |
|----|------|------|
| 删除的占位图标文件 | 14 | `ac14/acc3/bs3/ch6/df8/dt13/dt17/dt26/fd6/l1/md5/nf4/pj1/sm3` 的占位 SVG |
| 重抓成功（换真实图标） | 5 | `dt17.jpg`、`dt26.png`、`md5.ico`、`nf4.png`（LooksRare）、`fd6.png`（CoinList） |
| 修复的坏文件 | 1 | `ac15.svg` 11B 坏文件 → 354B 真实内联 SVG（芯片图标） |
| 清理的孤儿文件 | 2 | `p1.ico`（learnprompting.com→.org 迁移遗留）、`l6.png`（已被 `l6.ico` 取代） |
| 确认无真实图标 | 9 | `ac14/pj1/acc3/bs3/sm3/dt13/df8/ch6/l1` |

**9 个站点确认拿不到真实图标**（逐个核验：页面无任何 `rel=icon` 声明、`/favicon.ico` 返回 404/SPA 兜底 HTML、Google s2 与 gstatic 均返回默认地球占位图）：

- `ac14` tradingkit.com / `pj1` kking2020.com / `acc3` chejiu888.online / `bs3` 三毛机场 —— 首页无图标声明
- `dt13` ops.mangoslab.xyz —— `/favicon.ico` 返回 FastAPI 404 JSON
- `df8` venus.io —— 全站 SPA rewrite，任何图标路径都返回 `index.html`
- `ch6` zapper.fi —— 已 302 到 `zapper.xyz`，Cloudflare 挑战页拦截（403）
- `l1` fast.ai —— 首页 252KB 无任何图标声明，`/favicon.ico` 与 `/images/favicon.ico` 均 404
- `sm3` xtemporary.com —— 域名已失效（SSL 握手失败），此前用户选择保留

处理方式：**清空 `icon` 字段**（不写空串、直接删键），前端 `SiteCard.vue` 回落为「分类色块 + 首字母」（`@error` 亦会摘掉加载失败的 `<img>`），不会出现破图或假图标。

**验收**：`npm run validate` 通过（9 条 `缺少 icon` 为预期警告）；图标文件 289 个，占位图 0 / 孤儿 0 / 悬空引用 0；`api/sites-data.json` 相对 HEAD 仅 **14 条** `icon` 字段变化（9 条清空 + 5 条换真实图标），无增删站点。

### 21.8 控制台浅色模式 + 下一版方向调研（2026-09-25）

**需求**：为本地运维控制台新增浅色模式；同时调研该工具下一版的升级方向。

**实现（浅色模式）**：

| 文件 | 改动 |
|------|------|
| `tools/console/ui/theme.js` | 新增：三态主题（`auto` / `light` / `dark`），持久化到 `localStorage['nav-console-theme']`，仅 `auto` 时响应系统偏好变化 |
| `tools/console/ui/style.css` | `:root` 保持深色为默认，新增 `[data-theme="light"]` 覆盖同一组语义变量；把 20 处硬编码色（日志区 `#0f1116`、diff 行前景 `#a7f3d0`/`#fecaca`、时间戳 `#555b68`、滚动条 `#2e333d`、各类半透明 tint）全部提为变量 |
| `tools/console/ui/index.html` | head 内联首屏防闪烁脚本（样式表解析前定下 `data-theme`）；顶栏右侧加 `#btn-theme` 三态按钮 |
| `tools/console/ui/app.js` | 引入并调用 `initTheme()` |

**关键取舍**：

- **默认 `auto`（跟随系统）**：控制台首次打开不再是「永远深色」，而是随系统偏好；用户手选后不再被系统覆盖
- **单一变量层**：深/浅两套只替换取值、不动选择器；新增元素只要用语义变量即自动获得双主题
- **浅色下加深语义色**：`--accent` `#5b7cfa`→`#3055c8`、`--ok` `#34d399`→`#0a8159`、`--log-ts` `#555b68`→`#8f97a5`，避免浅底上对比度不足

**验收（WCAG 对比度实测）**：浅色下正文 16.68、次要文字 5.21、强调色文字 6.44、白字/强调底 6.44、diff 新增行 8.06、删除行 8.99、日志 stdout 12.98 —— 均 ≥ 4.5:1；日志时间戳刻意弱化为 2.84（深色基线 2.77，保持一致的视觉层级）。

**浏览器端到端验证**：浅色 / 深色切换后 `data-theme` 与按钮文案一致；F5 刷新后仍保持手选模式（持久化生效，未被 `auto` 覆盖）；`/ui/theme.js` 返回 200；无主题相关 JS 报错。

**调研产出**：新增 `docs/nav-console-next-plan.md`（控制台 M8+ 方向），要点：

- **P0 安全缺口**：写操作已有 `Origin` + `X-Nav-Console` 双重校验，但 **GET 读接口零校验、`Host` 头从未校验** —— DNS rebinding 场景下可被同源读取 `/api/sites/list`、`/api/env`、`/api/git/status`；仅监听 `127.0.0.1` 不足以防护（Jupyter 的做法是默认拒绝 Host 不指向本地的请求，并默认启用 token）
- **候选方向（按性价比排序）**：① 安全收口（Host 校验 + 读接口鉴权）② 日志过滤 / 搜索 / 多任务切换 ③ 发布门禁 + 一键回滚（`vercel rollback`）④ 站点可用性看板 ⑤ 操作审计持久化 ⑥ hunk 级暂存 / 取消暂存 ⑦ 多环境 staging → promote
- **里程碑建议**：M8 = ① + ②（低成本高收益、零新增依赖）；M9 = ③ + ⑤；M10 = ④ + ⑥
- **明确不做**：不引入前端框架 / 构建步骤、不上 WebSocket（SSE 已足够）、不把控制台部署到公网

### 21.9 M8 落地：安全收口 + 日志增强（2026-09-25）

按 `docs/nav-console-next-plan.md` 的性价比排序，先做 M8（① 安全收口 + ② 日志增强），两项零新增依赖、互不耦合，同批交付。

#### ① 安全收口（DNS rebinding 防护）

| 文件 | 改动 |
|------|------|
| `tools/console/lib/api.mjs` | 重写 `isTrusted(req)`：新增 Host 头回环白名单校验（`hostNameOf()` 剥离端口 + 兼容 `[::1]:5175` IPv6 字面量）、Origin 主机名同源校验、非 GET 强制 `X-Nav-Console: 1`；删掉原先只在 POST 分支做的零散校验 |
| `tools/console/server.mjs` | 请求入口统一调用 `isTrusted(req)`，静态资源（`/`、`/ui/*`、`/icons/*`）与读接口一并覆盖，不留旁路 |

关键认知：**仅监听 `127.0.0.1` 挡不住 DNS rebinding** —— 攻击者页面可让自身域名解析到 `127.0.0.1`，此时浏览器发出的 `Host` 仍是攻击者域名，服务端必须校验 `Host` 才是核心防线。本机 `curl` / 脚本调试天然满足「Host 回环 + 无 Origin」，不受影响；调写接口需自行加 `-H "X-Nav-Console: 1"`，因此无需任何豁免路径。

**新增自动化用例**：`tools/console/test-trust.mjs` + `package.json` 的 `console:test` 脚本。零依赖，用 `node:http`（而非 `fetch`，因 `fetch` 会忽略 `Host` 头）精确控制请求头，在独立端口拉起真实服务进程跑 13 条断言。

**验收**：`npm run console:test` → **13/13 通过**（端口 5399）。放行 4 条：本机 Host / `localhost` / `[::1]` / 同源 Origin；拒绝 7 条：`Host=evil.com` 读接口与静态资源、跨站 Origin、POST 缺自定义头、跨站 Origin 带自定义头、伪造 Host 带自定义头；兜底 2 条：目录穿越尝试 404、未知接口 404。

> 排障提醒：`server.mjs` / `lib/*.mjs` 是**启动时加载**的，改完必须重启控制台进程才生效；`ui/*.js`、`ui/style.css` 由 `serveFrom` 每次请求现读磁盘（`Cache-Control: no-store`），刷新页面即可。本次首轮 curl 实测仍是旧错误文案，即因进程未重启。

#### ② 日志增强（过滤 / 搜索 / 多任务切换）

| 文件 | 改动 |
|------|------|
| `tools/console/ui/core.js` | 日志模块重写：按任务 id 分桶的前端缓冲、关键字过滤 + `<mark>` 高亮（支持 `/正则/`）、四级流筛选、任务下拉、跟随开关、复制可见日志 |
| `tools/console/ui/index.html` | 控制台新增 `.log-bar`（`#log-filter` / `#log-levels` 四枚 chip / `#log-count` / `#log-follow` / `#btn-copy-log`）；`#job-select` 任务切换下拉 |
| `tools/console/ui/style.css` | `.log-bar` / `.job-select` / `.chip.toggle[.on]` / `.log-line mark` 样式；新增语义变量 `--mark-bg`（深浅两套取值）；收起态改为 `height: auto` 并隐藏 `.log-bar`（原 41px 魔法数在加入下拉后会裁切按钮） |
| `tools/console/ui/app.js` | 改为调用 `initLogConsole()` 统一绑定日志区交互（原先散在 app.js 的清空/终止监听已内聚） |

关键实现：

- **切任务不串行**：前端 `Map<id, {title, status, lines}>` 各留缓冲；切换时经 SSE 重放服务端环形缓冲重建，故**先清掉该任务的非本地行再回放**（否则重复），本地行（如「已提交 abc」）标 `local: true` 保留
- **多任务可见性**：每 15s 轮询 `/api/jobs` 同步状态，**控制台之外启动的任务也能出现在下拉里**；`isBusy()` 与「终止任务」按「是否存在运行中任务」判定，而非仅看当前打开的流（切换视图不会误判为空闲）
- **安全渲染**：高亮用 `DocumentFragment` + `createTextNode` 拼装，不经 `innerHTML`，避免日志内容注入
- **性能**：命中行增量追加 O(1)，仅切任务 / 改过滤条件时全量重绘，避免长日志 O(n²)

**验收（浏览器端到端）**：自检任务 5 行 → 过滤「检查」得 `显示 4 / 5 行` + 4 处 `<mark>` → 清空恢复 5 行 → 关「输出」chip 可见行归零、再开恢复 → 任务下拉含 2 个任务且切换内容随之变化、无串行 → 浅色与深色两态日志区（时间戳 / 分级 chip / `<mark>` / 计数）均清晰可读、无「浅字压浅底」 → 「收起」后仅剩标题行且按钮不被裁切。

**遗留观察（非回归）**：页面加载时 `/api/changes/summary` 与 `/api/sync/status` 偶现 `net::ERR_ABORTED`。复测为**页面重载中断了在途的慢请求**（两者都要起 git 子进程），直接请求（含同源 Origin 头）均 200。

#### 文档同步

`README.md`（控制台日志区能力、`console:test` 命令、安全边界描述、项目结构）、`docs/nav-console-next-plan.md`（① ② 标记已落地 + 新增「八、M8 实施记录」）、本文件。

### 21.10 M9 落地：智能体 CLI（2026-09-25）

控制台是给人看的（浏览器 + SSE），智能体需要的是**可被程序解析的命令行入口**。新增 `tools/cli`，覆盖四个命令域共 **28 条命令**。

#### 交付物

| 文件 | 说明 |
|------|------|
| `tools/cli/nav.mjs` | 入口：命令注册表（按 `path` 自动建表，重复或前缀不匹配直接抛错）、分发、`help`/`schema` 元命令、退出码 |
| `tools/cli/lib/core.mjs` | 内核：输出信封、退出码映射、全局参数剥离、命令参数解析、长任务等待、宽字符表格渲染、预演信封 |
| `tools/cli/commands/sites.mjs` | 站点管理 9 条：list / get / add / update / remove / categories / meta / icon / check |
| `tools/cli/commands/publish.mjs` | 发布与云端 5 条：status / run / verify / sync-data / deployments |
| `tools/cli/commands/git.mjs` | Git 工作流 9 条：status / diff / log / suggest / stage / unstage / commit / push / remote |
| `tools/cli/commands/data.mjs` | 数据体检与环境 5 条：stats / integrity / diff / validate / doctor |
| `tools/cli/README.md` | 输出契约、退出码、命令清单、预演语义、新增命令的写法 |
| `package.json` | 新增 `bin.nav` 与 `nav` 脚本 |

#### 关键实现要点

- **输出契约**：stdout 只有一份结果文档（默认单行 JSON `{ok,command,data,meta}`，`--pretty` 转文本），进度与子进程日志一律走 stderr，因此 stdout 可直接 `JSON.parse`。`note()` 仅在 `--quiet` 时静默（原先 `--pretty` 也会静默，导致预演模式下 `sites check` 的进度条完全不可见）
- **退出码语义化**：0 成功 / 1 内部 / 2 用法 / 3 环境缺失 / 4 远端失败 / 5 业务拒绝。`toCliError()` 按消息特征兜底归类，命令也可显式返回 `{ ok:false, exitCode, error }` 自行判定（如 `sites check --strict`、`data validate`、`data doctor`）
- **零业务重复**：所有命令复用 `tools/console/lib/*`（sites / data / changes / git / jobs / sync / vercel / env），控制台与 CLI 共用同一套逻辑；`data validate` 直接 `execFileSync(process.execPath, [scripts/validate-data.mjs])`，与发布门禁、CI 同口径
- **长任务同进程**：复用 `jobs.mjs` 但**不经 SSE** —— CLI 与 job 同进程，直接轮询内存 job 对象的 `events[]` 实时把日志打到 stderr，结束返回 `steps[]` / `logs[]` / `cloudVersion` / `deploymentUrl`；超时默认 15 分钟（`--timeout` 可调），超时按退出码 4 返回并 `killJob`
- **写操作可预演**：`--dry-run` 为全局选项，但**预演不另写一套校验** —— 在 `sites.mjs` 的 `addSite` / `updateSite` / `removeSite` / `downloadIcon` 上加 `{ dryRun }` 参数，走完全部校验与 ID 计算后提前返回。因此预演出的 `id` / `sortOrder` / 报错与实写完全一致（实测 `sites add --dry-run` 返回 `id=l15 / sortOrder=299`，落盘前后数据文件 MD5 不变）。`publish run --dry-run` 额外给出 `blockers[]`，直接说明「为什么真跑会失败」
- **表格对齐**：中文表格用 `displayWidth()`（东亚宽字符与 emoji 记 2 列）计算列宽，原先 `padEnd` 按字符数补齐会让中文列全部错位

#### 验收结果（28 条命令全部实测通过）

| 项目 | 结果 |
|------|------|
| 元命令 | `--version` / `version` → `3.0.0`；`schema` 输出完整清单；`help` / `help sites` / `help sites add` / `nav sites` / `nav sites add --help` 五种帮助路径正常 |
| 只读命令 | `sites list/get/categories/meta/check`、`publish status/verify/deployments`、`git status/diff/log/suggest/remote`、`data stats/integrity/diff/validate/doctor` 全部 exit 0 |
| 写命令 | `sites add/update/remove/icon`、`git commit/stage/unstage/push`、`publish run/sync-data` 的 `--dry-run` 全部 exit 0；`git stage` → `git unstage` 往返后索引回到 0 暂存 |
| 预演不落盘 | `sites add/update/remove --dry-run` 前后 `api/sites-data.json` MD5 一致（`7386737D…`） |
| 错误路径 | 未知命令域 / 未知子命令 / 缺必填参数 / 缺位置参数 / 未知选项 / 非数字 `--timeout` 均 exit 2 且 `hint` 给出用法；`sites add` 重复域名 exit 5（`REJECTED`） |
| 只读 + `--dry-run` | 提示「只读命令，--dry-run 无效果」到 stderr，不影响 stdout JSON |
| 环境自检 | `data doctor` → 正常 10 / 告警 0 / 失败 0（Node v22.16.0、git 2.55、curl 8.19、`SITES_ADMIN_KEY` 与 `VERCEL_TOKEN` 已配置、298 站点 / 289 图标、origin 正常） |
| 云端链路 | `publish status` → 本地 298 / 云端 298（v96）已收敛；`publish verify` 第 1 次轮询即收敛；`publish deployments` 正确关联提交 |

> 排障提醒：`data doctor` 只检查**本地命令真正依赖**的东西。`BLOB_READ_WRITE_TOKEN` 只在 Vercel 运行时需要（本地热更新走管理接口），故不作为检查项，避免在健康环境里报无意义的告警。

#### 文档同步

新增 `tools/cli/README.md`；`README.md`（新增「智能体 CLI」小节、`nav` 命令、项目结构条目）、本文件。

### 21.11 M9 修订：预演不再需要管理密钥（2026-09-25）

**问题**：`publish run` / `publish sync-data` 的 `requireAdminKey()` 写在 `if (ctx.dryRun)` 分支**之前**，导致「只想看看会发什么」的预演也必须先配好 `SITES_ADMIN_KEY`，缺密钥时直接以退出码 3 中止。预演本身不触碰云端，这个前置校验与「`--dry-run` 是零成本前置检查」的定位相矛盾 —— 智能体在无凭据环境里做发布前自检会被无谓拦住。

**改动**（`tools/cli/commands/publish.mjs`）：

- `runCmd` / `syncDataCmd` 的 `requireAdminKey()` 与 `guardRunning()` 下移到 `if (ctx.dryRun)` 分支**之后**，只在真正要启动 job 时才校验
- `publish run --dry-run` 的 `blockers[]` 新增一条：缺 `SITES_ADMIN_KEY` 时列出「实际发布会中止在热更新前（用 data doctor 确认环境）」—— 预演放行但仍如实告知真跑会失败，避免制造「预演通过 = 可发布」的假象

**安全性未削弱**：真跑路径的密钥校验位置不变，缺密钥依旧退出码 3；`sync-data` 真跑实测 `{"ok":false,"code":"ENV_MISSING"}` exit 3 且未启动 job。

**实测**（把 `SITES_ADMIN_KEY` 置空构造缺密钥环境；`env.mjs#loadEnv()` 不覆盖已存在的环境变量，故可稳定复现）：

| 场景 | 结果 |
|------|------|
| 无密钥 · `publish run --dry-run` | exit 0，`ok:true`，`blockers` 含缺密钥一条 |
| 无密钥 · `publish sync-data --dry-run` | exit 0，`ok:true` |
| 无密钥 · `publish sync-data --no-commit --no-push`（真跑） | exit 3，`ENV_MISSING`，未启动 job |
| 有密钥 · `publish run --dry-run` | exit 0，`blockers` 为空 |

**文档同步**：`tools/cli/README.md`（预演语义补「不需要密钥」）、`nav-cli-agent-guide/nav-cli-agent-guide.html`（第五章原先写的「预演仍需密钥」已改为反向结论，配方 2 注释同步）。

### 21.12 Nav V5 方向调研（2026-09-25）

**诉求**：M9（智能体 CLI）代码先不提交，继续调研下一个版本往哪走。方法为「三路外部调研 + 本地能力盘点」，产出 `docs/NAV-v5-upgrade-plan.md`。

**关键发现（驱动整份方案的洞）**：**云端数据没有历史。** `api/sites.js` 写入 Blob 用的是 `addRandomSuffix: false` + `allowOverwrite: true`，并维护一个只增不减的 `version` 计数 —— 覆盖即丢失；Vercel Blob 本身也没有对象版本控制（只有 `allowOverwrite` / `addRandomSuffix` / `ifMatch` 乐观锁，后者只防冲突不存历史）。唯一的恢复源是本机 `backups/sites-data-*.json`（现有 25 份），既不上云也无版本语义。于是：**代码能回滚一步（Hobby 限制），数据却回不来。**

**本地能力盘点**（写进方案「现状体检」）：控制台 24 条路由（13 读 + 11 写）+ 5 面板 + SSE 日志；CLI 28 命令 / 4 域（sites 9 · publish 5 · git 9 · data 5）；发布链路 6 步；数据脚本 6 个。

**V5 候选方向（按性价比排序）**：

| 方向 | 成本/风险 | 要点 |
|------|-----------|------|
| ① MCP 服务化 | 中低 / 低 | 用官方 `@modelcontextprotocol/sdk`（stdio）包一层；**28 命令不一对一映射**，收敛为 4 个域级网关工具 + 1 个 `nav_status`，合计 5 个；写操作要求 `confirm: true` |
| ② 云端数据快照 + 发布门禁 + 回滚 | 中 / 中 | 快照优先（补上面的洞）；门禁走 Hobby 可行的 `deploy --prod --skip-domain` → 人工放行 → `promote` → `cache purge`；**回滚写入时 `version` 必须继续递增**，回退计数会让收敛轮询误判 |
| ③ 操作审计日志 | 低 / 低 | 新增 `tools/console/.data/audit.jsonl`（当前无 `.data/` 目录） |
| ④ 站点可用性看板 | 中 / 低 | 复用 `check-sites.mjs` 分级；**连续 N 次失败才判 down**，429/403/405/401 归 `limited`；历史先落 JSONL，不引 SQLite |
| ⑤ hunk 级暂存 | 中 / 中 | `git diff` 取 hunk → `git apply --cached`（无上下文补丁配 `--unidiff-zero`）；失败用 `git restore --staged <file>` 收尾；hunk 边界手写解析，不引 `jsdiff` |
| ⑥ 多环境 staging | 高 / 中高 | 技术上 Hobby 可用 CLI 自定义环境，但单人导航站收益有限，**后置** |

**建议先做 V5-M1（MCP）+ V5-M2（快照/门禁/回滚）**：M1 复用 M9 成果、成本集中在「工具收敛」这一处设计决策；M2 的云端快照是唯一「不做会持续暴露数据丢失风险」的项，且与 M1 无耦合。③ 体量最小，搭 M2 一起交付。

**编号关系**：`nav-console-next-plan.md` 原定 M9 = 发布门禁 + 审计、M10 = 看板 + hunk 暂存，但 **M9 实际被智能体 CLI 占用**；本方案以 `V5-M*` 重新编号，原 ③④⑤⑥ 顺延至 V5-M2 / M4 / M3 / M5。

**来源核实**：方案内 35 条来源全部带 URL，其中关键 5 条已逐条打开验证 —— `vercel rollback`（Hobby 仅上一个生产部署，更早报 `upgrade to pro`）、MCP 版本页（`2026-07-28` 为 Current）、工具数膨胀分析（58 工具 ≈ 55k token，30–50 阈值）、Deployment Checks（「等检查通过」而非「等人点确认」）、`vercel deploy --skip-domain`（须与 `--prod` 同用，关闭生产域名自动分配）均与方案描述一致。另经脚本校验：引用编号无越界、无「引用无来源」、无「来源未被引用」。

**文档同步**：新增 `docs/NAV-v5-upgrade-plan.md`；`README.md`（M9/M10 说明改为「M9 被 CLI 占用」+ 补 V5 方案链接、项目结构补三份 docs 条目）、本文件。

### 21.13 M10 落地：控制台开机自启 + 桌面快捷方式（2026-09-25）

**诉求**：参照 `TokenRhythm-Batch-Manager`（TRBM）的前后端处理方式，给控制台加开机自启与桌面快捷方式。当时确定的口径是「只自启运维控制台 / NSSM 服务·当前用户+密码 / Chrome app 模式快捷方式」。

**交付物**（新增 `tools/console/launcher/`，共 8 个脚本 + 1 个图标）：

| 文件 | 作用 |
|------|------|
| `install-autostart.ps1` | 注册/移除「登录自启 + 保活」计划任务，并同步快捷方式（**实际落地路线**） |
| `ensure-console.ps1` | 幂等保活：探活健康则秒退，否则拉起（计划任务的动作） |
| `start.ps1` / `stop.ps1` | 启用并启动 / 停用并停止（stop 会同时停用任务） |
| `sync-shortcuts.ps1` | 桌面 + 任务栏 Chrome app 快捷方式 |
| `build-icon.ps1` + `make-icon.mjs` | 源图居中裁切去水印 → 256×256 → 打包 `app.ico`（零依赖 PNG-in-ICO） |
| `install-service.ps1` / `set-service-account.ps1` | NSSM 服务路线（需账户有密码；日志轮转 / 崩溃重启 / 账户重绑） |
| `lib.ps1` | 共享工具：node 定位 / 健康探测 / 原生调用（PS 5.1 引号修正） |

配套改动：`server.mjs` 新增 `--strict-port`（钉死端口，默认仍可漂移）；`package.json` 新增 8 条 `console:*` 脚本；`.gitignore` 忽略 `nssm/`、`logs/`、`icon-256.png`（`app.ico` 入库）。

**关键实现要点**：

- **端口必须钉死**：原 `server.mjs` 在 `EADDRINUSE` 时自动 `+1` 顺延（最多到 5185）。服务化/快捷方式场景下端口漂移会让快捷方式指向空端口，故新增 `--strict-port`：占用即 `exit 1` 并打印「严格端口模式下不会自动漂移」。实测：strict 第二实例 `exit=1`、无 strict 的实例顺延到 5176。
- **保活做成幂等一次性任务，而不是常驻看门狗**：任务动作是 `ensure-console.ps1`（先探活，健康直接退出），同一任务挂两个触发器 —— `AtLogOn` + 每 5 分钟兜底。这样不需要常驻进程，也不必处理「看门狗自己卡死」。
- **`stop.ps1` 必须同时停用任务**：否则 5 分钟后的保活会把进程拉回来，出现「停了又活」。TRBM 用一个自过期维护锁解决同类问题，这里直接停用任务更简单。
- **图标三处细节**：AI 生成源图右下角带水印，故 `build-icon.ps1` 先做居中裁切（默认 1400×1400）再高质量缩放；ICO 用「PNG 内嵌进 ICO 容器」写法（Vista+ 支持），避免 `Bitmap.GetHicon()` 掉 alpha；ICO 目录项只有 1 字节存尺寸，故强制 ≤256×256。
- **坚持「当前用户」而非 `LocalSystem` 的唯一理由是 git 凭据**：控制台的 Git 面板要 `git push` 到 `https://github.com/arwei944/navigator-v2.git`，凭据由 Git Credential Manager 存在当前用户凭据管理器里；`LocalSystem` 走 `systemprofile`，拿不到。

**验收结果**（实测）：

| 项 | 证据 |
|----|------|
| 计划任务 | `nav-console`：触发器 2 个（`MSFT_TaskLogonTrigger` user=Administrator + `MSFT_TaskTimeTrigger` Repetition=`PT5M`），`LastTaskResult=0` |
| 控制台可达 | `curl http://127.0.0.1:5175/` → `200`；页面标题 `nav-console · 本地运维控制台` |
| 运行身份 | `node.exe` PID 7772，`DESKTOP-90S2RHI\Administrator`；命令行 `"…\node.exe" "…\server.mjs" --port 5175 --strict-port` |
| 保活真实生效 | 强杀控制台 → 探活 `000` → 触发任务 → `200`（修复慢查询后 **5.9s**，修复前 35s）；**任务退出后子进程仍存活**（任务托管子进程不会被回收） |
| git 凭据可用 | `git config --get credential.helper` = `manager`；`cmdkey /list` 含 `gh:github.com:arwei944` |
| 快捷方式 | 桌面 + 任务栏 `.lnk` 均指向 `chrome.exe --app=http://127.0.0.1:5175`，图标 `app.ico`；实际打开 Chrome 窗口标题 `nav-console · 本地运维控制台` |
| 图标 | `app.ico` 72789 字节 / 256×256 |

**排障记录（五条，都会反复踩）**：

1. **`.ps1` 必须 UTF-8 with BOM**。首次运行报 `Unexpected token 'app=$url"'` + `The '--' operator works only on variables`：PowerShell 5.1 对**无 BOM** 的 `.ps1` 按 GBK 解码，中文多字节序列被拆坏后直接破坏语法。TRBM 的脚本开头都带 BOM 正是为此。修法：`[System.IO.File]::WriteAllText($f, $text, (New-Object System.Text.UTF8Encoding($true)))`。**用 Write/Edit 工具改完 `.ps1` 后要重新补 BOM**，并可用 `[System.Management.Automation.Language.Parser]::ParseFile()` 做无副作用语法校验。
2. **PS 5.1 调用原生程序会吞掉内嵌引号**。`& $nssm set svc AppParameters "`"$path`" --port 5175"` 存进去变成不带引号的路径，`AppDirectory` 无法兜住，node 报 `Cannot find module 'C:\work\solo'`（仓库路径含空格 `C:\work\solo work\…`）。这与本项目既有的教训同源（`publish.mjs` 必须用 `execFileSync(process.execPath, [scriptPath])` 而非 shell 拼接）。修法：用 `System.Diagnostics.ProcessStartInfo` 自己拼命令行（`Invoke-Native`，空串也要包成 `""`），已抽到 `lib.ps1`。
3. **空密码账户无法做服务登录**（决定了路线从「服务」改为「计划任务」）。`Administrator` 账户 `Password required: No`，NSSM 直接拒绝空密码（`Setting "ObjectName" requires both a username and password!`）；改用 `sc.exe config obj= .\Administrator password= ""` 可写入，但 `sc start` 报 **`1069 The service did not start due to a logon failure`**。进一步排查：`SeServiceLogonRight` 原本不含该账户（用 NSSM 设 `ObjectName` 可借它自动授予，已成功），**但授予后 1069 依旧** —— 即空密码本身被 Windows 拒绝（`LimitBlankPasswordUse` 语义：非控制台登录一律挡）。**结论：要走 NSSM 服务必须先给账户设密码**（会改变用户每次登录体验），而控制台只监听 `127.0.0.1`、登录前无人能用，故最终选「登录自启」——可用性等价且不必动账户。失败的服务实例已用 `nssm remove nav-console confirm` 清理，`install-service.ps1` 保留备用。
4. **`Get-NetTCPConnection` 在本机要 34~40 秒**（走 CIM/WMI）。保活脚本用它做「端口是否被占」，导致控制台一旦掉线，要 35 秒才被拉起来。实测对比：`Get-NetTCPConnection` 33.8s / 40.6s，`netstat -ano` **0.41s**，`TcpClient.Connect` **0.04s**。修法：`lib.ps1` 新增 `Get-PortListener`（解析 `netstat -ano`，能拿到 PID）与 `Test-PortListening`（TcpClient 一次性连接探测），`ensure-console.ps1` / `stop.ps1` 全部替换。修复后冷启动拉起 **35s → 5.9s**（其中 2.1s 是 PowerShell 冷启动）。**结论：本机任何「查端口占用」都不要用 `Get-NetTCPConnection`。**
5. **从终端 `Start-Process` 拉起 node 会让 `pnpm run` 卡死**。node 会继承调用方的 stdout 管道句柄，`pnpm run console:start` / `console:autostart` 里 npm 永远等不到 EOF —— 命令看起来「卡住」（实测 150s 超时未返回）。更糟的是 `install-autostart.ps1` 的「立即拉起」在**快捷方式同步之前**，所以卡死会连带快捷方式根本不生成。修法：新增 `lib.ps1#Start-NavTaskNow`（`schtasks /run` + 探活轮询），`start.ps1` / `install-autostart.ps1` 的「立即拉起」改走计划任务 —— 进程由任务计划服务派生，完全脱离终端句柄。`ensure-console.ps1` 内的 `Start-Process` 保留（它只在任务上下文里跑，那里没有 npm 管道）。修复后 `console:start` 19.5s 返回、`console:autostart` 20.8s 返回且快捷方式正常同步。

**文档同步**：`README.md`（常用命令补 `console:autostart`；控制台章节新增「开机自启与桌面快捷方式」小节 + launcher 脚本表 + BOM 警告；项目结构补 `launcher/`）、本文件。

### 21.14 M11 落地：新增站点「只填网址即自动补全」（2026-09-25）

**诉求**：把「新增站点」做智能 —— 用户只给一个网址，名称 / 描述 / 分类 / 配色 / 图标全部自动补好，且不得覆盖用户已经手改过的字段。线上前端弹窗与本地控制台两个入口都要。

**交付物**：

| 文件 | 作用 |
|------|------|
| `shared/site-infer.mjs` | **新增**，唯一的推断引擎：标题清洗 / 描述兜底 / 分类打分 / 配色推断 / 图标候选 / 多编码解码 |
| `api/metadata.js` | 改为调用共享引擎；抓取失败不再报错，改为产出域名草稿 + `warning` |
| `tools/console/lib/sites.mjs` | 删除本地重复的 `CATEGORY_HINTS`，改调共享引擎，并额外传入已收录站点与分类表 |
| `src/components/AddSiteModal.vue` | 重写为「粘贴即补全」：状态行 + 来源/置信度小标签 + 图标预览 |
| `tools/console/ui/sitespanel.js` `ui/index.html` `ui/style.css` | 粘贴网址自动补全、自动字段描边、`result warn` 样式 |
| `tools/console/test-infer.mjs` | **新增**，66 条断言覆盖推断引擎 |

**关键实现要点**：

- **一份引擎两处复用**：线上 Serverless（`api/metadata.js`）与控制台（`lib/sites.mjs`）都走 `shared/site-infer.mjs`，避免两边口径漂移。控制台额外传 `existingSites` + `categoryMeta`，让「同域名 / 同族域名 / 品牌词」加权与分类白名单生效。
- **ASCII 与中文关键词分区匹配**：`CATEGORY_HINTS` 编译成 `COMPILED_HINTS`，纯 ASCII 词（`account`/`api`/`data`…）**只**匹配站名+关键词+域名+路径，含中文词才允许连同描述一起匹配。否则 `Sign in to your account` 会把 AI 站点判成账号类。
- **分类是白名单**：`categoryMeta` 里没登记的分类一律丢弃，保证推荐出的 `categoryId` 一定能通过 `addSite` 校验，不会写脏数据。
- **抓不到页面也出草稿**：403 反爬 / 超时 / 空响应都不算失败，按域名与分类表生成草稿并回 `warning`；若该域名（或同族域名）已收录，**直接沿用已收录站名** —— `chat.openai.com` 得到「ChatGPT」而不是拼出来的「Openai」。
- **不覆盖用户手改**：前端/控制台各维护一份 `touched` 标记，用户碰过的字段永不自动写入；换到**另一个域名**时整体重置（换了站就该重填），同域名重抓保留手改值。自动写入的字段加描边，一改动即摘掉。
- **请求序号守卫**：连续改网址时先发的慢请求可能后返回，用 `reqSeq` 丢弃过期响应，避免把新结果覆盖成旧的。

**验收结果**（实测）：

| 项 | 证据 |
|----|------|
| 引擎单测 | `node tools/console/test-infer.mjs` → **66 条断言全通过** |
| 控制台端到端 | `uniswap.org` → 名称 `Uniswap Interface` / 分类 `dex` / 配色 `#ff007a` / 状态行 `result ok`；改 `chat.openai.com` → 名称沿用为 `ChatGPT`、分类 `入门对话`、状态行 `result warn`（降级提示） |
| 前端端到端 | `github.com` → 名称 `GitHub` / 分类 `coding` / 配色 `#1e2327` / 图标预览有图 / 四个字段均带「自动 · 置信度」标签 |
| 手改优先 | 手改「站点名称」为 `我手改的名字TEST` 后点「重新补全」→ 名称保持手改值且标签消失，其余字段被刷新 |
| 构建 | `npx vite build` 通过 |

**排障记录（三条）**：

1. **用例 c7 失败不是匹配逻辑的问题**，而是测试夹具的 `CATEGORY_META` 没登记 `cex`，被分类白名单直接丢掉。修法是补夹具，而不是改引擎 —— 记住「分类白名单」这一层会先于打分生效，用例的期望分类必须先登记。
2. **浏览器实测「换域名不触发补全」是假象**。报告说把网址从 `github.com` 换成 `www.zhihu.com` 后没反应，实际是测试脚本的 `Ctrl+A` 没清空输入框，值被拼成了 `zhihu.comwww.zhihu.com`；证据是浏览器控制台出现了 `https://www.zhihu.comwww.zhihu.com/favicon.ico` 的请求 —— **补全确实被触发了**，只是域名是坏的。判定这类问题时，先看「有没有向新域名发出请求」，再看字段值。
3. **图标预览对部分站点为空属预期**：预览用的是页面声明的图标 URL，被热链保护拦下时 `@error` 会把 img 摘掉。真实下载由 `downloadIcon` 的多来源链（页面声明 → `/favicon.ico` → `favicon.im`，含占位图识别）负责，与预览无关。

### 21.15 M11 补丁：本地覆盖层修复「云端轮询冲掉本地改动」（2026-09-25）

**缺陷**：前端每 30 秒轮询 `/api/sites`，`applyCloudData` 直接 `sites.value = data.sites` 整体替换。访客在本地新增的站点、改过的字段、删掉的条目，下一轮轮询就被云端数据冲掉（只有 `visitCount` 因单独记账侥幸保留）。M11 让「新增站点」变得很顺手之后，这个缺陷的暴露面被显著放大 —— 用户刚补全并提交的站点，30 秒后自己消失。

**修法：本地覆盖层（overlay）**。`src/stores/sites.js` 拆成「云端基底 + 本地覆盖层」，用 `rebuild()` 拼出渲染列表：

| 覆盖层字段 | 语义 |
|-----------|------|
| `adds[]` | 本地新增的整条站点 |
| `edits{}` | 对云端站点的字段级补丁（按 id） |
| `deletes[]` | 「本地隐藏」墓碑（按 id），用于删掉云端站点 |
| `order[]` | 本地排序后的 id 序列，只描述这批 id 的相对次序 |
| `visits{}` | 访问计数 |

要点：

- **渲染列表不再等于云端数组**。`sites` 是 `rebuild()` 的产物，任何改动只写覆盖层再 `rebuild()`，不直接改 `sites`。云端下架的站点不在基底、也不在覆盖层，自然消失 —— 下架仍能正常传导。
- **`cloudSites` 只存云端基底**，`applyCloudData` 只换基底再 `rebuild()`，覆盖层原样保留。这是修复的核心：轮询不再有破坏性。
- **排序不写 `sortOrder`**。`reorderSites` 只记录 id 相对次序到 `order[]`；`sortOrder` 是云端全局序号，前端重排不该覆盖它。未登记的 id 排在其后且保持原相对位置（云端新收录的站点不会被挤乱）。
- **删除分两种**：本地新增的连数据一起删（从 `adds` 摘除）；云端来的只记墓碑（`deletes`），回收站恢复时撤墓碑即可，不需要重建数据。
- **发布后清层**：`AdminView.vue` 发布成功后先 `applyCloudData(data)` 用响应回填基底，再 `clearLocalOverlay()` —— 覆盖层内容此时已进云端，若不清掉会长期遮蔽后续云端变更（本地看到的水远是发布那一刻的快照）。顺序不能反，否则清层瞬间会回退到旧基底。

**验收结果**（临时联调服务实测，托管 `dist` + 可变云端数据 + `/api/_harness/bump` 抬高版本号）：

| 场景 | 证据 |
|----|------|
| 基线 | 清 SW/缓存/覆盖层后：云端 v100 / 298 站点，`nav-sites-overlay` 为 `null` |
| 本地新增 | 添加 `example.com` → 299 站点，覆盖层 `adds` 含 1 条 |
| 刷新保持 | F5 后仍 299，`adds` 完整 |
| **轮询不冲掉新增** | bump 到 v101 并等 40s 轮询 → **仍 299**，`adds` 未被清空 |
| **轮询不恢复已删** | 右键删除 `GitHub Copilot`（`cd2`）→ 298，`deletes: ["cd2"]`；F5 后仍 298；bump 到 v102 等 40s → **仍 298**，墓碑仍在 |
| 引擎单测 | `node tools/console/test-infer.mjs` → 66 条断言全通过 |
| 控制台信任边界 | `npm run console:test` → 13 条断言全通过 |
| 数据门禁 | `npm run validate` → 通过（9 条已知无图标站点为预期警告） |

**排障记录**：

1. **验证前必须清 Service Worker 与 Cache**。PWA 会把旧的 `dist` 资产长期缓存，直接访问会命中旧代码，表现为「改了没生效」。清理 `navigator.serviceWorker.getRegistrations()` + `caches.keys()` 后 reload 才可信。
2. **联调服务要托管构建产物而非 dev server**。dev server 不做 SW 注册，无法复现轮询与缓存行为；用 `dist` 才能验证到真实运行形态。
3. **临时联调服务不属于仓库产物**，验证完即删（`%TEMP%\nav-e2e\`），避免污染仓库。

### 21.16 M11 补丁 2：自动补全的「残留字段」与分类下拉错位（2026-09-26）

**背景**：按要求复查「只填网址即自动补全」链路（本轮未发布）。逐入口核对后确认上一轮修复均在位，另发现两个会写脏数据的缺陷。

**缺陷 A：换网址后抓取失败 → 上一站的字段被提交给新站**

`AddSiteModal` 只在抓取**成功**时 `applyMeta` 覆盖字段，失败分支仅把 `meta` 置空。于是「先补全 A 站成功 → 改成 B 站 → B 抓取失败/超时 → 提交」会把 A 的名称、描述、分类、图标原样存给 B。更常见的路径是：改完网址直接点「添加」，`blur` 触发的补全尚未返回，`submit()` 已拿上一站的 `faviconUrl` 落库。
控制台 `sitespanel.js` 同构：`saveSite` 把 `state.faviconUrl` 交给 `fetchIcon`，换网址后抓取失败时会把上一站的图标下载进新站的图标文件。

**修法**：

- 新增 `resetForNewHost()`：换域名即清空 `name / desc / categoryId / color / faviconUrl / faviconHost`，新域名从空白开始，抓取失败也不继承上一站。
- 新增 `faviconHost`：图标绑定在**响应自带的 `domain`**（而非当前输入框，避免响应晚到张冠李戴）；`submit()` 仅在 `faviconHost === 提交域名` 时才写 `iconUrl` —— 宁可让卡片回落字母块，也不挂错图。
- 两个失败分支（`!res.ok` 与 `catch`）显式清空图标，避免预览继续显示上一站的图。
- 控制台加 `state.faviconHost` 守卫，`openForm` 一并重置。

**缺陷 B：分类下拉预选 `starter`，与「未识别，请手动选择」自相矛盾**

`form.categoryId` 初值为 `'starter'`。补全返回未识别分类时 `applyMeta` 不覆盖（`hasCategory('')` 为假），下拉框仍显示「入门对话」，旁边却写着「未识别，请手动选择」—— 用户会静默提交错分类。

**修法**：初值改为 `''`，下拉框加 `<option value="" disabled>请选择分类</option>`。已识别时自动选中；未识别或抓取失败时由 `required` 拦住提交，迫使做一次显式选择，与上一轮「分类未生效就说未识别」的口径对齐。

**验收**：

| 项 | 结果 |
|----|----|
| 引擎断言 | `node tools/console/test-infer.mjs` → 76 条全通过 |
| SSRF 断言 | `node tools/console/test-guard.mjs` → 27 条全通过 |
| 信任边界 | `npm run console:test` → 13 条全通过 |
| 数据门禁 | `npm run validate` → 298 站点通过（9 条已知无图标为预期警告） |
| 构建 | `npm run build` → 通过 |
| 线上处理器实测 | 直连真实站点：`github.com` → GitHub / coding / `#1e2327` / fluidicon.png，无 warning；`zhihu.com` → 知乎 + 真实描述、分类留空（白名单宁缺毋滥）；`chat.openai.com` 本机超时 → 沿用已收录站名 ChatGPT + 生成描述 + 复核 warning；`127.0.0.1` 与 `169.254.169.254` → 400「该地址指向内网或本机」 |

**遗留观察（未改，待定夺）**：`api/sites-data.json` 有 20 条 `url` 带 `www.` 前缀（如 `www.stepfun.com`），其中 `www.kuaikejm.com/kk/index.html` 还带路径，与「只存域名」的约定不符。控制台 `normalizeUrl` 保留 www、前端弹窗剥掉 www，两个入口落库口径不同；去重走 `hostOf`（两侧都剥 www）故不会产生重复条目，仅存量数据不齐。统一需改数据文件并发布，本轮按「先不发布」未动。

---

## 二十二、更新：Tange Stock（dt17）URL 指向主域名（2026-09-26）

用户提交 `https://stock.tanggestock.com/`。经确认该**主机名已收录**（`dt17`），但存量 `url` 带 `/auth` 子路径 —— 按规则「同一域名更新而非新增，导航指向主域名」，不重复建条目，仅把 URL 收敛到根域名：

- 旧：`stock.tanggestock.com/auth`（子页）
- 新：`stock.tanggestock.com`（根域名；实测 HTTP 200 且无重定向，`num_redirects=0`）
- 名称 / 描述 / 分类（`data`）/ 配色（`#f59e0b`）/ 图标（`icons/dt17.jpg`，12KB 真实 JPEG）**均未改动**，`updatedAt` 同步刷新
- 命令：`nav sites update dt17 --url stock.tanggestock.com`（先 `--dry-run` 预演确认仅 `url` 一个字段变化）
- 验收：`nav sites check --ids dt17` → `200 ok`；`npm run validate` → 298 条通过（9 条已知无图标为预期警告）
- **已发布**：v97（2026-09-29）上线；线上 `/api/sites` 中 `stock.tanggestock.com/auth` 残留 0 处

**已确认并改名（2026-09-30）**：该站 `<title>` 与 `og:site_name` 均为「Super View — 交易级数据工作台」，与存量名称「Tange Stock」不一致（域名仍是 `tanggestock.com`）。用户确认以站点自称为准，执行 `nav sites update dt17 --name "Super View" --initial S`，首字母同步由 `T` 改为 `S`；`url` / 描述 / 分类 / 配色 / 图标均未改动。已随 v98（2026-09-30）上线，线上 `/api/sites` 中 `dt17.name === "Super View"`、`initial === "S"`。

---

## 二十三、站点收录：OpenMarket（2026-09-29）

新增站点 `dt33`（data 数据与研究分类，前缀 `dt`）：

| 字段 | 值 |
|------|----|
| id | `dt33` |
| name | `OpenMarket` |
| url | `openmarket.xyz`（根域名，未收 `/chart/rCYAmLvm` 图表子页） |
| desc | 面向全市场的行情情报终端（Market Intelligence Platform）：在一个工作区内整合图表、技术指标、画图工具与价格提醒，覆盖多类市场的行情追踪与盯盘分析。 |
| categoryId | `data`（数据与研究） |
| color | `#3861fb`（站点未声明 theme-color，回落分类色） |
| sortOrder | 299（全局递增，追加到数组末尾） |
| icon | `icons/dt33.png`（8156 字节真实 PNG，`nav sites icon dt33` 抓取） |

- 数据源：用户在 `https://openmarket.xyz/chart/rCYAmLvm` 提交（具体图表分享页），按「导航指向主域名」规则收录**根域名**；`normalizeUrl` 本身也只保留主机名
- 抓取结果：根域名 HTTP 200，`<title>` = `OpenMarket - Market Intelligence Platform`；站点声明 `/apple-touch-icon.png`（180×180，8156 字节），图标自动探测命中该地址（与 `/favicon.ico` 1150 字节相比更清晰）
- 分类归属：跨市场行情情报终端，与同分类既有 `dt17`（Tange Stock，同为交易数据工作台）口径一致，归入 `data`
- 描述口径：站点 meta 为英文（`OpenMarket is the market-intelligence terminal for all: charts, indicators, drawings and alerts for every market in one workspace.`），库内描述统一中文，已按站点实况改写
- 校验：`nav sites check --ids dt33` → `200 ok`；`npm run validate` → 299 条 / 29 分类通过（9 条已知无图标为预期警告）
- 发布：v97（2026-09-29）上线；云端 `version=97` / 299 站点 / 290 图标，第 1 次轮询即收敛；线上 `/icons/dt33.png` → 200 `image/png` 8156 字节（与本地一致）

---

## 二十四、核实：mcp-api.trader.dev 与 ac12 同产品，不新增（2026-09-29）

用户提交 `https://mcp-api.trader.dev/browse`。经核实该主机属**已收录产品** Trader.dev（`ac12`，`url` = `trader.dev`），按「同一产品不重复收录」规则**不新增条目**，`api/sites-data.json` 未改动：

| 域名 | 标题 | 体积 | 说明 |
|------|------|------|------|
| `trader.dev`（已收录 `ac12`） | `trader.dev — vibe trading, automated` | 1224 B | 品牌落地页，点击可进应用 |
| `mcp-api.trader.dev/` | `TraderDev -- Sign in` | 55308 B | 应用本体，根页为登录墙 |
| `mcp-api.trader.dev/browse` | `Browse Strategies — TraderDev` | 33386 B | 公开策略榜，免登录 |

- 同源证据：落地页 meta 的「one-click deploys to Bybit, Blofin, Toobit, and WeeX」与 `ac12.desc` 的部署目标完全一致，`/browse` 标题亦为 TraderDev
- 未收 `/browse` 子页：按「导航指向主域名、不收子页」规则处理（`normalizeUrl` 本身也只保留主机名）
- 决策：用户确认「不新增，保持现状」——保留落地页作为品牌入口，避免导航出现两张 Trader.dev 卡片
- 影响：无数据变更、无需发布

---

## 二十五、Nav V5 升级：MCP 服务化 · 发布可回退 · 审计与看板 · 分块暂存（2026-09-30）

V5 是一次**大版本升级**（不是增量小改），方案见 [`docs/NAV-v5-upgrade-plan.md`](docs/NAV-v5-upgrade-plan.md)。
五个里程碑 M1–M5 全部落地，共同的主线是：**把「能干活」升级为「敢交给智能体干」** ——
能力不变，但每一处有副作用的地方都补上了可预演、可回退、可追溯的约束。

### M1 · MCP 服务化：35 条命令 → 5 个域级工具

| 文件 | 作用 |
|------|------|
| `tools/mcp/server.mjs` | MCP 服务主体：工具定义（zod schema）、写操作闸门、stdio 传输 |
| `tools/mcp/lib/bridge.mjs` | 复用 CLI 命令层：把工具动作映射到 `commands/*.mjs` 的 `run()` |
| `tools/mcp/test-mcp.mjs` | 端到端用例：真实 stdio 握手，**65 条断言** |
| `tools/cli/lib/registry.mjs` | 命令注册表：**CLI 与 MCP 共用的唯一真相源** |

- **工具收敛而非平铺**：把 35 条命令平铺成 35 个工具会显著拉低智能体的选择准确率，
  因此收敛为 5 个域级工具 —— `nav_status` / `nav_sites` / `nav_publish` / `nav_git` / `nav_data`，
  每个工具用 `action` 枚举再分流。用例断言**恰好 5 个工具**且动作数受控（`nav_sites ≤ 12`）。
- **写操作闸门**：写动作默认**只预演**，返回 `gate.preview = true` + 将要发生的变化；
  必须显式传 `confirm: true` 才真正执行。用例覆盖两类事故：
  ① 不带 confirm 时数据文件字节数不变、git 索引计数不变（**确实没写**）；
  ② 带 confirm 时用一个不存在的 id 触发**业务拒绝**，证明真的进入了执行路径（而不是又返回一份预演）。
- **预演不降级校验**：未登记分类、域名重复、缺名称在预演阶段同样被拒 —— 不存在「预演放行、真跑翻车」。
- **不泄露密钥**：`nav_status` 只报「是否配置」，用例断言输出中匹配不到 `SITES_ADMIN_KEY=<值>`。
- 启动：`pnpm run mcp`；自测：`pnpm run mcp:test`。

### M2 · 云端数据快照 + 发布门禁 + 一键回滚

| 文件 | 作用 |
|------|------|
| `shared/snapshots.mjs` | 快照命名与保留策略（**纯函数**，无 IO）：命名、反解、裁剪 |
| `api/sites.js` | 云端侧：写前落快照、`GET ?snapshots` / `?snapshot=`、`POST {action:'rollback'}` |
| `tools/console/lib/snapshots.mjs` | 控制台侧快照编排（对照本机 `backups/`） |
| `tools/console/lib/gate.mjs` | 发布门禁：预检产出凭证 + 核销 |
| `tools/cli/commands/snapshots.mjs` | CLI：`publish snapshots` / `publish rollback` |

- **为什么要快照**：Blob 上的 `sites.json` 用 `allowOverwrite: true` 覆盖写，**没有对象版本控制**，
  写坏就是永久丢失。因此每次热更新前先把「将被覆盖的当前数据」另存一份，形成可回退的链。
- **命名必须零填充**：`sites-data.snapshots/<6位零填充version>-<ISO时间>.json`。
  零填充是关键 —— 这样 pathname 的**字典序 == 时间序**，否则 `v9` 会排在 `v10` 之后，按字典序裁剪会误删最新快照。
- **回滚不回退计数**：回滚把快照写回主 pathname，但 `version` 继续递增（`prevVersion + 1`），
  并记录 `restoredFrom` / `restoredAt`。计数单调递增，避免「版本号回退」引发的下游误判。
- **回滚本身可撤销**：回滚前先把「回滚前的当前数据」也存一份快照，所以误回滚还能再回滚回去。
- **保留最近 20 份**，超出自动裁剪；裁剪只删**合法快照名**，不会误删同前缀下的无关对象。
- **发布门禁 = 预检 → 人工放行**：预检只读（不改工作区、不写云端），展示将提交文件、待推送提交、
  云端版本对比、数据增删统计，并产出一枚**绑定工作区指纹**的放行凭证（10 分钟有效）。
  指纹由分支、HEAD、改动路径集合、数据文件内容摘要构成 —— 任一变化凭证立即作废，
  杜绝「预检时看的是 A，放行时提交的是 B」。
- **线上依赖**：`publish snapshots` / `rollback` 需要线上已部署 V5 代码；线上仍是旧版时会直接以
  退出码 4 提示「先发布 V5 代码」，不会静默失败（**这正是首次发布前的预期行为**）。

### M3 · 操作审计日志

| 文件 | 作用 |
|------|------|
| `tools/console/lib/audit.mjs` | 审计落盘、查询、轮转 |
| `tools/console/ui/auditpanel.js` | 控制台「审计」面板（按动作 / 结果筛选） |
| `tools/cli/commands/data.mjs` | `nav data audit --limit/--action/--result` |

- 落盘 `tools/console/.data/audit.jsonl`（JSONL 追加），超过 **2MB 自动轮转、保留最近 20 份**。
- 覆盖提交、推送、发布、放行 / 拒绝、回滚、站点增删改、校验失败等关键动作；
  **只记录已发生的事实，写入失败绝不阻断主流程**（审计是旁路，不能反过来把主流程搞挂）。
- 与发布门禁形成闭环：门禁放行/拒绝都留痕，事后可回答「这次发布是谁、什么时候、基于哪个工作区指纹放行的」。

### M4 · 站点可用性看板

| 文件 | 作用 |
|------|------|
| `shared/health-probe.mjs` | 探活与分级口径（**唯一真相源**） |
| `tools/console/lib/health.mjs` | 快照落盘、历史查询、探活任务编排 |
| `tools/console/ui/healthpanel.js` | 看板：状态徽标 + 响应时间趋势 + 探活轮次 |

- **口径同源**：控制台看板、CLI `nav sites check`、`scripts/check-sites.mjs` 共用 `shared/health-probe.mjs`，
  避免三处各写一套判定导致结论漂移。2xx/3xx 正常；**429/403/405/401 归「可忽略」**（限流/反爬，站点实际可用）；
  其余 4xx 与连接失败归「需处理」。
- **抑制 WAF 假宕机**：判定「需处理」前自动重试一次，连续失败才落 `down`，避免反爬抖动把正常站点标成宕机。
- 结果按天落盘 `tools/console/.data/health/YYYY-MM-DD.jsonl`，**保留 30 天**自动清理；
  趋势条按「左旧右新」排列（接口按新→旧返回，前端反转）。

### M5 · hunk 级暂存 / 取消暂存

| 文件 | 作用 |
|------|------|
| `shared/hunk-patch.mjs` | unified diff 的 hunk 边界解析 + 子集补丁生成（纯函数） |
| `tools/console/lib/git.mjs` | `applyHunks()`：`git apply --cached` 实现部分暂存 |
| `tools/cli/commands/git.mjs` | `git hunks` / `git stage-hunks` / `git unstage-hunks` |
| `tools/console/ui/diffview.js` | 每块一条工具条，右侧挂「暂存此块 / 取消暂存此块」 |
| `tools/console/test-hunks.mjs` | 用例：临时仓库实测，**72 条断言** |

- 等价于终端的 `git add -p`，但不必离开控制台：**只改索引，工作区文件不动**。
- **拒绝而非静默降级**：二进制文件、未跟踪文件、跨多文件的 diff、超出展示上限的差异一律显式报错。
- **失败回退**：补丁应用失败时把索引回退到操作前状态（`git update-index --cacheinfo`），不留半暂存中间态。
- **部分暂存的文件两侧都要出现**：一个文件可能同时有「已暂存的块」和「工作区的块」，
  若只在一侧显示，分块暂存后就再也进不去另一侧看剩余差异。故 `onStagedSide` / `onWorktreeSide` 分开判定。

### 本次修复

- **控制台「可用性」面板是死的**：`healthpanel.js` 功能完整、DOM id 全部对得上，但 `ui/app.js`
  从未 import 它 —— 面板渲染、按钮绑定、30 秒轮询全都没接上，点进标签页只有空白。
  已补 `initHealthPanel()`、标签切换 `refreshHealth()`、轮询分支三处接线。
  **教训**：新增面板时「文件建好 + DOM 写好」不等于「接线完成」，`app.js` 的 import / init / tab / poll 四处都要动。

### 验收

| 用例 | 断言数 | 命令 |
|------|--------|------|
| 控制台来源校验 | 13 | `pnpm run console:test` |
| 站点元信息推断 | 92 | `pnpm run console:test:infer` |
| metadata SSRF 防护 | 27 | `pnpm run console:test:guard` |
| hunk 分块暂存 | 72 | `pnpm run console:test:hunks` |
| MCP 端到端 | 65 | `pnpm run mcp:test` |

合计 **269 条断言全绿**；`pnpm run console:test:all` 一次跑完前四项。

> **发布提示**：M2 的云端快照 / 回滚依赖线上 V5 代码，**必须先发布一次**（`pnpm run publish`）
> 才能在线上使用 `publish snapshots` / `rollback`；发布前这两个命令会以退出码 4 明确提示。

### 发布记录：v98（2026-09-30）

首次以**发布门禁**方式上线 V5（预检 → 放行凭证 → 核销 → 发布），全链路一次通过：

- `nav publish preflight` → 凭证 `a3f420f3`（分支 master · HEAD 4f8103b · 领先 7 · 云端 v97/299）
- `nav publish run --gate a3f420f3` → 9 步全绿：推送 `7746ec4..4f8103b` → 备份 → 数据门禁 → 构建 → Vercel 部署 → Blob 热更新 → 一致性验证
- 结果：**version 98 · 299 站点 · 290 带图标**；第 1 次轮询即收敛（`useCache:false` 生效）
- 云端快照落盘：`sites-data.snapshots/000097-2026-09-30T10-24-53-641Z.json`（发布前数据，可一键回滚）

发布后逐项实测：

| 能力 | 命令 | 结果 |
|------|------|------|
| 快照清单 | `nav publish snapshots` | 云端 1 份 + 本机 `backups/` 26 份对照 |
| 回滚预演 | `nav publish rollback <pathname> --dry-run` | 正确算出 `willRevert: [dt17 的 name/initial]`，未写入 |
| 审计查询 | `nav data audit --limit 8` | 11 条留痕，含预检 / 放行（指纹 `80d7dc67bdbd81d2`）/ 推送 / 快照 / 热更新 / 发布完成 |
| 线上收敛 | `nav publish status` | 本地 299 · 云端 299 ✅ · 云端 v98 |
| MCP 端到端 | `pnpm run mcp:test` | 65 条断言全绿 |

**顺带修复**：`gate.mjs` 的放行凭证原先只存进程内存，导致 `preflight` 与 `run --gate` 分属两个进程时永远核销不了（控制台内因常驻进程共享内存而看不出）。已改为落盘 `.data/gates.json`（原子写 tmp + rename，写入失败不阻断主流程），跨进程放行恢复正常。

---

## 二十六、站点收录：华润赢（2026-09-30）

用户提交 `https://huarun.win/platform/windows`。核实结果：

- **主域名未收录**（`nav sites list --q huarun` → 0 条），故新增条目 `bs9`（代理/VPN 分类，前缀 `bs`）。
- **按规则指向主域名而非子页**：`/platform/windows` 是主站的 Windows 分栏（51 款客户端），主站 `huarun.win` 本身即完整产品（166 款、覆盖 7 个平台），符合「特定子页不单独收录，导航指向主域名」。
- 实测两页均 `HTTP 200`：根页 675KB、子页 384KB，无重定向。

| 字段 | 取值 | 来源 |
|------|------|------|
| `id` | `bs9` | 自动递增 |
| `name` | 华润赢 | `og:site_name`（根页 `title` 为「华润赢 · 翻墙应用商店与代理客户端大全」） |
| `url` | `huarun.win` | 收敛到根域名 |
| `desc` | 翻墙应用商店与代理客户端大全，收录 166 款 Android/iOS/Windows/macOS/Linux/HarmonyOS/OpenWrt 代理客户端… | 人工依根页 `meta description` 重写 |
| `categoryId` | `proxy` | 推断置信度 high（命中 proxy/vpn/机场/科学上网/代理工具 品牌词+关键词） |
| `color` | `#a855f7` | 分类色 |
| `initial` | 华 | 取名称首字 |
| `icon` | `icons/bs9.png` | `apple-touch-icon.png?v=huayun-1`，真实 **180×180 PNG / 2685B** |

- **描述口径修正**：`nav sites meta` 抓子页时给出的是「51 款 Windows 代理客户端」，但收录的是主域名，故改用根页口径（166 款 / 7 平台），并在描述里保留「Windows 单平台 51 款（40 款开源）」作为具体佐证。
- 命令：`nav sites add --url huarun.win --name "华润赢" --desc "…" --category proxy --color "#a855f7"`（先 `--dry-run` 预演确认 id/字段，再实际写入）→ `nav sites icon bs9`
- 验收：`nav data validate` → 300 条通过（9 条已知无图标为预期警告）；`nav sites check --ids bs9` → `200 ok`
- **已发布**：`bs9` 随 v99 上线（云端 300 条），见下节发布记录。

---

## 二十七、自动抓取引擎升级 + 发布收敛（2026-09-30）

用户提交子页 `https://huarun.win/platform/windows` 时，`nav sites meta` 给出的是**子页口径**描述
（「51 款 Windows 代理客户端」），而收录的永远是主域名 —— 信息被窄化，与卡片指向的整站对不上。
本次针对「添加站点」的自动抓取引擎做四项升级，两个入口（线上 `api/metadata.js` / 控制台
`tools/console/lib/sites.mjs`）共享同一份 `shared/site-infer.mjs`，口径同步。

| 升级项 | 说明 |
|--------|------|
| 根页信息补全 | 贴子页时**并行**补抓主域名首页（共享同一超时预算），名称/描述优先取站点级信息；响应新增 `scope` 字段标注字段取自 `root` 还是 `page` |
| 错误页标题剔除 | 新增 `ERROR_TITLE` 正则，`4xx/5xx`、`Not Found`、`页面不存在` 等不再被当成站名（数字状态码须独立成词，不误伤 `Proxy404` 这类站名） |
| 描述优先级固定 | `description > og:description > twitter:description …` 固定优先级，同组取最长，取值不再受 meta 标签书写顺序影响 |
| 多页图标回退 | `pickFaviconPrefer`：子页未声明图标时回退根页声明的图标（`pickFavicon` 恒返回兜底 `/favicon.ico`，故以「是否等于兜底」判断有无声明） |

- 前端 `AddSiteModal.vue` 与控制台 `sitespanel.js` 同步标注「名称/描述取自主域名（非当前子页）」，
  避免用户看到描述与当前子页不符时误以为补全出错。
- `test-infer.mjs` 新增 16 条断言（76 → **92**），覆盖错误页标题、描述顺序无关性、子页/根页融合、
  多页图标回退、仅根页被拦截时不判整体 blocked。

**发布记录：v99 / v100（2026-09-30）**

- v99：`bs9` 收敛（本地 300 → 云端 300）。
- v100（引擎升级）：`nav publish preflight` → 凭证 `54a54110`（分支 master · HEAD f0e1c1d · 云端 v99/300）
  → `nav publish run --gate 54a54110` → 9 步全绿：备份 → 数据门禁 → 构建 → Vercel 部署 → Blob 热更新 → 一致性验证。
  - 结果：**version 100 · 300 站点 · 291 带图标**；第 1 次轮询即收敛。
  - 快照：`sites-data.snapshots/000099-2026-09-30T10-55-00-622Z.json`（发布前数据，可一键回滚）。
- 提交：`7369982 feat(infer): 升级站点元信息抓取引擎`（已推送 origin/master）。
  - 注：`publish run` 只提交**已暂存**文件，本次先发布后补提交，故发布流水线的「提交」步骤被跳过；
    代码经工作区直接构建部署，与提交内容一致。

线上实测（`https://navigator-v2-two.vercel.app/api/metadata`）：

| 目标 | 结果 |
|------|------|
| `https://vercel.com/docs`（子页） | `name=Vercel`、`desc=The autonomous stack for every app and agent.`、`scope={name:root,desc:root}`、图标取根页 apple-touch-icon ✅ |
| `https://huarun.win/platform/windows`（子页） | 目标对 Vercel 出口 IP 返回 403 → 按已收录 `bs9` 沿用站名 `华润赢`，`warning` 提示复核（目标侧限流，非引擎问题） |

本地实测（`nav sites meta https://huarun.win/platform/windows`）：名称/描述均取根页口径
（166 款 / 7 平台），`scope={name:root,desc:root}`，分类 `proxy`（high），图标取根页。

---

## 二十八、站点收录：OpenChainBench（2026-09-30）

- **dt34 · OpenChainBench · openchainbench.com · 分类 数据与研究（`data`）**
- 定位：加密货币基础设施的公开基准测试站 —— 实时对比主流链的 RPC 延迟、跨链桥费用、
  L2 最终性与价格喂价准确度，方法论公开、数据持续更新。
- 来源：用户提交 `https://openchainbench.com/`；`nav sites meta` 识别名称 `OpenChainBench`
  （og:site_name · high）、描述（meta · medium），**分类未识别**（low），人工归入 `data`。
- 卡片主色 `#7a2e1f`：取自站点 `manifest.webmanifest` 的 `theme_color`。页面 `<head>` 未声明
  meta theme-color，故引擎回退到 hash 色 `#313db9`；此处按品牌真实色落库。
- 图标：`icons/dt34.png`（180×180 PNG，14977 B），源 `https://openchainbench.com/apple-icon`。
- 验收：`nav data validate` → 301 条通过（9 条已知无图标为预期警告）；`nav sites check --ids dt34` → `200 ok`。

> 引擎待办（已于同日晚修复）：原 `pickColor` 只读页面 `<meta name="theme-color">`，不读
> `manifest.webmanifest` 的 `theme_color`，遇到「主题色只写在 manifest」的站点会退化为 hash 色。
> 本次收录时手工落库，随后已在下一节完成引擎修复（现可自动识别 `#7a2e1f`）。

---

## 二十九、引擎修复：pickColor 支持 manifest theme_color + 发布（v102，2026-09-30）

`dt34`（OpenChainBench）暴露的问题：品牌色只写在 `manifest.webmanifest` 的 `theme_color` 里，
页面 `<head>` 仅声明了按配色方案区分的两条 `meta theme-color`（light `#ffffff` / dark `#0a0b0d`），
两者都被 `normalizeColor` 判为「无辨识度」。旧逻辑只取文档**第一条** theme-color 且只判**存在性**，
于是拿到白色、进而退化成分类色 / hash 色。

| 改动 | 说明 |
|------|------|
| 新增 `pickThemeColor(html)` | 遍历**全部** `meta theme-color`（兼容 `name`/`property`），返回**第一条可用**值；都不可用返回空串，交由调用方继续找 manifest |
| 新增 `manifestHref(html, base)` | 解析 `<link rel="manifest">` 并相对化，跳过 `data:` 内联声明 |
| 新增 `manifestThemeColor(text)` | 从 manifest JSON 取 `theme_color`，解析失败 / 字段缺失返回空串 |
| `inferColor` 新增 `manifestTheme` | 优先级：`meta theme-color` → manifest `theme_color` → `msapplication-TileColor` → 分类色 → 散列色 |
| `inferSite` 透传 `manifestTheme` | `manifest` 来源与 `meta` 同为 `high` 置信度 |

- 两个入口同步：`api/metadata.js`（复用带逐跳 SSRF 校验的 `fetchHtml`）与
  `tools/console/lib/sites.mjs`（走 `curl.exe`）。**仅在页面无可用 meta 主题色时才抓 manifest**，
  避免为绝大多数站点平白多一次请求。
- 前端 `AddSiteModal.vue` 新增配色来源文案「来自站点 manifest 主题色」。
- `test-infer.mjs` 新增 16 条断言（92 → **108**），覆盖多 theme-color 取用、manifest 地址解析、
  主题色优先级（白色 meta 回退 manifest、manifest 优先于 tile 色）。

**发布记录：v102（2026-09-30）**

- `nav publish preflight` → 凭证 `93c2db03`（分支 master · HEAD 182cc7b · 云端 v101/301）
  → `nav publish run --gate 93c2db03` → 9 步全绿：推送 → 备份 → 数据门禁 → 构建 → Vercel 部署 →
  Blob 热更新 → 一致性验证。
  - 结果：**version 102 · 301 站点 · 292 带图标**；第 1 次轮询即收敛。
  - 快照：`sites-data.snapshots/000101-2026-09-30T12-49-20-725Z.json`（发布前数据，可一键回滚）。
- 提交：`182cc7b fix(infer): 支持读取 manifest theme_color，修复仅声明在 webmanifest 的站点配色退化`
  （已推送 origin/master）。
- 线上实测（`/api/metadata?url=https://openchainbench.com/`）：`color=#7a2e1f`、
  `sources.color=manifest`、`confidence.color=high` ✅（修复前为 hash 色 `#313db9`）。

---

## 三十、站点数据新增 `aliases` 字段 + 别名录入（2026-10-01，Nav V5「找得到」）

检索此前只认 `name / url / desc`，中文用户敲「币安」「小狐狸」「抱抱脸」「火币」找不到站点 ——
而这些正是他们最自然的叫法。本次为站点数据引入可选的 `aliases: string[]`，并完成全量录入。

### 30.1 字段与录入口径

- **字段**：`aliases?: string[]`，可选。缺失 / 空数组等价于「无别名」，前端与校验器都按此处理。
- **收录口径**（宁缺毋滥，别名只增加召回、不改动主名称的排序地位）：
  1. 中文俗称 / 官方中文名 —— 币安、欧易、小狐狸、扣子、抹茶、慢雾、律动
  2. 中英互译 —— 豆包 → `Doubao`，英文站补中文名
  3. 曾用名 —— HTX 的「火币」、OKX 的「OKEx」、Make 的「Integromat」
  4. 通用缩写 —— `GPT`、`MJ`、`SD`、`CMC`、`HF`
- **明确不收**：代币代码（UNI / TAO）、与站名仅大小写不同的写法、字面直译但社区不这么叫的
  （Uniswap→优尼斯瓦普）、歧义过大的两字母词（MM / TV / CG / ME）。
- **类别级通用词也不收**：`空投`、`临时邮箱` 挂在个别站点上会造成「搜『空投』只出两个站、
  其余同类站点不出现」的误导 —— 这类词归分类，不归别名（脚本 `DROP` 表显式移除）。
- **录入结果**：**135 个站点 / 176 条别名**（原始映射 221 条，剔除无检索价值项后落库）。
  仅 `苹果id`（acc1/acc2）、`hero sms`（sm8/sm17）两条在站间重复，均为同品牌 / 同品类，属预期。

### 30.2 检索内核：别名参与评分

`src/utils/search.js` 评分档位扩为（高 → 低）：

```
名称精确 1000 > 别名精确 940 > 名称前缀 820 > 别名前缀 760
> 名称包含 640 > 别名包含 580 > 域名 520 > 描述 440
> 拼音首字母前缀 400 > 别名拼音首字母前缀 380
> 拼音名包含 340 > 别名拼音包含 320 > 拼音描述 200
```

- 别名排在「同名档位之后、域名 / 描述之前」：既让俗称找得到，又不喧宾夺主。
- `keysOf()` 的 `WeakMap` 缓存新增 `aliases / pyAliases / pyAliasInitial`，拼音只算一次。
- Fuse 模糊兜底新增 `aliases` 键（权重 1.6），拼写近似时俗称同样能兜住。
- 新增 `matchedAlias(site, query)`：返回命中的别名（精确 > 前缀 > 包含 > 拼音），
  供 UI 解释「这条为什么会出现」；无命中返回 `''`。

### 30.3 界面与编辑入口

| 位置 | 改动 |
|------|------|
| `SiteSearchBar.vue` | 结果名称后新增 `别名 · 币安` 标签（`.suggestion-name` 改 flex，名称分段包进 `.suggestion-name-text` 以免高亮被拆成多个 flex 项）；placeholder 补「别名」 |
| `command/CommandResults.vue` | 命令面板站点行 URL 前显示 `别名 · X` |
| `AddSiteModal.vue` / `EditSiteModal.vue` | 新增「别名」输入（逗号 / 顿号分隔），`parseAliases()` 归一：去重 + 剔除与站名 / 域名同形项 |
| `tools/console/lib/sites.mjs` | `EDITABLE` / `LIST_FIELDS` 加入 `aliases`；新增 `normalizeAliases()`；列表搜索覆盖别名；`updateSite` 清空即删除字段 |
| `tools/console/ui/` | 表单新增「别名」宽字段；列表行显示 `别名 N` 徽标 |
| `scripts/validate-data.mjs` | 校验 `aliases` 必须是非空字符串数组、无站内重复；与站名 / 域名同形仅告警 |

### 30.4 验收

- `node scripts/seed-aliases.mjs`（幂等，写入前自动备份至 `backups/sites-data-*.json`）：
  首轮 +137 站 / +180 条，清理轮 -4 条，最终 **135 站 / 176 条**。
- `npm run validate` → 301 条通过（9 条已知无图标为预期警告）。
- `node probe/_search-test.mjs` → **42 passed / 0 failed**（新增 A7.1–A7.16 共 16 条别名断言：
  俗称 / 曾用名 / 缩写 / 别名拼音 / 别名首字母命中，别名精确档位与主名称档位不互相压制）。
  - 注：A4.3 / A4.4 由 `wushuo` 改为完整全拼 `wushuoqukuailian` —— md5 新增别名 `WuShuo`
    会截走前缀查询，完整全拼不是任何别名的子串，才能真正隔离「名称拼音」路径。
- `npm run build` → 通过（`index-*.js` 688.66 kB / gzip 312.21 kB）。
- `npm run console:test:all` → 全部通过（trust 13 / infer 108 / guard 27 / hunks 72）。

---

## 三十一、「发布 + 管理」合并大模块（2026-10-01，Nav V5「可运维」）

此前发布与运营能力散落在三处：本地控制台只做「提交 → 推送 → 发布 → 热更新」，
线上 `/admin` 只做「改站点数据 + 推云端」，CLI 只能跑零散命令。三者各写一套逻辑，
语义漂移、体验割裂。本次把它们合并成一个**共用内核、双端等价、双入口**的大模块。

### 31.1 架构：一套内核，两端入口

```
        ┌──────────────── 共用内核 shared/ops/（纯逻辑，零依赖） ────────────────┐
        │  site-ops   pipeline   publish-history   notify-core   audit-core     │
        └───────┬───────────────┬───────────────┬──────────────┬───────────────┘
                │               │               │              │
   本地控制台 ──┼───────────────┼───────────────┼──────────────┼──── 线上 /admin
   （tools/console）             │               │              │     （api/ops.js + src/components/admin/）
                │               │               │              │
   CLI nav ─────┴───────────────┴───────────────┴──────────────┴──── MCP nav_* 工具
```

- **双端等价**：本地控制台与线上 `/admin` 共用同一批纯函数，同一份记录结构、同一套分级口径。
  两端能在同一套语义下对比同一段历史，避免「本地看着成功、线上看着失败」。
- **双入口**：能力同时挂在「本地控制台」与「线上管理后台」，各自服务不同场景
  （本机全链路发布 vs. 任意地点改数据 / 看历史）。
- **内核边界**：`shared/ops/*` 只放纯逻辑，不碰文件系统 / 网络 / Blob ——
  落盘在 `tools/console/lib/*`，云端持久化在 `api/ops.js`，两端各自注入。

### 31.2 内核清单（`shared/ops/`，5 个文件）

| 文件 | 职责 | 关键导出 |
|------|------|---------|
| `site-ops.mjs` | 站点数据纯逻辑：字段定义、URL 归一、校验、diff、完整性体检、批量操作 | `SITE_FIELDS` `normalizeUrl` `validateSite` `diffSites` `checkIntegrity` `BATCH_OPS` `applyBatch` `batchSummary` `matchSite` |
| `pipeline.mjs` | 发布流水线定义与状态机：步骤目录、三段管线、执行端能力、推进 / 收敛 | `STEP_CATALOG` `FULL_PIPELINE` `DATA_ONLY_PIPELINE` `CLOUD_PIPELINE` `RUNNER_CAPS` `planPipeline` `markStep` `advanceTo` `pipelineVerdict` |
| `publish-history.mjs` | 发布历史记录模型与检索：归一、排序、筛选、概览、裁剪、回退目标推导 | `HISTORY_KEEP` `TRIGGERS` `normalizeRecord` `filterRecords` `summarizeRecords` `prunableRecords` `rollbackTarget` |
| `notify-core.mjs` | 通知中心：类型目录、级别口径、聚合键折叠、Webhook 投递体 | `NOTIFY_KINDS` `SEVERITY_LABEL` `buildNotification` `collapseNotifications` `filterNotifications` `webhookPayload` `notificationText` |
| `audit-core.mjs` | 审计事件：动作目录、归一、筛选、概览、动作中文名 | `AUDIT_ACTIONS` `normalizeEntry` `filterEntries` `summarizeEntries` `actionLabel` |

**批量操作目录 `BATCH_OPS`**（`destructive` 的 UI 必须二次确认；`patchKeys` 声明写哪些字段，
供前端表单与影响面预览共用）：

| op | 标签 | 写字段 | 说明 |
|----|------|--------|------|
| `category` | 改分类 | `categoryId` | 整体迁移到另一分类 |
| `color` | 改配色 | `color` | 统一主题色 |
| `aliasAdd` | 追加别名 | `aliases` | 在既有别名上追加（不覆盖） |
| `aliasSet` | 替换别名 | `aliases` | 整体替换别名列表 |
| `icon` | 清空图标 | `icon` | 清空引用，前端回落分类色块 + 首字母 |
| `remove` | 删除站点 | — | `destructive`，不可撤销 |

**发布流水线三段**（`RUNNER_CAPS` 决定执行端能跑哪些步骤，跑不了的显式 `skipped` 而非静默略过）：

- `FULL_PIPELINE`：check → commit → push → backup → validate → build → deploy → hotupdate → verify（本地控制台）
- `DATA_ONLY_PIPELINE`：check → commit → push → backup → validate → hotupdate → verify（只同步数据）
- `CLOUD_PIPELINE`：validate → hotupdate → verify（线上后台无 git / 构建能力，从门禁起步）

### 31.3 本地控制台（`tools/console/`）

| 位置 | 能力 |
|------|------|
| `lib/sites.mjs` | 新增 `previewBatch()` / `batchOp()`（`dryRun=true` 时与预演完全等价，CLI `--dry-run` 复用）；`BATCH_OP_LIST` 供前端渲染操作下拉 |
| `lib/publishlog.mjs` | 发布历史落盘 `tools/console/.data/publish-history.jsonl`；整文件重写以支持裁剪；**写入失败绝不阻断发布**（历史是旁路） |
| `lib/notify.mjs` | 通知中心落盘 + 未读统计 + Webhook 投递 |
| `lib/schedule.mjs` | 定时巡检：按间隔探活全站，按「状态翻转」差集推送通知（一直宕着的不每轮刷屏） |
| `lib/api.mjs` | 新增 `/api/sites/batch/preview`（只读）、`/api/sites/batch`、`/api/publish/history`、`/api/notify*`、`/api/schedule*`；批量结果里 `next` 是整份 300+ 条站点数组，`stripNext()` 不回传前端 |
| `ui/sitespanel.js` | 批量选择模式（复选框 + 全选本页 + 已选计数）、操作下拉与动态字段、影响面预演、执行、取消选择 |
| `ui/syncpanel.js` | 发布历史卡片：摘要统计（总数 / 成功 / 失败 / 成功率 / 平均耗时）、按结果 / 来源 / 关键词筛选、审计行样式复用 |
| `ui/notifypanel.js` | 通知中心：类型 / 级别 / 只看未读筛选、全部已读、清空、Webhook 配置与测试投递、定时巡检配置 |

### 31.4 线上 `api/ops.js` + `/admin` 组件

- **`api/ops.js`（新增，运维面）**：发布历史与通知中心的 Blob 持久化与查询。
  与 `api/sites.js`（**数据面**）刻意分开 —— 数据面必须简单、失败面小（热更新是用户可感知的关键路径），
  运维面是旁路，写失败不该拖慢发布。全部要求 `Bearer <SITES_ADMIN_KEY>`。
  - 读：`?limit=&ok=&trigger=&q=` 取发布历史；`?notifications=1&severity=&kind=&unread=&q=` 取通知。
  - 写：`history.append` / `notify.push` / `notify.read` / `notify.clear`。
  - 存储：`ops/publish-history.json`（保留 `HISTORY_KEEP` 条）、`ops/notifications.json`（保留 200 条）。
- **`src/services/opsApi.js`（新增）**：前端封装，统一带 Bearer；密钥缺失由调用方先行拦截。
- **`src/components/admin/`（新增 4 个组件，AdminView 拆分为壳 + 业务子组件）**：

  | 组件 | 能力 |
  |------|------|
  | `AdminBatchBar.vue` | 批量选择 + 操作 + 影响面预演（与本地控制台同目录同语义） |
  | `AdminSnapshots.vue` | 云端快照清单 + 一键回滚 |
  | `AdminPublishHistory.vue` | 发布历史列表 + 概览 + 筛选 |
  | `AdminNotifications.vue` | 通知中心 + 未读角标（`@badge` 上抛给壳） |

  发布成功后必须先 `applyCloudData(响应)` 再 `clearLocalOverlay()`，顺序反了会瞬间回退到旧基底。

### 31.5 CLI 与 MCP

- **CLI `nav sites batch`**：`--op <category|color|aliasAdd|aliasSet|icon|remove> --ids <id,id,...>`；
  删除（`destructive`）在非 `--dry-run` 时**必须显式 `--yes`**，否则拒绝执行；`--dry-run` 只预演影响面。
- **CLI `nav ops`（新增命令组）**：`history` / `notify` / `notify-read` / `notify-clear` / `webhook` /
  `webhook-set` / `inspect`。与本地控制台、线上后台共用同一批内核与同一份数据来源。
- **MCP**：`nav_sites` 新增 `batch` 动作；新增 `nav_ops` 工具（7 个动作）。
  写操作默认只预演，须带 `confirm: true` 才真跑；工具数收敛在 6 个（`nav_status` / `nav_sites` /
  `nav_publish` / `nav_ops` / `nav_git` / `nav_data`），远离膨胀阈值。

### 31.6 验收

- `npm run console:test:all` → 全部通过：trust（13）/ infer（108）/ guard（27）/ hunks（72）/
  **ops（62，新增）** / **api-ops（12，新增）**。
  - `test-ops.mjs`：钉死五个内核的关键契约 —— 批量预演必须等于实写、云端执行端必须显式跳过跑不了的步骤、
    通知必须按聚合键折叠、发布记录必须能从快照推导出回退目标。
  - `test-api-ops.mjs`：用 `node:test` 的模块 mock 顶掉 `@vercel/blob`，把 `api/ops.js` 当普通函数调，
    在本地跑通「鉴权 / 路由 / 落盘语义」，不依赖网络与凭据（含 500 / 401 / 400 / 405 异常路径）。
- `npm run mcp:test` → **98 条断言全通过**（新增 `nav_sites batch`、`nav_ops` 契约与闸门断言）。
- `npm run validate` → 301 条通过（9 条已知无图标为预期警告）。
- `npm run build` → 通过。`AdminView` 已拆为独立懒加载 chunk（`AdminView-*.js` 29.82 kB / gzip 11.42 kB），
  主包 `index-*.js` 685.76 kB / gzip 311.38 kB。
- `node probe/_console-probe.cjs` → 控制台 UI 实测全绿、**0 控制台报错**：
  - 通知面板：8 条通知、类型 / 级别下拉齐全、角标随「全部已读」即时归零；
  - 同步面板：发布历史摘要 + 2 行记录 + 来源筛选下拉 + 5 份云端快照；
  - 站点面板：**301 行 / 301 复选框**、批量操作下拉 6 项、批量卡片随选择态显隐、
    已选计数（`已选 2 / 显示 301`）→ 预演影响面 → 取消选择归零。
- CLI 冒烟：`nav help`（新增「运维事件与通知」命令组）、`nav ops history` / `notify` /
  `sites batch --dry-run` / `ops inspect --dry-run` 均返回预期契约。

---

## 三十二、导航结构重设计（2026-10-01，Nav V5「好找」）

侧栏此前把「范围 + 全部 30 个子分类」堆在同一列，信息密度过高、层级不清；且分类进路径
（`/c/:id`）导致「收藏 + 币圈」这类组合无法表达 —— 在收藏页点任一方向筛选就被弹回全量范围。
本次把导航拆成**三根互不挤占的轴**，并把子分类整体搬到中间栏。

设计稿见 `docs/NAV-v5-nav-optimization.html`。

### 32.1 三轴正交模型

| 轴 | 取值 | 承载位置 | 状态表达 |
|----|------|---------|---------|
| **范围** | 全部 / 收藏 / 最近 / 内容聚合 / 回收站 | 侧栏 5 项 + 移动端底部 tab | **路径**：`/` `/favorites` `/recent` `/feed` `/trash` |
| **域** | 全部 / AI 学习 / 币圈 / 工具 / 基础服务 | 中间栏一级分段控件 | **query** `?c=` |
| **筛选** | 子分类（30 个，按域分组） | 中间栏二级 chips | **query** `?c=`（与域共用同一参数） |

关键约束：**范围进路径、筛选进 query**。两轴各自独立，才能在 `/favorites?c=cex` 上同时表达
「收藏里看交易所」，范围不会被筛选挤掉。

### 32.2 侧栏瘦身 + 移动端 off-canvas 抽屉

- `Sidebar.vue` 只保留 5 个范围项 + 底部设置/折叠入口，子分类整体迁出（这是「太乱」的根因）。
- 桌面折叠 `240px → 60px`，折叠态图标居中、隐藏文字与徽标；偏好持久化（`AC-10`）。
- ≤768px：侧栏改为 `position: fixed` 的 off-canvas 抽屉（`transform: -307.5px ↔ 0`）+ 遮罩，
  不再挤压内容区（`mainW=375`，`hOverflow=0`）；点遮罩关闭。
- 新增 `MobileTabBar.vue`（全部 / 收藏 / 最近 / 更多）：底部拇指可达；「更多」拉起抽屉
  复用同一份侧栏，不做第二套导航。

### 32.3 中间栏两级筛选条（`FilterBar.vue`）

- **一级域 tabs**：带计数（`全部 301 | AI 学习 79 | 币圈 168 | 工具 45 | 基础服务 9`）。
- **二级 chips**：未选域时**按域分组多行铺开**（每组自带换行，标签不会被甩到行尾）；
  选中域后只列该域子分类，首位固定「全部」用于退回整域。
- **再点已选中的子分类 = 退回它所属的域**，避免「只能前进不能后退」。
- 域是派生量：选了子分类时其所属域保持高亮，用户不丢方向感。
- **计数基准跟随范围轴**：收藏范围内只数收藏，否则数字与下方列表对不上。
- 多行铺开 + **无横向滚动条**（探针实测 `chipRowOverflowX=0`）。

### 32.4 工具栏合并（`MainToolbar.vue`）

- **站内检索与站外搜索合并为一个统一搜索框** `UnifiedSearchBox`（由 `SiteSearchBar` 改名并吸收
  `ExternalSearchBox`）。框内左侧是引擎前缀下拉（Google / Bing / 百度 / DDG / PPLX，短标签避免被
  `DuckDuckGo` 撑宽，设置面板内仍是全称），引擎选择持久化；放大镜兼作「立即站外搜索」按钮。
  下拉 = 站内站点建议（上）+ **常驻的站外搜索页脚**（下，跟随所选引擎、可被 ↑/↓ 选中）。
  回车路由：↑↓已选 → 尊重选择；已收录 → 定位；输入像网址 → 一键添加；站内有命中 → 打开第一个站点；
  其余 → 用当前引擎搜站外。站外搜索用 `window.open(\`${engine.url}?q=…\`)`，等价于旧原生
  `<form method="GET" name="q">` 的拼接。
- 排序 / 批量选择 / 手动排序 / 视图切换 / 待办 / 主题 / 设置 收敛为一行，统计信息下沉。
- 响应式收敛：≤1500px「选择 / 手动排序」只留图标（tooltip 补文案）；≤1360px、≤1300px 逐级收窄统一搜索框宽度。

### 32.5 URL 状态化与旧链接兼容（`router/index.js`）

- 范围进路径，分类与搜索进 query（`?c=` / `?q=`）。
- 旧链接不失效：`/c/:id` 与 `/category/:id` 重定向到 `/?c=:id`，并**保留其余 query**（如 `sort=hot`）。
- 浏览器返回键逐级回退：`/favorites(9) → /favorites?c=crypto(7) → /favorites(9)`，计数复原。
- `/admin` 与 404 走独立布局，不被主导航壳包裹。

### 32.6 首屏内容优先

合并工具栏 + 统计下沉 + 移除冗余组件后，chrome 压到 **2 行 / 281px**（`gridTop=309`），
1440px 首屏可见 **8 张卡片**（验收线 ≥6）。

### 32.7 验收

- **布局 / 交互探针**：`probe/_measure.html`（30 个用例，`node probe/_run-probe.cjs` 驱动真实窗口）→
  **★ 全部断言通过**：
  - AC-2 移动端抽屉开合 3/3；AC-3 返回键 3/3；AC-4 侧栏首屏可见；AC-5 命令面板可检索分类；
    AC-6 首屏内容优先；AC-7 键盘全链路；AC-8 旧链接兼容 7/7；AC-9 能力无回归 8/8；AC-10 侧栏偏好持久化。
  - 交互快照 16 个：计数≠卡片数 **0**、范围被挤掉 **0**。
  - 断点实测 375 / 768 / 1024 / 1280 / 1440 / 1920，`hOverflow=0`（无横向溢出）。
- `node probe/_search-test.mjs` → 42 passed / 0 failed。
- `npm run build` → 通过。
- 探针产物（报告 / 截图 / 日志）由 `.gitignore` 排除，不入库。

## 三十三、纯前端管理入口可见化（2026-10-01，Nav V5「可运维」）

### 33.1 背景

`/admin` 此前只有两条入口：命令面板 `⌘K` →「管理后台」，或手敲 URL。主界面（侧栏 / 工具栏 / 设置）
均无可见入口，普通用户基本找不到 —— 与「完全在前端做管理」的目标不符。

### 33.2 改动

- `Sidebar.vue` 底部新增常驻「管理后台」按钮（齿轮图标，次级虚线样式，区别于实心「添加网站」），
  点击 `router.push('/admin')`，移动端自动收起抽屉。
- 底部区重构为 `.sidebar-bottom` 容器：统计 / 时钟 /「添加网站」在折叠态整体收起
  （`v-show="!isCollapsed"`），「管理后台」**常驻**，折叠态收为居中图标（`width:44px` + tooltip），
  保证任何状态都可达。
- `.sidebar-footer` 的 `margin-top:auto` / 上边框 / 内边距上移到 `.sidebar-bottom`，折叠态补
  `.sidebar-bottom{padding:8px}` 与 `.sidebar-admin-btn{justify-content:center;width:44px;margin:0 auto}`。

### 33.3 现在的三条入口

| 入口 | 位置 | 备注 |
|------|------|------|
| 侧栏底部「管理后台」 | 侧栏底部，常驻 | 新增；折叠态为图标 |
| 命令面板 | `⌘K` →「管理后台」 | 既有 |
| 直接 URL | `/admin` | 线上返回 200（SPA 兜底） |

### 33.4 验收

- `npm run build` → 通过。
- 写操作仍需在页面填入 `SITES_ADMIN_KEY`（存 `localStorage.nav_admin_key`，下次自动填充）。

---

## 三十四、管理后台 P0 升级：站点检索 / 分类体系管理 / 操作审计（2026-10-03）

### 34.1 背景与范围

先产出了一份商用导航站管理后台的功能清单（7 大模块 / 60 项能力，含「已有 / 部分 / 缺失」现状对标与
P0/P1/P2 优先级），见 `docs/admin-backend-checklist/admin-backend-checklist.html`。
本轮从清单里挑出**三项立刻见效**的 P0 能力落地，不碰登录认证与角色权限（留待下一轮）：

1. 站点检索 / 筛选 / 排序 / 分页（后台此前只有一坨列表，找不到具体站点）；
2. 分类体系管理（分类表此前是编译进代码的静态常量，改分类要改源码 + 重新部署）；
3. 操作审计日志 UI（`shared/ops/audit-core.mjs` 内核早已存在，但线上没有任何查看入口）。

### 34.2 分类表动态化（本轮地基）

分类表从「编译期常量」升级为「云端可下发数据」，但**默认表仍是唯一权威源**：

- `shared/categories.mjs`：新增 `cloneGroups()`（深拷贝，写入前必须拷贝否则污染所有消费方）与
  `sanitizeGroups()`（严格体检）。
- `sanitizeGroups` 硬约束：① 至少一个分组、每组至少一个子分类；② 分组 id / 子分类 id 各自唯一，
  且**两组 id 集合互不相交**（域与子分类同轴取值 `'all' | 域 id | 子分类 id`，重名会让筛选语义歧义）；
  ③ label 非空，dotColor 缺失补中性灰而非拒绝。**任一硬约束不满足即整体返回 null** ——
  宁可回退到内置默认表，也不能渲染出半张表。
- `api/sites.js`（数据面）POST 新增可选 `categories` 字段：
  - 显式提供 → 过 `sanitizeGroups`，非法则 **400 拒绝本次发布**（不落脏表）；
  - 缺省不传 → **沿用云端前值**（`prev.categories`），CLI / 旧客户端发布不会把云端分类表清空；
  - 回滚分支：分类表与站点表是两个轴，老快照里没有 `categories` 时沿用当前值，不能顺手抹掉。
- `src/stores/categories.js`：持有运行时副本 `groups`，云端下发时整体替换；`cloudGroups` 作为基线，
  `dirty` 计算本地草稿是否已偏离云端。新增编辑 API：`addCategory / updateCategory / removeCategory /
  moveCategory / updateGroupLabel / resetToDefault / toCloudGroups`。
  - id 规则 `^[a-z0-9][a-z0-9_-]*$`，且不得与域 id 重名；
  - 删除分类前由后台判定引用数，有站点占用则拒绝（提示先用批量操作迁移）；
  - 每个域至少保留一个分类。
- `src/stores/sites.js`：域 / 子分类判定全部改走 `categoriesStore`（不再读静态常量），
  否则后台新增的分类在「整域筛选」里会被漏掉。
- 发布时**仅当 `categoriesStore.dirty` 才推送分类表**：否则每次发布都会把云端表覆盖成本地副本，
  一旦本地没成功拉到云端表（离线 / 首屏兜底），就会静默把云端分类退回默认表。

### 34.3 站点管理面板（`AdminSitesPanel.vue`，新增）

- 结构化筛选（域 → 子分类 → 在线状态）先收敛，再交给检索内核 `rankSites` 做相关性排序；
  有搜索词时**相关性优先，显式排序只作同分并列的 tieBreak**（与全站搜索口径一致）。
- 切域后自动清掉不属于新域的子分类选项，避免筛出空集；筛选变化即回到第 1 页，
  且 `totalPages` 变小时把页码夹回有效范围（否则会停在一片空白页）。
- 分页（20 / 50 / 100 每页），复用 `AdminBatchBar` 做批量操作；编辑 / 删除复用既有模态框。
- 表格行内联显示分类色标签与在线状态（读 `healthStore`，与 `AdminInsights` 的探活共享状态）。

### 34.4 分类体系管理（`AdminCategoryManager.vue`，新增）

- 域重命名 / 分类重命名 / 配色选择 / 域内上下移动 / 新增 / 删除，改动先落本地草稿，
  由「发布到云端」统一推送；顶部显示「本地草稿未发布」徽标。
- 每个分类实时显示占用站点数（一次遍历建表，避免模板里对每个分类重扫全量站点）；
  有引用时禁止删除并提示先迁移。
- 新增分类时按名称**拼音首字母预生成 id**，重名自动加序号，用户手改后不再覆盖。

### 34.5 操作审计日志（`AdminAuditLog.vue`，新增）

- `shared/ops/audit-core.mjs` 补充分类相关动作：`category.add / category.update / category.remove /
  category.reorder`。
- `api/ops.js` 新增 `ops/audit.json` 持久化与两个接口：`GET ?audit=1`（服务端过滤 action/result/q +
  返回动作字典与概览统计）、`POST {action:'audit.append'}`。
- `src/services/auditLog.js`：`recordAudit()` 三条约束 —— ① 旁路（写失败静默，绝不阻断主流程）；
  ② 无密钥不发（避免打出必然 401 的请求）；③ 只记已发生的事实。
- 埋点覆盖：发布成功 / 失败、回滚、站点增改删与批量、分类增改删与排序。
- UI：服务端过滤（口径与本地控制台一致）+ 客户端分页（一次取回上限内全部命中再切片）。

### 34.6 验收

- `npm run validate` → 通过（301 站点 / 29 分类；9 个无图标站点为已知项）。
- `npm run build` → 通过（AdminView chunk 44.38 kB）。
- `npm run console:test:ops` → **67 通过 / 0 失败**（本轮口径；第三十五节又补入认证 / 预检 / 登录审计用例，现为 85 条）。
- `npm run console:test:all` → 全绿。

---

## 三十五、管理后台 P0 收尾：登录认证 + 发布预检门禁（2026-10-03）

### 35.1 背景与决策

第三十四节明确把「登录认证 / 角色权限」留到下一轮。本轮用户拍板：

- 认证方式 = **自建账号密码 + 签名会话 token**，不接 SSO（本站单管理员、无 IdP，接第三方登录要额外账号体系与回调域名）；
- **不做角色权限模型** —— 单管理员场景下角色只会多出一套空壳 UI 与维护成本；
- 其余 P0 项全部落实：登录认证、发布预检与变更摘要。

### 35.2 认证内核（`shared/auth.mjs`，新增）

仅服务端（依赖 `node:crypto`），前端不得 import。

- **口令**：scrypt（N=16384 / r=8 / p=1）加盐哈希，存储格式 `scrypt$N$saltB64$hashB64`，比对走 `timingSafeEqual`。
- **会话**：无状态 token = `base64url(payload).base64url(HMAC-SHA256)`，payload `{sub,iat,exp,jti}`，TTL 7 天。
  服务端**不存会话表** —— 每个受保护请求都读一次 Blob 会让热更新明显变慢；payload 预留 `jti`，
  将来做「强制下线 / 设备管理」时再加吊销表即可。
- **防枚举**：用户名比对同样常量时间，且口令与用户名校验**无条件都执行**，不靠「用户名错就提前返回」的计时差泄露管理员账号。
- **统一鉴权** `checkAuthHeader(req)`：先验会话 token，再回落比对 `SITES_ADMIN_KEY`
  （CLI / 脚本 / 旧客户端零改动）；返回 `via` 区分「登录态 / 密钥直连」，供审计署名。
- **零配置可用**：签名密钥缺省回退 `SITES_ADMIN_KEY`；单独设 `AUTH_SECRET` 则轮换管理密钥不会踢掉所有登录态。

### 35.3 认证接口（`api/auth.js`，新增）

- `GET /api/auth` → `{ loginReady, keyReady, username }`（不鉴权；前端据此决定显示登录表单还是密钥直连）。
- `POST { action: login | verify | logout }`。`verify` 返回 `reason`（`expired` / `bad-signature`），前端据此区分「过期」与「伪造」。
- **登录限流**：按来源 IP 落 `ops/auth-attempts.json`，10 分钟窗口内累计失败 8 次即锁定一个窗口。
  **限流组件故障时放行但仍走口令校验** —— 不能因为限流坏了就把管理员挡在门外；scrypt 约 100ms 的计算开销本身也是暴力破解成本。
- **登录事件服务端审计**（新增动作 `auth.login / auth.loginFail / auth.lockout`），与 `api/ops.js` 写同一个
  `ops/audit.json`、同一套 `normalizeEntry` 结构。安全事件必须在服务端记（客户端埋点可被跳过），写入依旧是旁路。

### 35.4 鉴权接入

`api/sites.js`（数据面）与 `api/ops.js`（运维面）统一改用 `checkAuthHeader`，凭据走
`Authorization: Bearer <token>`；密钥直连路径保持兼容。

### 35.5 前端

- `src/services/authApi.js`（新增）：`status / login / verify / logout`；token 存进既有 `nav_admin_key` 槽位，
  数据面 / 运维面所有既有调用方无需改动。
- `src/components/admin/AdminLogin.vue`（新增）：账号登录 ⇄ 密钥直连双模式；服务端未配任何鉴权方式时给出明确配置指引，
  口令哈希缺失时提示 `npm run auth:hash`。
  - **上线前修复的锁死风险**：`authApi.status()` 失败时（网络抖动 / 新接口尚未生效）原先会落到
    「服务端未配置任何鉴权方式」的死胡同 —— 连密钥输入框都不渲染，管理员将被彻底挡在后台外。
    现改为**失败即回退密钥直连模式**并提示原因；「服务端确实没配」交给 `submitKey` 的校验结果暴露。
- `src/views/AdminView.vue`：进入即 `authApi.verify` 自检；任一面板拿到 401 → `opsApi` 广播 `nav-auth-expired`
  → 统一退回登录闸门并提示「登录状态已失效」；顶栏显示当前身份与有效期（密钥直连标注「无有效期」）；
  退出登录清理凭据与审计署名。
- `scripts/hash-password.mjs`（新增，`npm run auth:hash -- "口令"`）：生成可直接写入 `ADMIN_PASSWORD_HASH` 的哈希串。
- `.env.example` 补充 `ADMIN_USERNAME / ADMIN_PASSWORD_HASH / AUTH_SECRET` 说明。

### 35.6 发布预检（`shared/ops/preflight.mjs`，新增）

纯函数、零依赖，浏览器与 Node 同口径引用 —— 避免「本地 dry-run 说没问题、线上拦下来」的割裂。

判据是**发布后前台会立刻坏掉**的才阻断，只是「不理想」的一律降级为警告：

- 阻断：无凭据、站点列表为空、分类表结构非法、站点引用了未登记的分类。
- 警告：空分类、重复域名（忽略 www，口径同站点内核）、排序号重复、与云端相比无改动。

同时产出 `sites` / `categories` 结构化 diff 与一句话摘要 `summarizePreflight`，供发布按钮旁、通知、审计共用。

- `src/components/admin/AdminPublishPreflight.vue`（新增）：阻断 / 提示 / 通过三态 + 两侧变更明细；
  `watch(result)` 实时向父级推送 verdict（否则数据变了按钮状态不更新）。
- `AdminView`：`preflightOk === false` 时**发布按钮直接禁用**并列出阻断原因 —— 预检成为发布门禁，不是装饰。

### 35.7 验收

- `npm run validate` → 通过（301 站点 / 29 分类；9 个无图标站点为已知项）。
- `npm run build` → 通过（AdminView chunk 60.33 kB）。
- `npm run console:test:ops` → **85 通过 / 0 失败**（新增认证内核往返、`diffGroups`、发布预检四类阻断、登录审计动作用例）。
- `npm run console:test:all` → 全绿。

### 35.8 已知边界

- 会话无状态：`logout` 仅客户端丢弃 token，服务端无吊销表（预留 `jti`，需要「强制下线」时再加）。
- 未做角色权限（本轮明确不做）；`authConfig` 只有一个 `ADMIN_USERNAME`，天然单管理员。
- 登录审计与限流共用 `ops/audit.json` 的「读—改—写」，与 `api/ops.js` 的并发追加存在竞态；
  登录是低频事件，影响可忽略（如需彻底解决，应给审计追加加锁或改用 append-only 存储）。

### 35.9 上线记录（2026-10-03）

`npm run publish` 全链路通过：备份 → schema 门禁 → 构建 → Vercel 生产部署 → Blob 热更新 → 轮询验证。

- 部署：`https://navigator-v2-two.vercel.app`（Aliased，Ready in 36s）。
- 热更新：`version=105 / 301 站点 / 292 图标`，快照 `sites-data.snapshots/000104-2026-10-03T06-28-59-170Z.json`。
- 线上实测：
  - `GET /api/auth` → `{loginReady:false, keyReady:true}`（生产尚未配 `ADMIN_PASSWORD_HASH`，故走密钥直连，符合预期）；
  - `POST /api/auth {action:verify}` 带管理密钥 → `{valid:true, via:"key"}`；
  - `GET /api/sites` → `version:105`，数据正常下发；
  - **鉴权确实生效**：`/api/ops` 无凭据 → 401、`/api/sites` POST 无凭据 → 401、伪造 token → 401；
  - `/admin` → 200。

**账号登录开通（2026-10-03 同日完成）**

生产环境原先只有 `SITES_ADMIN_KEY`（密钥直连），账号登录未启用。已补齐：

- 在 Vercel Production 新增两个 **Sensitive** 变量：`ADMIN_PASSWORD_HASH`（scrypt 哈希，由 `npm run auth:hash` 生成）
  与 `AUTH_SECRET`（48 位随机串，用于会话签名；单独设置后轮换管理密钥不会踢掉登录态）。
- 明文口令**只交付给管理员本人保存，不写入本仓库、不写入 `.env.local`、不进 git**；环境变量里只有哈希。
  需要更换口令时：`npm run auth:hash -- "新口令"` → 在 Vercel 覆盖 `ADMIN_PASSWORD_HASH` → 重新部署。
- 环境变量变更需重新部署才对 Serverless 生效（本次已重部署，Ready in 38s）。

线上实测（`https://navigator-v2-two.vercel.app`）：

| 检查项 | 结果 |
| --- | --- |
| `GET /api/auth` | `{loginReady:true, keyReady:true, username:"admin"}` |
| 登录（错误口令） | **401** |
| 登录（正确口令） | 签发会话 token（146 字符，TTL 7 天，`sub:"admin"`） |
| 会话 token 调 `/api/ops` | **200** |
| `POST {action:verify}` 带会话 token | `{valid:true, via:"session", username:"admin"}` |
| 登录事件入审计 | `auth.login` / `auth.loginFail` 均落盘，含 `actor` 与来源 IP |

密钥直连（`keyReady:true`）保持可用，CLI / 脚本 / 旧客户端不受影响；两条凭据路径并存。

### 35.10 登录体验：浏览器自动填充 + 记住此设备（2026-10-03）

口令是 20 位随机串，手打成本高。**明确拒绝的做法**：把口令写进前端自动填充 —— bundle 公开可读，
等于把管理员口令发到公网。改用两条安全路径：

**1. 浏览器密码管理器**（`src/components/admin/AdminLogin.vue`）

- 关键坑：`/admin` 是 AJAX 登录、**没有页面跳转**，Chrome/Edge 因此识别不出「这是一次登录」，
  不会弹「保存密码」—— 只加 `autocomplete` 属性并不能可靠触发。
- 做法：登录成功后显式调用 `navigator.credentials.store(new PasswordCredential({ id, password, name }))`；
  进入页面时用 `navigator.credentials.get({ password: true, mediation: 'silent' })` 静默回填。
- **顺序约束**：必须先 `store` 再清空输入框，清空后就取不到明文口令了。
- 兼容：仅 Chromium 系有 `window.PasswordCredential`；其余浏览器走 `autocomplete` 原生路径，不支持即静默跳过。
- 同时补 `name="username" / name="password"`，提升密码管理器识别率（原先只有 `autocomplete`）。
- 用户名本就由 `/api/auth` 回填，无需手打；口令是唯一需要输入的字段。

**2. 记住此设备（90 天）**

- `shared/auth.mjs` 新增 `SESSION_TTL_LONG_MS`（90 天）；`api/auth.js` 的 login 接受 `remember`，
  **只影响会话有效期，不影响鉴权强度** —— 口令仍是 scrypt 哈希，不会被延长。
- `authApi.login(user, pass, remember)`；登录页新增勾选框（默认勾选）。
- 收回手段：轮换 `AUTH_SECRET` 并重新部署，所有已签发会话同时失效。
- 审计明细记录有效期档位（「有效期 90 天（记住此设备）」/「有效期 7 天」），便于事后区分登录来源。

**验收**：`npm run validate` 通过；`npm run build` 通过（AdminView 61.08 kB）；
`npm run console:test:ops` **86 通过 / 0 失败**；`console:test:all` 全绿。

**线上实测**：`remember:true` → `ttl=7776000000`（90 天）；`remember:false` → `ttl=604800000`（7 天）；
90 天会话 token 调 `/api/ops` → **200**；审计正确区分两个档位。

> 注意：浏览器密码管理器只在**首次成功登录之后**才拿到凭据。也就是说新代码上线后，
> 需要手动登录一次，之后才会自动填充。

### 35.11 修复：管理后台鼠标无法滚动（2026-10-03）

**现象**：`/admin` 鼠标滚轮完全无反应，内容超出视口后被裁掉，底部面板不可达。

**根因**：`src/styles/main.css` 为让主壳做固定分栏，全局设了 `html, body { height: 100%; overflow: hidden }`，
**视口滚动被关掉**。主壳 `.app-layout` → `.main` 是 `overflow: hidden` 的固定布局，滚动由内部
`CardsContainer` 自己承担 —— 所以主站一切正常，问题只在后台。
而 `Admin` 是 **standalone 路由**（`App.vue` 的 `STANDALONE_ROUTES`，不套 `.app-layout`），
`AdminView` 根元素只有 `min-height: 100vh`、**没有任何滚动容器**，内容一超高就被裁掉且无处可滚。
全库无 wheel 事件拦截，纯样式问题。

**修复**（`src/views/AdminView.vue`）：给 `.admin-view` 自建滚动容器 ——
`height: 100vh; height: 100dvh; overflow-y: auto; overscroll-behavior: contain`
（`100dvh` 覆盖移动端动态工具栏，`100vh` 作回退）。

**未受影响**：头部「发布到云端」「通知」两个跳转按钮用的是 `scrollIntoView`，
会自动寻找最近的滚动祖先，因此无需改动。

**验收**：`npm run build` 通过；线上 `AdminView-*.css` 确认含该规则；
浏览器实测（真实视口 603×611）：`.admin-view` computed `overflow-y: auto`，
`scrollHeight 8579 / clientHeight 611`，`scrollTop` 0 → 500 → 7968（到底）→ 0 全部正常，
底部可达「登录日志」「通知中心」，滚动流畅无卡顿。

> 排查插曲：首次自动化验证「失败」，原因是浏览器标签页视口高度为 0（渲染被节流、截图失败），
> `100vh` 随之解析为 0，`clientHeight` 读出 0 —— 这是**验证环境**的问题，不是页面问题。
> 新建标签页拿到正常视口后即通过。以后遇到 `clientHeight: 0` 先怀疑视口，别急着改页面。

> 教训：standalone 路由不继承主壳的滚动容器，**任何新增的整页路由都必须自建滚动容器**，
> 否则会被全局 `overflow: hidden` 静默裁掉。

### 35.12 管理后台改为 Tab 布局（2026-10-03）

**动因**：后台原来是「一页瀑布流」，各模块上下堆叠，找一个功能要滚很久。改为按模块分 Tab。

**布局结构**（`src/views/AdminView.vue`）：
`.admin-view` 改为 flex 纵向列（`height: 100dvh; overflow: hidden`）——
固定头部 `.admin-header` → 固定 Tab 栏 `.admin-tabs` → 滚动内容区 `.admin-body`。
滚动容器从 `.admin-view` 下沉到 `.admin-body`，头部与 Tab 栏始终可见。
**`.admin-body` 必须带 `min-height: 0`**，否则 flex 子项不收缩、滚动条不会出现。

**8 个 Tab**：概览（统计卡片 + 数据洞察）/ 站点管理 / 分类体系 / 云端发布 /
快照与回滚 / 发布历史 / 操作审计 / 通知中心。默认「概览」。

**Tab 状态写进 URL**：用 `router.replace`（不污染历史），刷新 / 收藏 / 分享都能落回同一模块；
未登记的 `tab` 值一律回落默认页，避免手改地址栏把页面切成空白；
监听 `route.query.tab` 以支持浏览器前进 / 后退；`?tab=` 为默认值时从 URL 中删掉，保持干净。

**懒加载**：面板用 `v-if` 而非 `v-show` —— 8 个面板里有一半挂载即打接口
（发布历史 / 审计 / 通知 / 快照都是 `onMounted(load)`），全量常驻会造成首屏并发请求。
代价是切 Tab 会重置面板内部状态（筛选 / 分页），可接受。

**连带处理（不改会静默坏掉的地方）**：

- **通知角标失效**：角标原来靠 `AdminNotifications` 常驻挂载后 `emit('badge')` 上报；
  懒加载后要等用户点开通知中心才会上报，角标就失去「提示有新通知」的意义。
  改为 `AdminView` 登录成功后主动拉一次（`opsApi.notifications(key, { limit: 1 })` → `summary.unread`），发布成功后也刷新。
- **删除死代码**：`refreshOps()` 及 `historyRef / auditRef / notifyRef` 在懒加载下永远取不到已挂载实例（恒为 null），
  已成空转，一并删除；各面板改为切到该 Tab 时自行 `onMounted(load)` 拉最新数据。
- **头部按钮**：「通知」按钮移除（角标移到「通知中心」Tab 上）；
  「发布到云端」保留为跳转到「云端发布」Tab 的快捷入口；`scrollToPublish` / `scrollToNotifications` 随之删除。

**验收**：`npm run validate` 通过；`npm run build` 通过（AdminView 62.00 kB / CSS 36.52 kB）；
`console:test:all` 全绿（内核 86/0、trust 12/0、site-infer 108、metadata 27、hunk 72）。

**浏览器实测**（视口 603×611）：8 个 Tab 顺序正确；默认「概览」；
逐个点击**同一时刻只有一个模块可见**；站点管理 301 站点 / 16 页、内容区滚动正常；
URL 随 Tab 变为 `?tab=sites` 等；无空白、无重复堆叠、无报错。

---

## 三十六、站点管理改为卡片式布局（2026-10-03）

**动因**：站点管理原是表格布局，列多拥挤、窄屏必须横向滚动、每行信息密度与可读性都不理想。改为自适应卡片网格。

### 36.1 卡片结构（`src/components/admin/AdminSitesPanel.vue`）

每张卡片自上而下：

- **顶部行**：批量勾选框（仅批量模式渲染）→ 图标（`site.color` 底色 + 首字母兜底，`img` 加载失败即 `@error` 自摘）→ 名称（单行省略）+ 网址（monospace 单行省略）→ 编辑 ✎ / 删除 ✕ 两个图标按钮。
- **描述**：`-webkit-line-clamp: 2` 两行截断，无描述不渲染该行。
- **底部行**：分类胶囊（用 `getCategoryColor` 派生 `+20` 透明底 + 主色文字）、健康状态徽标（正常 / 限流 / 失效 / 未探测，四色）、访问次数（`margin-left: auto` 右对齐）。

`card-foot` 用 `margin-top: auto` 顶到底部，同一行卡片高度不齐时底栏仍对齐。

**功能零丢失**：筛选（搜索 / 域 / 分类 / 状态 / 排序）、分页（20/50/100）、批量全选与勾选、增删改弹窗全部保留，仅换渲染层。

### 36.2 窄屏溢出修复（本轮关键修复）

**现象**：视口 603px 时一行排 3 张卡片，首张卡片右边界超出容器，卡片相互重叠、右侧被裁切。

**根因**：`grid-template-columns: repeat(auto-fill, minmax(272px, 1fr))` 的最小列宽写死 `272px`。
`auto-fill` 只在「容器宽度足够放下一列」时降列，当容器可用宽度小于 `272px` 时（窄屏 + `.admin-section` 左右各 32px 内边距），
轨道仍按 `272px` 建立，于是溢出容器。

**修复**（三处）：

1. 最小列宽改为 `minmax(min(272px, 100%), 1fr)` —— `min(272px, 100%)` 保证最小列宽**永不大于容器宽度**，窄屏最多退化成单列铺满，不会再溢出。
2. `.site-card` 加 `min-width: 0` —— 网格子项默认 `min-width: auto`，内容（长网址 / 长名称）会把轨道撑破，置 0 后由内部 `text-overflow: ellipsis` 接管。
3. 新增 `@media (max-width: 768px)`：`.admin-section` 内边距 32px → 16px、卡片间距与内边距收紧、搜索框 `min-width: 100%` 独占一行、`.site-meta` 允许换行并取消页码右浮。

### 36.3 验收与上线（2026-10-03）

- `npm run build` 通过（`AdminView-BygHrK5F.css` 37.75 kB）。
- 产物核验：`dist/assets/AdminView-*.css` 含 `minmax(min(272px,100%),1fr)`。
- `npm run publish` 全链路通过：备份 301 条 → schema 门禁（9 个无图标站点为已知项）→ 构建 → Vercel 生产部署 → Blob 热更新 → 轮询收敛。
  - 部署：`https://navigator-v2-two.vercel.app`（Aliased，Ready in 34s）。
  - 热更新：`version=106 / 301 站点 / 292 图标`，快照 `sites-data.snapshots/000105-2026-10-03T08-00-35-621Z.json`。
  - 线上核验：`GET /assets/AdminView-BygHrK5F.css` 确认包含 `min(272px,100%)` 修复规则。

---

## 三十七、站点失效判定改为「本机代理环境」口径（2026-10-03）

### 37.1 问题与决策

原实现由**浏览器**逐站 `fetch` 探测在线状态（`src/stores/health.js`）。两个致命缺陷：

1. **跨域读不到状态码** —— 浏览器 `fetch` 第三方域名几乎全部落到 `ERR`（CORS 拦截），大批可用站点被误判「失效」。
2. **口径不统一** —— 浏览器的出网路径与本机代理环境不是一回事；用户明确要求「站点是否失效要以本地自带代理环境判断」。

**决策**：判定只由**本机**产出（`curl.exe` 走系统代理），发布到云端，前端只读结论。
- 浏览器读不到跨域状态码 → 不探。
- 云端（Vercel）出网口在海外，与本机代理可达性不同 → 不探。
- 只有本机 `curl.exe`（系统代理）才是用户要的真口径。

**单一真相源**：前台卡片状态角标、管理后台失效清单、控制台可用性看板、CLI `nav sites check` 四处共用同一份云端判定。

### 37.2 分层与文件

| 层 | 文件 | 职责 |
|----|------|------|
| 纯规则 | `shared/health-rules.mjs`（新增） | `IGNORABLE` 限流码集合 / `STATUS_LABEL` / `verdictOf(code)` / `tally()` |
| 探测引擎 | `shared/health-probe.mjs`（改） | 只保留「怎么探」（curl.exe + HEAD→GET 回落 + down 重试），规则改为从 `health-rules.mjs` 导入再 re-export |
| 云端落点 | `api/health.js`（新增） | `GET` 公开读（前端唯一来源）/ `POST` 鉴权写（按 code **重算 status** 后落 Blob `ops/health.json`） |
| 本机发布 | `tools/console/lib/cloud.mjs`（改） | `publishHealth()` 上报事实（id/code/ms），`proxyEnv()` 记录代理；`fetchCloudHealth()` 核对 |
| 控制台 | `tools/console/lib/health.mjs` / `schedule.mjs`（改） | 探活、巡检结束后**自动发布**；`publishLatest()` 支持只重发不重探 |
| 控制台 UI | `tools/console/ui/index.html` / `healthpanel.js`（改） | 「发布到云端」按钮 + `/api/health/publish` 接口 |
| CLI | `tools/cli/commands/sites.mjs`（改） | `nav sites check --publish` 探完即发布 |
| 前端 | `src/stores/health.js`（改） | 删除浏览器探测，改为 5 分钟 TTL 拉 `/api/health`；`probeSites()` 退化为「确保已加载」 |
| 后台 | `src/components/admin/AdminInsights.vue`（改） | 展示云端判定时间 / 代理环境；无判定时给操作指引 |

### 37.3 关键设计点

1. **为什么规则要单独成文件**：`health-probe.mjs` 依赖 `node:child_process`（拉起 curl.exe），不能把子进程模块拖进 Vercel 函数运行时；但 `api/health.js` 写入判定时也要用同一套分级规则，故规则抽到零依赖的 `health-rules.mjs`，两边共用。
2. **服务端按 code 重算 status，不信任客户端结论**：客户端只上报事实（HTTP 码 / 耗时），`status` 由 `api/health.js` 用 `verdictOf()` 重算。即便某个旧版控制台用了过时口径，也不会把「限流」写成「失效」污染全站角标。
3. **合并写入而非整体覆盖**：控制台 / CLI 都支持只探部分站点（`--ids` / `--limit`），覆盖式写入会让没被探到的站点集体退回「未探测」，比不发布更糟。故 `api/health.js` 读旧值后 `{...prev, ...incoming}` 合并，`version` 递增。
4. **发布失败不抛错**：本地已落盘，云端没更新只是角标暂时偏旧，不该让探活任务整体失败（`publishRun` 只记录审计 + 日志）。
5. **`verdictOf` 分级**：`ok` = 2xx/3xx；`limited` = 429/403/405/401（限流/反爬/方法误用/鉴权，站点实际可用）；`down` = `ERR`/`000`/404/402/410 等真实失效；`unknown` = 无云端判定。

### 37.4 验收与上线（2026-10-03）

- `npm run console:test:all` 全绿（trust 13 / infer 108 / guard 27 / hunks 72 / ops 86 / api-ops 12）。
- `npm run build` 通过。
- `npm run publish` 全链路通过：部署 `navigator-v2-two.vercel.app`（Ready in 36s），Blob 热更新 `version=107 / 301 站点 / 292 图标`，快照 `sites-data.snapshots/000106-2026-10-03T08-23-16-372Z.json`。
- **端到端实测**：
  - `GET /api/health`（新函数已上线）首次返回空判定 → 200。
  - `nav sites check --limit 3 --publish` → 发布 `version=1`（3 条，代理 `http://127.0.0.1:7897`），`GET` 回读一致。
  - 全量 `nav sites check --publish` → 301 站（耗时 106s）→ 发布 `version=2`：**正常 245 / 可忽略 50 / 需处理 6**。
  - `GET /api/health` 回读：`version=2 / total=301 / actor=cli / proxy=http://127.0.0.1:7897`，与发布响应一致。
  - 需处理 6 站：`l2 Kaggle(404)`、`s9 文心一言(404)`、`g12 DESIGN.md Editor(402)`、`md7 BlockBeats(ERR)`、`sm3 Xtemporary(ERR)`、`sm16 四方接码(ERR)`。
- **误判提示**：上述部分站点（kaggle / yiyan.baidu / theblockbeats / sz-fang）在本机网络下有已知 WAF 误报史（见「九、已知问题」），故后台失效清单保留「删除前仍建议人工复核 WAF / 限流误判」的告警文案，不自动删除。

### 37.5 使用方式

- **日常**：控制台「可用性」面板点「开始探活」或等定时巡检，结束后自动发布到云端；「发布到云端」按钮用于不重新探测、只重发最近一轮。
- **CLI**：`nav sites check --publish`（全量）/ `nav sites check --ids a,b --publish`（定点）。
- **前端**：无需任何操作，`/api/health` 5 分钟 TTL 自动刷新；管理后台「数据洞察」展示判定时间、代理环境与失效清单。

### 37.6 复核 6 个「需处理」站点 + 修复 HEAD 误判（2026-10-03）

首轮判定（`version=2`）报出 6 个「需处理」，逐一复核后发现 **3 个是引擎误判**：

| 站点 | 首轮判定 | 复核真相 | 证据 |
|------|----------|----------|------|
| `l2` Kaggle | down(404) | **正常** | HEAD 404 / GET 200 |
| `s9` 文心一言 | down(404) | **正常** | HEAD 404 / GET 200 |
| `md7` BlockBeats | down(ERR) | **正常** | HEAD 超时(exit 28) / GET 200 |
| `g12` DESIGN.md Editor | down(402) | 真失效 | `X-Vercel-Error: DEPLOYMENT_DISABLED`（Vercel 部署被禁用） |
| `sm3` Xtemporary | down(ERR) | 真失效 | DNS NXDOMAIN（8.8.8.8 / 1.1.1.1 均无记录） |
| `sm16` 四方接码 | down(ERR) | 真失效 | 无 A/AAAA 记录（Cloudflare NS 但 NODATA），握手失败 / 402/502 |

**根因：`probeOnce` 的 HEAD→GET 回落逻辑有两处失效**

1. **HEAD 返回 4xx 不回落**：原逻辑仅在 `000`/空 时回落 GET，而大量站点不支持 HEAD（返回 404/405），GET 却是 200 → 误判「失效」。
2. **HEAD 超时直接定性**：curl `--max-time` 超时以 exit 28 退出，`execFile` 的 Promise reject，`try/catch` 直接返回 `ERR`，**GET 回落永远执行不到**。

**修复（`shared/health-probe.mjs`）**

- 新增 `curlCode()`：从 `error.stdout` 取回 `-w` 写入的 http_code，超时不再被当成探测异常。
- `probeOnce()` 改为「**只要 HEAD 不是 2xx/3xx，一律用 GET 复核**」（GET 才是用户真实访问方式）。

**顺带修复 `scripts/check-sites.mjs`**：该脚本复制了一份同款「HEAD 优先」实现（违反「同源」约定，且踩同一个坑），已重构为直接调用 `probeMany()`，删除本地 curl 逻辑与 `isBad/classify` 重复判定。

**修复后全量重探并发布 `version=3`**：正常 **254** / 可忽略 **44** / 需处理 **3**（`g12` 402 / `sm3` 000 / `sm16` 000）。
除 3 个误判站点归正外，另有 6 个原「可忽略(405/403)」站点经 GET 复核确认为正常：`l3` Google Colab、`dt13` MangosLab、`aiapi3` Radeon Token Factory、`sc8` Tsecbench、`dt28` BlockHorizon、`st3` Allnodes。

**验证**：`npm run console:test:all` 全绿；`node scripts/check-sites.mjs --limit 6` 正常；`GET /api/health` 回读 `version=3` 与发布响应一致。

> 注：本次只改本机 Node 工具（`shared/health-probe.mjs`、`scripts/check-sites.mjs`），`api/health.js` 仅依赖 `shared/health-rules.mjs`，故**无需重新部署 Vercel**，只需重跑探活并发布判定。

---

## 三十八、移除 2 个真失效站点 + 代理端口漂移事故（2026-10-03）

### 38.1 删除操作

复核后确认 `sm3` / `sm16` 为真失效（`g12` 保留观察），执行：

```
nav sites batch --op remove --ids sm3,sm16 --yes
```

- `sm3` Xtemporary（xtemporary.com）：DNS NXDOMAIN，域名已注销
- `sm16` 四方接码平台（sz-fang.cc）：无 A/AAAA 记录（Cloudflare NS 但 NODATA）
- 删除后站点总数 **301 → 299**
- 顺手清理孤儿图标 `public/icons/sm16.ico`（`removeSite` 不删图标文件，须手工清理；校验后 public/icons 孤儿 0 / 悬空 0）
- 发布结果：部署 Ready 33s，Blob 热更新 `version=108 / count=299 / withIcons=291`，轮询第 1 次即收敛
- 线上核对：`/api/sites` 返回 299 条、`sm3`/`sm16` 已不存在、`g12` 保留

### 38.2 事故：本机代理端口漂移导致发布连续失败

**现象**：`npm run publish` 连续两次在第 3 步（`npx vercel deploy`）报 `Error: fetch failed`；随后所有 curl 请求（含 baidu / google）全部返回 `000`。

**根因**：Clash Verge 的 `mixed-port` 已从 **7897 变为 7900**（`%APPDATA%\io.github.clash-verge-rev.clash-verge-rev\clash-verge.yaml` 与运行时 `config.yaml` 均为 7900），但**机器环境变量 `HTTP_PROXY`/`HTTPS_PROXY` 仍指向 7897**。于是：

- curl.exe 忠实使用环境变量里的 7897 → 该端口已无监听 → 全部 `000`；
- `proxyEnv()` 同样读环境变量，探活口径也会跟着失效（会把全部站点误判为「需处理」）。

**诊断要点（可复用）**：

1. `netstat -ano | Select-String "LISTENING" | Select-String ":7897"` → 无监听；
2. 查代理核心真实端口：`netstat -ano | Select-String "LISTENING" | Select-String "<mihomo PID>"` → `127.0.0.1:7900`；
3. 用 `--noproxy "*"` 区分「底层网络断」与「代理客户端挂」：本例 baidu 200 / api.vercel.com 308 → 底层网络正常，问题在代理；
4. `npx vercel whoami` 清空代理变量后成功 → 证明 Vercel CLI 直连可用。

**处置**：本次以 `$env:HTTP_PROXY='http://127.0.0.1:7900'` 等临时覆盖端口完成发布。

**已修复（2026-10-03）**：按用户确认，把 **User 层**环境变量改为与 Clash Verge 一致：

```powershell
[Environment]::SetEnvironmentVariable('HTTP_PROXY','http://127.0.0.1:7900','User')
[Environment]::SetEnvironmentVariable('HTTPS_PROXY','http://127.0.0.1:7900','User')
```

- 两个变量原先只在 **User 层**（`HKCU:\Environment`，值 7897），Machine 层为空；`NO_PROXY` 保持不变。
- 已回读注册表确认写入 7900。
- ⚠️ 已运行的进程不会自动继承（工具宿主 / 控制台服务需**重启**才生效；控制台服务当时未运行，下次启动即读新值）。
- ⚠️ 若 Clash Verge 端口再次变动，会重新失配 —— 建议在 Clash Verge 中把 mixed-port 设为固定值（关闭自动分配）。

### 38.3 判定数据剔除（已修复）

**问题**：云端 `ops/health.json` 曾保留 `sm3`/`sm16` 两条判定。因 `api/health.js` 是**合并写入**（只增不删），删除站点不会自动清除其判定 —— 残留条目会被 `counts` 计入，也可能被未来同 id 的新站点继承。

**修复（`api/health.js`）**：合并之后增加一步**按当前站点集剔除**。

- 站点集取自 **Blob `sites.json`**（运行时权威表），而非部署包里的 `sites-data.json` —— 控制台支持「只热更新不重新部署」，用部署包会漏掉刚新增的站点、把新站判定误删。
- `knownSiteIds()` 读取失败返回 `null`，此时**跳过剔除**（fail-open）：判定宁可多留一条，也不能因读不到站点表就把整份判定清空。

```js
const known = await knownSiteIds()
const merged = {}
for (const [id, r] of Object.entries({ ...prevResults, ...incoming })) {
  if (!known || known.has(id)) merged[id] = r
}
```

**验证**：部署后重跑 `nav sites check --publish` → 判定 `version=4 / total=299 / ok=254 / limited=44 / down=1`；`GET /api/health` 回读 `sm3`/`sm16` 均已消失，需处理仅剩 `g12(402)`，代理记录为 `http://127.0.0.1:7900`（新端口已生效）。`/api/sites` 同为 299，两轴一致。

### 38.4 根治：代码层自动探测代理端口（2026-10-03）

**为什么还要做**：38.2 的处置是「把环境变量手动改成 7900」——这只是把漂移**推迟**到下一次。只要 Clash Verge 再换端口，同样的事故会重演，且症状是「全站误判为需处理 + 发布整体失败」，排查成本高。

**方案**：新增 `shared/proxy.mjs`，把「本机到底哪个端口在当代理」变成代码探测的事实，而不是环境变量的假设。

**口径优先级**（`resolveProxyUrl`）：

1. 环境变量里的端口**确实在监听** → 原样采用（尊重用户显式配置）
2. 否则扫描常见代理端口 `7890 / 7897 / 7900 / 7899 / 7891 / 10809 / 10808 / 1080 / 2080`，命中即用
3. 都没有 → 返回空串，按「不走代理」处理

> 刻意不收 8080 / 8888：这两个口常被开发服务器占用，收进来会把无关服务误认成代理。

**两个落点**：

- `applyProxyEnv()`：把探测结果**写回 `process.env`**。curl.exe 会继承子进程环境，因此这一处就让所有既有调用点（发布 / 抓取 / 通知 / 快照 / vercel.mjs）一并免疫漂移，无需逐个改造。探测不到时**不动**环境变量，不误删用户可能有效的配置。
- `health-probe.mjs`：探活时**显式传 `--proxy`**（整批只解析一次），不再依赖环境变量，判定口径确定且同批一致。

**结果带 30s 缓存**：代理端口切换后控制台无需重启即可自动跟上（`force:true` 可强制重探）。

**启动引导点**（都在真正干活前才探测，help/schema 等纯文本命令不付代价）：

| 入口 | 位置 |
|---|---|
| 控制台 | `tools/console/server.mjs`：`loadEnv()` 后 `await applyProxyEnv()`，启动横幅打印「代理环境」 |
| CLI | `tools/cli/nav.mjs`：`cmd.run()` 前 `await applyProxyEnv()` |
| 发布脚本 | `scripts/publish.mjs`：加载 `.env.local` 后 `await applyProxyEnv()` |

`scripts/check-sites.mjs` 走 `probeMany`（已显式传代理），无需改动。

**验证**（本机环境变量仍为滞后的 7897，正是漂移现场）：

```
resolveProxyUrl()            → http://127.0.0.1:7900   （自动纠正，未用滞后的 7897）
经滞后端口 7897 探 google     → 000 / down              （复现事故）
经探测端口 7900 探 google     → 200 / ok                （修复生效）
控制台启动横幅               → 代理环境: http://127.0.0.1:7900
```

**回归用例**（`tools/console/test-ops.mjs`，内核用例 86 → 89）：`portOf` 解析；环境变量端口在监听时原样采用；**环境变量端口失效时不再沿用该失效端口**（且返回的代理端口必须真的在监听）。

**残留提示**：环境变量从「唯一依据」降级为「优先候选 + 兜底」，因此 38.2 的手工修改仍有意义（省一次扫描），但**不再是单点故障**。若 Clash Verge 关闭（无任何监听），系统会自动转为直连，而不是拿着失效代理全站报错。

---

## 三十九、点击统计与按点击量排序（2026-10-03）

### 39.1 为什么做

原有「访问统计」是 `visitCount`，存在两处根本缺陷：

1. **口径错位**：它记的是**本机**（我这个浏览器）访问某站点的次数，被当作「热门度」展示。单人设备的访问次数无法代表站点在全网的热度，热门榜会退化成「我最近点了谁」。
2. **不跨设备**：换设备 / 换浏览器即归零，无法作为运营依据。

因此把「热度」拆成两条互不冒充的口径，并新增全局点击统计：

| 口径 | 存储 | 用途 | 权威性 |
|---|---|---|---|
| `visitCounts`（本机） | localStorage | 「推荐发现」个性化（同分类共现） | 仅代表本设备 |
| `clicks`（全局） | Blob `ops/clicks.json` | 卡片角标 / 热门榜 / 后台 TOP 榜 | **站点热度的唯一权威** |

### 39.2 分层与文件

沿用「本机/访客产出事实 → 云端归一 → 前端只读」的既有范式（与 `health` 同构）：

| 层 | 文件 | 职责 |
|---|---|---|
| 纯规则 | `shared/clicks-core.mjs`（新增） | 增量校验 / 合并 / 汇总 / 排行；**零依赖纯函数**，浏览器与 Node 双端共用 |
| 云端 | `api/clicks.js`（新增） | `GET` 公开读、`POST` 匿名写（限流 + 按站点集剔除 + 累加合并） |
| 前端状态 | `src/stores/clicks.js`（新增） | 本地待发队列、批量上报、云端拉取、`mergedCounts` 统一展示口径 |
| 展示 | `SiteCard` / `SiteDetailPanel` / `MainToolbar` / `DisplaySection` / `ContentFeed` / `AdminSitesPanel` / `AdminInsights` | 角标、排序项、TOP 榜 |

### 39.3 关键设计点

**① 纯规则单独抽出，杜绝口径漂移**。点击数据有三个读写方（访客前端、线上接口、管理后台）。任何一方自写「多大算一次有效点击 / 合并怎么加 / 删站后怎么剔除」都会漂移。收进 `shared/clicks-core.mjs` 后各端只负责搬运。硬约束：**必须零依赖**（不 import `node:*`、不碰 fs/网络），否则 Vite 前端打包会失败。

**② 写入是「累加」不是「覆盖」**。点击天然是增量，多个访客并发上报时覆盖会互相抹掉，故 `读 → 加 → 写`。Serverless 无共享状态，理论上存在并发丢更新（与 health 同源），但点击统计允许此量级误差，换取实现简单稳定。

**③ 匿名写必须限流 + 钳制**。与 health「必须鉴权写」相反，点击是访客行为，只能匿名写。风险用三层压住：

- `normalizeIncrements`：非法项（无 id / 非正数 / 超长 id）静默丢弃；单站点单次增量钳到 `MAX_STEP=50`；单次最多 `MAX_BATCH=300` 站点、总增量 `MAX_TOTAL_STEP=2000`。
- 单实例内存窗口限流：同 IP 60s 内最多 60 次写。
- 前端 `sendBeacon` + 批量合并，正常流量天然低频。

**④ 待发队列必须落 localStorage**。点击发生在**跳转前的一瞬**，用户点完即离开页面；若只放内存，未发出的增量会随页面卸载一起丢。故 `pending` 持久化，并在 `pagehide` / `visibilitychange` 用 `sendBeacon` 兜底发出（拿不到响应时靠 `absorb` 乐观并入，避免角标回跳）。任何发送失败都**保留队列**下次重试 —— 丢一点可以接受，丢整份不行。

**⑤ 展示与排行共用一份 `mergedCounts`**（云端已确认 + 本地待发）。否则「角标」与「排行」会出现两套口径：点完角标 +1 但排行没动。

**⑥ 删除站点时点击一起消失**。合并前按 **Blob `sites.json`**（运行时权威表，而非部署包的 `sites-data.json`）取当前站点集剔除；读取失败返回 `null` 则**跳过剔除**（fail-open，宁可多留一条也不清空整份）。

### 39.4 验收（2026-10-03）

```
node tools/console/test-ops.mjs   →  内核用例 101 通过 / 0 失败（clicks 相关新增 12 条）
npm run build                     →  ✓ built in 8.59s（PWA precache 288 entries）
```

回归用例覆盖：非法项丢弃、同 id 累加且受单站点上限约束、站点数上限截断、`mergeClicks` 剔除已删站点（含 prev 残留）、未传 `known` 时跳过剔除、非正增量不产生 0 值脏键、`tallyClicks` 汇总、`countOf` 非法兜底、`rankByClicks` 降序 + 同分按名升序且不改动入参。

### 39.5 使用方式

- **前台**：工具栏「排序」下拉新增「按点击量」；设置面板「默认排序」同样可选；卡片页脚、热门站点卡片显示全网累计点击角标。
- **后台**：站点管理卡片显示点击量且可按点击量排序；数据洞察新增「点击量 TOP 10」，头部显示「全网累计点击 N 次 · M 个站点有点击」。
- **读取 TTL**：云端点击快照 5 分钟 TTL，页面长开时按 TTL 轮询刷新；`refresh()` 可强制拉取。

### 39.6 上线后修复：榜单不再用 0 点击站点冒充「热门」（2026-10-03）

**发现**：线上验收时确认排序下拉、API、渲染均正常，但「热门站点」区与后台「点击量 TOP 10」在全站点击量为 0 时，仍会各取 6 / 10 个站点填满榜单，并标注「0 次点击」。

**为什么必须改**：改动前的 `hotSites`（`[...sites].sort(by visitCount).slice(0,6)`）同样是「永远取 6 个」——所以这不是本次引入的回归。但**点击统计刚上线时全站点击必然从 0 起步**，于是每个访客都会看到「0 次点击」的假热门，比不显示更误导。

**修复**：两处榜单都改为**只列真的有点击的站点**，无数据时不填满：

```js
// ContentFeed.vue：空数组 → 整个分区隐藏
const hotSites = computed(() =>
  rankByClicks(sitesStore.sites, clicksStore.mergedCounts)
    .filter(s => clicksStore.countFor(s.id) > 0)
    .slice(0, 6))

// AdminInsights.vue：空数组 → 显示空态文案
const topSites = computed(() =>
  rankByClicks(sitesStore.sites, clicksStore.mergedCounts)
    .filter(s => clicksStore.countFor(s.id) > 0)
    .slice(0, 10))
```

「推荐发现」的兜底分支**保持原样**：它的定位是「推荐」而非「热门」，无历史时推荐未访问站点是合理行为，不构成误导。

**验证**：重新构建通过（9.35s）并二次部署（新 bundle `index-pUoI4sz5.js` / `AdminView-C13h3a92.js`）。线上 `/feed` 实测：点击量为 0 时页面出现「最近访问」「推荐发现」，**「热门站点」分区已隐藏**，且无 `/api/clicks` 相关报错 → 修复生效。

> 注：后台「点击量 TOP 10」的空态文案（需登录后台）本轮**未实测**，仅经构建通过；其逻辑与 `/feed` 同源（同样的 `filter(countFor > 0)`），风险等同。

### 39.7 验收留痕（2026-10-03）

| 项 | 方式 | 结果 |
|---|---|---|
| 内核用例 | `node tools/console/test-ops.mjs` | 101 通过 / 0 失败 |
| 生产构建 | `npm run build` | ✓ 通过 |
| 生产部署 | `npm run publish` → v110；`npm run deploy`（修复版） | 已 alias `navigator-v2-two.vercel.app` |
| `GET /api/clicks` | curl（经探测代理 7900） | `{"version":0,...,"clicks":{}}` 空态正常 |
| `POST /api/clicks` | curl 投递不存在站点 id | `version:1 / patched:1 / clicks:{}` → 写入成功且**已删站点被正确剔除**，未污染真实统计 |
| 前台排序 | 线上浏览器 | 下拉含「按点击量」，选中后 299 站点正常渲染 |
| 热门分区隐藏 | 线上 `/feed` 浏览器 | 点击量为 0 时「热门站点」已隐藏 |

---

## 四十、复探复核原「6 个需处理」站点（2026-10-03）

**背景**：用户要求「复核那 6 个需处理的站点」。该 6 个来自 §37.6 的首轮判定（301 站，正常 245 / 可忽略 50 / 需处理 6）。本轮先全量重探（299 站，202s）确认现状，再对 6 个逐一复核。

**先说结论**：当前**「需处理」只剩 1 个**，不是 6 个 —— 3 个是引擎误判（已随 §37.6 修复归正），2 个已删除（§38.1）。

| ID | 站点 | 首轮判定 | 本轮实测 | 结论 |
|---|---|---|---|---|
| `l2` | Kaggle | down(404) | 200 正常 | 误判已归正（HEAD 404 / GET 200） |
| `s9` | 文心一言 | down(404) | 200 正常 | 误判已归正 |
| `md7` | BlockBeats | down(ERR) | 200 正常（16.4s） | 误判已归正；响应偏慢但可用 |
| `g12` | DESIGN.md Editor | down(402) | **402 仍失效** | 真失效，用户决定**继续观察** |
| `sm3` | Xtemporary | down(ERR) | 已删除；`xtemporary.com` 双公共 DNS 均 NXDOMAIN | 删除正确 |
| `sm16` | 四方接码平台 | down(ERR) | 已删除；`sz-fang.cc` 无 A 记录、HTTPS 000 | 删除正确 |

全站现状：**正常 254 / 可忽略 44 / 需处理 1**，与云端判定（`version=4`）计数完全一致，故**本轮未重新发布判定**。

### 40.1 g12 复核证据（为何定性「真失效」而非 WAF 误报）

```
HTTP/1.1 402 Payment Required
Server: Vercel
X-Vercel-Error: DEPLOYMENT_DISABLED
```

`DEPLOYMENT_DISABLED` 是**站点所有者侧**禁用了 Vercel 部署（常见于免费额度暂停或主动下架），与 402 状态码互为印证 —— 不是反爬拦截，因此不适用「402 偶有 WAF 误报」的一般提醒。

替代地址核查（结论：官方尚未迁移）：

| 地址 | 结果 | 说明 |
|---|---|---|
| `design.ricoui.com` | 402 | 已失效本体 |
| `ricoui.com`（主域） | 200 | 作者主站正常 |
| `ricoui.com/blog/design-md-editor/` | 200 | 该文内的工具链接**仍指向已失效的 `design.ricoui.com`** → 官方未迁移 |
| `github.com/ricocc/ricoui-design-md` | 200 | 开源仓库，性质是代码仓库而非在线编辑器 |

> 站内已有 `cd16` DESIGN.md（`designmd.ai`，200）覆盖同类主题，即使日后删除 g12 也不造成内容空缺。

### 40.2 决策

用户确认 **g12 继续观察**（`DEPLOYMENT_DISABLED` 常可逆 —— 作者恢复额度或重新启用后即可访问）。本轮**未改动任何数据**，站点表与云端判定保持 299 条。

> 诊断要点留痕：`ricoui.com` 首次探测返回 `000`，复测为 200 —— 属瞬时失败，**单次 000 不足以定性失效**，需复测或结合响应头判断（与 §37.6「HEAD 误判」同一类教训）。

---

## 四十一、收录新站点 dt35 AltVsBTC（2026-10-04）

**需求**：用户给出 `https://altvsbtc.com/`，要求收录到站点库。

**站点画像**：把山寨币统一以比特币计价排名的数据看板（日线收盘 + 实时价格，按相对 BTC 的强弱排序）。官方自述 "Every alt, priced in Bitcoin … Research, not financial advice"。归入 **`data`（数据与研究）**。

**新增条目**（`api/sites-data.json`，仅 +18 行）：

| 字段 | 值 |
|---|---|
| id | `dt35`（data 分类顺延，原至 dt34） |
| name / url | AltVsBTC / `altvsbtc.com` |
| categoryId | `data` |
| color | `#f7931a`（比特币橙） |
| sortOrder | 302（全表顺延，原至 301） |
| icon | `icons/dt35.png`（26,957 B） |
| aliases | alt vs btc / 山寨币对比比特币 |

**验证**：

| 项 | 结果 |
|---|---|
| schema 校验 | `npm run validate` → 300 条通过（8 条历史缺图标警告，与本次无关） |
| 数据发布 | `npm run publish` → **v112 / 300 站点 / 292 带图标**，轮询一致 |
| 探活判定 | `nav sites check --ids dt35 --publish` → **v5 / 300 条**，dt35 = ok · 200 · 1.8s |
| 线上核对 | `/api/sites` v112 含 dt35；`/api/health` v5 含其判定；`/icons/dt35.png` → 200 |

**操作失误与修复（留痕）**：`npm run icons -- --only dt35` 中的 `--only` 被 npm 当作自身配置项吞掉（`npm warn invalid config only="dt35"`），脚本遂**全量重抓 300 站点**，已处理约 60 个。中断后 6 个站点图标被改写扩展名（旧文件已删、JSON 未更新 → 数据与文件不一致）。处置：`git checkout -- public/icons` 还原受跟踪文件 + 删除 6 个孤儿新文件，改用 `node scripts/fetch-favicons.mjs --only dt35` 直调脚本，最终 diff 仅 18 行。

> 教训：**经 `npm run <script> -- <args>` 透传参数不可靠** —— `--only` 这类与 npm 自身同名的 flag 会被截胡，脚本收到的是空参。需要透传时直接 `node <script> <args>`。

> 代理端口：本轮 `publish` 自报「代理环境: http://127.0.0.1:7897」，即 `shared/proxy.mjs` 自动探测生效；Clash 端口本轮再次漂移（7900 → 7897），环境变量已随之改回 7897。

---

## 四十二、添加站点增强：自动翻译 · 站点用途 · 点击热度（2026-10-07）

**需求**（用户原话）：增强「添加站点」功能 —— ① 自动翻译，非中文译成中文；② 新增站点用途，智能推断用途；③ 前端展示点击次数（要求卡片上更醒目）。

### 42.1 三个子功能一句话

| 子功能 | 内核 | 落点 |
|---|---|---|
| 自动翻译 | `shared/translate.mjs` | 添加站点时把外文 name / desc 译成中文，原文对照展示 |
| 站点用途 | `shared/purposes.mjs` | 新增 `purposes` 字段，多标签、可筛选、可搜索 |
| 点击热度 | `src/stores/clicks.js`（已有）+ `SiteCard.vue` | 卡片上由角落灰字改为热度徽章 |

### 42.2 用途（purposes）：与分类正交的第二把尺子

**关键设计取舍 —— 用途 ≠ 分类，不能互相替代：**

- 分类回答「这是什么方向的站」（AI 学习 / 币圈 / 工具），**归属唯一**，决定站点位置；
- 用途回答「我用它来干什么」（查资料 / 交易 / 写代码），**可多选、跨分类存在** —— 同一个「查资料」既可能落在数据研究站，也可能落在媒体站。

因此用途必须是**独立字段**，而不是从分类反推的展示文案。

**受控词表**（12 个，封闭集合，`PURPOSE_TAGS`）：`reference` 查资料 · `tool` 在线工具 · `data` 看数据 · `ai-chat` AI 对话 · `coding` 写代码 · `design` 设计素材 · `learning` 学习 · `news` 资讯 · `video` 看视频 · `community` 社区交流 · `trading` 交易 · `productivity` 办公协作。单站点上限 `MAX_PURPOSES = 4`。

> 为什么是封闭词表而非自由文本：自由文本做不了筛选条，也统计不出「哪些用途最常用」。

**推断口径**（`inferPurposes`）：分类基线打底（`BY_CATEGORY`，人工确认过的强信号，保证至少有一个用途）→ 关键词命中补充（`BY_KEYWORD`）→ 按上限截断。分类在前、关键词在后。规则之间**不共享同一个词**（曾把「行情」同时写进 data 与 trading）。

**归一校验**（`normalizePurposes`）：接受数组或「逗号/顿号/换行」分隔字符串，剔除词表外脏值、去重、按上限截断 —— 与 `normalizeAliases` 同风格，非法项静默丢弃而非抛错（同时服务「读旧数据」与「写入前清洗」）。

### 42.3 自动翻译：无 AI 密钥的免密钥方案

项目**没有任何 AI 集成、也没有可用 API Key**。翻译只是「把外文简介变中文」这一个窄用途，不值得引入密钥管理与计费链路，故走公开免密钥接口：**Google 非官方翻译接口为主，MyMemory 为兜底**（`translateToZh`）。

**判定规则（避免把品牌名译坏）：**

- `looksChinese` —— 出现任意汉字即视为中文，不再翻译（混合文案 "ChatGPT 中文站" 里的汉字已承载语义）；
- `needsTranslation` —— 非空、含字母、且非中文，纯数字/符号不译；
- `shouldTranslateName` —— 名称额外要求「词组型」（含空格，如 "Best Free Online Tools"）。**单词型基本是品牌名**（Uniswap / OpenAI / DeepSeek），翻成中文只会得到音译垃圾，保持原样；描述是散文，非中文一律译。
- 译文与原文相同时视为未译成功，继续尝试兜底引擎；两个引擎都失败则返回空串，**调用方保留原文，绝不写入空译文**。

**传输层注入**：内核只负责「该不该译 / 怎么解析 / 怎么兜底」，不关心怎么发请求 —— 线上 `api/metadata.js` 用 Node 原生 fetch，本地控制台 `tools/console/lib/sites.mjs` 用 `curl.exe`（本机 Node fetch 不走系统代理会连不通）。硬约束：`translate.mjs` 只在 Node 侧被引用，**不得被 `src/` 引用**，否则会把不存在的传输层打进浏览器包。

### 42.4 数据口径与多入口一致

- `shared/ops/site-ops.mjs`：`SITE_FIELDS` / `EDITABLE_FIELDS` 增加 `purposes`；`validateSite` 校验「必须是数组、词表内 id、无重复、不超上限」；新增批量操作 `purposeAdd`（追加）/ `purposeSet`（替换）；`matchSite` 支持按用途 id 或中文标签命中。
- `shared/site-infer.mjs`：`inferSite` 返回 `purposes`，用推断出的分类做基线 —— **线上与控制台两个「新增站点」入口共用同一内核，口径必然一致**（各写一套规则迟早漂移，同一网址两个入口拿到不同用途，用户会以为功能坏了）。
- `scripts/validate-data.mjs`：新增 `purposes` schema 校验。
- 四端同步：`api/metadata.js`（线上）、`tools/console/lib/sites.mjs`（本地控制台）、`tools/cli/commands/sites.mjs`（CLI）、`tools/mcp/server.mjs`（MCP）。

### 42.5 前端落点

| 位置 | 改动 |
|---|---|
| `AddSiteModal.vue` | 用途多选（`PurposePicker`）+ 「自动推断」标记 + 翻译状态与原文对照提示（`已自动译为中文（原文：…）`） |
| `EditSiteModal.vue` | 用途多选；清空时传 `undefined` 而非空数组（空数组会让卡片渲染出空标签行） |
| `PurposePicker.vue`（新） | 用途多选组件，到上限后未选中项置灰 |
| `PurposeTags.vue`（新） | 用途标签展示，词表外脏值直接丢弃 |
| `FilterBar.vue` | 新增「用途」筛选行（`Axis 4`），与分类正交，可跨分类聚合「所有查资料站」；只列出现过的用途 |
| `SiteCard.vue` | 卡片新增用途标签行；点击量由角落灰字改为**热度徽章** |
| `SiteDetailPanel.vue` | 新增「用途」分区 |
| `src/utils/search.js` | `scoreSite` 新增用途命中档 `PURPOSE_INCLUDES: 500`（介于域名与描述之间，受控词表命中比描述里顺带提及更可信）；支持中文标签与英文 id 两种写法 |
| `src/stores/sites.js` | 新增 `currentPurpose` 状态与正交筛选逻辑 |
| `src/App.vue` | 用途放 `?p=` query，与分类 `?c=`、范围、搜索词任意组合（路由是唯一事实来源） |

**点击热度徽章**（子需求③）：不再是 `--text-secondary` 的小灰字，改为着色药丸徽章 + 火焰图标，并按量级分档 —— `>=1000` 红（`hot`，火焰脉动）、`>=100` 橙（`warm`）、其余主题蓝。数字用 `tabular-nums` 对齐。仅在 `clickCount > 0` 时渲染，避免 0 值铺满卡片。

### 42.6 存量回填

存量 300 站点均无用途（字段是后加的）。新增一次性回填脚本 `scripts/seed-purposes.mjs`：

- 直接调用 `shared/purposes.mjs` 的 `inferPurposes`，**不另写规则**（与新增入口同源）；
- 幂等：只补「尚无用途」的站点，人工确认过的原样保留；
- 备份 + 原子写（`.tmp` → rename），与 `seed-aliases.mjs` 同款。

```
回填 300 个，跳过（已有用途）0 个，无从推断 0 个
  118 在线工具 · 106 交易 · 83 看数据 · 77 写代码 · 68 查资料 · 65 AI 对话
   46 资讯 · 44 学习 · 25 设计素材 · 21 社区交流 · 19 办公协作 · 11 看视频
```

12 个标签全部被用到，无「无从推断」的站点。备份：`backups/sites-data-2026-10-07-11-36-04.json`。

### 42.7 验证

| 项 | 结果 |
|---|---|
| 数据校验 | `node scripts/validate-data.mjs` → 300 条通过（8 条历史缺图标警告，与本次无关） |
| 用途 + 翻译单测 | `npm run console:test:purposes` → **156 条断言全部通过**（内联 fixture，不联网） |
| 控制台全量单测 | `npm run console:test:all` → 全绿 |
| 生产构建 | `npm run build` → 178 模块转换成功，PWA 289 条预缓存 |

> 未执行线上发布（`npm run publish`）—— 待用户确认后再发布。

### 42.8 单测覆盖（`tools/console/test-purposes.mjs`，156 条断言）

内联 fixture、零依赖、**不联网** —— 翻译的传输层用注入的假 `fetchText` 驱动，因此「Google 成功 / Google 失败退兜底 / 两个引擎都失败」三条分支都能覆盖，而不真的打外部接口。

| 分区 | 覆盖要点 |
|---|---|
| 词表 | id 唯一、色值合法、未知 / 非字符串 id 的容错 |
| 推断 | 分类基线、关键词补充、四字段（name/desc/keywords/url）参与匹配、大小写不敏感、分类 id 去空白、分类与关键词重叠去重、上限截断（含 `max:0` / 放大）、**单关键词 → 单用途映射表**（锁住词与用途的对应，防后续加规则时一词点亮两用途）、结果只含词表内 id |
| 归一 | 数组 / 逗号 / 全角逗号 / 顿号 / 换行入参、非字符串项丢弃、去重后再截断（重复项不占名额）、自定义上限、null 安全 |
| 统计 | 计数正确、脏值不计入、计数守恒、零数据返回完整词表、排序稳定（并列按 label） |
| 翻译判定 | 汉字判定（含混合文案、全角空格、纯符号）、字母混数字需译、词组型名称才译（品牌名保护）、首尾空白不算词组 |
| 解析 | Google 多段拼接 / 空段过滤 / 非数组段忽略 / 非 JSON / 源语言非字符串；MyMemory 实体还原（`&amp;` `&quot;` `&lt;` `&#39;`）、非字符串字段、缺字段、空白裁剪 |
| 地址 | 目标语言可覆盖、查询串精确截到 480 字符、语言对编码、空文本不抛错 |
| 引擎链路 | Google 优先、Google 失败 / 空译文 / 非 JSON 均退兜底、译文回显原文视为未译（含兜底引擎回显）、`from` 透传、入参先 trim、传输层返回 null / 非函数不抛错 |
| 字段编排 | 名称与描述独立判定、部分翻译、失败保留原文不写空串、原文对照字段、引擎标记、缺省字段安全 |

> 断言框架已用「变异探针」自检：故意写错一条期望值，确认测试以退出码 1 报错并打印实际差异，而非静默通过。

---

## 四十三、管理后台入口收敛进设置面板（2026-10-07）

**背景**：侧栏底部原有一枚常驻的「管理后台」按钮，与「添加站点」上下并排、长期占用底部空间。用户要求把它收敛进设置入口。

**改动**

| 文件 | 改动 |
|---|---|
| `src/components/Sidebar.vue` | 删除底部 `sidebar-admin-btn` 按钮、配套的 `goAdmin()` 与折叠态专属样式；折叠态底部改为无内边距、无分隔线（底部内容整体收起后不再留一条空边框） |
| `src/components/settings/AdminSection.vue`（新） | 设置面板新增「管理」分区：`管理后台` 说明 + 「进入」按钮 |
| `src/components/SettingsPanel.vue` | 挂载 `AdminSection`，新增 `open-admin` emit |
| `src/App.vue` | `openAdmin()` —— 先关设置面板再 `router.push('/admin')`，避免返回时面板仍盖在页面上 |

**可达性**：管理后台仍有两条入口 —— 设置面板「管理」分区，以及命令面板（`Cmd/Ctrl+K`）的「管理后台」项。侧栏折叠态不再需要为它保留常驻位。

**验证**：`npm run build` 通过；浏览器实测确认 —— 侧栏底部已无管理按钮、折叠圆钮不再压住「添加网站」按钮、设置面板底部出现「管理」分区、点「进入」后 URL 变为 `/admin` 且页面显示「管理后台」标题。

## 四十四、右侧详情面板默认展开 · 添加站点入口移到右上角（2026-10-07）

**背景**：右侧站点详情面板的折叠状态被写进 localStorage，用户折叠一次后长期处于收起态；同时左侧栏底部的「添加网站」带文字按钮与统计/时钟挤在同一块底部区域，用户要求整枚移除，改为右上角工具栏的图标按钮。

**改动**

| 文件 | 改动 |
|---|---|
| `src/stores/sidebar.js` | `rightCollapsed` 移出持久化字段（`versionedPersist('sidebar', ['width','collapsed'])`）：右侧详情面板每次进入默认展开，折叠状态不再跨会话记忆 |
| `src/components/Sidebar.vue` | 删除底部「添加网站」按钮、`AddSiteModal` 宿主、`showAddModal` 状态与 `sidebar-btn*` 样式；底部只保留统计与时钟 |
| `src/components/MainToolbar.vue` | 工具栏最右端（设置齿轮右侧）新增 `add-site-btn`：强调色实心 `+` 图标按钮，emit `open-add` |
| `src/App.vue` | 接管 `AddSiteModal` 宿主（原挂在左侧栏内），新增 `showAddModal` 状态并接线 `@open-add` |

**取舍**：`rightCollapsed` 只从持久化中移除，未改动 `RightSidebar.vue` 的响应式断点 —— ≤1024px 宽度收成 0、≤768px 隐藏（触屏无 hover，详情面板在该区间本就没有入口）仍按原策略生效。因此若窗口宽度 ≤768px，右侧面板依旧不会出现，这属于既有窄屏策略而非本次回归。

**验证**：`npm run build` 通过；构建产物核对持久化配置为 `{persist: ea("sidebar",["width","collapsed"])}`，确认 `rightCollapsed` 不再落盘；浏览器实测（603px 窄视口）—— 左侧栏底部已无「添加网站」按钮，右上角 `add-site-btn` 计算样式 `background-color: rgb(37,99,235)`（即强调色 `#2563eb`）实心填充，点击后弹出「添加站点」模态并含网址 / 站点名称 / 描述字段；控制台无报错。

**发布**：`npm run publish` 全流程通过 —— 数据备份、schema 校验门禁、构建、Vercel 部署（别名 `https://navigator-v2-two.vercel.app`）、云端热更新（version 113 → 114，300 站点 / 292 带图标，快照 `000113-2026-10-07T12-57-38-045Z.json`）、轮询验证一次收敛。线上产物指纹 `assets/index-BHqc81DK.js` 与本地构建完全一致，且产物内确认含 `add-site-btn`、`open-add` 与 `["width","collapsed"]` 持久化配置。

## 四十五、修复持久化字段过滤失效 · 右侧详情面板不再被记忆为收起（2026-10-07）

**现象**：四十四节改完后用户仍反馈右侧站点详情面板不显示。

**定位**：截图 1913×923，先用右上角那个「+」按钮标定缩放 —— 它在设计上是 32×32px，实测正好 32×32 图像像素，说明截图是 1:1，**窗口宽度 1913px**，远大于 `RightSidebar` 的 ≤1024px 收起断点。响应式断点排除后，只剩一个能让面板宽度归零的因素：`rightCollapsed === true`。

**根因**：`src/utils/storeVersioning.js` 的 `versionedPersist` 把字段过滤项写成了 `cfg.pick`，而 `pinia-plugin-persistedstate@3.2.3` 识别的配置项名是 **`paths`** —— 类型定义 `paths?: Array<string>`，运行时 `persistState(state, { storage, serializer, key, paths, debug })` 解构的也是 `paths`。`pick` 被**静默忽略** → `paths` 为 `null` → **整份 state 都落盘**。于是 `rightCollapsed` 被持久化，右侧面板「折叠一次 → 永久收起」。

**改动**

| 文件 | 改动 |
|---|---|
| `src/utils/storeVersioning.js` | `cfg.pick` → `cfg.paths`（形参同步改名为 `paths`）；`STORE_VERSION` 1 → 2；注册 `MIGRATIONS.sidebar`，清除历史落盘的 `rightCollapsed` / `open` / `hoveredSite` 瞬态字段 |

**影响面**：全项目只有两个 store 传了字段清单 —— `preferences`（清单恰好等于它的全部 5 个 state 字段，行为不变）与 `sidebar`（清单为 `width`/`collapsed`）；`favorites`、`history` 不传清单，`paths` 为 `undefined`，仍整份持久化。修正后 `sidebar` 不再持久化 `open` / `activeNav` / `hoveredSite`（`activeNav` 本就由路由派生，`hoveredSite` 是悬停瞬态，本就不该落盘）。

**验证**：临时脚本 17 条断言全绿（`paths` 生效、`pick` 消失、v1 脏数据被清、无版本号数据同样清理、v2 数据原样返回、其他 store 不受影响）；`npm run build` 通过，产物内 `.paths=` 存在、`.pick=` 消失、迁移函数与 `tu=2`（STORE_VERSION）已打包；发布 version 114 → 115，线上产物指纹 `assets/index-x_caUlmC.js` 与本地构建一致且含修复。

**用户侧生效条件**：刷新一次页面即可（迁移在读取 localStorage 时执行，早于 `$patch` 回填），无需手动清缓存。

## 四十六、左侧栏折叠后无法展开 · 移除左下角时间块（2026-10-07）

**现象**：点击左侧栏折叠后，找不到重新展开的按钮；另外左侧栏左下角的时间块要去掉。

**定位**：折叠开关 `.sidebar-collapse-toggle` 原本是「悬浮在侧栏右边缘外」的圆形按钮 —— `position: absolute; bottom: 12px; right: -14px`。但 `.sidebar` 同时设了 `overflow-y: auto; overflow-x: hidden`，超出边框盒的部分会被裁剪，按钮实际只剩贴着右边缘的一条，命中面积很小；侧栏折叠成 60px 后这个残条更难被点到，观感上就是「没有展开按钮」。

问题会被固化：`collapsed` 本来就在持久化清单 `['width','collapsed']` 里（这是有意保留的用户偏好），所以一旦折叠过，刷新后仍是折叠态，用户会持续卡在无按钮可点的状态。

**改动**

| 文件 | 改动 |
|---|---|
| `src/components/Sidebar.vue` | 折叠开关从绝对定位浮球改为 `.sidebar-bottom` 内的常规流按钮，不再依赖负偏移，因此不会被 `overflow` 裁剪：展开态整行显示图标 + 「折叠侧边栏」（215×35），折叠态收成图标居中的 44×36 方按钮；`.sidebar.collapsed .sidebar-bottom` 由 `padding: 0; border-top: none` 改为 `padding: 8px`，给按钮保留落点；移除 `DigitalClock` 组件引用、`.sidebar-clock` 相关样式与底部时钟 |

**影响面**：只动左侧栏自身布局，未改折叠状态语义（`collapsed` 仍持久化，用户偏好照旧被记住）。折叠态宽度、导航图标居中、badge 角标等既有规则不变。≤768px 的移动端媒体查询仍隐藏该按钮 —— 窄屏下侧栏是抽屉，由顶部汉堡按钮开关，折叠概念不适用（`isCollapsed` 在该区间本就恒为 `false`）。

**验证**：`npm run build` 通过。Playwright 1440×900 桌面视口实测 —— 展开态侧栏 240px、开关 `display: flex`、包围盒 215×35、文案「折叠侧边栏」；点击后侧栏收缩到 60px、开关仍 `display: flex` 且包围盒 44×36（x=8, y=856），完整落在视口内；再次点击可回到 240px 且统计文案重新出现；折叠态刷新后（`localStorage.sidebar` = `{"width":240,"collapsed":true,"__navDataVersion":2}`）按钮依旧可见可点。`.digital-clock` / `.sidebar-clock` 匹配数 0，底部时钟已移除。控制台无报错。

**发布**：`npm run publish` 全流程通过 —— 数据备份 300 条、schema 校验门禁通过（8 个站点缺 icon 仅为警告）、构建、Vercel 部署（别名 `https://navigator-v2-two.vercel.app`）、云端热更新（version 115 → 116，300 站点 / 292 带图标，快照 `000115-2026-10-07T13-25-05-013Z.json`）、轮询一次收敛。

线上产物与本地构建 **逐字节一致**（SHA256 相同）：`assets/index-C8FM2QQA.js`、`assets/index-CJ1GqeZ6.css`。线上 CSS 已确认含新规则 `.sidebar-collapse-toggle{display:flex;...}` 与 `.sidebar.collapsed .sidebar-bottom{padding:8px;...}`，旧 `.sidebar-collapse-toggle{position:absolute;right:-14px}` 与 `.sidebar-clock` 均已消失；线上 JS 内含「折叠侧边栏」文案且已无 `DigitalClock` 引用。

## 四十七、左侧栏去掉统计与按钮文字 · 右侧栏折叠后露出展开按钮（2026-10-07）

**现象**（用户反馈三项）：
1. 左侧栏底部的「共 N 个站点 / 今日访问 N / 收藏 N」统计文案要去掉。
2. 左侧栏折叠按钮不需要文字说明。
3. 右侧边栏在折叠状态下仍然没有展开按钮。

**根因（第 3 项）**：`RightSidebar.vue` 里同时存在两条会「把按钮藏起来」的规则 —— `.right-sidebar.collapsed { width: 0; overflow: hidden }` 让面板宽度归零并裁剪溢出内容，再加上显式的 `.right-sidebar.collapsed .right-collapse-toggle { display: none }`。按钮既被 `display: none` 摘掉，又被 `overflow: hidden` 裁掉，折叠后就再也点不到了，和四十六节左侧栏是同一类问题。

**改动**

| 文件 | 改动 |
|---|---|
| `src/components/Sidebar.vue` | 删除底部统计块（`.sidebar-footer` / `.sidebar-stats` / `.sidebar-stat`）及配套的 `todayCount` 计算属性与 `useHistoryStore` 依赖；折叠按钮去掉文字，改为 32×32 纯图标按钮，展开/折叠态同尺寸（折叠态由 `.sidebar-bottom { justify-content: center }` 居中） |
| `src/components/RightSidebar.vue` | 折叠态由 `overflow: hidden` 改为 `overflow: visible`，并新增 `.right-sidebar.collapsed > *:not(.right-collapse-toggle) { display: none }` 自行隐藏面板内容（不裁剪就得自己藏，否则内容会溢出盖到主内容区）；删掉 `.right-sidebar.collapsed .right-collapse-toggle { display: none }`；按钮折叠态改用 `left: auto; right: 8px` —— 面板宽度归零时面板左边缘即视口右缘，按钮因此溢出到视口右缘露出来，并补上白底 / 边框 / 阴影使其像个按钮 |

**关键点**：`.right-sidebar` 是 `position: relative`，绝对定位按钮的包含块就是面板本身，所以不需要把按钮挪到 `App.vue` 外层；只要面板不再 `overflow: hidden`，`right: 8px` 就能让按钮落在视口右缘。

**验证**：`npm run build` 通过。Playwright 在 1440×900 与 1100×800 两个桌面视口实测（结论一致）——
- 左侧栏：`.sidebar-stats / .sidebar-stat / .sidebar-footer` 节点数 0，侧栏文本不含「个站点」「今日访问」；折叠按钮 `innerText` 为空串、包围盒 32×32；折叠后侧栏 60px、按钮仍可见（32×32 居中），再点回到 240px。
- 右侧栏：展开态面板 280px、按钮可见（28×28 @ x=1169）；点击后面板归零到 x=1440、按钮仍可见且完整落在视口内（x=1404, y=12, 28×28），`elementFromPoint` 命中测试为真（即真的能点到）；再点击恢复 280px 且详情面板可见。
- 折叠态刷新后面板回到展开 —— 这是四十五节的既定行为（`rightCollapsed` 不入持久化，每次进入默认展开），非缺陷。
- 控制台无报错。

**发布**：`npm run publish` 全流程通过 —— 数据备份 300 条、schema 校验门禁通过（8 个站点缺 icon 仍为警告）、构建、Vercel 部署（别名 `https://navigator-v2-two.vercel.app`）、云端热更新（version 116 → 117，300 站点 / 292 带图标，快照 `000116-2026-10-07T13-38-32-307Z.json`）、轮询一次收敛。

线上产物与本地构建 **逐字节一致**（SHA256 相同）：`assets/index-DdnPT7e3.js`、`assets/index-DT1rzp7G.css`。线上 CSS 已确认含 `.right-sidebar.collapsed{...;overflow:visible}`、`.right-sidebar.collapsed>*:not(.right-collapse-toggle){display:none}`、`.right-collapse-toggle.collapsed{left:auto;right:8px;...}`，且 `.sidebar-stats` / `.sidebar-footer` / 旧的 `.right-sidebar.collapsed .right-collapse-toggle{display:none}` 均已消失。线上 JS 中「折叠侧边栏」仅剩 1 处、且只出现在按钮的 `title` 与 `aria-label` 里（悬停提示与无障碍标签），按钮本身渲染为纯图标。

## 四十八、左侧栏可拖到纯图标 · 右侧把手移到右缘垂直居中（2026-10-07）

**需求**：
1. 左侧栏宽度不设最小限制，可以拖到只剩图标。
2. 右侧栏的折叠把手放到右侧边缘的正中间，且是窄长形状。

**改动**

| 文件 | 改动 |
|---|---|
| `src/stores/sidebar.js` | `setWidth` 下限从 160px 降到 60px（上限仍 400px） |
| `src/components/Sidebar.vue` | 新增 `iconOnly` 计算属性 = 显式折叠 **或** `width <= 110`；新增 `sidebarWidth` 统一算出实际宽度。模板里原本由 `isCollapsed` 驱动的所有 `v-show` / `title` / 箭头旋转改用 `iconOnly`；CSS 里 `.sidebar.collapsed *` 全部改名为 `.sidebar.icon-only *`；拖拽手柄改为 `v-if="!isCollapsed"` 并删掉 `.sidebar.collapsed .sidebar-resize-handle { display: none }` |
| `src/components/RightSidebar.vue` | 把手由 `top: 12px; left: 8px` 的 28×28 方块改为 `top: 50%; right: 0; transform: translateY(-50%)` 的 18×64 竖条（`border-radius: 8px 0 0 8px`，悬停加宽到 24px） |

**关键点**
- 「无最小宽度限制」的物理下限是 **60px**：nav 项宽 44px + 两侧各 8px 内边距 = 60px，再窄图标本身就会被裁。所以下限设成图标宽度，而不是真的允许趋近 0。
- 宽度阈值 110px 是「文字放不下」的经验值：超过它就显示完整标签，拖到 110px 以下自动切纯图标 —— 这样「拖窄」和「按折叠按钮」视觉上收敛到同一套样式，不必非得点按钮。
- 拖窄成纯图标时**必须保留拖拽手柄**，否则用户被卡在窄态拖不回来。原先的 `.sidebar.collapsed .sidebar-resize-handle { display: none }` 在改名后会误伤（`icon-only` 同时覆盖「拖窄」和「显式折叠」两种来源），所以删掉该规则、改由 `v-if="!isCollapsed"` 只对显式折叠生效。
- 右侧把手用 `right: 0` 一个值就同时适配两种状态：面板右边缘在任何状态下都等于视口右缘（折叠时面板宽度归零），所以展开态和折叠态落点一致，不再需要分状态写定位。

**验证**：`npm run build` 通过。Playwright 1440×900 实测 ——
- 左侧栏：从 240px 拖 -170px 后宽度 70px、`icon-only` class 生效、`Navigator` 品牌与导航文字 `isVisible() === false`、拖拽手柄仍在（count=1）、折叠按钮可见；再拖 +160px 回到 230px 且文字恢复、`icon-only` 移除；极限拖到最左时宽度停在 **60px**（下限生效）。
- 右侧栏：展开态面板 280px、把手 18×64 @ x=1422,y=418；折叠态面板归零到 x=1440、把手仍在 x=1416,y=418。两态均满足「右缘 = 视口右缘 1440」「中心 y = 450 = 视口垂直中点」「宽 < 高」「`elementFromPoint` 命中为真」；再点一次恢复 280px。
- 控制台无报错。

**发布**：`npm run publish` 全流程通过 —— 数据备份 300 条、schema 校验门禁通过（8 个站点缺 icon 仍为警告）、构建、Vercel 部署（别名 `https://navigator-v2-two.vercel.app`）、云端热更新（version 117 → 118，300 站点 / 292 带图标，快照 `000117-2026-10-07T14-04-25-255Z.json`）、轮询一次收敛。

线上产物与本地构建 **逐字节一致**（SHA256 相同）：`assets/index-BJLuvHE3.js`、`assets/index-DmH25HNE.css`。线上 CSS 已确认含 `.sidebar.icon-only .sidebar-header/.sidebar-nav-item/.sidebar-bottom` 与新的 `.right-collapse-toggle{position:absolute;top:50%;right:0;transform:translateY(-50%);width:18px;height:64px;...}`，旧的 `.sidebar.collapsed` 系列规则与 `.right-collapse-toggle.collapsed{left:auto;...}` 均已消失；线上 JS 中 `setWidth` 边界已是 `Math.max(60,Math.min(400`，旧 `Math.max(160,Math.min(400` 已不存在。

## 四十九、左侧把手改为左缘竖条 · 右侧面板可自由拖拽宽度（2026-10-07）

**需求**：
1. 左侧栏的折叠按钮「做同样的」—— 与右侧把手同款式（贴边缘、垂直居中、窄长竖条）。
2. 右侧栏要和左侧栏一样，可以自由拖拽改变宽度。

**改动**

| 文件 | 改动 |
|---|---|
| `src/stores/sidebar.js` | 新增 `rightWidth`（默认 280）与 `setRightWidth`（同样 [60, 400] 钳制）；`rightWidth` 加入持久化 paths |
| `src/components/Sidebar.vue` | 折叠按钮从 `.sidebar-bottom`（32×32 图标按钮）移到 `.sidebar` 直接子级，改为 `top: 50%; left: 0; translateY(-50%)` 的 18×64 竖条（`border-radius: 0 8px 8px 0`、`border-left: none`、阴影朝右），与右侧把手左右对称；删除 `.sidebar-bottom` 容器及其样式 |
| `src/components/RightSidebar.vue` | 面板宽度改由 `panelWidth` 计算并经内联样式下发（折叠或 ≤1024px 时为 0，否则 `rightWidth`）；新增 `.right-resize-handle`（贴面板左缘 6px，向左拖变宽）；新增 `NARROW_QUERY` 媒体查询监听 —— 宽度一旦走内联样式，媒体查询里的 `width: 0` 就会被盖掉，所以 ≤1024px 的收起必须同时由 JS 判断 |

**关键点**
- 左侧把手**不会**被 `overflow-x: hidden` 裁掉：侧栏宽度下限 60px 大于把手最大宽 24px，它始终在侧栏盒子内部，不需要像右侧那样改成 `overflow: visible`。
- 右侧面板的拖拽方向是**反的**：面板贴右，所以 `startWidth + (startX - ev.clientX)`，向左拖才是变宽。
- 右侧面板宽度由内联样式统一下发后，CSS 里的 `width: 280px` 与媒体查询里的 `width: 0` 都成了死代码，一并删除，只留 store 一个来源，避免两处打架。
- 箭头方向：左侧原始折线是 `15 18 9 12 15 6`（顶点在左，即 `‹`），所以展开态不旋转、纯图标态转 180°；右侧原始折线是 `9 18 15 12 9 6`（顶点在右，即 `›`），规则相反。两者都满足「箭头指向点击后侧栏移动的方向」。

**验证**：`npm run build` 通过。Playwright 1440×900 实测 ——
- 左侧把手：展开态 box `x=0 y=418 18×64`（贴左缘、中心 y=450 = 视口垂直中点、宽<高）；折叠态侧栏 60px、把手仍在 `x=0 y=418`；与右侧把手（`x=1422`，右缘 = 1440）左右对称。
- 箭头方向（解析 `polyline` 顶点 + `getComputedStyle` 的旋转矩阵）：左侧展开 `‹`、折叠 `›`；右侧展开 `›`、折叠 `‹`，四项全部符合预期。
- 右侧拖拽：向左拖 -120px → 宽度 400（触上限）；向右拖 +300px → 宽度 100；极限向右拖 → 停在 **60**（与左侧同下限）；手柄 `elementFromPoint` 命中为真。刷新后宽度保持 60（`rightWidth` 已入持久化）。
- 折叠态右侧手柄数量 0、展开后回到 1；折叠态把手仍可见（`x=1416 24×64`，悬停加宽）。
- 控制台无报错。

**发布**：`npm run publish` 全流程通过 —— 数据备份 300 条、schema 校验门禁通过、构建、Vercel 部署（别名 `https://navigator-v2-two.vercel.app`）、云端热更新（version 118 → 119，300 站点 / 292 带图标，快照 `000118-2026-10-07T14-20-26-170Z.json`）、轮询一次收敛。

线上产物与本地构建 **逐字节一致**（SHA256 相同）：`assets/index-DuYwEm6b.js`、`assets/index-C7kwLnxs.css`。线上 CSS 已确认含 `.sidebar-collapse-toggle{position:absolute;top:50%;left:0;transform:translateY(-50%);width:18px;height:64px;border-radius:0 8px 8px 0;...}` 与 `.right-resize-handle{position:absolute;top:0;left:0;bottom:0;width:6px;cursor:col-resize;...}`，且 `.sidebar-bottom`、`.right-sidebar{width:280px`、`.right-sidebar.collapsed{width:0` 均已消失；线上 JS 含 `setRightWidth` / `rightWidth` 与 `Math.max(60,Math.min(400`。

## 五十、两个折叠把手改贴中间内容区两侧（2026-10-07）

**需求**：两个折叠按钮要吸附到中间页面的两侧，而不是吸附在屏幕的左边缘和右边缘。

**改动**

| 文件 | 改动 |
|---|---|
| `src/components/Sidebar.vue` | 把手锚点由 `left: 0`（视口左缘）改为 `right: 0`（本侧栏右缘 = 中间内容区左缘）；形状随之翻转成 `border-radius: 8px 0 0 8px`、`border-right: none`、阴影 `-2px` 朝内；`.sidebar-resize-handle` 的 `z-index` 由 20 降到 10 |
| `src/components/RightSidebar.vue` | 展开态把手锚点由 `right: 0`（视口右缘）改为 `left: 0`（本面板左缘 = 中间内容区右缘），形状 `border-radius: 0 8px 8px 0`、`border-left: none`、阴影 `+2px` 朝内；新增 `.right-collapse-toggle.collapsed { left: auto; right: 0; ... }` 覆写形状与锚点；`.right-resize-handle` 的 `z-index` 由 20 降到 10 |

**关键点**
- 右侧面板折叠后宽度归零，若继续用 `left: 0`，把手会被推到视口外（`x = 1440 ~ 1458`）。此时中间内容区已铺满到视口右缘，所以折叠态改锚 `right: 0`，把手依旧贴在内容区右侧 —— 两种状态落点语义一致，不是特例。
- 左侧栏折叠后仍有 60px 宽度，`right: 0` 天然就落在内容区左缘，无需分状态处理。
- 把手与拖拽手柄现在共用同一条边缘（左：侧栏右缘；右：面板左缘），两者重叠。把手 `z-index: 20` 高于手柄 `10`，所以把手在其覆盖的 64px 内仍可点，拖拽改从该竖带上下两侧进行（可用边缘仍有 836px）。
- 形状规则统一为「贴分界线那侧是平的、探出来那侧是圆的」，因此两侧把手在各自状态下都是圆角朝内容区、平边朝分界线。

**验证**：`npm run build` 通过。Playwright 1440×900 实测 ——
- 展开态：中间内容区 x 范围 `240 ~ 1160`；左把手 `x=221 w=18`（右缘 239 = 侧栏 padding box 右缘）、右把手 `x=1161 w=18`（左缘 1161 = 面板 padding box 左缘），各差 1px 即各自 1px 边框；两侧均不再贴屏幕边缘（`x≠0`、右缘 `≠1440`）；均垂直居中（中心 y=450）、均 18×64、`elementFromPoint` 命中为真。
- 折叠态：左侧栏 60px、左把手 `x=35 w=24`（悬停加宽，右缘 59）；右面板归零到 `x=1440`、右把手 `x=1422 w=18` 且完全在视口内；两者仍垂直居中且可点。
- 往返：再点一次恢复 240 / 280。拖拽仍可用：左侧拖 -60 → 180，右侧拖 -60 → 340。
- 控制台无报错。

**遗留观察（非本次引入）**：点击折叠后，内联宽度**立即**变为 `0px`，但渲染宽度会滞留 0.45~1.5s 才动画到 0。原因是面板/侧栏的 `transition: width .28s` 会触发 300 张卡片的整体重排，配合 `backdrop-filter: blur(20px)` 每帧渲染很贵，过渡被拖成几帧跳跃。终态始终正确，属既有性能特征；若嫌点按手感迟钝，可去掉这两处宽度过渡（改为瞬时切换）或改用 `transform` 动画。

**发布**：`npm run publish` 全流程通过 —— 数据备份 300 条、schema 校验门禁通过、构建、Vercel 部署（别名 `https://navigator-v2-two.vercel.app`）、云端热更新（version 119 → 120，300 站点 / 292 带图标，快照 `000119-2026-10-07T14-35-52-423Z.json`）、轮询一次收敛。

线上产物与本地构建 **逐字节一致**（SHA256 相同）：`assets/index-BP0JzLiu.js`、`assets/index-DzR3shRD.css`。线上 CSS 已确认左把手为 `top:50%;right:0;border-right:none;border-radius:8px 0 0 8px;box-shadow:-2px 0 8px`，右把手展开态为 `top:50%;left:0;border-left:none;border-radius:0 8px 8px 0;box-shadow:2px 0 8px`、折叠态覆写为 `left:auto;right:0;border-left:1px solid;border-right:none;border-radius:8px 0 0 8px;box-shadow:-2px 0 8px`，两个拖拽手柄的 `z-index` 均为 10。

## 五十一、搜索栏「添加站点」入口 · 建议下拉可见性修复（2026-10-08）

**需求**：把「添加站点」入口扩充到站内搜索栏 —— 输入像网址时置顶给出「添加站点」（回车即带着网址进入添加），搜不到时给一条出路，其余情况在底部留一条淡入口；同时修复搜索建议下拉「点一下就不显示」的问题。

**改动**

| 文件 | 改动 |
|---|---|
| `src/utils/url.js`（新增） | 搜索栏与「添加站点」弹窗共用的网址工具：`normalizeUrl`（补协议）、`hostOf`（取主域名、去 `www`）、`looksLikeUrl`（要求 TLD ≥ 2 位字母，故 `chatgpt` / `a.b` / `1.2` 不会被误判）。两边用同一把尺子判断「是否已收录」，避免搜索栏说没收录、弹窗却拦重复 |
| `src/components/SiteSearchBar.vue` | 建议下拉新增三类条目：网址类输入置顶「添加站点」、域名已收录时提示「无需重复添加」并可跳转、其余场景底部淡入口；接入 ↑/↓ 选择 + 回车直达；可见性改用根元素 `ref` + `document` 的 `mousedown` 判定外部点击，配合 CSS keyframe 淡入，替换原先依赖 `<Transition>` 的写法 |
| `src/components/AddSiteModal.vue` | 支持 `prefillUrl` 预填并自动补全，改用共用网址工具 |
| `src/components/MainToolbar.vue` · `src/App.vue` | 打通事件链，把搜索栏识别的网址透传给弹窗 |
| `tools/console/test-url.mjs`（新增） | 补网址工具的归一化 / 主域名 / URL 识别用例 |

**验证**：`npm run build` 通过；`npm run console:test:all` 全绿；浏览器实测 —— 点击搜索框建议下拉可见、点击外部可关闭、「添加站点」入口回归通过。

**发布**：`nav publish run --gate e2e8014d`（`5c737367`）全流程通过 —— 提交 `3d48492`（43 个文件）→ 推送 `origin/master` → 数据备份 300 条 → schema 校验门禁通过 → 构建 → Vercel 部署（Production `navigator-v2-21qslx59n`，别名 `https://navigator-v2-two.vercel.app`）→ 云端热更新（version 120 → 121，300 站点 / 292 带图标，快照 `000120-2026-10-07T16-29-43-080Z.json`）→ 轮询一次收敛。全程约 93s。

---

## 五十二、卡片体系升级：三处断层修复 + 信息架构（2026-10-09）

方案见 `docs/NAV-v7-card-system-upgrade-plan.md`（用户「全部按建议改」）。本次落地 P0 全部 + P1 全部 + P2 两项。

**P0 三处断层**

| 断层 | 修复 |
| --- | --- |
| 卡片主体左键点击**什么都不做**（`.card { cursor: default }`），打开站点只能点右下角 30×30 箭头；移动端 ≤768px 右侧面板整体隐藏、无 hover，主入口只剩那个小箭头 | `SiteCard` 加 `role="button"` / `tabindex="0"` / `@keydown.enter/.space` / `:focus-visible` 焦点环，`cursor` 改 `pointer`；主体点击、回车、空格、箭头按钮统一走 `openSite()`。拖拽手柄与健康角标 `@click.stop` 防误开 |
| 卡片内 **15 处硬编码色**，6 套视觉方案与深色主题驱动不了（深色下收藏态是 `#fefce8` 亮黄块） | `visualScheme.js` 生成 12 个语义 token（`--color-ok/warn/danger/muted/favorite*/heat-*/on-solid`），**明暗两套值**；`SiteCard` 硬编码色 **15 → 0** |
| 右键菜单每卡一份：300 卡 = 300 个 `<Teleport>` + **600 个 document 监听**（click + scroll 捕获各一） | 新增 `stores/contextMenu.js` + `components/ContextMenuHost.vue` 全局单例；编辑/删除由卡片以回调注入（`handlers`），菜单不碰业务。**`SiteCard` 的 `addEventListener` 2 → 0** |

**P1 信息架构**

- **卡片信息密度三档**：`preferences.cardDensity`（持久化）+「设置 → 显示 → 卡片信息密度」= 简洁 / 标准 / 详细。默认「标准」即既有形态，**任何原内容都没丢**；「详细」再多给别名与三行描述。
- **别名浮出**：`aliases` 覆盖 135/300 却一直只服务搜索。详情面板新增「别名」chip 段；卡片 `title` 原生提示带上别名。
- **访问状态**：「未访问」淡徽章（`history.getLastVisitTime`）；**「最近」视图改为浏览历史倒序**（只列访问过的），原「最近添加」排序更名**「最新收录」**——视图与排序不再说同一件事（此建议见 `NAV-v5-nav-optimization.html` L751，长期未落地）。
- **移动端详情入口**：新增 `MobileDetailDrawer.vue` 底部抽屉（复用 `SiteDetailPanel`，Esc/遮罩关闭）；右键菜单新增「查看详情」，由 `sidebarStore.showDetail()` 按视口分流（宽屏 → 右侧面板，≤768px → 抽屉）。

**P2 能力**

- **置顶**：`pinned` 字段 + `togglePin`；右键菜单「置顶/取消置顶」；底栏置顶徽章；`filteredSites` 在**不搜索时**把置顶项浮到最前（搜索是相关性说了算，插队会骗人）。
- **批量操作扩展**：`batchUpdate / batchSetCategory / batchAddPurpose`（一次遍历只 `rebuild` 一次，避免 N 次全量重算）；批量栏新增「改分类」「加用途」下拉 + Toast 反馈。

**P3（部分）**：回收站行不再借用 `SiteCard` 的 `.card-favicon/.card-title/.card-desc`（这组类名在 7 个组件里各自 scoped 且语义不同 —— AdminSitesPanel 的 `.card-title` 是个 flex 列，故不做全局收编），改为自有 `trash-*`。

**未做**（及原因，详见方案 §8）：站点归档（需新查看入口 + 数据门禁 + 后台表单，涉线上契约）、`SiteCard`/`CardsContainer` 深度拆分（本环境无视觉回归手段）、`sortOrder` 去重与 `www.` 前缀（改写线上数据）、折叠过渡性能（无法测帧率）。

| 文件 | 变更 |
| --- | --- |
| `src/components/SiteCard.vue` | 可点开/键盘可达、语义色 token、菜单外移、密度档、别名 title、未访问与置顶徽章 |
| `src/components/ContextMenuHost.vue`（新增）· `src/stores/contextMenu.js`（新增） | 全局单例右键菜单 |
| `src/components/MobileDetailDrawer.vue`（新增） | 移动端详情抽屉 |
| `src/utils/visualScheme.js` | 12 个语义色 token（明暗两套） |
| `src/stores/sites.js` | `batchUpdate/batchSetCategory/batchAddPurpose/togglePin`；`filteredSites` 置顶浮前 |
| `src/stores/sidebar.js` | `detailSheetSite` / `showDetail` / `closeDetailSheet` |
| `src/stores/preferences.js` | `cardDensity`（持久化） |
| `src/components/CardsContainer.vue` | 密度接线、批量改分类/加用途、回收站自有样式、「最近」改浏览历史 |
| `src/components/right/SiteDetailPanel.vue` | 新增「别名」段 |
| `src/components/settings/DisplaySection.vue` · `MainToolbar.vue` | 密度选择；「最近添加」→「最新收录」 |
| `docs/NAV-v7-card-system-upgrade-plan.md`（新增） | 调研 + 分期方案 + 实施结果 |

**验证**：`npm run build` 通过；目标指标用 grep 复核（硬编码色 15→0、卡片 document 监听 2→0）。

---

## 五十三、卡片体系补齐：归档 / 数据归一 / 折叠性能（2026-10-09）

承接 §五十二。用户要求「把上次说明没做的全部搞定」，并提示本机有浏览器可用。本轮先打通浏览器（**零依赖 CDP 客户端**驱动本机 Chrome：Node 22 内置 `WebSocket`，不装任何 npm 包），于是每一项都做了真机验证。

**站点归档（新）**
- 新路由 `/archived`；侧栏新增「归档」入口（带条数徽章）。范围轴语义：`sitesStore.archivedScope` 由 App 按路由下发，`categorySites` 据此二选一 —— 归档范围内只看归档，**其余范围（全部/收藏/最近/搜索）一律不显示**。
- 右键菜单「归档 / 取消归档」；`EditSiteModal` 增加「置顶 / 归档」两个开关；归档卡片虚线边 + 降不透明度 + 「已归档」徽章；归档范围隐藏筛选条（筛选条计数基于在册站点，在该范围会虚高）。
- `validate-data.mjs` 增加 `archived` / `pinned` 布尔类型门禁。

**数据归一**
- 新增 `scripts/normalize-www.mjs`（带备份、支持 `--dry-run`），去掉 20 条 url 的 `www.` 前缀。**改前逐个实测裸域**（curl -L 跟随跳转）：19 个 200；第 20 个（`acc2`/idpifa.net）两种形态都不可达，属站点本身问题（同一 Cloudflare IP），故全部安全去除。刻意不动 `updatedAt`。
- `sortOrder` 重复：**实测已无重复**（300 条 / 300 个唯一值），HANDOVER 早先那条待办是过时记录。

**折叠过渡性能（真因与修复）**
- 真因不是两个侧栏，而是 **`.main` 自带 `backdrop-filter: blur(20px)`**，而它正是 300 张卡片所在的内容区：宽度一变，整块背景模糊每帧重算。
- 修复：`sidebarStore.animating` 在折叠/展开/拖拽调宽期间给 `.app-layout` 挂 `no-blur`，临时摘掉模糊（`main.css` 里 `.app-layout.no-blur .main/.sidebar/.right-sidebar`），动画结束自动恢复。
- 实测（5 轮交替取中位，700ms 窗口）：中位最差帧 **217ms → 150ms**，中位 p95 **217ms → 50ms**；空闲基线 16.7ms。`PerformanceObserver` 显示折叠期间 longtask 总时长 = 0，证实卡顿在光栅/合成而非 JS 主线程。
- 剩余 150ms 来自 300 张卡片随宽度重排本身，需改成 transform 位移布局才能消除，属架构改造，未做。

**真机验证覆盖**：300 卡渲染、卡片点击/Enter/空格打开（点收藏不打开）、右键菜单 DOM 中只 1 个实例、深色下收藏态 `rgba(234,179,8,.16)`（亮黄块消除）、详情面板别名段、390×844 下右面板 0 宽 + 详情抽屉打开、归档流转、置顶升位。

**顺带修复**：新会话下 300 张卡全挂「未访问」徽章（真机截图发现），改为只在「详细」密度档出现。

**刻意不做**（理由见方案 §9.3）：抽 `FaviconBadge`（波及 7 个组件且同名类语义不同）、折叠重排的布局改造、移除 `discover`（实为「全部」的范围 id，文档结论已过时）。

**验证**：`npm run build` 通过；`npm run console:test:all` 全绿（视觉方案断言 68 → 72，新增语义色随主题模式取不同值的用例）。
