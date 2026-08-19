# Navigator v3 — 迭代工作流

## 一、工作流概述

```
准备 → 实现 → 构建 → 验收 → 修复 → 部署
```

每个 Phase 完成后，运行 `npm run build` 确认无编译错误，再进入下一 Phase。

---

## 二、Phase 执行顺序

```
Phase 1 (搜索) → Phase 2 (性能) → Phase 3 (路由) → Phase 4 (导出) → Phase 5 (美化) → Phase 6 (部署)
```

**依赖关系：**
- Phase 1 独立，可先做
- Phase 2 依赖 `vue-virtual-scroller` 安装，独立
- Phase 3 依赖路由配置，修改 `router/index.js` + `App.vue`
- Phase 4 独立，修改 `BookmarkImport.vue`
- Phase 5 贯穿所有 Phase，在每个 Phase 中同步完成相关 UI 美化

---

## 三、详细工作流

### Phase 1: 搜索升级

**入口：** `sites.js` → `filteredSites` computed

**步骤：**
```
1. 在 sites.js 顶部引入 fuse.js 和 pinyin-pro
2. 创建 Fuse 实例（配置 keys + threshold: 0.4 + 拼音字段）
3. 改造 filteredSites 计算属性
4. 改造 SiteSearchBar.vue（搜索下拉面板 + 高亮 + 快捷键）
5. 改造 CommandPalette.vue（模糊搜索 + 拼音）
6. npm run build 验证
```

**影响范围：**
- `src/stores/sites.js` — 核心搜索逻辑
- `src/components/SiteSearchBar.vue` — 搜索 UI
- `src/components/CommandPalette.vue` — 命令面板搜索

**验收触发：** AC-1.1.1 ~ AC-1.2.5

---

### Phase 2: 性能优化

**入口：** `CardsContainer.vue` → 渲染循环

**步骤：**
```
1. 在 main.js 中注册 RecycleScroller 组件
2. 改造 CardsContainer.vue 的网格渲染部分
3. 虚拟滚动容器：itemHeight 固定，buffer 200px
4. 拖拽排序模式下禁用虚拟滚动
5. 列表视图保持原有渲染
6. npm run build 验证
```

**影响范围：**
- `src/main.js` — 注册组件
- `src/components/CardsContainer.vue` — 虚拟滚动集成

**验收触发：** AC-2.1.1 ~ AC-2.2.3

---

### Phase 3: 路由深度链接

**入口：** `router/index.js` → 路由配置

**步骤：**
```
1. 在 router/index.js 新增 /category/:id 路由
2. 在 HomeView.vue 中监听 $route 变化
3. 分类点击时 router.push('/category/' + catId)
4. 搜索时 router.push({ query: { q: keyword } })
5. 页面标题更新（document.title）
6. npm run build 验证
```

**影响范围：**
- `src/router/index.js` — 路由配置
- `src/views/HomeView.vue` — 路由监听（如无此文件，在 App.vue 中处理）
- `src/stores/sites.js` — 搜索/分类与路由联动

**验收触发：** AC-3.1.1 ~ AC-3.3.3

---

### Phase 4: 数据导出/备份

**入口：** `BookmarkImport.vue` → 导入导出面板

**步骤：**
```
1. 在 BookmarkImport.vue 增加导出 JSON 按钮和处理函数
2. 实现 JSON 导出：收集 sites + favorites + history
3. 实现 HTML 书签导出：标准浏览器书签格式
4. 优化导入逻辑：去重 + 统计
5. npm run build 验证
```

**影响范围：**
- `src/components/BookmarkImport.vue` — 导出/导入功能

**验收触发：** AC-4.1.1 ~ AC-4.2.4

---

### Phase 5: UI/UX 美化

**入口：** 贯穿所有组件

**步骤：**
```
1. 修改 main.css 卡片网格规则
2. 在 CardsContainer.vue 添加 TransitionGroup + stagger 动画
3. 增强 SiteCard.vue 悬浮效果
4. 优化 StatsBar.vue 显示内容
5. 添加 Ctrl+F 快捷键聚焦搜索
6. 搜索输入防抖 300ms
7. npm run build 验证
```

**影响范围：**
- `src/styles/main.css` — 全局样式
- `src/components/CardsContainer.vue` — 动画
- `src/components/SiteCard.vue` — 悬浮效果
- `src/components/StatsBar.vue` — 精简统计
- `src/components/SiteSearchBar.vue` — 快捷键+防抖

**验收触发：** AC-5.1.1 ~ AC-5.3.3

---

### Phase 6: 构建部署

**步骤：**
```
1. npm run build
2. 检查 dist 目录产物
3. npx vercel deploy --prod
4. 线上验证所有验收项
```

---

## 四、回归测试策略

| 变更类型 | 回归范围 | 方法 |
|---------|---------|------|
| 搜索逻辑修改 | 原有精确搜索 | 确保老搜索方式仍然生效 |
| 虚拟滚动 | 拖拽排序、回收站 | 排序模式+回收站视图独立测试 |
| 路由修改 | 管理后台路由 | 确保 /admin 路由正常 |
| 导出修改 | 导入功能 | 导出后重新导入验证 |

---

## 五、风险与应对

| 风险 | 概率 | 影响 | 应对方案 |
|------|------|------|---------|
| vue-virtual-scroller 与 Draggable 冲突 | 中 | 高 | 排序模式下禁用虚拟滚动 |
| Fuse.js 搜索结果不准确 | 低 | 中 | 调低 threshold 至 0.3，增加拼音兜底 |
| 路由改造破坏现有导航 | 低 | 高 | 保留原有 sidebarStore.activeNav 兼容逻辑 |
| 导出文件过大 | 低 | 低 | 200 站点 JSON 约 50KB，无需分片 |

---

## 六、完成定义 (Definition of Done)

一个 Phase 被视为完成，当且仅当：

1. ✅ 所有子任务清单项已勾选
2. ✅ 对应验收标准全部通过（或已知 minor 已记录）
3. ✅ `npm run build` 无错误
4. ✅ 代码已提交到 git