<script setup>
/**
 * 备份与恢复面板（v10-P5）。
 *
 * 为什么要它：发布沙箱的磁盘**没有 SLA** —— 抗得住进程被回收（SQLite 在磁盘上），
 * 抗不住「整个沙箱没了」。数据必须有一个能随时拿走、也能随时放回去的形态：一个 JSON。
 *
 * 恢复是覆盖写，所以流程上做了三层保护：
 *   ① 先在浏览器里解析并**显示差异**（站点数 / 版本 / 分类数），让人确认；
 *   ② 服务端**恢复前先拍安全快照**（`ops/backups/pre-restore-*.json`）；
 *   ③ 服务端用与站点数据面同一把尺子（shared/sanitize）校验，坏结构一律拒且不改任何东西。
 */
import { ref, computed } from 'vue'
import { opsApi } from '@/services/opsApi'

const props = defineProps({ adminKey: { type: String, default: '' } })

const busy = ref('')
const message = ref('')
const tone = ref('')
const picked = ref(null)      // 已解析的备份文件
const lastExport = ref(null)  // 上次导出的概要

function say(text, t = '') { message.value = text; tone.value = t }

async function exportBackup() {
  busy.value = 'export'; say('')
  try {
    const data = await opsApi.backup(props.adminKey)
    lastExport.value = data.counts
    // 触发浏览器下载：服务端已经设好 Content-Disposition，这里只给个文件名
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `navigator-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    say(`已导出：${data.counts.sites} 个站点 / ${data.counts.categories} 个分类（version ${data.counts.version}）`, 'ok')
  } catch (e) {
    say('导出失败：' + (e.message || e), 'err')
  } finally { busy.value = '' }
}

function onPickFile(ev) {
  const file = ev.target.files && ev.target.files[0]
  if (!file) { picked.value = null; return }
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result))
      if (data.kind !== 'navigator-backup' || !data.sites) throw new Error('不是有效的备份文件')
      picked.value = data
      say(`已读取：${data.counts?.sites ?? (data.sites.sites || []).length} 个站点 / ${data.exportedAt || '未知时间'}`, 'ok')
    } catch (e) {
      picked.value = null
      say('读取失败：' + e.message, 'err')
    }
  }
  reader.readAsText(file)
}

const diff = computed(() => {
  if (!picked.value) return null
  const inc = picked.value.counts || {}
  return {
    sites: inc.sites ?? (picked.value.sites.sites || []).length,
    categories: inc.categories ?? (picked.value.sites.categories || []).length,
    version: inc.version ?? (picked.value.sites.version || 0),
    exportedAt: picked.value.exportedAt || '未知',
  }
})

async function restore() {
  if (!picked.value) return
  busy.value = 'restore'; say('')
  try {
    const r = await opsApi.restoreBackup(props.adminKey, picked.value)
    say(
      `已恢复：${r.restored.sites} 个站点 / ${r.restored.categories} 个分类，新 version ${r.restored.version}` +
      `（旁路数据 ${r.cloudRestored} 项恢复${r.cloudSkipped.length ? `，跳过 ${r.cloudSkipped.join('、')}` : ''}）。` +
      `恢复前的安全快照：${r.safetySnapshot}`,
      'ok',
    )
    picked.value = null
  } catch (e) {
    say('恢复失败：' + (e.message || e), 'err')
  } finally { busy.value = '' }
}
</script>

<template>
  <div class="backup">
    <div class="ops-head">
      <h3>备份与恢复</h3>
      <span class="ops-hint">沙箱磁盘没有 SLA —— 定期导出一份 JSON 放本地，是唯一不会被平台收回的副本</span>
    </div>

    <section class="panel">
      <h4>导出备份</h4>
      <p class="ops-note">
        含站点表、分类、点击统计、巡检判定与运维记录（不含各设备自己的会话数据）。
        文件是纯 JSON，可以直接存档或提交进 git。
      </p>
      <button class="mini-btn primary" :disabled="busy === 'export'" @click="exportBackup">
        {{ busy === 'export' ? '导出中…' : '导出并下载' }}
      </button>
      <p v-if="lastExport" class="ops-note">最近一次：{{ lastExport.sites }} 站 / {{ lastExport.categories }} 分类 / version {{ lastExport.version }}</p>
    </section>

    <section class="panel">
      <h4>从备份恢复</h4>
      <p class="ops-note">恢复会**覆盖**当前云端数据。服务端会先自动拍一份恢复前快照，任何一步出错都不会留下半截状态。</p>
      <input type="file" accept="application/json,.json" @change="onPickFile">
      <div v-if="diff" class="diff">
        <p>备份内容：{{ diff.sites }} 站 / {{ diff.categories }} 分类 / version {{ diff.version }} · 导出于 {{ diff.exportedAt }}</p>
        <button class="mini-btn danger" :disabled="busy === 'restore'" @click="restore">
          {{ busy === 'restore' ? '恢复中…' : '确认覆盖恢复' }}
        </button>
      </div>
    </section>

    <p v-if="message" class="ops-msg" :class="tone">{{ message }}</p>
  </div>
</template>

<style scoped>
.backup { display: flex; flex-direction: column; gap: 18px; }
.panel { border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
.panel h4 { margin: 0 0 8px; font-size: 14px; font-weight: 600; }
.ops-hint { color: var(--text-secondary); font-size: 12px; }
.ops-note { color: var(--text-secondary); font-size: 12px; line-height: 1.6; margin: 6px 0 10px; }
.diff { margin-top: 10px; padding: 10px; border-radius: 8px; background: var(--border-light); font-size: 13px; }
.ops-msg { font-size: 13px; line-height: 1.6; }
.ops-msg.ok { color: var(--ok-fg); }
.ops-msg.err { color: var(--danger-fg); }
.mini-btn { padding: 6px 12px; border-radius: 6px; border: 1px solid var(--border); cursor: pointer; font-size: 13px; }
.mini-btn.primary { background: var(--accent); color: var(--on-accent); border-color: transparent; }
.mini-btn.danger { background: var(--danger-fg); color: var(--on-accent); border-color: transparent; }
.mini-btn:disabled { opacity: .6; cursor: default; }
</style>