import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
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
         * 只预缓存「应用外壳」：构建产物（js/css）、index.html、favicon、两个 PWA 图标。
         *
         * 绝不能把 `icons/**` 放进来 —— 实测它会让预缓存清单从 16 条涨到 294 条 / 7.17 MB
         * （其中图标 6.11 MB / 278 个），SW 安装期就得在后台把这 7 MB 全下完，而其中
         * 绝大多数图标用户一辈子不会看到（首访实测多传约 4.6 MB）。
         * 图标改走下方 runtimeCaching：谁被渲染到就缓存谁，仍是离线可用的。
         */
        globPatterns: ['**/*.{js,css,html}', 'favicon.svg', 'pwa-*.png'],
        // sw.js / workbox-*.js 由 workbox 自行管理，绝不进预缓存清单
        globIgnores: ['icons/**', 'sw.js', 'workbox-*.js'],
        runtimeCaching: [
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
          }
        ]
      }
    })
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
})