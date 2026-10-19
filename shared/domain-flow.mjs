/**
 * 领域上下游 —— 每个网站在「价值链」上的位置。
 *
 * ## 为什么需要这套维度
 *
 * 现有的 `categories.mjs` 回答的是「这个站点属于哪一类」，是一个**平铺的集合**。
 * 但用户真正想知道的是更结构化的问题：
 *
 *   · 我注册一个交易所账号，前面需要什么？（邮箱/接码 → 钱包 → 交易所）
 *   · 我这套流程哪一环是空的？（比如从钱包到 DEX 之间没有桥）
 *   · 整个领域谁在上游、谁在下游？
 *
 * 平铺分类答不了这些。所以这里引入第二条正交的维度：**domain（领域）× stage（环节）**。
 * 一个站点在自己的领域里有一个**顺序位置**，连续起来就是一条流水线。
 *
 * ## 为什么是新建维度而不是改造 categories
 *
 * categories 已经是「唯一真相源」且被前端侧边栏、控制台、线上接口三方消费，
 * 动它的语义等于让所有读点一起重写。而上下游**不属于分类**——同一分类里的站点
 * 可能分布在不同环节（`data` 分类里既有上游的原始数据源，也有下游的分析工具）。
 *
 * 因此：独立的数据文件 + 独立的推断规则，categories 一行不动。
 *
 * ## 硬约束
 *
 * 本文件必须保持**纯数据 + 纯函数 + 零依赖**（不 import node:*，不碰 fs / 网络），
 * 因为它同时被浏览器（视图渲染）与 Node（推断脚本 / 门禁）引用。
 */

/* ================================ 领域定义 ================================ */

/**
 * 领域：一条独立的上下游流水线。
 *
 * `stages` 是有序的 —— 数组顺序**就是**价值链顺序，从最上游到最下游。
 * 不要让调用方自己排序：顺序是这个数据结构唯一重要的语义。
 *
 * stage 的 `id` 全局唯一（跨领域也不复用），因为站点上记的就是这个 id，
 * 复用会让「它到底属于哪条线的哪一环」变成需要领域推断的二次问题。
 */
export const DOMAINS = [
  {
    id: 'onchain',
    label: '链上资产',
    desc: '从「拿到币」到「用币生息」的完整链路',
    color: '#f0b90b',
    stages: [
      { id: 'fiat-onramp', label: '法币入金', desc: '把法币变成加密资产' },
      { id: 'custody', label: '钱包托管', desc: '私钥自持或多签托管' },
      { id: 'transfer', label: '跨链转移', desc: '资产在链与链之间移动' },
      { id: 'swap', label: '兑换做市', desc: '在 DEX 内完成币种兑换' },
      { id: 'lending', label: '借贷收益', desc: '抵押借贷、存款生息' },
      { id: 'staking', label: '质押挖矿', desc: '锁仓换收益、节点运营' },
      { id: 'issuance', label: '资产发行', desc: '稳定币、RWA、NFT 铸造' },
      { id: 'marketplace', label: '交易市场', desc: 'NFT 与衍生品二级市场' },
    ],
  },
  {
    id: 'ai-work',
    label: 'AI 工作流',
    desc: '从「提出问题」到「产出成果」的完整链路',
    color: '#22c55e',
    stages: [
      { id: 'access', label: '模型接入', desc: '取到调用模型能力的 key 与通道' },
      { id: 'chat', label: '对话助手', desc: '直接与模型对话、问答、日常使用' },
      { id: 'prompting', label: '提示设计', desc: '把意图翻译成模型能执行的指令' },
      { id: 'generation', label: '内容生成', desc: '文本、图像、音视频的产出' },
      { id: 'coding', label: '代码实现', desc: 'AI 辅助的编程与调试' },
      { id: 'orchestration', label: '流程编排', desc: '把多个 AI 步骤串成自动化' },
      { id: 'knowledge', label: '知识沉淀', desc: '把产出组织成可复用的知识' },
      { id: 'learning', label: '学习提升', desc: '掌握这套方法论的教程与社区' },
    ],
  },
  {
    id: 'research',
    label: '研究决策',
    desc: '从「看清事实」到「做出判断」的完整链路',
    color: '#3861fb',
    stages: [
      { id: 'raw-data', label: '原始数据', desc: '行情、链上、融资等一手数据' },
      { id: 'analytics', label: '分析工具', desc: '把数据变成可读的图表与指标' },
      { id: 'intel', label: '情报追踪', desc: '新闻、研报、项目动态' },
      { id: 'monitoring', label: '实时监控', desc: '异动告警与风险监测' },
      { id: 'practice', label: '模拟演练', desc: '用历史数据练习判断' },
      { id: 'due-diligence', label: '尽调评估', desc: '项目与合约的深度核查' },
    ],
  },
  {
    id: 'infra',
    label: '基础设施',
    desc: '让上面三条线能跑起来的地基',
    color: '#06b6d4',
    stages: [
      { id: 'compute', label: '算力主机', desc: '云服务器、VPS、GPU 资源' },
      { id: 'network', label: '网络接入', desc: '代理、专线、加速' },
      { id: 'identity', label: '身份账号', desc: '接码、账号、卡密等身份材料' },
      { id: 'chain-base', label: '链上底层', desc: 'L1/L2 公链本身与浏览器' },
      { id: 'security', label: '安全审计', desc: '合约审计与风险监控' },
      { id: 'payment', label: '支付结算', desc: '充值、订阅、账单' },
    ],
  },
]

/** id → 领域。构建一次，避免每次渲染都线性查找 */
export const DOMAIN_BY_ID = new Map(DOMAINS.map((d) => [d.id, d]))

/**
 * stage id → { stage, domain }。**跨领域唯一**，所以用扁平 Map。
 * 若出现重复 id，构建时就抛错 —— 这类错误在运行时表现为「站点跑到别的领域去了」，
 * 极难排查，必须在定义阶段拦住。
 */
export const STAGE_INDEX = (() => {
  const map = new Map()
  for (const d of DOMAINS) {
    for (let i = 0; i < d.stages.length; i++) {
      const s = d.stages[i]
      if (map.has(s.id)) {
        throw new Error(`领域定义错误：stage id「${s.id}」在「${map.get(s.id).domain.id}」与「${d.id}」中重复`)
      }
      map.set(s.id, { stage: s, domain: d, order: i })
    }
  }
  return map
})()

/** 全部 stage id（供校验用） */
export const STAGE_IDS = new Set(STAGE_INDEX.keys())

/* ================================ 位置描述 ================================ */

/**
 * 把「领域 + 环节」换算成一个人能读的位置描述，以及它在流水线上的相对进度。
 *
 * 进度用 `(order + 1) / total`：第 1 环不是 0 而是 1/total ——
 * 「在上游」应该是「已经走过一段」，而不是「什么都没有」。
 */
export function describePosition(stageId) {
  const hit = STAGE_INDEX.get(stageId)
  if (!hit) return null
  const total = hit.domain.stages.length
  return {
    domainId: hit.domain.id,
    domainLabel: hit.domain.label,
    stageId: hit.stage.id,
    stageLabel: hit.stage.label,
    stageDesc: hit.stage.desc,
    order: hit.order,
    total,
    progress: Math.round(((hit.order + 1) / total) * 100),
    /** 人类可读位置，如「链上资产 · 3/8 兑换做市」 */
    label: `${hit.domain.label} · ${hit.order + 1}/${total} ${hit.stage.label}`,
  }
}

/** 某领域里「上游 / 中游 / 下游」的分段（用于颜色与文案） */
export function bandOf(stageId) {
  const hit = STAGE_INDEX.get(stageId)
  if (!hit) return ''
  const ratio = (hit.order + 1) / hit.domain.stages.length
  if (ratio <= 1 / 3) return 'upstream'
  if (ratio <= 2 / 3) return 'midstream'
  return 'downstream'
}

export const BAND_LABEL = {
  upstream: '上游',
  midstream: '中游',
  downstream: '下游',
}

/* ================================ 归属校验 ================================ */

/**
 * 站点记录的位置字段形状：`{ domain: 'onchain', stage: 'swap', source: 'auto'|'manual' }`
 *
 * `source` 是刻意保留的：自动推断的结果要能被人工覆写，而覆写后
 * 重新跑推断**不能把人工结论冲掉**。没有这一位就分不清「这条是机器猜的」和
 * 「这条是人定的」，重跑时只能全量覆盖或全量跳过，两种都错。
 */
export function normalizePosition(raw) {
  if (!raw || typeof raw !== 'object') return null
  const stageId = String(raw.stage || '').trim()
  const hit = STAGE_INDEX.get(stageId)
  if (!hit) return null
  const domain = String(raw.domain || hit.domain.id).trim()
  // domain 与 stage 必须自洽：stage 已经唯一确定了领域，冲突说明数据被改坏了
  if (domain !== hit.domain.id) return null
  return {
    domain: hit.domain.id,
    stage: stageId,
    source: raw.source === 'manual' ? 'manual' : 'auto',
  }
}

/**
 * 统计一个领域里各环节的站点数。
 *
 * 返回的数组**与 stages 等长且同序** —— 视图直接按下标取值，
 * 不用再自己对齐。`empty` 标出空环节，这正是「全局视野」要回答的第一个问题：
 * 这条链上哪一段是断的。
 */
export function domainCoverage(sites, domainId) {
  const d = DOMAIN_BY_ID.get(domainId)
  if (!d) return null
  const buckets = d.stages.map((s) => ({ stage: s, sites: [] }))
  let unplaced = 0
  for (const site of sites || []) {
    const pos = normalizePosition(site.position)
    if (!pos) { unplaced += 1; continue }
    if (pos.domain !== domainId) continue
    const idx = d.stages.findIndex((s) => s.id === pos.stage)
    if (idx >= 0) buckets[idx].sites.push(site)
  }
  const placed = buckets.reduce((a, b) => a + b.sites.length, 0)
  return {
    domain: d,
    buckets: buckets.map((b, i) => ({
      ...b,
      order: i,
      count: b.sites.length,
      empty: b.sites.length === 0,
      band: bandOf(b.stage.id),
    })),
    placed,
    unplaced,
    /** 覆盖率：已定位站点占该领域全部站点的比例 */
    coverage: placed + unplaced > 0 ? Math.round((placed / (placed + unplaced)) * 100) : 0,
    /** 空环节数 —— 断点数量，越小说明这条链越完整 */
    gaps: buckets.filter((b) => b.sites.length === 0).length,
  }
}
