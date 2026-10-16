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

    <div v-if="authChecking" class="admin-body">
      <div class="admin-auth-check">正在校验凭据…</div>
    </div>

    <AdminLogin v-else-if="!authed" class="admin-body" :notice="loginNotice" @success="onLogin" />

    <template v-else>
      <!-- 模块页顶部条：面包屑「← 全部模块 / 分组 / 模块名」。
           仪表盘上不渲染它 —— 卡片本身就是导航；进去之后靠这一条返回与定位。 -->
      <div v-if="activeTab !== 'overview'" class="admin-crumb">
        <button type="button" class="admin-crumb-back" @click="selectTab('overview')">
          <span class="admin-crumb-arrow">←</span> 全部模块
        </button>
        <span class="admin-crumb-sep">/</span>
        <span class="admin-crumb-group">{{ groupLabelOf(activeGroup) }}</span>
        <span class="admin-crumb-sep">/</span>
        <span class="admin-crumb-now">{{ activeLabel }}</span>
        <span v-if="activeTab === 'notify' && unreadBadge" class="admin-tab-badge">{{ unreadBadge }}</span>
      </div>

      <div class="admin-body">
        <div class="admin-tabpanel">
          <template v-if="activeTab === 'overview'">
            <!-- 仪表盘：模块卡片铺满中间区（auto-fill 自适应宽度，不再是一条窄列）。
                 卡片上的数字只放**已经拿得到**的：拿不到就不写，不编一个好看的数。 -->
            <div class="admin-dash">
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

              <div class="admin-dash-head">
                <h2>全部模块</h2>
                <span class="admin-dash-sub">{{ dashCards.length }} 个 · 点卡片进入</span>
              </div>
              <div class="admin-dash-grid">
                <button
                  v-for="m in dashCards" :key="m.id"
                  type="button" class="admin-dash-card"
                  @click="selectTab(m.id)"
                >
                  <span class="adc-top">
                    <span class="adc-name">{{ m.label }}</span>
                  </span>
                  <span class="adc-desc">{{ m.desc }}</span>
                  <span class="adc-meta">
                    <!-- 判空必须写 !== '' ：0 是**真实数据**（审计 0 条、未读 0），
                         用 v-if="m.value" 会把它当成空而什么都不显示 -->
                    <span v-if="m.value !== ''" class="adc-value">{{ m.value }}</span>
                    <span v-if="m.unit" class="adc-unit">{{ m.unit }}</span>
                    <span class="adc-go">进入 →</span>
                  </span>
                </button>
              </div>

              <!-- 不要再加「数据洞察」标题：AdminInsights 自带同名标题，加了就是两份 -->
              <div class="admin-section" style="padding-top:0">
                <AdminInsights />
              </div>
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

/* ---------------- 模块导航：面包屑 ---------------- */

// 当前模块在模块表里的那一项：面包屑要显示「分组 / 模块名」
const activeGroup = computed(() => TABS.find(t => t.id === activeTab.value)?.group || '')
const activeLabel = computed(() => TABS.find(t => t.id === activeTab.value)?.label || '')

function groupLabelOf(id) {
  return TAB_GROUPS.find(g => g.id === id)?.label || ''
}

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
  try {
    const res = await fetch('/api/deploy-status', { headers: { Accept: 'application/json' } })
    const j = await res.json()
    if (j && j.version && j.version.available && j.version.shortSha) {
      version.value = j.version.shortSha + (j.version.dirty ? '+未提交' : '')
      versionTitle.value = [
        `${j.version.branch || ''} ${j.version.shortSha}`,
        j.version.subject || '',
        j.version.builtAt ? `构建于 ${new Date(j.version.builtAt).toLocaleString('zh-CN', { hour12: false })}` : '',
      ].filter(Boolean).join('\n')
    }
  } catch { /* 读不到就不显示，不打扰 */ }
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
    const c = { id: t.id, label: t.label, desc: DASH_DESC[t.id] || '', value: '', unit: '' }
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
    return c
  }))

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
  if (v) localStorage.setItem('nav_admin_webhook', v)
  else localStorage.removeItem('nav_admin_webhook')
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
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: transparent; /* 主区背景透过来，和洞察 / 图谱 / 关于一致 */
  padding: 0;
}
.admin-header {
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

/* 模块页顶部条：面包屑。仪表盘上不渲染（卡片本身就是导航）。
   比原来的 tab 行矮一档 —— 它只承担「我在哪 + 怎么回去」，不再承担切换。 */
.admin-crumb {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 24px;
  background: var(--bg-white);
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.admin-crumb-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-white);
  padding: 4px 10px;
  font-size: 12px;
  font-family: inherit;
  color: var(--text-primary);
  cursor: pointer;
  transition: border-color var(--transition), color var(--transition);
}
.admin-crumb-back:hover { border-color: var(--accent); color: var(--accent); }
.admin-crumb-arrow { font-size: 12px; line-height: 1; }
.admin-crumb-sep { color: var(--border); }
.admin-crumb-group { color: var(--text-secondary); }
.admin-crumb-now { font-weight: 600; color: var(--text-primary); }
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

/* 内容区是唯一滚动容器；min-height:0 让 flex 子项可收缩，否则滚动条不会出现 */
.admin-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
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

/* ── 仪表盘：模块卡片铺满中间区 ──────────────────────
 * 用 auto-fill + minmax 而不是固定列数：中间区宽度随两侧栏折叠/窗口变化，
 * 固定列数必然在某档宽度下留出大片空白（这正是「布局不自适应」的来源）。
 * 卡片高度靠 flex + margin-top:auto 对齐底部，所以同一行里数字和「进入」能对齐。 */
.admin-dash { padding-bottom: 8px; }
.admin-dash .admin-stats { padding-top: 24px; }
.admin-dash-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 0 32px;
  margin: 22px 0 12px;
}
.admin-dash-head h2 { margin: 0; font-size: 15px; font-weight: 600; }
.admin-dash-sub { font-size: 12px; color: var(--text-secondary); }
.admin-dash-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 14px;
  padding: 0 32px;
}
.admin-dash-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 118px;
  padding: 18px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  background: var(--bg-white);
  color: var(--text-primary);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color var(--transition), box-shadow var(--transition), transform var(--transition);
}
.admin-dash-card:hover {
  border-color: var(--accent);
  box-shadow: var(--shadow-hover);
  transform: translateY(-1px);
}
.admin-dash-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.adc-top { display: flex; align-items: center; gap: 8px; }
.adc-name { font-size: 15px; font-weight: 600; }
.adc-desc { font-size: 12px; line-height: 1.6; color: var(--text-secondary); }
.adc-meta { display: flex; align-items: baseline; gap: 6px; margin-top: auto; padding-top: 10px; }
.adc-value { font-size: 15px; font-weight: 600; }
.adc-unit { font-size: 11px; color: var(--text-secondary); }
.adc-go { margin-left: auto; font-size: 11px; color: var(--text-secondary); }
.admin-dash-card:hover .adc-go { color: var(--accent); }
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
  transition: border-color .15s ease;
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
  position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 40;
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
  .admin-crumb { padding: 8px 14px; }
  .admin-dash-head, .admin-dash-grid { padding-left: 14px; padding-right: 14px; }
  .admin-dash-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
  .admin-view :deep(.admin-section) { padding: 0 14px 24px; }
  .admin-view :deep(.admin-stats) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>