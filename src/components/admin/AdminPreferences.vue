<template>
  <div class="admin-section">
    <div class="admin-section-header">
      <h2>偏好设置</h2>
      <span class="admin-cloud-version">本机生效，不同步到云端</span>
    </div>

    <div class="pref-list">
      <label class="pref-row">
        <div class="pref-text">
          <span class="pref-title">网址自动添加</span>
          <span class="pref-desc">
            在站内搜索框粘贴网址时，跳过确认弹窗，直接识别并入库，随后弹出预览卡片（可撤销、可编辑）。
            网址不像网址、该域名已收录、抓取失败或站名识别不出来时，仍会退回弹窗请你确认。
          </span>
        </div>
        <input type="checkbox" class="pref-switch"
               :checked="preferencesStore.autoAddOnUrl"
               @change="preferencesStore.setAutoAdd($event.target.checked)">
      </label>
    </div>

    <!-- 告警规则：连续几次不可达才提醒 / 自动归档，可按分类或域名分档 -->
    <section class="alert-section">
      <div class="alert-head">
        <h3>告警规则</h3>
        <span class="pref-note">连续几次不可达才算「真挂了」。命中不了下面任何一条时，用「全局默认」。</span>
      </div>

      <div v-if="alertLoading" class="alert-muted">加载中…</div>
      <p v-else-if="alertError" class="alert-error">{{ alertError }}</p>
      <template v-else>
        <div class="alert-global">
          <span>全局默认：连续</span>
          <input v-model.number="globalThreshold" type="number" min="1" max="50" class="alert-num">
          <span>次不可达即提醒 / 自动归档</span>
        </div>

        <div v-for="(r, i) in rules" :key="i" class="alert-rule">
          <select v-model="r.type" class="mini-input">
            <option value="category">分类</option>
            <option value="host">域名</option>
          </select>
          <select v-if="r.type === 'category'" v-model="r.value" class="mini-input grow">
            <option value="">选择分类…</option>
            <option v-for="c in categoriesStore.categories" :key="c.id" :value="c.id">{{ c.label }}</option>
          </select>
          <input v-else v-model="r.value" class="mini-input grow" placeholder="例如 binance.com">
          <input v-model.number="r.threshold" type="number" min="1" max="50" class="alert-num">
          <span class="alert-unit">次</span>
          <label class="alert-enable"><input v-model="r.enabled" type="checkbox"> 启用</label>
          <button class="mini-btn" @click="rules.splice(i, 1)">删除</button>
        </div>

        <div class="alert-actions">
          <button class="mini-btn" @click="addRule">+ 添加规则</button>
          <button class="mini-btn primary" :disabled="alertSaving" @click="saveAlerts">
            {{ alertSaving ? '保存中…' : '保存规则' }}
          </button>
          <span v-if="alertSaved" class="alert-saved">已保存 ✓</span>
        </div>
      </template>
    </section>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { usePreferencesStore } from '@/stores/preferences'
import { useCategoriesStore } from '@/stores/categories'
import { alertApi } from '@/services/alertApi'

const preferencesStore = usePreferencesStore()
const categoriesStore = useCategoriesStore()

/**
 * 告警规则编辑。
 *
 * 存的是**服务端**（`alert-rules.json`），因为消费它的是服务端巡检（cron 的自动归档）
 * 与控制台告警 —— 这跟上面那条「本机生效」的开关不一样，所以单独成块并注明。
 */
const alertLoading = ref(true)
const alertError = ref('')
const alertSaving = ref(false)
const alertSaved = ref(false)
const globalThreshold = ref(5)
const rules = ref([])

function toRows(cfg) {
  return ((cfg && cfg.rules) || []).map(r => ({
    type: (r.match && r.match.host) ? 'host' : 'category',
    value: (r.match && (r.match.host || r.match.categoryId)) || '',
    threshold: r.downThreshold || 5,
    enabled: r.enabled !== false,
  }))
}
function toConfig() {
  return {
    rules: rules.value
      .filter(r => r.value)
      .map((r, i) => ({
        id: `r${i}`,
        enabled: r.enabled !== false,
        match: r.type === 'host' ? { host: r.value } : { categoryId: r.value },
        downThreshold: Math.max(1, Math.floor(Number(r.threshold)) || 5),
      })),
    fallback: { downThreshold: Math.max(1, Math.floor(Number(globalThreshold.value)) || 5) },
  }
}
function addRule() {
  rules.value.push({ type: 'category', value: '', threshold: 2, enabled: true })
}

async function loadAlerts() {
  alertLoading.value = true
  alertError.value = ''
  const r = await alertApi.load()
  if (r.ok) {
    globalThreshold.value = (r.config && r.config.fallback && r.config.fallback.downThreshold) || 5
    rules.value = toRows(r.config)
  } else {
    alertError.value = r.error || '读取失败'
  }
  alertLoading.value = false
}

async function saveAlerts() {
  alertSaving.value = true
  alertSaved.value = false
  const r = await alertApi.save(null, toConfig())
  if (r.ok) {
    alertSaved.value = true
    setTimeout(() => { alertSaved.value = false }, 2200)
    globalThreshold.value = (r.config && r.config.fallback && r.config.fallback.downThreshold) || globalThreshold.value
    rules.value = toRows(r.config)
  } else {
    alertError.value = r.error || '保存失败'
  }
  alertSaving.value = false
}

onMounted(loadAlerts)
</script>

<style scoped>
/* 区块外壳必须自带一份：这些类名在本项目里都是各组件 scoped 定义的，
   父级 AdminView.vue 的 scoped 样式只能命中子组件根节点，命中不了 header、
   标题 h2 与版本号，不自带就会出现「标题栏掉样式」，与兄弟面板不一致。
   取值对齐 AdminInsights.vue。 */
.admin-section { padding: 0 32px 32px; }

.admin-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

/* h2 也必须自带：全局样式 src/styles/main.css 只做 `* { margin:0; padding:0 }` 重置，
   未定义 h2 的字号/字重，缺失会落回浏览器默认（≈1.5em/bold），与兄弟面板的 16px/600 不一致。 */
.admin-section-header h2 { font-size: 16px; font-weight: 600; }

.admin-cloud-version { font-size: 12px; color: var(--accent); font-weight: 600; }

.pref-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pref-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 16px 18px;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 10px;
  background: var(--bg-white, #fff);
  cursor: pointer;
}

.pref-text {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.pref-title {
  font-size: 14px;
  font-weight: 600;
}

.pref-desc {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted, #64748b);
}

.pref-switch {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 2px;
  accent-color: var(--accent, #2563eb);
  cursor: pointer;
}

/* 告警规则区 */
.alert-section { margin-top: 26px; }
.alert-head { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
.alert-head h3 { font-size: 14px; font-weight: 600; }
.pref-note { font-size: 12px; line-height: 1.6; color: var(--text-muted, #64748b); }
.alert-muted { font-size: 12.5px; color: var(--text-muted, #64748b); }
.alert-error { font-size: 12.5px; color: var(--danger-fg); margin: 0; }
.alert-global {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 12px 14px; border: 1px solid var(--border, #e2e8f0); border-radius: 10px;
  background: var(--bg-white, #fff); font-size: 13px; margin-bottom: 10px;
}
.alert-rule {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 10px 14px; border: 1px solid var(--border, #e2e8f0); border-radius: 10px;
  background: var(--bg-white, #fff); font-size: 13px; margin-bottom: 8px;
}
.mini-input {
  padding: 5px 9px; border: 1px solid var(--border, #e2e8f0); border-radius: 6px;
  font-size: 12.5px; background: var(--bg-white, #fff); color: var(--text-primary, #0f172a); outline: none;
}
.mini-input.grow { flex: 1; min-width: 150px; }
.mini-input:focus { border-color: var(--accent, #2563eb); }
.alert-num {
  width: 64px; padding: 5px 8px; border: 1px solid var(--border, #e2e8f0); border-radius: 6px;
  font-size: 12.5px; text-align: center;
}
.alert-unit { color: var(--text-muted, #64748b); }
.alert-enable { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; color: var(--text-muted, #64748b); }
.alert-actions { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
.mini-btn {
  padding: 6px 14px; border: 1px solid var(--border, #e2e8f0); border-radius: 6px;
  background: var(--bg-white, #fff); font-size: 12.5px; cursor: pointer;
}
.mini-btn:hover:not(:disabled) { border-color: var(--accent, #2563eb); color: var(--accent, #2563eb); }
.mini-btn.primary { background: var(--accent, #2563eb); border-color: var(--accent, #2563eb); color: #fff; font-weight: 600; }
.mini-btn:disabled { opacity: .6; cursor: not-allowed; }
.alert-saved { font-size: 12.5px; color: var(--ok-fg); }
</style>
