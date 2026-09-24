# Navigator V2 项目交接文档

> 最后更新：2026-08-19
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
| `dt17` | Tange Stock | `stock.tanggestock.com/auth` | data | 229 | 全球实时行情与交易数据工作台，聚合加密货币/美股/贵金属实时行情，收录 113 标的、52 内置指标与实时数据流，专业级 K 线工作台支持多周期切换、指标叠加与画图工具，从看盘到复盘的一站式盯盘工具 |
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
