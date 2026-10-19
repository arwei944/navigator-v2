# probe/ —— 一次性验证脚本（受治理，不要整体删除）

这个目录**不是废料**，也不是临时目录。它存放的是「改完之后真的跑一遍看看」的
验证脚本：每个文件对应一次具体的功能验证或线上取证，写完即用、用完留档。

## 为什么保留而不是删掉

三个理由，按重要性排序：

1. **部分脚本是现行门禁的对照口径。** 门禁只能验证「静态结构」，运行期真实值
   要靠这里的脚本实测。例如：
   - `_sw-stats.mjs` —— `tools/console/test-bundle-size.mjs` 的「assets gzip 合计」
     与它同口径，改一边必须改另一边。
   - `_contrast-audit.mjs` —— `tools/console/test-contrast.mjs` 明确写「运行期真实值
     （含 preset 覆盖）以本文档实测为准」。
2. **它们是历史决策的证据。** 例如 `test-pwa-online.mjs` 记录了「`/sw.js` 被
   `vercel.json` 重写成 `index.html` 导致注册失败」的复现方式；`white-screen.mjs`
   记录了白屏的排查路径。删掉脚本，这些结论就只剩结论、没有验证手段。
3. **复用成本低。** 下次遇到同类问题，改个选择器就能跑。

## 治理规则（由门禁强制）

- **只允许脚本入库**：`.mjs` / `.cjs` / `.html` / `.sh` 可以；
  `.png` / `.json` / `.txt` / `.log` 等草稿一律不得提交。
  由 `tools/console/test-hygiene.mjs` 检查——它读 `git ls-files`，所以
  「先提交再删」也会被抓到。
- **草稿应在跑完后手动清运**：`npm run workspace:scan` 可查当前可清运项。

## 命名约定

| 前缀 | 含义 |
|---|---|
| `_` | 内部辅助 / 会被别的脚本复用（如 `_blob-stub.mjs`） |
| `*-verify.mjs` | 某个界面或流程的验收脚本 |
| `perf-*.mjs` | 性能测量 |
| `test-*.mjs` | 一次性探针（**不是**门禁；门禁在 `tools/console/`） |

> ⚠️ 注意与 `tools/console/test-*.mjs` 区分：那个目录下的是**常驻门禁**，
> 由 `npm run console:test:all` 执行；这里的 `test-*` 是一次性探针，不会被自动跑。

## 是否需要清理

判断标准不是「文件多老」，而是「还有没有人在用」：

- 有门禁或文档引用它 → 保留（改引用前不要删）
- 是某次事故的取证脚本 → 保留（这是复现手段）
- 纯粹忘了删的中间产物 → 删

当前 70 个文件全部属于前两类，**没有可清运项**（`git status --ignored probe/` 为空）。
