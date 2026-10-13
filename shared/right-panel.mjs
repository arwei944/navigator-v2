/**
 * 右边栏「显示谁」的状态机 —— **纯函数、零依赖**。
 *
 * ## 它要解决的实际问题
 *
 * 旧行为是：鼠标悬停卡片 → 面板显示该站；鼠标一移开 → 面板立刻清空。
 * 于是**想读完一段描述或改一个字段都来不及**，而且没有任何办法让它停下来。
 *
 * 所以核心不是"加几种触发方式"，而是：**面板不跟鼠标一起消失**。
 * 一旦决定了这一点，三种模式就退化成很轻的差异 —— 只在于「谁来决定切换」：
 *
 * | 模式   | 悬停卡片 | 主动打开（右键「查看详情」）    |
 * |--------|----------|-------------------------------|
 * | hover  | 立即切换 | 切换                          |
 * | click  | 忽略     | 切换                          |
 * | pin    | 忽略     | **toggle**：再选同一张则收起   |
 *
 * `pin` 与 `click` 的实际差别只有两点，如实记在这里免得被当成重复选项：
 * ① `pin` 下重复选择同一张 = 收起面板（它是"钉住/拔掉"的开关语义）；
 * ② `pin` 下面板顶部常显图钉按钮，一眼能看出当前是"钉住"状态。
 *
 * ## 第三个维度：`frozen`（面板被占用时不许悬停抢走）
 *
 * 内联编辑期间面板处于 `frozen`，此时**悬停不再生效**（`select`/`clear` 照常）。
 * 没有这一条，`hover` 模式下"点铅笔 → 手抖划过卡片 → 改动全丢"是必然事件。
 *
 * ## 为什么不保留 hoveredSite / pinnedSite 双状态
 *
 * 最初设计过「临时预览 + 锁定」两个目标，但既然面板**移开不再清空**，
 * 「临时」这个维度就不存在了 —— 留两个状态只会让「什么时候被谁覆盖」变成一道阅读理解题。
 * 现在只有一个 `site`，语义就是"面板当前显示谁"。
 *
 * ## 为什么抽成纯函数
 *
 * 模式判断若散在组件里，每加一种模式就要改若干处 `if`，漏一处就是
 * 「改了设置但某个入口不听话」。抽出来后可以用真值表钉死
 * （见 `tools/console/test-right-panel.mjs`），与 `purposes.mjs` / `clicks-core.mjs`
 * 同属「内核纯函数」：浏览器与 Node 都能引用。
 */

/** 面板显示模式。这里是**唯一**定义处，preferences store 从这里引。 */
export const RIGHT_PANEL_MODES = ['hover', 'click', 'pin']

/**
 * 状态归约。**永远返回完整的下一状态**（`{ site }`），调用方整体赋值即可。
 *
 * @param {'hover'|'click'|'pin'} mode 当前模式（非法值按 `hover` 处理）
 * @param {{site?: object|null, frozen?: boolean}} state 当前状态
 *        `frozen` = 面板正被「占用」（例如详情面板处于内联编辑态）
 * @param {{type:'hover'|'select'|'clear', site?: object|null}} action 事件
 */
export function reduceRightPanel(mode, state = {}, action = {}) {
  const site = state.site ?? null
  const target = action.site ?? null
  const type = action.type
  const frozen = state.frozen === true

  // 「清空」与模式无关，先处理：任何模式都要能一键回到干净状态，
  // 放在模式分支之前可以避免某一种模式漏实现导致「点了清空却没清干净」。
  if (type === 'clear') return { site: null }

  // 非法模式按 hover 处理：宁可"跟着鼠标变"，也不要卡住不动
  const m = RIGHT_PANEL_MODES.includes(mode) ? mode : 'hover'

  if (type === 'hover') {
    // frozen 拦住悬停，但**只拦悬停**：悬停是"鼠标路过"，是无意的；
    // 而 select/clear 是用户明确的动作，仍然照常生效。
    //
    // 为什么必须拦：`hover` 模式下用户点了铅笔开始编辑，鼠标只要划过任意一张卡片，
    // 面板就被换走、没保存的改动当场丢失 —— 而"编辑时手抖划过卡片"几乎必然发生。
    if (frozen) return { site }
    // 只有 hover 模式跟随悬停；其余模式悬停一律不影响面板（这正是它们的卖点）
    return m === 'hover' ? { site: target } : { site }
  }

  if (type === 'select') {
    // 空目标不入面板：宁可保持现状，也不要显示一个空壳
    if (!target) return { site }
    // pin 的 toggle：再选同一张 = 拔掉图钉
    if (m === 'pin' && site && site.id === target.id) return { site: null }
    return { site: target }
  }

  return { site }
}
