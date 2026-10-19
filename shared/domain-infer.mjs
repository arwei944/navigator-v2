/**
 * 领域位置的自动推断：把站点落到「领域 × 环节」上。
 *
 * ## 判据优先级（与 `auto-category.mjs` 同一口径）
 *
 * 1. **人工已定的不动**（`source: 'manual'`）—— 这是本模块的第一条硬规则
 * 2. 描述关键词（最具体，权重最高）
 * 3. URL 域名（`uniswap.org` 这类强信号）
 * 4. 用途标签（较泛，作为兜底）
 *
 * 每档都给 confidence，低于阈值的宁可**不推断**（留空）也不瞎猜：
 * 一条错误的位置比没有位置更糟 —— 它会让「全局视野」看起来完整，
 * 而实际上那一段是假的。
 *
 * ## 纯函数约束
 *
 * 不 import node:*、不碰 I/O，因为推断脚本（Node）与视图（浏览器）都要能跑。
 */

import { STAGE_INDEX, normalizePosition } from './domain-flow.mjs'

/* ================================ 规则表 ================================ */

/**
 * 每个环节的匹配规则。
 *
 * `strong` 命中即高置信（0.9）；`weak` 命中只给 0.6 —— 区分是为了让
 * 「uniswap 一定是 swap」和「提到「交易」可能只是交易市场」不混为一谈。
 *
 * `negative` 用来压掉误伤：例如「交易所」既可能是 CEX（法币入金）
 * 也可能只是泛指，配上 negative 关键词就能把它们分开。
 */
const STAGE_RULES = [
  /* ---------- 链上资产 ---------- */
  {
    stage: 'fiat-onramp',
    strong: /\bcex\b|中心化交易所|法币入金|场外交易|\botc\b|法币交易|binance|okx|coinbase|kraken|bybit|bitget|gate\.io/i,
    weak: /交易所|买入|充值|入金|on-?ramp/i,
  },
  {
    stage: 'custody',
    strong: /钱包|wallet|私钥|助记词|metamask|ledger|trezor|多签|multisig|keystore/i,
    weak: /开户|账户管理|冷钱包|热钱包/i,
  },
  {
    stage: 'transfer',
    strong: /跨链|bridge|桥接|cross-?chain|layerzero|wormhole|stargate|资产转移/i,
    weak: /转账|transfer|relay/i,
  },
  {
    stage: 'swap',
    strong: /\bdex\b|去中心化交易所|amm|自动做市|uniswap|pancakeswap|curve|sushi|流动性池|swap\b/i,
    weak: /兑换|交易对|liquidity/i,
  },
  {
    stage: 'lending',
    strong: /借贷|lending|aave|compound|抵押|存款生息|闪电贷|flash\s*loan/i,
    weak: /借款|利息|收益|apy|apr/i,
  },
  {
    stage: 'staking',
    strong: /质押|staking|节点运营|挖矿|validator|pos\b|锁仓|staking\s*rewards/i,
    weak: /年化|矿池|委托/i,
  },
  {
    stage: 'issuance',
    strong: /稳定币|stablecoin|rwa\b|铸造|mint\b|资产发行|makerdao|\bdai\b|国债代币化/i,
    weak: /发行|锚定/i,
  },
  {
    stage: 'marketplace',
    strong: /\bnft\b.*(市场|交易|marketplace)|opensea|blur\b|magic\s*eden|衍生品|期货|合约交易/i,
    weak: /交易市场|二级市场|挂单/i,
  },

  /* ---------- AI 工作流 ---------- */
  {
    /*
     * 「模型接入」只收**平台/聚合/中转**类 —— 用户来这里是拿 key 调模型。
     *
     * 第一版用宽泛的 `\bapi\b` 做弱信号，结果把所有「支持 API 调用」的对话助手
     * （DeepSeek / 豆包 / Grok）和节点服务（Alchemy / Infura）都吞了进来：
     * 它们确实提到 API，但用户用它们是**直接对话**或**跑节点**，不是拿 key。
     * 现在是 32 条里只有一半对 —— 一条错误位置比留空更糟，所以收紧。
     */
    stage: 'access',
    strong: /api\s*(平台|接入|聚合|中转|比价|key\s*平台)|模型聚合|api\s*key\s*(管理|分发)|openrouter|多模型聚合|中转站|接口聚合|one\s*api|new\s*api/i,
    weak: /聚合接入|统一接口|多模型中转/i,
  },
  {
    /*
     * 「对话助手」：直接打开就聊的 AI 产品。
     *
     * 这一环是第一版漏掉的 —— 当时 DeepSeek / 豆包 / Grok 只能落到「模型接入」
     * （因为描述里提到 API）或「内容生成」（因为提到生成），两处都不对：
     * 用户用它们就是**开一个对话框问问题**，这是 AI 工作流最主流的入口。
     */
    stage: 'chat',
    strong: /对话助手|聊天助手|ai\s*助手|大模型对话|智能问答|聊天机器人|chatbot|deepseek|豆包|kimi|通义千问|文心一言|智谱清言|讯飞星火|\bgrok\b|claude\b|chatgpt/i,
    weak: /对话|问答|聊天/i,
  },
  {
    stage: 'prompting',
    strong: /提示词|prompt\s*(工程|设计|模板)|prompting|learn\s*prompting|prompt\s*library/i,
    weak: /指令|角色设定/i,
  },
  {
    stage: 'generation',
    strong: /图像生成|文生图|视频生成|midjourney|stable\s*diffusion|sora|runway|语音合成|文字生成|文案生成/i,
    weak: /生成|创作|drawing|绘画/i,
  },
  {
    stage: 'coding',
    strong: /代码补全|编程助手|copilot|cursor|ide\b|代码生成|debug|重构|vibe\s*coding/i,
    weak: /编程|开发|代码/i,
  },
  {
    stage: 'orchestration',
    strong: /工作流|自动化|zapier|\bn8n\b|dify|make\.com|编排|agent\s*平台|智能体平台/i,
    weak: /流程|串联|自动化/i,
  },
  {
    stage: 'knowledge',
    strong: /知识库|笔记|notion|obsidian|第二大脑|文档协作|知识管理/i,
    weak: /整理|归档|知识/i,
  },
  {
    stage: 'learning',
    strong: /教程|课程|学习路径|fast\.ai|coursera|零基础|入门教程|系统学习/i,
    weak: /学习|教学|指南|文档/i,
  },

  /* ---------- 研究决策 ---------- */
  {
    stage: 'raw-data',
    strong: /行情|coinmarketcap|coingecko|价格数据|市值排名|链上数据|原始数据|api\s*数据/i,
    weak: /数据|指标|统计/i,
  },
  {
    stage: 'analytics',
    strong: /数据分析|图表|看板|dashboard|dexscreen|defillama|分析平台|可视化/i,
    weak: /分析|报表|趋势/i,
  },
  {
    stage: 'intel',
    strong: /新闻|媒体|资讯|研报|coindesk|the\s*block|深度报道|快讯/i,
    weak: /报道|情报|动态/i,
  },
  {
    stage: 'monitoring',
    strong: /监控|告警|alert|异动|实时监测|skynet|风险预警/i,
    weak: /提醒|监测/i,
  },
  {
    stage: 'practice',
    strong: /模拟|训练|回测|backtest|paper\s*trading|沙盒|演练/i,
    weak: /练习|测试/i,
  },
  {
    stage: 'due-diligence',
    strong: /审计|audit|尽调|安全评估|合约检测|certik|slowmist|风险评级/i,
    weak: /核查|评估|审查/i,
  },

  /* ---------- 基础设施 ---------- */
  {
    stage: 'compute',
    strong: /云服务器|vps\b|云主机|gpu\s*(算力|租赁|云)|裸金属|独立服务器|算力网络/i,
    weak: /服务器|主机|托管/i,
  },
  {
    stage: 'network',
    strong: /\bvpn\b|代理|机场|科学上网|节点订阅|clash|v2ray|加速线路|专线/i,
    weak: /网络|加速|线路/i,
  },
  {
    stage: 'identity',
    /*
     * 「身份账号」是**注册任何服务前要先备好的材料**：手机号、邮箱、账号、支付方式。
     * 补进临时邮箱与代开服务 —— 它们和接码是同一件事的不同侧面，
     * 第一版漏掉后这两条直接落在「无法判断」里。
     */
    strong: /接码|短信验证码|虚拟手机号|账号批发|apple\s*id|卡密|成品号|临时邮箱|邮箱服务|代开|独立下单|会员开通/i,
    weak: /账号|注册|验证码|邮箱/i,
  },
  {
    /*
     * 「链上底层」收的是**直接和链打交道的地基**：公链本身、浏览器、节点服务、数据可用性层。
     *
     * 第一版漏了节点服务（Alchemy / Infura）与存储层（Filecoin / Celestia）——
     * 它们被「API」「数据」这类弱词拉去了别的环节。这两类恰是基础设施的典型，
     * 补进 strong 后归属才正确。
     */
    stage: 'chain-base',
    strong: /\bl1\b|\bl2\b|公链|区块链浏览器|etherscan|主网|rollup|evm\b|ethereum\b|节点服务|节点\s*api|infura|alchemy|数据可用性|模块化区块链|去中心化存储|ipfs|索引协议/i,
    weak: /区块|共识层|链上基础/i,
  },
  {
    stage: 'security',
    strong: /安全审计|合约审计|漏洞|渗透测试|防火墙|防钓鱼/i,
    weak: /安全|防护/i,
  },
  {
    stage: 'payment',
    strong: /支付|结算|订阅计费|充值渠道|billing/i,
    weak: /付款|账单/i,
  },
]

/** 用途标签 → 环节（兜底档，只在描述与域名都没命中时使用） */
const PURPOSE_STAGE = {
  'ai-chat': 'access',
  coding: 'coding',
  design: 'generation',
  learning: 'learning',
  trading: 'marketplace',
  data: 'raw-data',
  reference: 'intel',
  news: 'intel',
  community: 'learning',
  productivity: 'orchestration',
  video: 'generation',
  tool: '',
}

/* ================================ 推断实现 ================================ */

/** 置信门槛：低于此值不落库（宁可留空，也不要一条假位置） */
export const MIN_CONFIDENCE = 0.5

/** 把站点文本拼成一段可搜索的 haystack（描述权重靠前，域名单独给） */
function haystackOf(site) {
  const desc = String(site.desc || '')
  const name = String(site.name || '')
  const url = String(site.url || '')
  return { desc, name, url, text: `${name} ${desc}` }
}

/**
 * 对单个站点推断位置。
 *
 * @returns {{ domain, stage, source: 'auto', confidence, reason }|null}
 *   `null` = 无法判断（调用方应保留原值或留空，**不要**当成「该站点没有领域」写死）
 */
export function inferPosition(site) {
  if (!site || typeof site !== 'object') return null
  const { desc, name, url, text } = haystackOf(site)

  let best = null

  for (const rule of STAGE_RULES) {
    const hit = STAGE_INDEX.get(rule.stage)
    if (!hit) continue /* 规则表与领域定义脱节时跳过，而不是抛错中断整批推断 */

    let confidence = 0
    let reason = ''

    // 强信号：描述或名称命中
    if (rule.strong.test(text)) { confidence = 0.9; reason = '描述命中强关键词' }
    else if (rule.strong.test(url)) { confidence = 0.75; reason = '域名命中强关键词' }
    // 弱信号：只在描述里命中
    else if (rule.weak.test(desc) || rule.weak.test(name)) { confidence = 0.6; reason = '描述命中弱关键词' }

    if (!confidence) continue
    // 「越具体越优先」：同分时取规则表里更靠前的那个（规则表按语义从具体到泛排列）
    if (!best || confidence > best.confidence) {
      best = { domain: hit.domain.id, stage: rule.stage, source: 'auto', confidence, reason }
    }
    if (confidence >= 0.9) break /* 强命中已是最优，不必继续扫 */
  }

  // 兜底：用途标签（只给 0.5，刚好过门槛 —— 让它能落库但排在最后）
  if (!best) {
    for (const p of site.purposes || []) {
      const stage = PURPOSE_STAGE[p]
      if (!stage) continue
      const hit = STAGE_INDEX.get(stage)
      if (!hit) continue
      best = { domain: hit.domain.id, stage, source: 'auto', confidence: MIN_CONFIDENCE, reason: `用途「${p}」兜底` }
      break
    }
  }

  if (!best || best.confidence < MIN_CONFIDENCE) return null
  return best
}

/**
 * 批量推断：**尊重人工覆写**。
 *
 * 这是本模块最重要的约定 —— 自动推断可以重跑任意多次，
 * 但 `source: 'manual'` 的条目永远不会被覆盖。没有这条，用户手工标好的位置
 * 会在下一次批量推断时全部丢失，而那正是他最花时间的地方。
 *
 * @returns {{ positions: object, changed: number, skippedManual: number, unresolved: number }}
 */
export function inferAllPositions(sites) {
  const positions = {}
  let changed = 0
  let skippedManual = 0
  let unresolved = 0

  for (const site of sites || []) {
    if (!site || !site.id) continue
    const existing = normalizePosition(site.position)
    if (existing && existing.source === 'manual') {
      positions[site.id] = existing
      skippedManual += 1
      continue
    }
    const inferred = inferPosition(site)
    if (!inferred) {
      // 保留旧的自动结果：这次推断不出，不代表上次那份是错的
      if (existing) positions[site.id] = existing
      else unresolved += 1
      continue
    }
    const prev = existing
    if (!prev || prev.stage !== inferred.stage) changed += 1
    positions[site.id] = inferred
  }

  return { positions, changed, skippedManual, unresolved }
}
