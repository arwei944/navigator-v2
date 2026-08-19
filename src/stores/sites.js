import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import Fuse from 'fuse.js'
import { pinyin } from 'pinyin-pro'

export const useSitesStore = defineStore('sites', () => {
  const sites = ref(SEED_SITES)
  const searchQuery = ref('')
  const currentCategory = ref('all')
  const sortBy = ref('default')
  const viewMode = ref('grid') // grid | list

  // 回收站
  const trash = ref([])

  // 批量选择
  const batchMode = ref(false)
  const selectedIds = ref(new Set())

  // 拼音索引缓存
  let pinyinIndex = null

  // 构建拼音索引
  function buildPinyinIndex(sitesList) {
    return sitesList.map(s => ({
      ...s,
      _pinyinName: pinyin(s.name, { toneType: 'none', separator: '' }).toLowerCase(),
      _pinyinDesc: pinyin(s.desc, { toneType: 'none', separator: '' }).toLowerCase(),
      _pinyinInitial: pinyin(s.name, { pattern: 'first', toneType: 'none', separator: '' }).toLowerCase()
    }))
  }

  // Fuse 实例
  let fuseInstance = null
  function getFuse() {
    if (!fuseInstance || fuseInstance._items !== sites.value) {
      const withPinyin = buildPinyinIndex(sites.value)
      pinyinIndex = withPinyin
      fuseInstance = new Fuse(withPinyin, {
        keys: [
          { name: 'name', weight: 2 },
          { name: 'desc', weight: 1 },
          { name: 'url', weight: 1 },
          { name: '_pinyinName', weight: 1.5 },
          { name: '_pinyinDesc', weight: 0.8 },
          { name: '_pinyinInitial', weight: 1.5 }
        ],
        threshold: 0.4,
        distance: 100,
        includeScore: true
      })
      fuseInstance._items = sites.value
    }
    return { fuse: fuseInstance, index: pinyinIndex }
  }

  const filteredSites = computed(() => {
    let result = [...sites.value]

    // 分类筛选
    if (currentCategory.value !== 'all') {
      result = result.filter(s => s.categoryId === currentCategory.value)
    }

    // 搜索过滤
    const q = searchQuery.value.trim().toLowerCase()
    if (q) {
      // 先尝试精确匹配
      const exact = result.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.desc.toLowerCase().includes(q) ||
        s.url.toLowerCase().includes(q)
      )
      if (exact.length > 0) {
        result = exact
      } else {
        // 使用 Fuse 模糊搜索 + 拼音
        try {
          const { fuse } = getFuse()
          const fuseResults = fuse.search(q)
          const matchedIds = new Set(fuseResults.map(r => r.item.id))
          result = result.filter(s => matchedIds.has(s.id))
          // 按匹配分数排序
          const scoreMap = new Map(fuseResults.map(r => [r.item.id, r.score]))
          result.sort((a, b) => (scoreMap.get(a.id) || 1) - (scoreMap.get(b.id) || 1))
        } catch (e) {
          // fallback
          result = result.filter(s =>
            s.name.toLowerCase().includes(q) ||
            s.desc.toLowerCase().includes(q) ||
            s.url.toLowerCase().includes(q)
          )
        }
      }
    }

    // 排序
    switch (sortBy.value) {
      case 'name-asc': result.sort((a, b) => a.name.localeCompare(b.name)); break
      case 'name-desc': result.sort((a, b) => b.name.localeCompare(a.name)); break
      case 'hot': result.sort((a, b) => b.visitCount - a.visitCount); break
      case 'newest': result.sort((a, b) => b.createdAt - a.createdAt); break
      default: break
    }

    return result
  })

  function addSite(site) {
    sites.value.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      sortOrder: sites.value.length,
      visitCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...site
    })
  }

  function updateSite(id, data) {
    const idx = sites.value.findIndex(s => s.id === id)
    if (idx !== -1) {
      sites.value[idx] = { ...sites.value[idx], ...data, updatedAt: Date.now() }
    }
  }

  function updateSiteField(id, key, value) {
    const idx = sites.value.findIndex(s => s.id === id)
    if (idx !== -1) {
      sites.value[idx][key] = value
      sites.value[idx].updatedAt = Date.now()
    }
  }

  function deleteSite(id) {
    const site = sites.value.find(s => s.id === id)
    if (site) {
      trash.value.push({ ...site, deletedAt: Date.now() })
      sites.value = sites.value.filter(s => s.id !== id)
    }
  }

  function recordVisit(id) {
    const site = sites.value.find(s => s.id === id)
    if (site) site.visitCount++
  }

  function reorderSites(newOrderedSites) {
    sites.value = newOrderedSites.map((site, index) => ({
      ...site,
      sortOrder: index
    }))
  }

  function setSearchQuery(q) { searchQuery.value = q }
  function setCategory(cat) { currentCategory.value = cat }
  function setSortBy(s) { sortBy.value = s }
  function setViewMode(m) { viewMode.value = m }

  // ── 批量选择 ──
  function toggleBatchMode() {
    batchMode.value = !batchMode.value
    if (!batchMode.value) {
      selectedIds.value = new Set()
    }
  }

  function toggleSelect(id) {
    const newSet = new Set(selectedIds.value)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    selectedIds.value = newSet
  }

  function selectAll(ids) {
    selectedIds.value = new Set(ids)
  }

  function clearSelection() {
    selectedIds.value = new Set()
  }

  function batchDeleteToTrash(targetIds) {
    const ids = targetIds || [...selectedIds.value]
    ids.forEach(id => {
      const site = sites.value.find(s => s.id === id)
      if (site) {
        trash.value.push({ ...site, deletedAt: Date.now() })
      }
    })
    sites.value = sites.value.filter(s => !ids.includes(s.id))
    selectedIds.value = new Set()
  }

  // ── 回收站管理 ──
  function restoreFromTrash(id) {
    const idx = trash.value.findIndex(s => s.id === id)
    if (idx !== -1) {
      const site = trash.value[idx]
      delete site.deletedAt
      sites.value.push(site)
      trash.value.splice(idx, 1)
    }
  }

  function permanentDelete(id) {
    trash.value = trash.value.filter(s => s.id !== id)
  }

  function emptyTrash() {
    trash.value = []
  }

  return {
    sites, searchQuery, currentCategory, sortBy, viewMode,
    filteredSites, trash, batchMode, selectedIds,
    addSite, updateSite, updateSiteField, deleteSite, recordVisit, reorderSites,
    setSearchQuery, setCategory, setSortBy, setViewMode,
    toggleBatchMode, toggleSelect, selectAll, clearSelection, batchDeleteToTrash,
    restoreFromTrash, permanentDelete, emptyTrash
  }
})

const SEED_SITES = [
  // ── 入门对话 ──
  { id: 's1', name: 'ChatGPT', url: 'chat.openai.com', desc: 'OpenAI 对话助手，AI 入门首选，支持文本生成、编程、翻译和问答。', categoryId: 'starter', color: '#22c55e', initial: 'C', sortOrder: 0, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 's2', name: 'Claude', url: 'claude.ai', desc: 'Anthropic AI 助手，长文本处理最强，适合深度分析和创作辅助。', categoryId: 'starter', color: '#f97316', initial: 'C', sortOrder: 1, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 's3', name: 'DeepSeek', url: 'chat.deepseek.com', desc: '国产免费大模型，推理能力强，中文语境表现出色。', categoryId: 'starter', color: '#0ea5e9', initial: 'D', sortOrder: 2, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 's4', name: 'Kimi', url: 'kimi.moonshot.cn', desc: '国产长文本 AI 助手，擅长处理大文档和深度阅读。', categoryId: 'starter', color: '#8b5cf6', initial: 'K', sortOrder: 3, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 's5', name: '豆包', url: 'doubao.com', desc: '字节跳动 AI 助手，中文场景友好，集成多种实用功能。', categoryId: 'starter', color: '#1e3a5f', initial: 'D', sortOrder: 4, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── 提示词工程 ──
  { id: 'p1', name: 'Learn Prompting', url: 'learnprompting.com', desc: '最系统的提示词在线教程，从入门到高级技巧全覆盖。', categoryId: 'prompt', color: '#3b82f6', initial: 'L', sortOrder: 5, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'p2', name: 'Prompt Engineering Guide', url: 'promptingguide.ai', desc: 'OpenAI 工程师撰写的提示词指南，技术深度高（含中文版）。', categoryId: 'prompt', color: '#6366f1', initial: 'P', sortOrder: 6, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'p3', name: 'FlowGPT', url: 'flowgpt.com', desc: '社区驱动的提示词模板库，发现和分享高质量提示词。', categoryId: 'prompt', color: '#06b6d4', initial: 'F', sortOrder: 7, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── 写作与内容 ──
  { id: 'w1', name: 'Notion AI', url: 'notion.so', desc: 'AI 增强的知识管理工具，笔记、写作、数据库和协作一体化。', categoryId: 'writing', color: '#1f2937', initial: 'N', sortOrder: 8, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'w2', name: 'Gamma', url: 'gamma.app', desc: 'AI 一键生成 PPT/文档/网页，排版精美，适合快速出稿。', categoryId: 'writing', color: '#6c2bd9', initial: 'G', sortOrder: 9, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'w3', name: 'Perplexity', url: 'perplexity.ai', desc: 'AI 搜索引擎，答案附带来源引用，适合深度研究和学习。', categoryId: 'writing', color: '#1a1a2e', initial: 'P', sortOrder: 10, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'w4', name: 'Napkin', url: 'napkin.ai', desc: 'AI 文字转图表工具，一句话生成信息图和数据可视化。', categoryId: 'writing', color: '#0ea5e9', initial: 'N', sortOrder: 11, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── 编程与开发 ──
  { id: 'cd1', name: 'Cursor', url: 'cursor.com', desc: 'AI 原生代码编辑器，智能补全、重构和 Debug，新手也能写代码。', categoryId: 'coding', color: '#1a1a1a', initial: 'C', sortOrder: 12, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'cd2', name: 'GitHub Copilot', url: 'github.com/features/copilot', desc: 'AI 代码补全助手，VS Code 集成，让编程效率翻倍。', categoryId: 'coding', color: '#8957e5', initial: 'G', sortOrder: 13, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'cd3', name: 'Replit', url: 'replit.com', desc: '在线 IDE + AI 编程，零配置即可开发和部署应用。', categoryId: 'coding', color: '#f97316', initial: 'R', sortOrder: 14, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'cd4', name: 'v0 by Vercel', url: 'v0.dev', desc: 'AI 生成前端界面，文字描述即出 React 和 Tailwind 代码。', categoryId: 'coding', color: '#1f2937', initial: 'V', sortOrder: 15, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'cd5', name: 'Bolt.new', url: 'bolt.new', desc: 'AI 全栈应用生成器，对话式搭建完整 Web 应用。', categoryId: 'coding', color: '#6366f1', initial: 'B', sortOrder: 16, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'cd6', name: 'Lovable', url: 'lovable.dev', desc: 'AI 应用构建平台，自然语言描述即可生成完整功能性应用。', categoryId: 'coding', color: '#e11d48', initial: 'L', sortOrder: 17, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'cd7', name: 'DevTools.sh', url: 'devtools.sh', desc: '在线开发者工具集合，JSON 格式化、代码转换、正则测试等实用工具。', categoryId: 'coding', color: '#6366f1', initial: 'D', sortOrder: 18, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── 设计与创意 ──
  { id: 'g1', name: 'Midjourney', url: 'midjourney.com', desc: '顶级 AI 图像生成，文字描述即可创作高质量艺术作品。', categoryId: 'design', color: '#374151', initial: 'M', sortOrder: 18, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'g2', name: 'Stable Diffusion', url: 'stability.ai', desc: '开源 AI 图像生成，支持本地部署和高度自定义控制。', categoryId: 'design', color: '#a855f7', initial: 'S', sortOrder: 19, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'g3', name: 'Runway', url: 'runwayml.com', desc: 'AI 视频生成与编辑平台，文生视频、视频修复、绿幕去除。', categoryId: 'design', color: '#0d0d0d', initial: 'R', sortOrder: 20, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'g4', name: 'Suno', url: 'suno.com', desc: 'AI 音乐生成平台，用文字描述创作完整歌曲和音乐作品。', categoryId: 'design', color: '#6366f1', initial: 'S', sortOrder: 21, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'g5', name: 'ElevenLabs', url: 'elevenlabs.io', desc: 'AI 语音合成，TTS、语音克隆、多语言有声书制作，效果逼真。', categoryId: 'design', color: '#1a1a1a', initial: 'E', sortOrder: 22, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'g6', name: 'Canva AI', url: 'canva.com', desc: 'AI 设计平台，设计小白也能轻松制作专业级视觉内容。', categoryId: 'design', color: '#8b5cf6', initial: 'C', sortOrder: 23, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── 深度工作流 ──
  { id: 'f1', name: 'Zapier AI', url: 'zapier.com', desc: 'AI 自动化工作流，连接数百个应用，自动完成重复任务。', categoryId: 'workflow', color: '#ff4a00', initial: 'Z', sortOrder: 24, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'f2', name: 'Make', url: 'make.com', desc: '可视化自动化平台，比 Zapier 更灵活，可搭建复杂工作流。', categoryId: 'workflow', color: '#3b82f6', initial: 'M', sortOrder: 25, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'f3', name: 'Dify', url: 'dify.ai', desc: '开源 LLM 应用平台，可视化编排 AI 工作流和 RAG 管道。', categoryId: 'workflow', color: '#22c55e', initial: 'D', sortOrder: 26, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'f4', name: 'Coze', url: 'coze.com', desc: '字节跳动 Bot 构建平台，无需编程创建自定义 AI 助手。', categoryId: 'workflow', color: '#1e3a5f', initial: 'C', sortOrder: 27, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'f5', name: 'LangChain', url: 'langchain.com', desc: 'AI 应用开发框架，构建 LLM 应用和 Agent 的核心工具。', categoryId: 'workflow', color: '#06b6d4', initial: 'L', sortOrder: 28, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'f6', name: 'Hugging Face', url: 'huggingface.co', desc: 'AI 开源模型中心，模型库、数据集、Spaces 社区生态。', categoryId: 'workflow', color: '#ffd21e', initial: 'H', sortOrder: 29, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'f7', name: 'Ollama', url: 'ollama.com', desc: '本地运行开源大模型，一键下载和部署，隐私安全。', categoryId: 'workflow', color: '#1a1a1a', initial: 'O', sortOrder: 30, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── 学习与前沿 ──
  { id: 'l1', name: 'Fast.ai', url: 'fast.ai', desc: '实践派 AI 教程，从代码入手学深度学习，适合零基础。', categoryId: 'learning', color: '#ef4444', initial: 'F', sortOrder: 31, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'l2', name: 'Kaggle', url: 'kaggle.com', desc: '数据科学竞赛平台，练手数据集、Notebook 和 GPU 资源。', categoryId: 'learning', color: '#20beff', initial: 'K', sortOrder: 32, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'l3', name: 'Google Colab', url: 'colab.research.google.com', desc: '免费在线 Jupyter 环境，内置 GPU 可跑 AI 模型。', categoryId: 'learning', color: '#f9ab00', initial: 'G', sortOrder: 33, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'l4', name: '机器之心', url: 'jiqizhixin.com', desc: '中文 AI 深度媒体，技术报道、行业分析和年度评选权威。', categoryId: 'learning', color: '#1a1a2e', initial: '机', sortOrder: 34, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'l5', name: '量子位', url: 'qbitai.com', desc: '中文 AI 资讯快速追踪，产品动态和商业落地一手信息。', categoryId: 'learning', color: '#3b82f6', initial: '量', sortOrder: 35, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'l6', name: 'TLDR AI', url: 'tldr.tech/ai', desc: '每日 5 分钟 AI 速览，全球 AI 新闻精华摘要，必订阅。', categoryId: 'learning', color: '#ec4899', initial: 'T', sortOrder: 36, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'l7', name: 'ArXiv', url: 'arxiv.org', desc: '学术论文预印本平台，每日更新 AI 前沿研究成果。', categoryId: 'learning', color: '#b91c1c', initial: 'A', sortOrder: 37, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'l8', name: 'Product Hunt AI', url: 'producthunt.com', desc: '每天发现最新 AI 产品，社区投票筛选优质工具。', categoryId: 'learning', color: '#da552f', initial: 'P', sortOrder: 38, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'l9', name: 'GitHub Trending', url: 'github.com/trending', desc: '每日开源项目趋势榜，跟踪最新 AI 开源工具和框架。', categoryId: 'learning', color: '#1f2937', initial: 'G', sortOrder: 39, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── 交易所 CEX ──
  { id: 'ex1', name: 'Binance', url: 'binance.com', desc: '全球最大加密货币交易所，现货、合约、Launchpad 和 Web3 钱包，生态最完整。', categoryId: 'cex', color: '#f0b90b', initial: 'B', sortOrder: 40, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ex2', name: 'OKX', url: 'okx.com', desc: '全球领先交易所，现货、衍生品、DeFi 和 NFT 一站式平台，Web3 钱包体验优秀。', categoryId: 'cex', color: '#1a1a1a', initial: 'O', sortOrder: 41, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ex3', name: 'Coinbase', url: 'coinbase.com', desc: '美国合规上市交易所，Coinbase 生态最齐全，机构首选出入金通道。', categoryId: 'cex', color: '#0052ff', initial: 'C', sortOrder: 42, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ex4', name: 'Bybit', url: 'bybit.com', desc: '新兴交易所标杆，衍生品交易深度好，产品体验流畅，用户增长迅猛。', categoryId: 'cex', color: '#1a1a2e', initial: 'B', sortOrder: 43, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ex5', name: 'KuCoin', url: 'kucoin.com', desc: '老牌交易所，上币积极，支持大量小币种，被称为"小币种天堂"。', categoryId: 'cex', color: '#24ae8f', initial: 'K', sortOrder: 44, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ex6', name: 'Gate.io', url: 'gate.io', desc: '老牌交易所，上币速度快，Launchpad 打新机会多，衍生品齐全。', categoryId: 'cex', color: '#1f4b8e', initial: 'G', sortOrder: 45, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ex7', name: 'Kraken', url: 'kraken.com', desc: '美国合规交易所，安全性高，支持法币出入金，机构用户首选。', categoryId: 'cex', color: '#5741d9', initial: 'K', sortOrder: 46, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ex8', name: 'MEXC', url: 'mexc.com', desc: '全球交易所，上币速度极快，新项目首发平台，交易深度中等。', categoryId: 'cex', color: '#1a1a1a', initial: 'M', sortOrder: 47, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ex9', name: 'HTX', url: 'htx.com', desc: '火币品牌升级，老牌交易所，合约和现货交易深度好，中文用户多。', categoryId: 'cex', color: '#0b1527', initial: 'H', sortOrder: 48, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── 去中心化交易所 DEX ──
  { id: 'dx1', name: 'Uniswap', url: 'uniswap.org', desc: '以太坊最核心 DEX，AMM 自动做市鼻祖，流动性最强，跨链 Swap 支持。', categoryId: 'dex', color: '#ff007a', initial: 'U', sortOrder: 49, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'dx2', name: 'PancakeSwap', url: 'pancakeswap.finance', desc: 'BSC 最大 DEX，Swap、农场、彩票、NFT 市场一站式 DeFi 平台。', categoryId: 'dex', color: '#542f8b', initial: 'P', sortOrder: 50, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'dx3', name: 'Jupiter', url: 'jup.ag', desc: 'Solana 生态最大 DEX 聚合器，最优路由、低滑点，Solana 必备。', categoryId: 'dex', color: '#ff8c00', initial: 'J', sortOrder: 51, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'dx4', name: 'Curve', url: 'curve.fi', desc: '稳定币兑换 DEX 之王，低滑点、高流动性，DeFi 基础设施级协议。', categoryId: 'dex', color: '#0077ff', initial: 'C', sortOrder: 52, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'dx5', name: '1inch', url: '1inch.io', desc: 'DEX 聚合器，智能路由最优价格，覆盖多链流动性池。', categoryId: 'dex', color: '#1a1a2e', initial: '1', sortOrder: 53, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'dx6', name: 'SushiSwap', url: 'sushi.com', desc: '多链 DEX 平台，AMM 做市 + 借贷 + 质押，社区驱动治理。', categoryId: 'dex', color: '#fa52a0', initial: 'S', sortOrder: 54, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'dx7', name: 'Balancer', url: 'balancer.fi', desc: '可自定义权重的 AMM 协议，支持多资产池和流动性管理。', categoryId: 'dex', color: '#1a1a1a', initial: 'B', sortOrder: 55, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'dx8', name: 'Raydium', url: 'raydium.io', desc: 'Solana 生态核心 DEX，AMM + 限价单 + 流动性挖矿。', categoryId: 'dex', color: '#22c55e', initial: 'R', sortOrder: 56, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── DeFi 借贷/收益 ──
  { id: 'df1', name: 'Aave', url: 'aave.com', desc: '去中心化借贷龙头，支持存款赚息、抵押借贷和闪电贷，多链部署。', categoryId: 'defi', color: '#2ebac6', initial: 'A', sortOrder: 57, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'df2', name: 'Lido', url: 'lido.fi', desc: '最大流动性质押协议，stETH/ETH 质押，降低运行节点门槛。', categoryId: 'defi', color: '#22c55e', initial: 'L', sortOrder: 58, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'df3', name: 'EigenLayer', url: 'eigenlayer.xyz', desc: '以太坊再质押协议，引入 AVS 机制，扩展加密经济安全。', categoryId: 'defi', color: '#6f42c1', initial: 'E', sortOrder: 59, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'df4', name: 'Pendle', url: 'pendle.finance', desc: '收益代币化协议，可将未来收益拆分为 PT 和 YT 交易，DeFi 创新标杆。', categoryId: 'defi', color: '#6366f1', initial: 'P', sortOrder: 60, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'df5', name: 'Morpho', url: 'morpho.org', desc: '高效借贷协议，优化利率匹配，比传统借贷池效率更高。', categoryId: 'defi', color: '#1a1a1a', initial: 'M', sortOrder: 61, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'df6', name: 'Compound', url: 'compound.finance', desc: '老牌 DeFi 借贷协议，cToken 机制，存款即赚取利息。', categoryId: 'defi', color: '#00d395', initial: 'C', sortOrder: 62, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── 数据与研究 ──
  { id: 'dt1', name: 'CoinMarketCap', url: 'coinmarketcap.com', desc: '权威行情追踪平台，实时价格、市值、交易量排名，币圈入门必备。', categoryId: 'data', color: '#3861fb', initial: 'C', sortOrder: 63, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'dt2', name: 'CoinGecko', url: 'coingecko.com', desc: '独立数据聚合器，行情、排名、基本面分析，社区评分体系完善。', categoryId: 'data', color: '#8dc63f', initial: 'C', sortOrder: 64, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'dt3', name: 'TradingView', url: 'tradingview.com', desc: '专业图表分析平台，K 线、技术指标、社区策略，交易者必备工具。', categoryId: 'data', color: '#2196f3', initial: 'T', sortOrder: 65, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'dt4', name: 'DeFiLlama', url: 'defillama.com', desc: 'DeFi 数据聚合之王，TVL 追踪、收益率对比、多链协议数据全覆盖。', categoryId: 'data', color: '#00a3ff', initial: 'D', sortOrder: 66, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'dt5', name: 'Token Terminal', url: 'tokenterminal.com', desc: '链上财务数据平台，分析协议收入、P/E 比率和基本面指标。', categoryId: 'data', color: '#1a1a2e', initial: 'T', sortOrder: 67, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'dt6', name: 'Nansen', url: 'nansen.ai', desc: '链上数据智能平台，标记地址标签，追踪聪明钱和巨鲸动向。', categoryId: 'data', color: '#6c2bd9', initial: 'N', sortOrder: 68, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'dt7', name: 'Dune Analytics', url: 'dune.com', desc: '链上数据看板平台，社区驱动的 SQL 查询和可视化，数据分析必备。', categoryId: 'data', color: '#6c2bd9', initial: 'D', sortOrder: 69, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'dt8', name: 'Messari', url: 'messari.io', desc: '机构级加密研究平台，深度的项目报告、行业研报和实时数据仪表盘。', categoryId: 'data', color: '#0d6efd', initial: 'M', sortOrder: 70, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'dt9', name: 'CoinGlass', url: 'coinglass.com', desc: '合约数据聚合平台，多空比、持仓量、爆仓数据，期货交易者必备。', categoryId: 'data', color: '#f97316', initial: 'C', sortOrder: 71, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── 钱包 ──
  { id: 'wl1', name: 'MetaMask', url: 'metamask.io', desc: '最流行的 EVM 钱包，浏览器插件 + 移动端，DeFi 和 NFT 的入口。', categoryId: 'wallet', color: '#f6851b', initial: 'M', sortOrder: 72, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'wl2', name: 'Phantom', url: 'phantom.app', desc: 'Solana 生态最受欢迎钱包，支持多链，界面优美，用户体验一流。', categoryId: 'wallet', color: '#ab9ff2', initial: 'P', sortOrder: 73, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'wl3', name: 'Rabby', url: 'rabby.io', desc: '新一代 EVM 钱包，多账户管理、安全扫描、Gas 优化，DeFi 用户首选。', categoryId: 'wallet', color: '#3b82f6', initial: 'R', sortOrder: 74, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'wl4', name: 'Trust Wallet', url: 'trustwallet.com', desc: 'Binance 旗下多链钱包，支持 100+ 链，移动端体验好。', categoryId: 'wallet', color: '#3375bb', initial: 'T', sortOrder: 75, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'wl5', name: 'OKX Wallet', url: 'okx.com/web3', desc: 'OKX 生态 Web3 钱包，多链支持 + 跨链 Swap + 交易市场集成。', categoryId: 'wallet', color: '#1a1a1a', initial: 'O', sortOrder: 76, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'wl6', name: 'Ledger Live', url: 'ledger.com', desc: '硬件钱包 Ledger 的配套软件，冷存储 + DeFi 交互，安全第一。', categoryId: 'wallet', color: '#1a1a1a', initial: 'L', sortOrder: 77, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── 链上工具 ──
  { id: 'ch1', name: 'Etherscan', url: 'etherscan.io', desc: '以太坊区块链浏览器，查询交易、地址、合约代码和 Gas 费用。', categoryId: 'chain', color: '#3c3c3d', initial: 'E', sortOrder: 78, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ch2', name: 'Solscan', url: 'solscan.io', desc: 'Solana 区块链浏览器，追踪交易、代币、NFT 和账户详细数据。', categoryId: 'chain', color: '#00d18c', initial: 'S', sortOrder: 79, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ch3', name: 'BscScan', url: 'bscscan.com', desc: 'BNB Chain 区块链浏览器，查询 BSC 链上交易、合约和验证。', categoryId: 'chain', color: '#f0b90b', initial: 'B', sortOrder: 80, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ch4', name: 'Arbiscan', url: 'arbiscan.io', desc: 'Arbitrum L2 区块链浏览器，查询 Layer2 交易和跨链数据。', categoryId: 'chain', color: '#2d374b', initial: 'A', sortOrder: 81, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ch5', name: 'DeBank', url: 'debank.com', desc: 'DeFi 资产追踪平台，一站式查看多链钱包持仓和交互记录。', categoryId: 'chain', color: '#f43f5e', initial: 'D', sortOrder: 82, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ch6', name: 'Zapper', url: 'zapper.fi', desc: 'DeFi 资产管理仪表盘，追踪投资组合、DeFi 仓位和 NFT 收藏。', categoryId: 'chain', color: '#6366f1', initial: 'Z', sortOrder: 83, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ch7', name: 'Zerion', url: 'zerion.io', desc: '多链 DeFi 钱包和投资组合管理，支持 Swap、跨链和 NFT 展示。', categoryId: 'chain', color: '#1a1a2e', initial: 'Z', sortOrder: 84, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── 基础设施 L1/L2 ──
  { id: 'in1', name: 'Ethereum', url: 'ethereum.org', desc: '以太坊官网，最大智能合约平台，L1 基础，了解 EVM 和生态的起点。', categoryId: 'infra', color: '#3c3c3d', initial: 'E', sortOrder: 85, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'in2', name: 'Solana', url: 'solana.com', desc: '高性能 L1 区块链，高吞吐量、低费用，DeFi 和游戏生态活跃。', categoryId: 'infra', color: '#00d18c', initial: 'S', sortOrder: 86, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'in3', name: 'Arbitrum', url: 'arbitrum.io', desc: '以太坊最大 L2 扩容方案，Optimistic Rollup，EVM 等效，生态最丰富。', categoryId: 'infra', color: '#2d374b', initial: 'A', sortOrder: 87, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'in4', name: 'Optimism', url: 'optimism.io', desc: '以太坊 OP Stack L2，EVM 兼容，交易成本低，Superchain 生态扩展中。', categoryId: 'infra', color: '#ff0420', initial: 'O', sortOrder: 88, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'in5', name: 'Base', url: 'base.org', desc: 'Coinbase 孵化的 L2，基于 OP Stack，快速成长的生态新星。', categoryId: 'infra', color: '#0052ff', initial: 'B', sortOrder: 89, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'in6', name: 'Chainlink', url: 'chain.link', desc: '去中心化预言机龙头，连接智能合约与现实世界数据，DeFi 基础设施。', categoryId: 'infra', color: '#375bd2', initial: 'C', sortOrder: 90, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'in7', name: 'LayerZero', url: 'layerzero.network', desc: '全链互操作协议，跨链消息传递和资产桥接，多链生态的基石。', categoryId: 'infra', color: '#000000', initial: 'L', sortOrder: 91, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'in8', name: 'Celestia', url: 'celestia.org', desc: '模块化区块链网络，数据可用性层，引领模块化区块链新范式。', categoryId: 'infra', color: '#8b5cf6', initial: 'C', sortOrder: 92, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── NFT 市场 ──
  { id: 'nf1', name: 'OpenSea', url: 'opensea.io', desc: '全球最大 NFT 市场，支持多链 NFT 交易、铸造和收藏展示。', categoryId: 'nft', color: '#2081e2', initial: 'O', sortOrder: 93, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'nf2', name: 'Blur', url: 'blur.io', desc: '专业 NFT 交易平台，聚合器 + 扫货工具，流动性深度最好的 NFT 市场。', categoryId: 'nft', color: '#f97316', initial: 'B', sortOrder: 94, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'nf3', name: 'Magic Eden', url: 'magiceden.io', desc: 'Solana NFT 市场龙头，现支持多链，比特币 Ordinals 生态领先。', categoryId: 'nft', color: '#ec4899', initial: 'M', sortOrder: 95, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'nf4', name: 'LooksRare', url: 'looksrare.org', desc: '社区驱动 NFT 市场，交易挖矿奖励，版税支持创作者收益。', categoryId: 'nft', color: '#1a1a1a', initial: 'L', sortOrder: 96, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── 安全审计 ──
  { id: 'sc1', name: 'CertiK', url: 'certik.com', desc: '头部区块链安全审计公司，项目审计报告和 Skynet 实时监控。', categoryId: 'security', color: '#22c55e', initial: 'C', sortOrder: 97, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'sc2', name: 'SlowMist', url: 'slowmist.com', desc: '知名安全审计团队，安全报告、漏洞预警和区块链威胁情报。', categoryId: 'security', color: '#ef4444', initial: 'S', sortOrder: 98, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'sc3', name: 'DefiSafety', url: 'defisafety.com', desc: 'DeFi 协议安全评分平台，社区驱动评估合约风险和审计质量。', categoryId: 'security', color: '#ef4444', initial: 'D', sortOrder: 99, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'sc4', name: 'Immunefi', url: 'immunefi.com', desc: '最大 Web3 漏洞赏金平台，白帽黑客和协议安全的中立协调方。', categoryId: 'security', color: '#06b6d4', initial: 'I', sortOrder: 100, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── 媒体与研究 ──
  { id: 'md1', name: 'CoinDesk', url: 'coindesk.com', desc: '全球最权威加密媒体，新闻、分析、研究，Consensus 大会主办方。', categoryId: 'media', color: '#1a1a2e', initial: 'C', sortOrder: 101, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'md2', name: 'Cointelegraph', url: 'cointelegraph.com', desc: '全球加密新闻媒体，24/7 行业快讯，深度报道和专题分析。', categoryId: 'media', color: '#1f2937', initial: 'C', sortOrder: 102, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'md3', name: 'Bankless', url: 'bankless.com', desc: '知名 DeFi 媒体和播客，聚焦去中心化金融和以太坊生态。', categoryId: 'media', color: '#f97316', initial: 'B', sortOrder: 103, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'md4', name: 'The Block', url: 'theblock.co', desc: '顶级加密研究和新闻，深度数据分析、机构研报和行业洞察。', categoryId: 'media', color: '#1a1a2e', initial: 'T', sortOrder: 104, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'md5', name: '吴说区块链', url: 'wublockchain.com', desc: '中文加密深度媒体，专注行业洞察、政策分析和矿业报道。', categoryId: 'media', color: '#1e3a5f', initial: '吴', sortOrder: 105, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'md6', name: 'Foresight News', url: 'foresightnews.pro', desc: '华语加密资讯平台，快讯、深度文章和行业活动聚合。', categoryId: 'media', color: '#6366f1', initial: 'F', sortOrder: 106, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── 挖矿/节点 ──
  { id: 'st1', name: 'Staking Rewards', url: 'stakingrewards.com', desc: '质押收益对比平台，覆盖 PoS 链的质押收益率、节点和锁仓期。', categoryId: 'staking', color: '#f97316', initial: 'S', sortOrder: 107, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'st2', name: 'Rocket Pool', url: 'rocketpool.net', desc: '去中心化以太坊质押协议，降低 Solo Staking 门槛，rETH 流动性质押。', categoryId: 'staking', color: '#f97316', initial: 'R', sortOrder: 108, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'st3', name: 'Allnodes', url: 'allnodes.com', desc: '节点托管服务平台，支持 60+ 链的节点运行和质押服务。', categoryId: 'staking', color: '#3b82f6', initial: 'A', sortOrder: 109, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'st4', name: 'Kiln', url: 'kiln.fi', desc: '企业级质押平台，支持 ETH、SOL 等多链质押，合规节点服务。', categoryId: 'staking', color: '#1a1a2e', initial: 'K', sortOrder: 110, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── 稳定币/RWA ──
  { id: 'sb1', name: 'MakerDAO', url: 'makerdao.com', desc: '最大去中心化稳定币协议，DAI 背后的抵押债务系统，RWA 先驱。', categoryId: 'stable', color: '#22c55e', initial: 'M', sortOrder: 111, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'sb2', name: 'Ethena', url: 'ethena.fi', desc: '合成美元协议 USDe，Delta 中性对冲机制，稳定币创新赛道。', categoryId: 'stable', color: '#6366f1', initial: 'E', sortOrder: 112, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'sb3', name: 'Frax', url: 'frax.finance', desc: '部分抵押算法稳定币协议，Frax 生态含 Fraxlend 和 Fraxswap。', categoryId: 'stable', color: '#1a1a1a', initial: 'F', sortOrder: 113, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'sb4', name: 'Ondo Finance', url: 'ondo.finance', desc: 'RWA 代币化协议，将美债等传统资产上链，连接 TradFi 和 DeFi。', categoryId: 'stable', color: '#0ea5e9', initial: 'O', sortOrder: 114, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── AI + Crypto ──
  { id: 'ac1', name: 'Render Network', url: 'render.com', desc: '去中心化 GPU 算力网络，AI 渲染和计算，GPU 资源供需匹配平台。', categoryId: 'aicrypto', color: '#8b5cf6', initial: 'R', sortOrder: 115, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ac2', name: 'Bittensor', url: 'bittensor.com', desc: '去中心化 AI 网络，TAO 激励机器学习模型训练和推理，AIxWeb3 先驱。', categoryId: 'aicrypto', color: '#1a1a2e', initial: 'B', sortOrder: 116, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ac3', name: 'Akash Network', url: 'akash.network', desc: '去中心化云计算市场，GPU 算力租赁，AI 训练和推理的云基础设施。', categoryId: 'aicrypto', color: '#ef4444', initial: 'A', sortOrder: 117, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ac4', name: 'IO.net', url: 'io.net', desc: '去中心化 GPU 算力网络，聚合闲置 GPU 资源，AI/ML 训练低成本方案。', categoryId: 'aicrypto', color: '#6366f1', initial: 'I', sortOrder: 118, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ac5', name: 'Filecoin', url: 'filecoin.io', desc: '去中心化存储网络，AI 数据存储和检索，Web3 数据基础设施。', categoryId: 'aicrypto', color: '#0090ff', initial: 'F', sortOrder: 119, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ac6', name: 'The Graph', url: 'thegraph.com', desc: '去中心化索引协议，AI 训练数据的链上数据索引和查询基础设施。', categoryId: 'aicrypto', color: '#8b5cf6', initial: 'G', sortOrder: 120, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ac7', name: 'Helium', url: 'helium.com', desc: '去中心化无线网络，DePIN 赛道龙头，物联网 + 5G 基础设施激励。', categoryId: 'aicrypto', color: '#06b6d4', initial: 'H', sortOrder: 121, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── AI 新增站点 ──

  // 入门对话（新增）
  { id: 's6', name: 'Grok', url: 'grok.com', desc: 'xAI 推出的 AI 对话助手，实时联网、幽默风格，X 平台深度集成。', categoryId: 'starter', color: '#1a1a1a', initial: 'G', sortOrder: 122, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 's7', name: '通义千问', url: 'tongyi.aliyun.com', desc: '阿里云大模型，中文理解能力强，文档处理、代码生成和数据分析全能。', categoryId: 'starter', color: '#ff6a00', initial: '通', sortOrder: 123, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 's8', name: 'Gemini', url: 'gemini.google.com', desc: 'Google AI 旗舰模型，多模态理解、Google 生态集成，知识库覆盖广。', categoryId: 'starter', color: '#4285f4', initial: 'G', sortOrder: 124, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 's9', name: '文心一言', url: 'yiyan.baidu.com', desc: '百度大模型，中文搜索和知识问答出色，文心一言工具箱丰富。', categoryId: 'starter', color: '#1745c9', initial: '文', sortOrder: 125, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 's10', name: '智谱清言', url: 'chatglm.cn', desc: '智谱 AI 大模型，GLM 系列，开放平台，支持 API 调用和私有部署。', categoryId: 'starter', color: '#1e90ff', initial: '智', sortOrder: 126, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 's11', name: '讯飞星火', url: 'xinghuo.xfyun.cn', desc: '科大讯飞大模型，语音交互强，教育、办公、医疗等垂直场景深入。', categoryId: 'starter', color: '#de1a32', initial: '星', sortOrder: 127, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // 提示词工程（新增）
  { id: 'p4', name: 'PromptBase', url: 'promptbase.com', desc: 'AI 提示词交易市场，买卖高质量提示词，覆盖 DALL-E、Midjourney、GPT 等。', categoryId: 'prompt', color: '#6366f1', initial: 'P', sortOrder: 128, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // 编程与开发（新增）
  { id: 'cd8', name: 'Windsurf', url: 'codeium.com/windsurf', desc: 'AI 原生 IDE，智能代码补全、Agent 模式自动编程，Cascade 交互流畅。', categoryId: 'coding', color: '#3b82f6', initial: 'W', sortOrder: 129, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'cd9', name: 'Claude Code', url: 'docs.anthropic.com/en/docs/claude-code', desc: 'Anthropic 官方 CLI 编程工具，终端内 AI 编程 Agent，支持复杂项目开发。', categoryId: 'coding', color: '#f97316', initial: 'C', sortOrder: 130, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // 设计与创意（新增）
  { id: 'g7', name: 'Leonardo AI', url: 'leonardo.ai', desc: 'AI 图像生成平台，游戏资产、角色设计、概念图，模型训练和风格控制。', categoryId: 'design', color: '#8b5cf6', initial: 'L', sortOrder: 131, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'g8', name: '可灵AI', url: 'kling.kuaishou.com', desc: '快手 AI 视频生成，文生视频、图生视频，效果逼真，国产视频生成标杆。', categoryId: 'design', color: '#ff6a00', initial: '可', sortOrder: 132, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'g9', name: 'Pika', url: 'pika.art', desc: 'AI 视频生成平台，文字/图片转视频，风格化视频编辑，社区活跃。', categoryId: 'design', color: '#ec4899', initial: 'P', sortOrder: 133, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'g10', name: 'HeyGen', url: 'heygen.com', desc: 'AI 数字人视频生成，虚拟主播、营销视频、多语言口型同步，企业级应用。', categoryId: 'design', color: '#06b6d4', initial: 'H', sortOrder: 134, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'g11', name: 'Viggle', url: 'viggle.ai', desc: 'AI 角色动画生成，用文字控制 3D 角色动作，适合游戏开发和短视频创作。', categoryId: 'design', color: '#a855f7', initial: 'V', sortOrder: 135, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'g12', name: 'DESIGN.md Editor', url: 'design.ricoui.com', desc: 'DESIGN.md 在线编辑器，管理和创建设计文档，内置品牌库收录 75+ 知名品牌设计规范参考。', categoryId: 'design', color: '#6366f1', initial: 'D', sortOrder: 136, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'g13', name: 'RunningHub', url: 'runninghub.cn', desc: 'AI 创意创作平台，集成 Seedance 视频生成、Seedream 图像生成与多种工作流模板。', categoryId: 'design', color: '#3b82f6', initial: 'R', sortOrder: 137, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // 深度工作流（新增）
  { id: 'f8', name: 'n8n', url: 'n8n.io', desc: '开源自动化工作流平台，可自托管，连接 400+ 服务，比 Zapier 更灵活。', categoryId: 'workflow', color: '#ff6a00', initial: 'n', sortOrder: 137, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'f9', name: 'Flowise', url: 'flowiseai.com', desc: '开源低代码 LLM 应用构建平台，可视化拖拽搭建 RAG 和 AI Agent 工作流。', categoryId: 'workflow', color: '#22c55e', initial: 'F', sortOrder: 138, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'f10', name: 'AutoGPT', url: 'agpt.co', desc: '自主 AI Agent 框架，设定目标后自动规划和执行任务，多步骤复杂任务。', categoryId: 'workflow', color: '#1a1a2e', initial: 'A', sortOrder: 139, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // 学习与前沿（新增）
  { id: 'l10', name: 'DeepLearning.AI', url: 'deeplearning.ai', desc: '吴恩达创办的 AI 教育平台，The Batch 周报、专业课程和前沿技术分享。', categoryId: 'learning', color: '#22c55e', initial: 'D', sortOrder: 140, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'l11', name: 'Papers With Code', url: 'paperswithcode.com', desc: '论文 + 代码 + 基准数据集，跟踪 AI 各方向 SOTA 进展和实现。', categoryId: 'learning', color: '#1a1a2e', initial: 'P', sortOrder: 141, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'l12', name: '智源社区', url: 'hub.baai.ac.cn', desc: '北京智源研究院社区，中文 AI 学术交流、模型发布和数据集共享。', categoryId: 'learning', color: '#3b82f6', initial: '智', sortOrder: 142, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── AI 优惠比价 ──
  { id: 'adl1', name: 'FindAI8', url: 'findai8.com', desc: 'AI 优惠聚合比价平台，汇聚各商家 GPT/Claude/Gemini 实时库存与低价充值比价，已监控 600+ 渠道。', categoryId: 'aideals', color: '#ff6a00', initial: 'F', sortOrder: 143, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'adl2', name: 'GetCheapAI', url: 'getcheapai.com', desc: 'AI API 中转站比价工具，统一换算各中转站每百万 Token 真实价格，覆盖 44+ 中转站 3000+ 模型。', categoryId: 'aideals', color: '#22c55e', initial: 'G', sortOrder: 144, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'adl3', name: 'AIbase 费用计算器', url: 'model.aibase.com/zh/calculator', desc: 'AI 大模型费用计算器，免费对比 300+ 模型 API 价格，实时 Token 计费对比，快速预算评估。', categoryId: 'aideals', color: '#3b82f6', initial: 'A', sortOrder: 145, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'adl4', name: 'PriceAI', url: 'priceai.cc', desc: 'AI 比价雷达，聚合官方订阅、卡网订阅、官方 API 和中转 API 价格，覆盖 ChatGPT/Claude/Gemini 等，支持库存和更新时间核验。', categoryId: 'aideals', color: '#8b5cf6', initial: 'P', sortOrder: 146, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── 币圈新增站点 ──

  // 交易所 CEX（新增）
  { id: 'ex10', name: 'Bitget', url: 'bitget.com', desc: '新兴交易所，跟单交易功能突出，合约和 Launchpad 增长迅速，中文用户多。', categoryId: 'cex', color: '#1a1a2e', initial: 'B', sortOrder: 148, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // 去中心化交易所 DEX（新增）
  { id: 'dx9', name: 'Aerodrome', url: 'aerodrome.finance', desc: 'Base 链最大 DEX 和流动性中心，ve(3,3) 模型，Base 生态核心基础设施。', categoryId: 'dex', color: '#0052ff', initial: 'A', sortOrder: 143, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'dx10', name: 'Orca', url: 'orca.so', desc: 'Solana 生态 DEX，用户体验优秀，集中流动性 AMM，支持限价单和跨链。', categoryId: 'dex', color: '#ec4899', initial: 'O', sortOrder: 144, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // DeFi 借贷/收益（新增）
  { id: 'df7', name: 'JustLend', url: 'justlend.org', desc: 'TRON 生态最大借贷协议，存款赚息和抵押借贷，TRX 和 USDT 流动性好。', categoryId: 'defi', color: '#ff6a00', initial: 'J', sortOrder: 145, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'df8', name: 'Venus', url: 'venus.io', desc: 'BNB Chain 借贷协议，支持多种资产借贷和 XVS 治理，跨链互操作。', categoryId: 'defi', color: '#007aff', initial: 'V', sortOrder: 146, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'df9', name: 'MöB', url: 'mob.exchange', desc: '链上 Prime Brokerage 协议，跨 Hyperliquid/Lighter/Aster 等永续 DEX 统一保证金，支持用 DeFi 生息资产做抵押借贷和杠杆策略。', categoryId: 'defi', color: '#1a1a2e', initial: 'M', sortOrder: 204, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // 数据与研究（新增）
  { id: 'dt10', name: 'Santiment', url: 'santiment.net', desc: '链上数据智能平台，项目基本面、社交情绪、开发活动和市场指标追踪。', categoryId: 'data', color: '#1a1a2e', initial: 'S', sortOrder: 147, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'dt11', name: 'Glassnode', url: 'glassnode.com', desc: '机构级链上数据平台，比特币和以太坊深度分析，宏观指标和技术指标。', categoryId: 'data', color: '#6366f1', initial: 'G', sortOrder: 148, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'dt12', name: 'Arkham', url: 'arkhamintelligence.com', desc: '链上智能分析平台，地址标签、实体追踪和可视化，揭示链上资金流向。', categoryId: 'data', color: '#1a1a2e', initial: 'A', sortOrder: 149, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'dt13', name: 'MangosLab', url: 'ops.mangoslab.xyz/landing', desc: '加密世界 Alpha 发现平台，追踪 3000+ VC/KOL 关注信号，AI 流水线筛选 + 人工策展输出每日精选项目。', categoryId: 'data', color: '#f59e0b', initial: 'M', sortOrder: 150, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'dt14', name: 'NewsLiquid', url: 'app.newsliquid.com/trade', desc: 'AI 驱动的新闻市场情绪交易终端，实时新闻影响评分、事件预测市场和策略 Agent，覆盖加密/股票/大宗商品。', categoryId: 'data', color: '#06b6d4', initial: 'N', sortOrder: 151, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'dt15', name: 'Alpha Wallet Finder', url: 'alphawallets.fun', desc: '多链聪明钱查找工具，输入代币合约地址按已实现 PNL 排名顶级交易者，支持 Solana/BNB Chain/Base，一键导出追踪钱包。', categoryId: 'data', color: '#f59e0b', initial: 'A', sortOrder: 203, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // 钱包（新增）
  { id: 'wl7', name: 'Coinbase Wallet', url: 'wallet.coinbase.com', desc: 'Coinbase 自托管钱包，多链支持、DApp 浏览器和 NFT 展示，入门友好。', categoryId: 'wallet', color: '#0052ff', initial: 'C', sortOrder: 151, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'wl8', name: 'WalletConnect', url: 'walletconnect.com', desc: '钱包连接协议标准，连接 DApp 和钱包的桥梁，支持 200+ 钱包。', categoryId: 'wallet', color: '#3b99fc', initial: 'W', sortOrder: 151, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'wl9', name: 'Backpack', url: 'backpack.app', desc: 'Solana 生态钱包 + 交易所，xNFT 原生支持，安全设计理念领先。', categoryId: 'wallet', color: '#000000', initial: 'B', sortOrder: 152, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // 链上工具（新增）
  { id: 'ch8', name: 'Alchemy', url: 'alchemy.com', desc: 'Web3 开发者平台，节点 API、区块链数据、开发工具，基础设施服务商。', categoryId: 'chain', color: '#6366f1', initial: 'A', sortOrder: 153, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ch9', name: 'Infura', url: 'infura.io', desc: '以太坊和 IPFS 节点服务，API 网关，无需自建节点即可接入区块链。', categoryId: 'chain', color: '#1a1a2e', initial: 'I', sortOrder: 154, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ch10', name: 'Tenderly', url: 'tenderly.co', desc: '智能合约开发调试平台，交易模拟、错误追踪和合约监控，开发者必备。', categoryId: 'chain', color: '#22c55e', initial: 'T', sortOrder: 155, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // 基础设施 L1/L2（新增）
  { id: 'in9', name: 'Sui', url: 'sui.io', desc: '高性能 L1 公链，Move 语言编程，并行交易处理，游戏和 DeFi 生态活跃。', categoryId: 'infra', color: '#4da2ff', initial: 'S', sortOrder: 156, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'in10', name: 'Aptos', url: 'aptosfoundation.org', desc: 'Meta Diem 团队打造的 L1，Move 语言，高吞吐量和安全性，生态快速成长。', categoryId: 'infra', color: '#06b6d4', initial: 'A', sortOrder: 157, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'in11', name: 'Avalanche', url: 'avax.network', desc: '高速 L1 平台，子网架构灵活，DeFi 和游戏生态丰富，兼容 EVM。', categoryId: 'infra', color: '#e84142', initial: 'A', sortOrder: 158, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'in12', name: 'Polygon', url: 'polygon.technology', desc: '以太坊扩容方案，侧链 + zkEVM，交易成本低，生态项目最丰富的 L2 之一。', categoryId: 'infra', color: '#8247e5', initial: 'P', sortOrder: 159, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'in13', name: 'Near', url: 'near.org', desc: '分片 L1 公链，Nightshade 分片技术，人类可读账户名，Web3 入门友好。', categoryId: 'infra', color: '#000000', initial: 'N', sortOrder: 160, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // NFT 市场（新增）
  { id: 'nf5', name: 'Tensor', url: 'tensor.trade', desc: 'Solana 头部 NFT 市场，聚合交易、扫货工具和流动性挖矿，专业交易者首选。', categoryId: 'nft', color: '#8b5cf6', initial: 'T', sortOrder: 161, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // 安全审计（新增）
  { id: 'sc5', name: 'Hacken', url: 'hacken.io', desc: 'Web3 安全审计公司，智能合约审计、安全评分和漏洞赏金服务。', categoryId: 'security', color: '#22c55e', initial: 'H', sortOrder: 162, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'sc6', name: 'PeckShield', url: 'peckshield.com', desc: '知名安全审计机构，链上安全监控、黑客追踪和 DeFi 安全预警。', categoryId: 'security', color: '#ef4444', initial: 'P', sortOrder: 163, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // 媒体与研究（新增）
  { id: 'md7', name: 'BlockBeats', url: 'theblockbeats.info', desc: '华语加密深度媒体，快讯、深度报道和行业数据，报道质量高。', categoryId: 'media', color: '#1a1a2e', initial: 'B', sortOrder: 164, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'md8', name: 'Odaily', url: 'odaily.news', desc: '中文加密媒体，行业快讯、项目分析和市场数据，内容全面。', categoryId: 'media', color: '#3b82f6', initial: 'O', sortOrder: 165, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'md9', name: 'ChainFeeds', url: 'chainfeeds.com', desc: '加密信息聚合平台，精选项目、研究文章、播客和事件日历。', categoryId: 'media', color: '#6366f1', initial: 'C', sortOrder: 166, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // 挖矿/节点（新增）
  { id: 'st5', name: 'Figment', url: 'figment.io', desc: '企业级质押服务商，支持 60+ PoS 链，节点运营和 Staking API 服务。', categoryId: 'staking', color: '#06b6d4', initial: 'F', sortOrder: 167, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // AI + Crypto（新增）
  { id: 'ac8', name: 'AIx.bot', url: 'aix.bot', desc: 'AI + Crypto 域名项目，AI 交易机器人方向，域名待开发中。', categoryId: 'aicrypto', color: '#a855f7', initial: 'A', sortOrder: 168, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ac9', name: 'Gensyn', url: 'gensyn.ai', desc: '去中心化机器学习计算网络，连接算力供需方，AI 训练基础设施。', categoryId: 'aicrypto', color: '#6366f1', initial: 'G', sortOrder: 169, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ac10', name: 'Grass', url: 'grassfoundation.io', desc: '去中心化数据抓取网络，用户共享带宽获取奖励，AI 训练数据采集。', categoryId: 'aicrypto', color: '#22c55e', initial: 'G', sortOrder: 170, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ac11', name: 'Allora', url: 'allora.network', desc: '去中心化 AI 推理网络，ML 模型在链上协作推理，DeFAI 赛道基础设施。', categoryId: 'aicrypto', color: '#ec4899', initial: 'A', sortOrder: 171, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── 投融资 ──
  { id: 'fd1', name: 'RootData', url: 'cn.rootdata.com', desc: 'Web3 项目数据平台，热榜、融资、空投日历、代币解锁追踪，投融资研究必备。', categoryId: 'funding', color: '#3861fb', initial: 'R', sortOrder: 172, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'fd2', name: 'Crypto-Fundraising', url: 'crypto-fundraising.info', desc: '区块链融资数据库，追踪从种子轮到 C 轮的全部加密融资事件，涵盖投资者和轮次详情。', categoryId: 'funding', color: '#22c55e', initial: 'C', sortOrder: 173, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'fd3', name: 'ChainBroker', url: 'chainbroker.io', desc: '加密项目融资数据平台，追踪私募轮次、估值和投资者信息，项目融资全景图。', categoryId: 'funding', color: '#6366f1', initial: 'C', sortOrder: 174, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'fd4', name: 'ICO Drops', url: 'icodrops.com', desc: '代币销售日历，追踪 ICO/IDO/IEO 发行时间和详情，参与打新必备。', categoryId: 'funding', color: '#f97316', initial: 'I', sortOrder: 175, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'fd5', name: 'CryptoRank', url: 'cryptorank.io', desc: '加密市场洞察平台，IDO/IEO/ICO 数据、历史融资轮次和 fundraising 平台排名。', categoryId: 'funding', color: '#1a1a2e', initial: 'C', sortOrder: 176, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'fd6', name: 'CoinList', url: 'coinlist.io', desc: '优质代币销售平台，合规公募项目，CoinList Seed 和后续发行，早期参与优质项目。', categoryId: 'funding', color: '#0066ff', initial: 'C', sortOrder: 177, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'fd7', name: 'Crunchbase', url: 'crunchbase.com', desc: '全球创业公司融资数据库，覆盖大量加密/Web3 项目的融资轮次、估值和投资方信息。', categoryId: 'funding', color: '#0288d1', initial: 'C', sortOrder: 178, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'fd8', name: 'Tokenomist', url: 'token.unlocks.app', desc: '代币解锁追踪平台，监测即将解锁的代币、线性释放和 Cliff 解锁，识别潜在抛压。', categoryId: 'funding', color: '#8b5cf6', initial: 'T', sortOrder: 179, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── 空投/Airdrop ──
  { id: 'ad2', name: 'Airdrops.io', url: 'airdrops.io', desc: '全球最大空投列表平台，按类别筛选进行中/即将开始的空投，含参与教程。', categoryId: 'airdrop', color: '#6366f1', initial: 'A', sortOrder: 180, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ad3', name: 'AirdropAlert', url: 'airdropalert.com', desc: '实时空投警报平台，跟踪最新空投活动，含评级和项目风险评估。', categoryId: 'airdrop', color: '#ef4444', initial: 'A', sortOrder: 181, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ad4', name: 'Airdrop.com', url: 'airdrop.com', desc: '综合空投平台，DeFi、NFT 等各类空投活动，含抽奖和赠品信息。', categoryId: 'airdrop', color: '#22c55e', initial: 'A', sortOrder: 182, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ad5', name: 'AirdropKing', url: 'airdropking.io', desc: '潜力空投项目发现平台，筛选早期高价值项目，适合空投猎人。', categoryId: 'airdrop', color: '#f0b90b', initial: 'A', sortOrder: 183, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ad6', name: '99Airdrops', url: '99airdrops.com', desc: '带空投评级功能的平台，为每个空投项目打分和评估安全风险。', categoryId: 'airdrop', color: '#a855f7', initial: '9', sortOrder: 184, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ad7', name: 'DropsEarn', url: 'dropsearn.com', desc: '最新空投聚合平台，每日更新进行中空投，含参与指南和教程。', categoryId: 'airdrop', color: '#06b6d4', initial: 'D', sortOrder: 185, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ad8', name: 'EarnDrop', url: 'earndrop.io', desc: '空投信息聚合平台，覆盖 DeFi、GameFi 等多领域空投活动。', categoryId: 'airdrop', color: '#3b82f6', initial: 'E', sortOrder: 186, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ad9', name: 'CoinMarketCap Airdrop', url: 'coinmarketcap.com/airdrop/', desc: 'CMC 空投专区，聚合各项目官方空投活动，认购即领代币。', categoryId: 'airdrop', color: '#3861fb', initial: 'C', sortOrder: 187, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ad10', name: 'DappRadar Airdrop', url: 'dappradar.com/airdrops', desc: 'Dapp 生态空投追踪，覆盖 DeFi、GameFi、NFT 等 DApp 空投。', categoryId: 'airdrop', color: '#1a1a2e', initial: 'D', sortOrder: 188, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ad11', name: 'RankFi', url: 'rankfi.com', desc: '空投评级排名平台，基于项目质量和社区活跃度给空投项目打分排序。', categoryId: 'airdrop', color: '#f97316', initial: 'R', sortOrder: 189, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'ad12', name: 'CryptoAirdrops', url: 'cryptoairdrops.com', desc: '加密货币空投导航，分类展示各类空投活动，含项目背景介绍。', categoryId: 'airdrop', color: '#8b5cf6', initial: 'C', sortOrder: 190, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── 短信接码 ──
  { id: 'sm1', name: '鲁班短信', url: 'lubansms.com', desc: '专业短信验证码接收平台，支持国内外多平台注册验证码接收，API 接口对接。', categoryId: 'sms', color: '#ff6a00', initial: '鲁', sortOrder: 191, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'sm2', name: '疾驰短信', url: 'jichisms.com', desc: '短信验证码服务平台，支持批量接收验证码，多平台注册验证，稳定高效。', categoryId: 'sms', color: '#3b82f6', initial: '疾', sortOrder: 192, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'sm3', name: 'Xtemporary', url: 'xtemporary.com', desc: '免费临时邮箱和短信接收平台，保护隐私，匿名接收验证邮件和短信。', categoryId: 'sms', color: '#8b5cf6', initial: 'X', sortOrder: 193, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'sm4', name: 'SMS-Activate', url: 'sms-activate.org', desc: '全球虚拟号码接码平台，支持 200+ 国家号码，覆盖 WhatsApp、Telegram、Google 等平台。', categoryId: 'sms', color: '#22c55e', initial: 'S', sortOrder: 194, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'sm5', name: '5SIM', url: '5sim.net', desc: '虚拟号码接码平台，支持全球多国号码，API 自动集成，适合批量注册场景。', categoryId: 'sms', color: '#06b6d4', initial: '5', sortOrder: 195, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── AI API 平台 ──
  { id: 'aiapi1', name: 'TokenRhythm', url: 'tokenrhythm.studio', desc: '多模型聚合接入服务平台，一个 API Key 覆盖主流开源模型，支持 OpenAI 和 Claude 协议，提供 Agentic Routing 与用量优化。', categoryId: 'aiapi', color: '#2563eb', initial: 'T', sortOrder: 196, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'aiapi2', name: '启悟流', url: '756777.xyz', desc: 'AI API 中转平台，一键接入 Claude、GPT、Gemini 等主流模型，支持智能调度、会话保持和按量计费。', categoryId: 'aiapi', color: '#10b981', initial: '启', sortOrder: 197, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'aiapi3', name: 'Radeon Token Factory', url: 'developer.amd.com.cn/radeon/tokenfactory', desc: 'AMD Radeon Cloud 免费模型 API 平台，基于 AMD GPU 提供 DeepSeek、Qwen、MiniCPM 等公开免费模型接口和专用模型实例部署。', categoryId: 'aiapi', color: '#ed1c24', initial: 'R', sortOrder: 198, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── 短信接码 ──
  { id: 'sm6', name: 'SMSPool', url: 'smspool.net', desc: '海外短信验证码接收平台，支持 WhatsApp、Telegram 等，价格透明，API 接口完善。', categoryId: 'sms', color: '#f97316', initial: 'S', sortOrder: 198, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'sm7', name: 'Receive-SMS', url: 'receive-sms.cc', desc: '免费在线短信接收平台，无需注册，直接获取临时号码接收验证码。', categoryId: 'sms', color: '#6366f1', initial: 'R', sortOrder: 198, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'sm8', name: 'HeroSMS', url: 'hero-sms.com/cn', desc: '虚拟号码接码平台，覆盖 180+ 国家、700+ 服务，支持临时号码和长期租用，API 接口完善。', categoryId: 'sms', color: '#f59e0b', initial: 'H', sortOrder: 199, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  // { id: 'sm8', name: 'Free SMS Online', url: 'freesmsonline.net', desc: '免费在线短信接收，提供多个国家临时号码，简单快捷，无需注册。', categoryId: 'sms', color: '#a855f7', initial: 'F', sortOrder: 198, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── 云服务器/VPS ──
  { id: 'bs1', name: '良心云', url: 'xn--9kqz23b19z.com', desc: '云服务器与 VPS 服务商，提供高性价比云主机、轻量服务器和域名注册，中文用户友好。', categoryId: 'cloud', color: '#3b82f6', initial: '良', sortOrder: 200, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },

  // ── 代理/VPN ──
  { id: 'bs2', name: 'Kitty Network', url: 'kitty.fo', desc: '代理节点订阅服务，提供高性价比直连线路，支持多地区节点，适合日常网络加速。', categoryId: 'proxy', color: '#a855f7', initial: 'K', sortOrder: 201, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
  { id: 'bs3', name: '三毛机场', url: 'xn--ehqx35aimmzwv.com', desc: '机场导航站，聚合多家代理节点服务商，提供节点推荐和订阅地址，防失联收藏页。', categoryId: 'proxy', color: '#ec4899', initial: '三', sortOrder: 202, visitCount: 0, createdAt: Date.now(), updatedAt: Date.now() },
]