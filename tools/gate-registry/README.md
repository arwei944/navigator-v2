# gate-registry —— 门禁台账（量具清单 + 检定状态）

补上「量具没有检定记录」这道缺口：项目有 90 道门禁脚本，此前没有任何一处能回答
「有哪些门禁、每道守什么、覆盖哪个域、哪些没接入 `console:test:all`」。

**首次生成台账就抓出 5 道「存在但从未执行」的门禁**（`test-cron` / `test-health` /
`test-store` / `test-v10` / `test-mcp`，合计 205 条断言此前从未在全量门禁里跑过）。

## 用法

```bash
# 生成台账：gate-index.json（机器读）+ GATE-INDEX.md（人读）
node tools/gate-registry/cli.mjs index [--json]

# 实跑每道门禁采集耗时（约 2-3 分钟），回答「哪道最慢」
node tools/gate-registry/cli.mjs index --timing

# 校验台账与现状一致（接入 console:test:all）
node tools/gate-registry/cli.mjs check
```

`--timing` 不常跑（逐道实跑很慢）；不加时耗时字段**继承**上次采集值，
因此 `check` 与 `index --timing` 的产物仍能逐字节一致。

## 台账维度

| 维度 | 说明 |
|---|---|
| 分类 | 8 个域（数据与内容 / 搜索与交互 / 部署与发布 / 安全与鉴权 / 文档治理 / 工作区治理 / 前端与体验 / 服务端与运行时），回答「哪个域守卫最薄」 |
| 耗时 | 逐道实跑采集，回答「哪道最慢 / 哪个域最费时」 |
| 接入状态 | 是否在 `console:test:all` 链上；未接入即告警 |
| 用途 | 取自脚本头注释第一行（防「不知道它守什么」） |

## 门禁

`node tools/gate-registry/cli.mjs check`（已接入 `console:test:all`）守护：

1. 每道门禁都已接入 `console:test:all`
2. 每道门禁都有头注释（能说明它守护什么）
3. 每道门禁都能归类（防分类规则漂移）
4. 台账文件与现状逐字节一致（防「改了门禁却忘了重新生成台账」）

## 台账

- [GATE-INDEX.md](./GATE-INDEX.md) —— 自动生成的清单（分类汇总 + 逐条明细）

## 相关文档

- [工作区文档管理工具](../doc-manager/README.md) —— 管文档资产
- [工作区 5S 清运工具](../workspace-doctor/README.md) —— 管工作区废料
