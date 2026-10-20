/**
 * 密钥管理：登记表契约 + 形态体检 + **不泄露** + 真实面板渲染。
 *
 * ## 为什么「不泄露」要单独守
 *
 * 这个面板是全项目唯一会把密钥读出来再写回去的地方。它出错的代价不是功能坏掉，
 * 而是密钥进日志、进 DOM、进响应体 —— 这些一旦发生就收不回来（会被 git 历史、
 * 浏览器缓存、审计文件各自留一份）。
 *
 * 所以本门禁的核心断言是**反向**的：不是「功能能用」，而是「完整值没有出现在
 * 任何对外出口」。这类断言必须在真实渲染之后检查 DOM，不能只测纯函数。
 *
 * 运行：node tools/console/test-secrets.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch } from './lib/cdp-driver.mjs'
import { SECRETS, groupedSecrets, findSecret, inspectShape, maskSecret, PLATFORM_LABELS } from '../../shared/secrets-registry.mjs'
import * as secrets from './lib/core/secrets.mjs'

const PORT = 5333
let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }

/* ============ ① 登记表自洽 ============ */

ok(SECRETS.length >= 8, `登记项数量合理（${SECRETS.length} 项）`)
ok(new Set(SECRETS.map(s => s.key)).size === SECRETS.length, '变量名唯一（重复会让面板渲染两条、写入互相覆盖）')
ok(SECRETS.every(s => s.platform && PLATFORM_LABELS[s.platform]), '每项都归入已知平台分组（否则面板会漏渲染）')
ok(SECRETS.every(s => s.label && s.scope && s.where), '每项都有名字 / 影响范围 / 取值入口（缺一项用户就不知道该不该配）')

// 别名不能撞车：两个登记项共用别名会导致「读到的值和名字对不上」
{
  const all = SECRETS.flatMap(s => [s.key, ...(s.aliases || [])])
  ok(new Set(all).size === all.length, '主名与别名全局唯一')
}

// 分组不丢项：groupedSecrets 的并集必须等于 SECRETS
{
  const grouped = groupedSecrets().flatMap(g => g.items)
  ok(grouped.length === SECRETS.length, '分组覆盖全部登记项', `${grouped.length}/${SECRETS.length}`)
}

/* ============ ② 形态体检 ============ */

ok(inspectShape('BOTKEEP_API_KEY', 'bk_live_' + 'x'.repeat(45)).ok, '合法前缀的长 key 通过体检')
ok(!inspectShape('BOTKEEP_API_KEY', 'sk-proj-abcdefghijklmnop').ok, '把别家 key 填进来会被拒（前缀不符）')
ok(!inspectShape('BOTKEEP_API_KEY', 'bk_live_abc def ghi').ok, '含空白会被拒（折行复制是最常见的坑）')
ok(!inspectShape('BOTKEEP_API_KEY', 'bk_live_abc').ok, '长度不足会被拒（粘了半截）')
ok(inspectShape('BOTKEEP_API_KEY', '').ok, '空值不算形态问题（是否必需由 required 判定，不该混为一谈）')

/* ============ ③ 掩码 ============ */

{
  const m = maskSecret('abcdefghijklmnop')
  ok(m.endsWith('mnop') && !m.includes('abcdef'), '掩码保留后 4 位、不暴露前段', m)
  ok(maskSecret('abc') === '••••', '超短值不暴露任何字符')
  ok(maskSecret('') === '', '空值掩码为空')
}

/* ============ ④ 状态读取不泄露完整值 ============ */

{
  const st = secrets.status()
  const raw = JSON.stringify(st)
  // 从真实环境里取一把已配置的 key，确认它没出现在响应里
  const configured = st.groups.flatMap(g => g.items).filter(i => i.configured)
  ok(configured.length > 0, '本机至少配了一项（否则这条断言等于没测）', `${configured.length} 项`)

  const envText = existsSync(join(process.cwd(), '.env.local')) ? readFileSync(join(process.cwd(), '.env.local'), 'utf8') : ''
  let leaked = ''
  for (const item of configured) {
    const m = envText.match(new RegExp(`^${item.key}=(.*)$`, 'm'))
    const v = m ? m[1].replace(/^"|"$/g, '').trim() : ''
    // 只检查足够长的值：太短的值可能在掩码里偶然重合，属噪声
    if (v.length >= 12 && raw.includes(v)) { leaked = item.key; break }
  }
  ok(!leaked, 'status() 不含任何完整密钥值', leaked ? `${leaked} 泄露` : '')
  ok(st.summary.total === SECRETS.length, 'summary 总数与登记表一致')
}

/* ============ ⑤ 写入拒绝未登记变量 ============ */

{
  const r = secrets.save({ SOME_RANDOM_VAR: 'x' })
  ok(!r.ok && r.rejected.length === 1, '未登记的变量名被拒绝写入（防止随手往 .env.local 塞东西）')
}

/* ============ ⑥ 真实面板渲染 + DOM 不泄露 ============ */

// 端口走命令行参数（`server.mjs --port N --strict-port`）：
// 环境变量在这个入口不生效，写成 NAV_CONSOLE_PORT 会让测试静默连不上（踩过）。
const consoleProc = spawn(process.execPath, [
  join(process.cwd(), 'tools/console/server.mjs'),
  '--port', String(PORT), '--strict-port',
], { stdio: ['ignore', 'pipe', 'pipe'] })

let browser = null
try {
  // 等控制台就绪
  const deadline = Date.now() + 20000
  let ready = false
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/secrets`, { signal: AbortSignal.timeout(2000) })
      if (r.ok) { ready = true; break }
    } catch { /* 尚未就绪 */ }
    await new Promise(r => setTimeout(r, 300))
  }
  ok(ready, '控制台启动并响应 /api/secrets')

  if (ready) {
    // API 层：响应里不能有完整值
    const apiBody = await (await fetch(`http://127.0.0.1:${PORT}/api/secrets`)).text()
    const envText = existsSync(join(process.cwd(), '.env.local')) ? readFileSync(join(process.cwd(), '.env.local'), 'utf8') : ''
    const keyMatch = envText.match(/^BOTKEEP_API_KEY=(.*)$/m)
    const realKey = keyMatch ? keyMatch[1].trim() : ''
    ok(!realKey || !apiBody.includes(realKey), 'HTTP 响应体不含完整密钥')

    browser = await launch({ headless: true, port: PORT + 1000, url: `http://127.0.0.1:${PORT}/` })
    const c = {
      eval: async (expr) => {
        const r = await browser.client.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
        return r.result.value
      },
      sleep: (ms) => new Promise(r => setTimeout(r, ms)),
    }
    await c.sleep(1500)

    await c.eval(`document.querySelector('.tab[data-panel="secrets"]').click(); true`)
    await c.sleep(1200)

    ok(await c.eval(`document.querySelector('#panel-secrets').classList.contains('active')`), '密钥面板可打开')

    const rowCount = await c.eval(`document.querySelectorAll('.secret-row').length`)
    ok(rowCount === SECRETS.length, '面板渲染出全部登记项', `${rowCount}/${SECRETS.length}`)

    const groupCount = await c.eval(`document.querySelectorAll('#secrets-groups .secret-group').length`)
    ok(groupCount === groupedSecrets().length, '平台分组数量正确', `${groupCount}/${groupedSecrets().length}`)

    // 每个已配置项都要显示掩码，而不是空
    const stateBadges = await c.eval(`[...document.querySelectorAll('.badge.secret-state')].map(b=>b.textContent)`)
    ok(stateBadges.filter(t => /已配置/.test(t)).every(t => /••••/.test(t)),
      '已配置项的状态徽标显示掩码', stateBadges.filter(t => /已配置/.test(t)).join(' | ').slice(0, 80))

    // 输入框必须是密码型：否则粘贴时明文回显
    ok(await c.eval(`[...document.querySelectorAll('.secret-input')].every(i=>i.type==='password')`), '所有输入框为密码型')

    // 关键：DOM 里不能出现完整密钥
    const domLeak = await c.eval(`
      (() => {
        const html = document.documentElement.outerHTML;
        const m = html.match(/bk_live_[A-Za-z0-9_-]{20,}/);
        return m ? m[0].slice(0, 10) + '…' : '';
      })()
    `)
    ok(domLeak === '', '渲染后的 DOM 不含完整密钥', domLeak)

    // 未配置项不该出现「验证 / 清除」按钮（验证一把空 key 没有意义）
    const unconfigured = await c.eval(`
      [...document.querySelectorAll('.secret-row')]
        .filter(r => !r.querySelector('.badge.secret-state')?.textContent.includes('已配置'))
        .map(r => r.dataset.key)
    `)
    const badBtn = await c.eval(`
      [...document.querySelectorAll('.secret-row')]
        .filter(r => !r.querySelector('.badge.secret-state')?.textContent.includes('已配置'))
        .filter(r => [...r.querySelectorAll('.btn')].some(b => /验证|清除/.test(b.textContent)))
        .map(r => r.dataset.key)
    `)
    ok(unconfigured.length === 0 || badBtn.length === 0, '未配置项不显示验证/清除按钮', badBtn.join(','))

    // 页面无运行时错误
    const errs = await c.eval(`window.__navErrors ? JSON.stringify(window.__navErrors.slice(0,2)) : '[]'`)
    ok(errs === '[]' || errs === undefined, '面板无运行时错误', String(errs).slice(0, 120))
  }
} finally {
  if (browser) await browser.close().catch(() => {})
  consoleProc.kill()
}

console.log(`\n🔑 密钥管理：${pass} 通过 / ${failures.length} 失败`)
if (failures.length) {
  console.log('\n失败明细：')
  for (const f of failures) console.log(`- ${f}`)
  process.exit(1)
}
console.log('  ✓ 登记表自洽｜形态体检｜掩码与零泄露｜真实面板渲染')
