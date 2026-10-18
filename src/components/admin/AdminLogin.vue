<template>
  <div class="login-wrap">
    <div class="ops-card login-card">
      <h3>管理后台登录</h3>
      <p class="login-sub">
        登录后签发有效期为 7 天（勾选记住此设备为 90 天）的会话 token，仅存于本标签页，
        关闭标签页即失效；过期或轮换后会自动退回此页。
      </p>

      <div v-if="notice" class="ops-msg warn">{{ notice }}</div>

      <div v-if="statusLoading" class="ops-empty">正在读取服务端认证配置…</div>

      <template v-else-if="!loginReady && !keyReady">
        <div class="ops-msg bad">
          服务端未配置任何鉴权方式：请设置 <code>SITES_ADMIN_KEY</code>，
          或配好 <code>ADMIN_PASSWORD_HASH</code> + <code>AUTH_SECRET</code> 后重试。
        </div>
      </template>

      <form v-else-if="mode === 'login'" @submit.prevent="submitLogin" class="login-form">
        <label class="login-field">
          <span>用户名</span>
          <input v-model="username" name="username" class="mini-input" autocomplete="username" :disabled="loading">
        </label>
        <label class="login-field">
          <span>口令</span>
          <input v-model="password" name="password" type="password" class="mini-input" autocomplete="current-password" :disabled="loading">
        </label>

        <label class="remember-row">
          <input v-model="remember" type="checkbox" :disabled="loading">
          <span>记住此设备（90 天免登录）</span>
        </label>

        <div v-if="error" class="ops-msg bad">{{ error }}</div>

        <button type="submit" class="mini-btn primary" :disabled="loading || !username || !password">
          {{ loading ? '登录中…' : '登录' }}
        </button>

        <button v-if="keyModeAvailable" type="button" class="link-btn" @click="switchMode('key')">
          {{ loginReady ? '密钥直连' : '改用管理密钥直连' }}
        </button>
      </form>

      <form v-else @submit.prevent="submitKey" class="login-form">
        <div class="ops-msg warn">
          管理密钥是<strong>永久</strong>凭据，粘贴到浏览器等于把它长期留在这里，只应在服务端没有配置
          口令登录（<code>ADMIN_PASSWORD_HASH</code>）时才使用。本次会话结束后即失效。
        </div>
        <label class="login-field">
          <span>管理密钥</span>
          <input v-model="keyInput" type="password" class="mini-input" placeholder="SITES_ADMIN_KEY" :disabled="loading">
        </label>

        <div v-if="error" class="ops-msg bad">{{ error }}</div>

        <button type="submit" class="mini-btn primary" :disabled="loading || !keyInput.trim()">
          {{ loading ? '校验中…' : '使用密钥进入' }}
        </button>

        <button v-if="loginReady" type="button" class="link-btn" @click="switchMode('login')">
          返回账号登录
        </button>
      </form>

      <!-- 版本标识：登录页也要能一眼看出跑的是哪一版 -->
      <p v-if="version" class="login-version" :title="versionTitle">版本 {{ version }}</p>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { authApi } from '@/services/authApi'
import { fetchStatus, fetchLocalKey } from '@/services/deployApi'
import { fmtDateTimeSec } from '@/utils/format'

const emit = defineEmits(['success'])

defineProps({ notice: { type: String, default: '' } })

const statusLoading = ref(true)
const loginReady = ref(false)
const keyReady = ref(false)
/** 状态接口读失败：此时无法判断服务端配了哪种鉴权，必须保留密钥兜底，否则管理员可能进不来 */
const statusFailed = ref(false)
const mode = ref('login')
const username = ref('')
const password = ref('')
const keyInput = ref('')
const loading = ref(false)
const error = ref('')
const remember = ref(true)
/** 版本标识：读 /api/deploy-status（公开只读）。读不到就留空，绝不编一个假的 */
const version = ref('')
const versionTitle = ref('')

async function loadVersion() {
  const r = await fetchStatus()
  if (!r.ok) return
  const j = r.status
  if (j && j.version && j.version.available && j.version.shortSha) {
    version.value = j.version.shortSha + (j.version.dirty ? '+未提交' : '')
    versionTitle.value = [
      `${j.version.branch || ''} ${j.version.shortSha}`,
      j.version.subject || '',
      j.version.builtAt ? `构建于 ${fmtDateTimeSec(j.version.builtAt)}` : '',
    ].filter(Boolean).join('\n')
  }
}

/**
 * 密钥直连只在两种情况下出现：
 *   - 服务端确实没配口令登录（`loginReady === false`）→ 不提供就没人能进；
 *   - 状态接口读失败（无法判断）→ 保留兜底。
 * 正常情况下**不提供**这个入口：共享密钥是永久凭据，粘进浏览器就等于长期泄露，
 * 而账号登录签发的是有期限、可轮换的会话 token。
 */
const keyModeAvailable = computed(() => keyReady.value && (!loginReady.value || statusFailed.value))

function switchMode(next) {
  mode.value = next
  error.value = ''
}

/* ---------------- 浏览器密码管理器 ----------------
 * /admin 是 AJAX 登录、没有页面跳转，Chrome/Edge 因此识别不出「这是一次登录」，
 * 不会主动弹「保存密码」。显式调用 Credential Management API 补上这一步，
 * 口令只落在用户本机浏览器，不进代码、不进 bundle、不进 git。
 * 仅 Chromium 系可用；其余浏览器走 autocomplete 原生路径，失败一律静默。
 */
const credSupported = typeof window !== 'undefined'
  && typeof window.PasswordCredential === 'function'
  && Boolean(navigator.credentials)

async function autofillFromVault() {
  if (!credSupported) return
  try {
    const cred = await navigator.credentials.get({ password: true, mediation: 'silent' })
    if (cred && cred.id) {
      username.value = cred.id
      password.value = cred.password || ''
    }
  } catch {
    /* 没有已保存凭据是常态，不是错误 */
  }
}

async function saveToVault(user, pass) {
  if (!credSupported) return
  try {
    await navigator.credentials.store(new window.PasswordCredential({ id: user, password: pass, name: user }))
  } catch {
    /* 用户拒绝保存 / 非安全上下文，忽略 */
  }
}

async function submitLogin() {
  loading.value = true
  error.value = ''
  try {
    const user = username.value.trim()
    const pass = password.value
    const r = await authApi.login(user, pass, remember.value)
    // 必须先交给浏览器保存再清空输入框，清空后就取不到明文口令了
    await saveToVault(user, pass)
    password.value = ''
    emit('success', { token: r.token, username: r.username, expiresAt: r.expiresAt, via: 'session' })
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

async function submitKey() {
  loading.value = true
  error.value = ''
  try {
    const key = keyInput.value.trim()
    const r = await authApi.verify(key)
    if (!r.valid) {
      error.value = r.reason === 'expired' ? '凭据已过期' : '密钥无效'
      return
    }
    keyInput.value = ''
    emit('success', { token: key, username: r.username || 'key', expiresAt: r.expiresAt || null, via: 'key' })
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

/* ---------------- 本机自动登录 ----------------
 * 只在**页面本身就跑在回环地址上**时尝试（127.0.0.1 / localhost）。
 * 密钥由服务端 `/api/_local-key` 提供，而那个端点自己也会再校验一次来源 ——
 * 双重条件都成立才可能拿到，线上公开域名一次都不会命中。
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
function isLoopbackHost() {
  try { return LOOPBACK_HOSTS.has(String(window.location.hostname).toLowerCase()) } catch { return false }
}

async function tryLocalAutoLogin() {
  if (!isLoopbackHost()) return false
  try {
    const key = await fetchLocalKey()
    if (!key) return false
    const r = await authApi.verify(key)
    if (!r.valid) return false
    emit('success', {
      token: key,
      username: r.username || 'key',
      expiresAt: r.expiresAt || null,
      via: 'key',
      auto: 'local', // 界面据此说明「本机自动登录」，而不是假装刚才是人工输入的
    })
    return true
  } catch {
    return false
  }
}

onMounted(async () => {
  loadVersion()
  // 先试本机自动登录：成功就直接进后台，连表单都不闪一下
  if (await tryLocalAutoLogin()) return

  try {
    const s = await authApi.status()
    loginReady.value = s.loginReady
    keyReady.value = s.keyReady
    username.value = s.loginReady ? s.username : ''
    mode.value = s.loginReady ? 'login' : 'key'
  } catch {
    // 读不到配置时无法判断服务端配了哪种鉴权。这里**不**直接把界面切成密钥直连
    // （那会把「永久凭据」推成默认路径），而是保留登录表单、并靠 keyModeAvailable
    // 把密钥入口作为兜底露出来，同时提示用户重试。
    statusFailed.value = true
    keyReady.value = true
    loginReady.value = false
    mode.value = 'login'
    error.value = '无法读取认证配置，可重试；若仍失败，请改用管理密钥直连'
  } finally {
    statusLoading.value = false
  }
  // 表单渲染完再回填，否则输入框还没挂载
  if (mode.value === 'login') autofillFromVault()
})
</script>

<style scoped>
/* 卡片在可用高度里垂直+水平居中。
   原先只有 justify-content、没有 align-items —— flex 默认 stretch 会把卡片拉满整屏高度，
   内容却只占上半截，看着就是「卡片贴顶、下面一大片空」。
   父级 .admin-body 已是 flex:1，高度确定，所以在这里居中即可。 */
.login-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
}
.ops-card { background: var(--bg-white); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 20px; }
.login-card { width: 100%; max-width: 420px; }
.login-card h3 { font-size: 16px; font-weight: 600; }
.login-sub { margin: 6px 0 16px; font-size: 12.5px; color: var(--text-secondary); line-height: 1.6; }
.ops-empty { font-size: 13px; color: var(--text-secondary); padding: 8px 0; }
.ops-msg { padding: 9px 12px; border-radius: var(--radius-sm); font-size: 12.5px; font-weight: 500; background: var(--ok-bg); color: var(--ok-fg); border: 1px solid var(--ok-border); }
.ops-msg.bad { background: var(--danger-bg); color: var(--danger-fg); border-color: var(--danger-border); }
.ops-msg.warn { background: var(--warn-bg); color: var(--warn-fg); border-color: var(--warn-border); margin-bottom: 12px; }
.ops-msg code { font-family: var(--font-mono, monospace); font-size: 12px; }
.login-form { display: flex; flex-direction: column; gap: 12px; }
.login-field { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; color: var(--text-secondary); }
.remember-row {
  display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--text-secondary);
  cursor: pointer; user-select: none;
}
.remember-row input { width: 14px; height: 14px; margin: 0; accent-color: var(--accent); cursor: pointer; }
.mini-input {
  padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 13px;
  font-family: var(--font); color: var(--text-primary); background: var(--bg-white); outline: none;
}
.mini-input:focus { border-color: var(--accent); }
.mini-btn {
  padding: 8px 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-white);
  font-size: 13px; color: var(--text-primary); cursor: pointer;
}
.mini-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.mini-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.mini-btn.primary:hover:not(:disabled) { color: #fff; opacity: .92; }
.mini-btn:disabled { opacity: .5; cursor: not-allowed; }
.link-btn {
  background: none; border: none; padding: 0; font-size: 12.5px; color: var(--text-secondary);
  cursor: pointer; text-decoration: underline;
}
.link-btn:hover { color: var(--accent); }

/* 版本标识：卡片底部，低调但不隐身 */
.login-version {
  margin: 16px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  font-size: 11.5px;
  color: var(--text-secondary);
  font-family: var(--font-mono, ui-monospace, monospace);
  text-align: center;
  cursor: default;
}

/* 窄屏：卡片吃满可用宽度，内边距收一收，别让 420px 的固定值撑出横向滚动 */
@media (max-width: 520px) {
  .login-wrap { padding: 24px 16px; }
  .login-card { max-width: 100%; }
}
</style>