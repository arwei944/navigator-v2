import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useCategoriesStore = defineStore('categories', () => {
  const groups = ref([
    {
      id: 'ai',
      label: 'AI 学习',
      collapsed: false,
      categories: [
        { id: 'starter', label: '入门对话', dotColor: '#22c55e' },
        { id: 'prompt', label: '提示词工程', dotColor: '#3b82f6' },
        { id: 'writing', label: '写作与内容', dotColor: '#a855f7' },
        { id: 'coding', label: '编程与开发', dotColor: '#f97316' },
        { id: 'design', label: '设计与创意', dotColor: '#ec4899' },
        { id: 'workflow', label: '深度工作流', dotColor: '#06b6d4' },
        { id: 'learning', label: '学习与前沿', dotColor: '#ef4444' },
        { id: 'aideals', label: 'AI 优惠比价', dotColor: '#ff6a00' }
      ],
    },
    {
      id: 'crypto',
      label: '币圈',
      collapsed: false,
      categories: [
        { id: 'cex', label: '交易所 CEX', dotColor: '#f0b90b' },
        { id: 'dex', label: '去中心化交易所 DEX', dotColor: '#ff007a' },
        { id: 'defi', label: 'DeFi 借贷/收益', dotColor: '#00a3ff' },
        { id: 'data', label: '数据与研究', dotColor: '#3861fb' },
        { id: 'funding', label: '投融资', dotColor: '#ff4500' },
        { id: 'wallet', label: '钱包', dotColor: '#8b5cf6' },
        { id: 'chain', label: '链上工具', dotColor: '#3c3c3d' },
        { id: 'infra', label: '基础设施 L1/L2', dotColor: '#06b6d4' },
        { id: 'nft', label: 'NFT 市场', dotColor: '#ec4899' },
        { id: 'security', label: '安全审计', dotColor: '#ef4444' },
        { id: 'media', label: '媒体与研究', dotColor: '#1a1a2e' },
        { id: 'staking', label: '挖矿/节点', dotColor: '#f97316' },
        { id: 'stable', label: '稳定币/RWA', dotColor: '#22c55e' },
        { id: 'aicrypto', label: 'AI + Crypto', dotColor: '#a855f7' },
        { id: 'airdrop', label: '空投/Airdrop', dotColor: '#ff6a00' }
      ]
    },
    {
      id: 'tools',
      label: '工具',
      collapsed: false,
      categories: [
        { id: 'sms', label: '短信接码', dotColor: '#22c55e' },
        { id: 'aiapi', label: 'AI API 平台', dotColor: '#2563eb' },
        { id: 'account', label: '账号/卡密', dotColor: '#f59e0b' },
        { id: 'projects', label: '项目参考', dotColor: '#0d9488' }
      ]
    },
    {
      id: 'basics',
      label: '基础服务',
      collapsed: false,
      categories: [
        { id: 'cloud', label: '云服务器/VPS', dotColor: '#3b82f6' },
        { id: 'domain', label: '域名服务', dotColor: '#8b5cf6' },
        { id: 'proxy', label: '代理/VPN', dotColor: '#a855f7' }
      ]
    }
  ])

  // 向后兼容：扁平化所有分类
  const categories = computed(() => {
    return groups.value.flatMap(g => g.categories)
  })

  function toggleGroup(groupId) {
    const g = groups.value.find(g => g.id === groupId)
    if (g) g.collapsed = !g.collapsed
  }

  function getCategoryLabel(id) {
    for (const g of groups.value) {
      const cat = g.categories.find(c => c.id === id)
      if (cat) return cat.label
    }
    return id
  }

  function getCategoryColor(id) {
    for (const g of groups.value) {
      const cat = g.categories.find(c => c.id === id)
      if (cat) return cat.dotColor
    }
    return '#64748b'
  }

  function getGroupByCategory(catId) {
    return groups.value.find(g => g.categories.some(c => c.id === catId))
  }

  return { groups, categories, toggleGroup, getCategoryLabel, getCategoryColor, getGroupByCategory }
})