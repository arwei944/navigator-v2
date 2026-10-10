# 卡片打开方式：改为「新标签页」，并且不再用 `window.open`

**日期**：2026-10-10
**状态**：已实现
**触发**：用户反馈「现在点击卡片是直接覆盖原有网址打开，我需要新开一个网页打开」

---

## 一、先量，再改

原实现是 `window.open('https://' + site.url, '_blank', 'noopener')`，**看起来已经是对的**。
所以第一步不是改代码，而是用 trusted 输入事件（CDP `Input.dispatchMouseEvent`，不是
`element.click()`）在真实 Chrome 里复现一次，看到底发生了什么：

| 观测 | 结果 |
|---|---|
| 点击前后 `location.href` | 未变（**没有被覆盖**） |
| CDP `Page.windowOpen` | 触发 1 次，`windowName=_blank` |
| 新增浏览上下文 | 1 个（`page:` 目标从 2 → 3） |

**结论：在桌面 Chrome 里，原实现本来就是新开标签页。** 用户看到的现象来自另一类运行环境。

## 二、根因

按 HTML 规范，`window.open` **只要传了第三个参数**（windowFeatures），这次调用就被定性为
**弹窗请求**（auxiliary browsing context），而不是一次普通导航。于是：

1. **内嵌 WebView / App 内置浏览器 / IDE 预览面板**常把弹窗直接拦掉，或把弹窗「就地打开」——
   表现就是**当前页被覆盖**。这是最符合用户描述的一条。
2. **弹窗拦截器**：一旦这次调用不在用户手势的同步栈里（被 `await` 隔开），会被拦掉。

而 `<a target="_blank" rel="noopener noreferrer">` 的点击是**普通链接导航**，不经过弹窗通道，
各浏览器与 WebView 普遍实现；还天然保留「中键 / Ctrl+点击 / 右键 → 在新标签页打开」的原生语义。

## 三、改法

新增 `src/utils/open.js#openInNewTab(url)`，合成一次锚点点击，并**收敛为唯一口径**：

| 位置 | 改前 | 改后 |
|---|---|---|
| `components/SiteCard.vue`（卡片主体 / Enter / Space） | `window.open(..., '_blank', 'noopener')` | `openInNewTab(...)` |
| `components/ContextMenuHost.vue`（右键「新窗口打开」） | 同上 | `openInNewTab(...)` |
| `composables/useOmniBox.js`（打开站点 / 搜索引擎） | 同上（2 处） | `openInNewTab(...)` |
| `components/UnifiedSearchBox.vue`（搜索引擎） | 同上 | `openInNewTab(...)` |

`ContentFeed.vue` 与 `SiteDetailPanel.vue` 本来就用 `<a target="_blank">`，未动。

行为不变的部分：仍然记访问次数与浏览历史（`recordVisit` / `addRecord`），顺序也不变。

## 四、守卫

| 层 | 断言 |
|---|---|
| `tools/console/test-frontend.mjs`（源码/单元，11 条） | 用最小 DOM 桩验证 `openInNewTab` 造出的是 `<a>`、`target=_blank`、`rel` 含 `noopener`+`noreferrer`、先挂 body 再点、点完摘掉、空地址不产生节点；**并扫描 `src/**` 断言不再出现任何 `window.open(`**（扫描前剥注释，否则 `open.js` 里那段说明会被误判） |
| `probe/verify-card-open.mjs`（真机，12 项） | 卡片主体点击与右键菜单打开：当前页 `location.href` 不变、确实对新标签页发起了链接导航且 href 是该卡片地址、真的多出一个外部浏览上下文、由用户手势触发 |

## 五、一个必须记下的观测局限

`probe/verify-card-open.mjs` 里**不能**断言「这次打开不是弹窗请求」。实测发现
CDP `Page.windowOpen` 的 `windowFeatures` 对**普通锚点点击**也会填一整套默认值
（`menubar,toolbar,status,scrollbars,resizable`，外加 `rel=noopener` 带来的 `noopener`），
所以「windowFeatures 为空 = 链接导航」这个直觉是错的；`windowName` / `userGesture` 也区分不开。

该区分**只能**靠源码级保证（即上面 test-frontend 的两条）。探针里保留了 windowFeatures 的
诊断输出，但明确标注为诊断而非断言 —— 免得后来者以为这里验过了。
