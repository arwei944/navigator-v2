<template>
  <div class="google-search">
    <form class="google-search-inner" :action="currentEngine.url" method="GET" target="_blank" rel="noopener noreferrer">
      <span class="google-search-icon" aria-hidden="true">
        <!-- Google 彩色图标 -->
        <svg v-if="preferencesStore.searchEngine === 'google'" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path class="g-blue" d="M10.364 3.333c-3.98 0-7.227 3.2-7.227 7.147s3.247 7.147 7.227 7.147c2.087 0 3.707-.693 4.94-1.853 1.2-1.08 1.88-2.6 1.88-4.4 0-.427-.04-.84-.107-1.227h-6.68v2.653h3.747c-.16 1.04-.64 1.84-1.333 2.4-.787.627-1.813.96-3.12.96-2.453 0-4.453-2.027-4.453-4.48s2-4.48 4.453-4.48c1.334 0 2.467.48 3.333 1.307l1.88-1.84c-1.2-1.12-2.8-1.813-4.667-1.813z"/>
          <path class="g-red" d="M21.427 12.373c-.053-.24-.107-.507-.107-.84 0-.293-.027-.587-.08-.88H11.89v1.893h5.547c-.24 1.28-1.013 2.04-1.96 2.613-.56.347-1.28.587-2.147.587-1.76 0-3.28-.933-4.093-2.267l-2.04 1.56c1.067 1.64 2.933 2.747 5.133 2.747 1.627 0 3.067-.533 4.08-1.493 1.027-.973 1.627-2.4 1.627-4.16 0-.4-.027-.8-.08-1.16z"/>
          <path class="g-yellow" d="M5.8 14.933c-.4-.8-.64-1.68-.64-2.613 0-.933.24-1.813.64-2.613l-2.04-1.56C2.733 9.24 2.3 10.56 2.3 12c0 1.44.433 2.76 1.16 3.853z"/>
          <path class="g-green" d="M10.364 15.48c.867 0 1.587-.24 2.147-.587l-2.04-1.587c-.693.48-1.533.773-2.453.773-1.76 0-3.32-1.2-3.867-2.84l-2.04 1.56c.813 1.333 2.333 2.267 4.093 2.267 1.12 0 2.16-.293 3.16-.853z"/>
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </span>
      <input type="text" class="google-search-input" v-model="query" name="q"
             :placeholder="'在 ' + currentEngine.label + ' 上搜索...'" aria-label="搜索引擎搜索">
      <button type="submit" class="google-search-btn">搜索</button>
    </form>
    <div class="engine-switcher">
      <span v-for="engine in preferencesStore.engines" :key="engine.id"
            class="engine-tag" :class="{ active: preferencesStore.searchEngine === engine.id }"
            @click="preferencesStore.setSearchEngine(engine.id)">
        {{ engine.label }}
      </span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { usePreferencesStore } from '@/stores/preferences'

const preferencesStore = usePreferencesStore()
const query = ref('')

const currentEngine = computed(() => preferencesStore.getCurrentEngine())
</script>

<style scoped>
.google-search {
  padding: 16px 28px 0;
  flex-shrink: 0;
}
.google-search-inner {
  display: flex;
  align-items: center;
  gap: 0;
  background: var(--bg-white);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  height: 44px;
  transition: all .2s ease;
  max-width: 600px;
  margin: 0 auto;
}
.google-search-inner:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-light);
}
.google-search-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 0 0 14px;
  flex-shrink: 0;
}
.google-search-icon svg { width: 18px; height: 18px; }
.g-blue { fill: #4285f4; }
.g-red { fill: #ea4335; }
.g-yellow { fill: #fbbc05; }
.g-green { fill: #34a853; }
.google-search-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-family: var(--font);
  font-size: 14px;
  color: var(--text-primary);
  padding: 0 12px;
  height: 100%;
}
.google-search-input::placeholder { color: var(--text-secondary); }
.google-search-btn {
  height: 32px;
  padding: 0 18px;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #fff;
  font-family: var(--font);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all .15s ease;
  margin: 0 6px;
  flex-shrink: 0;
  white-space: nowrap;
}
.google-search-btn:hover { filter: brightness(1.1); box-shadow: 0 2px 8px rgba(37,99,235,.3); }
.google-search-btn:active { transform: scale(.97); }
.engine-switcher {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin-top: 8px;
}
.engine-tag {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 20px;
  cursor: pointer;
  color: var(--text-secondary);
  background: var(--border-light);
  transition: all .15s ease;
  font-weight: 500;
}
.engine-tag:hover { color: var(--accent); }
.engine-tag.active { background: var(--accent-light); color: var(--accent); font-weight: 600; }
</style>