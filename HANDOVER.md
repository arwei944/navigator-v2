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
│   ├── components/             # Vue 组件（19 个）
│   │   ├── AddSiteModal.vue       # 添加网站弹窗
│   │   ├── BookmarkImport.vue     # 书签导入导出
│   │   ├── CardsContainer.vue     # 卡片容器（网格/列表/虚拟滚动）
│   │   ├── CommandPalette.vue     # 全局命令面板（Ctrl+K）
│   │   ├── ConfirmDialog.vue      # 确认对话框
│   │   ├── ContentFeed.vue        # 内容聚合视图
│   │   ├── DigitalClock.vue      # 数字时钟
│   │   ├── EditSiteModal.vue      # 编辑网站弹窗
│   │   ├── GoogleSearchBar.vue   # 搜索引擎栏
│   │   ├── MobileHeader.vue       # 移动端顶部栏
│   │   ├── RightSidebar.vue       # 右侧站点详情面板
│   │   ├── SettingsPanel.vue      # 统一设置面板
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

### 5.4 云同步
- 基于 Vercel KV 的站点数据同步
- API 端点：`/api/sync/upload`、`/api/sync/download`、`/api/sync/merge`
- 前端服务：`src/services/sync.js`

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

### 7.5 Vercel KV 配置
云同步功能依赖 Vercel KV，需在 Vercel 项目设置中：
1. 创建 KV Storage
2. 环境变量会自动注入 `KV_URL` 和 `KV_REST_API_TOKEN`

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
- 站点 favicon 抓取：目前用首字母色块，可集成 Google favicon API
- 排序权重去重：清理重复的 sortOrder 值
- PWA 图标补充：生成 192px 和 512px 的 PNG 图标
- 移动端优化：进一步适配小屏幕交互
- 站点健康检查：定期检测失效链接

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
