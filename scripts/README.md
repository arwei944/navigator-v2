# scripts/ —— 仓库脚本台账

> 本文件是 `scripts/` 的**分类台账**。门禁 `test-scripts.mjs` 会断言：
> ① 目录里每个 `.mjs` 都在此登记；② 清单里每个文件都真实存在；③ package.json 引用
> 的脚本文件都在。**新增脚本务必先在此登记**，否则门禁会红。

## 1. 构建与校验链路（产品级 —— 被 package.json / 代码引用）

| 脚本 | 作用 |
|---|---|
| `postbuild-spa-fallbacks.mjs` | 构建后处理：生成 SPA 回退与沙箱启动所需文件（`server.js`、路由回退、随包凭据） |
| `validate-data.mjs` | 站点数据 schema 门禁：id 唯一、字段完整、分类白名单、重复域名告警 |
| `check-sites.mjs` | 站点可用性检查（`--only-bad --report` 出报告） |
| `fetch-favicons.mjs` | 图标抓取链：页面声明 → `/favicon.ico` → 第三方，三级回退 |
| `gen-env-example.mjs` | 由 `shared/env-registry.mjs` 生成 `.env.example`（`--check` 校验一致性） |

## 2. 部署与发布（运维级）

| 脚本 | 作用 |
|---|---|
| `publish.mjs` | 数据热更新 / 云端发布（写站点数据到云端，不写前端产物） |
| `deploy-botkeep.mjs` | BotKeep 部署：打包 → 分片上传 → 重启 → 线上验证 |
| `deploy-upload.mjs` | BotKeep 分片上传的低层实现（拼接 tar → base64 切片 → 逐片 POST） |
| `deploy-cloud.mjs` | WorkBuddy 云端**产物门禁**（完整性 + 新鲜度）；上传由外部工具执行 |
| `watch-deploy.mjs` | 监听源码变更并自动触发部署（含持续推进/失败回退语义） |
| `verify-icons-online.mjs` | 线上图标可访问性校验（站点地址由发布通道给出） |
| `audit-data.mjs` | 站点数据质量体检 CLI（F1：真重复 / 同站多入口 / 缺 icon / 描述质量） |

## 3. 账号与本地工具

| 脚本 | 作用 |
|---|---|
| `hash-password.mjs` | 生成管理后台口令的 scrypt 哈希 |
| `set-admin-password.mjs` | 交互式设置管理后台口令 |
| `perf-scroll.mjs` | 滚动性能基线采集 |

## 4. 历史一次性脚本（使命已完成，保留供追溯 / 按需复跑）

> 这些是**数据迁移 / 字段回填**类脚本，正常不再需要执行。刻意**不做物理归档**：
> 它们的文件名仍出现在控制台提示文案里（如 sortOrder 异常时提示「跑 `fix-sortorder.mjs`」），
> 移动目录会让这些提示失效。

| 脚本 | 使命 | 状态 |
|---|---|---|
| `fix-sortorder.mjs` | 把 `sortOrder` 重排为全局连续序列，满足「全局唯一」约束 | 已执行 |
| `normalize-www.mjs` | 去掉站点 url 的 `www.` 前缀，统一到「只存主域名」口径 | 已执行 |
| `seed-aliases.mjs` | 给存量站点补 `aliases: string[]`（中文别名检索） | 已执行 |
| `seed-purposes.mjs` | 给存量站点补 `purposes: string[]`（用途筛选条） | 已执行 |

## 相关文档

- [工作区文档管理工具](../tools/doc-manager/README.md)
- [工厂实践缺口诊断](../projects/proj-1792178028321-dov564/outputs/factory-gap-analysis.md)
