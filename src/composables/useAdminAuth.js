/**
 * 后台登录态：凭据校验、登录 / 退出、过期广播、版本标识。
 *
 * ## 「密钥直连」与「登录态」为什么并存
 *
 * 浏览器端没有能挡住 XSS 的加密，所以共享密钥（永久、不可过期）不再作为常规入口；
 * 粘贴密钥降级为登录态兜底，凭据存 sessionStorage（`services/opsApi.js#setAdminKey`）。
 * 这里的职责只是把两条路径收敛成一个 `authed` 布尔 + 一个 `adminKey` 字符串，
 * 让面板层不必关心凭据从哪来。
 *
 * ## 本机自动登录
 *
 * 服务端在回环地址上提供 `/api/_local-key`（只在 127.0.0.1 才给），
 * 于是本机打开后台可以免输入。`authAuto === 'local'` 会显示在头部，
 * 避免「为什么我没登录就进来了」的困惑。
 *
 * ## 过期就地清理
 *
 * 登录响应带 `expiresAt`，前端据此在过期时**就地**清凭据，不必等一次 401 往返 ——
 * 那一次往返期间用户会看到「看起来还能点、点了才报错」的状态。
 *
 * @param {object} deps
 * @param {() => void} [deps.onAuthed] 校验 / 登录成功后回调（组件用来拉仪表盘与通知角标）
 */
import { ref } from 'vue'
import { getAdminKey, setAdminKey, clearAdminKey } from '@/services/opsApi'
import { authApi } from '@/services/authApi'
import { fetchStatus as fetchDeployStatus } from '@/services/deployApi'
import { setAuditActor } from '@/services/auditLog'
import { fmtDateTimeSec } from '@/utils/format'

export function useAdminAuth({ onAuthed } = {}) {
  const adminKey = ref(getAdminKey())
  const authed = ref(false)
  const authChecking = ref(true)
  const authUser = ref('')
  const authVia = ref('')
  /** 'local' = 本机自动登录（服务端回环端点给的密钥），空 = 人工登录 */
  const authAuto = ref('')
  const authExpiresAt = ref(0)
  const loginNotice = ref('')

  /** 版本标识：读 /api/deploy-status（公开只读），未登录时也显示 */
  const version = ref('')
  const versionTitle = ref('')

  /**
   * 版本标识：读线上自述的构建信息。
   * 失败就留空（旧部署包没有 build-info.json），**绝不编一个假的出来** ——
   * 版本号编错比不显示更糟。
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
        j.version.builtAt ? `构建于 ${fmtDateTimeSec(j.version.builtAt)}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    }
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
    onAuthed?.()
  }

  function logout() {
    const key = adminKey.value.trim()
    if (key) authApi.logout(key)
    adminKey.value = ''
    clearAdminKey()
    authed.value = false
    authUser.value = ''
    authVia.value = ''
    authAuto.value = ''
    authExpiresAt.value = 0
    setAuditActor('')
  }

  /** 任一面板拿到 401 即广播失效，这里统一退回登录闸门 */
  function onAuthExpired() {
    if (!authed.value) return
    logout()
    loginNotice.value = '登录状态已失效，请重新登录'
  }

  /** 挂载时校验已有凭据；没有凭据就直接落到登录闸门（不显示「校验中」闪屏） */
  async function verifyExisting() {
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
        onAuthed?.()
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
  }

  return {
    adminKey,
    authed,
    authChecking,
    authUser,
    authVia,
    authAuto,
    authExpiresAt,
    loginNotice,
    version,
    versionTitle,
    loadVersion,
    verifyExisting,
    onLogin,
    logout,
    onAuthExpired,
  }
}
