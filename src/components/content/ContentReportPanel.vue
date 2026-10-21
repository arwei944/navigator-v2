<script setup>
/**
 * 周报面板：展示滚动 7 天的规则汇总，可手动重新生成与切换历史。
 */
defineProps({
  report: { type: Object, default: null },
  history: { type: Array, default: () => [] },
  generating: { type: Boolean, default: false },
})
defineEmits(['generate', 'open'])

function labelOf(id) {
  return String(id || '').replace(/^weekly-/, '')
}
</script>

<template>
  <section class="cr">
    <div class="cr-head">
      <div>
        <h2>情报周报</h2>
        <p class="cr-sub">过去 7 天的滚动汇总：高影响事件、突增实体、跨事件扩散与来源健康。</p>
      </div>
      <button class="cr-btn" type="button" :disabled="generating" @click="$emit('generate')">
        {{ generating ? '生成中…' : '重新生成' }}
      </button>
    </div>

    <div v-if="history.length" class="cr-history">
      <button
        v-for="item in history" :key="item.id" type="button"
        :class="{ active: report?.id === item.id }"
        @click="$emit('open', item.id)"
      >{{ labelOf(item.id) }}</button>
    </div>

    <article v-if="report" class="cr-body">
      <pre>{{ report.contentMd }}</pre>
    </article>
    <p v-else class="cr-empty">
      还没有周报。点「重新生成」立即汇总，或等下一轮「处理内容」自动生成。
    </p>
  </section>
</template>

<style scoped>
.cr-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.cr-head h2 { margin: 0; font-size: 18px; }
.cr-sub { margin: 6px 0 0; color: var(--text-secondary); font-size: 12.5px; line-height: 1.6; }
.cr-btn {
  padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border);
  background: var(--bg-elevated, transparent); color: var(--text); cursor: pointer; font-size: 13px;
  white-space: nowrap;
}
.cr-btn:hover:not(:disabled) { border-color: var(--accent); }
.cr-btn:disabled { opacity: .5; cursor: default; }
.cr-history { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
.cr-history button {
  padding: 4px 10px; border-radius: 999px; border: 1px solid var(--border);
  background: transparent; color: var(--text-secondary); cursor: pointer; font-size: 11.5px;
}
.cr-history button.active { border-color: var(--accent); color: var(--accent); }
.cr-body {
  margin-top: 14px; border: 1px solid var(--border); border-radius: 10px;
  padding: 16px; background: var(--bg-elevated, transparent);
}
.cr-body pre {
  white-space: pre-wrap; word-break: break-word; font: inherit;
  font-size: 13px; line-height: 1.75; margin: 0;
}
.cr-empty { padding: 40px 0; text-align: center; color: var(--text-secondary); font-size: 13px; }
</style>
