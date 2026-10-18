# v10 设计方案：后台全量复活 + 常驻巡检自愈

状态：**执行中** ｜ 日期：2026-10-11 ｜ 前置：v9-P0 数据层已回归（`a9dacf7`）、v9 体验三连（`cb6fbd8`）、智能建类（`7b70c68`）。

---

## 1. 调研结论：还"死着"的东西

v9-P0 只复活了 `sites` / `session` / `metadata` 三个接口，**其余四个仍绑在 `@vercel/blob`**：

| 接口 | 状态 | 影响的用户可见能力 |
|---|---|---|
| `api/ops.js` | 死 | **管理后台 10 个组件全部不可用**（审计/通知/快照/发布历史/回滚） |
| `api/clicks.js` | 死 | 热门排序、频次信号（点击统计 404 静默丢弃） |
| `api/health.js` | 死 | 卡片健康角标无数据源 |
| `api/auth.js` | 死 | 管理后台登录闸门（口��� hash + 会话 token） |

好消息：四者都只用 `get/put` 两个符号，前端调用路径固定，**迁移成本 = 每个文件一行 import + 服务端加路由**。

两个调研中发现的硬事实：
- **postbuild 只复制了 `shared/*.mjs` 顶层**，`shared/ops/`（ops.js / auth.js 都 import 它）
  在部署包里缺失 —— 不修的话后台与登录在沙箱直接加载失败。
- **`shared/health-probe.mjs` 是 Windows 专用**（走 `curl.exe`，因为本机 Node fetch 不走系统代理），
  沙箱是 Linux **没有 curl.exe**。服务端定时巡检不能复用它，必须改走纯 Node 的
  `fetchCapped`（且它自带两层 SSRF 防护）。

## 2. 执行清单

**第一批 · 数据层全量回归（基础设施）**
1. `clicks/ops/auth/health` 四接口：各改一行 import → `#store`；同步换测试 mock 目标
2. postbuild 改为**递归**复制 `shared/**`（修 `ops/` 缺口）
3. `server/main.mjs` 新增四条路由（POST 缓冲体、GET 直通）；`/api/sites` 的 ETag/304 特例保留

**第二批 · 能力复活（用户可感知）**
4. 管理后台十组件联通 + 登录（scrypt 口令 + 7/90 天会话）
5. 点击统计复活 → 热门排序 / 频次信号恢复
6. 健康角标数据恢复（`/api/health` GET）

**第三批 · 常驻巡检与自愈（v8 搁置的 S3）**
7. `shared/health-rules.mjs` 抽出 `buildHealthPayload`（合并 + 按站点集剔除 + version/计数）——
   接口与巡检**共用同一实现**，不复制第二份合并逻辑
8. `server/cron.mjs`：进程内定时巡检（启动后延迟跑一轮，之后每 6h），纯 Node `fetchCapped` 出网
   （自带字面主机 + pinned lookup 两层 SSRF 防护），并发受控、跳过归档站、单轮失败不崩进程
9. 体检清单：巡检结果落 `ops/health.json`，后台数据恢复后自动可用

**第四批（下一轮，不在本次执行范围）**
10. `og:image` 封面（服务端抓取落盘 `covers/`，rich 档展示）
11. S4 AI（OpenAI 兼容接口，key 在服务端环境变量，无 key 隐藏入口）
12. 一键备份 / 恢复（沙箱磁盘无 SLA，这项优先级随时间上升）

## 3. 不变量

- **凭据一律 `X-Nav-Key`**：`bearerOf` 已优先读自定义头，四接口鉴权自动受益（Authorization 保留本机直连）。
- **接口源码只改 import**：校验 / 限流 / 审计 / CAS 等逻辑不动，既有测试换 mock 目标后继续守护。
- **巡检出网必须走 `fetchCapped`**：`health-probe` 的 curl 通道在沙箱不可用；直接自己拼
  `http.request` 等于绕过 SSRF 防护 —— 那是公网可触达的探测端点，绝不能开内网的口子。
- **合并逻辑单一实现**：`buildHealthPayload` 是「合并而非覆盖、按当前站点集剔除」的唯一出处。
- 后台与巡检不得进入口静态图（`/admin` 是独立路由；cron 只在服务端运行）。

## 4. 验收

- `console:test:all` 26 套件全绿；`test-api-ops` / `test-trust` 等 mock 换目标后通过
- 线上：`/api/ops`（带 `X-Nav-Key`）返回审计与历史；`/api/clicks` GET/POST 往返；`/api/health` GET 有判定；
  管理后台 `/admin` 打开即有数据（登录闸门可用）
- 真机：首轮巡检完成后，卡片出现健康角标

---

## 相关文档

- [v8 升级方案：智能化 + 主题体系 + 便利贴 / 实时备注](./2026-10-11-v8-smart-theme-notes-design.md)
- [v9 设计方案：数据回归 —— 在自建服务上重建后端，补全智能闭环](./2026-10-11-v9-data-return-design.md)
- [v11 设计方案：看得见 · 更懂你 · 更顺手](./2026-10-12-v11-roadmap-design.md)
