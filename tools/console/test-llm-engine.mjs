#!/usr/bin/env node
/**
 * LLM 后端注册表（热拔插）自测：不联网（端到端跑本地假 OpenAI 服务）。
 *
 * 覆盖：
 *   ① 注册校验（缺 id / 缺 chat 抛错）
 *   ② llmChain 的配置优先级与容错（换序 / 裁剪 / 全不匹配回退 / none / gateway 条件出现）
 *   ③ chatWithChain 的语义：首个非空即停、失败换下一个、**全链失败必须抛**（与翻译链的关键差别）
 *   ④ 端到端：真发 POST 到本地 OpenAI 兼容服务（URL / 鉴权头 / 模型名 / 消息数都验）
 *   ⑤ 配置优先级：opts.config 覆盖环境变量
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { registerLlm, listLlms, llmChain, chatWithChain } from '../../shared/llm-engine.mjs'

let pass = 0
let fail = 0
function check(name, fn) {
  try { fn(); console.log('  ✓ ' + name); pass += 1 } catch (e) { console.log('  ✖ ' + name + ' — ' + e.message); fail += 1 }
}
async function checkAsync(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); pass += 1 } catch (e) { console.log('  ✖ ' + name + ' — ' + e.message); fail += 1 }
}

const fake = (id, fn) => ({ id, chat: fn })

/** 起一个 OpenAI 兼容的假服务 */
async function withOpenAI(handler, run) {
  const server = http.createServer(handler)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  try {
    return await run(`http://127.0.0.1:${server.address().port}`)
  } finally {
    if (server.closeAllConnections) server.closeAllConnections()
    await new Promise(r => server.close(r))
  }
}

async function main() {
  console.log('\n注册表校验')
  check('缺 id 抛错', () => { assert.throws(() => registerLlm({ chat: async () => 'x' })) })
  check('缺 chat 抛错', () => { assert.throws(() => registerLlm({ id: 'x-nochat' })) })

  console.log('\n后端链配置（llmChain）')
  check('默认只有 openai（gateway 未配置时不出现）', () => {
    const old = process.env.LLM_GATEWAY_ENDPOINT
    delete process.env.LLM_GATEWAY_ENDPOINT
    assert.deepEqual(llmChain('').map(b => b.id), ['openai'])
    process.env.LLM_GATEWAY_ENDPOINT = 'http://127.0.0.1:3003'
    assert.deepEqual(llmChain('').map(b => b.id), ['openai', 'gateway'])
    if (old === undefined) delete process.env.LLM_GATEWAY_ENDPOINT; else process.env.LLM_GATEWAY_ENDPOINT = old
  })
  check('换序生效', () => {
    const old = process.env.LLM_GATEWAY_ENDPOINT
    process.env.LLM_GATEWAY_ENDPOINT = 'http://127.0.0.1:3003'
    assert.deepEqual(llmChain('gateway,openai').map(b => b.id), ['gateway', 'openai'])
    if (old === undefined) delete process.env.LLM_GATEWAY_ENDPOINT; else process.env.LLM_GATEWAY_ENDPOINT = old
  })
  check('裁剪 / none 清空 / 全不匹配回退全量', () => {
    assert.deepEqual(llmChain('openai').map(b => b.id), ['openai'])
    assert.deepEqual(llmChain('none'), [])
    assert.ok(llmChain('a,b').some(b => b.id === 'openai'))
  })

  console.log('\n对话链语义（chatWithChain）')
  await checkAsync('首个非空结果即停', async () => {
    let second = 0
    const out = await chatWithChain([{ role: 'user', content: 'x' }], {
      chain: [
        fake('a', async () => '第一个'),
        fake('b', async () => { second += 1; return '第二个' }),
      ],
    })
    assert.equal(out.text, '第一个')
    assert.equal(out.backend, 'a')
    assert.equal(second, 0)
  })
  await checkAsync('后端抛错 → 换下一个', async () => {
    const out = await chatWithChain([{ role: 'user', content: 'x' }], {
      chain: [fake('boom', async () => { throw new Error('x') }), fake('ok', async () => '好的')],
    })
    assert.equal(out.backend, 'ok')
  })
  await checkAsync('后端回空 → 视为失败，换下一个', async () => {
    const out = await chatWithChain([{ role: 'user', content: 'x' }], {
      chain: [fake('empty', async () => ''), fake('ok', async () => '好的')],
    })
    assert.equal(out.backend, 'ok')
  })
  await checkAsync('**全链失败必须抛错**（AI 失败不可像翻译那样静默降级）', async () => {
    await assert.rejects(
      () => chatWithChain([{ role: 'user', content: 'x' }], {
        chain: [fake('a', async () => { throw new Error('第一个挂了') })],
      }),
      /第一个挂了/,
    )
  })
  await checkAsync('空链 → 返回空文本（调用方自己判）', async () => {
    const out = await chatWithChain([{ role: 'user', content: 'x' }], { chain: [] })
    assert.deepEqual(out, { text: '', backend: '' })
  })

  console.log('\n端到端（本地假 OpenAI 服务，真实 POST）')
  await checkAsync('发对 URL / 鉴权头 / 模型名 / 消息数，并 trim 结果', async () => {
    const seen = {}
    const out = await withOpenAI(async (req, res) => {
      seen.url = req.url
      seen.auth = req.headers.authorization
      let body = ''
      for await (const c of req) body += c
      const j = JSON.parse(body)
      seen.model = j.model
      seen.msgCount = (j.messages || []).length
      seen.hasMaxTokens = Object.prototype.hasOwnProperty.call(j, 'max_tokens')
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: '  润色后的名字  ' } }] }))
    }, (base) => chatWithChain([{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], {
      chain: llmChain('openai'),
      config: { baseURL: base, apiKey: 'k1', model: 'm1' },
      maxTokens: 300,
    }))

    assert.equal(out.text, '润色后的名字', '结果应被 trim')
    assert.equal(out.backend, 'openai')
    assert.equal(seen.url, '/chat/completions')
    assert.equal(seen.auth, 'Bearer k1')
    assert.equal(seen.model, 'm1')
    assert.equal(seen.msgCount, 2)
    assert.equal(seen.hasMaxTokens, true)
  })
  await checkAsync('上游 500 → 抛错且带 upstream 码', async () => {
    await withOpenAI(async (req, res) => {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end('boom')
    }, async (base) => {
      await assert.rejects(
        () => chatWithChain([{ role: 'user', content: 'x' }], {
          chain: llmChain('openai'),
          config: { baseURL: base, apiKey: 'k', model: 'm' },
        }),
        (e) => e.upstream === 500 && /上游返回 500/.test(e.message),
      )
    })
  })
  await checkAsync('备后端接管：主后端 500，链上第二个成功', async () => {
    const out = await withOpenAI(async (req, res) => {
      res.writeHead(500); res.end('nope')
    }, async (base) => chatWithChain([{ role: 'user', content: 'x' }], {
      chain: [
        fake('bad', async () => { const e = new Error('上游返回 500'); e.upstream = 500; throw e }),
        fake('good', async () => '兜底结果'),
      ],
      config: { baseURL: base },
    }))
    assert.equal(out.text, '兜底结果')
    assert.equal(out.backend, 'good')
  })

  console.log('\n配置优先级')
  await checkAsync('opts.config 覆盖环境变量', async () => {
    const old = process.env.AI_BASE_URL
    process.env.AI_BASE_URL = 'http://127.0.0.1:1'   // 必然连不上的环境变量
    try {
      const out = await withOpenAI(async (req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content: '来自 config' } }] }))
      }, (base) => chatWithChain([{ role: 'user', content: 'x' }], {
        chain: llmChain('openai'),
        config: { baseURL: base, apiKey: 'k', model: 'm' },   // 显式 config 应赢过 env
      }))
      assert.equal(out.text, '来自 config')
    } finally {
      if (old === undefined) delete process.env.AI_BASE_URL; else process.env.AI_BASE_URL = old
    }
  })

  console.log('\n清单')
  check('listLlms 至少含 openai', () => {
    assert.ok(listLlms({ check: false }).some(b => b.id === 'openai'))
  })

  console.log(`\nllm-engine 自测：${pass} 通过 / ${fail} 失败`)
  process.exitCode = fail ? 1 : 0
}

main()
