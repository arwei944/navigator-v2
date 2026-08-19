# Navigator V2 — 网站导航中心

现代化网站导航中心，聚合 210+ 优质站点，覆盖 AI 工具、加密货币、基础服务等领域。

线上地址：https://navigator-v2-two.vercel.app
GitHub 仓库：https://github.com/arwei944/navigator-v2

## 技术栈

- **前端框架**: Vue 3 + Vite 5 + Pinia + Vue Router
- **搜索**: Fuse.js 模糊搜索 + pinyin-pro 拼音索引（全拼 + 首字母）
- **样式**: CSS 变量主题系统（明暗模式 + 4 套预设主题）
- **PWA**: Service Worker 离线支持，可安装为桌面/移动应用
- **云同步**: Vercel KV（Redis）后端，多设备数据同步
- **部署**: Vercel

## 功能特性

- [x] 多搜索引擎切换（Google / Bing / 百度 / DuckDuckGo / Perplexity）
- [x] 站点搜索（名称 / 描述 / URL / 拼音全拼 / 拼音首字母）
- [x] 4 大类 22 子分类分类体系（AI 学习 / 币圈 / 工具 / 基础服务）
- [x] 网格视图 / 列表视图切换
- [x] 站点管理：添加 / 编辑 / 删除（右键菜单 + 回收站恢复）
- [x] 批量操作：批量选择 + 批量删除
- [x] 拖拽排序：卡片拖拽调整顺序
- [x] 收藏站点 + 访问记录追踪（最近 50 条）
- [x] 排序：默认 / 名称 A-Z / 热度 / 最近添加
- [x] 主题系统：4 套预设（默认蓝 / 极客绿 / 赛博紫 / 日落橙）+ 明暗模式
- [x] 自定义壁纸 + 模糊效果
- [x] 侧边栏可拖拽调节宽度（160px - 400px）
- [x] 右侧站点详情面板（鼠标悬停展示）
- [x] 统一设置面板
- [x] 命令面板（Ctrl+K 快速搜索导航）
- [x] 数字时钟 + 待办事项面板
- [x] 书签导入 / 导出（支持浏览器 HTML 书签）
- [x] 云同步：基于 Vercel KV 的多设备数据同步
- [x] PWA 离线支持
- [x] 管理后台

## 开发

```bash
# 安装依赖
npm install

# 本地开发
npm run dev

# 构建
npm run build

# 部署到 Vercel
npm run deploy
```

## 项目结构

```
nav-v2/
├── api/sync/              # Vercel Serverless Functions（云同步）
├── public/                # 静态资源
├── src/
│   ├── components/        # Vue 组件（19 个）
│   ├── router/            # 路由配置
│   ├── services/          # 前端同步服务
│   ├── stores/            # Pinia 状态管理（7 个 store）
│   ├── styles/            # 全局样式 + CSS 变量
│   ├── views/             # 页面视图
│   ├── App.vue            # 根组件
│   └── main.js            # 入口文件
├── HANDOVER.md            # 项目交接文档
├── index.html             # HTML 入口
├── vite.config.js         # Vite + PWA 配置
└── vercel.json            # Vercel 部署配置
```

## 分类体系

| 大类 | 子分类数 | 说明 |
|------|---------|------|
| AI 学习 | 8 | 入门对话 / 提示词 / 写作 / 编程 / 设计 / 工作流 / 学习 / 优惠比价 |
| 币圈 | 15 | CEX / DEX / DeFi / 数据 / 投融资 / 钱包 / 链上工具 / L1L2 / NFT / 安全 / 媒体 / 挖矿 / 稳定币 / AICrypto / 空投 |
| 工具 | 2 | 短信接码 / AI API 平台 |
| 基础服务 | 3 | 云服务器/VPS / 域名服务 / 代理/VPN |

## 主题预设

| 预设 | 主色 | 侧边栏色 |
|------|------|----------|
| 默认蓝 | `#2563eb` | `#0f172a` |
| 极客绿 | `#10b981` | `#064e3b` |
| 赛博紫 | `#8b5cf6` | `#2e1065` |
| 日落橙 | `#f59e0b` | `#431407` |

## License

MIT
