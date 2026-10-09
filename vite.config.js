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
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']
      }
    })
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
})