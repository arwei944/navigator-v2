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
              <AdminInsights @open-ai="selectTab('ai')" />
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
                  <span v-else-if="authExpiresAt">· 会话有效至 {{ fmtDateTime(authExpiresAt) }}</span>
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
/**
 * 管理后台外壳：登录闸门 + 左动作栏 + 模块 Tab + 面板挂载。
 *
 * ## 这里只留「布局与接线」
 *
 * 业务逻辑已经按职责拆到四个组合式函数，它们各自可单独读、单独测：
 *   - `useAdminAuth`      登录态 / 凭据校验 / 版本标识
 *   - `useAdminActions`   动作执行 / 动作栏拖宽 / g 前缀快捷键
 *   - `useAdminDashboard` 仪表盘聚合请求与卡片取值
 *   - `useAdminPublish`   发布与回滚的状态迁移顺序
 * 导航表（TABS / RAIL_GROUPS / 快捷键指向）在 `utils/adminNav.js`，是纯数据。
 *
 * 拆分前这个文件 1175 行，改一个快捷键要滚过 300 行发布逻辑。
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fmtDateTime } from '@/utils/format'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { useFavoritesStore } from '@/stores/favorites'
import { useHistoryStore } from '@/stores/history'
import { opsApi } from '@/services/opsApi'
import { safeSetItem, safeRemoveItem } from '@/utils/safeStorage'
import { ADMIN_SHORTCUTS } from '../../shared/admin-shortcuts.mjs'
import { buildAdminIndex, searchAdminIndex } from '../../shared/admin-search.mjs'
import { TABS, TAB_IDS, DEFAULT_TAB, DASH_DESC, RAIL_GROUPS, RAIL_TITLE, RAIL_TIP, auditAdminNav } from '@/utils/adminNav'
import { useAdminAuth } from '@/composables/useAdminAuth'
import { useAdminActions } from '@/composables/useAdminActions'
import { useAdminDashboard } from '@/composables/useAdminDashboard'
import { useAdminPublish } from '@/composables/useAdminPublish'

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

const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()
const favoritesStore = useFavoritesStore()
const historyStore = useHistoryStore()

const todayCount = computed(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return historyStore.records.filter((r) => r.timestamp >= today.getTime()).length
})

const unreadBadge = ref(0)
const webhookUrl = ref(localStorage.getItem('nav_admin_webhook') || '')

/* ---------------- 模块 Tab ----------------
 * 后台从「一页瀑布流」改为 Tab：每个模块独立成页，不再靠长距离滚动找功能。
 * 选中的 Tab 写进 URL query（?tab=xxx），刷新 / 收藏 / 分享都能落回同一模块；
 * 未登记的 id 一律回落默认页，避免手改地址栏把页面切成空白。
 * 面板用 v-if 懒挂载：13 个面板里有一半在挂载时就会打接口，全量常驻会造成首屏并发请求。
 */
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

/* ---------------- 组合式：登录 / 动作 / 仪表盘 / 发布 ---------------- */

function onAuthed() {
  loadUnread()
  loadDash()
}

const auth = useAdminAuth({ onAuthed })
const { adminKey, authed, authChecking, authUser, authVia, authAuto, authExpiresAt, loginNotice, version, versionTitle } = auth

const actions = useAdminActions({ adminKey, onSelectTab: selectTab })
const { railBusy, actionResult, activeAction, runAction, railW, railCollapsed, railSel, startRailResize, resetRailWidth, pickRail } =
  actions

const dash = useAdminDashboard({ adminKey, sitesStore, categoriesStore, unreadBadge, version })
const { dashCards, railMetaOf, loadDash } = dash

const publish = useAdminPublish({ adminKey, webhookUrl, sitesStore, categoriesStore, onPublished: loadUnread })
const { publishState, publishMsg, preflight, preflightOk, preflightBlockers, onPreflight, publishToCloud, onRolled } = publish

/* ---------------- 全局搜索（#21） ---------------- */

const KIND_LABEL = { tab: '模块', setting: '设置', site: '站点', category: '分类', plugin: '插件' }

const query = ref('')
const activeIdx = ref(0)

const adminIndex = computed(() =>
  buildAdminIndex({
    tabs: TABS,
    sites: sitesStore.sites,
    categories: categoriesStore.categories,
  }),
)
const results = computed(() => searchAdminIndex(adminIndex.value, query.value, 12))

watch(results, () => {
  activeIdx.value = 0
})

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

/* ---------------- 通知角标 ---------------- */

/**
 * 通知角标：通知中心面板是懒加载的，只靠它自己 emit 要等用户点开那个 Tab 才会上报，
 * 角标就失去了「提示有新通知」的意义，所以这里主动拉一次。
 */
async function loadUnread() {
  const key = adminKey.value.trim()
  if (!key) {
    unreadBadge.value = 0
    return
  }
  try {
    const r = await opsApi.notifications(key, { limit: 1 })
    unreadBadge.value = r.summary?.unread || 0
  } catch {
    /* 角标拿不到不影响后台使用 */
  }
}

/* ---------------- 登录 ---------------- */

function onLogin(payload) {
  auth.onLogin(payload)
}

/** 退出时一并清掉上一次会话留下的发布态 */
function logout() {
  auth.logout()
  publish.resetPublishState()
  unreadBadge.value = 0
}

function onAuthExpired() {
  if (!authed.value) return
  logout()
  loginNotice.value = '登录状态已失效，请重新登录'
}

/* ---------------- 生命周期 ---------------- */

onMounted(async () => {
  // 导航表自检：动作栏 / 快捷键指向未登记的 tab 时，开发期立刻可见
  const navProblems = auditAdminNav(ADMIN_SHORTCUTS)
  if (navProblems.length) console.warn('[admin-nav] 导航表不一致：\n  ' + navProblems.join('\n  '))

  window.addEventListener('nav-auth-expired', onAuthExpired)
  actions.attachShortcuts()
  auth.loadVersion()
  await auth.verifyExisting()
})

onBeforeUnmount(() => {
  actions.detachShortcuts()
  window.removeEventListener('nav-auth-expired', onAuthExpired)
})

// 地址栏改动（含浏览器前进/后退）也要跟着切
watch(
  () => route.query.tab,
  () => {
    const id = tabFromRoute()
    if (id !== activeTab.value) activeTab.value = id
  },
)

watch(webhookUrl, (v) => {
  if (v) safeSetItem('nav_admin_webhook', v)
  else safeRemoveItem('nav_admin_webhook')
})
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
  background: var(--color-danger);
  color: var(--on-danger);
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
.admin-user-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--color-ok); }
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
  color: var(--on-accent);
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
.admin-cred-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--color-ok); }
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