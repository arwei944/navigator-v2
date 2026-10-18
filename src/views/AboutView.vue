<template>
  <div class="about">
    <header class="ab-head">
      <h1>关于</h1>
      <p class="ab-sub">Navigator · 自托管的网址导航与站点管理</p>
    </header>

    <!-- 版本 -->
    <section class="ab-card">
      <h2>版本</h2>
      <p v-if="appVersion" class="ab-product">Navigator <b>v{{ appVersion }}</b></p>
      <div v-if="version.sha" class="ab-version">
        <code class="ab-sha">{{ version.shortSha }}</code>
        <span v-if="version.dirty" class="ab-tag warn" title="构建时工作区有未提交改动 —— 这个版本号不对应任何一次提交">未提交改动</span>
        <span class="ab-branch">{{ version.branch }}</span>
      </div>
      <p v-else-if="loading" class="ab-muted">正在读取…</p>
      <p v-else class="ab-muted">这次部署没有带构建信息（本地开发，或发布包早于该功能）。</p>

      <p v-if="version.subject" class="ab-subject">{{ version.subject }}</p>
      <dl class="ab-grid">
        <div><dt>构建于</dt><dd>{{ fmtDateTimeSec(version.builtAt) }}</dd></div>
        <div><dt>站点数</dt><dd>{{ data.siteCount ?? '—' }}</dd></div>
        <div><dt>数据版本</dt><dd>{{ data.version ?? '—' }}</dd></div>
        <div><dt>运行时</dt><dd>{{ runtime.node ? `Node ${runtime.node}` : '—' }}</dd></div>
      </dl>
    </section>

    <!-- 功能 -->
    <section class="ab-card">
      <h2>它做什么</h2>
      <ul class="ab-list">
        <li><b>站点库</b> —— 收藏、分类、标签、回收站、归档，支持批量操作与导入导出。</li>
        <li><b>秒加</b> —— 粘贴网址即抓取站名 / 描述 / 图标并入库，带网址预览卡片。</li>
        <li><b>关联图谱</b> —— 按分类 / 用途 / 别名 / 描述关键词算站点关联度，每条边都有可读理由。</li>
        <li><b>洞察</b> —— 使用热度、分类分布、站点健康度。</li>
        <li><b>插件管理</b> —— 九个引擎模块（抓取 / 翻译 / LLM / 图标 / 封面 / 探针 / 分类表 / 存储 / 发布）统一查看与切换。</li>
        <li><b>开发流水线</b> —— 一条命令跑完测试门禁 → 提交 → 推送 → 构建 → 门禁 → 打包 → 部署 → 线上验证。</li>
        <li><b>部署管理</b> —— 线上跑的是哪一版、落后多少、一键发布与回滚。</li>
      </ul>
    </section>

    <!-- 技术 -->
    <section class="ab-card">
      <h2>技术构成</h2>
      <dl class="ab-grid">
        <div><dt>前端</dt><dd>Vue 3 + Vite（PWA）</dd></div>
        <div><dt>服务端</dt><dd>Node 零依赖 HTTP 服务</dd></div>
        <div><dt>数据</dt><dd>SQLite（站点库）+ 云端热更新</dd></div>
        <div><dt>部署</dt><dd>自有服务器（BotKeep）</dd></div>
        <div><dt>测试</dt><dd>52 个纯 Node 脚本</dd></div>
        <div><dt>本地工具</dt><dd>控制台 + CLI（<code>nav</code>）</dd></div>
      </dl>
    </section>

    <!-- 管理后台安全性：把三件事讲清楚，别让人误以为「密钥写进前端很方便」 -->
    <section class="ab-card">
      <h2>管理后台与登录</h2>
      <p class="ab-muted">
        管理后台需要凭据才能进入。凭据<b>不会</b>写进前端产物 —— 页面代码是公开可下载的，
        写进去等于把永久管理密钥公开发布。当前支持三条路径：
      </p>
      <ol class="ab-list ordered">
        <li>
          <b>本机自动登录</b> —— 在 <code>127.0.0.1</code> / <code>localhost</code> 打开时会自动进入。
          密钥由服务端 <code>/api/_local-key</code> 提供，而那个端点会<b>双重校验来源</b>
          （连接地址与 Host 都必须是回环），线上公开域名一律 404。
        </li>
        <li>
          <b>口令登录 + 记住设备</b> —— 服务端配好 <code>ADMIN_PASSWORD_HASH</code> 与
          <code>AUTH_SECRET</code> 后，用「用户名 + 口令」登录，勾「记住此设备」可 90 天免登录。
          口令只留在你的浏览器密码管理器里。
        </li>
        <li>
          <b>管理密钥直连</b> —— 兜底方式：<code>SITES_ADMIN_KEY</code> 是<b>永久</b>凭据，
          只在服务端没配口令登录时使用。登录状态会保留在本机浏览器，到期自动清除。
        </li>
      </ol>
      <p class="ab-muted">
        生成口令哈希：<code>npm run auth:hash</code>
      </p>
    </section>

    <p class="ab-foot">Navigator · 本地优先的站点管理</p>
  </div>
</template>

<script setup>
/**
 * 「关于」页：项目是什么、跑的是哪一版、怎么进管理后台。
 *
 * 版本信息读公开只读接口 `/api/deploy-status`（未登录也能看）——
 * 报问题时第一句要说的就是「你跑的是哪一版」。
 */
import { onMounted, reactive, ref } from 'vue'
import { fetchStatus } from '@/services/deployApi'
import { fmtDateTimeSec } from '@/utils/format'

// 构建期注入的产品版本号（vite.config.js 的 define）；未注入时回落空串，不显示假的版本号。
const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : ''

const loading = ref(true)
const version = reactive({ available: false, sha: '', shortSha: '', branch: '', subject: '', builtAt: null, dirty: false })
const data = reactive({ siteCount: null, version: null })
const runtime = reactive({ node: '' })

async function load() {
  const r = await fetchStatus()
  if (r.ok) {
    const j = r.status
    Object.assign(version, j.version || {})
    Object.assign(data, j.data || {})
    Object.assign(runtime, j.runtime || {})
  }
  loading.value = false
}

onMounted(load)
</script>

<style scoped>
.about { padding: 24px 32px 48px; max-width: 860px; margin: 0 auto; }
.ab-head { margin-bottom: 20px; }
.ab-head h1 { margin: 0; font-size: 22px; font-weight: 700; color: var(--text-primary); }
.ab-sub { margin: 6px 0 0; font-size: 13px; color: var(--text-secondary); }

.ab-card {
  border: 1px solid var(--border); border-radius: var(--radius-md);
  background: var(--bg-white); padding: 18px 20px; margin-bottom: 14px;
}
.ab-card h2 {
  margin: 0 0 12px; font-size: 12px; font-weight: 600; color: var(--text-secondary);
  text-transform: uppercase; letter-spacing: .5px; opacity: .75;
}

.ab-product { margin: 0 0 10px; font-size: 14px; color: var(--text-secondary); }
.ab-product b { color: var(--text-primary); font-family: var(--font-mono, ui-monospace, monospace); }
.ab-version { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ab-sha {
  font-family: var(--font-mono, ui-monospace, monospace); font-size: 15px;
  color: var(--text-primary); background: var(--border-light); padding: 2px 8px; border-radius: 6px;
}
.ab-branch { font-size: 11px; color: var(--text-secondary); }
.ab-tag { font-size: 10px; padding: 1px 7px; border-radius: 999px; border: 1px solid currentColor; color: #b45309; }
.ab-subject { margin: 10px 0 4px; font-size: 13px; color: var(--text-primary); }
.ab-muted { margin: 8px 0 0; font-size: 12.5px; color: var(--text-secondary); line-height: 1.75; }

.ab-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px 18px; margin: 14px 0 0; }
.ab-grid dt { font-size: 11px; color: var(--text-secondary); opacity: .75; margin-bottom: 2px; }
.ab-grid dd { margin: 0; font-size: 13px; color: var(--text-primary); }

.ab-list { margin: 0; padding-left: 18px; font-size: 12.5px; color: var(--text-secondary); line-height: 1.9; }
.ab-list.ordered { list-style: decimal; }
.ab-list b { color: var(--text-primary); }
.ab-list code, .ab-muted code {
  font-family: var(--font-mono, ui-monospace, monospace); font-size: 11.5px;
  background: var(--border-light); padding: 1px 5px; border-radius: 4px; color: var(--text-primary);
}
.ab-foot { margin: 18px 0 0; text-align: center; font-size: 11.5px; color: var(--text-secondary); opacity: .6; }

@media (max-width: 560px) {
  .about { padding: 18px 16px 40px; }
}
</style>
