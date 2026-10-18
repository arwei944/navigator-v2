# workspace-doctor —— 工作区 5S（清扫 / 清运）工具

补上「车间卫生」这道完全空白的工序：工作区里的临时废料（CDP 临时 Chrome profile、
探针草稿、图标抓取备份、散落报告、快照仓）此前**无人清运**，磁盘持续膨胀。

## 用法

```bash
# 只读体检：列出各类废料的条数与体积
node tools/workspace-doctor/cli.mjs scan [--json]

# 清运演练（默认 dry-run，不会删任何东西）
node tools/workspace-doctor/cli.mjs clean

# 真正清运
node tools/workspace-doctor/cli.mjs clean --yes
node tools/workspace-doctor/cli.mjs clean --yes --only chrome-profiles,api-icon-baks
```

## 安全底线（硬护栏）

**只删未被 git 跟踪的文件。** 即使某个路径命中了白名单正则，只要它被 git 跟踪就一定跳过。
这样「白名单写错」不会变成「资产被误删」，工具也因此可以放心地默认 dry-run。

清运前请先 `scan` 确认体检清单符合预期。

## 目标分类（`lib/targets.mjs` 是唯一事实来源）

| id | 内容 | 可清运 | 依据 |
|---|---|---|---|
| `chrome-profiles` | 根目录 `.chrome-*` CDP 临时 profile | ✅ | `.gitignore` 第 30 行 |
| `probe-drafts` | `probe/` 下 `_*` 与截图/文本草稿 | ✅ | `.gitignore` 第 24-28 行 |
| `api-icon-baks` | `api/sites-data.bak-*.json` | ✅ | `.gitignore` 第 50 行 |
| `root-reports` | 根目录 `_chrome-report.json` / `_probe-report*.json` | ✅ | `.gitignore` 第 22-23 行 |
| `perf-report` | `perf-report/` 性能基线目录 | ✅ | `.gitignore` 第 12 行 |
| `backups` | 站点数据快照仓 | ❌ 只体检 | 数据类：需保留策略而非直接删 |
| `dist` | 构建产物 | ❌ 只体检 | 随 build 刷新，体积由 test-bundle-size 守护 |

## 门禁

`tools/console/test-hygiene.mjs`（已接入 `console:test:all`）守护：

1. 各类废料的条数/体积不超阈值（留 2-3 倍余量，只拦失控暴涨）
2. `probe/` 里被 git 跟踪的文件不含 `.png/.json/.txt/.log`（防草稿误提交）
3. 护栏自检：`可清运 + 受保护 = 命中总数`

## 相关文档

- [工作区文档管理工具](../doc-manager/README.md) —— 姊妹工序：那边管「文档资产」，这边管「废料清运」
- [工厂实践缺口诊断](../../projects/proj-1792178028321-dov564/outputs/factory-gap-analysis.md)
