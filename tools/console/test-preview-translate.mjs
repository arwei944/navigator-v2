/**
 * N1：搜索框网址预览卡片显示**译文**（`src/services/translateFields.js` + `useOmniBox` 的并卡逻辑）。
 *
 * 任务书对 N1 有三条硬约束，本套件逐条钉住：
 *   ① **译文优先** —— 译出来了就显示译文，并标注来源（卡片上的「译」badge）；
 *   ② **未命中 / 翻译失败回落原文** —— 绝不出现空白标题，也绝不拿原文冒充译文
 *      （`translated.xxx === false` 时调用方必须显示原文）；
 *   ③ **不得阻塞首屏** —— 翻译是异步的、失败静默；`translateFields` 在翻译不可用时
 *      仍**立即**返回可用结构（原文字段齐全），调用方不必等它。
 *
 * 这里用注入的 `fetch` 打桩，不联网、不依赖浏览器翻译 API（`useBrowser: false`）。
 *
 * 运行：node tools/console/test-preview-translate.mjs
 */
import { translateFields } from '../../src/services/translateFields.js'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

const realFetch = globalThis.fetch

/** 把全局 fetch 换成桩，跑完恢复 */
async function withFetch(stub, fn) {
  globalThis.fetch = stub
  try { return await fn() } finally { globalThis.fetch = realFetch }
}

const jsonRes = (body, okFlag = true) => ({
  ok: okFlag,
  status: okFlag ? 200 : 500,
  json: async () => body,
})

/**
 * 复刻 `useOmniBox.previewCardFinal` 的并卡规则：
 * 有译文才覆盖，没有就保持原文。渲染层（OmniResults.vue）只看这个结果。
 */
function mergeCard(card, t) {
  if (!t) return card
  return {
    ...card,
    titleTranslated: t.title || '',
    descTranslated: t.desc || '',
  }
}

/** 渲染层取值：译文优先，否则原文 */
const shownTitle = (c) => c.titleTranslated || c.title
const shownDesc = (c) => c.descTranslated || c.desc

/* ---------------- ① 译文优先 ---------------- */
{
  const r = await withFetch(
    async () => jsonRes({
      name: '示例站点',
      desc: '一个用于演示的站点',
      translated: { name: true, desc: true },
      engines: { name: 'google', desc: 'google' },
    }),
    () => translateFields({ name: 'Example Site', desc: 'A demo site for testing' }, { useBrowser: false }),
  )
  ok(r.translated.name && r.translated.desc, '在线引擎译出后两个字段都标记为已翻译')
  eq(r.name, '示例站点', '返回的 name 是译文')
  eq(r.source, 'server', '来源标记为 server（卡片据此标「译」）')

  const card = mergeCard({ title: 'Example Site', desc: 'A demo site for testing' },
    { title: r.translated.name ? r.name : '', desc: r.translated.desc ? r.desc : '' })
  eq(shownTitle(card), '示例站点', '卡片标题显示译文（译文优先）')
  eq(shownDesc(card), '一个用于演示的站点', '卡片描述显示译文（译文优先）')
  ok(Boolean(card.titleTranslated), '有译文 → 渲染「译」badge')
}

/* ---------------- ② 翻译失败 / 未命中 → 回落原文 ---------------- */
{
  const r = await withFetch(
    async () => { throw new Error('network down') },
    () => translateFields({ name: 'Example Site', desc: 'A demo site for testing' }, { useBrowser: false }),
  )
  ok(!r.translated.name && !r.translated.desc, '整链失败时两个字段都不标记为已翻译')
  eq(r.name, 'Example Site', '失败时 name 回落原文')
  eq(r.desc, 'A demo site for testing', '失败时 desc 回落原文')

  const card = mergeCard({ title: 'Example Site', desc: 'A demo site for testing' },
    { title: r.translated.name ? r.name : '', desc: r.translated.desc ? r.desc : '' })
  eq(shownTitle(card), 'Example Site', '失败时卡片标题显示原文')
  eq(shownDesc(card), 'A demo site for testing', '失败时卡片描述显示原文')
  ok(!card.titleTranslated, '无译文 → 不渲染「译」badge（不拿原文冒充译文）')
}

/* ---------------- ②-b 服务端回显原文 ≠ 译出 ---------------- */
{
  const r = await withFetch(
    async () => jsonRes({
      name: 'Example Site',
      desc: 'A demo site for testing',
      translated: { name: false, desc: false },
    }),
    () => translateFields({ name: 'Example Site', desc: 'A demo site for testing' }, { useBrowser: false }),
  )
  ok(!r.translated.name && !r.translated.desc, '服务端明确说没译（translated=false）时不冒充已译')
  eq(r.name, 'Example Site', 'name 保持原文')
}

/* ---------------- ②-c 部分命中：只覆盖译出的字段 ---------------- */
{
  const r = await withFetch(
    async () => jsonRes({
      name: '示例站点',
      translated: { name: true, desc: false },
    }),
    () => translateFields({ name: 'Example Site', desc: 'A demo site for testing' }, { useBrowser: false }),
  )
  ok(r.translated.name, 'name 译出')
  ok(!r.translated.desc, 'desc 未译出')
  eq(r.desc, 'A demo site for testing', '未译出的 desc 保持原文，不被空值覆盖')

  const card = mergeCard({ title: 'Example Site', desc: 'A demo site for testing' },
    { title: r.name, desc: r.translated.desc ? r.desc : '' })
  eq(shownTitle(card), '示例站点', '部分命中：标题显示译文')
  eq(shownDesc(card), 'A demo site for testing', '部分命中：描述回落原文')
}

/* ---------------- ③ 已是中文：不译、直接可用（不阻塞） ---------------- */
{
  let called = false
  const r = await withFetch(
    async () => { called = true; return jsonRes({}) },
    () => translateFields({ name: '示例站点', desc: '这是一段已经足够长的中文描述' }, { useBrowser: false }),
  )
  ok(!called, '已是中文时根本不发翻译请求（省一次往返，也不拖慢预览）')
  eq(r.name, '示例站点', '中文 name 原样返回')
  eq(r.desc, '这是一段已经足够长的中文描述', '中文 desc 原样返回')
  ok(!r.translated.name && !r.translated.desc, '中文不标记为「已翻译」——否则会误标「译」badge')
}

/* ---------------- ③-b 失败也必须「立即」返回结构（不抛错、不挂起） ---------------- */
{
  const started = Date.now()
  let threw = false
  let r = null
  try {
    r = await withFetch(
      async () => { throw new Error('boom') },
      () => translateFields({ name: 'Example Site', desc: 'A demo site for testing' }, { useBrowser: false }),
    )
  } catch { threw = true }
  ok(!threw, '翻译整链失败不抛错（调用方无需 try/catch，预览卡片照常渲染）')
  ok(r && typeof r.name === 'string' && typeof r.desc === 'string', '失败时仍返回带原文字段的完整结构')
  ok(Date.now() - started < 3000, '失败路径迅速返回，不挂起首屏')
}

/* ---------------- ③-c 空输入不崩 ---------------- */
{
  const r = await withFetch(async () => jsonRes({}), () => translateFields({}, { useBrowser: false }))
  eq(r.name, '', '空 name 返回空串而非 undefined')
  eq(r.desc, '', '空 desc 返回空串而非 undefined')
  const r2 = await withFetch(async () => jsonRes({}), () => translateFields(undefined, { useBrowser: false }))
  eq(r2.name, '', '完全无参也不崩')
}

/* ---------------- 报告 ---------------- */
console.log(`\nN1 预览译文用例：${pass} 通过，${failures.length} 失败`)
if (failures.length) {
  for (const f of failures) console.log('  ✗ ' + f)
  process.exit(1)
}
console.log('  ✓ 全部通过')
