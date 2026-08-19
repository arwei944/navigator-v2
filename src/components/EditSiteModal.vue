<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-header">
        <h3>编辑站点</h3>
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
          <input type="url" v-model="form.url" required placeholder="例如: https://chat.openai.com" class="form-input" @blur="autoCompleteUrl">
        </div>
        <div class="form-group">
          <label>描述</label>
          <textarea v-model="form.desc" required placeholder="一句话描述这个站点..." class="form-input form-textarea" rows="3"></textarea>
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
        <div class="form-actions">
          <button type="button" class="btn btn-cancel" @click="$emit('close')">取消</button>
          <button type="submit" class="btn btn-primary">保存修改</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { reactive, onMounted } from 'vue'
import { useSitesStore } from '@/stores/sites'
import { useCategoriesStore } from '@/stores/categories'

const props = defineProps({
  site: { type: Object, required: true }
})

const emit = defineEmits(['close'])
const sitesStore = useSitesStore()
const categoriesStore = useCategoriesStore()

const form = reactive({
  name: '',
  url: '',
  desc: '',
  categoryId: 'ai',
  color: '#3b82f6'
})

onMounted(() => {
  form.name = props.site.name
  form.url = props.site.url
  form.desc = props.site.desc
  form.categoryId = props.site.categoryId
  form.color = props.site.color
})

function autoCompleteUrl() {
  if (form.url && !form.url.startsWith('http://') && !form.url.startsWith('https://')) {
    form.url = 'https://' + form.url
  }
}

function submit() {
  const domain = form.url.replace(/^https?:\/\//, '').split('/')[0]
  sitesStore.updateSite(props.site.id, {
    name: form.name,
    url: domain,
    desc: form.desc,
    categoryId: form.categoryId,
    color: form.color,
    initial: form.name.charAt(0).toUpperCase()
  })
  emit('close')
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
  z-index: 300;
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
  transition: border-color .15s ease;
}
.form-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-light); }
.form-textarea { resize: vertical; min-height: 60px; }
.color-picker-row { display: flex; align-items: center; gap: 10px; }
.color-input { width: 36px; height: 36px; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; padding: 2px; }
.color-hex { font-size: 13px; color: var(--text-secondary); font-family: monospace; }
.form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.btn {
  padding: 8px 20px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all .15s ease;
}
.btn-cancel { background: var(--border-light); color: var(--text-secondary); }
.btn-cancel:hover { background: var(--border); }
.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover { filter: brightness(1.1); }
</style>