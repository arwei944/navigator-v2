/**
 * 实体抽取（规则词典）。
 *
 * ## 为什么先不用 NER 模型
 *
 * 当前内容以科技 / 加密 / 开发为主，核心实体高度集中（公司、模型、协议、技术）。
 * 一个精编词典 + 别名 + 边界匹配，准确率比通用 NER 更可控，且零模型、零依赖。
 * LLM 可用时，阶段 2 后半可以让 LLM 补充词典外实体；接口保持不变。
 *
 * ## 边界
 *
 * 英文别名用 `(?<![a-z0-9])…(?![a-z0-9])` 防止 `GPT` 命中 `GPT-4` 之外的词，
 * 但允许 `GPT-4` 作为独立别名；中文别名直接包含匹配。
 * 只返回去重后的前 N 个，避免一条新闻挂十几个泛实体。
 */

const DICTIONARY = [
  // AI 公司 / 模型
  { id: 'openai', name: 'OpenAI', kind: 'company', aliases: ['openai', 'chatgpt', 'gpt-4', 'gpt-5', 'gpt'] },
  { id: 'anthropic', name: 'Anthropic', kind: 'company', aliases: ['anthropic', 'claude'] },
  { id: 'google-deepmind', name: 'Google DeepMind', kind: 'company', aliases: ['deepmind', 'google deepmind', 'gemini'] },
  { id: 'meta-ai', name: 'Meta AI', kind: 'company', aliases: ['meta ai', 'llama', 'meta'] },
  { id: 'microsoft', name: 'Microsoft', kind: 'company', aliases: ['microsoft', 'azure', 'copilot'] },
  { id: 'nvidia', name: 'NVIDIA', kind: 'company', aliases: ['nvidia', '英伟达'] },
  { id: 'xai', name: 'xAI', kind: 'company', aliases: ['xai', 'grok'] },
  { id: 'mistral', name: 'Mistral AI', kind: 'company', aliases: ['mistral'] },
  { id: 'deepseek', name: 'DeepSeek', kind: 'company', aliases: ['deepseek', '深度求索'] },
  { id: 'alibaba', name: 'Alibaba', kind: 'company', aliases: ['alibaba', 'qwen', '通义', '阿里'] },
  { id: 'bytedance', name: 'ByteDance', kind: 'company', aliases: ['bytedance', 'doubao', '豆包', '字节'] },
  { id: 'huggingface', name: 'Hugging Face', kind: 'company', aliases: ['hugging face', 'huggingface'] },
  { id: 'stability', name: 'Stability AI', kind: 'company', aliases: ['stability ai', 'stable diffusion'] },
  { id: 'midjourney', name: 'Midjourney', kind: 'company', aliases: ['midjourney'] },
  { id: 'perplexity', name: 'Perplexity', kind: 'company', aliases: ['perplexity'] },
  { id: 'langchain', name: 'LangChain', kind: 'tech', aliases: ['langchain'] },
  { id: 'ollama', name: 'Ollama', kind: 'tech', aliases: ['ollama'] },
  { id: 'rag', name: 'RAG', kind: 'tech', aliases: ['rag', 'retrieval-augmented'] },
  { id: 'agent', name: 'AI Agent', kind: 'tech', aliases: ['ai agent', 'agents', '智能体'] },

  // 加密 / 链上
  { id: 'bitcoin', name: 'Bitcoin', kind: 'asset', aliases: ['bitcoin', 'btc', '比特币'] },
  { id: 'ethereum', name: 'Ethereum', kind: 'asset', aliases: ['ethereum', 'eth', '以太坊'] },
  { id: 'solana', name: 'Solana', kind: 'asset', aliases: ['solana', 'sol'] },
  { id: 'binance', name: 'Binance', kind: 'company', aliases: ['binance', '币安'] },
  { id: 'coinbase', name: 'Coinbase', kind: 'company', aliases: ['coinbase'] },
  { id: 'blackrock', name: 'BlackRock', kind: 'company', aliases: ['blackrock', '贝莱德'] },
  { id: 'circle', name: 'Circle', kind: 'company', aliases: ['circle', 'usdc'] },
  { id: 'tether', name: 'Tether', kind: 'company', aliases: ['tether', 'usdt'] },
  { id: 'uniswap', name: 'Uniswap', kind: 'protocol', aliases: ['uniswap'] },
  { id: 'aave', name: 'Aave', kind: 'protocol', aliases: ['aave'] },
  { id: 'defi', name: 'DeFi', kind: 'sector', aliases: ['defi', '去中心化金融'] },
  { id: 'stablecoin', name: '稳定币', kind: 'sector', aliases: ['stablecoin', 'stablecoins', '稳定币'] },
  { id: 'etf', name: 'ETF', kind: 'sector', aliases: ['etf', 'etfs'] },
  { id: 'layer2', name: 'Layer 2', kind: 'tech', aliases: ['layer 2', 'layer2', 'rollup', 'rollups'] },
  { id: 'sec', name: 'SEC', kind: 'regulator', aliases: ['sec', 'securities and exchange commission'] },
  { id: 'occ', name: 'OCC', kind: 'regulator', aliases: ['occ', 'office of the comptroller'] },
  { id: 'genius-act', name: 'GENIUS Act', kind: 'regulation', aliases: ['genius act'] },

  // 开发 / 基础设施
  { id: 'kubernetes', name: 'Kubernetes', kind: 'tech', aliases: ['kubernetes', 'k8s'] },
  { id: 'docker', name: 'Docker', kind: 'tech', aliases: ['docker'] },
  { id: 'rust', name: 'Rust', kind: 'tech', aliases: ['rust'] },
  { id: 'typescript', name: 'TypeScript', kind: 'tech', aliases: ['typescript'] },
  { id: 'react', name: 'React', kind: 'tech', aliases: ['react', 'reactjs'] },
  { id: 'vue', name: 'Vue', kind: 'tech', aliases: ['vue', 'vuejs', 'vue.js'] },
  { id: 'cloudflare', name: 'Cloudflare', kind: 'company', aliases: ['cloudflare'] },
  { id: 'aws', name: 'AWS', kind: 'company', aliases: ['aws', 'amazon web services'] },
  { id: 'postgres', name: 'PostgreSQL', kind: 'tech', aliases: ['postgres', 'postgresql'] },
  { id: 'sqlite', name: 'SQLite', kind: 'tech', aliases: ['sqlite'] },
  { id: 'github', name: 'GitHub', kind: 'company', aliases: ['github'] },
  { id: 'linux', name: 'Linux', kind: 'tech', aliases: ['linux'] },
  { id: 'wasm', name: 'WebAssembly', kind: 'tech', aliases: ['webassembly', 'wasm'] },
  { id: 'security', name: '安全漏洞', kind: 'sector', aliases: ['vulnerability', 'vulnerabilities', 'security flaw', '漏洞'] },

  // 人物
  { id: 'sam-altman', name: 'Sam Altman', kind: 'person', aliases: ['sam altman'] },
  { id: 'elon-musk', name: 'Elon Musk', kind: 'person', aliases: ['elon musk', '马斯克'] },
  { id: 'vitalik', name: 'Vitalik Buterin', kind: 'person', aliases: ['vitalik', 'vitalik buterin'] },
  { id: 'jensen-huang', name: 'Jensen Huang', kind: 'person', aliases: ['jensen huang', '黄仁勋'] },
]

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const MATCHERS = DICTIONARY.map(entity => {
  const aliases = [...new Set([entity.name, ...(entity.aliases || [])])]
    .map(a => String(a).toLowerCase())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  return {
    ...entity,
    patterns: aliases.map(alias => {
      const escaped = escapeRegExp(alias)
      // 含中文的别名直接包含；英文加词边界
      const isCjk = /[㐀-鿿]/.test(alias)
      return isCjk
        ? new RegExp(escaped, 'i')
        : new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i')
    }),
  }
})

/**
 * @param {string} text
 * @param {{max?:number}} [opts]
 * @returns {{id:string,name:string,kind:string}[]}
 */
export function extractEntities(text, { max = 8 } = {}) {
  const value = String(text || '')
  if (!value) return []
  const hits = []
  for (const entity of MATCHERS) {
    if (entity.patterns.some(re => re.test(value))) {
      hits.push({ id: entity.id, name: entity.name, kind: entity.kind })
      if (hits.length >= max) break
    }
  }
  return hits
}

/** 供后台展示：词典规模与分类 */
export function entityCatalog() {
  return DICTIONARY.map(({ id, name, kind, aliases }) => ({ id, name, kind, aliases: aliases || [] }))
}