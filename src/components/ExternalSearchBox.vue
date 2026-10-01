<template>
  <form
    class="ext-search"
    :action="currentEngine.url"
    method="GET"
    target="_blank"
    rel="noopener noreferrer"
    role="search"
  >
    <label class="ext-engine">
      <select v-model="engineId" aria-label="选择搜索引擎" title="选择搜索引擎">
        <option v-for="e in preferencesStore.engines" :key="e.id" :value="e.id">{{ shortLabel(e) }}</option>
      </select>
      <svg class="ext-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
    </label>

    <input
      v-model="query"
      class="ext-input"
      type="search"
      name="q"
      :placeholder="`用 ${currentEngine.label} 搜索…`"
      aria-label="外部搜索引擎搜索"
    >

    <button class="ext-submit" type="submit" aria-label="搜索" title="在新标签页搜索">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    </button>
  </form>
</template>

<script setup>
import { ref, computed } from 'vue'
import { usePreferencesStore } from '@/stores/preferences'

const preferencesStore = usePreferencesStore()
const query = ref('')

// 下拉宽度取决于最长选项，用短标签避免被 "DuckDuckGo" 撑宽（设置面板里仍是全称）
const SHORT_LABELS = { google: 'Google', bing: 'Bing', baidu: '百度', duckduckgo: 'DDG', perplexity: 'PPLX' }
function shortLabel(e) {
  return SHORT_LABELS[e.id] || e.label
}

const engineId = computed({
  get: () => preferencesStore.searchEngine,
  set: (id) => preferencesStore.setSearchEngine(id)
})

const currentEngine = computed(() => preferencesStore.getCurrentEngine())
</script>

<style scoped>
.ext-search {
  display: flex;
  align-items: center;
  height: 40px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-white);
  overflow: hidden;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.ext-search:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-light);
}

.ext-engine {
  position: relative;
  display: flex;
  align-items: center;
  align-self: stretch;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: var(--border-light);
}
.ext-engine select {
  appearance: none;
  -webkit-appearance: none;
  border: none;
  outline: none;
  background: transparent;
  font-family: var(--font);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  height: 100%;
  padding: 0 22px 0 11px;
  cursor: pointer;
}
.ext-engine select:hover { color: var(--accent); }
.ext-caret {
  position: absolute;
  right: 6px;
  width: 12px;
  height: 12px;
  color: var(--text-secondary);
  pointer-events: none;
}

.ext-input {
  flex: 1 1 auto;
  width: 140px;
  min-width: 0;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  font-family: var(--font);
  font-size: 13px;
  color: var(--text-primary);
  padding: 0 10px;
}
.ext-input::placeholder { color: var(--text-secondary); }
.ext-input::-webkit-search-cancel-button { display: none; }

.ext-submit {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
  transition: color .15s ease, background .15s ease;
}
.ext-submit:hover { color: var(--accent); background: var(--accent-light); }
.ext-submit svg { width: 15px; height: 15px; }

@media (max-width: 1500px) {
  .ext-input { width: 120px; }
}
@media (max-width: 1360px) {
  .ext-input { width: 100px; }
}
@media (max-width: 1300px) {
  .ext-input { width: 80px; }
}
@media (max-width: 768px) {
  .ext-search { width: 100%; }
  .ext-input { width: auto; }
}
</style>