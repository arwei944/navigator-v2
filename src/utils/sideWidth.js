/**
 * 侧栏宽度的取值范围与钳制。
 *
 * 抽成纯函数的原因：这是「能拖多窄、能拖多宽」的唯一判据，
 * 两侧栏（左导航 / 右信息栏）共用一套，免得改了一处忘了另一处。
 *
 * 下限 60 不是随便定的：那是**图标的物理下限**（导航项 44px + 左右各 8px 内边距），
 * 再窄就摆不下图标，只剩一条没有可点内容的空栏 —— 那不叫自由，叫把入口藏了。
 * 上限 520 是「再宽也不会有更多信息」的位置：侧栏里最长的是站点名，520 已能整行放下。
 */
export const MIN_SIDE_W = 60
export const MAX_SIDE_W = 520
export const DEFAULT_SIDE_WIDTH = 240

/**
 * 钳制到合法范围；非数字回落到默认宽度。
 *
 * 空值（null / undefined / ''）**特意不按 0 处理**：Number(null) 是 0，
 * 会一路钳到下限，于是「持久化数据坏了」的表现是**侧栏悄悄塌成图标栏** ——
 * 用户会以为是布局坏了。回落默认宽度才对：坏数据只是一个没生效的宽度。
 */
export function clampSideWidth(val, fallback = DEFAULT_SIDE_WIDTH) {
  if (val === null || val === undefined || val === '') return fallback
  const n = Number(val)
  if (!Number.isFinite(n)) return fallback
  return Math.max(MIN_SIDE_W, Math.min(MAX_SIDE_W, Math.round(n)))
}

/** 宽度是否已经窄到只该显示图标 */
export const ICON_ONLY_W = 110
export function isIconOnlyWidth(w) {
  return clampSideWidth(w) <= ICON_ONLY_W
}

/**
 * 后台「动作栏」（中间区左侧那一列）自己的宽度契约。
 * 与主站侧栏分开：它更窄（放的是动作名，不是站点名），
 * 下限贴着图标宽度，上限到动作名 + 状态数字能一行放下为止。
 */
export const RAIL_MIN_W = 56
export const RAIL_MAX_W = 340
export const DEFAULT_RAIL_W = 224

export function clampRailWidth(val, fallback = DEFAULT_RAIL_W) {
  if (val === null || val === undefined || val === '') return fallback
  const n = Number(val)
  if (!Number.isFinite(n)) return fallback
  return Math.max(RAIL_MIN_W, Math.min(RAIL_MAX_W, Math.round(n)))
}
