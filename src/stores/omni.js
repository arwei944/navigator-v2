/**
 * 全能框的「全局动作宿主」。
 *
 * 存在的理由：命令要能触发编辑 / 删除 / 添加这类弹窗，但这些弹窗目前挂在
 * CardsContainer 内层、由卡片 emit 触发，命令层够不着。与其把弹窗状态塞进
 * 每一个外壳组件，不如收敛成一个请求队列：命令只管 `requestEdit(site)`，
 * 由 App.vue 监听并渲染。命令层因此完全不持有 DOM 状态。
 *
 * 语义是「一次性请求」：App 消费后立即置空，不会残留到下一次打开。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

/** 可以被命令唤起的面板（对应 App.vue 里的同名开关） */
export const OMNI_PANELS = ['settings', 'cardSettings', 'todo', 'bookmarkImport', 'shortcuts']

export const useOmniStore = defineStore('omni', () => {
  // 请求编辑某个站点
  const editTarget = ref(null)
  // 请求删除某个站点（App 会用 ConfirmDialog 二次确认后再真删）
  const deleteTarget = ref(null)
  // 请求打开添加站点弹窗，带预填网址
  const addPrefillUrl = ref('')
  const addOpen = ref(false)
  // 请求打开某个面板
  const panel = ref('')

  function requestEdit(site) { editTarget.value = site || null }
  function requestDelete(site) { deleteTarget.value = site || null }

  function requestAdd(url) {
    addPrefillUrl.value = url || ''
    addOpen.value = true
  }

  function requestPanel(name) {
    panel.value = OMNI_PANELS.includes(name) ? name : ''
  }

  return {
    editTarget, deleteTarget, addPrefillUrl, addOpen, panel,
    requestEdit, requestDelete, requestAdd, requestPanel
  }
})
