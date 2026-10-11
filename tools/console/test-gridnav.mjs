/**
 * src/utils/gridnav.js 用例：零依赖、不联网、纯函数穷举。
 *
 * 的价值在「摘掉实现即失败」：网格导航的边界（行末、末行、越界、焦点不在网格内）
 * 靠手点很难覆盖全，但它是纯函数，可以穷举 n × cols × 按键 断言结果永远合法。
 * 运行：node tools/console/test-gridnav.mjs
 */
import { nextIndex, NAV_KEYS, columnsFromStyle } from '../../src/utils/gridnav.js'

let pass = 0
const failures = []

function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}

/* ---------------- 非导航键 / 空列表 ---------------- */

eq(nextIndex(0, 'a', { cols: 3, total: 9 }), -1, '普通字符键不由网格处理')
eq(nextIndex(0, 'Enter', { cols: 3, total: 9 }), -1, '回车不由网格处理（卡片自己开站点）')
eq(nextIndex(0, 'Tab', { cols: 3, total: 9 }), -1, 'Tab 不由网格接管（否则没法跳出网格）')
eq(nextIndex(0, 'Escape', { cols: 3, total: 9 }), -1, 'Esc 不由网格处理')
eq(nextIndex(0, 'ArrowRight', { cols: 3, total: 0 }), -1, '空列表一律不处理')
eq(nextIndex(0, 'ArrowRight', { cols: 3 }), -1, '没给 total 视作空列表')

/* ---------------- 焦点不在网格内 ---------------- */

eq(nextIndex(-1, 'ArrowRight', { cols: 3, total: 9 }), 0, '初次按下（焦点不在网格内）从第一张开始')
eq(nextIndex(-1, 'ArrowDown', { cols: 3, total: 9 }), 0, '初次按下按 ↓ 也从第一张开始')
eq(nextIndex(-1, 'End', { cols: 3, total: 9 }), 8, '初次按下按 End 去最后一张')
eq(nextIndex(99, 'ArrowRight', { cols: 3, total: 9 }), 0, '下标越界后回到第一张（列表变短的场景）')
eq(nextIndex(undefined, 'ArrowRight', { cols: 3, total: 9 }), 0, 'undefined 也按「不在网格内」处理')

/* ---------------- 左右：不换行 ---------------- */

eq(nextIndex(0, 'ArrowRight', { cols: 3, total: 9 }), 1, '行内右移一格')
eq(nextIndex(1, 'ArrowRight', { cols: 3, total: 9 }), 2, '右移到行末')
eq(nextIndex(2, 'ArrowRight', { cols: 3, total: 9 }), 2, '行末右移停住，不跳下一行')
eq(nextIndex(1, 'ArrowLeft', { cols: 3, total: 9 }), 0, '行内左移一格')
eq(nextIndex(3, 'ArrowLeft', { cols: 3, total: 9 }), 3, '行首左移停住，不跳上一行')
eq(nextIndex(0, 'ArrowLeft', { cols: 3, total: 9 }), 0, '第一张左移停住')

/* ---------------- 上下 ---------------- */

eq(nextIndex(0, 'ArrowDown', { cols: 3, total: 9 }), 3, '下移一整行')
eq(nextIndex(1, 'ArrowDown', { cols: 3, total: 9 }), 4, '下移保持列')
eq(nextIndex(3, 'ArrowUp', { cols: 3, total: 9 }), 0, '上移一整行')
eq(nextIndex(1, 'ArrowUp', { cols: 3, total: 9 }), 1, '第一行上移停住')
eq(nextIndex(7, 'ArrowDown', { cols: 3, total: 9 }), 7, '已在末行，下移不动')

// 末行不完整：倒数第二行按 ↓ 落到最后一张（否则「差一张却怎么也去不了」）
eq(nextIndex(4, 'ArrowDown', { cols: 3, total: 8 }), 7, '末行不满时下移跳到最后一张')
eq(nextIndex(5, 'ArrowDown', { cols: 3, total: 8 }), 7, '末行不满时下移跳到最后一张（末行前一位）')
eq(nextIndex(6, 'ArrowDown', { cols: 3, total: 8 }), 6, '已经在末行则不动')

/* ---------------- Home / End ---------------- */

eq(nextIndex(5, 'Home', { cols: 3, total: 9 }), 0, 'Home 到整列第一张')
eq(nextIndex(5, 'End', { cols: 3, total: 9 }), 8, 'End 到整列最后一张')

/* ---------------- cols = 1：线性退化 ---------------- */

eq(nextIndex(2, 'ArrowDown', { cols: 1, total: 9 }), 3, '单列时下移就是下一个')
eq(nextIndex(2, 'ArrowUp', { cols: 1, total: 9 }), 1, '单列时上移就是上一个')
eq(nextIndex(2, 'ArrowRight', { cols: 1, total: 9 }), 2, '单列时右移不动（每行只有一张）')

/* ---------------- 天然不变量：穷举 ---------------- */

const KEYS = [...NAV_KEYS]
let checked = 0
for (let total = 1; total <= 12; total += 1) {
  for (let cols = 1; cols <= 5; cols += 1) {
    for (let i = 0; i < total; i += 1) {
      for (const key of KEYS) {
        const out = nextIndex(i, key, { cols, total })
        if (out < 0 || out >= total) {
          failures.push(`越界：total=${total} cols=${cols} i=${i} key=${key} → ${out}`)
        } else {
          checked += 1
        }
      }
    }
  }
}
// 越界已直接记进 failures；这里只确认穷举真的跑了，而不是循环写错变成 0 次
const expectChecked = ((12 * 13) / 2) * 5 * KEYS.length
eq(checked, expectChecked, '穷举组合数与预期一致（循环没写歪）')

/* ---------------- columnsFromStyle ---------------- */

eq(columnsFromStyle('260px 260px 260px'), 3, '三列固定宽度')
eq(columnsFromStyle('260px 260px 260px 260px'), 4, '四列')
eq(columnsFromStyle('260px'), 1, '单列')
eq(columnsFromStyle('none'), 1, '未设网格线时退化为 1（瀑布流走这条路）')
eq(columnsFromStyle(''), 1, '空串退化为 1')
eq(columnsFromStyle(null), 1, 'null 退化为 1')
eq(columnsFromStyle('  260px   260px  '), 2, '多余空白不影响列数统计（浏览器计算值里常见）')

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ ${failures.length} 条断言失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 网格导航全部通过：${pass} 条断言（另穷举 ${checked} 组导航不越界）\n`)
