import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { registerSW } from 'virtual:pwa-register'
import App from './App.vue'
import router from './router'
import { preloadPinyin } from './utils/search'
import './styles/main.css'

// PWA 自动更新：检测到新版本部署后自动刷新加载最新代码
registerSW({
  immediate: true,
  onNeedRefresh() {
    window.location.reload()
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