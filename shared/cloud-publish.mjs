/**
 * 云端发布模式：手动 / 实时（纯函数，无浏览器依赖）。
 *
 * ## 为什么要有两种模式
 *
 * 站点改动先落本机覆盖层，再写云端。默认「手动」是安全选择：
 * 一次误删/误改不会立刻影响所有设备，可以先在本地确认再发布。
 *
 * 但某些使用方式（单人维护、边改边看）希望改完就生效。实时模式把这件事
 * 变成可选项，而不是替用户做决定。
 *
 * ## 实时模式的边界（必须由调用方保证）
 *
 * - 只在**已登录后台**（存在管理凭据）时运行；
 * - 只在**存在本地改动**时触发；
 * - 防抖后串行发布，失败保留覆盖层、不自动重试覆盖别人的写入；
 * - 发布仍走 `POST /api/sites`（CAS + 写前快照 + 结构校验），不是新通道。
 */
export const PUBLISH_MODE = {
  MANUAL: 'manual',
  REALTIME: 'realtime',
}

export const PUBLISH_MODE_LABEL = {
  [PUBLISH_MODE.MANUAL]: '手动发布',
  [PUBLISH_MODE.REALTIME]: '实时发布',
}

/** 任何无法识别的值都回到手动 —— 安全默认 */
export function parsePublishMode(raw) {
  return raw === PUBLISH_MODE.REALTIME ? PUBLISH_MODE.REALTIME : PUBLISH_MODE.MANUAL
}

/**
 * 是否应该触发一次自动发布。
 * @param {{mode:string, hasKey:boolean, hasChanges:boolean, busy?:boolean}} input
 */
export function shouldAutoPublish({ mode, hasKey, hasChanges, busy = false } = {}) {
  if (busy) return { ok: false, reason: 'busy' }
  if (parsePublishMode(mode) !== PUBLISH_MODE.REALTIME) return { ok: false, reason: 'manual' }
  if (!hasKey) return { ok: false, reason: 'no-key' }
  if (!hasChanges) return { ok: false, reason: 'no-changes' }
  return { ok: true, reason: '' }
}

/** 发布结果的一句话摘要（面板与审计共用） */
export function publishSummary({ version, sites, mode } = {}) {
  const label = parsePublishMode(mode) === PUBLISH_MODE.REALTIME ? '实时发布' : '手动发布'
  return `${label} · v${Number(version) || 0} · ${Number(sites) || 0} 站点`
}