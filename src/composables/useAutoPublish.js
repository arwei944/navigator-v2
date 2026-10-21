/**
 * 实时发布调度器（单例）。
 *
 * 监听站点 store 的「本机草稿变化」事件，在实时模式下防抖后自动发布到云端。
 *
 * ## 四个必须守住的边界
 *
 * 1. **只在已登录时运行**：没有管理凭据（普通访客）绝不写云端；
 * 2. **只在本机有草稿时运行**：空覆盖层不产生无意义的请求；
 * 3. **串行 + 防抖**：连续拖拽/编辑只发一次；发布中又有改动则排队一轮；
 * 4. **失败不自动覆盖别人**：409/网络失败保留覆盖层并报错，等下一次改动或手动发布，
 *    不在后台静默重试。
 *
 * 发布成功后复用与手动发布完全相同的收尾顺序：
 * 先回填云端基底，再清覆盖层 —— 反过来会短暂回退到旧数据。
 */
import { ref } from 'vue'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import { useCloudPublishMode } from '@/stores/cloudPublishMode'
import { opsApi, getAdminKey } from '@/services/opsApi'
import { recordAudit } from '@/services/auditLog'
import { shouldAutoPublish, PUBLISH_MODE } from '../../shared/cloud-publish.mjs'

const DEBOUNCE_MS = 1500
const COOLDOWN_MS = 2000

const state = ref('idle') // idle | scheduled | publishing | success | error
const message = ref('')
const lastAt = ref(null)

let timer = null
let busy = false
let pending = false
let lastDoneAt = 0
let ctx = null
let installed = false

function clearTimer() {
  if (timer) { clearTimeout(timer); timer = null }
}

function canRun() {
  if (!ctx) return { ok: false, reason: 'uninitialized' }
  return shouldAutoPublish({
    mode: ctx.mode.value,
    hasKey: Boolean(getAdminKey()),
    hasChanges: ctx.sitesStore.hasLocalChanges,
    busy,
  })
}

function schedule() {
  const check = canRun()
  if (!check.ok) {
    if (check.reason === 'no-changes' && state.value === 'scheduled') state.value = 'idle'
    return
  }
  clearTimer()
  state.value = 'scheduled'
  timer = setTimeout(() => { timer = null; run() }, DEBOUNCE_MS)
}

async function run() {
  const check = canRun()
  if (!check.ok) return
  const key = getAdminKey()
  if (!key) return

  busy = true
  pending = false
  state.value = 'publishing'
  message.value = ''

  try {
    // 分类表只在本地草稿偏离云端时推送，与手动发布同一口径
    const cats = ctx.categoriesStore.dirty ? ctx.categoriesStore.toCloudGroups() : undefined
    const data = await opsApi.publish(key, ctx.sitesStore.sites, cats)

    // 顺序不能反：先回填基底，再清覆盖层
    ctx.sitesStore.applyCloudData(data)
    ctx.sitesStore.clearLocalOverlay()
    ctx.categoriesStore.clearLocalAdds()

    lastAt.value = new Date().toISOString()
    lastDoneAt = Date.now()
    state.value = 'success'
    message.value = `已自动发布 v${data.version} · ${data.sites?.length || 0} 站点`
    recordAudit('publish.done', {
      target: `v${data.version}`,
      detail: `实时发布 ${data.sites?.length || 0} 站点`,
    })
  } catch (e) {
    state.value = 'error'
    message.value = String(e?.message || e)
    recordAudit('publish.fail', {
      target: '',
      result: 'fail',
      detail: `实时发布失败：${message.value}`,
    })
  } finally {
    const again = pending
    pending = false
    busy = false
    // 发布期间又改了：等冷却窗口过去再排一轮，避免紧接着再写一次
    if (again) {
      setTimeout(() => {
        if (ctx?.sitesStore.hasLocalChanges) schedule()
      }, COOLDOWN_MS + 50)
    }
  }
}

function onLocalChange() {
  // clearLocalOverlay 也会触发一次；发布成功后的冷却窗口内忽略
  if (Date.now() - lastDoneAt < COOLDOWN_MS) return
  if (busy) { pending = true; return }
  schedule()
}

function onModeChange() {
  if (ctx?.mode.value === PUBLISH_MODE.REALTIME) schedule()
  else {
    clearTimer()
    if (state.value === 'scheduled') state.value = 'idle'
  }
}

/**
 * 在 App 根组件调用一次安装；后台面板再次调用只是取同一组状态。
 */
export function useAutoPublish() {
  const sitesStore = useSitesStore()
  const categoriesStore = useCategoriesStore()
  const { mode } = useCloudPublishMode()
  ctx = { sitesStore, categoriesStore, mode }
  if (!installed && typeof window !== 'undefined') {
    installed = true
    window.addEventListener('nav-sites-local-change', onLocalChange)
    window.addEventListener('nav-cloud-mode-change', onModeChange)
  }
  return { state, message, lastAt, schedule, publishNow: run }
}