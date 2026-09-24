import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { encodeStored, decodeStored } from '@/utils/storeVersioning'

export const useTodosStore = defineStore('todos', () => {
  // 从 localStorage 恢复（版本化，含迁移钩子）
  const todos = ref(decodeStored('nav-todos', localStorage.getItem('nav-todos'), []))

  // 持久化（版本化写入）
  function persist() {
    localStorage.setItem('nav-todos', encodeStored(todos.value))
  }

  function addTodo(text, category = 'work') {
    todos.value.unshift({
      id: Date.now(),
      text,
      done: false,
      category
    })
    persist()
  }

  function toggleTodo(id) {
    const todo = todos.value.find(t => t.id === id)
    if (todo) {
      todo.done = !todo.done
      persist()
    }
  }

  function deleteTodo(id) {
    todos.value = todos.value.filter(t => t.id !== id)
    persist()
  }

  function addRaw(t) {
    if (!t || t.id === undefined) return
    if (todos.value.some(x => x.id === t.id)) return
    todos.value.push(t)
    persist()
  }

  const completedCount = computed(() =>
    todos.value.filter(t => t.done).length
  )

  const progress = computed(() =>
    todos.value.length === 0
      ? 0
      : Math.round((completedCount.value / todos.value.length) * 100)
  )

  return {
    todos,
    addTodo,
    toggleTodo,
    deleteTodo,
    addRaw,
    completedCount,
    progress
  }
})