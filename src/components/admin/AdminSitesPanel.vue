<template>
  <div class="admin-section">
    <div class="admin-section-header">
      <h2>站点管理</h2>
      <div class="admin-head-actions">
        <button class="admin-btn ghost" @click="sitesStore.toggleBatchMode()">
          {{ sitesStore.batchMode ? '退出批量' : '批量操作' }}
        </button>
        <button class="admin-btn" @click="showAdd = true">+ 添加站点</button>
      </div>
    </div>

    <AdminBatchBar
      v-if="sitesStore.batchMode"
      :admin-key="adminKey"
      @select-all="selectAllFiltered"
      @clear="sitesStore.clearSelection()"
      @done="onBatchDone"
    />

    <div class="site-filters">
      <input
        v-model="filters.q"
        class="mini-input grow"
        placeholder="搜索名称 / 网址 / 描述 / 别名（支持拼音与俗称）"
        @keyup.enter="page = 1"
      >
      <button v-if="filters.q" class="mini-btn" @click="filters.q = ''">清除</button>
      <select v-model="filters.domain" class="mini-input" @change="onDomainChange">
        <option value="all">全部域</option>
        <option v-for="d in categoriesStore.domains" :key="d.id" :value="d.id">{{ d.label }}</option>
      </select>
      <select v-model="filters.categoryId" class="mini-input">
        <option value="">全部分类</option>
        <option v-for="c in subCategories" :key="c.id" :value="c.id">{{ c.label }}</option>
      </select>
      <select v-model="filters.status" class="mini-input">
        <option value="">全部状态</option>
        <option value="ok">正常</option>
        <option value="limited">限流/反爬</option>
        <option value="down">失效</option>
        <option value="unknown">未探测</option>
      </select>
      <select v-model="filters.sort" class="mini-input">
        <option value="default">默认顺序</option>
        <option value="name-asc">名称 A→Z</option>
        <option value="name-desc">名称 Z→A</option>
        <option value="clicks">点击量高→低</option>
        <option value="newest">最新添加</option>
      </select>
      <button v-if="isFiltering" class="mini-btn" @click="resetFilters">重置</button>
    </div>

    <div class="site-meta">
      <label v-if="sitesStore.batchMode" class="meta-check">
        <input type="checkbox" :checked="allSelected" @change="toggleAll">
        全选筛选结果
      </label>
      <span>共 <b>{{ sitesStore.sites.length }}</b> 个站点</span>
      <span v-if="isFiltering" class="site-meta-hit">命中 <b>{{ filtered.length }}</b> 个</span>
      <span class="site-meta-page">第 {{ page }} / {{ totalPages }} 页</span>
    </div>

    <div class="site-cards">
      <article
        v-for="site in paged"
        :key="site.id"
        class="site-card"
        :class="{ 'is-selected': sitesStore.batchMode && sitesStore.selectedIds.has(site.id) }"
      >
        <div class="card-top">
          <label v-if="sitesStore.batchMode" class="card-check">
            <input
              type="checkbox"
              :checked="sitesStore.selectedIds.has(site.id)"
              @change="sitesStore.toggleSelect(site.id)"
            >
          </label>

          <span class="site-favicon" :style="{ background: site.color }">
            <span class="favicon-fallback">{{ site.initial }}</span>
            <img v-if="site.icon" :src="'/' + site.icon" :alt="site.name" class="favicon-img" loading="lazy" @error="$event.target.remove()">
          </span>

          <div class="card-title">
            <span class="site-name-text" :title="site.name">{{ site.name }}</span>
            <span class="site-url" :title="site.url">{{ site.url }}</span>
          </div>

          <div class="site-actions">
            <button class="action-btn" @click="editingSite = { ...site }" title="编辑">✎</button>
            <button class="action-btn danger" @click="deletingSite = site" title="删除">✕</button>
          </div>
        </div>

        <p v-if="site.desc" class="card-desc">{{ site.desc }}</p>

        <div class="card-foot">
          <span
            class="site-tag"
            :style="{ background: categoriesStore.getCategoryColor(site.categoryId) + '20', color: categoriesStore.getCategoryColor(site.categoryId) }"
          >{{ categoriesStore.getCategoryLabel(site.categoryId) }}</span>
          <span class="site-status" :class="statusOf(site.id).status">{{ STATUS_LABEL[statusOf(site.id).status] }}</span>
          <span class="card-clicks" :title="'全网累计点击 ' + clicksStore.countFor(site.id) + ' 次（所有访客）'">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11V6a2 2 0 0 1 4 0v5"/><path d="M13 11V4a2 2 0 0 1 4 0v9"/><path d="M17 13v-2a2 2 0 0 1 4 0v4a7 7 0 0 1-7 7h-2a7 7 0 0 1-7-7v-1a2 2 0 0 1 4 0"/></svg>
            {{ clicksStore.countFor(site.id) }}
          </span>
        </div>
      </article>

      <div v-if="!paged.length" class="empty-cards">
        没有匹配的站点。调整筛选条件，或点「重置」查看全部。
      </div>
    </div>

    <div class="pager">
      <select v-model.number="pageSize" class="mini-input">
        <option :value="20">每页 20</option>
        <option :value="50">每页 50</option>
        <option :value="100">每页 100</option>
      </select>
      <button class="mini-btn" :disabled="page <= 1" @click="page--">上一页</button>
      <span class="pager-pos">{{ page }} / {{ totalPages }}</span>
      <button class="mini-btn" :disabled="page >= totalPages" @click="page++">下一页</button>
      <button class="mini-btn" :disabled="page === 1" @click="page = 1">回到首页</button>
    </div>

    <AddSiteModal v-if="showAdd" @close="showAdd = false" @saved="onAdded" />
    <EditSiteModal v-if="editingSite" :site="editingSite" @close="editingSite = null" @saved="onEdited" />
    <ConfirmDialog
      v-if="deletingSite"
      title="删除站点"
      :message="'确定要删除「' + deletingSite.name + '」吗？'"
      confirm-text="确认删除"
      @confirm="doDelete"
      @cancel="deletingSite = null"
    />
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { useHealthStore } from '@/stores/health'
import { useClicksStore } from '@/stores/clicks'
import { rankSites } from '@/utils/search'
import { recordAudit } from '@/services/auditLog'
import AdminBatchBar from '@/components/admin/AdminBatchBar.vue'
import AddSiteModal from '@/components/AddSiteModal.vue'
import EditSiteModal from '@/components/EditSiteModal.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

defineProps({ adminKey: { type: String, default: '' } })

const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()
const healthStore = useHealthStore()
const clicksStore = useClicksStore()

const STATUS_LABEL = { ok: '正常', limited: '限流', down: '失效', unknown: '未探测' }

const SORT_COMPARATORS = {
  'name-asc': (a, b) => a.name.localeCompare(b.name),
  'name-desc': (a, b) => b.name.localeCompare(a.name),
  clicks: (a, b) => clicksStore.countFor(b.id) - clicksStore.countFor(a.id),
  newest: (a, b) => b.createdAt - a.createdAt,
}

const filters = reactive({ q: '', domain: 'all', categoryId: '', status: '', sort: 'default' })
const page = ref(1)
const pageSize = ref(20)
const showAdd = ref(false)
const editingSite = ref(null)
const deletingSite = ref(null)

function statusOf(id) {
  return healthStore.getStatus(id)
}

const subCategories = computed(() => categoriesStore.categoriesOfDomain(filters.domain))

/** 切域后原选中的子分类可能不属于新域，留着会筛出空集，直接清掉 */
function onDomainChange() {
  if (filters.categoryId && !subCategories.value.some(c => c.id === filters.categoryId)) filters.categoryId = ''
}

const isFiltering = computed(() =>
  Boolean(filters.q.trim() || filters.domain !== 'all' || filters.categoryId || filters.status),
)

// 结构化筛选（域 / 分类 / 状态）先收敛，再交给检索内核做相关性排序
const scoped = computed(() => {
  let list = sitesStore.sites
  if (filters.domain !== 'all') {
    const ids = new Set(categoriesStore.categoriesOfDomain(filters.domain).map(c => c.id))
    list = list.filter(s => ids.has(s.categoryId))
  }
  if (filters.categoryId) list = list.filter(s => s.categoryId === filters.categoryId)
  if (filters.status) list = list.filter(s => statusOf(s.id).status === filters.status)
  return list
})

const filtered = computed(() => {
  const q = filters.q.trim()
  const cmp = SORT_COMPARATORS[filters.sort]
  // 有搜索词时相关性优先，显式排序只作同分并列的次序（与全站搜索口径一致）
  if (q) return rankSites(scoped.value, q, { tieBreak: cmp })
  return cmp ? [...scoped.value].sort(cmp) : scoped.value
})

const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)))
const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})

watch(
  () => [filters.q, filters.domain, filters.categoryId, filters.status, filters.sort, pageSize.value],
  () => { page.value = 1 },
)
// 筛选后页数变少时把页码夹回有效范围，否则会停在一片空白页
watch(totalPages, (tp) => { if (page.value > tp) page.value = tp })

const allSelected = computed(() =>
  filtered.value.length > 0 && filtered.value.every(s => sitesStore.selectedIds.has(s.id)),
)
function selectAllFiltered() {
  sitesStore.selectAll(filtered.value.map(s => s.id))
}
function toggleAll() {
  if (allSelected.value) sitesStore.clearSelection()
  else selectAllFiltered()
}

function resetFilters() {
  filters.q = ''
  filters.domain = 'all'
  filters.categoryId = ''
  filters.status = ''
  filters.sort = 'default'
}

/* ---------------- 审计埋点（旁路，无密钥自动跳过） ---------------- */

function onAdded(site) {
  recordAudit('sites.add', { target: site.name, detail: `${site.url}（本地草稿，待发布）` })
}
function onEdited(site) {
  recordAudit('sites.update', { target: site.name, detail: `${site.url}（本地草稿，待发布）` })
}
function onBatchDone(r) {
  recordAudit('sites.batch', {
    target: `${r.changes.length + r.removed.length} 个站点`,
    detail: `更新 ${r.changes.length} / 移除 ${r.removed.length}（本地草稿，待发布）`,
  })
}
function doDelete() {
  const site = deletingSite.value
  if (!site) return
  sitesStore.deleteSite(site.id)
  recordAudit('sites.remove', { target: site.name, detail: `${site.url}（移入回收站）` })
  deletingSite.value = null
}
</script>

<style scoped>
.admin-section { padding: 0 32px 32px; }
.admin-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.admin-section-header h2 { font-size: 16px; font-weight: 600; }
.admin-head-actions { display: flex; gap: 8px; }
.admin-btn {
  padding: 7px 16px; border: none; border-radius: var(--radius-sm);
  background: var(--accent); color: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
}
.admin-btn:hover { filter: brightness(1.1); }
.admin-btn.ghost { background: var(--bg-white); color: var(--text-primary); border: 1px solid var(--border); }
.admin-btn.ghost:hover { border-color: var(--accent); color: var(--accent); filter: none; }

.site-filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.mini-input {
  padding: 6px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm);
  font-size: 13px; font-family: var(--font); color: var(--text-primary);
  background: var(--bg-white); outline: none;
}
.mini-input:focus { border-color: var(--accent); }
.mini-input.grow { flex: 1; min-width: 220px; }
.mini-btn {
  padding: 6px 14px; border: 1px solid var(--border); border-radius: var(--radius-sm);
  background: var(--bg-white); font-size: 13px; color: var(--text-primary); cursor: pointer;
}
.mini-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.mini-btn:disabled { opacity: .5; cursor: not-allowed; }

.site-meta { display: flex; gap: 16px; align-items: center; margin-bottom: 10px; font-size: 12.5px; color: var(--text-secondary); }
.site-meta b { color: var(--text-primary); font-size: 14px; }
.site-meta-hit b { color: var(--accent); }
.site-meta-page { margin-left: auto; }
.meta-check { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
.meta-check input { width: 14px; height: 14px; margin: 0; accent-color: var(--accent); cursor: pointer; }

/* 卡片式布局：自适应列数，窗口变窄自动降列，不再依赖横向滚动看全一行 */
.site-cards {
  display: grid;
  /* min(272px, 100%) 保证最小列宽永不大于容器，窄屏不会挤出容器造成重叠裁切 */
  grid-template-columns: repeat(auto-fill, minmax(min(272px, 100%), 1fr));
  gap: 14px;
}
.site-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 14px 16px;
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  transition: border-color .15s ease, box-shadow .15s ease;
}
.site-card:hover { border-color: var(--accent); box-shadow: 0 4px 14px rgba(0, 0, 0, .07); }
.site-card.is-selected { border-color: var(--accent); background: var(--accent-light); }

.card-top { display: flex; align-items: flex-start; gap: 10px; }
.card-check { display: flex; align-items: center; flex-shrink: 0; padding-top: 8px; }
.card-check input { width: 15px; height: 15px; margin: 0; accent-color: var(--accent); cursor: pointer; }
.card-title { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.site-name-text { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.site-url { color: var(--text-secondary); font-family: monospace; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.site-favicon { width: 34px; height: 34px; border-radius: 9px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; color: #fff; flex-shrink: 0; position: relative; overflow: hidden; }
.favicon-fallback { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
.favicon-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; padding: 2px; background: #fff; box-sizing: border-box; }
.card-desc {
  font-size: 12.5px; color: var(--text-secondary); line-height: 1.55; margin: 0;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.card-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: auto; }
.site-tag { display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; }
.site-status { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px; background: var(--border-light); color: var(--text-secondary); }
.site-status.ok { background: #ecfdf5; color: #059669; }
.site-status.limited { background: #fffbeb; color: #b45309; }
.site-status.down { background: #fef2f2; color: #dc2626; }
.card-clicks { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 600; color: var(--text-secondary); }
.card-clicks svg { width: 13px; height: 13px; }
.site-actions { display: flex; gap: 4px; flex-shrink: 0; }
.action-btn {
  width: 28px; height: 28px; border: 1px solid var(--border); border-radius: 4px;
  background: var(--bg-white); cursor: pointer; display: flex; align-items: center; justify-content: center;
  font-size: 12px; color: var(--text-secondary);
}
.action-btn:hover { border-color: var(--accent); color: var(--accent); }
.action-btn.danger:hover { border-color: #ef4444; color: #ef4444; }
.empty-cards {
  grid-column: 1 / -1;
  text-align: center; color: var(--text-secondary); padding: 40px 16px;
  background: var(--bg-white); border: 1px dashed var(--border); border-radius: var(--radius);
}

.pager { display: flex; align-items: center; gap: 10px; margin-top: 12px; font-size: 12.5px; color: var(--text-secondary); }
.pager-pos { font-weight: 600; color: var(--text-primary); }

/* 窄屏：收紧内外边距，把横向空间尽量留给卡片 */
@media (max-width: 768px) {
  .admin-section { padding: 0 16px 24px; }
  .site-cards { gap: 10px; }
  .site-card { padding: 12px 14px; }
  .site-filters .mini-input.grow { min-width: 100%; }
  .site-meta { flex-wrap: wrap; gap: 10px; }
  .site-meta-page { margin-left: 0; }
}
</style>