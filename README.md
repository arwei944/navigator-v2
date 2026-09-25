# Navigator — 网站导航中心

现代化网站导航中心，聚合 290+ 优质站点，覆盖 AI 工具、加密货币、开发者工具、基础服务等领域。

线上地址：https://navigator-v2-two.vercel.app
GitHub 仓库：https://github.com/arwei944/navigator-v2

## 技术栈

- **前端框架**: Vue 3 + Vite 5 + Pinia + Vue Router
- **搜索**: Fuse.js 模糊搜索 + pinyin-pro 拼音索引（全拼 + 首字母）
- **样式**: CSS 变量主题系统（明暗模式 + 4 套预设主题）
- **PWA**: Service Worker 离线支持，可安装为桌面/移动应用
- **数据真相源**: Vercel Blob（站点数据云端热更新，无需改代码即同步线上）
- **智能能力**: 站点实时在线状态角标 + 基于历史/分类共现的智能推荐
- **会话同步**: 收藏/待办/偏好按会话密钥云端同步（多设备一致）
- **部署**: Vercel（本地 `scripts/publish.mjs` 为唯一发布入口）
- **本地运维控制台**: Node 原生 HTTP + SSE 实时日志的单页控制台（`tools/console`，仅监听 `127.0.0.1`）
- **CI/CD**: GitHub Actions 门禁（数据校验 + 构建）+ release-please 自动版本与 CHANGELOG

## 架构概览

```
浏览器(PWA 离线)                          Vercel Serverless
┌─────────────────┐    30s 轮询/api/sites    ┌───────────────┐
│ Vue3 SPA        │ ───────────────────────▶ │ api/sites.js  │ → Blob (sites.json)
│ · 卡片虚拟化     │   POST 鉴权走请求头       │ api/session.js│ → Blob (session/<key>)
│ · 在线状态角标   │   GET 元信息代理          │ api/metadata.js│ → 抓取标题/图标
│ · 智能推荐Feed   │ ◀───────────────────── ─ │               │
│ · 云端会话同步   │                           └───────┬───────┘
└────────┬────────┘                                   │ scripts/: publish/check/icons/validate
  ▲      │ 本地 stores（版本化持久化，可平滑迁移）
  └──────┘
```

- **运行时数据唯一来源**：Vercel Blob 上的 `sites.json`
- **本地种子**：`api/sites-data.json` 仅作 Blob 为空时的兜底，由 `scripts/publish.mjs` 保持同步
- **热更新**：前端每 30s 轮询 `/api/sites`（`Cache-Control: no-store`）+ 标签页回到前台立即重拉，发布后秒级可见
- **读取一致性**：`api/sites.js` 的 `readStored()` 使用 `get(PATHNAME, { access: 'private', useCache: false })` 绕过 Blob CDN 缓存，发布后**首次**读取即拿到最新版本（此前需轮询 1~4 次才收敛）
- **在线状态**：`src/stores/health.js` 仅探测当前可见卡片，60s 缓存 + 6 路并发，卡片角标显示在线/限流/失效
- **会话同步**：`api/session.js` 以会话密钥为隔离凭证（`session/<key>.json`），字段级合并，与站点热更新互不冲突
- **本地数据版本化**：localStorage 持久化的 stores 统一附加 schema 版本号，未来结构变更可平滑迁移

## 功能特性

- [x] 多搜索引擎切换（Google / Bing / 百度 / DuckDuckGo / Perplexity）
- [x] 站点搜索（名称 / 描述 / URL / 拼音全拼 / 拼音首字母）
- [x] 多分类体系（AI / 币圈 / 工具 / 基础服务，29 个子分类）
- [x] 网格视图 / 列表视图切换
- [x] 站点管理：添加 / 编辑 / 删除（右键菜单 + 回收站恢复）
- [x] 批量操作：批量选择 + 批量删除
- [x] 拖拽排序 + 真实网站 favicon 图标
- [x] 收藏站点 + 访问记录追踪（最近 50 条）
- [x] 排序：默认 / 名称 A-Z / 热度 / 最近添加
- [x] 主题系统：4 套预设 + 明暗模式 + 自定义壁纸
- [x] 侧边栏可拖拽调节宽度、右侧站点详情面板
- [x] 统一设置面板 + 命令面板（Ctrl+K）
- [x] 数字时钟 + 待办事项面板
- [x] 书签导入 / 导出（浏览器 HTML 书签）
- [x] 管理后台（在线新增/编辑/删除 + 发布到云端，数据洞察统计）
- [x] 站点实时在线状态角标（在线/限流/失效，仅探测可见卡片）
- [x] 智能推荐（基于访问历史与分类共现的"为你推荐"）
- [x] 云端会话同步：输入同一密钥在多设备间同步收藏/待办/偏好
- [x] 卡片虚拟化（content-visibility），站点增多滚动依旧流畅
- [x] PWA 离线支持

## 常用命令

```bash
pnpm install         # 安装依赖（仓库锁定 pnpm，pnpm-lock.yaml 为唯一锁文件）
pnpm run dev         # 本地开发
pnpm run build       # 构建
pnpm run console     # 本地运维控制台 → http://localhost:5175（仅监听 127.0.0.1）
pnpm run publish     # 一键发布：备份 → 数据校验 → 构建 → 部署 → 云端热更新 → 轮询验证
pnpm run validate    # 站点数据 schema 校验（发布门禁与 CI 会自动调用）
pnpm run check       # 健康检查：探测所有站点可访问性
pnpm run check:report # 健康检查并生成 Markdown 报告
pnpm run icons       # 抓取/补抓网站 favicon
pnpm run perf        # 生成卡片虚拟化滚动基准页（默认 1000 卡片，可 --count N）
node scripts/fix-sortorder.mjs   # 清理 sortOrder 重复/空洞，重排为连续序列（自动备份）
pnpm run publish -- --key=<k> --webhook=<url> # 发布 + 成功后 webhook 通知
pnpm run perf -- --count 2000    # 生成 2000 卡片基准
```

### 发布脚本参数

```bash
pnpm run publish -- --skip-build   # 跳过前端构建，仅热更新云端数据
pnpm run publish -- -k <密钥>      # 显式传管理密钥（-k / --key=，否则读 .env.local / 环境变量）
pnpm run publish -- -w <webhook>   # 发布成功后向该 URL POST 一条通知（-w / --webhook=）
```

> CLI 参数统一用 Node 内置 `parseArgs` 解析（`publish.mjs`、`check-sites.mjs` 均支持）。

### 卡片虚拟化压测

生成 `perf-report/scroll-bench.html` 后，在该目录起静态服务器（`python -m http.server 5500`）浏览器打开，点「开始自动滚动」即可对比 content-visibility ON/OFF：
1000 张较复杂卡片 ON 状态平均 ~60fps、最低 ~60fps 稳定达标，OFF 平均跌至 ~49fps、最低 ~43fps（实测 v89）。站点数量增长后滚动依旧流畅。

### 响应式断点

桌面端自适应随网格列数切换，侧边栏可折叠（桌面 240px / 折叠 60px）、移动端为顶栏 + 遮罩抽屉模式（`MobileHeader`）：

| 视口宽度 | 网格列数 |
|----------|---------|
| `≥1440px` | 4 列 |
| 默认（1024–1440） | 3 列 |
| `≤1024px` | 2 列 |
| `≤768px` | 1 列（移动端） |

## 本地运维控制台

`pnpm run console` 启动，仅监听 `127.0.0.1:5175`（**绝不可部署**）。零框架依赖（Node 原生 `node:http`），单页 UI + SSE 实时日志。

| 面板 | 能力 |
|------|------|
| 概览 | 运行环境、环境变量是否就绪、SSE 与子进程日志管道自检 |
| 站点 | 站点增删改（写 `api/sites-data.json`）、元信息抓取、图标抓取落盘、一键同步云端（提交→推送→备份→门禁→热更新→收敛） |
| 改动 | 文件列表（含增删行数）、单文件 diff 行级高亮、暂存 / 取消暂存 |
| 提交 | 规则式变更摘要 + 建议提交消息（Conventional Commits）、提交 / 提交并推送 / 预演推送 |
| 同步 | 一键发布全链路时间线（检查→提交→推送→备份→门禁→构建→部署→热更新→验证）、云端版本对比 |
| 历史 | 提交记录 + 「已推送 / 仅本地」标注 + 按 commit SHA 关联 Vercel 部署状态 |
| 数据 | 工作区 vs HEAD 站点数据 diff、分类分布、完整性体检（图标/配色/描述缺失、sortOrder 重复与空洞、域名重复） |

设计取舍：

- **单一发布入口**：控制台不重复实现发布逻辑，只编排并可视化 `scripts/publish.mjs`，避免两套发布链路漂移
- **零新增依赖**：Git 操作直接封装 `git` CLI（放弃 `simple-git`），HTTP 用 `node:http`，实时推送用 SSE（原生断线重连）
- **安全边界**：仅监听回环地址；写操作校验同源 + 自定义请求头 `X-Nav-Console`，阻断跨站伪造；管理密钥不落盘、不回显
- **图标宁缺勿错**：图标来源依次为「页面声明 → `/favicon.ico` → `favicon.im`」；`data:,`（抑制请求）视为未声明，`data:image/…` 内联图标则本地解码落盘，并识别拒收 `favicon.im` 的灰色占位图，避免把假图标落盘（无图标时前端回落为分类色首字母块）

## CI/CD

| 工作流 | 触发 | 作用 |
|--------|------|------|
| `ci.yml` | push / PR | 数据 schema 门禁（`validate`）+ 构建门禁（`build`），**只做门禁、不重复部署** |
| `release-please.yml` | push 到 `master` | 依 Conventional Commits 推断语义化版本、生成 `CHANGELOG.md`、开 release PR |

> 发布仍以本地 `scripts/publish.mjs` 为唯一入口（Vercel Git 集成未开启），CI 不参与部署，避免「代码自动部署」与「数据热更新」两条链路互相覆盖。

## 环境变量

复制 `.env.example` 为 `.env.local` 并在 Vercel 项目 Production 中配置同名变量：

| 变量 | 必填 | 用途 |
|------|------|------|
| `SITES_ADMIN_KEY` | ✅ | 站点数据发布密钥；显示在管理后台发布按钮旁，**不在请求体明文发送**（走 `Authorization: Bearer <key>` 请求头） |
| `BLOB_READ_WRITE_TOKEN` | ✅ | Vercel Blob 读写令牌（站点数据 + 会话数据） |
| `BLOB_WEBHOOK_PUBLIC_KEY` | — | Blob webhook 公钥（如需 webhook 通知才配置） |
| `BLOB_STORE_ID` | — | Blob 存储 ID（多存储并存时） |

### 会话同步说明

- 会话数据（收藏/待办/历史/偏好）存于 Blob 的 `session/<key>.json`，**以会话密钥为隔离凭证**，无需管理密钥
- 在「设置 → 数据管理 → 云端会话同步」生成密钥，同一密钥可在不同浏览器/设备间同步
- 管理密钥不硬编码进脚本；`publish.mjs` 从 `.env.local` / 环境变量 / `--key=` 读取，缺失即中止
- 本地持久化数据带 schema 版本号，结构升级时通过 `src/utils/storeVersioning.js` 的迁移表平滑兼容

## 项目结构

```
nav-v2/
├── api/
│   ├── sites.js           # Serverless：站点数据 GET/POST（Blob 真相源，POST 走 header 鉴权）
│   ├── session.js         # Serverless：用户会话数据读写（Blob session/<key>，密钥隔离）
│   └── metadata.js        # Serverless：URL 元信息抓取代理（标题/描述/favicon，多编码）
├── public/
│   ├── icons/             # 真实网站 favicon（按站点 id 存储）
│   └── ...
├── scripts/
│   ├── publish.mjs        # 一键发布（备份/校验/构建/部署/热更新/验证）
│   ├── validate-data.mjs  # 站点数据 schema 校验
│   ├── check-sites.mjs    # 全站点健康检查
│   └── fetch-favicons.mjs # favicon 批量抓取（支持 --only <id>）
├── tools/
│   └── console/           # 本地运维控制台（仅 127.0.0.1，绝不可部署）
│       ├── server.mjs     # node:http 入口 + SSE 端点
│       ├── lib/           # git / jobs / changes / sync / vercel / history / data / sites
│       └── ui/            # 单页 UI（7 个面板，零框架依赖）
├── .github/workflows/     # ci.yml（门禁）+ release-please.yml（版本与 CHANGELOG）
├── backups/               # 发布前自动备份的站点数据
├── src/
│   ├── components/        # Vue 组件
│   ├── router/            # 路由配置
│   ├── stores/            # Pinia 状态管理（含 health 在线状态、版本化持久化）
│   ├── services/          # API 调用层（含 session 会话同步）
│   ├── utils/             # 通用工具（storeVersioning 本地数据版本化）
│   ├── styles/            # 全局样式 + CSS 变量
│   ├── views/             # 页面视图
│   ├── App.vue            # 根组件
│   └── main.js            # 入口文件
├── HANDOVER.md            # 项目交接 / 发布记录
├── .env.example           # 环境变量示例
├── index.html
├── vite.config.js         # Vite + PWA 配置
└── vercel.json            # Vercel 部署配置
```

## 分类体系

| 大类 | 子分类（节选） |
|------|--------------|
| AI 学习 | 入门对话 / 提示词 / 写作 / 编程 / 设计 / 工作流 / 学习 / 优惠比价 |
| 币圈 | CEX / DEX / DeFi / 数据 / 投融资 / 钱包 / 链上工具 / NFT / 安全 / 媒体 / 挖矿 / 稳定币 / AICrypto / 空投 |
| 工具 | 短信接码 / AI API 平台 / 账号卡密 / 项目参考 |
| 基础服务 | 云服务器VPS / 域名服务 / 代理VPN |

## License

MIT