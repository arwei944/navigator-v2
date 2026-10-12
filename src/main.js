import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { registerSW } from 'virtual:pwa-register'
import App from './App.vue'
import router from './router'
import { preloadPinyin } from './utils/search'
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
 * 拼音引擎（pinyin-pro，317 KB raw）不在首屏关键路径上，但用户第一次敲中文搜索时就得用。
 * 挂载完成后趁空闲把它取回来 —— 正常网络下用户还没打完第一个字，届时引擎已就绪，
 * 于是「降级为无拼音命中」的窗口在体感上不存在。
 *
 * 用 requestIdleCallback 而非 setTimeout：它保证不与首屏渲染抢主线程；
 * Safari 直到 16.4 才支持，所以留 setTimeout 兜底（宁可晚一点，也不能不预取）。
 * preloadPinyin 自身幂等，重复调用无副作用。
 */
const idle = window.requestIdleCallback || (cb => setTimeout(cb, 2000))
idle(() => preloadPinyin(), { timeout: 3000 })