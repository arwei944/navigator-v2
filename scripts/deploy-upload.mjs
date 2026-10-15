/**
 * BotKeep 分片上传脚本（node，处理限流重试）。
 * 用法：node deploy-upload.mjs <slice1> <slice2> ...
 * 每片一个独立幂等键（字母数字与 - _），429/503/422 自动退避重试。
 */
import { readFileSync } from 'node:fs'

const KEY = process.env.BK_KEY
const WID = process.env.BK_WID
const BASE = `https://api.botkeep.cloud/api/v1/developer/workloads/${WID}`

if (!KEY || !WID) { console.error('缺少 BK_KEY / BK_WID'); process.exit(2) }

const NAMES = ['a.paa', 'a.pab', 'a.pac', 'a.pad']
const slices = process.argv.slice(2)
// 幂等键前缀：每次部署换一个，避免与上一轮的记录撞上（服务端按「键 + 请求体指纹」去重）
const TAG = process.env.BK_TAG || 'nav-deploy'

async function uploadOnce(name, b64, idem) {
  const res = await fetch(`${BASE}/files/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idem,
    },
    body: JSON.stringify({ path: `/${name}`, data: b64, overwrite: true }),
    signal: AbortSignal.timeout(120000),
  })
  const text = await res.text().catch(() => '')
  return { status: res.status, text: text.slice(0, 200) }
}

for (let i = 0; i < slices.length; i++) {
  const name = NAMES[i] || `a.pa${String(i).padStart(2, '0')}`
  const b64 = readFileSync(slices[i]).toString('base64')
  console.log(`[${i + 1}/${slices.length}] ${name}（base64 ${(b64.length / 1048576).toFixed(2)} MB）`)
  if (b64.length > 5333336) { console.error(`  ❌ 超过单文件上限`); process.exit(1) }

  let done = false
  for (let t = 1; t <= 12 && !done; t++) {
    const idem = `nav-deploy-${TAG}-${i}-${t}` // 必须 16–64 位字母数字与 - _
    try {
      const { status, text } = await uploadOnce(name, b64, idem)
      if (status === 200 || status === 201) {
        console.log(`  ✅ HTTP ${status}`)
        done = true
      } else if (status === 422 && /Idempotency-Key/i.test(text)) {
        // 键不合规属于**配置错误**，重试一万次也一样 —— 曾经因为键短了一位，
        // 在这条重试循环里白等了九分钟，而日志里只看得见「重试中」。
        console.error(`  ❌ 幂等键不合规（配置错误，重试无用）：${text}`)
        process.exit(1)
      } else if ([429, 503, 422].includes(status)) {
        // 重试间隔取 45s：实测这个接口的 429 是「排队 41~80 秒后被拒」，
        // 而不是立即拒绝 —— 间隔太短会撞在同一段拥塞里反复失败。
        console.log(`  ⏳ HTTP ${status}（第 ${t} 次）—— 等 45s 重试 :: ${text.slice(0, 120)}`)
        await new Promise(r => setTimeout(r, 45000))
      } else {
        console.error(`  ❌ HTTP ${status} :: ${text}`)
        process.exit(1)
      }
    } catch (e) {
      console.log(`  ⏳ 网络异常（第 ${t} 次）：${String(e.message || e).slice(0, 80)}`)
      await new Promise(r => setTimeout(r, 15000))
    }
  }
  if (!done) { console.error('  ❌ 重试耗尽'); process.exit(1) }
}
console.log('ALL_SLICES_UPLOADED')
