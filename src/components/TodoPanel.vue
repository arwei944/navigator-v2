<template>
  <div class="todo-panel">
    <div class="panel-header">
      <h3>待办事项</h3>
      <button class="close-btn" @click="$emit('close')" aria-label="关闭">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>

    <!-- 进度条 -->
    <div class="progress-section">
      <div class="progress-header">
        <span class="progress-label">完成进度</span>
        <span class="progress-value">{{ store.progress }}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: store.progress + '%' }"></div>
      </div>
    </div>

    <!-- 分类筛选 -->
    <div class="filter-tabs">
      <button
        v-for="tab in filterTabs"
        :key="tab.key"
        class="filter-tab"
        :class="{ active: activeFilter === tab.key }"
        @click="activeFilter = tab.key"
      >
        <span v-if="tab.color" class="dot" :style="{ background: tab.color }"></span>
        {{ tab.label }}
      </button>
    </div>

    <!-- 待办列表 -->
    <div class="todo-list" ref="listRef">
      <TransitionGroup name="todo-item">
        <div
          v-for="todo in filteredTodos"
          :key="todo.id"
          class="todo-row"
          :class="{ done: todo.done }"
        >
          <label class="checkbox-wrap">
            <input
              type="checkbox"
              :checked="todo.done"
              @change="store.toggleTodo(todo.id)"
            />
            <span class="checkmark"></span>
          </label>
          <span class="todo-text">{{ todo.text }}</span>
          <span class="category-dot" :style="{ background: categoryColor(todo.category) }" :title="todo.category"></span>
          <button class="delete-btn" @click="store.deleteTodo(todo.id)" aria-label="删除">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            </svg>
          </button>
        </div>
      </TransitionGroup>
      <div v-if="filteredTodos.length === 0" class="empty-state">
        暂无待办事项
      </div>
    </div>

    <!-- 添加输入 -->
    <div class="add-section">
      <div class="add-row">
        <input
          v-model="newText"
          class="add-input"
          placeholder="添加待办事项..."
          @keyup.enter="addTodo"
        />
        <button class="add-btn" @click="addTodo" :disabled="!newText.trim()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M12 5v14M5 12h14"/>
          </svg>
        </button>
      </div>
      <div class="category-selector">
        <button
          v-for="cat in categories"
          :key="cat.key"
          class="cat-btn"
          :class="{ active: newCategory === cat.key }"
          @click="newCategory = cat.key"
        >
          <span class="dot" :style="{ background: cat.color }"></span>
          {{ cat.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useTodosStore } from '@/stores/todos'

const emit = defineEmits(['close'])
const store = useTodosStore()

const newText = ref('')
const newCategory = ref('work')
const activeFilter = ref('all')

const filterTabs = [
  { key: 'all', label: '全部' },
  { key: 'work', label: '工作', color: '#3b82f6' },
  { key: 'personal', label: '个人', color: '#10b981' },
  { key: 'study', label: '学习', color: '#8b5cf6' },
]

const categories = [
  { key: 'work', label: '工作', color: '#3b82f6' },
  { key: 'personal', label: '个人', color: '#10b981' },
  { key: 'study', label: '学习', color: '#8b5cf6' },
]

const filteredTodos = computed(() => {
  if (activeFilter.value === 'all') return store.todos
  return store.todos.filter(t => t.category === activeFilter.value)
})

function categoryColor(cat) {
  const m = { work: '#3b82f6', personal: '#10b981', study: '#8b5cf6' }
  return m[cat] || '#94a3b8'
}

function addTodo() {
  const text = newText.value.trim()
  if (!text) return
  store.addTodo(text, newCategory.value)
  newText.value = ''
}
</script>

<style scoped>
.todo-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-white);
  border-left: 1px solid var(--border);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px 12px;
}

.panel-header h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.close-btn {
  width: 30px;
  height: 30px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--transition);
}

.close-btn:hover {
  background: var(--accent-light);
  color: var(--accent);
}

/* 进度条 */
.progress-section {
  padding: 0 16px 14px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.progress-value {
  font-weight: 600;
  color: var(--accent);
}

.progress-bar {
  height: 5px;
  background: var(--border);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 3px;
  transition: width 0.35s ease;
}

/* 分类筛选 */
.filter-tabs {
  display: flex;
  gap: 4px;
  padding: 0 16px 12px;
}

.filter-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 0;
  font-size: 12px;
  font-weight: 500;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition);
}

.filter-tab.active {
  background: var(--accent-light);
  color: var(--accent);
  font-weight: 600;
}

.filter-tab:hover:not(.active) {
  background: var(--border-light);
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}

/* 待办列表 */
.todo-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px;
}

.todo-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  transition: background var(--transition);
  margin-bottom: 2px;
}

.todo-row:hover {
  background: var(--border-light);
}

.todo-row.done .todo-text {
  text-decoration: line-through;
  color: var(--text-secondary);
  opacity: 0.7;
}

.todo-text {
  flex: 1;
  font-size: 13px;
  color: var(--text-primary);
  line-height: 1.4;
  word-break: break-word;
}

.category-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.delete-btn {
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: all var(--transition);
  flex-shrink: 0;
}

.todo-row:hover .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  background: #fef2f2;
  color: #ef4444;
}

/* checkbox */
.checkbox-wrap {
  position: relative;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  cursor: pointer;
}

.checkbox-wrap input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.checkmark {
  position: absolute;
  inset: 0;
  border: 2px solid var(--border);
  border-radius: 4px;
  transition: all var(--transition);
}

.checkbox-wrap input:checked + .checkmark {
  background: var(--accent);
  border-color: var(--accent);
}

.checkbox-wrap input:checked + .checkmark::after {
  content: '';
  position: absolute;
  left: 4px;
  top: 1px;
  width: 6px;
  height: 10px;
  border: solid white;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

/* 空状态 */
.empty-state {
  text-align: center;
  padding: 40px 16px;
  color: var(--text-secondary);
  font-size: 13px;
}

/* 添加区域 */
.add-section {
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}

.add-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.add-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-white);
  outline: none;
  transition: border-color var(--transition);
}

.add-input:focus {
  border-color: var(--accent);
}

.add-input::placeholder {
  color: var(--text-secondary);
}

.add-btn {
  width: 34px;
  height: 34px;
  border: none;
  background: var(--accent);
  border-radius: var(--radius-sm);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity var(--transition);
  flex-shrink: 0;
}

.add-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.add-btn:not(:disabled):hover {
  opacity: 0.9;
}

.category-selector {
  display: flex;
  gap: 6px;
}

.cat-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition);
}

.cat-btn.active {
  background: var(--accent-light);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 500;
}

/* 列表动画 */
.todo-item-enter-active,
.todo-item-leave-active {
  transition: all 0.25s ease;
}

.todo-item-enter-from {
  opacity: 0;
  transform: translateX(20px);
}

.todo-item-leave-to {
  opacity: 0;
  transform: translateX(20px);
}

.todo-item-move {
  transition: transform 0.25s ease;
}
</style>