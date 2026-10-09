/** 把 api/sites.js 里的 `@vercel/blob` 解析到打桩实现 */
export function resolve(specifier, context, next) {
  if (specifier === '@vercel/blob') {
    return { url: new URL('./_blob-stub.mjs', import.meta.url).href, shortCircuit: true }
  }
  return next(specifier, context)
}
