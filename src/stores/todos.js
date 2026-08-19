import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useTodosStore = defineStore('todos', () => {
  // 从 localStorage 恢复
  const stored = localStorage.getItem('nav-todos')
  const todos = ref(stored ? JSON.parse(stored) : [])

  // 持久化
  function persist() {
    localStorage.setItem('nav-todos', JSON.stringify(todos.value))
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
    completedCount,
    progress
  }
})