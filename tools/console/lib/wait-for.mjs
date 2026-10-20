/**
 * 真机门禁的等待工具：轮询直到条件成立，而不是固定 `sleep`。
 *
 * ## 为什么固定 sleep 在门禁里不可靠
 *
 * 门禁是 4 路并发执行的，同时可能有 6 个 Chrome 在启动。首屏渲染时间
 * 从「1 秒内」到「好几秒」都可能 —— 固定 `sleep(1500)` 在并发下不够，
 * 表现是断言全「实得 0」，看起来像渲染 bug，实际只是没等够。
 *
 * 更糟的是它**不稳定**：同一份代码单独跑通过、并发跑失败，
 * 排查时极易被当成噪声跳过（这个坑实测踩过好几轮）。
 *
 * ## 为什么不是简单加长 sleep
 *
 * 加长会让每道门禁都变慢（串行时白等），而且并发度再高一点还是不够。
 * 轮询是「快的时候立刻过、慢的时候也不会误判」，两头都对。
 *
 * ## `try/catch` 是必需的
 *
 * 页面还没就绪时 `Runtime.evaluate` 会抛 `Uncaught`（元素不存在导致
 * 表达式本身报错）。不吞掉的话整个脚本直接崩，连汇总行都打不出来。
 */
export function makeWaitFor(client, { timeout = 20000, step = 200 } = {}) {
  /**
   * @param {string} expr 返回真值的 JS 表达式
   * @returns {Promise<boolean>} 超时返回 false（**不抛错**，让调用方决定怎么断言）
   */
  return async function waitFor(expr, opts = {}) {
    const deadline = Date.now() + (opts.timeout ?? timeout)
    const every = opts.step ?? step
    while (Date.now() < deadline) {
      try {
        if (await client.eval(expr)) return true
      } catch { /* 页面尚未就绪，继续等 */ }
      await client.sleep(every)
    }
    return false
  }
}

/**
 * 反复点击直到「产生了预期效果」。
 *
 * ## 为什么不能只点一次
 *
 * **元素存在 ≠ 事件已绑定**。控制台的 tab / 按钮都是静态 HTML，
 * 首屏就渲染出来了，但点击处理器要等脚本初始化后才挂上。
 * 这段时间里 `el.click()` 会静默无效 —— 不报错，只是什么也没发生。
 *
 * 实测踩过：`test-secrets` 里 `.tab[data-panel="secrets"]` 明明存在、
 * `#panel-secrets` 也存在，点完 `active` 仍停在 `panel-overview`。
 * 单独跑常常通过、并发跑稳定失败（脚本加载被拖慢，窗口变大）。
 *
 * 固定「点一次 + sleep」是在赌加载速度；这里的判据是
 * **点了有没有效果**，没效果就再点一次。
 *
 * @param {string} clickExpr 触发点击的表达式（通常 `el.click()`）
 * @param {string} doneExpr  判断「已生效」的表达式（返回真值即停止）
 * @returns {Promise<boolean>} 生效返回 true，重试用尽返回 false
 */
export function makeClickUntil(client, { attempts = 40, interval = 400 } = {}) {
  return async function clickUntil(clickExpr, doneExpr, opts = {}) {
    const tries = opts.attempts ?? attempts
    const gap = opts.interval ?? interval
    for (let i = 0; i < tries; i++) {
      try {
        if (await client.eval(doneExpr)) return true
      } catch { /* 尚未就绪 */ }
      try { await client.eval(clickExpr) } catch { /* 元素还没出现 */ }
      await client.sleep(gap)
      try {
        if (await client.eval(doneExpr)) return true
      } catch { /* 尚未就绪 */ }
    }
    return false
  }
}
