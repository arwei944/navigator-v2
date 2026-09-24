import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { versionedPersist } from '@/utils/storeVersioning'

export const useFavoritesStore = defineStore('favorites', () => {
  const favoriteIds = ref([])

  const isFavorite = computed(() => (id) => favoriteIds.value.includes(id))
  const count = computed(() => favoriteIds.value.length)

  function toggle(id) {
    const idx = favoriteIds.value.indexOf(id)
    if (idx === -1) {
      favoriteIds.value.push(id)
    } else {
      favoriteIds.value.splice(idx, 1)
    }
  }

  function isFav(id) {
    return favoriteIds.value.includes(id)
  }

  function add(id) {
    if (!favoriteIds.value.includes(id)) favoriteIds.value.push(id)
  }

  return { favoriteIds, isFavorite, count, toggle, isFav, add }
}, {
  persist: versionedPersist('favorites')
})