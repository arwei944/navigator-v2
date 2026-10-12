# 修缺陷：搜索框「秒加站点」后的真实信息补全从未生效

- 日期：2026-10-12
- 状态：已实施
- 提交：（见文末）
- 触发起因：用户报告「在搜索框添加站点时，站点信息还没有获取并且翻译成中文就添加了，我需要在秒添加的同时，获取正确的信息」

---

## 1. 现象与真机事实

用户诉求拆开是两句话，**两句都要满足**：

1. **秒添加要保留**（粘网址回车即刻入库，不能等抓取）；
2. **最终信息要正确**（真实抓取到的名称/描述，且非中文的译成中文）。

原设计本来就是这么分层的：`localSiteMeta`（本地推断，零延迟秒出）→ `addSite` → `scheduleMetaUpgrade`（后台真实抓取，覆盖推断值）。但真机探针（`probe/auto-add-upgrade.mjs`）打线上环境实测：

```
置顶项：{"title":"添加站点 figma.com"}
✅ 添加完成有回执 → 已添加「www.figma.com」到「设计与创意」（1747ms）

  秒加瞬间入库：
    {"name":"www.figma.com","desc":"Figma（figma.com）——设计与创意方向的常用站点，点击直达官网。"}
  /api/metadata 调用记录：
    7877ms status=200
  最终库内内容：
    {"name":"www.figma.com","desc":"…（同上，一字未变）","updatedAt":1791811736298}
```

**接口 200 回来了，库里那条记录的 `updatedAt` 纹丝不动** —— 升级一次都没落地。

线上接口直测（同一时刻）确认服务端能力是好的、且确实会译中文：

| 目标 | 耗时 | 抓取 | 返回的 name | translated |
|---|---|---|---|---|
| github.com | 9775ms | 超时 | `GitHub Copilot`（推断） | — |
| news.ycombinator.com | 6582ms | 超时 | `Ycombinator`（推断） | — |
| figma.com | 7739ms | 成功 | `Figma` | `desc: mymemory` ✅ |

---

## 2. 根因

`src/services/autoAdd.js` 里，后台升级是一个**模块级函数**，却引用了 `runAutoAdd()` 的**局部变量**：

```js
function scheduleMetaUpgrade(url, created) {     // ← 模块级
  ...
  fetchSiteMeta(url, { timeoutMs: META_TIMEOUT_MS })
    .then((r) => {
      const cur = sitesStore.sites.find(...)      // ← sitesStore 在这里不存在
      ...
      sitesStore.updateSite(created.id, patch)
    })
    .catch(() => { /* 静默：升级是锦上添花，失败不打扰 */ })   // ← 把 ReferenceError 吞了
}

async function runAutoAdd(normalized) {
  const sitesStore = useSitesStore()             // ← 它只活在这个函数里
  ...
  scheduleMetaUpgrade(normalized, created)
}
```

于是每次添加都抛 `ReferenceError: sitesStore is not defined`，被 `.catch(() => {})` 完整吞掉。**抓取、翻译、改写全程静默失败**，用户看到的永远是秒加那一刻的本地推断草稿。

这段代码由提交 `cb6fbd8`（「自动补全零延迟 + 翻译修复 + 添加后定位与最新置顶」）引入 —— 即**后台升级从引入之日起就没生效过一次**，而单测、门禁、真机探针全绿：因为没有任何一条断言看过这条链路。

> 「静默 catch」在这里是放大器而非起因：它把**代码级缺陷**（ReferenceError）和**预期内的失败**（站点抓不到）混成同一件事，于是一个必然复现的错误伪装成了「偶尔的网络问题」。

---

## 3. 修法

### 3.1 编排搬进独立模块 `src/services/metaUpgrade.js`

- **依赖全部显式注入**（`store` / `fetchMeta` / `timeoutMs` / `warn`），模块级函数引用函数内局部变量这类缺陷**结构上不可能再发生**；
- **不再吞错**：抓取失败（预期内）静默返回；**代码级抛错走 `warn`**，并在返回值里落 `reason:'error'`；
- 纯函数 `upgradePatchFromMeta(cur, meta, domain)` 与编排 `runMetaUpgrade(...)` 分开，前者可零依赖穷举；
- 文件放 `src/services/`（与 `services/meta.js` 同级），只做相对导入 + `.js` 后缀，可被纯 node 直接加载 —— 与 `test-meta-fetch.mjs` / `test-local-meta.mjs` 同一套测法。

### 3.2 升级结果回传给调用方

`autoAddSite()` 的成功返回值新增 `upgrade: Promise<{changed, real, reason, name, patch}>`。添加动作本身**不 await 它**，秒加体感不变。

`App.vue` 拿它挂一条回执：

```js
res.upgrade?.then((u) => {
  if (!u || !u.changed || !u.real) return
  toastStore.push({ message: `已补全「${u.name}」的名称与描述`, tone: 'info',
                    actionLabel: '查看', onAction: () => locateSite(res.site) })
})
```

**只在 `real`（服务端未给 `warning`，即真的读到了对方页面、名称描述是译成中文的真值）时回执。** 只拿到「按域名推断」的结果时保持安静 —— 用一个猜测去宣告「已补全」才是撒谎。

### 3.3 翻译预算下限 2s → 3.5s（服务端）

修好升级后真机复测暴露了另一半问题：**补回来的描述有时仍是英文**。

打线上同一站点连测 4 次：

| 采样 | 总耗时 | desc 译文 |
|---|---|---|
| #1 | 7251ms | ✅ 中文 |
| #2 | 5177ms | ✅ 中文 |
| #3 | **9371ms** | ❌ 英文原文 |
| #4 | 5488ms | ✅ 中文 |

根因是**翻译与抓取争同一个 9s 预算**：`autoTranslate(info, UA, Math.max(TRANSLATE_MIN_MS, TOTAL_BUDGET_MS - elapsed))`。
抓取（含补抓 manifest）吃掉约 6s 后，翻译只剩 `max(下限, 9s-已用)` —— 下限就是它在最坏情况下的全部时间，
2s 不够 MyMemory 往返，于是译文为空、保留原文。

`api/metadata.js`：`TRANSLATE_MIN_MS` 2000 → **3500**。最坏总时长 `6s 抓取 + 3.5s 翻译 ≈ 9.5~10s`，
仍在实测被平台正常返回的区间内（9.4s 那次是完整返回的，只是译文空）。

> 名称 0/4 被翻译是**设计如此**，不是缺陷：`shouldTranslateName` 只翻词组型名称
> （"Best Free Online Tools"），单词型一律视为品牌名保留 —— `Figma` / `OpenAI` 译成音译只会更难认。

**评估过但未采纳的两个方案**：
- **根治：把翻译拆成独立接口**（`/api/metadata` 秒回真实信息，前端发现未译时再调一次翻译接口，
  独享完整预算 → 接近 100%）。代价是新增一个出网接口 + 前端二次调用 + 测试，且给公共服务多开一个入口；
- **前端重试整个 metadata 调用**：会重新抓一遍页面，还可能翻倍消耗 `/api/metadata` 的限流额度
  （20 次/分/IP），收益不确定。

### 3.4 顺手修掉两个小瑕疵

- `iconUrl` 原先**无条件**写入（只要 favicon 同源就写），于是「其余字段都没变」也会凑出非空补丁，白写一次库、白改一次 `updatedAt`（而 `updatedAt` 正是覆盖守卫的凭据）。改为同值不写。
- `name` / `desc` 补 `.trim()`：原先 `'  '` 这种空白值会通过真值判断被写进去。
- `runAutoAdd` 的落库 catch 由 `catch {}` 改为 `catch (e) { console.warn(...) }`：存储配额溢出走的是 `safeSetItem`（它自己 catch 并告警），根本到不了这里 —— 能走到这里的几乎都是代码级缺陷，静默地一律说成「本机存储写入被拒绝」正是同款病灶。

### 3.5 `services/metaUpgrade` 走动态 import（首屏预算）

首屏预算硬线 600 KiB，改前余量 ~1 KiB，加进新模块后**正好顶到 614400 字节 = 600.000 KiB（余量 0）**。

`services/metaUpgrade.js` 只在「用户粘了网址并且加成功」之后才用得到，而它连带引入的 `services/meta.js`（抓取容错 + 文案表）同理（`AddSiteModal` 是异步组件，不占首屏）。改成 `import('@/services/metaUpgrade')` 后两者一起离开首屏静态图：

| | 首屏 raw | 首屏 gz |
|---|---|---|
| v11-P1 收尾 | 599.0 KiB | 209.8 KiB |
| 静态 import（中间态） | 600.0 KiB | 210.3 KiB |
| **动态 import（最终）** | **597.8 KiB** | **209.4 KiB** |

比改动前还低 1.2 KiB。`test-bundle` 的 `LAZY_PARTS` 同步加一条 `['升级过程抛错', '秒加后的真实信息补全']`，将来谁改回静态 import 立刻变红。

---

## 4. 明确不改的东西（范围收敛）

**没有动 `fallbackDraftFromMeta` 的「站名低置信 → 退回主机名」契约。** 理由是实测否定了「必须让它更好看」这个直觉：

- 本地推断给出的域名拼名绝大多数**可用**（`figma.com`→`Figma`、`linear.app`→`Linear`、`stripe.com`→`Stripe`、`npmjs.com`→`Npmjs`），只有 `developer.mozilla.org`→`Developer`、`sub.domain-x.com`→`Domain` 这类少数派偏怪；
- 更关键：**升级修好后，6~10 秒它自己就会把 `www.figma.com` 换成 `Figma`** —— 秒加用裸主机名只是「诚实的占位」，随后被真值替换。刻意美化过渡名反而会削掉这份「一眼看出是占位」的诚实。
- 且 `www.figma.com` 这类难看的中间态**只在抓取也失败时才会永久留下**（线上实测约 2/3 站点抓取超时）。

**没有加抓取重试。** 超时的根因是部署侧出网慢（服务端 `FETCH_BUDGET_MS=6000`，而实测外站往返 6.3~9.8s），重试大概率再超时，还会翻倍消耗 `/api/metadata` 的限流额度（20 次/分/IP）。这条留作后续可选项。

**没有加卡片上的「识别中」角标。** 那要动卡片渲染 + `validate-data` 字段白名单；回执 toast 已经覆盖了「用户能感知到补全完成」这个需求。

---

## 5. 验证

新增 `tools/console/test-meta-upgrade.mjs`（39 条断言，已并入 `console:test:all`，套件数 36 → 37），覆盖：

- `upgradePatchFromMeta`：改名同步重算 `initial`、空白值不覆盖、favicon 同源才挂、原文落别名（去重 / 与域名同形不写）、全字段一致 → 空补丁；
- `runMetaUpgrade`：正常升级、`warning` 非空 → `real:false`、抓取失败不动库、**覆盖守卫**（`updatedAt` 变了整体放弃）、站点已删除、无变化不写库；
- **回归守卫（本次事故的形态）**：`fetchMeta` 抛错 / `store` 形状不对 / 完全不传 `store` —— 三者都必须 `reason:'error'` 且 **`warn` 被调用**。

反向验证过守卫有效：把 `warn(...)` 临时改成静默 `void e`，3 条 ★ 断言立刻变红。

真机：`probe/auto-add-upgrade.mjs`（本次新建）对线上环境跑「输入网址 → 回车 → 观察库内记录 40 秒」，断言后台确实发起 `/api/metadata`、返回后库内记录**被改写**、且改写后的名称/描述与秒加值不同。

---

## 6. 提交

| 提交 | 内容 |
|---|---|
| `fix(auto-add)` | 秒加后的真实信息补全从未生效（作用域漏取 + 静默吞错） |
| `test(meta-upgrade)` | 新增 39 条断言，含「代码级抛错必须告警」回归守卫 |
| `docs` | 本文档 |
