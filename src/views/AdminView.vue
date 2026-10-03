<template>
  <div class="admin-view">
    <header class="admin-header">
      <router-link to="/" class="admin-back">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
        返回首页
      </router-link>
      <h1>管理后台</h1>

      <template v-if="authed">
        <button class="admin-btn admin-publish-btn" @click="selectTab('publish')" title="前往云端发布">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          发布到云端
        </button>
        <div class="admin-user">
          <span class="admin-user-dot"></span>
          <span class="admin-user-name">{{ authUser }}</span>
          <span class="admin-user-via">{{ authVia === 'key' ? '密钥直连' : '登录态' }}</span>
          <button class="admin-link-btn" @click="logout">退出登录</button>
        </div>
      </template>
    </header>

    <div v-if="authChecking" class="admin-body">
      <div class="admin-auth-check">正在校验凭据…</div>
    </div>

    <AdminLogin v-else-if="!authed" class="admin-body" :notice="loginNotice" @success="onLogin" />

    <template v-else>
      <nav class="admin-tabs" role="tablist" aria-label="管理后台模块">
        <button
          v-for="t in TABS"
          :key="t.id"
          type="button"
          role="tab"
          class="admin-tab"
          :class="{ active: activeTab === t.id }"
          :aria-selected="activeTab === t.id"
          @click="selectTab(t.id)"
        >
          {{ t.label }}
          <span v-if="t.id === 'notify' && unreadBadge" class="admin-tab-badge">{{ unreadBadge }}</span>
        </button>
      </nav>

      <div class="admin-body">
        <div class="admin-tabpanel">
          <template v-if="activeTab === 'overview'">
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
import { opsApi, getAdminKey, setAdminKey, clearAdminKey } from '@/services/opsApi'
import { authApi } from '@/services/authApi'
import { recordAudit, setAuditActor } from '@/services/auditLog'

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
const TABS = [
  { id: 'overview', label: '概览' },
  { id: 'sites', label: '站点管理' },
  { id: 'categories', label: '分类体系' },
  { id: 'publish', label: '云端发布' },
  { id: 'snapshots', label: '快照与回滚' },
  { id: 'history', label: '发布历史' },
  { id: 'audit', label: '操作审计' },
  { id: 'notify', label: '通知中心' },
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

function onLogin({ token, username, via, expiresAt }) {
  adminKey.value = token
  setAdminKey(token)
  authUser.value = username || 'admin'
  authVia.value = via || 'session'
  authExpiresAt.value = expiresAt || 0
  setAuditActor(username || '')
  loginNotice.value = ''
  authed.value = true
  loadUnread()
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

onMounted(async () => {
  window.addEventListener('nav-auth-expired', onAuthExpired)
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
  window.removeEventListener('nav-auth-expired', onAuthExpired)
})

watch(webhookUrl, (v) => {
  if (v) localStorage.setItem('nav_admin_webhook', v)
  else localStorage.removeItem('nav_admin_webhook')
})

/** 回滚成功：先把响应回填为云端基底再清覆盖层，顺序反了会瞬间回退到旧数据 */
function onRolled(data) {
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
.admin-view {
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
  padding: 0;
}
.admin-header {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 20px 32px;
  background: var(--bg-white);
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

/* Tab 栏：窄屏横向滚动而非换行，保持始终一行 */
.admin-tabs {
  flex-shrink: 0;
  display: flex;
  gap: 2px;
  padding: 0 24px;
  background: var(--bg-white);
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
  scrollbar-width: none;
}
.admin-tabs::-webkit-scrollbar { display: none; }
.admin-tab {
  flex-shrink: 0;
  border: none;
  background: transparent;
  padding: 11px 14px 12px;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  border-bottom: 2px solid transparent;
  transition: color .15s ease, border-color .15s ease;
}
.admin-tab:hover { color: var(--text-primary); }
.admin-tab.active { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }
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
  font-size: 12.5px; color: #b45309; background: #fffbeb; border: 1px solid #fde68a;
  border-radius: var(--radius-sm); padding: 8px 12px; margin-bottom: 14px;
}
.admin-publish-block {
  font-size: 12.5px; color: #dc2626; background: #fef2f2; border: 1px solid #fecaca;
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
.admin-publish-msg.success { background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; }
.admin-publish-msg.error { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
</style>