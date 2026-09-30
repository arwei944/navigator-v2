/** 控制台入口：主题、标签切换、概览面板、日志控制台按钮 */
import { $, $$, api, renderKv, initLogConsole, openStream } from './core.js'
import { initTheme } from './theme.js'
import { initGitPanel, refresh } from './gitpanel.js'
import { initSyncPanel, refresh as refreshSync } from './syncpanel.js'
import { initHistoryPanel, refresh as refreshHistory } from './historypanel.js'
import { initDataPanel, refresh as refreshData } from './datapanel.js'
import { initSitesPanel, refresh as refreshSites } from './sitespanel.js'
import { initAuditPanel, refresh as refreshAudit } from './auditpanel.js'
import { initHealthPanel, refresh as refreshHealth } from './healthpanel.js'

/* ---------- 标签切换 ---------- */
$('#tabs').addEventListener('click', e => {
  const btn = e.target.closest('.tab')
  if (!btn) return
  $$('.tab').forEach(t => t.classList.toggle('active', t === btn))
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${btn.dataset.panel}`))
  if (btn.dataset.panel === 'sites') refreshSites()
  if (btn.dataset.panel === 'changes' || btn.dataset.panel === 'commit') refresh()
  if (btn.dataset.panel === 'sync') refreshSync()
  if (btn.dataset.panel === 'history') refreshHistory()
  if (btn.dataset.panel === 'data') refreshData()
  if (btn.dataset.panel === 'audit') refreshAudit()
  if (btn.dataset.panel === 'health') refreshHealth()
})

/* ---------- 概览 ---------- */
async function loadHealth() {
  const dot = $('#health-dot')
  try {
    const h = await api('/api/health')
    dot.className = 'dot ok'
    $('#health').textContent = `服务正常 · node ${h.node} · pid ${h.pid}`
    renderKv($('#env-info'), [
      ['项目根目录', h.root],
      ['Node 版本', h.node],
      ['平台', h.platform],
      ['进程 PID', String(h.pid)],
      ['管理密钥', h.adminKeyConfigured ? ['已配置', 'yes'] : ['未配置', 'no']],
    ])
  } catch {
    dot.className = 'dot err'
    $('#health').textContent = '服务不可用'
  }
}

async function loadEnv() {
  const e = await api('/api/env')
  renderKv($('#env-vars'), [
    ['.env.local', e.envFileExists ? ['存在', 'yes'] : ['不存在', 'no']],
    ...e.vars.map(v => [v.name, v.configured ? ['已配置', 'yes'] : ['未配置', 'no']]),
  ])
}

/* ---------- 日志控制台按钮 ---------- */
$('#btn-selfcheck').addEventListener('click', async () => {
  const { jobId } = await api('/api/jobs/selfcheck', { method: 'POST' })
  openStream(jobId, '控制台自检')
})

// 日志区可收起，给面板腾出纵向空间
$('#btn-toggle-console').addEventListener('click', () => {
  const collapsed = document.body.classList.toggle('console-collapsed')
  $('#btn-toggle-console').textContent = collapsed ? '展开' : '收起'
})

/* ---------- 初始化 ---------- */
initTheme()
initLogConsole()
initGitPanel()
initSyncPanel()
initHistoryPanel()
initDataPanel()
initSitesPanel()
initAuditPanel()
initHealthPanel()
loadHealth()
loadEnv()

// 改动面板可见时轻量轮询，捕捉控制台之外的编辑；有任务在跑时不打扰
setInterval(() => {
  const active = $('.panel.active')?.id
  if (active === 'panel-changes' || active === 'panel-commit') refresh()
  if (active === 'panel-sync') refreshSync()
  if (active === 'panel-audit') refreshAudit()
  if (active === 'panel-health') refreshHealth()
}, 30000)