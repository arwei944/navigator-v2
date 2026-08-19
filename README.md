# Navigator v2 — 网站导航中心

现代化网站导航中心，快速访问你喜爱的站点。

## 技术栈

- **前端框架**: Vue 3 + Vite + Pinia + Vue Router
- **样式**: CSS 变量主题系统（浅色/深色 + 4 套预设主题）
- **PWA**: Service Worker 支持，可安装到桌面
- **部署**: Vercel

## 功能特性

- [x] 多搜索引擎搜索（Google/Bing/百度/DuckDuckGo/Perplexity）
- [x] 站点内搜索过滤（名称/描述/URL）
- [x] 分类筛选 + 网格/列表视图切换
- [x] 添加/编辑/删除站点（右键菜单 + 管理后台）
- [x] 收藏站点 + 访问记录追踪
- [x] 排序（默认/名称/热度/最近添加）
- [x] 暗色/浅色主题 + 4 套预设主题换肤
- [x] 数字时钟 + 天气小组件
- [x] 待办事项面板
- [x] 书签导入/导出（支持浏览器 HTML 书签）
- [x] 专注模式 + 键盘快捷键
- [x] 自定义壁纸
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
├── public/              # 静态资源
├── src/
│   ├── components/      # Vue 组件
│   ├── stores/          # Pinia 状态管理
│   ├── views/           # 页面视图
│   ├── router/          # 路由配置
│   ├── styles/          # 全局样式
│   ├── App.vue          # 根组件
│   └── main.js          # 入口文件
├── index.html
├── vite.config.js
└── vercel.json
```