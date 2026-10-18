<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div ref="panelRef" class="modal" role="dialog" aria-modal="true" aria-labelledby="edit-site-title">
      <div class="modal-header">
        <h3 id="edit-site-title">编辑站点</h3>
        <button class="modal-close" @click="$emit('close')" aria-label="关闭">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <form @submit.prevent="submit" class="modal-body">
        <div class="form-group">
          <label>站点名称</label>
          <input type="text" v-model="form.name" required placeholder="例如: ChatGPT" class="form-input">
        </div>
        <div class="form-group">
          <label>网址</label>
          <div class="url-row">
            <input type="url" v-model="form.url" required placeholder="例如: https://chat.openai.com" class="form-input" @blur="autoCompleteUrl">
            <button type="button" class="btn btn-small" :disabled="refreshing" @click="refreshAll">
              {{ refreshing ? '获取中…' : '重新获取信息' }}
            </button>
          </div>
          <div v-if="refreshNote" class="status-line" :class="refreshKind">
            <span class="status-dot"></span>
            <span>{{ refreshNote }}</span>
          </div>
          <div class="field-note">按网址重新抓取名称、描述与图标；别名、用途、分类不会被改动</div>
        </div>
        <div class="form-group">
          <label>描述</label>
          <textarea v-model="form.desc" required placeholder="一句话描述这个站点..." class="form-input form-textarea" rows="3"></textarea>
        </div>
        <div class="form-group">
          <label>别名 <span class="hint">（俗称 / 曾用名 / 缩写，逗号分隔）</span></label>
          <input type="text" v-model="form.aliases" placeholder="例如: 币安、Binance" class="form-input">
        </div>
        <div class="form-group">
          <label>用途 <span class="hint">（最多 {{ MAX_PURPOSES }} 个，可多选）</span></label>
          <PurposePicker :model-value="form.purposes" @update:model-value="form.purposes = normalizePurposes($event)" />
        </div>
        <div class="form-group">
          <label>分类</label>
          <select v-model="form.categoryId" required class="form-input">
            <option v-for="cat in categoriesStore.categories" :key="cat.id" :value="cat.id">{{ cat.label }}</option>
          </select>
        </div>
        <div class="form-group">
          <label>颜色</label>
          <div class="color-picker-row">
            <input type="color" v-model="form.color" class="color-input">
            <span class="color-hex">{{ form.color }}</span>
          </div>
        </div>
        <div class="form-group">
          <label>状态 <span class="hint">（两条都与「删除」不同：站还在，只是换个位置）</span></label>
          <div class="flag-row">
            <label class="flag-item">
              <input type="checkbox" v-model="form.pinned">
              <span>置顶</span>
            </label>
            <label class="flag-item">
              <input type="checkbox" v-model="form.archived">
              <span>归档</span>
            </label>
          </div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-cancel" @click="$emit('close')">取消</button>
          <button type="submit" class="btn btn-primary">保存修改</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { reactive, onMounted, ref } from 'vue'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'
import PurposePicker from '@/components/PurposePicker.vue'
import { normalizePurposes, MAX_PURPOSES } from '../../shared/purposes.mjs'
// 编辑字段的归一（域名 / 别名 / 空用途 / initial）与右边栏的内联编辑共用一份，避免两个入口漂移
import { siteToForm, buildSitePatch } from '../../shared/site-edit.mjs'
import { useFocusTrap } from '@/composables/useFocusTrap'

const props = defineProps({
  site: { type: Object, required: true }
})

const emit = defineEmits(['close', 'saved'])
const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()

const form = reactive({
  name: '',
  url: '',
  desc: '',
  categoryId: 'ai',
  color: '#3b82f6',
  aliases: '',
  purposes: [],
  pinned: false,
  archived: false
})

// 焦点陷阱：与添加弹窗同构 —— 挂载即显示，卸载时 composable 自动归还焦点
const panelRef = ref(null)
const trap = useFocusTrap(panelRef)

onMounted(() => {
  trap.activate()
  // 初值改由 siteToForm 提供：右边栏的内联编辑必须与本弹窗「打开时看到同一份东西」，
  // 两处各写一遍必然漂移（别名分隔符、purposes 归一、pinned 的 === true 判定都容易漏）
  Object.assign(form, siteToForm(props.site))
})

function autoCompleteUrl() {
  if (form.url && !form.url.startsWith('http://') && !form.url.startsWith('https://')) {
    form.url = 'https://' + form.url
  }
}

function submit() {
  // 落库 patch 由 buildSitePatch 统一构造 —— 与右边栏内联编辑是同一份实现，
  // 「域名怎么取、别名怎么切、空用途传什么」只在一处定义
  const patch = buildSitePatch(form)
  sitesStore.updateSite(props.site.id, patch)
  emit('saved', { name: patch.name, url: patch.url })
  emit('close')
}

/* ---- 重新获取信息 ---- */

const refreshing = ref(false)
const refreshNote = ref('')
const refreshKind = ref('')

async function refreshAll() {
  if (refreshing.value) return
  refreshing.value = true
  refreshNote.value = ''
  try {
    // 动态取：这条链路只在用户点按钮时才走得到，静态引入会让它常驻首屏图
    const { refreshSiteMeta } = await import('@/services/siteRefresh')
    const r = await refreshSiteMeta({
      site: props.site,
      update: (p) => sitesStore.updateSite(props.site.id, p),
    })
    if (!r.ok) {
      refreshKind.value = 'warn'
      refreshNote.value = `获取失败：${r.message}`
      return
    }
    if (!r.changed) {
      refreshKind.value = 'ok'
      refreshNote.value = '已是最新，无需更新'
      return
    }
    /**
     * 抓到的值已经写进库里，**表单必须跟着同步** —— 否则用户眼前还是旧名称，
     * 一按「保存修改」就把刚抓到的东西原样覆盖回去（刷新等于白做）。
     */
    const fresh = sitesStore.sites.find(s => s.id === props.site.id)
    if (fresh) Object.assign(form, siteToForm(fresh))
    refreshKind.value = 'ok'
    refreshNote.value = `已更新：${r.fields.join('、')}`
  } finally {
    refreshing.value = false
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal-sm);
}
.modal {
  background: var(--bg-white);
  border-radius: 12px;
  width: 440px;
  max-width: 90vw;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0,0,0,.2);
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 0;
}
.modal-header h3 { font-size: 16px; font-weight: 600; }
.modal-close {
  width: 32px; height: 32px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
}
.modal-close:hover { background: var(--border-light); }
.modal-close svg { width: 18px; height: 18px; }
.modal-body { padding: 20px 24px 24px; }
.form-group { margin-bottom: 16px; }
.form-group label { display: block; font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 6px; }
.form-group label .hint { font-weight: 400; font-size: 12px; color: var(--text-secondary); }
.form-input {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-family: var(--font);
  color: var(--text-primary);
  background: var(--bg-white);
  outline: none;
  transition: border-color var(--dur-fast) ease;
}
.form-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-light); }
.form-textarea { resize: vertical; min-height: 60px; }
.color-picker-row { display: flex; align-items: center; gap: 10px; }
.color-input { width: 36px; height: 36px; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; padding: 2px; }
.flag-row { display: flex; gap: 18px; align-items: center; }
.flag-item { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-primary); cursor: pointer; }
.flag-item input { width: 15px; height: 15px; accent-color: var(--accent); cursor: pointer; }
.color-hex { font-size: 13px; color: var(--text-secondary); font-family: monospace; }
.form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.btn {
  padding: 8px 20px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all var(--dur-fast) ease;
}
.btn-cancel { background: var(--border-light); color: var(--text-secondary); }
.btn-cancel:hover { background: var(--border); }
.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover { filter: brightness(1.1); }

/* 「重新获取信息」这一组：取值对齐 AddSiteModal 的同类控件（那边有「自动补全」按钮），
   两处观感必须一致 —— 它们做的是同一件事，只是入口不同。 */
.url-row { display: flex; align-items: center; gap: 8px; }
.url-row .form-input { flex: 1; min-width: 0; }
.btn-small {
  padding: 4px 12px;
  font-size: 11px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-white);
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
}
.btn-small:hover { border-color: var(--accent); color: var(--accent); }
.btn-small:disabled { opacity: .5; cursor: not-allowed; }
.status-line { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 12px; }
.status-line.ok { color: #047857; }
.status-line.warn { color: #b45309; }
.status-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
.field-note { margin-top: 4px; font-size: 11px; color: var(--text-secondary); }
</style>