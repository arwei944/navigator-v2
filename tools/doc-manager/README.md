# doc-manager —— 工作区文档管理工具

把「**有哪些文档、谁取代谁、和什么关联**」变成机器可读的事实，这样**人和 AI 都基于同一份台账**做判断，而不是各自 `grep` 乱撞。

## 它解决什么

nav-v2 工作区（排除 `node_modules`）已有约 90 份非依赖文档，散落在 `docs/`、`.superpowers/`、`backups/`、`projects/<id>/`、仓库根。此前**没有任何一处汇总**它们 —— 于是：

- 同一主题有两份文档互相矛盾，没人知道哪份最新；
- 链接指向已归档的文档，读者被带到死路；
- 一份下架的设计稿还在被别处引用；
- AI（或人）想回答「这个决策当时是怎么定的」，只能全库搜索再自己拼。

`doc-manager` 提供五个子命令，覆盖**台账 / 巡检 / 生命周期 / 关联**四条线。

## 用法

```bash
node tools/doc-manager/cli.mjs scan                  # 扫描并统计（有哪些、多大、多新）
node tools/doc-manager/cli.mjs index --out <dir>     # 生成台账 doc-index.json + DOC-INDEX.md
node tools/doc-manager/cli.mjs check                 # 一致性巡检（死链/重复标题/过期引用/孤立/…）
node tools/doc-manager/cli.mjs check --strict        # 有 error 时非 0 退出（可当门禁）
node tools/doc-manager/cli.mjs lifecycle             # 状态推断 / 取代链 / 归档建议
node tools/doc-manager/cli.mjs graph --mermaid       # 关联图谱（文档↔项目↔文档 + Mermaid 导出）
```

共同选项：

| 选项 | 作用 |
|---|---|
| `--json` | 输出机器可读 JSON（供 AI / 其它脚本消费）|
| `--root <dir>` | 指定工作区根（默认本工具的上两级 = nav-v2 仓库根）|
| `--strict` | check：存在 error 级问题时以非 0 退出 |
| `--out <dir>` | index：台账输出目录 |

## 巡检规则

| 规则 | 级别 | 含义 |
|---|---|---|
| `dead-link` | error | 链接目标文件不存在 |
| `duplicate-title` | warn | 同一标题被多份文档使用（检索会撞车）|
| `missing-title` | warn | 没有一级标题 |
| `stale-reference` | warn | active 文档引用了已归档/被取代的文档 |
| `empty-doc` | warn | 内容过少（< 40 B）|
| `orphan` | info | 孤立的知识型文档（无入链、无文档间出链）|
| `oversize` | info | 文档 > 200 KB，可考虑拆分 |

> **只对「知识型文档」报孤立**：`plan` / `spec` / `audit` / `design` / `other`。
> 过程产物（任务简报 `.superpowers/sdd/`、`memory`、`outputs`）天然由任务系统组织，不算孤立 ——
> 否则实测会有 84/87 条噪声。

## 生命周期：显式声明优先

状态按三层判定（优先级从高到低）：

1. **frontmatter 显式标注**（推荐）—— 在文档开头写：

   ```markdown
   ---
   status: archived            # active | superseded | archived
   superseded-by: docs/NAV-v7-card-system-upgrade-plan.md
   ---
   ```

2. **目录约定** —— `docs/archive/`、`*/archived/` 下的文档视为 `archived`。
3. **同名多版本启发式** —— 同一目录下、去掉 `v数字`/日期/序号后同名的多份 active 文档，
   视为同一份的多个版本，**建议保留版本号最大的**（同目录是硬条件，避免把不同任务目录下的
   `progress.md` 误当同一系列）。

## 让 AI 用起来

`--json` 的输出是给 AI 的接口。推荐流程：

```bash
node tools/doc-manager/cli.mjs index --out .doc-out --json   # 产出结构化台账
node tools/doc-manager/cli.mjs check --json                  # 产出结构化巡检结果
```

把 `doc-index.json` 喂给 AI，它就能回答「这个主题的文档在哪、哪份最新、和哪个任务/提交相关」，
而不必逐个文件读。这也是「智能管理文档一切」的落点：**工具负责把事实结构化成台账，AI 负责基于台账决策。**

## 设计说明：为什么不挂进 nav-v2 后台「插件」

nav-v2 已有的「插件系统」（`shared/plugin-registry.mjs` + `AdminPlugins.vue`）管的是
**站点运行时引擎热拔插**（抓取 / 翻译 / LLM / 图标 / 发布通道…9 个引擎），语义是「站点功能用哪个 provider」。
文档管理与它无关，挂进去只会污染那套面板。所以本工具做成**工作区级 CLI**，与 `tools/console`、`tools/cli` 并列。

## 门禁

```bash
node tools/console/test-doc-manager.mjs     # 自测（fixture 驱动，不依赖真实文档数量）
```

已接入 `npm run console:test:all`。

## 目录结构

```
tools/doc-manager/
  cli.mjs              # CLI 入口（子命令分发 + 参数解析）
  lib/
    util.mjs           # 目录遍历 / Markdown 解析 / 分类 / 状态推断（纯函数优先）
    scanner.mjs        # 扫描工作区，产出 docs[]（四者的共同数据源）
    indexer.mjs        # 台账生成（doc-index.json + DOC-INDEX.md）
    checker.mjs        # 一致性巡检
    lifecycle.mjs      # 生命周期 / 取代链 / 归档建议
    graph.mjs          # 关联图谱（含 Mermaid 导出）
  README.md
```
