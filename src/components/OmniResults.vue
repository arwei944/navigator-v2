<template>
  <div class="omni-results" ref="wrapEl">
    <!-- 二级页：站点操作 -->
    <div v-if="breadcrumb" class="omni-crumb" @click="emit('back')">
      <svg class="omni-crumb-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      <span class="omni-crumb-text">{{ breadcrumb }}</span>
      <span class="omni-crumb-hint">退格返回</span>
    </div>

    <template v-for="group in groups" :key="group.type">
      <div class="omni-group">
        <div class="omni-group-label">{{ group.label }}</div>
        <div
          v-for="(item, i) in group.items"
          :key="item.key"
          class="omni-item"
          :class="{ active: flatIndex(group.type, i) === selectedIndex, danger: item.danger }"
          :data-idx="flatIndex(group.type, i)"
          @click="emit('select', item)"
          @mouseenter="emit('hover', flatIndex(group.type, i))"
        >
          <!-- 站点：用站点自己的图标 -->
          <span v-if="item.site" class="omni-site-icon" :style="{ background: item.site.color }">
            <span class="omni-favicon-fallback">{{ item.site.initial }}</span>
            <img v-if="item.site.icon" :src="'/' + item.site.icon" :alt="item.site.name"
                 class="omni-favicon-img" loading="lazy" @error="$event.target.remove()">
          </span>
          <!-- 分类 / 用途：彩色圆点 -->
          <span v-else-if="item.icon === 'dot'" class="omni-dot" :style="item.dotColor ? { background: item.dotColor } : {}"></span>
          <OmniIcon v-else :name="item.icon" />

          <div class="omni-item-info">
            <span class="omni-item-title"><template
              v-for="(seg, si) in splitHighlight(item.title, query)" :key="'t' + si"
            ><mark v-if="seg.hit">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template><span
              v-if="aliasOf(item)" class="omni-item-alias">别名 · {{ aliasOf(item) }}</span></span>
            <span v-if="item.subtitle" class="omni-item-sub"><template
              v-for="(seg, si) in splitHighlight(item.subtitle, query)" :key="'s' + si"
            ><mark v-if="seg.hit">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template></span>
          </div>

          <kbd v-if="!breadcrumb && item.site" class="omni-item-key">⇥</kbd>
        </div>
      </div>
    </template>

    <div v-if="empty" class="omni-empty">没有找到匹配结果</div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import OmniIcon from '@/components/OmniIcon.vue'
import { splitHighlight, matchedAlias } from '@/utils/search'

const props = defineProps({
  groups: { type: Array, default: () => [] },
  selectedIndex: { type: Number, default: 0 },
  query: { type: String, default: '' },
  breadcrumb: { type: String, default: '' },
  empty: { type: Boolean, default: false }
})
const emit = defineEmits(['select', 'hover', 'back'])

const wrapEl = ref(null)

/** 组 type + 组内序号 → 全局扁平序号（键盘导航用扁平序号） */
function flatIndex(groupType, i) {
  let offset = 0
  for (const g of props.groups) {
    if (g.type === groupType) return offset + i
    offset += g.items.length
  }
  return offset + i
}

function aliasOf(item) {
  if (!item.site) return ''
  return matchedAlias(item.site, props.query)
}

// 键盘走到视野外时把选中项滚回来
watch(() => props.selectedIndex, async (v) => {
  await nextTick()
  const el = wrapEl.value?.querySelector(`[data-idx="${v}"]`)
  el?.scrollIntoView({ block: 'nearest' })
})
</script>

<style scoped>
.omni-results {
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 4px 0;
  flex: 1;
  min-height: 0;
}
.omni-results::-webkit-scrollbar { width: 5px; }
.omni-results::-webkit-scrollbar-track { background: transparent; }
.omni-results::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }

/* 二级页面包屑：整条可点，返回 root */
.omni-crumb {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border-light);
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
}
.omni-crumb:hover { color: var(--accent); }
.omni-crumb-arrow { width: 14px; height: 14px; flex-shrink: 0; }
.omni-crumb-text { font-weight: 600; color: var(--text-primary); }
.omni-crumb-hint { margin-left: auto; opacity: .7; }

.omni-group { padding: 4px 0; }
.omni-group + .omni-group { border-top: 1px solid var(--border-light); }
.omni-group-label {
  font-size: 11px;
  font-weight: 600;
  padding: 8px 14px 4px;
  color: var(--text-secondary);
}

.omni-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
  transition: background var(--transition), color var(--transition);
}
.omni-item:hover, .omni-item.active { background: var(--accent-light); color: var(--accent); }
.omni-item.danger:hover, .omni-item.danger.active { color: var(--color-danger); }

.omni-item-info { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.omni-item-title {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.omni-item-alias { color: var(--accent); font-weight: 500; margin-left: 6px; font-size: 11px; }
.omni-item-sub {
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.omni-item-key {
  font-size: 10px;
  padding: 1px 5px;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-secondary);
  background: var(--border-light);
  font-family: inherit;
  line-height: 1.4;
  flex-shrink: 0;
  opacity: 0;
}
.omni-item.active .omni-item-key { opacity: .8; }

.omni-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  margin: 0 3px;
  background: transparent;
  box-shadow: inset 0 0 0 1.5px var(--text-secondary);
  opacity: .55;
}

.omni-site-icon {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
}
.omni-favicon-fallback { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
.omni-favicon-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 1px;
  background: #fff;
  box-sizing: border-box;
}

.omni-empty {
  text-align: center;
  padding: 28px 16px;
  color: var(--text-secondary);
  font-size: 13px;
}

:deep(mark) {
  background: #fef08a;
  color: inherit;
  padding: 0 2px;
  border-radius: 2px;
}
[data-theme="dark"] :deep(mark) {
  background: #854d0e;
  color: #fef9c3;
}
</style>
