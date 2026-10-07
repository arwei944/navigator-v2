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
  </div>
</template>

<script setup>
import { usePreferencesStore } from '@/stores/preferences'

const preferencesStore = usePreferencesStore()
</script>

<style scoped>
/* 区块外壳必须自带一份：这些类名在本项目里都是各组件 scoped 定义的，
   父级 AdminView.vue 的 scoped 样式只能命中子组件根节点，命中不了 header 与版本号，
   不自带就会出现「标题栏掉样式」，与兄弟面板不一致。取值对齐 AdminInsights.vue。 */
.admin-section { padding: 0 32px 32px; }

.admin-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

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
</style>
