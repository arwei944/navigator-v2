import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { registerSW } from 'virtual:pwa-register'
import App from './App.vue'
import router from './router'
import { useToastStore } from './stores/toast'
import './styles/main.css'

// PWA 新版本提示：检测到就**告诉用户**，不自动刷新。
// 原来是 `window.location.reload()` —— SW 发现新版本是异步事件，随时触发，
// 用户正在添加弹窗填表单 / 拖拽排序 / 编辑站点时会被无提示刷新，现场全丢。
//
// 注意 `reload` 传的是 `updateSW` 而**不是** `window.location.reload`：
// `prompt` 模式下新 SW 此刻还停在 waiting，直接 reload 只会用旧 SW 再跑一遍
// （提示又出现，用户以为点了没用）。`updateSW(true)` 发 skipWaiting，
// SW 拿到控制权后由 library 自己 reload。registerSW 保持原位（immediate 尽早注册），
// 回调触发时 pinia 早已 install。
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    // 提示模块也是「需要才用」：它只在真有新版本时才被调用，而那一刻通常在
    // 首访之后的某次访问里。压在入口里等于让每个首访者都为它付字节。
    import('./utils/swRefresh.mjs').then(({ showRefreshPrompt }) => {
      showRefreshPrompt({
        push: (...args) => useToastStore().push(...args),
        reload: () => updateSW(true)
      })
    })
  },
  onOfflineReady() {}
})

const app = createApp(App)

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

app.use(pinia)
app.use(router)
app.mount('#app')

/**
 * 拼音引擎（pinyin-pro，317 KB raw / 139 KB gz）的加载时机——**故意不在这里预热**。
 *
 * 原先这里是 `requestIdleCallback(() => preloadPinyin(), { timeout: 3000 })`：
 * 挂载后 3 秒内必然把它下载回来。问题是**多数访客从不搜中文**，
 * 这 139 KB 是替他们白下的（2026-10-17 实测：首访下载 1266 KB，它是单项最大的懒加载块）。
 *
 * 现在改为「用户第一次表达搜索意图」才取，三条入口都走幂等的 preloadPinyin()：
 *   - 聚焦搜索框（UnifiedSearchBox 的 @focus）；
 *   - 打开命令面板（CommandPalette 的 open()）；
 *   - 兜底：utils/search.js 的 keysOf() 在真的开始检索时若引擎未就绪会顺手催一次。
 *
 * 体感代价可忽略：本地加载约 20–40 ms，而「聚焦 → 敲下第一个字」通常远超它。
 * 首屏预算守卫见 tools/console/test-bundle.mjs（拼音必须在独立 chunk、不在首屏清单）。
 */