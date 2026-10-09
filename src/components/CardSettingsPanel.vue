<template>
  <Teleport to="body">
    <aside class="card-settings" role="dialog" aria-label="卡片设置">
      <header class="cs-head">
        <div class="cs-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          <span>卡片设置</span>
        </div>
        <button class="cs-close" aria-label="关闭卡片设置" @click="close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </header>

      <div class="cs-body">
        <!-- 当前排列方式决定哪些项生效：讲清楚，免得出现「改了没反应」 -->
        <div v-if="modeHint" class="cs-hint">{{ modeHint }}</div>

        <div v-for="g in groups" :key="g.id" class="cs-group">
          <div class="cs-group-title">{{ g.label }}</div>

          <!-- 信息密度不是令牌，属于显示偏好；放在同一组里更容易理解 -->
          <div v-if="g.extra === 'density'" class="cs-row">
            <span class="cs-label">信息密度</span>
            <div class="segmented">
              <button v-for="d in densities" :key="d.id"
                      class="seg-btn" :class="{ active: prefs.cardDensity === d.id }"
                      :title="d.tip" @click="prefs.setCardDensity(d.id)">{{ d.label }}</button>
            </div>
          </div>

          <template v-for="t in rowTokens(g)" :key="t.key">
            <label v-if="t.type === 'toggle'" class="cs-row cs-toggle">
              <span class="cs-label">{{ t.label }}</span>
              <input type="checkbox" :checked="prefs.activeTokens[t.key]"
                     @change="prefs.setVisualToken(t.key, $event.target.checked)">
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
            </label>

            <div v-else-if="t.type === 'select'" class="cs-row">
              <span class="cs-label">{{ t.label }}</span>
              <select class="cs-select" :value="prefs.activeTokens[t.key]"
                      @change="prefs.setVisualToken(t.key, $event.target.value)">
                <option v-for="o in t.options" :key="o" :value="o">{{ (t.optionLabels && t.optionLabels[o]) || o }}</option>
              </select>
            </div>

            <div v-else class="cs-row" :class="{ 'is-inactive': inactive(t.key) }">
              <span class="cs-label">
                {{ t.label }}
                <em v-if="inactive(t.key)" class="cs-inactive-note">当前排列下不生效</em>
              </span>
              <input class="cs-range" type="range" :min="t.min" :max="t.max" :step="t.step"
                     :value="prefs.activeTokens[t.key]"
                     @input="prefs.setVisualToken(t.key, Number($event.target.value))">
              <span class="cs-value">{{ prefs.activeTokens[t.key] }}{{ t.unit }}</span>
            </div>
          </template>
        </div>
      </div>

      <footer class="cs-foot">
        <button class="cs-reset" :disabled="!prefs.isVisualCustomized" @click="prefs.resetVisualTokens()">
          恢复本方案默认
        </button>
        <p class="cs-tip">
          这些选项属于当前的视觉方案「{{ prefs.activeScheme.name }}」，改动会记为微调；
          换方案时会回到新方案的预设（与「视觉方案」里的微调是同一份数据，只是换了个入口）。
        </p>
      </footer>
    </aside>
  </Teleport>
</template>

<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import { usePreferencesStore } from '@/stores/preferences'
import { TOKENS, CARD_PANEL } from '@/utils/visualScheme'

const emit = defineEmits(['close'])
const prefs = usePreferencesStore()

const groups = CARD_PANEL
const densities = [
  { id: 'compact', label: '简洁', tip: '只留图标、名称与域名' },
  { id: 'standard', label: '标准', tip: '名称、域名、描述与用途标签' },
  { id: 'rich', label: '详细', tip: '再加别名、三行描述与「未访问」标记' }
]

const rowTokens = g => g.tokens
  .filter(k => TOKENS[k])
  .map(k => ({ key: k, ...TOKENS[k] }))

const mode = computed(() => prefs.cardLayoutMode)

/** 按当前排列方式说明哪些项在起作用 —— 比让用户自己试要省事 */
const modeHint = computed(() => {
  if (mode.value === 'masonry') {
    return '瀑布流：按「每行卡片数」分栏，卡片描述不再截断、取自然高度，于是高低错落。两点代价要知道 —— ① 阅读顺序变成「逐列自上而下」，与逐行扫不同；② 已自动关闭拖拽排序（分栏后拖拽落点与视觉顺序对不上）。该模式下「卡片最小宽度」不生效。'
  }
  if (mode.value === 'auto') {
    return '自适应宽度：不设固定的每行数量，由容器宽度与「卡片最小宽度」自动决定一行放几张（窗口变窄会自动减列）。该模式下「每行卡片数」不生效。'
  }
  return '固定列数：每行张数由「每行卡片数」决定，卡片宽度均分、行高一致。该模式下「卡片最小宽度」不生效。'
})

function inactive(key) {
  if (key === 'cardMinWidth') return mode.value !== 'auto'
  if (key === 'gridCols') return mode.value === 'auto'
  return false
}

function close() { emit('close') }

function onKeydown(e) { if (e.key === 'Escape') close() }
onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
/* 右侧抽屉而非居中弹窗：调一次就能在左边网格直接看到效果，不用反复开关 */
.card-settings {
  position: fixed;
  top: 0; right: 0; bottom: 0;
  width: 380px;
  max-width: 92vw;
  z-index: 960;
  display: flex;
  flex-direction: column;
  background: var(--bg-white);
  border-left: 1px solid var(--border);
  box-shadow: -12px 0 40px rgba(0, 0, 0, .16);
  animation: cs-in .22s cubic-bezier(.4, 0, .2, 1);
}
@keyframes cs-in { from { transform: translateX(100%); } }
@media (prefers-reduced-motion: reduce) { .card-settings { animation: none; } }

.cs-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 18px 12px; border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.cs-title { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: var(--text-primary); }
.cs-title svg { width: 16px; height: 16px; color: var(--accent); }
.cs-close {
  width: 30px; height: 30px; border: none; border-radius: 8px; background: transparent;
  color: var(--text-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all .15s ease;
}
.cs-close:hover { background: var(--accent-light); color: var(--accent); }
.cs-close svg { width: 16px; height: 16px; }

.cs-body { flex: 1; overflow-y: auto; padding: 14px 18px 8px; }
.cs-hint {
  font-size: 11px; line-height: 1.55; color: var(--text-secondary);
  background: var(--border-light); border-radius: 8px; padding: 9px 11px; margin-bottom: 14px;
}
.cs-group { margin-bottom: 16px; }
.cs-group-title { font-size: 12px; font-weight: 600; color: var(--text-primary); opacity: .75; margin-bottom: 6px; }
.cs-row { display: flex; align-items: center; gap: 10px; padding: 5px 0; }
.cs-label { flex-shrink: 0; width: 96px; font-size: 12px; color: var(--text-secondary); line-height: 1.35; }
.cs-inactive-note { display: block; font-style: normal; font-size: 10px; opacity: .7; }
.is-inactive { opacity: .45; }
.is-inactive .cs-range { cursor: not-allowed; }

.cs-range { flex: 1; min-width: 0; height: 4px; -webkit-appearance: none; appearance: none; background: var(--border); border-radius: 2px; outline: none; cursor: pointer; }
.cs-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 13px; height: 13px; border-radius: 50%; background: var(--accent); border: 2px solid var(--bg-white); box-shadow: 0 1px 3px rgba(0,0,0,.2); cursor: pointer; }
.cs-range::-moz-range-thumb { width: 13px; height: 13px; border-radius: 50%; background: var(--accent); border: 2px solid var(--bg-white); cursor: pointer; }
.cs-value { flex-shrink: 0; width: 46px; text-align: right; font-size: 11px; font-variant-numeric: tabular-nums; color: var(--text-secondary); }
.cs-select { flex: 1; min-width: 0; padding: 5px 8px; border: 1px solid var(--border); border-radius: 7px; background: var(--bg-white); color: var(--text-primary); font-size: 12px; font-family: var(--font); cursor: pointer; outline: none; }
.cs-select:focus { border-color: var(--accent); }

.cs-toggle { cursor: pointer; }
.cs-toggle input { display: none; }
.cs-toggle .cs-label { width: auto; flex: 1; }
.toggle-track { width: 34px; height: 20px; background: var(--border); border-radius: 10px; position: relative; transition: background var(--transition); flex-shrink: 0; }
.cs-toggle input:checked + .toggle-track { background: var(--accent); }
.toggle-thumb { position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: #fff; transition: transform var(--transition); box-shadow: 0 1px 3px rgba(0,0,0,.15); }
.cs-toggle input:checked + .toggle-track .toggle-thumb { transform: translateX(14px); }

.segmented { display: flex; gap: 3px; background: var(--border-light); padding: 3px; border-radius: 8px; }
.seg-btn { padding: 4px 10px; border: none; border-radius: 6px; background: transparent; color: var(--text-secondary); font-size: 12px; font-weight: 500; font-family: var(--font); cursor: pointer; transition: all var(--transition); }
.seg-btn.active { background: var(--bg-white); color: var(--text-primary); box-shadow: 0 1px 3px rgba(0,0,0,.08); }

.cs-foot { flex-shrink: 0; padding: 12px 18px 16px; border-top: 1px solid var(--border); }
.cs-reset {
  width: 100%; padding: 8px; font-size: 12px; font-weight: 500; font-family: var(--font);
  border: 1px solid var(--border); border-radius: 8px; background: var(--bg-white);
  color: var(--text-primary); cursor: pointer; transition: all .15s ease;
}
.cs-reset:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.cs-reset:disabled { opacity: .45; cursor: not-allowed; }
.cs-tip { font-size: 10px; line-height: 1.5; color: var(--text-secondary); opacity: .8; margin-top: 9px; }

@media (max-width: 768px) {
  .card-settings { width: 100%; max-width: 100%; }
  .cs-label { width: 84px; }
}
</style>
