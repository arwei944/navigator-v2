<template>
  <section class="settings-section">
    <div class="section-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
      <span>右边栏（站点详情）</span>
    </div>

    <!-- 显示时机 -->
    <div class="setting-row">
      <div class="setting-label">显示时机</div>
      <div class="theme-toggle-wrapper">
        <button v-for="m in modeOptions" :key="m.id" class="theme-toggle-btn"
                :class="{ active: prefs.rightPanelMode === m.id }"
                :title="m.hint" @click="prefs.setRightPanelMode(m.id)">{{ m.label }}</button>
      </div>
    </div>
    <div class="section-note">{{ currentModeHint }}</div>

    <!-- 折叠策略 -->
    <div class="setting-row">
      <div class="setting-label">进入页面时</div>
      <select v-model="collapseValue" class="setting-select" @change="prefs.setRightCollapsePolicy(collapseValue)">
        <option v-for="p in collapseOptions" :key="p.id" :value="p.id">{{ p.label }}</option>
      </select>
    </div>
    <div class="section-note">{{ currentCollapseHint }}</div>

    <!-- 宽度 -->
    <div class="setting-row">
      <div class="setting-label">面板宽度</div>
      <div class="width-row">
        <span class="width-value">{{ sidebar.rightWidth }} px</span>
        <button class="mini-btn" :disabled="sidebar.rightWidth === DEFAULT_RIGHT_WIDTH"
                title="恢复为出厂宽度" @click="sidebar.setRightWidth(DEFAULT_RIGHT_WIDTH)">重置</button>
      </div>
    </div>
    <div class="section-note">宽度也可以直接拖拽面板左边缘调整。</div>

    <!-- 区块显隐 -->
    <div class="section-header sub">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      <span>详细区块</span>
    </div>
    <div v-for="s in sectionOptions" :key="s.key" class="setting-row">
      <label class="setting-toggle">
        <span class="setting-label">{{ s.label }}</span>
        <input type="checkbox" :checked="prefs.activeRightSections[s.key]"
               @change="prefs.setRightSection(s.key, $event.target.checked)" />
        <span class="toggle-track"><span class="toggle-thumb"></span></span>
      </label>
    </div>
    <div class="section-note">
      关掉只是不再显示，数据仍然保留（没有内容的区块本来就不会渲染）。
      头部与分类标签不可关 —— 关掉面板就没有主体了。
    </div>
    <div class="setting-row">
      <button class="mini-btn" :disabled="allSectionsDefault" @click="prefs.resetRightSections()">全部恢复默认</button>
    </div>

    <!-- 编辑入口：只做说明，不引入开关 —— 关掉它只会让人找不到编辑在哪 -->
    <div class="section-header sub">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      <span>编辑站点</span>
    </div>
    <div class="section-note">
      详情面板右上角的铅笔按钮即可就地修改名称、网址、简介、分类、别名与用途。
      颜色、置顶与归档仍在卡片右键菜单的「编辑」里（那些是批量操作的同一批字段）。
    </div>
  </section>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import {
  usePreferencesStore, DEFAULT_RIGHT_SECTIONS, RIGHT_COLLAPSE_POLICIES
} from '@/stores/preferences'
import { useSidebarStore, DEFAULT_RIGHT_WIDTH } from '@/stores/sidebar'

const prefs = usePreferencesStore()
const sidebar = useSidebarStore()

/* 文案放在组件里而不是 store：store 不带文案，将来换措辞也不用动状态层。
   与「显示时机」的取值表一一对应（取值本身来自 shared/right-panel.mjs）。 */
const modeOptions = [
  { id: 'hover', label: '悬停预览', hint: '鼠标移到卡片上就显示，移开保留' },
  { id: 'click', label: '点击驱动', hint: '不响应悬停，只有右键「查看详情」才切换' },
  { id: 'pin', label: '图钉固定', hint: '不响应悬停，右键「查看详情」钉住 / 再点一次拔掉' },
]
const collapseOptions = [
  { id: 'always-expand', label: '展开详情面板' },
  { id: 'remember', label: '记住上次的折叠状态' },
  { id: 'always-collapse', label: '折叠（按需展开）' },
]

const currentModeHint = computed(() => modeOptions.find(m => m.id === prefs.rightPanelMode)?.hint || '')
const currentCollapseHint = computed(() => {
  const id = prefs.rightCollapsePolicy
  if (id === 'remember') return '下次打开时保持你上次的折叠状态。'
  if (id === 'always-collapse') return '每次都先折叠 —— 把右边栏当"按需查看"用。'
  return '每次都展开，不记折叠状态（与旧行为一致）。'
})

const sectionOptions = [
  { key: 'desc', label: '简介' },
  { key: 'aliases', label: '别名' },
  { key: 'purposes', label: '用途' },
  { key: 'note', label: '备注' },
  { key: 'stats', label: '使用统计' },
  { key: 'timeline', label: '时间线' },
  { key: 'related', label: '相关站点' },
  { key: 'actions', label: '快速操作' },
]

// 折叠策略用 select，需要一个本地 ref 承接 v-model（直接绑 store 的 ref 也行，
// 但这里走 setter 是为了让"非法值不落地"这条规则收在 store 里）
const collapseValue = ref(prefs.rightCollapsePolicy)
watch(() => prefs.rightCollapsePolicy, v => { collapseValue.value = v })

// 与「重置」按钮的 disabled 判定同源：拿真实值逐个比，别用 JSON 字符串比
const allSectionsDefault = computed(() =>
  Object.keys(DEFAULT_RIGHT_SECTIONS).every(k => prefs.activeRightSections[k] === DEFAULT_RIGHT_SECTIONS[k])
)

// 守卫：设置面板与 store 的策略取值表必须同源，加一项忘了改另一处就会静默漏掉
if (collapseOptions.length !== RIGHT_COLLAPSE_POLICIES.length) {
  console.warn('[RightSidebarSection] 折叠策略选项与 RIGHT_COLLAPSE_POLICIES 数量不一致')
}
</script>

<style scoped>
.settings-section { padding: 16px 0; border-bottom: 1px solid var(--border-light); }
.settings-section:last-child { border-bottom: none; }
.section-header { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 14px; }
.section-header.sub { margin-top: 18px; }
.section-header svg { width: 16px; height: 16px; color: var(--accent); opacity: 0.8; }
.setting-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; gap: 16px; }
.setting-label { font-size: 13px; color: var(--text-secondary); white-space: nowrap; }
.section-note { font-size: 11px; line-height: 1.6; color: var(--text-secondary); opacity: 0.7; padding: 2px 0 4px; }
.theme-toggle-wrapper { display: flex; gap: 4px; background: var(--border-light); padding: 3px; border-radius: 8px; }
.theme-toggle-btn { display: flex; align-items: center; gap: 5px; padding: 5px 10px; border: none; border-radius: 6px; background: transparent; color: var(--text-secondary); font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.15s ease; font-family: var(--font); white-space: nowrap; }
.theme-toggle-btn.active { background: var(--bg-white); color: var(--text-primary); box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.setting-select { padding: 6px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-white); color: var(--text-primary); font-size: 12px; font-family: var(--font); cursor: pointer; outline: none; min-width: 150px; }
.setting-select:focus { border-color: var(--accent); }
.width-row { display: flex; align-items: center; gap: 8px; }
.width-value { font-size: 12px; color: var(--text-primary); font-family: monospace; min-width: 54px; text-align: right; }
.mini-btn { padding: 4px 12px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg-white); color: var(--text-secondary); font-size: 12px; font-family: var(--font); cursor: pointer; transition: all 0.15s ease; }
.mini-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.mini-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.setting-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; cursor: pointer; }
.setting-toggle input { display: none; }
.toggle-track { width: 38px; height: 22px; background: var(--border); border-radius: 11px; position: relative; transition: background 0.2s ease; flex-shrink: 0; }
.setting-toggle input:checked + .toggle-track { background: var(--accent); }
.toggle-thumb { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform 0.2s ease; box-shadow: 0 1px 3px rgba(0,0,0,.15); }
.setting-toggle input:checked + .toggle-track .toggle-thumb { transform: translateX(16px); }
</style>
