# v3 升级设计文档

## 架构决策

**数据同步方案**：Vercel KV（Redis），无需注册新服务，在现有 Vercel 项目控制台启用即可。

**同步策略**：localStorage 主存储，KV 云端备份。首次同步生成同步密钥，多设备输入相同密钥即可共享数据。

---

## Sprint 1: 数据云同步

### 后端（API Routes）
- `api/sync/key` - POST：生成新的同步密钥（UUID）
- `api/sync/upload` - POST：上传数据快照到 KV（key = syncKey）
- `api/sync/download` - GET：从 KV 拉取数据
- `api/sync/merge` - POST：服务端合并（本地时间戳优先）

### 数据结构
```json
{
  "sites": [...],
  "favorites": [...],
  "todos": [...],
  "history": [...],
  "preferences": { ... },
  "version": 1,
  "updatedAt": "ISO timestamp"
}
```

### 前端
- `src/services/sync.js` - 同步服务层
- 设置面板新增"同步密钥"区域
- 自动同步：每次数据变更后 5 秒防抖上传
- 手动同步：首次输入密钥后立即拉取合并

---

## Sprint 2: 自定义站点管理

### 拖拽排序
- 安装 `vuedraggable`（基于 SortableJS）
- 站点卡片可拖拽调整顺序
- 排序结果自动保存到 sites store

### 站点图标自定义
- 自动抓取：`https://www.google.com/s2/favicons?domain=xxx`
- 自定义上传：用户可上传图片作为图标（FileReader 转 base64 存 localStorage）

### 批量导入
- 支持粘贴多行 URL（每行一个）
- 自动抓取网站标题和描述
- 一键确认导入

---

## Sprint 3: 内容聚合

### 信息流面板
- 首页新增"动态"折叠面板（默认折叠）
- 预置源：GitHub Trending、Hacker News
- 通过 CORS 代理或 RSS 抓取（使用 `https://api.allorigins.win` 或类似服务）
- 每条显示标题 + 来源 + 时间，点击跳转原文

### 技术实现
- `src/services/feeds.js` - 信息流抓取服务
- 缓存 30 分钟，避免频繁请求

---

## Sprint 4: 全局命令面板

### 功能
- Cmd+K 触发（Mac）/ Ctrl+K 触发（Windows）
- 模糊搜索：站点名、分类名、命令名
- 命令列表：搜索站点 / 切换主题 / 切换专注模式 / 添加站点 / 打开管理后台 / 打开收藏 / 同步数据
- 键盘导航：上下键选择，回车执行，Esc 关闭

### 组件
- `src/components/CommandPalette.vue`
- 覆盖层半透明背景，居中模态框
- 搜索框自动聚焦