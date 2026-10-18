/**
 * 断点档位真值 —— 全项目响应式断点的唯一登记处。
 *
 * 为什么不用 CSS 变量：媒体查询条件里不能用 var()（CSS 自定义属性在
 * @media 中无效），所以断点无法像颜色那样令牌化。统一方式是两条腿：
 * 1. JS 侧：从这里 import 常量 / helper，不在组件里写死数字；
 * 2. CSS 侧：@media 的值必须在 LOCKED_VALUES 内（test-visual-layer 门禁
 *    守卫）——新增断点必须先在本文件登记，防止继续漂移。
 *
 * 值 = 现有代码在用的值（纯登记，不改视觉）。
 */

/** 档位清单：value 在用值；name 语义名；used 归属说明。 */
export const BREAKPOINTS = [
  { value: 520, name: 'xs', used: 'AdminLogin 窄屏表单' },
  { value: 560, name: 'sm', used: 'AboutView 窄屏排版' },
  { value: 768, name: 'md', used: '主断点：移动端切换（全局 20+ 处）' },
  { value: 820, name: 'md-alt', used: 'AdminView 双栏折叠' },
  { value: 900, name: 'lg', used: '后台三栏折叠（AdminInsights / InsightsView 等）' },
  { value: 1024, name: 'xl', used: '右栏折叠 + MainToolbar 换挡' },
  { value: 1300, name: 'tb-1', used: 'MainToolbar 间距微调' },
  { value: 1360, name: 'tb-2', used: 'MainToolbar 间距微调' },
  { value: 1500, name: 'tb-3', used: 'MainToolbar 间距微调' },
]

/**
 * 互补表达：min-width: 769px ≡ 非移动端（与 max-width: 768px 同一档）。
 * 写成两个整数是刻意的（避免亚像素边界），登记在此防止被当成新断点。
 */
export const COMPLEMENTS = { 769: 768 }

/** 门禁允许的全部断点值（档位 + 互补）。 */
export const LOCKED_VALUES = new Set([
  ...BREAKPOINTS.map((b) => b.value),
  ...Object.keys(COMPLEMENTS).map(Number),
])

const bp = Object.fromEntries(BREAKPOINTS.map((b) => [b.name, b.value]))

/** 主断点查询串：移动端切换（≤768px）。 */
export const MOBILE_QUERY = `(max-width: ${bp.md}px)`
/** 右栏折叠查询串：≤1024px。 */
export const NARROW_QUERY = `(max-width: ${bp.xl}px)`

/** 安全读取 matchMedia（SSR / 老环境兜底）。 */
export function safeMatchMedia(query) {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(query).matches
}

/** 是否处于移动端宽度（≤768px）。innerWidth 与 matchMedia 语义一致取 ≤。 */
export function isMobileWidth() {
  return typeof window !== 'undefined' && window.innerWidth <= bp.md
}
