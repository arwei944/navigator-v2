/**
 * 一次性别名录入：给 api/sites-data.json 的站点补 `aliases: string[]`。
 *
 * 为什么要这个字段：检索只认 name / url / desc 时，中文用户敲「币安」「小狐狸」
 * 「抱抱脸」找不到对应站点，而这些正是他们最自然的叫法。
 *
 * 收录口径（宁缺毋滥，别名只增加召回、不改变名称排序）：
 *   1. 中文俗称 / 官方中文名 —— 币安、欧易、小狐狸、扣子、抹茶、慢雾、律动
 *   2. 中英互译 —— 中文站补英文名（豆包 → Doubao），英文站补中文名
 *   3. 曾用名 —— HTX 的「火币」、OKX 的「OKEx」、Make 的「Integromat」
 *   4. 通用缩写 —— GPT、MJ、SD、CMC、HF
 *
 * 明确不收：
 *   - 代币代码（UNI / TAO / GRT …）：那是交易语境，不是「这个站叫什么」
 *   - 与站名仅大小写不同、或与域名主体同形的写法：检索已覆盖，加了是冗余
 *   - 字面直译但社区不这么叫的（Uniswap→优尼斯瓦普、Napkin→餐巾纸、Sui→隋链）：
 *     这类别名不会带来任何召回，只会稀释结果
 *   - 歧义过大的两字母词（MM / TV / CG / CT / ME）
 *
 * 幂等：默认只做「并集」写入，不删已有别名；未列出的站点原样不动。
 * 例外是 DROP 表：显式列出的别名会被移除（用于清理类别级通用词，见下）。
 * 用法：node scripts/seed-aliases.mjs [--dry-run]
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILE = join(root, 'api', 'sites-data.json')
const dryRun = process.argv.includes('--dry-run')

/** id → 别名列表 */
const ALIASES = {
  /* ── 入门对话 ── */
  s1: ['GPT', 'chat gpt', '聊天GPT'],
  s2: ['克劳德'],
  s3: ['深度求索', 'deep seek'],
  s4: ['月之暗面', 'Moonshot'],
  s5: ['Doubao', '字节豆包'],
  s6: ['xAI'],
  s7: ['通义', '千问', 'Qwen'],
  s8: ['谷歌Gemini'],
  s9: ['文心', '百度文心', 'ERNIE'],
  s10: ['智谱', 'GLM', 'ChatGLM'],
  s11: ['讯飞', '星火', 'Spark'],

  /* ── 提示词 ── */
  p3: ['Flow GPT'],

  /* ── AI 编程 ── */
  cd2: ['Copilot'],
  cd4: ['v0', 'Vercel v0'],
  cd5: ['Bolt'],
  cd8: ['Codeium'],
  cd13: ['Semi'],
  cd14: ['LinuxDo', 'linuxdo'],
  cd16: ['DESIGN MD'],

  /* ── AI 设计 ── */
  g1: ['MJ'],
  g2: ['SD'],
  g3: ['RunwayML'],
  g5: ['11Labs'],
  g6: ['Canva', '可画'],
  g7: ['Leonardo'],
  g8: ['Kling', '可灵'],
  g12: ['DESIGN MD Editor'],

  /* ── AI 工作流 ── */
  f1: ['Zapier'],
  f2: ['Integromat'],
  f4: ['扣子', 'Coze AI'],
  f5: ['Lang Chain'],
  f6: ['抱抱脸', 'HF', 'huggingface'],
  f9: ['FlowiseAI'],
  f10: ['Auto GPT'],

  /* ── AI 学习 ── */
  l1: ['fastai'],
  l3: ['Colab', '谷歌Colab'],
  l4: ['Jiqizhixin'],
  l5: ['QbitAI'],
  l6: ['TLDR'],
  l8: ['Product Hunt'],
  l9: ['GitHub热榜'],
  l10: ['DeepLearning AI', '吴恩达'],
  l11: ['PapersWithCode'],
  l12: ['智源', 'BAAI'],
  l13: ['Shuge'],

  /* ── 交易所 CEX ── */
  ex1: ['币安'],
  ex2: ['欧易', 'OKEx'],
  ex5: ['库币'],
  ex6: ['芝麻开门', '芝麻交易所', 'Gate'],
  ex7: ['海妖'],
  ex8: ['抹茶'],
  ex9: ['火币', 'Huobi'],
  ex10: ['Bit Get'],

  /* ── 去中心化交易所 DEX ── */
  dx2: ['薄饼'],
  dx6: ['寿司'],

  /* ── DeFi ── */
  df7: ['JustLend DAO', '波场借贷'],
  df8: ['维纳斯'],
  df9: ['Mob'],

  /* ── 数据与研究 ── */
  dt1: ['CMC'],
  dt2: ['壁虎', '币虎'],
  dt4: ['羊驼', 'Defi Llama'],
  dt5: ['TokenTerminal'],
  dt7: ['Dune'],
  dt12: ['Arkham Intelligence'],
  dt21: ['熊猫寨'],
  dt22: ['呱呱助手', '呱呱'],
  dt25: ['X榜'],
  dt26: ['AI价格雷达'],
  dt27: ['JokkiMon', '听风'],
  dt31: ['Traderax'],
  dt34: ['OpenChain Bench'],

  /* ── 钱包 ── */
  wl1: ['小狐狸'],
  wl2: ['幻影', '幻影钱包'],
  wl3: ['Rabby Wallet'],
  wl4: ['信任钱包'],
  wl5: ['欧易钱包', 'OKX Web3'],
  wl6: ['Ledger'],
  wl7: ['Coinbase钱包'],

  /* ── 链上工具 ── */
  ch1: ['以太坊浏览器'],
  ch2: ['SOL浏览器'],
  ch3: ['BSC浏览器', '币安智能链浏览器'],
  ch4: ['Arbitrum浏览器'],

  /* ── 公链基础设施 ── */
  in1: ['以太坊'],
  in2: ['索拉纳'],
  in5: ['Base链', 'Coinbase Base'],
  in11: ['雪崩'],
  in12: ['马蹄链'],

  /* ── 安全审计 ── */
  sc1: ['Certik'],
  sc2: ['慢雾'],
  sc3: ['DeFi Safety'],
  sc6: ['派盾'],
  sc8: ['腾讯安全'],

  /* ── 媒体资讯 ── */
  md4: ['TheBlock'],
  md5: ['吴说', 'WuShuo', 'wublockchain'],
  md6: ['Foresight'],
  md7: ['律动'],
  md8: ['星球日报', 'Odaily星球日报'],

  /* ── 质押 ── */
  st2: ['火箭池'],

  /* ── 稳定币 ── */
  sb1: ['Maker', 'DAI'],

  /* ── AI + Crypto ── */
  ac1: ['Render'],
  ac3: ['Akash'],
  ac5: ['文件币'],
  ac15: ['TapeOut'],

  /* ── 短信接码 ── */
  sm1: ['鲁班'],
  sm2: ['疾驰'],
  sm4: ['SMS Activate'],
  sm6: ['SMS Pool'],
  sm7: ['Receive SMS', '免费接码'],
  sm8: ['Hero SMS'],
  sm9: ['233'],
  sm10: ['闪电'],
  sm11: ['USAPI', '美卡接码'],
  sm12: ['快客'],
  sm14: ['Mail td'],
  sm15: ['Sunls'],
  sm16: ['四方接码', '四方'],
  sm17: ['HeroSMS', 'Hero SMS'],

  /* ── AI API 平台 ── */
  aiapi2: ['启悟'],
  aiapi3: ['AMD Token Factory'],
  aiapi6: ['阶跃星辰', '跃问'],
  aiapi7: ['Agnes'],
  aiapi8: ['云码平台'],
  aiapi9: ['Venice'],
  aiapi10: ['BAI'],
  aiapi11: ['AI Hub Mix'],
  aiapi12: ['Go Router'],
  aiapi13: ['GMI'],
  aiapi15: ['TinyFish'],
  aiapi17: ['免费Token'],
  aiapi19: ['Orca Router'],
  aiapi20: ['Kira'],

  /* ── 云服务 / 代理 ── */
  bs1: ['良心云机场'],
  bs2: ['Kitty'],
  bs3: ['三毛'],
  bs4: ['ClashPlus'],
  bs5: ['挂梯'],
  bs6: ['一分'],
  bs8: ['极点云', 'PolarNode', 'cpolar', '内网穿透'],

  /* ── 账号 / 卡密 ── */
  acc1: ['牛牛', '苹果ID'],
  acc2: ['苹果ID'],
  acc3: ['车久', 'X Premium'],
  acc4: ['RON'],
  acc5: ['116212'],

  /* ── 融资数据 ── */
  fd1: ['Root Data'],
  fd2: ['Crypto Fundraising'],
  fd3: ['Chain Broker'],
  fd4: ['ICODrops', 'ICO'],
  fd5: ['Crypto Rank'],
  fd6: ['Coin List'],
  fd8: ['Token Unlocks', '代币解锁'],

  /* ── 空投 ── */
  ad3: ['Airdrop Alert'],
  ad5: ['Airdrop King'],
  ad6: ['99 Airdrops'],
  ad7: ['Drops Earn'],
  ad8: ['Earn Drop'],
  ad9: ['CMC Airdrop'],
  ad10: ['DappRadar'],
  ad12: ['Crypto Airdrops'],

  /* ── AI 优惠 ── */
  adl2: ['Get Cheap AI', '便宜AI'],
  adl3: ['AIbase'],
  adl4: ['Price AI'],

  /* ── 项目参考 ── */
  pj1: ['双盲训练器', 'K线训练'],
  pj2: ['jev'],
  pj3: ['Jev'],
}

/**
 * 明确要移除的别名。
 * 「空投」「临时邮箱」是**类别级通用词**，挂在个别站点上会误导：用户搜「空投」
 * 只看到两个空投站，其余同类站点不出现，看起来像收录不全。这类词归分类，不归别名。
 */
const DROP = {
  ad9: ['空投'],
  ad10: ['空投'],
  sm14: ['临时邮箱'],
  sm15: ['临时邮箱'],
}

const sites = JSON.parse(readFileSync(FILE, 'utf-8'))
const byId = new Map(sites.map(s => [s.id, s]))

const missing = [...Object.keys(ALIASES), ...Object.keys(DROP)].filter(id => !byId.has(id))
if (missing.length) {
  console.error('❌ 别名表引用了不存在的站点 id：' + missing.join(', '))
  process.exit(1)
}

/** 与站名/域名重复、或纯空白/过短的别名没有检索价值，剔除 */
function usable(alias, site) {
  const a = String(alias || '').trim()
  if (!a) return false
  if (a.toLowerCase() === String(site.name || '').trim().toLowerCase()) return false
  const host = String(site.url || '').toLowerCase().replace(/^www\./, '')
  if (a.toLowerCase() === host || host.startsWith(a.toLowerCase() + '.')) return false
  return true
}

let touched = 0
let added = 0
const report = []

for (const id of new Set([...Object.keys(ALIASES), ...Object.keys(DROP)])) {
  const site = byId.get(id)
  const existing = Array.isArray(site.aliases) ? site.aliases : []
  const drop = new Set((DROP[id] || []).map(a => a.toLowerCase()))
  const merged = existing.filter(a => !drop.has(String(a).toLowerCase()))
  for (const raw of (ALIASES[id] || [])) {
    if (!usable(raw, site)) continue
    if (merged.some(x => String(x).toLowerCase() === String(raw).toLowerCase())) continue
    merged.push(String(raw).trim())
  }
  if (merged.length === existing.length && merged.every((a, i) => a === existing[i])) continue
  touched++
  added += merged.length - existing.length
  report.push(`${id}\t${site.name}\t${merged.join(' / ') || '(清空)'}`)
  if (!dryRun) {
    if (merged.length) site.aliases = merged
    else delete site.aliases
  }
}

console.log(`${dryRun ? '[dry-run] ' : ''}涉及 ${touched} 个站点，新增 ${added} 条别名`)
report.forEach(r => console.log('  ' + r))

if (dryRun) {
  console.log('\n未写入（--dry-run）')
  process.exit(0)
}

const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
const dir = join(root, 'backups')
mkdirSync(dir, { recursive: true })
copyFileSync(FILE, join(dir, `sites-data-${ts}.json`))

const tmp = FILE + '.tmp'
writeFileSync(tmp, JSON.stringify(sites, null, 2) + '\n', 'utf-8')
renameSync(tmp, FILE)
console.log(`\n✅ 已写入 ${FILE}\n   备份：backups/sites-data-${ts}.json`)