/**
 * 产品版本号递增（纯函数）。
 *
 * 版本号由发布脚本在**构建之前**递增，这样 vite 注入的 `__APP_VERSION__`
 * 与页面侧栏显示的是同一个值。做事后修正没有意义 —— 产物里的常量已经烘进去了。
 *
 * 只接受严格的三段 semver（可带 `-pre` / `+build` 后缀）；无法识别时返回 null，
 * 由调用方决定回退或报错，绝不悄悄拼出一个看起来合理的版本号。
 */
export function parseVersion(raw) {
  const m = String(raw || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

/**
 * @param {string} raw 当前版本
 * @param {'patch'|'minor'|'major'} part
 * @returns {string|null} 新版本；无法解析返回 null
 */
export function bumpVersion(raw, part = 'patch') {
  const v = parseVersion(raw)
  if (!v) return null
  if (part === 'major') return `${v.major + 1}.0.0`
  if (part === 'minor') return `${v.major}.${v.minor + 1}.0`
  return `${v.major}.${v.minor}.${v.patch + 1}`
}