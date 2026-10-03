/**
 * 生成 ADMIN_PASSWORD_HASH（scrypt 加盐哈希）。
 *
 * 用法：node scripts/hash-password.mjs "你的口令"
 * 输出一行，直接粘进 .env.local（本地）或 Vercel 项目环境变量（线上）。
 * 口令本身既不落盘也不进 git —— 环境变量里只放哈希。
 */
import { hashPassword } from '../shared/auth.mjs'

const password = process.argv[2]

if (!password) {
  console.error('用法：node scripts/hash-password.mjs "你的口令"')
  console.error('  或：npm run auth:hash -- "你的口令"')
  process.exit(2)
}

if (password.length < 8) {
  console.error('口令至少 8 位（当前 ' + password.length + ' 位）')
  process.exit(2)
}

console.log(`ADMIN_PASSWORD_HASH=${hashPassword(password)}`)