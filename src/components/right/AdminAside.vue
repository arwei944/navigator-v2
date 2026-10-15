<template>
  <div class="admin-aside">
    <header class="aa-head">
      <h2 class="aa-title">{{ meta.label }}</h2>
      <p class="aa-desc">{{ meta.desc }}</p>
    </header>

    <!-- 概览：能算的都算出来，不为了「看起来有东西」去发请求 -->
    <section v-if="stats.length" class="aa-block">
      <h3 class="aa-label">概览</h3>
      <dl class="aa-stats">
        <div v-for="s in stats" :key="s.k">
          <dt>{{ s.k }}</dt>
          <dd>{{ s.v }}</dd>
        </div>
      </dl>
    </section>

    <section v-if="meta.tips && meta.tips.length" class="aa-block">
      <h3 class="aa-label">要点</h3>
      <ul class="aa-tips">
        <li v-for="(t, i) in meta.tips" :key="i">{{ t }}</li>
      </ul>
    </section>

    <section v-if="meta.links && meta.links.length" class="aa-block">
      <h3 class="aa-label">相关模块</h3>
      <div class="aa-links">
        <button v-for="l in meta.links" :key="l.tab || l.route" type="button" class="aa-link" @click="go(l)">
          <span class="aa-link-name">{{ l.label }}</span>
          <span class="aa-link-why">{{ l.why }}</span>
        </button>
      </div>
    </section>

    <p class="aa-foot">管理后台 · 共 {{ tabCount }} 个模块</p>
  </div>
</template>

<script setup>
/**
 * 管理后台的右栏：跟随当前模块给出说明、概览与相关模块跳转。
 *
 * 为什么不是「选中站点的详情」：后台没有「当前站点」这个上下文，
 * 硬套主站的右栏只会得到一块永远空着的面板。这里让它承担真正有用的职责 ——
 * **解释当前这块在干什么、以及与它相邻的模块是哪些**。
 *
 * 概览数字全部来自**已有的 store / 公开接口**，不为右栏额外发请求：
 * 一个说明性的侧栏不该成为后台的额外延迟来源。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { useFavoritesStore } from '@/stores/favorites'

const props = defineProps({ tab: { type: String, default: 'overview' } })

const router = useRouter()
const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()
const favoritesStore = useFavoritesStore()

/** 每个模块的说明书。label 与 AdminView 的 TABS 一一对应。 */
const TAB_META = {
  overview: {
    label: '概览',
    desc: '站点库与分类体系的总览，以及使用热度的汇总视图。',
    tips: ['下面的图表与主站「洞察」页看到的是同一份数据。'],
    links: [{ route: 'Insights', label: '洞察（主站页面）', why: '看更完整的热度与分布' }],
  },
  deploy: {
    label: '部署',
    desc: '线上这台机器跑的构建、运行状态与数据版本。',
    tips: ['完整的代码发布在本地控制台，站点自己没有源码与发布凭据。', '「检查更新」需要联网比对 GitHub 上游。'],
    links: [{ tab: 'publish', label: '云端发布', why: '只发数据不必重新部署' }],
  },
  plugins: {
    label: '插件',
    desc: '九个引擎模块（抓取 / 翻译 / LLM / 图标 / 封面 / 探针 / 分类表 / 存储 / 发布）的统一管理面。',
    tips: ['改动立即生效并持久化，重启后依然有效。', '站点存储是数据安全单点，刻意锁定只读。'],
    links: [],
  },
  preferences: {
    label: '偏好设置',
    desc: '显示、主题与交互的个性化选项。',
    tips: ['这些设置跟随账号同步，换设备也能保持一致。'],
    links: [],
  },
  sites: {
    label: '站点管理',
    desc: '站点库的增删改查、批量操作与元信息刷新。',
    tips: ['批量操作会逐条串行执行，中途可以看到进度。', '「重新获取信息」只改名称/描述/图标，不动你手填的分类与用途。'],
    links: [{ tab: 'categories', label: '分类体系', why: '站点都挂在这套分类下' }],
  },
  categories: {
    label: '分类体系',
    desc: '分类与用途的定义、排序与展示色。',
    tips: ['改动属于「本地待发布」，需要去云端发布才会推给线上。'],
    links: [{ tab: 'publish', label: '云端发布', why: '把分类改动推上线' }],
  },
  publish: {
    label: '云端发布',
    desc: '把站点数据与分类表热更新到线上，页面 30 秒内自动生效。',
    tips: ['发布前会做预检，未通过则禁止发布。', '只发数据不必重新部署代码 —— 两者是分开的。'],
    links: [
      { tab: 'snapshots', label: '快照与回滚', why: '发布前后的数据快照' },
      { tab: 'history', label: '发布历史', why: '看每次发布的结果' },
    ],
  },
  snapshots: {
    label: '快照与回滚',
    desc: '数据快照的保存、对比与回滚。',
    tips: ['每次发布前会自动落一份云端快照。', '回滚是覆盖式操作，执行前会先做预演。'],
    links: [{ tab: 'history', label: '发布历史', why: '快照与发布记录一一对应' }],
  },
  history: {
    label: '发布历史',
    desc: '每一次数据发布的结果、耗时与触发方式。',
    tips: ['与「操作审计」不同：这里只记发布，审计记的是所有管理动作。'],
    links: [{ tab: 'audit', label: '操作审计', why: '更完整的操作留痕' }],
  },
  audit: {
    label: '操作审计',
    desc: '管理动作的留痕：谁、什么时候、做了什么、结果如何。',
    tips: ['凭据类动作只记「改了哪一项」，绝不记值。'],
    links: [],
  },
  notify: {
    label: '通知中心',
    desc: '发布结果、可用性告警与巡检异常的通知汇总。',
    tips: ['可以配 Webhook 把通知推到外部。'],
    links: [{ tab: 'deploy', label: '部署', why: '巡检状态在那看' }],
  },
  backup: {
    label: '备份与恢复',
    desc: '站点库与配置的导出与恢复。',
    tips: ['恢复是覆盖式操作，先导出一份再动手。'],
    links: [{ tab: 'snapshots', label: '快照与回滚', why: '更轻量的数据回退' }],
  },
  ai: {
    label: 'AI 助手',
    desc: '用 AI 辅助分类、润色描述与摘要。',
    tips: ['后端由「插件」里的 LLM 引擎链决定，未配置时对应功能会明确不可用。'],
    links: [{ tab: 'plugins', label: '插件', why: '切换 LLM 后端' }],
  },
}

const meta = computed(() => TAB_META[props.tab] || { label: '管理后台', desc: '选择一个模块开始。', tips: [], links: [] })
const tabCount = Object.keys(TAB_META).length

/** 版本：只在「部署」模块下拉一次（公开只读接口），别为右栏增加常驻请求 */
const version = ref('')
onMounted(async () => {
  try {
    const res = await fetch('/api/deploy-status', { headers: { Accept: 'application/json' } })
    const j = await res.json()
    if (j && j.version && j.version.available && j.version.shortSha) {
      version.value = j.version.shortSha + (j.version.dirty ? '+未提交' : '')
    }
  } catch { /* 读不到就不显示 */ }
})

const stats = computed(() => {
  const out = []
  const t = props.tab
  if (t === 'overview') {
    out.push({ k: '站点总数', v: sitesStore.sites.length })
    out.push({ k: '分类数', v: categoriesStore.categories.length })
    out.push({ k: '收藏数', v: favoritesStore.count })
    out.push({ k: '归档数', v: sitesStore.archivedCount ?? 0 })
  } else if (t === 'deploy') {
    if (version.value) out.push({ k: '线上版本', v: version.value })
    out.push({ k: '站点数', v: sitesStore.sites.length })
  } else if (t === 'sites') {
    out.push({ k: '站点总数', v: sitesStore.sites.length })
    out.push({ k: '归档', v: sitesStore.archivedCount ?? 0 })
    out.push({ k: '回收站', v: sitesStore.trash.length })
  } else if (t === 'categories') {
    out.push({ k: '分类数', v: categoriesStore.categories.length })
  } else if (t === 'plugins') {
    out.push({ k: '引擎模块', v: 9 })
  }
  return out
})

/**
 * 跳转：`tab` 是后台内的模块（走 query 保持可刷新），`route` 是主站页面。
 * 两者要分开 —— 后台没有「洞察」这个 tab，它是主站的一页，
 * 混在一起会跳到一个不存在的 tab 上（打开后是空白）。
 */
function go(link) {
  if (link.tab) router.push({ name: 'Admin', query: { tab: link.tab } })
  else if (link.route) router.push({ name: link.route })
}
</script>

<style scoped>
.admin-aside { padding: 18px 16px 28px; display: flex; flex-direction: column; gap: 18px; }
.aa-head { display: flex; flex-direction: column; gap: 6px; }
.aa-title { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); }
.aa-desc { margin: 0; font-size: 12px; line-height: 1.7; color: var(--text-secondary); }

.aa-block { display: flex; flex-direction: column; gap: 8px; }
.aa-label {
  margin: 0; font-size: 10.5px; font-weight: 600; letter-spacing: .6px;
  color: var(--text-secondary); opacity: .7; text-transform: uppercase;
}

.aa-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(80px, 1fr)); gap: 10px 14px; margin: 0; }
.aa-stats dt { font-size: 10.5px; color: var(--text-secondary); opacity: .8; margin-bottom: 2px; }
.aa-stats dd { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }

.aa-tips { margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 6px; }
.aa-tips li { font-size: 11.5px; line-height: 1.7; color: var(--text-secondary); }

.aa-links { display: flex; flex-direction: column; gap: 6px; }
.aa-link {
  display: flex; flex-direction: column; gap: 2px; text-align: left;
  padding: 8px 10px; border-radius: var(--radius-sm);
  border: 1px solid var(--border); background: transparent; cursor: pointer;
  transition: border-color var(--transition), background var(--transition);
}
.aa-link:hover { border-color: var(--accent); background: var(--border-light); }
.aa-link-name { font-size: 12px; font-weight: 500; color: var(--text-primary); }
.aa-link-why { font-size: 10.5px; color: var(--text-secondary); }

.aa-foot {
  margin: auto 0 0; padding-top: 14px; border-top: 1px solid var(--border);
  font-size: 10.5px; color: var(--text-secondary); opacity: .6;
}
</style>
