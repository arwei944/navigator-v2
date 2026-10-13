#!/usr/bin/env node
/**
 * 翻译引擎（热拔插）自测：不联网，全部用注入的假 fetchText。
 *
 * 覆盖：
 *   ① 默认链顺序 = [mymemory, google]（与既有实测定序一致，绝不能被插件化改变）
 *   ② 显式链换序 / 裁剪 / 未注册 id 忽略 / 全不匹配回退 / none 显式禁用
 *   ③ LLM 引擎条件注册：未配 endpoint 不出现；配置后排链尾
 *   ④ LLM 契约：buildUrl 去尾斜杠拼 /chat/completions；init 生成合法 POST；parse 剥引号
 *   ⑤ 跑链行为：首引擎失败下一个接住、回显原文视为未译、全失败返回空串
 *   ⑥ translateToZh 冒烟（默认链经注册表）与 from 透传
 *   ⑦ registerTranslator 校验（缺 id / 缺 buildUrl 抛错；同 id 覆盖）
 *
 * 注意：引擎**实体**（含 buildUrl/parse/init）要从 translatorChain() 取；
 * listTranslators() 返回的是投影（id/label/order/kind/available），没有方法。
 */
import assert from 'node:assert/strict'
import {
  registerTranslator, listTranslators, translatorChain, translateWithChain,
} from '../../shared/translate-engine.mjs'
import { translateToZh } from '../../shared/translate.mjs'

let pass = 0
let fail = 0
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass += 1 } catch (e) { console.log('  ✖ ' + name + ' — ' + e.message); fail += 1 }
}
async function checkAsync(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); pass += 1 } catch (e) { console.log('  ✖ ' + name + ' — ' + e.message); fail += 1 }
}
const ids = (chain) => chain.map(e => e.id)

// process.env.X = undefined 会存成字符串 'undefined'（Node 的行为），恢复时必须 delete
function restoreEnv(key, val) {
  if (val === undefined) delete process.env[key]
  else process.env[key] = val
}

async function main() {
  console.log('\n默认链（顺序是线上实测定的，插件化不得改变）')
  check('默认链 = [mymemory, google]', () => {
    const old = process.env.NAV_TRANSLATE_ENGINES
    const oldLlm = process.env.TRANSLATE_LLM_ENDPOINT
    delete process.env.NAV_TRANSLATE_ENGINES
    delete process.env.TRANSLATE_LLM_ENDPOINT
    assert.deepEqual(ids(translatorChain()), ['mymemory', 'google'])
    restoreEnv('NAV_TRANSLATE_ENGINES', old)
    restoreEnv('TRANSLATE_LLM_ENDPOINT', oldLlm)
  })

  console.log('\n显式链：换序 / 裁剪 / 容错')
  check('显式参数可换序', () => {
    assert.deepEqual(ids(translatorChain('google,mymemory')), ['google', 'mymemory'])
  })
  check('显式裁剪到单个', () => {
    assert.deepEqual(ids(translatorChain('google')), ['google'])
  })
  check('部分未注册 id 被忽略，其余照用', () => {
    assert.deepEqual(ids(translatorChain('google,wat,mymemory')), ['google', 'mymemory'])
  })
  check('全部不匹配 → 回退全量（配置写错不静默失效）', () => {
    assert.deepEqual(ids(translatorChain('wat,whatever')), ['mymemory', 'google'])
  })
  check('none/off/0 → 显式清空链', () => {
    assert.deepEqual(ids(translatorChain('none')), [])
    assert.deepEqual(ids(translatorChain('off')), [])
    assert.deepEqual(ids(translatorChain('0')), [])
  })
  check('空/null 显式值回落注册顺序', () => {
    const old = process.env.NAV_TRANSLATE_ENGINES
    delete process.env.NAV_TRANSLATE_ENGINES
    assert.deepEqual(ids(translatorChain(null)), ['mymemory', 'google'])
    assert.deepEqual(ids(translatorChain('')), ['mymemory', 'google'])
    restoreEnv('NAV_TRANSLATE_ENGINES', old)
  })

  console.log('\nLLM 引擎条件注册')
  check('未配 endpoint 时不进链，且清单里 available=false', () => {
    const old = process.env.TRANSLATE_LLM_ENDPOINT
    delete process.env.TRANSLATE_LLM_ENDPOINT
    assert.deepEqual(ids(translatorChain()), ['mymemory', 'google'])
    assert.equal(listTranslators().find(e => e.id === 'llm').available, false, 'llm 应已注册但不可用')
    restoreEnv('TRANSLATE_LLM_ENDPOINT', old)
  })
  check('配置后 llm 排在链尾', () => {
    const old = process.env.TRANSLATE_LLM_ENDPOINT
    process.env.TRANSLATE_LLM_ENDPOINT = 'http://127.0.0.1:3003'
    assert.deepEqual(ids(translatorChain()), ['mymemory', 'google', 'llm'])
    restoreEnv('TRANSLATE_LLM_ENDPOINT', old)
  })

  console.log('\nLLM 引擎契约')
  /** 在「已配置」环境下取 llm 实体，跑完恢复 */
  const withLlm = (fn) => {
    const oldE = process.env.TRANSLATE_LLM_ENDPOINT
    const oldM = process.env.TRANSLATE_LLM_MODEL
    try {
      process.env.TRANSLATE_LLM_ENDPOINT = 'http://127.0.0.1:3003/'
      fn()
    } finally {
      restoreEnv('TRANSLATE_LLM_ENDPOINT', oldE)
      restoreEnv('TRANSLATE_LLM_MODEL', oldM)
    }
  }
  check('buildUrl 拼接 /chat/completions 且去掉尾斜杠', () => withLlm(() => {
    const llm = translatorChain('llm')[0]
    assert.ok(llm, 'llm 引擎应可用')
    assert.equal(llm.buildUrl('hi', {}), 'http://127.0.0.1:3003/chat/completions')
  }))
  check('init 生成合法 POST（model/temperature/messages）', () => withLlm(() => {
    process.env.TRANSLATE_LLM_MODEL = 'qwen3.8-flash'
    const llm = translatorChain('llm')[0]
    const init = llm.init('Hello', {})
    assert.equal(init.method, 'POST')
    assert.equal(init.headers['content-type'], 'application/json')
    const body = JSON.parse(init.body)
    assert.equal(body.model, 'qwen3.8-flash')
    assert.equal(body.temperature, 0)
    assert.equal(body.messages[1].content, 'Hello')
  }))
  check('parse 解析 OpenAI 响应并剥离包裹引号', () => withLlm(() => {
    const llm = translatorChain('llm')[0]
    assert.equal(llm.parse('{"choices":[{"message":{"content":"\\"免费在线工具\\""}}]}'), '免费在线工具')
    assert.equal(llm.parse('garbage'), '')
    assert.equal(llm.parse('{"choices":[]}'), '')
  }))

  console.log('\n跑链行为（假 fetchText，不出网）')
  await checkAsync('首个引擎失败 → 下一个接住', async () => {
    const fetchText = async (url) => {
      if (url.includes('mymemory')) throw new Error('配额耗尽')
      return '[[["免费工具","Best tools"]]]'
    }
    const r = await translateWithChain('Best tools', { fetchText, chain: translatorChain('mymemory,google') })
    assert.equal(r.engine, 'google')
    assert.equal(r.text, '免费工具')
  })
  await checkAsync('回显原文视为未翻译，继续下一个', async () => {
    const fetchText = async (url) => (url.includes('mymemory')
      ? '{"responseData":{"translatedText":"Best tools"}}'
      : '[[["中文结果"]]]')
    const r = await translateWithChain('Best tools', { fetchText, chain: translatorChain('mymemory,google') })
    assert.equal(r.engine, 'google')
    assert.equal(r.text, '中文结果')
  })
  await checkAsync('全部失败返回空串（不抛）', async () => {
    const r = await translateWithChain('Hello', { fetchText: async () => { throw new Error('down') } })
    assert.deepEqual(r, { text: '', engine: '' })
  })
  await checkAsync('fetchText 非函数 / 空文本安全返回空', async () => {
    assert.deepEqual(await translateWithChain('Hi', { fetchText: 'not-a-fn' }), { text: '', engine: '' })
    assert.deepEqual(await translateWithChain('', { fetchText: async () => 'x' }), { text: '', engine: '' })
  })
  await checkAsync('链为空时安全返回空串（none 禁用后）', async () => {
    const r = await translateWithChain('Hello', { fetchText: async () => 'x', chain: translatorChain('none') })
    assert.deepEqual(r, { text: '', engine: '' })
  })
  await checkAsync('LLM 引擎经链真实 POST（假 fetchText 记录 init）', async () => {
    const old = process.env.TRANSLATE_LLM_ENDPOINT
    process.env.TRANSLATE_LLM_ENDPOINT = 'http://llm.local'
    const seen = {}
    const fetchText = async (url, init) => {
      if (!url.includes('llm.local')) throw new Error('down')
      seen.url = url
      seen.init = init
      return '{"choices":[{"message":{"content":"\\"翻译好的\\""}}]}'
    }
    const r = await translateWithChain('Hello', { fetchText, chain: translatorChain('mymemory,google,llm') })
    assert.equal(r.engine, 'llm')
    assert.equal(r.text, '翻译好的')
    assert.equal(seen.init.method, 'POST')
    assert.equal(seen.url, 'http://llm.local/chat/completions')
    restoreEnv('TRANSLATE_LLM_ENDPOINT', old)
  })

  console.log('\ntranslateToZh 冒烟（默认链经注册表）')
  await checkAsync('MyMemory 成功即返回，engine=mymemory', async () => {
    const fetchText = async (url) => {
      if (url.includes('mymemory')) return '{"responseData":{"translatedText":"免费在线工具"}}'
      throw new Error('google down')
    }
    const r = await translateToZh('Best free online tools', { fetchText })
    assert.equal(r.engine, 'mymemory')
    assert.equal(r.text, '免费在线工具')
  })
  await checkAsync('from 参数透传到引擎（langpair）', async () => {
    let seenUrl = ''
    const fetchText = async (url) => { seenUrl = url; return '{"responseData":{"translatedText":"结果"}}' }
    await translateToZh('Bonjour Monde', { fetchText, from: 'fr' })
    assert.ok(seenUrl.includes('langpair=fr%7Czh-CN'), `期望 langpair=fr%7Czh-CN，实得 ${seenUrl}`)
  })

  console.log('\n注册表校验（放最后：注册的测试引擎会留在注册表里）')
  check('缺 id / 缺 buildUrl 抛错', () => {
    assert.throws(() => registerTranslator({}))
    assert.throws(() => registerTranslator({ id: 'x' }))
  })
  check('同 id 覆盖（热替换语义）', () => {
    registerTranslator({ id: 'test-dup', buildUrl: () => 'a', parse: () => 'A' })
    registerTranslator({ id: 'test-dup', buildUrl: () => 'b', parse: () => 'B' })
    const c = translatorChain('test-dup')
    assert.deepEqual(ids(c), ['test-dup'])
    assert.equal(c[0].parse(''), 'B')
    assert.equal(c[0].buildUrl('t', {}), 'b')
  })

  console.log(`\ntranslate-engine 自测：${pass} 通过 / ${fail} 失败`)
  process.exit(fail ? 1 : 0)
}

main()
