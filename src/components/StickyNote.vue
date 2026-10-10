<template>
  <div class="sticky"
       :class="[mode === 'dock' ? 'sticky-dock' : 'sticky-board', { 'is-editing': editing, 'is-collapsed': note.collapsed }]"
       :style="styleObj"
       @pointerdown="onPointerDown">
    <div class="sticky-bar">
      <span class="sticky-grip" :title="mode === 'board' ? '拖动便签' : ''">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></svg>
      </span>
      <div class="sticky-colors">
        <button v-for="c in colors" :key="c" class="sticky-color" :class="{ on: note.color === c }"
                :style="colorStyle(c)" :title="'换成 ' + c" @pointerdown.stop @click.stop="setColor(c)"></button>
      </div>
      <div class="sticky-bar-actions">
        <button class="sticky-act" :class="{ on: note.pinned }" :title="note.pinned ? '取消钉住' : '钉在桌面上'" @click.stop="togglePin">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>
        </button>
        <button class="sticky-act" :title="note.collapsed ? '展开' : '折叠'" @click.stop="toggleCollapse">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline :points="note.collapsed ? '6 9 12 15 18 9' : '18 15 12 9 6 15'"/></svg>
        </button>
        <button class="sticky-act danger" title="删除便签" @click.stop="remove">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    </div>

    <div class="sticky-body" @click="startEdit">
      <textarea v-if="editing" ref="inputRef" v-model="draft" class="sticky-input"
                placeholder="写点什么…（支持 - [ ] 清单、**粗体**、#标签）"
                @blur="stopEdit" @input="onInput" @keydown.esc.stop="stopEdit"></textarea>
      <div v-else class="sticky-render">
        <template v-if="lines.length">
          <div v-for="(ln, i) in lines" :key="i" class="sticky-line" :class="'line-' + ln.type">
            <template v-if="ln.type === 'todo'">
              <button class="sticky-check" :class="{ done: ln.done }" @click.stop="toggleLine(ln.todoIdx)">
                <svg v-if="ln.done" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </button>
              <span class="sticky-todo-text" :class="{ done: ln.done }">{{ ln.text }}</span>
            </template>
            <span v-else-if="ln.type === 'bullet'" class="sticky-bullet">· {{ ln.text }}</span>
            <span v-else-if="ln.type === 'blank'" class="sticky-blank">&nbsp;</span>
            <span v-else><template v-for="(p, j) in inlineOf(ln.text)" :key="j"><a v-if="p.url" :href="p.url" target="_blank" rel="noopener noreferrer" class="sticky-link" @click.stop>{{ p.text }}</a><b v-else-if="p.bold">{{ p.text }}</b><i v-else-if="p.tag" class="sticky-tag">{{ p.text }}</i><template v-else>{{ p.text }}</template></template></span>
          </div>
        </template>
        <span v-else class="sticky-placeholder">双击写点什么…</span>
      </div>
      <button v-if="!editing && pending.length" class="sticky-todo-btn" @click.stop="toTodos">
        把 {{ pending.length }} 项清单转成待办
      </button>
    </div>

    <div v-if="mode === 'board'" class="sticky-resize" @pointerdown.stop="startResize">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 12 12 20"/><line x1="20" y1="16" x2="16" y2="20"/></svg>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useNotesStore, NOTE_COLORS } from '@/stores/notes'
import { useTodosStore } from '@/stores/todos'
import { useToastStore } from '@/stores/toast'
import { inlineParts, parseNoteLines, pendingTodos, toggleTodoLine } from '@/utils/noteText'

const props = defineProps({
  note: { type: Object, required: true },
  /** board = 便签墙（可拖拽/缩放）；dock = 停靠在桌面上的小卡 */
  mode: { type: String, default: 'board' }
})

const SAVE_DEBOUNCE = 300

const notesStore = useNotesStore()
const todosStore = useTodosStore()
const toastStore = useToastStore()
const colors = NOTE_COLORS

const editing = ref(false)
const draft = ref(props.note.text || '')
const inputRef = ref(null)
// 拖动过程中的临时坐标：只在松手时写回 store，否则每一帧都会广播一条消息
const dragPos = ref(null)
const draftSize = ref(null)

const styleObj = computed(() => {
  const n = props.note
  const x = dragPos.value ? dragPos.value.x : n.x
  const y = dragPos.value ? dragPos.value.y : n.y
  const w = draftSize.value ? draftSize.value.w : n.w
  const h = draftSize.value ? draftSize.value.h : n.h
  return {
    left: `${x}px`,
    top: `${y}px`,
    width: `${w}px`,
    height: n.collapsed ? 'auto' : `${h}px`,
    zIndex: Number(n.z) || 1,
    '--nb': `var(--note-${n.color}-bg)`,
    '--ne': `var(--note-${n.color}-edge)`
  }
})

function colorStyle(c) {
  return { background: `var(--note-${c}-bg)`, borderColor: `var(--note-${c}-edge)` }
}

const lines = computed(() => parseNoteLines(props.note.text))
const pending = computed(() => pendingTodos(props.note.text))
function inlineOf(text) { return inlineParts(text) }

/* ---------- 编辑 ---------- */

let timer = null

function flush() {
  clearTimeout(timer)
  if (draft.value === (props.note.text || '')) return
  const res = notesStore.update(props.note.id, { text: draft.value })
  if (res.ok === false && res.reason === 'quota') {
    toastStore.push({ message: '便利贴空间已满，请先删掉几枚再写', tone: 'error' })
  }
}

function onInput() {
  clearTimeout(timer)
  timer = setTimeout(flush, SAVE_DEBOUNCE)
}

function startEdit() {
  if (editing.value || props.note.collapsed) return
  draft.value = props.note.text || ''
  editing.value = true
  nextTick(() => inputRef.value?.focus())
}

function stopEdit() {
  if (!editing.value) return
  flush()
  editing.value = false
}

// 别处（另一个标签页 / 云端）改了内容，且本地没在编辑时才回填
watch(() => props.note.text, (v) => {
  if (!editing.value) draft.value = v || ''
})

function toggleLine(i) {
  const next = toggleTodoLine(props.note.text || '', i)
  notesStore.update(props.note.id, { text: next })
}

/** 清单项 → 待办：单向打通，便签原文保留（它是记录，待办是要做完的事） */
function toTodos() {
  const items = pending.value
  if (!items.length) return
  items.forEach(t => todosStore.addTodo(t, 'work'))
  toastStore.push({ message: `已把 ${items.length} 项转成待办`, tone: 'ok' })
}

/* ---------- 便签操作 ---------- */

function setColor(c) { notesStore.setColor(props.note.id, c) }
function togglePin() { notesStore.togglePin(props.note.id) }
function toggleCollapse() { notesStore.toggleCollapse(props.note.id) }
function remove() {
  notesStore.remove(props.note.id)
  toastStore.push({
    message: '已删除便签',
    tone: 'info',
    actionLabel: '撤销',
    onAction: () => notesStore.restore(props.note.id)
  })
}

/* ---------- 拖拽与缩放（仅便签墙） ---------- */

function onPointerDown(e) {
  if (props.mode !== 'board') return
  // 只从顶栏的把手起拖：整卡都能拖会让「点进编辑」变成抽奖
  if (!e.target.closest('.sticky-grip')) return
  notesStore.bringToFront(props.note.id)
  const startX = e.clientX
  const startY = e.clientY
  const ox = props.note.x
  const oy = props.note.y
  dragPos.value = { x: ox, y: oy }
  e.preventDefault()

  function onMove(ev) {
    dragPos.value = { x: ox + ev.clientX - startX, y: oy + ev.clientY - startY }
  }
  function onUp() {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    const pos = dragPos.value
    dragPos.value = null
    if (pos) notesStore.move(props.note.id, pos.x, pos.y)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function startResize(e) {
  const startX = e.clientX
  const startY = e.clientY
  const ow = props.note.w
  const oh = props.note.h
  draftSize.value = { w: ow, h: oh }
  e.preventDefault()

  function onMove(ev) {
    draftSize.value = { w: ow + ev.clientX - startX, h: oh + ev.clientY - startY }
  }
  function onUp() {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    const s = draftSize.value
    draftSize.value = null
    if (s) notesStore.resize(props.note.id, s.w, s.h)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

</script>

<style scoped>
.sticky {
  position: absolute;
  display: flex;
  flex-direction: column;
  background: var(--nb);
  border: 1px solid var(--ne);
  border-radius: 10px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, .12);
  overflow: hidden;
  /* 便签浮层刻意不加 backdrop-filter：侧栏折叠时会临时摘掉全站毛玻璃，
     这里若自带模糊，折叠动画会掉帧（见 .app-layout.no-blur 的说明） */
}
.sticky-dock { position: relative; left: auto !important; top: auto !important; width: 100% !important; height: auto !important; min-height: 96px; }
.sticky-bar { display: flex; align-items: center; gap: 6px; padding: 5px 6px; border-bottom: 1px solid color-mix(in srgb, var(--ne) 30%, transparent); background: color-mix(in srgb, var(--ne) 8%, transparent); flex-shrink: 0; }
.sticky-grip { display: flex; align-items: center; color: var(--text-secondary); opacity: .55; cursor: grab; }
.sticky-dock .sticky-grip { cursor: default; }
.sticky-grip:active { cursor: grabbing; }
.sticky-grip svg { width: 14px; height: 14px; }
.sticky-colors { display: flex; gap: 3px; }
.sticky-color { width: 12px; height: 12px; border-radius: 50%; border: 1.5px solid var(--ne); padding: 0; cursor: pointer; }
.sticky-color.on { box-shadow: 0 0 0 1.5px var(--text-secondary); }
.sticky-bar-actions { display: flex; gap: 2px; margin-left: auto; }
.sticky-act { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: none; border-radius: 5px; background: transparent; color: var(--text-secondary); cursor: pointer; opacity: .7; }
.sticky-act:hover { background: color-mix(in srgb, var(--ne) 20%, transparent); opacity: 1; }
.sticky-act.on { color: var(--color-note); opacity: 1; }
.sticky-act.danger:hover { color: var(--color-danger); }
.sticky-act svg { width: 13px; height: 13px; }
.sticky-body { flex: 1; min-height: 0; padding: 8px 10px; overflow: auto; cursor: text; }
.sticky-input { width: 100%; height: 100%; min-height: 60px; border: none; background: transparent; color: var(--text-primary); font-family: var(--font); font-size: 13px; line-height: 1.6; resize: none; outline: none; }
.sticky-render { font-size: 13px; line-height: 1.6; color: var(--text-primary); word-break: break-word; }
.sticky-line { display: flex; align-items: flex-start; gap: 6px; }
.sticky-check { width: 14px; height: 14px; margin-top: 4px; border: 1.5px solid var(--text-secondary); border-radius: 4px; background: transparent; padding: 0; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; }
.sticky-check.done { background: var(--color-ok); border-color: var(--color-ok); }
.sticky-check svg { width: 10px; height: 10px; color: var(--color-on-solid); }
.sticky-todo-text.done { text-decoration: line-through; opacity: .6; }
.sticky-tag { font-style: normal; color: var(--color-note); }
.sticky-link { color: var(--accent); text-decoration: underline; }
.sticky-placeholder { color: var(--text-secondary); opacity: .55; }
.sticky-todo-btn { margin-top: 8px; border: 1px dashed var(--ne); background: transparent; color: var(--text-secondary); font-size: 11px; padding: 3px 8px; border-radius: 999px; cursor: pointer; font-family: var(--font); }
.sticky-todo-btn:hover { color: var(--color-note); border-color: var(--color-note); }
.sticky-resize { position: absolute; right: 0; bottom: 0; width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); opacity: .5; cursor: nwse-resize; }
.sticky-resize svg { width: 11px; height: 11px; }
.sticky.is-collapsed .sticky-body { display: none; }
</style>
