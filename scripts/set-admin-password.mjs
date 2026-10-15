#!/usr/bin/env node
/**
 * 设置管理后台的**口令登录**（比共享密钥安全：有期限、可轮换，密钥本身不进浏览器）。
 *
 * ## 为什么需要它
 *
 * 「记住此设备 90 天」要生效，前提是服务端配好了 `ADMIN_PASSWORD_HASH`。
 * 而线上（自有服务器）**平台的环境变量注入不生效**，配置得走文件回填 ——
 * 也就是把哈希写到容器的 `data/admin-password-hash.txt`（`server/main.mjs` 启动时读回）。
 * 这一串手工操作很容易出错，所以收成一条命令。
 *
 * ## 用法
 *
 *   node scripts/set-admin-password.mjs              # 交互输入口令，写本地文件
 *   node scripts/set-admin-password.mjs --upload     # 再上传到线上并重启
 *
 * 口令通过**交互式输入**（不回显），所以不会进 shell 历史、也不会出现在进程列表里。
 *
 * 生成的是 scrypt 加盐哈希 —— 口令本身既不落盘也不进 git。
 */
import { createInterface } from 'node:readline'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { hashPassword } from '../shared/auth.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'data', 'admin-password-hash.txt')
const ENV_FILE = join(ROOT, '.env.local')

/** 交互式读一行，`hidden` 时不回显（口令用它） */
function ask(question, { hidden = false } = {}) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    if (hidden) {
      // 覆盖 _writeToOutput 实现回显屏蔽；这比关掉回显再恢复稳（后者在 Windows 上偶发失灵）
      const orig = rl._writeToOutput
      rl._writeToOutput = function (s) {
        if (s.includes(question)) orig.call(rl, s)
        else orig.call(rl, '*'.repeat(String(s).length))
      }
    }
    rl.question(question, answer => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(String(answer || '').trim()) })
  })
}

function readEnv(key) {
  try {
    const m = readFileSync(ENV_FILE, 'utf8').match(new RegExp(`^${key}="?([^"\\n]+)"?`, 'm'))
    return m ? m[1].trim() : ''
  } catch { return '' }
}

/** 平台的幂等键规则：16–64 位，只允许字母数字与 - _ （写错会被 422 拒，且像是瞬时错误） */
const idemKey = () => 'nav-pwd-' + randomBytes(9).toString('hex')

async function bk(base, path, { method = 'GET', body } = {}) {
  const key = readEnv('BOTKEEP_API_KEY')
  const res = await fetch(base + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + key,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'Idempotency-Key': idemKey() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* 可能不是 JSON */ }
  return { status: res.status, json, text: text.slice(0, 300) }
}

async function main() {
  const upload = process.argv.includes('--upload')

  let pw = await ask('新口令（至少 8 位，输入不回显）：', { hidden: true })
  if (pw.length < 8) { console.error(`\n✗ 口令至少 8 位（当前 ${pw.length} 位）`); process.exit(2) }
  const again = await ask('再输一次确认：', { hidden: true })
  if (pw !== again) { console.error('\n✗ 两次输入不一致'); process.exit(2) }

  const hash = hashPassword(pw)
  pw = null // 尽早丢掉明文引用

  mkdirSync(join(ROOT, 'data'), { recursive: true })
  writeFileSync(OUT, hash + '\n', 'utf8')
  console.log(`\n✓ 已写入 ${OUT}`)
  console.log('  该目录已 gitignore；口令本身没有落盘，只有 scrypt 哈希。')

  if (!upload) {
    console.log('\n（未上传）加 --upload 可一并推到线上并重启。')
    return
  }

  const wid = readEnv('BOTKEEP_WORKLOAD_ID')
  const key = readEnv('BOTKEEP_API_KEY')
  if (!wid || !key) { console.error('\n✗ .env.local 缺少 BOTKEEP_WORKLOAD_ID / BOTKEEP_API_KEY'); process.exit(2) }
  const base = `https://api.botkeep.cloud/api/v1/developer/workloads/${wid}`

  console.log('\n· 上传到线上容器 /data/admin-password-hash.txt')
  const content = readFileSync(OUT)
  const up = await bk(base, '/files/upload', {
    method: 'POST',
    body: { path: '/data/admin-password-hash.txt', data: content.toString('base64') },
  })
  if (up.status === 409) {
    // 同名文件不覆盖：先删再传
    console.log('  · 线上已有该文件，先删除再上传')
    const del = await bk(base, '/files/batch', { method: 'POST', body: { action: 'delete', paths: ['/data/admin-password-hash.txt'] } })
    if (del.status >= 400) console.log(`  ⚠ 删除返回 HTTP ${del.status}（可能本来就不存在，继续）`)
    await new Promise(r => setTimeout(r, 5000)) // 删除有生效延迟
    const retry = await bk(base, '/files/upload', {
      method: 'POST',
      body: { path: '/data/admin-password-hash.txt', data: content.toString('base64') },
    })
    if (retry.status >= 400) { console.error(`\n✗ 上传失败 HTTP ${retry.status}：${retry.text}`); process.exit(1) }
  } else if (up.status >= 400) {
    console.error(`\n✗ 上传失败 HTTP ${up.status}：${up.text}`); process.exit(1)
  }
  console.log('  ✓ 已上传')

  console.log('\n· 重启容器让配置生效')
  const rs = await bk(base, '/actions', { method: 'POST', body: { action: 'restart' } })
  if (rs.status >= 400) { console.error(`✗ 重启失败 HTTP ${rs.status}：${rs.text}`); process.exit(1) }
  console.log('  ✓ 重启已入队（约 30 秒后生效）')
  console.log('\n完成后即可用「用户名 + 口令」登录，并勾「记住此设备」实现 90 天免登录。')
}

main().catch(e => { console.error('\n✗', e.message); process.exit(1) })
