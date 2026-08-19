# Navigator v3 — 任务清单

> 范围：P0(搜索升级 + 性能优化) + P1(路由深度链接 + 数据导出) + UI/UX 美化

---

## Phase 1: 搜索升级 (P0)

### 1.1 安装依赖
- [ ] 确认 `fuse.js` 已安装
- [ ] 确认 `pinyin-pro` 已安装

### 1.2 重构搜索逻辑 (`sites.js`)
- [ ] 引入 Fuse.js 实例，配置 `keys: ['name', 'desc', 'url']`，开启 `threshold: 0.4` 模糊匹配
- [ ] 引入 pinyin-pro，为 name/desc 生成拼音索引字段
- [ ] 改造 `filteredSites` computed，搜索时优先使用 Fuse 模糊搜索，兜底拼音搜索
- [ ] 搜索无结果时显示"搜索建议"（相近站点名、热门站点）

### 1.3 搜索 UI 升级 (`SiteSearchBar.vue`)
- [ ] 搜索框获得焦点时展开下拉面板，展示搜索建议/历史记录
- [ ] 搜索框增加清空按钮（已有，保持）
- [ ] 搜索结果高亮匹配关键词
- [ ] 增加搜索快捷键提示（`Ctrl+F` 聚焦搜索框）

### 1.4 命令面板搜索升级 (`CommandPalette.vue`)
- [ ] 站点搜索改用 Fuse 模糊匹配
- [ ] 增加拼音搜索支持

---

## Phase 2: 性能优化 (P0)

### 2.1 虚拟滚动集成
- [ ] 在 `CardsContainer.vue` 中引入 `vue-virtual-scroller` 的 `RecycleScroller`
- [ ] 只对网格视图启用虚拟滚动（列表视图数据量小，暂不处理）
- [ ] 虚拟滚动容器的 `itemHeight` 自适应计算（卡片高度约 140px）
- [ ] 回收站视图保持原有渲染方式（数据量小）

### 2.2 懒加载优化
- [ ] 站点卡片使用 `v-if` 或 `v-show` 结合 IntersectionObserver 延迟渲染
- [ ] 分类统计数量改为计算属性缓存

---

## Phase 3: 路由深度链接 (P1)

### 3.1 路由配置 (`router/index.js`)
- [ ] 新增 `/category/:id` 路由，映射到 `HomeView`
- [ ] 新增 `/search?q=keyword` 路由，支持搜索 URL 参数
- [ ] 保留 `/` 首页路由

### 3.2 App.vue 路由联动
- [ ] `HomeView` 监听 `$route.params.id`，自动设置 `currentCategory`
- [ ] `HomeView` 监听 `$route.query.q`，自动设置 `searchQuery`
- [ ] 分类切换时调用 `router.push('/category/' + catId)` 同步 URL
- [ ] 搜索时调用 `router.push({ path: '/', query: { q: keyword } })` 同步 URL
- [ ] 浏览器前进/后退按钮正确切换分类和搜索状态

### 3.3 SEO 基础
- [ ] 页面标题随分类变化（如 "Navigator | CEX 交易所"）
- [ ] 分类页 `<meta description>` 更新

---

## Phase 4: 数据导出/备份 (P1)

### 4.1 BookmarkImport.vue 改造
- [ ] 增加"导出所有站点"按钮，导出 JSON 文件（含站点、收藏、历史）
- [ ] 增加"导出为 HTML 书签"按钮，导出标准浏览器书签格式
- [ ] 优化导入 UI，支持拖拽文件到导入区域

### 4.2 数据完整性
- [ ] 导出时包含所有字段（id, name, url, desc, categoryId, color, visitCount 等）
- [ ] 导入时自动分配新 ID 避免冲突，保留旧 ID 引用
- [ ] 导入完成后显示导入统计（新增 X 个，跳过 Y 个重复）

---

## Phase 5: UI/UX 美化 (P0+P1 贯穿)

### 5.1 布局优化
- [ ] 卡片网格自适应：`grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`
- [ ] 卡片间距统一，视觉呼吸感增强
- [ ] 搜索框宽度自适应，大屏居中，小屏全宽

### 5.2 智能动效
- [ ] 卡片入场动画：stagger 动画，按顺序依次出现
- [ ] 筛选/搜索切换时卡片淡入淡出过渡
- [ ] 分类切换时卡片交错动画（`transition-group` + `stagger`）

### 5.3 视觉细节
- [ ] 卡片悬浮效果增强：微妙的阴影 + 边框高亮 + 轻微上浮
- [ ] 空状态插画升级：更友好的 SVG 图形和文案
- [ ] 统计栏精简：只显示关键数据，减少视觉噪音
- [ ] 主题切换过渡动画

### 5.4 交互智能感
- [ ] 搜索框支持 `Ctrl+F` 快捷键聚焦
- [ ] 搜索输入防抖（300ms），避免输入时频繁重渲染
- [ ] 搜索结果数量实时显示
- [ ] 收藏按钮点击反馈（微动效 + 提示）

---

## Phase 6: 构建部署

### 6.1 构建验证
- [ ] `npm run build` 无错误
- [ ] 检查打包后 JS/CSS 体积

### 6.2 Vercel 部署
- [ ] 部署到生产环境
- [ ] 验证线上路由 `/category/starter` 等正常
- [ ] 验证线上搜索 `/search?q=chatgpt` 正常
- [ ] 验证虚拟滚动在 200+ 站点下流畅