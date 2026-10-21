/**
 * 扩展的 service worker。
 *
 * 只做两件事：
 *   1. 首次安装写入默认配置（站点地址留空，必须由用户显式填写 —— 不猜线上域名）；
 *   2. 右键菜单「把当前页加入临时工作区」，用于零散收藏。
 *
 * 批量采集与预览在 popup 里完成：那里有界面可以确认，而且不会在用户
 * 关掉弹窗后还在后台默默上传几千条历史。
 */
const DEFAULTS = {
  baseUrl: '',
  apiKey: '',
  sources: ['history', 'bookmarks', 'tabs'],
  days: 90,
  minVisits: 1,
  maxItems: 1000,
  blacklist: '',
}

chrome.runtime.onInstalled.addListener(async () => {
  const cur = await chrome.storage.local.get('config')
  if (!cur.config) await chrome.storage.local.set({ config: DEFAULTS })

  chrome.contextMenus.create({
    id: 'nav-sync-current',
    title: '把当前页加入导航站临时工作区',
    contexts: ['page'],
  })
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'nav-sync-current' || !tab?.url) return
  const { config } = await chrome.storage.local.get('config')
  const cfg = { ...DEFAULTS, ...(config || {}) }
  if (!cfg.baseUrl || !cfg.apiKey) {
    chrome.notifications?.create?.({
      type: 'basic',
      iconUrl: 'icon.png',
      title: '还没配置导航站',
      message: '请先在扩展选项里填写站点地址和管理密钥。',
    })
    return
  }
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/api/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Nav-Key': cfg.apiKey,
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        client: 'browser-extension/context-menu',
        items: [{ url: tab.url, title: tab.title || '', visitCount: 1, lastVisitTime: Date.now(), source: 'tab' }],
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
    chrome.action.setBadgeText({ text: '1' })
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e' })
  } catch (e) {
    console.error('[nav-sync] 提交失败：', e?.message || e)
  }
})