<template>
  <div class="admin-view">
    <header class="admin-header">
      <h1>管理后台</h1>
      <!-- 版本标识：未登录也显示 —— 报问题时第一句就是「你跑的是哪一版」 -->
      <span v-if="version" class="admin-version" :title="versionTitle">{{ version }}</span>

      <template v-if="authed">
        <!-- 全局搜索：模块 / 设置项 / 站点 / 分类一次搜到（#21） -->
        <div class="admin-search">
          <input
            v-model="query"
            class="admin-search-input"
            type="search"
            placeholder="搜索：模块 / 设置项 / 站点…（↑↓ 选择，回车进入）"
            @keydown.down.prevent="moveResult(1)"
            @keydown.up.prevent="moveResult(-1)"
            @keydown.enter.prevent="goResult(results[activeIdx])"
            @keydown.esc="query = ''"
          >
          <div v-if="query.trim()" class="admin-search-panel">
            <button
              v-for="(r, i) in results"
              :key="r.id"
              type="button"
              class="admin-search-item"
              :class="{ active: i === activeIdx }"
              @click="goResult(r)"
            >
              <span class="as-kind" :class="r.kind">{{ KIND_LABEL[r.kind] || r.kind }}</span>
              <span class="as-title">{{ r.title }}</span>
              <span class="as-sub">{{ r.subtitle }}</span>
            </button>
            <div v-if="!results.length" class="admin-search-empty">没有匹配的模块、设置项或站点。</div>
          </div>
        </div>

        <button class="admin-btn ghost admin-rail-toggle" :title="railCollapsed ? '展开动作栏' : '收起动作栏'" @click="railCollapsed = !railCollapsed">
          {{ railCollapsed ? '≡ 展开' : '≡ 收起' }}
        </button>

        <button class="admin-btn admin-publish-btn" @click="selectTab('publish')" title="前往云端发布">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          发布到云端
        </button>
        <div class="admin-user">
          <span class="admin-user-dot"></span>
          <span class="admin-user-name">{{ authUser }}</span>
          <span class="admin-user-via">{{ authAuto === 'local' ? '本机自动登录' : (authVia === 'key' ? '密钥直连' : '登录态') }}</span>
          <button class="admin-link-btn" @click="logout">退出登录</button>
        </div>
      </template>
    </header>

    <div v-if="authChecking" class="admin-body admin-body-full">
      <div class="admin-auth-check">正在校验凭据…</div>
    </div>

    <AdminLogin v-else-if="!authed" class="admin-body admin-body-full" :notice="loginNotice" @success="onLogin" />

    <template v-else>
      <!-- 左动作栏：栏里列的是「能做的事」，点一下即达。
           模块的实时状态写在栏内右侧 —— 不再需要一屏等大的状态卡。
           折叠态只显示图标；拖右边缘可调宽，双击复位。 -->
      <nav
        class="admin-rail"
        :class="{ collapsed: railCollapsed }"
        :style="{ width: (railCollapsed ? 56 : railW) + 'px' }"
        aria-label="后台动作与模块"
      >
        <template v-for="g in RAIL_GROUPS" :key="g.id">
          <div v-if="!railCollapsed" class="ar-group">{{ g.label }}</div>
          <button
            v-for="it in g.items" :key="it.id"
            type="button"
            class="ar-item"
            :class="{ on: railSel === it.id, icon: railCollapsed }"
            :title="it.label + (DASH_DESC[it.tab] ? ' — ' + DASH_DESC[it.tab] : '')"
            @click="pickRail(it)"
          >
            <span class="ar-icon">{{ it.icon }}</span>
            <span v-if="!railCollapsed" class="ar-label">{{ it.label }}</span>
            <span v-if="!railCollapsed && railMetaOf(it.tab)" class="ar-meta">{{ railMetaOf(it.tab) }}</span>
            <span v-if="railBusy === it.action" class="ar-spin">·</span>
          </button>
        </template>
        <div class="ar-resize" @mousedown="startRailResize" @dblclick="resetRailWidth" title="拖拽调宽 · 双击复位"></div>
      </nav>

      <div class="admin-body">
        <div class="admin-tabpanel">
          <!-- 动作执行结果：左动作栏里点「检查更新 / 导出备份 / 巡检结果」后落在这里 -->
          <template v-if="activeAction">
            <div class="admin-section">
              <div class="admin-section-header">
                <h2>{{ actionResult ? actionResult.title : (RAIL_TITLE[activeAction] || activeAction) }}</h2>
                <button class="admin-btn ghost" :disabled="!!railBusy" @click="runAction(activeAction)">
                  {{ railBusy ? '执行中…' : '再执行一次' }}
                </button>
              </div>
              <p class="admin-action-tip">{{ RAIL_TIP[activeAction] }}</p>
              <div v-if="actionResult" class="admin-action-rows">
                <div v-for="row in actionResult.items" :key="row[0]" class="admin-action-row">
                  <span>{{ row[0] }}</span><b>{{ row[1] }}</b>
                </div>
                <div v-if="actionResult.hint" class="admin-action-hint">{{ actionResult.hint }}</div>
              </div>
              <div v-else-if="!railBusy" class="admin-action-empty">还没执行。</div>
            </div>
          </template>

          <template v-else-if="activeTab === 'overview'">
            <!-- 概览：站点库与洞察。模块入口与状态已经移到左动作栏 ——
                 原来那一屏 12 个等大的卡片正是「没有层次、没有重点」的来源。 -->
            <div class="admin-stats">
              <div class="admin-stat-card">
                <div class="admin-stat-value">{{ sitesStore.sites.length }}</div>
                <div class="admin-stat-label">站点总数</div>
              </div>
              <div class="admin-stat-card">
                <div class="admin-stat-value">{{ categoriesStore.categories.length }}</div>
                <div class="admin-stat-label">分类数</div>
              </div>
              <div class="admin-stat-card">
                <div class="admin-stat-value">{{ todayCount }}</div>
                <div class="admin-stat-label">今日访问</div>
              </div>
              <div class="admin-stat-card">
                <div class="admin-stat-value">{{ favoritesStore.count }}</div>
                <div class="admin-stat-label">收藏数</div>
              </div>
            </div>
            <div class="admin-section">
              <AdminInsights />
            </div>
          </template>

          <AdminPreferences v-else-if="activeTab === 'preferences'" />

          <AdminSitesPanel v-else-if="activeTab === 'sites'" :admin-key="adminKey" />

          <AdminCategoryManager v-else-if="activeTab === 'categories'" />

          <div v-else-if="activeTab === 'publish'" class="admin-section">
            <div class="admin-section-header">
              <h2>云端发布（热更新）</h2>
              <span class="admin-cloud-version" v-if="sitesStore.cloudVersion">云端版本 v{{ sitesStore.cloudVersion }}</span>
            </div>

            <AdminPublishPreflight :admin-key="adminKey" @verdict="onPreflight" />

            <div class="admin-publish-box">
              <p class="admin-publish-desc">将当前站点数据发布到云端后，所有已打开的页面会在 <b>30 秒内自动热更新</b>，无需刷新、无需重新部署。</p>
              <p v-if="categoriesStore.dirty" class="admin-publish-warn">
                检测到分类体系有本地改动，本次发布会一并推送新的分类表。
              </p>
              <p v-if="!preflightOk" class="admin-publish-block">
                预检未通过，已禁止发布：{{ preflightBlockers }}
              </p>
              <div class="admin-publish-row">
                <div class="admin-cred-line">
                  <span class="admin-cred-dot"></span>
                  已登录为 <b>{{ authUser }}</b>
                  <span v-if="authVia === 'key'">（管理密钥直连，无有效期）</span>
                  <span v-else-if="authExpiresAt">· 会话有效至 {{ fmtTime(authExpiresAt) }}</span>
                </div>
                <button class="admin-btn" @click="publishToCloud" :disabled="publishState === 'loading' || !preflightOk">
                  {{ publishState === 'loading' ? '发布中...' : '发布到云端' }}
                </button>
              </div>
              <input
                v-model="webhookUrl"
                type="url"
                class="admin-key-input admin-webhook-input"
                placeholder="可选：发布成功后的 Webhook 通知地址（POST）"
              />
              <div v-if="publishMsg" class="admin-publish-msg" :class="{ success: publishState === 'success', error: publishState === 'error' }">
                {{ publishMsg }}
              </div>
            </div>
          </div>

          <div v-else-if="activeTab === 'snapshots'" class="admin-section">
            <AdminSnapshots :admin-key="adminKey" @rolled="onRolled" />
          </div>

          <div v-else-if="activeTab === 'history'" class="admin-section">
            <AdminPublishHistory :admin-key="adminKey" />
          </div>

          <div v-else-if="activeTab === 'audit'" class="admin-section">
            <AdminAuditLog :admin-key="adminKey" />
          </div>

          <div v-else-if="activeTab === 'notify'" class="admin-section">
            <AdminNotifications :admin-key="adminKey" @badge="unreadBadge = $event" />
          </div>

          <div v-else-if="activeTab === 'backup'" class="admin-section">
            <AdminBackup :admin-key="adminKey" />
          </div>

          <div v-else-if="activeTab === 'ai'" class="admin-section">
            <AdminAi :admin-key="adminKey" />
          </div>

          <div v-else-if="activeTab === 'deploy'" class="admin-section">
            <AdminDeploy />
          </div>

          <div v-else-if="activeTab === 'plugins'" class="admin-section">
            <AdminPlugins />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { useFavoritesStore } from '@/stores/favorites'
import { useHistoryStore } from '@/stores/history'
import AdminLogin from '@/components/admin/AdminLogin.vue'
import AdminSitesPanel from '@/components/admin/AdminSitesPanel.vue'
import AdminCategoryManager from '@/components/admin/AdminCategoryManager.vue'
import AdminInsights from '@/components/admin/AdminInsights.vue'
import AdminPublishPreflight from '@/components/admin/AdminPublishPreflight.vue'
import AdminSnapshots from '@/components/admin/AdminSnapshots.vue'
import AdminPublishHistory from '@/components/admin/AdminPublishHistory.vue'
import AdminAuditLog from '@/components/admin/AdminAuditLog.vue'
import AdminNotifications from '@/components/admin/AdminNotifications.vue'
import AdminBackup from '@/components/admin/AdminBackup.vue'
import AdminAi from '@/components/admin/AdminAi.vue'
import AdminDeploy from '@/components/admin/AdminDeploy.vue'
import AdminPlugins from '@/components/admin/AdminPlugins.vue'
import AdminPreferences from '@/components/admin/AdminPreferences.vue'
import { opsApi, getAdminKey, setAdminKey, clearAdminKey } from '@/services/opsApi'
import { pluginApi } from '@/services/pluginApi'
import { fetchStatus as fetchDeployStatus, checkUpstream } from '@/services/deployApi'
import { fetchHealth } from '@/services/healthApi'
import { clampRailWidth, DEFAULT_RAIL_W } from '@/utils/sideWidth'
import { safeSetItem, safeRemoveItem } from '@/utils/safeStorage'
import { aiApi } from '@/services/aiApi'
import { alertApi } from '@/services/alertApi'
import { authApi } from '@/services/authApi'
import { recordAudit, setAuditActor } from '@/services/auditLog'
import { ADMIN_SHORTCUTS, SHORTCUT_PREFIX, PREFIX_TTL_MS, matchShortcut, shouldIgnoreKey } from '../../shared/admin-shortcuts.mjs'
import { buildAdminIndex, searchAdminIndex } from '../../shared/admin-search.mjs'

const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()
const favoritesStore = useFavoritesStore()
const historyStore = useHistoryStore()

const todayCount = computed(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return historyStore.records.filter(r => r.timestamp >= today.getTime()).length
})

const unreadBadge = ref(0)
const adminKey = ref(getAdminKey())
const webhookUrl = ref(localStorage.getItem('nav_admin_webhook') || '')
const publishState = ref('idle')
const publishMsg = ref('')

/* ---------------- 模块 Tab ----------------
 * 后台从「一页瀑布流」改为 Tab：每个模块独立成页，不再靠长距离滚动找功能。
 * 选中的 Tab 写进 URL query（?tab=xxx），刷新 / 收藏 / 分享都能落回同一模块；
 * 未登记的 id 一律回落默认页，避免手改地址栏把页面切成空白。
 * 面板用 v-if 懒挂载：8 个面板里有一半在挂载时就会打接口，全量常驻会造成首屏并发请求。
 */
/* 模块导航的表结构（升级）：加了 group，并按「看 → 管 → 发 → 系统」重排。
   原来 13 个模块平铺，没有分组 —— 找「发布相关」要在一条线上从左扫到右。
   重排是这次升级的一部分（不是顺手改的）：分组必须对应一个连贯的顺序才有意义。 */
const TAB_GROUPS = [
  { id: 'overview', label: '总览' },
  { id: 'data', label: '数据' },
  { id: 'ops', label: '运维' },
  { id: 'release', label: '发布' },
  { id: 'system', label: '系统' },
]

const TABS = [
  { id: 'overview', label: '仪表盘', group: 'overview' },
  { id: 'sites', label: '站点管理', group: 'data' },
  { id: 'categories', label: '分类体系', group: 'data' },
  { id: 'deploy', label: '部署', group: 'ops' },
  { id: 'plugins', label: '插件', group: 'ops' },
  { id: 'backup', label: '备份与恢复', group: 'ops' },
  { id: 'publish', label: '云端发布', group: 'release' },
  { id: 'snapshots', label: '快照与回滚', group: 'release' },
  { id: 'history', label: '发布历史', group: 'release' },
  { id: 'preferences', label: '偏好设置', group: 'system' },
  { id: 'notify', label: '通知中心', group: 'system' },
  { id: 'audit', label: '操作审计', group: 'system' },
  { id: 'ai', label: 'AI 助手', group: 'system' },
]
const DEFAULT_TAB = 'overview'
const TAB_IDS = new Set(TABS.map(t => t.id))

const route = useRoute()
const router = useRouter()

function tabFromRoute() {
  const id = String(route.query.tab || '')
  return TAB_IDS.has(id) ? id : DEFAULT_TAB
}

const activeTab = ref(tabFromRoute())

function selectTab(id) {
  if (!TAB_IDS.has(id) || id === activeTab.value) return
  activeTab.value = id
  const query = { ...route.query }
  if (id === DEFAULT_TAB) delete query.tab
  else query.tab = id
  router.replace({ path: route.path, query })
}

/* ---------------- 全局搜索（#21） ---------------- */

const KIND_LABEL = { tab: '模块', setting: '设置', site: '站点', category: '分类', plugin: '插件' }

const query = ref('')
const activeIdx = ref(0)

const adminIndex = computed(() => buildAdminIndex({
  tabs: TABS,
  sites: sitesStore.sites,
  categories: categoriesStore.categories,
}))
const results = computed(() => searchAdminIndex(adminIndex.value, query.value, 12))

watch(results, () => { activeIdx.value = 0 })

function moveResult(delta) {
  const n = results.value.length
  if (!n) return
  activeIdx.value = (activeIdx.value + delta + n) % n
}

function goResult(r) {
  if (!r) return
  selectTab(r.target)
  query.value = ''
}

/* ---------------- 左动作栏（中间区） ----------------
 * 取代原来的「一排 tab + 卡片仪表盘」。用户的两条诉求直接决定这里的形状：
 *   ① 「层次感与重点」→ 栏里是**分组 + 主次分明**的动作与模块；模块的实时状态
 *      写在栏内右侧。不再需要一屏 12 个等大的状态卡 —— 等大就是没有重点。
 *   ② 「切换只需一次」→ 点栏内任一项即达；其中只读/安全的动作点一下就直接执行。
 * 栏本身可折叠（图标态）可拖宽，宽度与折叠态存本机。
 */
const RAIL_GROUPS = [
  { id: 'act', label: '常用动作', items: [
    { id: 'publish', kind: 'tab', tab: 'publish', label: '发布到云端', icon: '⇪' },
    { id: 'act:check', kind: 'act', action: 'check', label: '检查更新', icon: '⟳' },
    { id: 'act:backup', kind: 'act', action: 'backup', label: '导出备份', icon: '⛁' },
    { id: 'act:health', kind: 'act', action: 'health', label: '巡检结果', icon: '◎' },
  ] },
  { id: 'batch', label: '批量', items: [
    { id: 'batch-sites', kind: 'tab', tab: 'sites', label: '批量刷新描述', icon: '✎' },
    { id: 'batch-ai', kind: 'tab', tab: 'ai', label: 'AI 生成描述', icon: '✦' },
  ] },
  { id: 'mod', label: '模块', items: [
    { id: 'overview', kind: 'tab', tab: 'overview', label: '概览', icon: '◱' },
    { id: 'sites', kind: 'tab', tab: 'sites', label: '站点管理', icon: '☰' },
    { id: 'categories', kind: 'tab', tab: 'categories', label: '分类体系', icon: '◇' },
    { id: 'deploy', kind: 'tab', tab: 'deploy', label: '部署', icon: '⇪' },
    { id: 'plugins', kind: 'tab', tab: 'plugins', label: '插件', icon: '◈' },
    { id: 'snapshots', kind: 'tab', tab: 'snapshots', label: '快照与回滚', icon: '⟲' },
    { id: 'history', kind: 'tab', tab: 'history', label: '发布历史', icon: '≡' },
    { id: 'audit', kind: 'tab', tab: 'audit', label: '操作审计', icon: '▤' },
    { id: 'notify', kind: 'tab', tab: 'notify', label: '通知中心', icon: '◔' },
    { id: 'preferences', kind: 'tab', tab: 'preferences', label: '偏好设置', icon: '⚙' },
    { id: 'backup', kind: 'tab', tab: 'backup', label: '备份与恢复', icon: '⛁' },
  ] },
]

const railSel = ref(localStorage.getItem('nav_admin_rail_sel') || 'overview')
const railW = ref(clampRailWidth(localStorage.getItem('nav_admin_rail_w')))
const railCollapsed = ref(localStorage.getItem('nav_admin_rail_collapsed') === '1')
const activeAction = ref('')          // 选中「动作」时的动作名；与 activeTab 互斥
const railBusy = ref('')
const actionResult = ref(null)

watch([railW, railCollapsed, railSel], () => {
  safeSetItem('nav_admin_rail_w', String(railW.value))
  safeSetItem('nav_admin_rail_collapsed', railCollapsed.value ? '1' : '0')
  safeSetItem('nav_admin_rail_sel', railSel.value)
})

// 栏内右侧的状态数字：复用卡片那套取值，取紧凑写法
function railMetaOf(tabId) {
  if (!tabId) return ''
  const c = dashCards.value.find(x => x.id === tabId)
  return c && c.short ? String(c.short) : ''
}

function pickRail(it) {
  railSel.value = it.id
  if (it.kind === 'act') {
    activeAction.value = it.action
    return runAction(it.action)
  }
  activeAction.value = ''
  actionResult.value = null
  selectTab(it.tab)
}

/* ---- 动作执行：点一下就跑 ----
 * 这里只放**只读或安全**的动作（检查更新 / 导出备份 / 看巡检结果）。
 * 发布、回滚、恢复备份这类不可逆动作**刻意不绑在导航点击上** —— 误触一次就是线上事故，
 * 它们仍然要求「进入面板 → 再点执行」这一层确认。 */
async function runAction(kind) {
  const key = adminKey.value.trim()
  if (!key) return
  railBusy.value = kind
  actionResult.value = null
  try {
    if (kind === 'check') {
      const st = await fetchDeployStatus()
      if (!st.ok) throw new Error(st.error)
      const sha = st.status.version?.shortSha || st.status.version?.sha || ''
      const up = await checkUpstream(sha)
      actionResult.value = {
        ok: true,
        title: '检查更新',
        items: [
          ['线上版本', sha || '—'],
          ['构建状态', st.status.version?.dirty ? '含未提交改动' : '与提交一致'],
          ['与上游', up.ok ? (up.behind ? `落后 ${up.behind} 个提交` : '已是最新') : (up.error || '查不到上游')],
        ],
      }
    } else if (kind === 'backup') {
      const data = await opsApi.backup(key)
      if (!data || data.kind !== 'navigator-backup') throw new Error('备份接口没返回有效数据')
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `navigator-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
      actionResult.value = {
        ok: true,
        title: '导出备份',
        items: [
          ['站点', String(data.counts?.sites ?? 0)],
          ['分类', String(data.counts?.categories ?? 0)],
          ['文件体积', `${Math.max(1, Math.round(blob.size / 1024))} KB`],
        ],
        hint: '文件已开始下载',
      }
    } else if (kind === 'health') {
      const r = await fetchHealth()
      const c = r.counts || {}
      actionResult.value = {
        ok: true,
        title: '巡检结果',
        items: [
          ['正常', String(c.ok ?? 0)],
          ['可忽略', String(c.limited ?? 0)],
          ['需处理', String(c.down ?? 0)],
        ],
        hint: r.updatedAt ? `最近一轮 ${fmtTime(new Date(r.updatedAt).getTime())}` : '还没有巡检快照',
      }
    }
  } catch (e) {
    actionResult.value = { ok: false, title: '执行失败', items: [['原因', String(e?.message || e)]] }
  } finally {
    railBusy.value = ''
  }
}

/* ---- 拖宽 / 复位 ---- */
let railUnlisten = null
function startRailResize(e) {
  e.preventDefault()
  const startX = e.clientX
  const startW = railW.value
  let pendingX = startX
  let raf = 0
  const flush = () => { raf = 0; railW.value = clampRailWidth(startW + (pendingX - startX)) }
  const onMove = (ev) => { pendingX = ev.clientX; if (!raf) raf = requestAnimationFrame(flush) }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    if (raf) { cancelAnimationFrame(raf); raf = 0 }
    railW.value = clampRailWidth(startW + (pendingX - startX))
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    railUnlisten = null
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  railUnlisten = onUp
}
function resetRailWidth() { railW.value = DEFAULT_RAIL_W }

/* ---------------- 快捷键（#19）：g 前缀序列 ---------------- */

let prefixAt = 0
function onShortcutKey(e) {
  // 输入框里 / 带修饰键时一律不响应 —— 否则在搜索框打「gs」就会跳面板
  if (shouldIgnoreKey(e)) { prefixAt = 0; return }
  const k = String(e.key || '').toLowerCase()
  const now = Date.now()
  if (k === SHORTCUT_PREFIX) { prefixAt = now; return }
  if (prefixAt && now - prefixAt < PREFIX_TTL_MS) {
    const hit = matchShortcut(SHORTCUT_PREFIX, k)
    prefixAt = 0
    if (hit) {
      e.preventDefault()
      selectTab(hit.tab)
    }
  }
}

// 地址栏改动（含浏览器前进/后退）也要跟着切
watch(() => route.query.tab, () => {
  const id = tabFromRoute()
  if (id !== activeTab.value) activeTab.value = id
})

/* ---------------- 登录态 ---------------- */

const authed = ref(false)
const authChecking = ref(true)
const authUser = ref('')
const authVia = ref('')
/** 'local' = 本机自动登录（服务端回环端点给的密钥），空 = 人工登录 */
const authAuto = ref('')
/** 版本标识：读 /api/deploy-status（公开只读），未登录时也显示 */
const version = ref('')
const versionTitle = ref('')
const authExpiresAt = ref(0)
const loginNotice = ref('')

const preflight = ref(null)
const preflightOk = computed(() => Boolean(preflight.value?.ok))
const preflightBlockers = computed(() => (preflight.value?.blockers || []).map(b => b.message).join('；'))

function fmtTime(ts) {
  return new Date(ts).toLocaleString('zh-CN')
}

function onPreflight(result) {
  preflight.value = result
}

/**
 * 通知角标：通知中心面板是懒加载的，只靠它自己 emit 要等用户点开那个 Tab 才会上报，
 * 角标就失去了「提示有新通知」的意义，所以这里主动拉一次。
 */
async function loadUnread() {
  const key = adminKey.value.trim()
  if (!key) { unreadBadge.value = 0; return }
  try {
    const r = await opsApi.notifications(key, { limit: 1 })
    unreadBadge.value = r.summary?.unread || 0
  } catch {
    /* 角标拿不到不影响后台使用 */
  }
}

/**
 * 仪表盘摘要：三个请求并行发出，拿不到就留空。
 * 为什么是三次而不是一次大接口：这三份数据分属三个端点（运维面 / 插件清单 / 快照），
 * 而它们各自的读者就在自己那侧 —— 为了"一次请求"去跨层拼一个聚合接口，
 * 代价是把数据面和运维面又搅在一起（`api/ops.js` 头部专门解释过为什么要分开）。
 * 三次并行 GET 换来分层清楚，值。
 */
const dashOps = ref(null)
const dashPlugins = ref(null)
const dashSnapshots = ref(null)
const dashBackup = ref(null)
const dashAlerts = ref(null)
const dashAi = ref(null)

async function loadDash() {
  const key = adminKey.value.trim()
  if (!key) return
  const [ops, plug, snaps, bak, alerts, ai] = await Promise.all([
    opsApi.dashboardSummary(key).catch(() => null),
    pluginApi.light(key).catch(() => null),
    opsApi.snapshots(key).catch(() => null),
    opsApi.backupMeta(key).catch(() => null),
    alertApi.load(key).catch(() => null),
    aiApi.probe().catch(() => null),
  ])
  dashOps.value = ops && ops.ok ? ops : null
  dashPlugins.value = plug && plug.ok ? plug : null
  dashSnapshots.value = snaps && snaps.ok !== false && Number.isFinite(snaps.count) ? snaps : null
  dashBackup.value = bak && bak.ok ? bak : null
  dashAlerts.value = alerts && alerts.ok ? alerts : null
  dashAi.value = ai && ai.ok !== false ? ai : null
}

function onLogin({ token, username, via, expiresAt, auto }) {
  adminKey.value = token
  // expiresAt 一并存下：前端据此在过期时就地清掉凭据，不必等一次 401 往返
  setAdminKey(token, expiresAt)
  authUser.value = username || 'admin'
  authVia.value = via || 'session'
  authAuto.value = auto || ''
  authExpiresAt.value = expiresAt || 0
  setAuditActor(username || '')
  loginNotice.value = ''
  authed.value = true
  loadUnread()
  loadDash()
}

/**
 * 版本标识：读线上自述的构建信息。
 * 失败就留空（旧部署包没有 build-info.json），**绝不编一个假的出来** —— 版本号编错比不显示更糟。
 */
async function loadVersion() {
  const r = await fetchDeployStatus()
  if (!r.ok) return
  const j = r.status
  if (j && j.version && j.version.available && j.version.shortSha) {
    version.value = j.version.shortSha + (j.version.dirty ? '+未提交' : '')
    versionTitle.value = [
      `${j.version.branch || ''} ${j.version.shortSha}`,
      j.version.subject || '',
      j.version.builtAt ? `构建于 ${new Date(j.version.builtAt).toLocaleString('zh-CN', { hour12: false })}` : '',
    ].filter(Boolean).join('\n')
  }
}

function logout() {
  const key = adminKey.value.trim()
  if (key) authApi.logout(key)
  adminKey.value = ''
  clearAdminKey()
  authed.value = false
  authUser.value = ''
  authVia.value = ''
  authExpiresAt.value = 0
  publishState.value = 'idle'
  publishMsg.value = ''
  preflight.value = null
  unreadBadge.value = 0
  setAuditActor('')
}

/** 任一面板拿到 401 即广播失效，这里统一退回登录闸门 */
function onAuthExpired() {
  if (!authed.value) return
  logout()
  loginNotice.value = '登录状态已失效，请重新登录'
}

/* ---------------- 仪表盘卡片 ---------------- */

// 一句话说明：让「这个模块是干什么的」在进去之前就能读到
const DASH_DESC = {
  sites: '增删改、批量操作、书签导入',
  categories: '全部方向下的分类表',
  deploy: '本地 / 上次构建 / 线上三方对照',
  plugins: '九个引擎模块的统一管理面',
  backup: '备份与恢复站点库',
  publish: '把站点库推到线上，30 秒内热更新',
  snapshots: '发布前快照与一键回滚',
  history: '发布记录与结果',
  preferences: '主题、卡片、告警规则',
  notify: '需要你处理的事',
  audit: '谁在何时做了什么',
  ai: '分类、摘要、描述这些对话能力',
}

const dashCards = computed(() => TABS
  .filter(t => t.id !== 'overview')
  .map(t => {
    const c = { id: t.id, label: t.label, desc: DASH_DESC[t.id] || '', value: '', unit: '', short: '' }
    const ops = dashOps.value
    const pl = dashPlugins.value
    const sn = dashSnapshots.value
    // 只放手头真有的数：拿不到就留空（宁可不显示，也不编一个好看的数）。
    // 备份与恢复 / 偏好设置 / AI 助手 没有「数字型」的实时状态，所以它们永远只有说明 ——
    // 硬塞一个数只会是假信息。
    if (t.id === 'sites') { c.value = sitesStore.sites.length; c.unit = '条' }
    else if (t.id === 'categories') { c.value = categoriesStore.categories.length; c.unit = '个' }
    else if (t.id === 'deploy') c.value = version.value || ''
    else if (t.id === 'plugins') { if (pl) { c.value = pl.groups.length; c.unit = '个引擎' } }
    else if (t.id === 'publish') { if (sitesStore.cloudVersion) { c.value = 'v' + sitesStore.cloudVersion; c.unit = '云端' } }
    else if (t.id === 'snapshots') { if (sn) { c.value = sn.count; c.unit = '个可回滚' } }
    else if (t.id === 'history') {
      if (ops) {
        c.value = ops.history.total
        c.unit = ops.history.successRate == null ? '次' : `次 · 成功率 ${ops.history.successRate}%`
      }
    } else if (t.id === 'audit') {
      if (ops) {
        c.value = ops.audit.total
        c.unit = ops.audit.failures ? `条 · 异常 ${ops.audit.failures}` : '条'
      }
    } else if (t.id === 'notify') {
      // 0 也要显示（「0 未读」是信息，「什么都不显示」不是）
      if (ops) { c.value = ops.notify.unread; c.unit = '未读' }
      else if (unreadBadge.value) { c.value = unreadBadge.value; c.unit = '未读' }
    } else if (t.id === 'backup') {
      // 备份没有「最近一次」的时间戳（服务端不记备份历史），所以给的是
      // 「一次备份会带走什么」—— 条目数 + 真实序列化体积，都是现算的
      if (dashBackup.value) {
        const m = dashBackup.value
        c.value = m.counts.sites
        c.unit = `站点可导出 · 约 ${Math.max(1, Math.round(m.bytes / 1024))} KB`
      }
    } else if (t.id === 'preferences') {
      if (dashAlerts.value) {
        const rules = dashAlerts.value.config?.rules || []
        c.value = rules.length
        c.unit = rules.length ? '条告警规则' : '条告警规则 · 用全局阈值'
      }
    } else if (t.id === 'ai') {
      // AI 的「状态」就是「能不能用 + 用的是哪个后端」，比任何数字都有用
      if (dashAi.value) {
        c.value = dashAi.value.ready ? (dashAi.value.model || '已配置') : '未配置'
        c.unit = dashAi.value.ready ? '就绪' : '需要配置后端'
      }
    }
    // 动作栏右侧只放一个紧凑数字/短串，长单位留给面板自己
    c.short = c.value === '' ? '' : String(c.value)
    return c
  }))

const RAIL_TITLE = { check: '检查更新', backup: '导出备份', health: '巡检结果' }
const RAIL_TIP = {
  check: '对比线上版本与上游仓库。只读检查，点一下即执行。',
  backup: '把当前站点库与分类打包下载到本机，点一下即开始下载。',
  health: '最近一轮服务端巡检的结果。巡检由服务端按间隔自动跑，这里只读快照。',
}

onMounted(async () => {
  window.addEventListener('nav-auth-expired', onAuthExpired)
  window.addEventListener('keydown', onShortcutKey)
  loadVersion()
  const key = adminKey.value.trim()
  if (!key) {
    authChecking.value = false
    return
  }
  try {
    const r = await authApi.verify(key)
    if (r.valid) {
      authUser.value = r.username || 'admin'
      authVia.value = r.via || 'session'
      authExpiresAt.value = r.expiresAt || 0
      setAuditActor(r.username || '')
      authed.value = true
      loadUnread()
      loadDash()
    } else {
      adminKey.value = ''
      clearAdminKey()
      loginNotice.value = r.reason === 'expired' ? '登录已过期，请重新登录' : '凭据无效，请重新登录'
    }
  } catch {
    loginNotice.value = '无法校验凭据，请重新登录'
  } finally {
    authChecking.value = false
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onShortcutKey)
  window.removeEventListener('nav-auth-expired', onAuthExpired)
})

watch(webhookUrl, (v) => {
  if (v) safeSetItem('nav_admin_webhook', v)
  else safeRemoveItem('nav_admin_webhook')
})

/** 回滚成功：先丢弃未发布的本地分类新建（与站点覆盖层同口径），再把响应回填为云端基底后清覆盖层 —— 顺序反了，自动建的分类会被重新叠进旧表 */
function onRolled(data) {
  categoriesStore.clearLocalAdds()
  sitesStore.applyCloudData(data)
  sitesStore.clearLocalOverlay()
  recordAudit('rollback.apply', { target: data.restoredFrom || '', detail: `回滚到 v${data.version} · ${data.sites?.length || 0} 站点` })
}

/** 发布成功后落一条历史 + 一条通知（运维面失败不影响发布结果） */
function recordPublish(data) {
  const key = adminKey.value.trim()
  const count = data.sites?.length || sitesStore.sites.length
  opsApi.appendHistory(key, {
    runner: 'cloud',
    trigger: 'admin',
    ok: true,
    duration: null,
    steps: [{ key: 'hotupdate', label: 'Blob 热更新', status: 'success', detail: `v${data.version} · ${count} 站点` }],
    cloud: { version: data.version, count, previousVersion: data.previousVersion || 0 },
    snapshot: data.snapshot?.pathname ? { pathname: data.snapshot.pathname, ok: data.snapshot.ok !== false } : null,
    counts: { sites: count },
    note: '线上后台热更新',
  }).catch(() => {})
  opsApi.pushNotification(key, {
    kind: 'publish.done',
    title: `发布完成 · v${data.version}`,
    body: `${count} 站点已热更新到云端`,
    meta: { version: data.version, count },
  }).catch(() => {})
}

async function publishToCloud() {
  if (!adminKey.value.trim()) {
    publishState.value = 'error'
    publishMsg.value = '凭据已失效，请重新登录'
    return
  }
  if (!preflightOk.value) {
    publishState.value = 'error'
    publishMsg.value = '预检未通过：' + preflightBlockers.value
    return
  }
  publishState.value = 'loading'
  publishMsg.value = ''
  try {
    // 分类表只在本地草稿偏离云端时才推送：否则每次发布都会把云端表覆盖成本地副本，
    // 一旦本地没成功拉到云端表（离线/首屏兜底），就会静默把云端分类退回默认表
    const cats = categoriesStore.dirty ? categoriesStore.toCloudGroups() : undefined
    const data = await opsApi.publish(adminKey.value.trim(), sitesStore.sites, cats)
    publishState.value = 'success'
    publishMsg.value = `发布成功！云端版本 v${data.version}，其他设备将在 30 秒内自动更新。`
    // 发布的就是「云端基底 + 本地覆盖层」拼出的当前列表，覆盖层内容已进云端：
    // 先用响应回填基底（避免清层后短暂回退到旧数据），再清掉覆盖层，
    // 否则本地改动会长期遮蔽后续云端变更。
    sitesStore.applyCloudData(data)
    sitesStore.clearLocalOverlay()
    // 分类同理：发布成功的响应带着云端新表（applyCloudData 已回填基线），
    // 已进云端的本地新增记录在这里撤掉；被云端表挡下的记录保留，等域回来再生效
    categoriesStore.clearLocalAdds()
    recordAudit('publish.done', { target: `v${data.version}`, detail: `${data.sites?.length || sitesStore.sites.length} 站点热更新到云端${cats ? '（含分类表）' : ''}` })
    recordPublish(data)
    if (webhookUrl.value.trim()) {
      notifyWebhook(data.version, data.sites?.length || sitesStore.sites.length)
    }
    loadUnread()
  } catch (e) {
    publishState.value = 'error'
    publishMsg.value = '发布失败：' + e.message
    recordAudit('publish.fail', { target: '', result: 'fail', detail: e.message })
  }
}

async function notifyWebhook(version, count) {
  try {
    await fetch(webhookUrl.value.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'publish', version, count, time: new Date().toISOString() })
    })
  } catch {
    // webhook 通知失败不影响发布结果，静默忽略
  }
}
</script>

<style scoped>
/* /admin 是 standalone 路由，不套 .app-layout，而全局 html,body 为了主壳固定分栏
   设了 overflow:hidden —— 视口滚动被关掉。这里自己搭「固定头部 + 固定 Tab 栏 + 滚动内容区」，
   滚动下沉到 .admin-body，头部与 Tab 栏始终可见。 */
/* 三栏化后它渲染在 .main 里（.main 已是 flex:1 的列容器），所以填满父级即可，
   不再是整页 100vh —— 那样会把侧边栏与右栏挤掉 */
.admin-view {
  flex: 1;
  min-height: 0;
  /* 两列：左动作栏（auto，宽度由内联样式给）+ 内容（1fr）；两行：头部 + 主体 */
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto 1fr;
  overflow: hidden;
  background: transparent; /* 主区背景透过来，和洞察 / 图谱 / 关于一致 */
  padding: 0;
}
.admin-header {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 28px;
  /* 跟主站一致：透明底 + 细分割线，不用实色卡片头，免得与侧边栏形成两层「顶栏」 */
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.admin-back {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--accent);
  font-weight: 500;
  text-decoration: none;
}
.admin-back svg { width: 16px; height: 16px; }
.admin-header h1 { font-size: 20px; font-weight: 700; }
/* 版本徽标：贴在标题右侧，悬停显示完整信息（分支 / 提交说明 / 构建时间） */
.admin-version {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11.5px;
  color: var(--text-secondary);
  background: var(--border-light);
  border: 1px solid var(--border);
  padding: 2px 9px;
  border-radius: 999px;
  white-space: nowrap;
  cursor: default;
}

/* 左动作栏：中间区左侧那一列，承担「切换 + 执行」，比主站侧栏窄一档。
   折叠态只留图标（56px）；右边缘可拖宽、双击复位。 */
.admin-rail {
  position: relative;
  grid-column: 1;
  grid-row: 2;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 14px 10px;
  background: var(--bg-white);
  border-right: 1px solid var(--border-light);
  overflow: hidden auto;
}
.ar-group {
  padding: 12px 10px 5px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: .02em;
}
.ar-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}
.ar-item:hover { background: var(--border-light); }
.ar-item.on { background: var(--accent-light); color: var(--accent); font-weight: 600; }
.ar-item.icon { justify-content: center; padding: 9px 0; }
.ar-icon { flex: 0 0 16px; text-align: center; font-size: 13px; color: var(--text-secondary); }
.ar-item.on .ar-icon { color: var(--accent); }
.ar-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 状态数字：模块的实时状态就写在这里，所以不再需要一屏等大的状态卡 */
.ar-meta { font-size: 11px; color: var(--text-secondary); font-variant-numeric: tabular-nums; max-width: 84px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ar-item.on .ar-meta { color: var(--accent); }
.ar-spin { color: var(--accent); font-weight: 700; }
.ar-resize {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 6px;
  z-index: var(--z-inline);
  cursor: col-resize;
  background: transparent;
  transition: background var(--dur-fast) ease;
}
.ar-resize:hover, .ar-resize:active { background: var(--accent); opacity: .3; }
.admin-rail-toggle { padding: 6px 10px; font-size: 12px; }

/* 动作执行结果（左动作栏里点「检查更新 / 导出备份 / 巡检结果」后落在这里） */
.admin-action-tip { margin: 0 0 14px; font-size: 12.5px; color: var(--text-secondary); line-height: 1.7; }
.admin-action-rows {
  background: var(--bg-white);
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  padding: 14px 18px;
}
.admin-action-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 7px 0;
  border-bottom: 1px solid var(--border-light);
  font-size: 13px;
}
.admin-action-row:last-child { border-bottom: none; }
.admin-action-row span { flex: 0 0 96px; font-size: 12px; color: var(--text-secondary); }
.admin-action-row b { font-weight: 600; }
.admin-action-hint { margin-top: 10px; font-size: 11.5px; color: var(--text-secondary); }
.admin-action-empty { font-size: 12.5px; color: var(--text-secondary); }

.admin-tab-badge {
  display: inline-block;
  min-width: 16px;
  margin-left: 6px;
  padding: 0 4px;
  border-radius: 8px;
  background: #ef4444;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
  vertical-align: 1px;
}

/* 内容区是唯一滚动容器；min-height:0 让 grid 子项可收缩，否则滚动条不会出现 */
.admin-body {
  grid-column: 2;
  grid-row: 2;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
/* 未登录时不渲染动作栏，内容横跨整行 */
.admin-body-full { grid-column: 1 / -1; }
.admin-tabpanel { padding-top: 24px; }
/* 各模块自带左右 32px 与底部留白，顶部留白统一由 .admin-tabpanel 给，避免叠加 */
.admin-tabpanel > :first-child { padding-top: 0; }

.admin-user {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 16px;
  border-left: 1px solid var(--border);
  font-size: 12.5px;
  color: var(--text-secondary);
}
.admin-user-dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; }
.admin-user-name { font-weight: 600; color: var(--text-primary); }
.admin-user-via { font-size: 11.5px; color: var(--text-disabled); }
.admin-auth-check { font-size: 13px; color: var(--text-secondary); padding: 40px 0; text-align: center; }
.admin-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  padding: 24px 32px;
}
.admin-stat-card {
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  text-align: center;
}
.admin-stat-value { font-size: 28px; font-weight: 700; color: var(--accent); }
.admin-stat-label { font-size: 13px; color: var(--text-secondary); margin-top: 4px; }
.admin-section { padding: 0 32px 32px; }

.admin-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.admin-section-header h2 { font-size: 16px; font-weight: 600; }
.admin-btn {
  padding: 7px 16px;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.admin-btn:hover { filter: brightness(1.1); }
.admin-btn:disabled { opacity: .5; cursor: not-allowed; filter: none; }
.admin-btn.ghost { background: var(--bg-white); color: var(--text-primary); border: 1px solid var(--border); }
.admin-btn.ghost:hover { border-color: var(--accent); color: var(--accent); filter: none; }
.admin-publish-btn { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; }
.admin-publish-btn svg { width: 14px; height: 14px; }
.admin-cloud-version { font-size: 12px; color: var(--accent); font-weight: 600; }
.admin-publish-box {
  margin-top: 16px;
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 18px 20px;
}
.admin-publish-desc { font-size: 13px; color: var(--text-secondary); margin-bottom: 14px; line-height: 1.6; }
.admin-publish-desc b { color: var(--accent); }
.admin-publish-warn {
  font-size: 12.5px; color: var(--warn-fg); background: var(--warn-bg); border: 1px solid var(--warn-border);
  border-radius: var(--radius-sm); padding: 8px 12px; margin-bottom: 14px;
}
.admin-publish-block {
  font-size: 12.5px; color: var(--danger-fg); background: var(--danger-bg); border: 1px solid var(--danger-border);
  border-radius: var(--radius-sm); padding: 8px 12px; margin-bottom: 14px; line-height: 1.6;
}
.admin-publish-row { display: flex; gap: 10px; align-items: center; }
.admin-cred-line {
  flex: 1; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  font-size: 12.5px; color: var(--text-secondary);
}
.admin-cred-line b { color: var(--text-primary); }
.admin-cred-dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; }
.admin-webhook-input { margin-top: 10px; display: block; width: 100%; box-sizing: border-box; }
.admin-link-btn { border: none; background: transparent; color: var(--accent); cursor: pointer; font-size: 12px; padding: 0; text-decoration: underline; }
.admin-key-input {
  flex: 1;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-family: var(--font);
  color: var(--text-primary);
  background: var(--bg-white);
  outline: none;
  transition: border-color var(--dur-fast) ease;
}
.admin-key-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-light); }
.admin-publish-msg {
  margin-top: 12px;
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  font-size: 12.5px;
  font-weight: 500;
}
.admin-publish-msg.success { background: var(--ok-bg); color: var(--ok-fg); border: 1px solid var(--ok-border); }
.admin-publish-msg.error { background: var(--danger-bg); color: var(--danger-fg); border: 1px solid var(--danger-border); }
/* 全局搜索（#21） */
.admin-search { position: relative; flex: 1; max-width: 380px; margin: 0 12px; min-width: 160px; }
.admin-search-input {
  width: 100%; padding: 6px 12px; font-size: 13px; border-radius: var(--radius-sm);
  border: 1px solid var(--border); background: var(--bg-white); color: var(--text-primary); outline: none;
}
.admin-search-input:focus { border-color: var(--accent); }
.admin-search-panel {
  position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: var(--z-dropdown);
  background: var(--bg-white); border: 1px solid var(--border); border-radius: var(--radius);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .12); max-height: 320px; overflow-y: auto; padding: 4px;
}
.admin-search-item {
  display: flex; align-items: baseline; gap: 8px; width: 100%; text-align: left;
  padding: 7px 10px; border: none; background: none; border-radius: var(--radius-sm);
  cursor: pointer; font-size: 13px; color: var(--text-primary);
}
.admin-search-item:hover, .admin-search-item.active { background: var(--accent-light); }
.as-kind { flex-shrink: 0; font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 999px; background: var(--border-light); color: var(--text-secondary); }
.as-kind.setting { background: var(--info-bg); color: var(--info-fg); }
.as-kind.tab { background: var(--ok-bg); color: var(--ok-fg); }
.as-kind.site { background: var(--warn-bg); color: var(--warn-fg); }
.as-title { flex-shrink: 0; font-weight: 600; }
.as-sub { color: var(--text-secondary); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.admin-search-empty { padding: 10px; font-size: 12.5px; color: var(--text-secondary); }

/* ── 移动端适配（#18）──────────────────────────────
 * 后台原本是给宽屏设计的，窄屏上有三个具体毛病：
 *   ① 搜索框与标题挤在一行，标题被压到换行；
 *   ② 各面板自带的 `padding: 0 32px` 在手机上把内容压成一条。
 * 用 :deep() 覆盖子组件的 scoped padding —— 那是唯一能跨组件命中它们的写法。 */
@media (max-width: 820px) {
  .admin-header { flex-wrap: wrap; padding: 10px 14px; gap: 8px; }
  .admin-header h1 { font-size: 15px; }
  .admin-search { order: 10; flex-basis: 100%; max-width: none; margin: 4px 0 0; }
  /* 窄屏：动作栏收到图标态，把宽度让给内容 */
  .admin-rail { padding: 10px 6px; }
  .ar-label, .ar-meta, .ar-group { display: none; }
  .ar-item { justify-content: center; padding: 9px 0; }
  .admin-dash-head, .admin-dash-grid { padding-left: 14px; padding-right: 14px; }
  .admin-dash-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
  .admin-view :deep(.admin-section) { padding: 0 14px 24px; }
  .admin-view :deep(.admin-stats) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>