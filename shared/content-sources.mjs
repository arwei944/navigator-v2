/**
 * 首批内容源（阶段 0）。
 *
 * ## 选取标准
 *
 * 1. **发布方主动提供结构化数据**：RSS / Atom / JSON Feed / 官方 API；
 * 2. 2026-10-22 实测可达（HTTP 200 + XML/JSON）；
 * 3. 覆盖 AI、研究、加密、工具/基础设施四个域；
 * 4. 只存标题、摘要、回链，不抓全文。
 *
 * 不在首批里的源（36Kr、Hugging Face papers、Papers with Code、Figma）实测
 * 返回 HTML/401/404，等阶段 1 的页面适配器再处理。
 *
 * `url` 里的 `{since}` 由抓取器替换为「7 天前」的日期（GitHub 搜索用）。
 */
export const CONTENT_SOURCES = [
  // ── AI / 研究 ──
  {
    id: 'hn', label: 'Hacker News', type: 'hn',
    url: 'https://hacker-news.firebaseio.com/v0/topstories.json',
    domain: 'ai-work', categoryId: 'learning', weight: 1.15, maxItems: 30,
  },
  {
    id: 'arxiv-ai', label: 'arXiv cs.AI', type: 'arxiv',
    url: 'https://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=30',
    domain: 'research', categoryId: 'learning', weight: 1.3, maxItems: 30,
  },
  {
    id: 'openai', label: 'OpenAI News', type: 'rss',
    url: 'https://openai.com/news/rss.xml',
    domain: 'ai-work', categoryId: 'starter', weight: 1.3,
  },
  {
    id: 'googleai', label: 'Google AI Blog', type: 'rss',
    url: 'https://blog.google/technology/ai/rss/',
    domain: 'ai-work', categoryId: 'learning', weight: 1.25,
  },
  {
    id: 'deepmind', label: 'Google DeepMind', type: 'rss',
    url: 'https://deepmind.google/blog/rss.xml',
    domain: 'research', categoryId: 'learning', weight: 1.3,
  },
  {
    id: 'mit-tr', label: 'MIT Technology Review', type: 'rss',
    url: 'https://www.technologyreview.com/feed/',
    domain: 'research', categoryId: 'learning', weight: 1.15,
  },
  {
    id: 'arstechnica', label: 'Ars Technica', type: 'rss',
    url: 'https://feeds.arstechnica.com/arstechnica/index',
    domain: 'research', categoryId: 'learning', weight: 1.1,
  },
  {
    id: 'techcrunch', label: 'TechCrunch', type: 'rss',
    url: 'https://techcrunch.com/feed/',
    domain: 'research', categoryId: 'learning', weight: 1.0,
  },
  {
    id: 'ruanyifeng', label: '阮一峰的网络日志', type: 'rss',
    url: 'https://www.ruanyifeng.com/blog/atom.xml',
    domain: 'research', categoryId: 'learning', weight: 1.1,
  },

  // ── 加密 / 链上 ──
  {
    id: 'coindesk', label: 'CoinDesk', type: 'rss',
    url: 'https://www.coindesk.com/arc/outboundfeeds/rss',
    domain: 'onchain', categoryId: 'media', weight: 1.15,
  },
  {
    id: 'theblock', label: 'The Block', type: 'rss',
    url: 'https://www.theblock.co/rss.xml',
    domain: 'onchain', categoryId: 'media', weight: 1.15,
  },
  {
    id: 'cointelegraph', label: 'Cointelegraph', type: 'rss',
    url: 'https://cointelegraph.com/rss',
    domain: 'onchain', categoryId: 'media', weight: 1.0,
  },
  {
    id: 'decrypt', label: 'Decrypt', type: 'rss',
    url: 'https://decrypt.co/feed',
    domain: 'onchain', categoryId: 'media', weight: 1.0,
  },

  // ── 开发 / 工具 / 基础设施 ──
  {
    id: 'github-trending', label: 'GitHub 新项目', type: 'github',
    url: 'https://api.github.com/search/repositories?q=created:%3E{since}&sort=stars&order=desc&per_page=20',
    domain: 'ai-work', categoryId: 'coding', weight: 1.15, maxItems: 20,
  },
  {
    id: 'githubblog', label: 'GitHub Blog', type: 'rss',
    url: 'https://github.blog/feed/',
    domain: 'infra', categoryId: 'projects', weight: 1.1,
  },
  {
    id: 'cloudflare', label: 'Cloudflare Blog', type: 'rss',
    url: 'https://blog.cloudflare.com/rss/',
    domain: 'infra', categoryId: 'cloud', weight: 1.2,
  },
  {
    id: 'css-tricks', label: 'CSS-Tricks', type: 'rss',
    url: 'https://css-tricks.com/feed/',
    domain: 'infra', categoryId: 'projects', weight: 0.95,
  },
  {
    id: 'smashing', label: 'Smashing Magazine', type: 'rss',
    url: 'https://www.smashingmagazine.com/feed/',
    domain: 'infra', categoryId: 'projects', weight: 0.9,
  },
  {
    id: 'devto', label: 'DEV Community', type: 'rss',
    url: 'https://dev.to/feed',
    domain: 'infra', categoryId: 'projects', weight: 0.85,
  },
  {
    id: 'react', label: 'React Blog', type: 'rss',
    url: 'https://react.dev/rss.xml',
    domain: 'infra', categoryId: 'projects', weight: 1.0,
  },
  {
    id: 'vue', label: 'Vue Blog', type: 'rss',
    url: 'https://blog.vuejs.org/feed.rss',
    domain: 'infra', categoryId: 'projects', weight: 1.0,
  },
  {
    id: 'producthunt', label: 'Product Hunt', type: 'rss',
    url: 'https://www.producthunt.com/feed',
    domain: 'infra', categoryId: 'projects', weight: 0.9,
  },
  {
    id: 'sspai', label: '少数派', type: 'rss',
    url: 'https://sspai.com/feed',
    domain: 'infra', categoryId: 'projects', weight: 1.0,
  },
  {
    id: 'v2ex', label: 'V2EX 热门', type: 'v2ex',
    url: 'https://www.v2ex.com/api/topics/hot.json',
    domain: 'infra', categoryId: 'projects', weight: 0.8, maxItems: 30,
  },
]

/** 默认抓取间隔（分钟）与并发 */
export const CONTENT_DEFAULTS = {
  intervalMinutes: 20,
  concurrency: 4,
  // 实测 Smashing / GitHub Blog 的 RSS 超过 1.2 MB，1 MB 会在 CDATA 中间截断
  timeoutMs: 25000,
  maxBytes: 4 * 1024 * 1024,
  robotsTimeoutMs: 3000,
  entryTtlDays: 30,
  logTtlDays: 7,
}