<template>
  <div class="deploy">
    <header class="dp-head">
      <div>
        <h2 class="dp-title">部署</h2>
        <p class="dp-sub">
          线上这台机器跑的构建、运行状态与数据版本。
          <strong>完整的代码发布在本地运维控制台</strong>（「发布到服务器」面板）——
          站点自己没有源码和发布凭据，它只能如实汇报状态，不能部署自己。
        </p>
      </div>
      <button type="button" class="dp-btn" :disabled="loading" @click="load">
        {{ loading ? '刷新中…' : '刷新' }}
      </button>
    </header>

    <p v-if="error" class="dp-error">{{ error }}</p>

    <!-- 一致性摘要：把「构建 / 上游 / 线上」三方是否对齐用一句话说清，不必逐卡片去读 -->
    <div v-if="status" class="dp-consistency" :class="consistency.level">
      <span class="dp-dot" :class="consistency.level" aria-hidden="true"></span>
      <span>{{ consistency.text }}</span>
    </div>

    <template v-if="status">
      <!-- 版本 -->
      <section class="dp-card">
        <div class="dp-card-head">
          <h3>版本</h3>
          <button type="button" class="dp-link" :disabled="checking" @click="check">
            {{ checking ? '检查中…' : '检查更新' }}
          </button>
        </div>

        <div v-if="status.version.available" class="dp-version">
          <code class="dp-sha">{{ status.version.shortSha }}</code>
          <span v-if="status.version.dirty" class="dp-tag warn" title="构建时工作区有未提交改动 —— 这个版本号对应的不是任何一次提交">未提交改动</span>
          <span class="dp-branch">{{ status.version.branch }}</span>
        </div>
        <p v-else class="dp-muted">这次部署没有带构建信息（本地开发，或发布包早于本功能）。</p>

        <p v-if="status.version.subject" class="dp-subject">{{ status.version.subject }}</p>
        <p class="dp-muted">构建于 {{ fmtDateTimeShort(status.version.builtAt) }}</p>

        <div v-if="upstream" class="dp-upstream" :class="{ good: upstream.behind === 0 }">
          <template v-if="upstream.behind === 0">
            <span class="dp-dot ok" aria-hidden="true"></span>
            已是最新（与上游 master 一致）
          </template>
          <template v-else>
            <span class="dp-dot warn" aria-hidden="true"></span>
            落后上游 <b>{{ upstream.behind }}{{ upstream.more ? '+' : '' }}</b> 个提交
            <ul v-if="upstream.commits.length" class="dp-commits">
              <li v-for="c in upstream.commits" :key="c.sha">
                <code>{{ c.sha }}</code>
                <span class="dp-commit-msg">{{ c.message }}</span>
              </li>
            </ul>
          </template>
        </div>
        <p v-else-if="upstreamError" class="dp-muted">{{ upstreamError }}</p>
      </section>

      <!-- 运行时 -->
      <section class="dp-card">
        <h3>运行时</h3>
        <dl class="dp-grid">
          <div><dt>Node</dt><dd>{{ status.runtime.node }}</dd></div>
          <div><dt>平台</dt><dd>{{ status.runtime.platform }}</dd></div>
          <div><dt>端口</dt><dd>{{ status.runtime.port || '—' }}</dd></div>
          <div>
            <dt>运行时长</dt>
            <dd>{{ status.runtime.persistent ? fmtDurationZh(status.runtime.uptimeSec) : '请求驱动（无常驻进程）' }}</dd>
          </div>
          <div><dt>内存 RSS</dt><dd>{{ status.runtime.rssMb }} MB</dd></div>
          <div><dt>堆占用</dt><dd>{{ status.runtime.heapUsedMb }} MB</dd></div>
        </dl>
      </section>

      <!-- 数据 -->
      <section class="dp-card">
        <h3>数据</h3>
        <dl class="dp-grid">
          <template v-if="status.data.available">
            <div><dt>站点数</dt><dd>{{ status.data.siteCount }}</dd></div>
            <div><dt>数据版本</dt><dd>{{ status.data.version }}</dd></div>
            <div class="wide"><dt>数据更新时间</dt><dd>{{ fmtDateTimeShort(status.data.updatedAt) }}</dd></div>
          </template>
          <div v-else class="wide"><dt>站点库</dt><dd>读不到（可能是首次启动，或存储未就绪）</dd></div>
          <div><dt>数据目录</dt><dd>{{ fmtBytes(status.storage.bytes) }}</dd></div>
          <div><dt>文件数</dt><dd>{{ status.storage.files }}</dd></div>
        </dl>
      </section>

      <!-- 巡检 -->
      <section class="dp-card">
        <h3>定时巡检</h3>
        <div class="dp-cron" :class="{ on: status.cron.started && !status.cron.lastError }">
          <span class="dp-dot" :class="status.cron.started ? (status.cron.lastError ? 'warn' : 'ok') : 'off'" aria-hidden="true"></span>
          <span v-if="!status.cron.enabled">未启用</span>
          <span v-else-if="!status.cron.started">已启用，尚未开始</span>
          <span v-else>
            {{ status.cron.running ? `正在巡检（${status.cron.phase}）` : '待下一轮' }}
            · 上次
            <template v-if="status.cron.lastRunAgoSec != null">{{ fmtDurationZh(status.cron.lastRunAgoSec) }}前</template>
            <template v-else>从未</template>
            · 本轮 {{ status.cron.lastCount }} 个
          </span>
        </div>
        <p v-if="status.cron.lastError" class="dp-error sm">最近一次出错：{{ status.cron.lastError }}</p>
      </section>

      <p class="dp-foot">状态读取于 {{ fmtDateTimeShort(status.checkedAt) }}</p>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { fetchStatus, checkUpstream } from '@/services/deployApi'
import { fmtDateTimeShort, fmtDurationZh, fmtBytes } from '@/utils/format'

/**
 * 后台「部署」面板。
 *
 * 只读，而且**刻意不提供「一键部署」按钮**：站点的产物里既没有源码也没有发布凭据，
 * 真要在这里点一下就发布，等于把发布凭据塞进公开的前端产物 —— 那是拿安全换方便。
 * 所以这里把「现在跑的是哪一版、落后多少」讲清楚，把动作留在本地控制台。
 */

const status = ref(null)
const loading = ref(false)
const error = ref('')

const checking = ref(false)
const upstream = ref(null)
const upstreamError = ref('')

/**
 * 一致性摘要（本地源码 / 上次构建 / 线上 三方对齐）。
 *
 * 后台这台机器本身就是「线上」，拿不到开发机的源码 —— 所以它比对的是
 * **「这个产物构建时对应的提交」↔「运行中的自己」↔「上游 GitHub」**：
 * 三者一致 = 线上正跑着上游最新、且构建自干净工作区；不一致就明说哪里不一致。
 */
const consistency = computed(() => {
  const v = status.value?.version
  if (!v || !v.available) return { level: 'info', text: '这次部署没有带构建信息（本地开发，或发布包早于本功能）' }
  if (v.dirty) return { level: 'warn', text: '构建时工作区有未提交改动 —— 这个版本号不对应任何一次提交，无法追溯到源头' }
  if (upstream.value && upstream.value.behind > 0) return { level: 'warn', text: `落后上游 master ${upstream.value.behind}${upstream.value.more ? '+' : ''} 个提交，可以把本地最新提交发上来` }
  if (upstream.value && upstream.value.behind === 0) return { level: 'ok', text: '与上游 master 一致，且构建自干净的工作区' }
  if (upstreamError.value) return { level: 'info', text: `上游比对失败：${upstreamError.value}` }
  return { level: 'info', text: '点「检查更新」比对上游 Git 仓库，确认线上是不是最新' }
})

async function load() {
  loading.value = true
  error.value = ''
  const r = await fetchStatus()
  if (r.ok) {
    status.value = r.status
  } else {
    error.value = r.error
    status.value = null
  }
  loading.value = false
}

async function check() {
  if (!status.value?.version?.sha) {
    upstreamError.value = '线上版本没有提交号，无法比较'
    return
  }
  checking.value = true
  upstreamError.value = ''
  const r = await checkUpstream(status.value.version.sha)
  if (r.ok) {
    upstream.value = r
  } else {
    upstreamError.value = r.error
    upstream.value = null
  }
  checking.value = false
}

onMounted(load)
</script>

<style scoped>
.deploy { padding: 0 32px 40px; max-width: 880px; }
.dp-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.dp-title { margin: 0; font-size: 16px; font-weight: 600; color: var(--text-primary); }
.dp-sub { margin: 6px 0 0; font-size: 12px; line-height: 1.7; color: var(--text-secondary); max-width: 68ch; }
.dp-btn {
  padding: 6px 14px; font-size: 12px; border-radius: var(--radius-sm);
  border: 1px solid var(--border); background: var(--bg-white); color: var(--text-secondary); cursor: pointer;
}
.dp-btn:hover { border-color: var(--accent); color: var(--accent); }
.dp-btn:disabled { opacity: .5; cursor: not-allowed; }
.dp-link {
  border: none; background: none; padding: 0; font-size: 12px; color: var(--accent); cursor: pointer;
}
.dp-link:disabled { opacity: .5; cursor: not-allowed; }

.dp-error { margin: 0 0 12px; font-size: 12px; color: #b91c1c; }
.dp-error.sm { margin-top: 8px; font-size: 11px; }

.dp-consistency {
  display: flex; align-items: flex-start; gap: 8px; margin-bottom: 14px; padding: 10px 12px;
  border-radius: var(--radius-sm); font-size: 12.5px; line-height: 1.6;
  background: var(--border-light); color: var(--text-secondary); border: 1px solid var(--border);
}
.dp-consistency.ok { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok-fg); }
.dp-consistency.warn { background: var(--warn-bg); border-color: var(--warn-border); color: var(--warn-fg); }
.dp-dot.ok { background: #16a34a; }
.dp-dot.warn { background: #d97706; }
.dp-dot.info { background: #94a3b8; }

.dp-card {
  border: 1px solid var(--border); border-radius: var(--radius-md);
  background: var(--bg-white); padding: 16px 18px; margin-bottom: 14px;
}
.dp-card h3 { margin: 0 0 12px; font-size: 12px; font-weight: 600; color: var(--text-secondary);
  text-transform: uppercase; letter-spacing: .5px; opacity: .75; }
.dp-card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.dp-card-head h3 { margin: 0; }

.dp-version { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dp-sha {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 15px;
  color: var(--text-primary); background: var(--border-light); padding: 2px 8px; border-radius: 6px;
}
.dp-branch { font-size: 11px; color: var(--text-secondary); }
.dp-tag { font-size: 10px; padding: 1px 7px; border-radius: 999px; border: 1px solid currentColor; }
.dp-tag.warn { color: var(--warn-fg); }
.dp-subject { margin: 10px 0 4px; font-size: 13px; color: var(--text-primary); }
.dp-muted { margin: 6px 0 0; font-size: 11px; color: var(--text-secondary); opacity: .8; }

.dp-upstream {
  margin-top: 12px; padding: 10px 12px; border-radius: var(--radius-sm);
  background: var(--warn-bg); border: 1px solid var(--warn-border); font-size: 12px; color: var(--warn-fg);
  display: flex; align-items: flex-start; gap: 8px; flex-wrap: wrap;
}
.dp-upstream.good { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok-fg); }
.dp-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; margin-top: 5px; background: currentColor; }
.dp-dot.ok { background: #16a34a; }
.dp-dot.warn { background: #d97706; }
.dp-dot.off { background: #94a3b8; }
.dp-commits { flex-basis: 100%; list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.dp-commits li { display: flex; gap: 8px; font-size: 11px; }
.dp-commits code { font-family: ui-monospace, monospace; opacity: .8; flex-shrink: 0; }
.dp-commit-msg { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.dp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px 18px; margin: 0; }
.dp-grid .wide { grid-column: 1 / -1; }
.dp-grid dt { font-size: 11px; color: var(--text-secondary); opacity: .75; margin-bottom: 2px; }
.dp-grid dd { margin: 0; font-size: 13px; color: var(--text-primary); }

.dp-cron { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; color: var(--text-secondary); }
.dp-foot { margin: 4px 0 0; font-size: 11px; color: var(--text-secondary); opacity: .6; }
</style>
