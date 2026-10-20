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

## 写「真机门禁」的约定（并发下才稳）

门禁是 **4 路并发**执行的，同时可能有 6~7 个 Chrome 在启动。真机门禁里
**任何固定 `sleep` 都是在赌加载速度**，并发下必然偶发失败，而且失败形态
极易被误判成「功能坏了」：

| 症状 | 真实原因 |
|---|---|
| 断言全「实得 0」 | 页面还没渲染完，sleep 不够 |
| `Runtime.evaluate` 抛 `Uncaught` | 页面未就绪，表达式里的元素不存在 |
| 元素存在但点击无效 | 事件尚未绑定（静态 HTML 早就渲染了） |
| 面板已 active 但 0 行 | 数据是异步 fetch 的，还没回来 |
| `Execution context was destroyed` | ① `readyState==='complete'` 在 about:blank 就成立；② 点击外链后页面真的跳走了 |
| 路由跳了但内容还是 0 | 用 `pushState` 只改了 URL，Vue Router 没重新解析 |

统一用 `tools/console/lib/wait-for.mjs`：

- `makeWaitFor(client)` —— 轮询到条件成立（内部吞掉未就绪异常）
- `makeClickUntil(client)` —— **反复点击直到产生效果**，而不是「点一次 + 等」

另外几条硬约定：

1. **CDP 端口传 `0`**（系统分配）。不要写 `9800 + Math.random()*100` ——
   各门禁的随机区间互相重叠，撞端口时浏览器起不来，表现为「偶发失败」。
2. **SQLite 用 `NAV_STORE_DIR` 指向进程独立目录**（带 `process.pid`）。
   共用 `dist/data/store.db` 会让并发门禁互相污染数据。
   启动 `dist/server.js` 的门禁还应带 `NAV_CRON: '0'`，否则每个实例都跑 300 站探活。
3. **路由跳转用 `c.goto(url)`，不要 `pushState` + `PopStateEvent`**。
   后者只改 URL，Vue Router 不会重新解析；首屏未渲染完时页面停在空白。
4. **就绪判据要落在应用 DOM 上**，不要用 `document.readyState === 'complete'`
   —— 它在 `about:blank` 阶段就成立，紧接着的 eval 会撞上下文销毁。
5. **点击外链后必须先 `goto` 回本站**再读 `localStorage`：跳转会让执行上下文销毁。

以上五条都由 `test-gate-concurrency.mjs` 静态检查（14 条断言）。

## 相关文档

- [工作区文档管理工具](../doc-manager/README.md) —— 管文档资产
- [工作区 5S 清运工具](../workspace-doctor/README.md) —— 管工作区废料
