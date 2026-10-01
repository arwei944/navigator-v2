# Navigator V2 项目交接文档

> 最后更新：2026-09-25
> 线上地址：https://navigator-v2-two.vercel.app
> 仓库本地路径：`c:\work\solo work\new\nav-v2`

---

## 一、项目概述

Navigator V2 是一个现代化的网站导航中心，聚合了 AI 工具、加密货币、基础服务等领域的优质站点。基于 Vue 3 + Vite + Pinia 构建，部署在 Vercel，支持 PWA 离线使用。

**核心数据：**
- 站点总数：约 210+ 个
- 分类总数：4 个大类、22 个子分类
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
| KV 存储 | @vercel/kv | ^3.0.0 |

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
│   │   ├── SiteSearchBar.vue      # 站点搜索栏
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

- 站内搜索 `SiteSearchBar` + 外部搜索 `ExternalSearchBox` 同排。外部搜索用原生 `<form method="GET">`
  提交（`target="_blank"` + `rel="noopener noreferrer"`），引擎下拉 Google / Bing / 百度 / DDG / PPLX，
  下拉用短标签避免被 `DuckDuckGo` 撑宽（设置面板内仍是全称），引擎选择持久化。
- 排序 / 批量选择 / 手动排序 / 视图切换 / 待办 / 主题 / 设置 收敛为一行，统计信息下沉。
- 响应式收敛：≤1500px「选择 / 手动排序」只留图标（tooltip 补文案）；≤1360px、≤1300px 逐级收窄外部搜索输入。

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
