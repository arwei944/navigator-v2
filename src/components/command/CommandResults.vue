<template>
  <div class="cp-results" v-if="query">
    <div
      v-for="group in groups"
      :key="group.type"
      class="cp-group"
    >
      <div class="cp-group-label">{{ group.label }}</div>
      <template v-for="(item, i) in group.items" :key="group.type + i">
        <!-- 页面 / 操作 -->
        <div
          v-if="group.type === 'page' || group.type === 'action'"
          class="cp-item"
          :class="{ active: getIndex(group.type, i) === selectedIndex }"
          @click="emit('select', item)"
          @mouseenter="emit('hover', getIndex(group.type, i))"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <template v-if="item.icon === 'home'">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </template>
            <template v-else-if="item.icon === 'settings'">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </template>
            <template v-else-if="item.icon === 'sun'">
              <circle cx="12" cy="12" r="5"/>
              <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
              <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </template>
            <template v-else-if="item.icon === 'moon'">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </template>
            <template v-else-if="item.icon === 'keyboard'">
              <rect x="2" y="4" width="20" height="16" rx="2" ry="2"/>
              <line x1="6" y1="8" x2="6.01" y2="8"/><line x1="10" y1="8" x2="10.01" y2="8"/>
              <line x1="14" y1="8" x2="14.01" y2="8"/><line x1="18" y1="8" x2="18.01" y2="8"/>
              <line x1="6" y1="12" x2="6.01" y2="12"/><line x1="10" y1="12" x2="10.01" y2="12"/>
              <line x1="14" y1="12" x2="14.01" y2="12"/><line x1="18" y1="12" x2="18.01" y2="12"/>
              <line x1="6" y1="16" x2="18" y2="16"/>
            </template>
          </svg>
          <span>{{ item.name }}</span>
        </div>
        <!-- 分类 -->
        <div
          v-else-if="group.type === 'category'"
          class="cp-item"
          :class="{ active: getIndex(group.type, i) === selectedIndex }"
          @click="emit('select', item)"
          @mouseenter="emit('hover', getIndex(group.type, i))"
        >
          <span class="cp-dot" :style="{ background: item.dotColor }"></span>
          <span>{{ item.label }}</span>
        </div>
        <!-- 站点 -->
        <div
          v-else
          class="cp-item"
          :class="{ active: getIndex(group.type, i) === selectedIndex }"
          @click="emit('select', item)"
          @mouseenter="emit('hover', getIndex(group.type, i))"
        >
          <span class="cp-site-icon" :style="{ background: item.color }">
            <span class="favicon-fallback">{{ item.initial }}</span>
            <img v-if="item.icon" :src="'/' + item.icon" :alt="item.name" class="favicon-img" loading="lazy" @error="$event.target.remove()">
          </span>
          <div class="cp-site-info">
            <span class="cp-site-name">{{ item.name }}</span>
            <span class="cp-site-url">{{ item.url }}</span>
          </div>
        </div>
      </template>
    </div>
    <div v-if="noResults" class="cp-empty">没有找到匹配结果</div>
  </div>
</template>

<script setup>
defineProps({
  query: { type: String, default: '' },
  groups: { type: Array, default: () => [] },
  selectedIndex: { type: Number, default: 0 },
  noResults: { type: Boolean, default: false },
  getIndex: { type: Function, required: true }
})
const emit = defineEmits(['select', 'hover'])
</script>

<style scoped>
.cp-results { overflow-y: auto; max-height: 50vh; padding: 4px 0; flex: 1; }
.cp-results::-webkit-scrollbar { width: 5px; }
.cp-results::-webkit-scrollbar-track { background: transparent; }
.cp-results::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
.cp-group { padding: 4px 0; }
.cp-group + .cp-group { border-top: 1px solid var(--border-light); }
.cp-group-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; padding: 8px 16px 4px; color: var(--text-secondary); }
.cp-item { display: flex; align-items: center; gap: 10px; padding: 8px 16px; cursor: pointer; font-size: 13px; transition: background var(--transition), color var(--transition); color: var(--text-primary); }
.cp-item:hover, .cp-item.active { background: var(--accent-light); color: var(--accent); }
.cp-item svg { width: 16px; height: 16px; flex-shrink: 0; }
.cp-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.cp-site-icon { width: 24px; height: 24px; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; color: #fff; font-size: 11px; font-weight: 700; flex-shrink: 0; position: relative; overflow: hidden; }
.favicon-fallback { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
.favicon-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; padding: 1px; background: #fff; box-sizing: border-box; }
.cp-site-info { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.cp-site-name { font-size: 13px; font-weight: 500; line-height: 1.3; }
.cp-site-url { font-size: 11px; color: var(--text-secondary); line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-empty { text-align: center; padding: 32px 16px; color: var(--text-secondary); font-size: 14px; }
</style>