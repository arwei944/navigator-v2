<template>
  <div class="login-wrap">
    <div class="ops-card login-card">
      <h3>管理后台登录</h3>
      <p class="login-sub">
        登录后凭据有效期 7 天，过期或轮换密钥后会自动退回此页。
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

        <button v-if="keyReady" type="button" class="link-btn" @click="switchMode('key')">
          改用管理密钥直连
        </button>
      </form>

      <form v-else @submit.prevent="submitKey" class="login-form">
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
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { authApi } from '@/services/authApi'

const emit = defineEmits(['success'])

defineProps({ notice: { type: String, default: '' } })

const statusLoading = ref(true)
const loginReady = ref(false)
const keyReady = ref(false)
const mode = ref('login')
const username = ref('')
const password = ref('')
const keyInput = ref('')
const loading = ref(false)
const error = ref('')
const remember = ref(true)

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

onMounted(async () => {
  try {
    const s = await authApi.status()
    loginReady.value = s.loginReady
    keyReady.value = s.keyReady
    username.value = s.loginReady ? s.username : ''
    mode.value = s.loginReady ? 'login' : 'key'
  } catch {
    // 读不到配置时**必须回退到密钥直连**，不能显示「未配置任何鉴权方式」的死胡同：
    // 网络抖动 / 新接口尚未生效都会走到这里，若不给密钥输入框，管理员就再也进不来了。
    // 真正的「服务端确实没配」由 submitKey 的校验结果来暴露。
    loginReady.value = false
    keyReady.value = true
    mode.value = 'key'
    error.value = '无法读取认证配置，已回退到管理密钥直连'
  } finally {
    statusLoading.value = false
  }
  // 表单渲染完再回填，否则输入框还没挂载
  if (mode.value === 'login') autofillFromVault()
})
</script>

<style scoped>
.login-wrap { display: flex; justify-content: center; padding: 48px 0; }
.ops-card { background: var(--bg-white); border: 1px solid var(--border); border-radius: var(--radius); padding: 18px 20px; }
.login-card { width: 100%; max-width: 420px; }
.login-card h3 { font-size: 16px; font-weight: 600; }
.login-sub { margin: 6px 0 16px; font-size: 12.5px; color: var(--text-secondary); line-height: 1.6; }
.ops-empty { font-size: 13px; color: var(--text-secondary); padding: 8px 0; }
.ops-msg { padding: 9px 12px; border-radius: var(--radius-sm); font-size: 12.5px; font-weight: 500; background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; }
.ops-msg.bad { background: #fef2f2; color: #dc2626; border-color: #fecaca; }
.ops-msg.warn { background: #fffbeb; color: #b45309; border-color: #fde68a; margin-bottom: 12px; }
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
</style>