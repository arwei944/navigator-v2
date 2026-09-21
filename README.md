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
- **部署**: Vercel

## 架构概览

```
浏览器(PWA)                          Vercel Serverless
┌──────────────┐    30s 轮询 /api/sites      ┌───────────────┐
│ Vue3 SPA     │ ──────────────────────────▶ │ api/sites.js  │ → Blob (sites.json)
│ · 静态构建    │    添加站点 GET /api/metadata │ api/metadata.js│ → 抓取 URL 标题/图标
│ · 在线图标    │                              └───────┬───────┘
└──────────────┘                                      │ scripts/:  publish/check/icons/validate
```

- **运行时数据唯一来源**：Vercel Blob 上的 `sites.json`
- **本地种子**：`api/sites-data.json` 仅作 Blob 为空时的兜底，由 `scripts/publish.mjs` 保持同步
- **热更新**：前端每 30s 轮询 `/api/sites`（`Cache-Control: no-store`），发布后全端秒级可见
- 更新数据无需改代码/重新部署，只需跑发布脚本或后台「发布到云端」

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
- [x] 管理后台（在线新增/编辑/删除 + 发布到云端）
- [x] PWA 离线支持

## 常用命令

```bash
npm install          # 安装依赖
npm run dev          # 本地开发
npm run build        # 构建
npm run publish      # 一键发布：备份 → 数据校验 → 构建 → 部署 → 云端热更新 → 轮询验证
npm run validate     # 站点数据 schema 校验（发布门禁会自动调用）
npm run check        # 健康检查：探测所有站点可访问性
npm run check:report # 健康检查并生成 Markdown 报告
npm run icons        # 抓取/补抓网站 favicon
```

## 环境变量

复制 `.env.example` 为 `.env.local` 并在 Vercel 项目 Production 中配置同名变量：

| 变量 | 必填 | 用途 |
|------|------|------|
| `SITES_ADMIN_KEY` | ✅ | `/api/sites` POST 鉴权，发布数据密钥 |
| `BLOB_READ_WRITE_TOKEN` | ✅ | Vercel Blob 读写令牌 |
| `BLOB_WEBHOOK_PUBLIC_KEY` | ✅ | Blob webhook 公钥 |
| `BLOB_STORE_ID` | ✅ | Blob 存储 ID |
| `GLOBAL_CONFIG` | — | Vercel 全局配置 |

> 管理密钥不再硬编码进脚本。`publish.mjs` 从 `.env.local` / 环境变量 / `--key=` 读取，缺失即中止。

## 项目结构

```
nav-v2/
├── api/
│   ├── sites.js           # Serverless：站点数据 GET/POST（Blob 真相源）
│   └── metadata.js        # Serverless：URL 元信息抓取代理（标题/描述/favicon，多编码）
├── public/
│   ├── icons/             # 真实网站 favicon（按站点 id 存储）
│   └── ...
├── scripts/
│   ├── publish.mjs        # 一键发布（备份/校验/构建/部署/热更新/验证）
│   ├── validate-data.mjs  # 站点数据 schema 校验
│   ├── check-sites.mjs    # 全站点健康检查
│   └── fetch-favicons.mjs # favicon 批量抓取（支持 --only <id>）
├── backups/               # 发布前自动备份的站点数据
├── src/
│   ├── components/        # Vue 组件
│   ├── router/            # 路由配置
│   ├── stores/            # Pinia 状态管理
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