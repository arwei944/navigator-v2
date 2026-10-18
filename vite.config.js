import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'
import { readFileSync } from 'fs'

/**
 * 产品版本号的**唯一事实来源**是 `package.json.version`。
 *
 * 构建期把它注入成编译常量 `__APP_VERSION__`，前端（侧栏版本标识 / 「关于」页）直接读。
 * 这样版本号只有一处需要维护 —— 前端不再各存一份，也就不会出现「关于页说 3.0、侧栏说 3.1」的漂移。
 * 未注入时（例如直接跑源码不做构建）前端回落空串，宁可不显示也不编造。
 */
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    vue(),
    VitePWA({
      /**
       * 必须是 `prompt`，不能是 `autoUpdate`。
       *
       * `autoUpdate` 下 registerSW 模板**根本不会调用 `onNeedRefresh`** ——
       * 它只挂一个 `activated` 监听器直接 `window.location.reload()`（见
       * vite-plugin-pwa/dist/client/build/register.js 第 38-47 行）。于是「弹提示让用户
       * 自己决定」的代码是死代码，无提示刷新照旧发生，现场照旧丢。
       * `prompt` 模式下才会走 `waiting → onNeedRefresh()`，用户点刷新后
       * `updateServiceWorker(true)` 发 skipWaiting，SW 拿到控制权再 reload。
       */
      registerType: 'prompt',
      injectRegister: null,
      // 这里引用的文件必须真实存在，否则预缓存清单会挂一个 404（原来是 favicon.ico，实际只有 favicon.svg）
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Navigator - 网站导航中心',
        short_name: 'Navigator',
        description: '现代化网站导航中心，快速访问你喜爱的站点',
        theme_color: '#0f172a',
        background_color: '#f1f5f9',
        display: 'standalone',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        /**
         * 只预缓存「应用外壳」：构建产物（js/css）、favicon、两个 PWA 图标。
         *
         * **`*.html` 刻意不在其中**（2026-10-14 白屏事故）。html 进了预缓存清单，SW 就会
         * 用 CacheFirst 把**旧版 index.html** 直接回给浏览器 —— 而它引用的 `assets/index-*.js`
         * 已被新版本换掉并从磁盘上删掉，请求全部 404，模块脚本一次都没执行，`#app` 永远是空的：
         * 白屏，且**不会自愈**（新 SW 装好了也只是 waiting；页面 JS 没跑起来，没人能提示刷新）。
         * HTML 改走下方 `nav-html` 的 NetworkFirst：有网永远拿最新，离线才回缓存。
         *
         * 绝不能把 `icons/**` 放进来 —— 实测它会让预缓存清单从 16 条涨到 294 条 / 7.17 MB
         * （其中图标 6.11 MB / 278 个），SW 安装期就得在后台把这 7 MB 全下完，而其中
         * 绝大多数图标用户一辈子不会看到（首访实测多传约 4.6 MB）。
         * 图标改走下方 runtimeCaching：谁被渲染到就缓存谁，仍是离线可用的。
         */
        // 只预缓存「应用外壳 + 核心交互 chunk」：
        //   - 外壳：index / vendor-vue（html 不进预缓存，见下方 nav-html）
        //   - 核心交互：添加 / 编辑站点弹窗、设置、详情面板相关站、用途选择器、
        //     秒加链路（autoAdd / meta / site-infer）、首页视图……
        // favicon.svg / pwa-*.png **不写在这里** —— includeAssets 与 manifest.icons
        // 会各注入一次，glob 再匹配一遍就是重复条目（实测曾因此各重复 1 条）。
        globPatterns: ['**/*.{js,css}'],
        globIgnores: [
          // sw.js / workbox-*.js 由 workbox 自行管理，绝不进预缓存清单
          'sw.js', 'workbox-*.js',
          // 图标：谁被渲染到就运行时缓存谁（见下方 site-icons）。全量预缓存实测 6.11 MB
          'icons/**',
          // html 走下方 nav-html 的 NetworkFirst（2026-10-14 白屏事故，见文件头注释）
          '**/*.html',
          // 低频功能 chunk：管理后台 / 洞察 / 图谱 / 翻译三层 / BGM 播放器 / 便签 /
          // 主题市场 / 书签导入 / 拼音引擎 / 更新提示 / 中文别名表 / 自动归类。
          // 这些界面多数访客一辈子都不打开，却会让 SW 安装期替每个访客多下 ~470 KB。
          // 改走运行时缓存（下方 lazy-chunks），谁真被打开到就缓存谁。
          '**/{AdminView,AdminAside,InsightsView,chartkit,GraphView,affinity,AboutView,NotFoundView,translateFields,browserTranslate,aiApi,PipelineLogPanel,pipelineTrace,bgmScore,BgmPlayer,StickyBoard,StickyNote,ThemeEditor,bookmark-import,pinyin,swRefresh,phraseAliases,auto-category,siteRefresh,sites-data}-*.{js,css}',
        ],
        runtimeCaching: [
          {
            /**
             * 导航请求（HTML）：**NetworkFirst** —— 有网必须先拿服务器上的最新版。
             *
             * 这是「HTML 不进预缓存」的另一半：光把 html 从 precache 里拿掉，离线时就完全
             * 打不开了；这条规则把每次成功的导航响应存进 `nav-html`，离线时才有得回退。
             * `networkTimeoutSeconds` 给 3 秒：弱网下不要让用户对着白屏干等一整个超时周期。
             */
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'nav-html',
              networkTimeoutSeconds: 3,
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            // 站点图标：命中即长期缓存（文件名带 id、内容不会变，适合 CacheFirst）。
            // 补上 jpg/webp —— 旧的 glob 只认 png/svg/ico，这两种格式的图标在离线时是裂图。
            urlPattern: /\/icons\/[^/]+\.(?:png|jpe?g|webp|svg|ico)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'site-icons',
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            /**
             * 低频功能 chunk（上方 globIgnores 里排除的那批）：管理后台 / 洞察 / 图谱 /
             * 翻译三层 / BGM 播放器 / 便签 / 主题市场 / 书签导入 / 拼音引擎 / 更新提示 /
             * 中文别名表 / 自动归类。
             *
             * 为什么不预缓存：SW 安装期会把这些全下完，而多数访客一辈子不打开其中任何一个
             * —— 实测这批约 470 KB raw，正是「首访多传约 4.6 MB」那类浪费的同源问题。
             * 文件名带内容 hash、内容不变，适合 CacheFirst；谁真被打开到就缓存谁，
             * 之后离线也能用。离线且从未打开过的功能会拿不到 —— 可接受（本就不是核心路径）。
             */
            urlPattern: /\/assets\/(?:AdminView|AdminAside|InsightsView|chartkit|GraphView|affinity|AboutView|NotFoundView|translateFields|browserTranslate|aiApi|PipelineLogPanel|pipelineTrace|bgmScore|BgmPlayer|StickyBoard|StickyNote|ThemeEditor|bookmark-import|pinyin|swRefresh|phraseAliases|auto-category|siteRefresh|sites-data)-[^/]+\.(?:js|css)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'lazy-chunks',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] }
            }
          }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  build: {
    rollupOptions: {
      output: {
        /**
         * 依赖分包（序 23）。
         *
         * 目标不是「减少总字节」（总字节不变），而是**让首屏关键路径更短、缓存更稳**：
         *   - `pinyin`：pinyin-pro 是 317 KB raw / ~130 KB gz 的巨型单包，而首屏一次都用不上
         *     （见 src/utils/search.js 顶部注释）。它被 `import()` 动态引入，本就会成为独立
         *     chunk；这里只是给它一个稳定名字，便于在构建产物里一眼看出与核对。
         *   - `vendor-vue`：vue / vue-router / pinia / persistedstate。这三者版本极少变，
         *     单独成块后改业务代码不会让用户重下这 ~110 KB。
         *   - 其余依赖（fuse.js、vuedraggable…）留在默认块里，避免过度切碎反而增加请求数。
         *
         * 注意：**并不是**把它们变成「按需加载」——vendor-vue 仍随首屏一起下发。真正的
         * 首屏节省来自 pinyin 的动态 import，这里的分组只解决缓存复用（Cache-Control 层面）。
         */
        manualChunks(id) {
          const p = id.replace(/\\/g, '/')
          if (!p.includes('/node_modules/')) return
          if (p.includes('/pinyin-pro/')) return 'pinyin'
          if (/\/node_modules\/(@vue|vue|vue-router|pinia|pinia-plugin-persistedstate)\//.test(p)) {
            return 'vendor-vue'
          }
          return
        }
      }
    }
  }
})