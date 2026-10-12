/**
 * 浏览器本地翻译（L2，`src/services/browserTranslate.js`）用例：零依赖、不联网。
 *
 * L2 是「实时免费」的天花板：完全本地的神经翻译，语言包下过一次就不再联网。
 * 但它也是一个**极其脆弱的**外部依赖 —— 三种环境差异都会让天真的实现在添加站点时卡住：
 *
 *   ① 浏览器**没有**这个 API（Safari / Firefox / 非安全上下文）→ 必须干净降级；
 *   ② 有 API 但语言包**要下载**几十 MB → 绝不能把用户晾在界面上；
 *   ③ 有 API 但 `create()` **挂起不返回**（无头浏览器实测就是这样）→ 必须有超时兜底。
 *
 * 本套件把这三条连同「不抛错、不返回原文冒充译文、语言码归一」一起钉住。
 * 这里全部用 `globalThis` 打桩，不需要真浏览器。
 *
 * 运行：node tools/console/test-browser-translate.mjs
 */
import {
  translatorSupport, translatorState, warmUpTranslator, translateText,
  detectLanguage, __resetTranslatorForTest,
} from '../../src/services/browserTranslate.js'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

const realTranslator = globalThis.Translator
const realTranslation = globalThis.translation
const realDetector = globalThis.LanguageDetector

function clearApis() {
  delete globalThis.Translator
  delete globalThis.translation
  delete globalThis.LanguageDetector
  __resetTranslatorForTest()
}

/** 造一个新版 `Translator` 打桩；`behavior` 决定 create() 怎么表现 */
function stubTranslator({ behavior = 'ok', output = '中文译文', onArgs } = {}) {
  delete globalThis.translation
  globalThis.Translator = {
    availability: async () => (behavior === 'unsupported' ? 'unavailable' : 'downloadable'),
    create: async (args) => {
      if (typeof onArgs === 'function') onArgs(args)
      if (behavior === 'reject') throw new Error('Unable to create translator for the given source and target language.')
      if (behavior === 'hang') return new Promise(() => {})   // 永不 resolve（无头环境实测行为）
      if (behavior === 'slow') await new Promise(r => setTimeout(r, 80))
      return {
        translate: async (t) => {
          if (behavior === 'echo') return t                // 原样返回，等于没译
          if (behavior === 'throw') throw new Error('translate failed')
          return output
        },
      }
    },
  }
  __resetTranslatorForTest()
}

try {
  /* ══════════ 1. 没有 API：干净降级，不抛错 ══════════ */
  {
    clearApis()
    eq(translatorSupport(), 'none', '无 API 时 support = none')
    eq(await warmUpTranslator(), false, '无 API 时预热返回 false')
    eq(await translateText('The best free online tools'), '', '★ 无 API 时返回空串（不是原文）')
    eq(translatorState().status, 'unavailable', 'status = unavailable')
    eq(await detectLanguage('hello'), '', '无检测器时返回空串')
  }

  /* ══════════ 2. 新版 API 正常可用 ══════════ */
  {
    let args = null
    stubTranslator({ output: '优质免费在线工具', onArgs: a => { args = a } })
    eq(translatorSupport(), 'new', '新版 API 被识别')
    eq(await warmUpTranslator(), true, '预热成功')
    eq(translatorState().status, 'ready', 'status = ready')
    eq(await translateText('The best free online tools'), '优质免费在线工具', '★ 拿到本地译文')
    eq(args?.sourceLanguage, 'en', '默认源语言 en')
    eq(args?.targetLanguage, 'zh', '★ 目标语言归一到 zh（不是 zh-CN）')
  }

  /* ══════════ 3. 语言码归一：不同写法都要落到 API 认得的码 ══════════ */
  {
    for (const [input, expect] of [['zh-CN', 'zh'], ['zh_CN', 'zh'], ['ZH', 'zh'], ['zh-Hans', 'zh'], ['', 'zh']]) {
      let args = null
      stubTranslator({ onArgs: a => { args = a } })
      await warmUpTranslator({ target: input })
      eq(args?.targetLanguage, expect, `target「${input}」→ ${expect}`)
    }
    for (const [input, expect] of [['EN', 'en'], ['en-US', 'en'], ['', 'en']]) {
      let args = null
      stubTranslator({ onArgs: a => { args = a } })
      await warmUpTranslator({ source: input })
      eq(args?.sourceLanguage, expect, `source「${input}」→ ${expect}`)
    }
  }

  /* ══════════ 4. 旧版 API（origin trial 的 window.translation） ══════════ */
  {
    clearApis()
    let args = null
    globalThis.translation = {
      createTranslator: async (a) => { args = a; return { translate: async () => '旧版译文' } },
    }
    eq(translatorSupport(), 'legacy', '旧版 API 被识别')
    eq(await translateText('hello world'), '旧版译文', '★ 旧版 API 也能用')
    eq(args?.sourceLanguage, 'en', '旧版参数名一致')
  }

  /* ══════════ 5. ★ create() 挂起：必须在超时内收手，不能把用户晾住 ══════════ */
  {
    stubTranslator({ behavior: 'hang' })
    const t0 = Date.now()
    const out = await translateText('The best free online tools', { timeoutMs: 300 })
    const ms = Date.now() - t0
    eq(out, '', '★ create() 挂起时返回空串')
    ok(ms < 2000, `★ 挂起时也在超时内返回（${ms}ms，timeoutMs=300）`)
  }

  /* ══════════ 6. create() 抛错：记失败、不反复重试 ══════════ */
  {
    let calls = 0
    delete globalThis.translation
    globalThis.Translator = {
      availability: async () => 'downloadable',
      create: async () => { calls++; throw new Error('Unable to create translator for the given source and target language.') },
    }
    __resetTranslatorForTest()
    eq(await warmUpTranslator(), false, 'create 抛错 → 预热失败')
    eq(translatorState().status, 'failed', 'status = failed')
    eq(await translateText('hello world'), '', '失败后翻译返回空串')
    const afterFirst = calls
    await translateText('another text')
    eq(calls, afterFirst, '★ 失败后不再反复重试（否则每次添加都要等一遍超时）', `calls=${calls}`)
  }

  /* ══════════ 6b. 组合级失败：一个语言对挂掉不牵连另一个 ══════════ */
  {
    const created = []
    delete globalThis.translation
    globalThis.Translator = {
      availability: async () => 'downloadable',
      create: async ({ sourceLanguage }) => {
        created.push(sourceLanguage)
        if (sourceLanguage === 'ja') throw new Error('该语言对不支持')
        return { translate: async t => '译:' + t }
      },
    }
    globalThis.LanguageDetector = {
      availability: async () => 'available',
      create: async () => ({
        detect: async (t) => [{ detectedLanguage: /[\u3040-\u30ff]/.test(t) ? 'ja' : 'en', confidence: 0.9 }],
      }),
    }
    __resetTranslatorForTest()

    eq(await translateText('最高の無料オンラインツール'), '', '日文翻译失败 → 空串（不抛错）')
    eq(await translateText('The best free online tools'), '译:The best free online tools',
      '★ 英文仍能译（日文失败不牵连已就绪的英文）')
    eq(translatorState().status, 'ready', '仍处于 ready（还有一个可用语言对）')

    const before = created.length
    await translateText('最高の無料オンラインツール')
    eq(created.length, before, '★ 失败过的语言对不再重试（不白等一遍超时）')
    delete globalThis.LanguageDetector
  }

  /* ══════════ 7. translate() 抛错 / 原样返回，都不能当成译文 ══════════ */
  {
    stubTranslator({ behavior: 'throw' })
    eq(await translateText('hello world'), '', '★ translate 抛错 → 空串')

    stubTranslator({ behavior: 'echo' })
    eq(await translateText('hello world'), '', '★ 译文与原文相同 → 视为没有译文')

    stubTranslator({ output: '' })
    eq(await translateText('hello world'), '', '空译文 → 空串')
  }

  /* ══════════ 8. 输入边界 ══════════ */
  {
    stubTranslator({ output: '中文' })
    eq(await translateText(''), '', '空串进空串出')
    eq(await translateText('   '), '', '纯空白进空串出')
    eq(await translateText(null), '', 'null 不炸')
    eq(await translateText(undefined), '', 'undefined 不炸')
  }

  /* ══════════ 9. 语言探测：只在置信度够高时才采信，低置信度回落到 en ══════════ */
  {
    stubTranslator({ output: '译文' })
    delete globalThis.LanguageDetector
    eq(await detectLanguage('hello world'), '', '无检测器 → 空串（上层回落 en）')

    globalThis.LanguageDetector = {
      availability: async () => 'available',
      create: async () => ({ detect: async () => [{ detectedLanguage: 'en', confidence: 0.99 }] }),
    }
    eq(await detectLanguage('The best free online tools'), 'en', '高置信度采信')

    globalThis.LanguageDetector = {
      availability: async () => 'available',
      create: async () => ({ detect: async () => [{ detectedLanguage: 'xx', confidence: 0.2 }] }),
    }
    eq(await detectLanguage('???'), '', '★ 低置信度不猜（回落到默认 en）')

    globalThis.LanguageDetector = {
      availability: async () => 'unavailable',
      create: async () => { throw new Error('未下载') },
    }
    eq(await detectLanguage('hello'), '', '检测器不可用 → 空串不抛错')

    globalThis.LanguageDetector = { create: async () => { throw new Error('boom') } }
    eq(await detectLanguage('hello'), '', '检测抛错 → 空串不抛错')
    delete globalThis.LanguageDetector
  }

  /* ══════════ 10. 探测到源语言时用它，而不是写死 en ══════════ */
  {
    let args = null
    stubTranslator({ onArgs: a => { args = a } })
    globalThis.LanguageDetector = {
      availability: async () => 'available',
      create: async () => ({ detect: async () => [{ detectedLanguage: 'ja', confidence: 0.9 }] }),
    }
    await translateText('最高の無料オンラインツール')
    eq(args?.sourceLanguage, 'ja', '★ 自动探测到日文就用 ja')
    delete globalThis.LanguageDetector
  }

  /* ══════════ 11. 幂等：重复预热不会并发下多份语言包 ══════════ */
  {
    let creates = 0
    delete globalThis.translation
    globalThis.Translator = {
      availability: async () => 'available',
      create: async () => {
        creates++
        await new Promise(r => setTimeout(r, 60))
        return { translate: async t => '译:' + t }
      },
    }
    __resetTranslatorForTest()
    const results = await Promise.all([
      warmUpTranslator(), warmUpTranslator(), warmUpTranslator(),
    ])
    eq(creates, 1, '★ 并发预热只 create 一次')
    eq(results.filter(Boolean).length, 3, '三个并发预热都返回 true')
    eq(translatorState().status, 'ready', '预热后状态为 ready')
    eq(await translateText('hi'), '译:hi', '就绪后能译')
  }
} finally {
  if (realTranslator === undefined) delete globalThis.Translator; else globalThis.Translator = realTranslator
  if (realTranslation === undefined) delete globalThis.translation; else globalThis.translation = realTranslation
  if (realDetector === undefined) delete globalThis.LanguageDetector; else globalThis.LanguageDetector = realDetector
}

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ 浏览器本地翻译 ${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 浏览器本地翻译全部通过：${pass} 条断言`)
process.exit(0)
