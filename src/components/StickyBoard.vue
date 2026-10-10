<template>
  <div class="board-root" role="dialog" aria-label="便签墙" @pointerdown.self="closeBoard">
    <div class="board-panel" :class="{ mobile }">
      <header class="board-head">
        <div class="board-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h11l5 5v11a0 0 0 0 1 0 0H4z"/><polyline points="15 4 15 9 20 9"/></svg>
          便签墙
          <span class="board-count">{{ items.length }} 枚</span>
        </div>
        <div class="board-head-actions">
          <button class="board-btn primary" @click="addNote">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            新建便签
          </button>
          <button class="board-btn" @click="closeBoard">关闭</button>
        </div>
      </header>

      <div class="board-canvas" @pointerdown.self="onCanvasDown">
        <StickyNote v-for="n in items" :key="n.id" :note="n" mode="board" />
        <div v-if="!items.length" class="board-empty">
          <p>还没有便签。</p>
          <p class="board-empty-sub">便签适合放「要一直看得见」的信息：额度、续费日期、某个站的使用心得。</p>
          <button class="board-btn primary" @click="addNote">写第一枚</button>
        </div>
      </div>

      <footer class="board-foot">
        <span>拖顶栏把手移动 · 右下角缩放 · 图钉可以把便签钉到桌面上</span>
        <span class="board-size">已用 {{ sizeKb }} KB</span>
      </footer>
    </div>
  </div>
</template>

<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import { useNotesStore } from '@/stores/notes'
import { useToastStore } from '@/stores/toast'
/**
 * 卡片本体（含 Markdown-lite 解析）按需加载：这是便签里最重的一块，
 * 而便签墙/停靠区**没便签时根本不渲染它**，所以没必要进首屏分包。
 */
const StickyNote = defineAsyncComponent(() => import('@/components/StickyNote.vue'))

const emit = defineEmits(['close'])

const notesStore = useNotesStore()
const toastStore = useToastStore()

const items = computed(() => notesStore.items)
const sizeKb = computed(() => Math.round(notesStore.usedBytes / 1024))
const mobile = ref(false)

function addNote() {
  const res = notesStore.create('')
  if (res.ok === false && res.reason === 'quota') {
    toastStore.push({ message: '便利贴空间已满，请先删掉几枚', tone: 'error' })
  }
}

function onCanvasDown() {
  // 点空白处：关掉可能正在编辑的便签（textarea 失焦自然会保存）
  document.activeElement?.blur?.()
}

function closeBoard() {
  emit('close')
}

function onKeydown(e) {
  if (e.key === 'Escape') closeBoard()
}

function syncViewport() {
  mobile.value = typeof window !== 'undefined' && window.innerWidth <= 768
}

onMounted(() => {
  syncViewport()
  window.addEventListener('resize', syncViewport)
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', syncViewport)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
.board-root { position: fixed; inset: 0; z-index: 480; background: rgba(15, 23, 42, .45); display: flex; align-items: center; justify-content: center; padding: 24px; }
.board-panel { width: 100%; height: 100%; max-width: 1200px; background: var(--bg); border: 1px solid var(--border); border-radius: 14px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.3); }
.board-head, .board-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; flex-shrink: 0; }
.board-head { border-bottom: 1px solid var(--border); }
.board-foot { border-top: 1px solid var(--border); font-size: 11px; color: var(--text-secondary); opacity: .8; }
.board-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: var(--text-primary); }
.board-title svg { width: 16px; height: 16px; color: var(--color-note); }
.board-count { font-size: 11px; font-weight: 500; color: var(--text-secondary); }
.board-head-actions { display: flex; gap: 8px; }
.board-btn { display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-white); color: var(--text-primary); font-size: 12px; font-weight: 500; cursor: pointer; font-family: var(--font); }
.board-btn svg { width: 14px; height: 14px; }
.board-btn:hover { border-color: var(--accent); color: var(--accent); }
.board-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--color-on-solid); }
.board-btn.primary:hover { opacity: .9; color: var(--color-on-solid); }
.board-canvas { position: relative; flex: 1; overflow: auto; background-image: radial-gradient(circle, var(--border) 1px, transparent 1px); background-size: 22px 22px; }
.board-empty { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--text-secondary); font-size: 13px; }
.board-empty-sub { font-size: 12px; opacity: .75; max-width: 420px; text-align: center; line-height: 1.6; }
/* 移动端：便签墙退化成竖排列表 —— 触屏拖拽体验差，而且拖拽排序已经占了这个手势 */
.board-panel.mobile .board-canvas { display: flex; flex-direction: column; gap: 12px; padding: 12px; background-image: none; }
.board-panel.mobile :deep(.sticky-board) { position: relative !important; left: auto !important; top: auto !important; width: 100% !important; height: auto !important; min-height: 96px; }
.board-panel.mobile .board-foot { display: none; }
</style>
