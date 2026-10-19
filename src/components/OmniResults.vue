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
          :class="{ active: flatIndex(group.type, i) === selectedIndex, danger: item.danger, 'is-preview': Boolean(item.preview) }"
          :data-idx="flatIndex(group.type, i)"
          @click="emit('select', item)"
          @mouseenter="emit('hover', flatIndex(group.type, i))"
        >
          <!-- 网址预览卡片：图标 + 站名 + 描述 + 域名，一张卡说清这个网址是什么。
               数据与状态判定都在 utils/urlPreview.js，这里只渲染。
               图标区与文本区各自成链 —— 文本区若用无条件 div，卡片会和下面的通用文本
               同时渲染，标题与副标题各出现两次（真机截图逮到的）。 -->
          <span v-if="item.preview && item.preview.card" class="preview-icon"
                :style="{ background: item.preview.card.color }">
            <!-- 字母块**先渲染**、favicon 绝对定位盖上去 —— 与下面站点图标的做法一致。
                 若写成 v-if / v-else 互斥，图片加载失败被 @error 移除后就什么都不剩，
                 图标区留一个空框（线上真机截图逮到过）。层叠模式下失败即自然露出字母块。 -->
            <span class="preview-initial">{{ item.preview.card.initial || '·' }}</span>
            <img v-if="item.preview.card.iconUrl" :src="item.preview.card.iconUrl"
                 :alt="item.preview.card.title || item.preview.card.host"
                 class="preview-favicon" loading="lazy" @error="$event.target.remove()">
          </span>
          <!-- 站点：用站点自己的图标 -->
          <span v-else-if="item.site" class="omni-site-icon" :style="{ background: item.site.color }">
            <span class="omni-favicon-fallback">{{ item.site.initial }}</span>
            <img v-if="item.site.icon" :src="'/' + item.site.icon" :alt="item.site.name"
                 class="omni-favicon-img" loading="lazy" @error="$event.target.remove()">
          </span>
          <!-- 分类 / 用途：彩色圆点 -->
          <span v-else-if="item.icon === 'dot'" class="omni-dot" :style="item.dotColor ? { background: item.dotColor } : {}"></span>
          <OmniIcon v-else :name="item.icon" />

          <div v-if="item.preview && item.preview.card" class="omni-item-info">
            <span class="omni-item-title">{{ item.preview.card.titleTranslated || item.preview.card.title }}<span
              v-if="item.preview.card.titleTranslated" class="preview-badge translated" title="名称已译为中文">译</span><span
              v-if="item.preview.kind === 'found'" class="preview-badge found">已收录</span><span
              v-else-if="item.preview.kind === 'loading'" class="preview-badge loading">抓取中</span><span
              v-else-if="item.preview.kind === 'error'" class="preview-badge error">抓取失败</span></span>
            <span v-if="item.preview.kind === 'error'" class="preview-desc">{{ item.preview.message }}</span>
            <span v-else-if="item.preview.card.descTranslated || item.preview.card.desc" class="preview-desc">{{ item.preview.card.descTranslated || item.preview.card.desc }}</span>
            <!-- 「收在哪、用它干什么、去过没有」：已收录时才有的半句，未收录这几项为空 -->
            <span class="preview-meta">
              <span class="preview-host">{{ item.preview.card.host }}</span>
              <span v-if="item.preview.card.categoryLabel" class="preview-cat">
                <i class="preview-cat-dot" :style="{ background: item.preview.card.categoryColor }"></i>{{ item.preview.card.categoryLabel }}
              </span>
              <span v-for="p in item.preview.card.purposes" :key="p" class="preview-tag">{{ p }}</span>
              <span v-if="item.preview.card.visitCount > 0" class="preview-visits">访问 {{ item.preview.card.visitCount }} 次</span>
            </span>
          </div>
          <div v-else class="omni-item-info">
            <span class="omni-item-title"><template
              v-for="(seg, si) in splitHighlight(item.title, query)" :key="'t' + si"
            ><mark v-if="seg.hit">{{ seg.text }}</mark><template v-else>{{ seg.text }}</template></template><span
              v-if="aliasOf(item)" class="omni-item-alias">别名 · {{ aliasOf(item) }}</span><span
              v-if="item.frequent" class="omni-item-freq">常访问</span><span
              v-if="item.phrase" class="omni-item-phrase">猜的</span></span>
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
/* 「常访问」：搜索排序被加权时把它标出来 —— 顺序变了却不说原因，等于悄悄骗人 */
.omni-item-freq { margin-left: 6px; font-size: 11px; font-weight: 500; color: var(--color-heat-warm); background: var(--color-heat-warm-bg); padding: 1px 6px; border-radius: 8px; }
/* 自然语言命中：明说这是系统猜的，不是用户搜出来的 —— 猜错时用户知道该按 ↓ 让位 */
.omni-item-phrase { margin-left: 6px; font-size: 11px; font-weight: 500; color: var(--accent); background: var(--accent-light); padding: 1px 6px; border-radius: 8px; }
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
  color: var(--on-accent);
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

/* ---- 网址预览卡片 ----
   比普通结果行高一档：它是「这个网址是什么」，不是一条匹配结果，
   所以图标更大、多了描述与域名，用户不点也能判断要不要收录。 */
.omni-item.is-preview { padding: 10px 14px; gap: 12px; align-items: flex-start; }
.preview-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--on-accent);
  font-size: 15px;
  font-weight: 700;
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
}
.preview-initial { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
.preview-favicon {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 3px;
  background: #fff;
  box-sizing: border-box;
}
.preview-desc {
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: normal;
}
.preview-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--text-secondary);
  min-width: 0;
}
.preview-host {
  flex: 0 1 auto;
  min-width: 0;
  opacity: .7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.preview-cat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--border-light);
  white-space: nowrap;
}
.preview-cat-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--text-secondary);
}
.preview-tag {
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--border-light);
  white-space: nowrap;
}
.preview-visits { opacity: .7; white-space: nowrap; }
.preview-badge {
  margin-left: 6px;
  font-size: 10px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 8px;
  white-space: nowrap;
  flex-shrink: 0;
}
.preview-badge.found { color: var(--color-ok, #16a34a); background: rgba(22, 163, 74, .12); }
.preview-badge.loading { color: var(--accent); background: var(--accent-light); }
.preview-badge.error { color: var(--color-danger); background: rgba(220, 38, 38, .1); }
.preview-badge.translated { color: var(--accent); background: var(--accent-light); }
/* 抓取中的转圈：只动 transform，动画时钟不推进时也只是不转，不会定格成透明 */
.preview-badge.loading::before {
  content: '';
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 4px;
  vertical-align: 1px;
  border: 1.5px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: preview-spin .8s linear infinite;
}
@keyframes preview-spin { to { transform: rotate(360deg); } }

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
