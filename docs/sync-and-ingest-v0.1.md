# 三端同步、省空间备份与浏览器工作区（v0.1）

本文覆盖三件事：

1. **三端同步**：本地库 ↔ BotKeep ↔ WorkBuddy，以最新数据为准；
2. **省空间备份**：内容寻址 + gzip + 分层保留；
3. **浏览器同步**：历史 / 书签 / 标签页先入临时工作区，确认后再进主库。

## 一、三端同步

### 端点

| id | 默认地址 | 角色 |
|---|---|---|
| `local` | `http://127.0.0.1:3000` | 本机服务（可用 `NAV_SYNC_LOCAL_URL` 覆盖） |
| `botkeep` | `https://navigator-v2.bot-keep.xyz` | 线上主站 |
| `workbuddy` | `https://nav-dashboard-19166.app.workbuddy.host` | 线上回退通道 |

Vercel 于 2026-10-11 被平台停用（全站 402），默认不参与；只有显式配置
`NAV_SYNC_VERCEL_URL` 时才会加入清单。额外端点可用 `NAV_SYNC_ENDPOINTS`
（JSON 数组）追加或按 id 覆盖。

### 判定规则

三端各自写入时都会改 `version` 与 `updatedAt`，所以不能直接比这两个值。

1. **先比内容指纹**：只取可同步的业务字段
   （`id/name/url/desc/categoryId/color/initial/sortOrder/createdAt/icon/aliases/purposes/position`），
   对对象键排序后做 SHA-256。
2. 指纹全相同 → 已一致，一次写都不做。
3. 内容不同 → 按 `updatedAt` 新者优先，其次 `version`、站点数、id 稳定排序。
4. 只推给「内容不同且更旧 / 为空」的端；**内容更新的端不在计划里**。
5. `updatedAt` 相同但内容不同 → 记冲突，不覆盖。

### 为什么排除 archived / pinned / visitCount / updatedAt

各端健康巡检会独立把连续失效的站点归档（`server/cron.mjs`），
三个平台巡检进度不同。如果这些字段进入指纹：

- 内容明明一样也会永远判成「不一致」；
- 同步会把一端刚归档的站点重新放出来，下一轮巡检再归档，形成来回震荡；
- `visitCount` 是每台设备自己的统计，覆盖它等于把别人的数据清零。

因此写入时用 `withLocalState` **保留目标端的三类本地状态**：
`archived`、`pinned`、`visitCount`。代价是「一端的归档 / 置顶不会传播」，
这是有意的：它们是视图状态，不是站点目录内容。

### 安全线

1. 空库不参与选主，也绝不外推；读失败只记不可达。
2. 只推落后端，不覆盖更新的端。
3. 写入仍走各端 `POST /api/sites`：CAS + 写前快照 + `sanitizeSites` 门禁。
   同步器没有第二条写通道。
4. 409 冲突时重新读取：内容已一致算成功，否则重试一次后放弃。
5. 写后**重新读取复核**，以读回来的内容为准，不相信写入响应。

### 权威源：BotKeep

默认 `NAV_SYNC_AUTHORITY=botkeep`，同步方向是**单向**的：BotKeep → 本地 / WorkBuddy。

- BotKeep **只读不写**。即使另一端的 `updatedAt` 更晚，也不会反向覆盖它；
- BotKeep 不可达或没有站点数据时，本轮**不写任何一端**；
- 另一端更新但内容不同时记 `diverged`，面板显式提示，仍以 BotKeep 内容下发；
- 需要临时回到「自动选最新」时设 `NAV_SYNC_AUTHORITY=`（空字符串）。

### 被移除站点的归档

权威模式下，目标端有、BotKeep 没有的站点会在写入时消失。写入前会先把这些
站点**完整**存到 `backups/sync/removed/<target>-<时间>.json`
（含 id、名称、网址、分类、创建时间、访问计数、用途等），
状态历史里也会记录数量与路径。

这保证「历史添加过的站点」不会因为一次同步变成不可追溯的消失；
需要时可以按 id 取回或重新导入。

### 密钥

三端必须使用同一个 `SITES_ADMIN_KEY`（本地是 `data/admin-key.txt`）。
线上两端需要把该值配进部署环境变量，否则写入返回 401。
面板会显示「当前进程未配置 SITES_ADMIN_KEY」。

### 自动同步

默认**关闭**。本机显式设置：

```bash
NAV_SYNC_ENABLED=1
NAV_SYNC_INTERVAL_SEC=30   # 默认 30 秒，最小 5
```

只有 `server/main.mjs` 启动时才会拉起调度器。线上两端不跑定时器：
三个写者互相推没有收益，只会放大冲突。

### 接口与面板

| 接口 | 用途 |
|---|---|
| `GET /api/sync` | 三端状态、最近结果、历史（需鉴权） |
| `POST /api/sync` | `{dryRun:true}` 只出计划；否则执行 |

后台路径：**数据 → 三端同步**（快捷键 `g x`）。
面板先「预演」，确认计划后再「立即同步」，执行前二次确认。

### 实测（2026-10-21）

| 端 | 同步前 | 同步后 |
|---|---|---|
| BotKeep | v2 · 10-20 · 300 条 | 主端 |
| 本地 | v1 · 10-15 · 300 条 | 已写入 |
| WorkBuddy | v1 · 10-12 · 300 条 | 已写入 |

同步后三端业务字段指纹一致（`59da567a19…`），复跑无待写端。
首次写入曾因把「计划摘要」当站点表推出去被 400 拦下；修正后写入 300 条成功。

## 二、省空间备份

### 旧实现的三个浪费

1. 每次恢复前存一整份 JSON，即使内容没变；
2. 不压缩；
3. 按次数裁（最近 20 份），连续操作会把更有价值的历史挤掉。

### 新结构

```
ops/backups/
  blobs/<sha256>.json.gz.b64      # 内容寻址，同一内容只存一份
  manifests/<时间>-<指纹8位>.json  # 每次备份一份小清单，只存引用与摘要
  pre-restore-*.json              # 旧格式，仍可读、可恢复
```

- `sites` 与 `cloud` 分别做内容哈希，各自存 blob；
- gzip（level 9）后 base64，因为存储层 body 是 TEXT；
- manifest 记录 `sitesRef` / `cloudRef` / `counts` / 原始与压缩体积。

### 保留策略

`shared/backup-policy.mjs`：

- 最近 8 份逐次保留；
- 其余名额给「每天最早一份」（最多 14 天）；
- 再给「每周最早一份」（最多 8 周）；
- 总数硬上限 20（`MANIFEST_KEEP`）；
- manifest 删除后，无引用的 blob 才会被清，且留 1 小时安全窗口。

### 快照去重

`api/sites.js` 写前会读最近一份快照并比较内容指纹；相同则跳过。
三端同步、只改 version 的写入不再产生等价快照。

### 接口变化

| 接口 | 说明 |
|---|---|
| `GET /api/backup?meta=1` | 新增 `bytesStored`（gzip 后体积） |
| `GET /api/backup?list=1` | 备份清单（manifest + 旧格式） |
| `POST /api/backup` | 支持 `{manifest:"..."}` 从新格式恢复，也兼容旧的 `{data:...}` |

### 实测

| 项目 | 结果 |
|---|---|
| 原始体积 | 157,420 B |
| 压缩后 | 36,181 B（**23.0%**） |
| 两次恢复 | 生成 2 份 manifest，blob 仅 3 个（相同 cloud 未重复存） |
| 旧格式 | 仍出现在 `?list=1` 中，可恢复 |

## 三、浏览器临时工作区

### 数据流

```
浏览器扩展
  ├─ 本地筛选（来源 / 时间 / 访问次数 / 关键词 / 黑名单）
  ├─ POST /api/ingest?action=preview   → 规范化结果（不落盘）
  └─ POST /api/ingest                  → staging/<batch>.json（不碰主库）
后台「浏览器工作区」
  ├─ 逐条确认分类 / 去重
  ├─ POST /api/ingest?action=promote   → CAS 写主库（写前快照）
  └─ DELETE /api/ingest?batch=<id>     → 整批丢弃
```

### 规范化

- URL：去协议 / `www` / query / hash / 尾斜杠，**保留路径**；
- 名称：标题优先，超长截断；描述标注来源与访问次数；
- 分类：域名与标题关键词匹配已登记分类，匹配不到落 `starter`；
- 字段：输出与主库完全一致的 15 个字段，不存在第二套中间格式；
- id：`ing-<url sha1 前 8 位>`，同一网址重复同步不会产生新站点。

### 去重

- 批次内同网址合并，访问次数累加；
- 与主库同网址的标 `duplicateOf`，默认不勾选；
- 提升策略：
  - `skip`（默认）：重复跳过；
  - `overwrite`：保留原 id / 归档 / 置顶 / 访问计数，替换其余字段；
  - `new-id`：同网址也新建，id 自动去重。

### 接口

| 接口 | 用途 |
|---|---|
| `GET /api/ingest` | 批次摘要列表 |
| `GET /api/ingest?batch=<id>` | 批次详情 |
| `GET /api/ingest?categories=1` | 分类表（扩展下拉） |
| `POST /api/ingest` | 新建批次 |
| `POST /api/ingest?action=preview` | 只规范化，不落盘 |
| `POST /api/ingest?action=promote` | 提升选中条目 |
| `DELETE /api/ingest?batch=<id>` | 丢弃批次 |

护栏：单批 ≤ 2000 条、请求体 ≤ 2 MB；promote 读主库失败返回 503，
绝不当空库覆盖。

### 实测（临时库）

| 步骤 | 结果 |
|---|---|
| 预览 5 条 | 去重后 3、新增 2、主库已有 1、非法 2 |
| 分类建议 | ChatGPT→starter、GitHub→coding、Figma→design |
| promote skip | 300 → 302，跳过 1，快照生成 |
| 批次状态 | `partially-promoted`，2 条 promoted、1 条 pending |
| promote overwrite | 覆盖 `s1`，分类覆盖 `coding` 生效，快照累计 2 份 |
| 丢弃批次 | staging 删除，主库版本不变 |

真实库上的测试只做预览 / 建批 / 丢弃，主库保持 v2 / 300 条不变。

### 扩展安装

见 `extension/README.md`。要点：

1. `chrome://extensions` → 开发者模式 → 加载已解压 → 选 `extension/`；
2. 设置里填站点地址与管理密钥；
3. 扫描 → 确认分类 → 保存到临时工作区 → 去后台提升。

## 四、升级数据保护

### 已有保护与缺口

- 部署包**排除 `data/`**（打包遍历跳过，并在打包前二次断言），部署本身不会覆盖线上库；
- 容器 restart 保留文件系统；
- 但平台**没有持久卷**：容器被平台重建时 `data/store.db` 会一起消失，部署路径救不回数据。

### 升级保护流程

`scripts/deploy-botkeep.mjs` 默认启用 `scripts/upgrade-guard.mjs`：

1. **升级前**：`GET /api/backup` 拉取站点、分类与
   `ops/audit.json`、`ops/health.json`、`clicks.json`、
   `ops/publish-history.json`、`ops/notifications.json`，
   存到 `backups/upgrades/<时间>-before.json`；
2. **升级后核对**：
   - 站点条数不下降；
   - version 不回退；
   - 升级前存在的每个站点 id 都还在（新增允许）；
   - 审计记录条数不减少；
3. **异常自动恢复**：用升级前备份 `POST /api/backup` 写回（恢复前接口会再拍一份安全快照），
   恢复后重新核对。

参数：

| 参数 | 作用 |
|---|---|
| `--no-guard` | 关闭升级数据保护 |
| `--no-restore` | 只核对，异常时不自动恢复 |

未配置 `SITES_ADMIN_KEY` 或线上不可达时，保护会跳过并在输出里标明，不阻塞首次发布。

### 操作记录的范围

| 记录 | 位置 | 升级是否保留 |
|---|---|---|
| 站点（含 createdAt / visitCount / aliases / position） | `sites.json` | 是（备份 + 核对 id） |
| 审计日志 | `ops/audit.json` | 是（备份 + 条数核对） |
| 健康巡检 | `ops/health.json` | 是 |
| 点击统计 | `clicks.json` | 是 |
| 发布历史 | `ops/publish-history.json` | 是 |
| 通知 | `ops/notifications.json` | 是 |
| 对象变更日志 `changes` 表 | SQLite | 跟随数据库文件；容器重建后由镜像全量对齐 |

### 站点变更审计

站点写入成功后（`POST /api/sites`，含回滚）自动对比前后站点表并记录：

| 动作 | 何时产生 | 记录内容 |
|---|---|---|
| `sites.add` | 新增站点 | target = 站点 id，detail = 名称 · 网址 |
| `sites.update` | 内容字段变化 | 同上 |
| `sites.remove` | 删除站点 | 同上 |
| `sites.batch` | 单次变更超过 30 条 | 新增 / 删除 / 修改数量 + 明细路径 |
| `sites.sync` | 同步器写入（带 `X-Nav-Sync: 1`） | 汇总 + 明细路径 |

- **不产生噪音**：`visitCount`、`updatedAt` 的变化不算更新；归档 / 置顶算更新。
- **不淹没日志**：批量变更只记一条摘要，完整 diff 存在
  `ops/site-changes/<时间>-<随机>.json`（保留最近 50 份）。
- **审计读失败时不写**：追加是「读全量 → 头插 → 写回」，读失败若按空数组继续，
  会把 2000 条历史覆盖成一条。此时宁可这次不记。
- 审计是旁路：任何失败只打日志，不影响已经成功的数据写入。

## 五、运维

### 本地启动

```bash
export PORT=3000
export NAV_STORE_DIR="C:/work/nav-v2/server/data"
export SITES_ADMIN_KEY="$(cat data/admin-key.txt)"
export ADMIN_PASSWORD_HASH="$(cat data/admin-password-hash.txt)"
node dist/server.js
```

如需自动同步：

```bash
export NAV_SYNC_ENABLED=1
export NAV_SYNC_INTERVAL_SEC=30
```

### 已实现的环境变量

| 变量 | 说明 |
|---|---|
| `NAV_SYNC_AUTHORITY` | 权威端 id（默认 `botkeep`；空字符串 = 自动选最新） |
| `NAV_SYNC_LOCAL_URL` | 本地端地址 |
| `NAV_SYNC_BOTKEEP_URL` | BotKeep 地址 |
| `NAV_SYNC_WORKBUDDY_URL` | WorkBuddy 地址 |
| `NAV_SYNC_VERCEL_URL` | 配置后才加入 Vercel |
| `NAV_SYNC_ENDPOINTS` | 额外端点 JSON 数组 |
| `NAV_SYNC_ENABLED` | `1` = 本机开启定时同步 |
| `NAV_SYNC_INTERVAL_SEC` | 定时同步间隔（默认 30） |
| `NAV_SYNC_TIMEOUT_MS` | 单端请求超时（默认 12000） |
| `NAV_SYNC_STATE_DIR` | 同步状态目录（默认 `backups/sync`） |

## 六、已知边界

- 同步范围是**站点业务字段**；归档 / 置顶 / 访问计数保持各端本地状态。
- 分类表参与指纹，但当前三端 `sites.json` 都没有 `categories` 字段；
  接入云端自定义分类后会自动纳入。
- 备份保留上限 20 份，更多历史请导出到外部存储。
- 扩展只在 Chromium 系浏览器验证；Firefox 需要调整 `background.service_worker`。
- 扩展端不做真正的「网页正文抓取」，只用标题与域名；需要摘要时在后台用 AI 助手补。
- 临时工作区按批次存对象，没有做跨批次去重；同一网址分多批导入时，
  提升阶段仍会按主库 URL 去重。