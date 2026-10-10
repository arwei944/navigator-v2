<template>
  <div class="dock">
    <!-- 展开态：列出钉住的便签 + 入口 -->
    <div v-if="open" class="dock-panel">
      <header class="dock-head">
        <span class="dock-title">便利贴 · {{ pinned.length }}</span>
        <div class="dock-head-actions">
          <button class="dock-act" title="新建便利贴（Ctrl+Alt+N）" @click="addNote">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <button class="dock-act" title="打开便签墙" @click="openBoard">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          </button>
          <button class="dock-act" title="收起" @click="open = false">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        </div>
      </header>
      <div class="dock-list">
        <StickyNote v-for="n in pinned" :key="n.id" :note="n" mode="dock" />
        <p v-if="!pinned.length" class="dock-empty">
          还没有便利贴。钉住的便签会常驻在这里 —— 适合放额度、续费日期这类要一直看得见的信息。
        </p>
      </div>
    </div>

    <!-- 折叠态：一枚小按钮，角标显示钉住的数量 -->
    <button v-else class="dock-fab" :title="pinned.length ? `便利贴（${pinned.length}）` : '便利贴'" @click="open = true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h11l5 5v11H4z"/><polyline points="15 4 15 9 20 9"/></svg>
      <span v-if="pinned.length" class="dock-badge">{{ pinned.length }}</span>
    </button>
  </div>
</template>

<script setup>
import { computed, defineAsyncComponent, ref } from 'vue'
import { useNotesStore } from '@/stores/notes'
import { useToastStore } from '@/stores/toast'
/** 与便签墙同理：折叠态只有一枚浮标，卡片本体等展开时再加载（见 StickyBoard 的说明）。 */
const StickyNote = defineAsyncComponent(() => import('@/components/StickyNote.vue'))

const emit = defineEmits(['open-board'])

const notesStore = useNotesStore()
const toastStore = useToastStore()

const open = ref(false)
/** 停靠区只放钉住的便签：没钉的留在便签墙里，否则桌面会被便签淹没 */
const pinned = computed(() => notesStore.pinned)

function addNote() {
  const res = notesStore.create('', { pinned: true })
  if (res.ok === false && res.reason === 'quota') {
    toastStore.push({ message: '便利贴空间已满，请先删掉几枚', tone: 'error' })
    return
  }
  open.value = true
}

function openBoard() {
  open.value = false
  emit('open-board')
}

/** 供外部（快捷键、命令）唤起：新建并展开 */
function createAndOpen() {
  addNote()
}

defineExpose({ createAndOpen, open: () => { open.value = true } })
</script>

<style scoped>
.dock { position: fixed; right: 18px; bottom: 18px; z-index: 420; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.dock-fab { position: relative; width: 42px; height: 42px; border-radius: 50%; border: 1px solid var(--border); background: var(--bg-white); color: var(--text-secondary); display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.14); }
.dock-fab:hover { color: var(--color-note); border-color: var(--color-note); }
.dock-fab svg { width: 18px; height: 18px; }
.dock-badge { position: absolute; top: -3px; right: -3px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px; background: var(--color-note); color: var(--color-on-solid); font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.dock-panel { width: 260px; max-height: 52vh; display: flex; flex-direction: column; background: var(--bg-white); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 12px 34px rgba(0,0,0,.18); overflow: hidden; }
.dock-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--border-light); flex-shrink: 0; }
.dock-title { font-size: 12px; font-weight: 600; color: var(--text-primary); }
.dock-head-actions { display: flex; gap: 2px; }
.dock-act { width: 24px; height: 24px; border: none; border-radius: 6px; background: transparent; color: var(--text-secondary); display: flex; align-items: center; justify-content: center; cursor: pointer; }
.dock-act:hover { background: var(--border-light); color: var(--color-note); }
.dock-act svg { width: 14px; height: 14px; }
.dock-list { display: flex; flex-direction: column; gap: 8px; padding: 10px; overflow: auto; }
.dock-empty { margin: 0; font-size: 12px; line-height: 1.6; color: var(--text-secondary); opacity: .85; }
/* 移动端：右下角浮标会压住底部 tab 栏，改为从工具栏进便签墙 */
@media (max-width: 768px) {
  .dock { display: none; }
}
</style>
