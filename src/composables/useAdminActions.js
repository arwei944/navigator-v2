/**
 * 后台「左动作栏」的交互：动作执行、拖宽 / 复位、快捷键序列。
 *
 * ## 为什么从 AdminView.vue 里抽出来
 *
 * 这三件事在组件里占了约 150 行，且彼此独立于「模块 Tab 切换」这条主线：
 *   - 动作执行只依赖 adminKey 与几个 service；
 *   - 拖宽只依赖宽度契约（`utils/sideWidth.js`）与 localStorage；
 *   - 快捷键只依赖快捷键表（`shared/admin-shortcuts.mjs`）。
 *
 * 它们此前和 Tab 状态、登录态、仪表盘聚合请求混在一个 `<script setup>` 里，
 * 结果是「改快捷键要先滚过 300 行发布逻辑」。抽出来后每块都能单独读、单独测。
 *
 * ## 为什么动作在这里执行而不是在面板里
 *
 * 动作栏的设计意图是「点一下即达」：检查更新 / 导出备份 / 看巡检结果都是只读或安全操作，
 * 不值得为它们再开一个页面。不可逆动作（发布 / 回滚 / 恢复备份）**不在这里** ——
 * 见 `utils/adminNav.js` 的注释。
 *
 * @param {object} deps
 * @param {import('vue').Ref<string>} deps.adminKey 管理凭据（空则动作不执行）
 * @param {() => void} [deps.onBusyChange] 忙碌状态变化回调（组件用来刷新角标等）
 */
import { ref, watch } from 'vue'
import { opsApi } from '@/services/opsApi'
import { fetchStatus as fetchDeployStatus, checkUpstream } from '@/services/deployApi'
import { fetchHealth } from '@/services/healthApi'
import { clampRailWidth, DEFAULT_RAIL_W } from '@/utils/sideWidth'
import { safeSetItem } from '@/utils/safeStorage'
import { fmtDateTime } from '@/utils/format'
import { SHORTCUT_PREFIX, PREFIX_TTL_MS, matchShortcut, shouldIgnoreKey } from '../../shared/admin-shortcuts.mjs'

const LS_RAIL_W = 'nav_admin_rail_w'
const LS_RAIL_COLLAPSED = 'nav_admin_rail_collapsed'
const LS_RAIL_SEL = 'nav_admin_rail_sel'

/**
 * @param {{ adminKey: import('vue').Ref<string>, onSelectTab: (id:string)=>void }} deps
 */
export function useAdminActions({ adminKey, onSelectTab }) {
  /* ---------------- 动作执行状态 ---------------- */

  const railBusy = ref('')
  const actionResult = ref(null)
  /** 当前选中的动作名；与 activeTab 互斥（选了动作就不再显示 Tab 内容） */
  const activeAction = ref('')

  /**
   * 执行一个动作。
   *
   * 三类动作都只用只读接口；失败一律落成 `actionResult.ok = false` 而不是抛出去 ——
   * 动作栏是「点一下就执行」的入口，抛异常会打断整页。
   */
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
          hint: r.updatedAt ? `最近一轮 ${fmtDateTime(new Date(r.updatedAt).getTime())}` : '还没有巡检快照',
        }
      }
    } catch (e) {
      actionResult.value = { ok: false, title: '执行失败', items: [['原因', String(e?.message || e)]] }
    } finally {
      railBusy.value = ''
    }
  }

  /* ---------------- 动作栏宽度 / 折叠 ---------------- */

  const railW = ref(clampRailWidth(localStorage.getItem(LS_RAIL_W)))
  const railCollapsed = ref(localStorage.getItem(LS_RAIL_COLLAPSED) === '1')
  const railSel = ref(localStorage.getItem(LS_RAIL_SEL) || 'overview')

  watch([railW, railCollapsed, railSel], () => {
    safeSetItem(LS_RAIL_W, String(railW.value))
    safeSetItem(LS_RAIL_COLLAPSED, railCollapsed.value ? '1' : '0')
    safeSetItem(LS_RAIL_SEL, railSel.value)
  })

  /**
   * 拖拽调宽。
   *
   * 用 rAF 合帧：mousemove 在 120Hz 鼠标上每帧能来两次，直接赋值会让整栏每 8ms 重排一次；
   * 合帧后最多每帧一次。松手时**再算一次**最终值 —— 最后一帧的 pendingX 可能还没 flush。
   */
  function startRailResize(e) {
    e.preventDefault()
    const startX = e.clientX
    const startW = railW.value
    let pendingX = startX
    let raf = 0
    const flush = () => {
      raf = 0
      railW.value = clampRailWidth(startW + (pendingX - startX))
    }
    const onMove = (ev) => {
      pendingX = ev.clientX
      if (!raf) raf = requestAnimationFrame(flush)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      if (raf) {
        cancelAnimationFrame(raf)
        raf = 0
      }
      railW.value = clampRailWidth(startW + (pendingX - startX))
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  function resetRailWidth() {
    railW.value = DEFAULT_RAIL_W
  }

  /**
   * 点动作栏里的项：动作 → 执行；模块 → 切 Tab。
   * 切模块时清掉动作态，否则「动作结果」会盖住刚点开的模块。
   */
  function pickRail(it) {
    railSel.value = it.id
    if (it.kind === 'act') {
      activeAction.value = it.action
      return runAction(it.action)
    }
    activeAction.value = ''
    actionResult.value = null
    onSelectTab(it.tab)
  }

  /* ---------------- 快捷键（g 前缀序列） ---------------- */

  let prefixAt = 0

  function onShortcutKey(e) {
    // 输入框里 / 带修饰键时一律不响应 —— 否则在搜索框打「gs」就会跳面板
    if (shouldIgnoreKey(e)) {
      prefixAt = 0
      return
    }
    const k = String(e.key || '').toLowerCase()
    const now = Date.now()
    if (k === SHORTCUT_PREFIX) {
      prefixAt = now
      return
    }
    if (prefixAt && now - prefixAt < PREFIX_TTL_MS) {
      const hit = matchShortcut(SHORTCUT_PREFIX, k)
      prefixAt = 0
      if (hit) {
        e.preventDefault()
        onSelectTab(hit.tab)
      }
    }
  }

  function attachShortcuts() {
    window.addEventListener('keydown', onShortcutKey)
  }

  function detachShortcuts() {
    window.removeEventListener('keydown', onShortcutKey)
  }

  return {
    // 动作
    railBusy,
    actionResult,
    activeAction,
    runAction,
    // 栏
    railW,
    railCollapsed,
    railSel,
    startRailResize,
    resetRailWidth,
    pickRail,
    // 快捷键
    attachShortcuts,
    detachShortcuts,
  }
}
