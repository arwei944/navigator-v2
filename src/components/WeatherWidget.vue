<template>
  <div class="weather-widget">
    <div class="weather-main" @click="showSearch = !showSearch">
      <span v-if="loading" class="weather-loading">--</span>
      <template v-else>
        <span class="weather-icon">{{ weatherIcon }}</span>
        <span class="weather-temp">{{ temperature }}</span>
        <span class="weather-city">{{ cityName }}</span>
      </template>
    </div>
    <div v-if="showSearch" class="weather-search">
      <input
        ref="searchInput"
        v-model="searchQuery"
        type="text"
        class="weather-search-input"
        placeholder="输入城市名 (拼音/英文)…"
        @keyup.enter="searchCity"
        @blur="handleBlur"
      />
      <div v-if="suggestions.length > 0" class="weather-suggestions">
        <div
          v-for="(s, i) in suggestions"
          :key="i"
          class="weather-suggestion-item"
          @mousedown.prevent="selectSuggestion(s)"
        >
          {{ s.name }}{{ s.admin1 ? ', ' + s.admin1 : '' }}{{ s.country ? ', ' + s.country : '' }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

const CACHE_KEY = 'weather_cache_v3'
const CACHE_TTL = 10 * 60 * 1000
const CITY_KEY = 'weather_city_v2'

const cityName = ref('--')
const temperature = ref('--')
const weatherCode = ref('')
const showSearch = ref(false)
const searchQuery = ref('')
const searchInput = ref(null)
const loading = ref(true)
const suggestions = ref([])
const suggestionTimer = ref(null)

const weatherIcon = computed(() => {
  const code = weatherCode.value
  if (code === 0 || code === '') return '☀️'
  if (code === 1) return '🌤'
  if (code === 2) return '⛅'
  if (code === 3) return '☁️'
  if (code >= 45 && code <= 48) return '🌫'
  if (code >= 51 && code <= 55) return '🌦'
  if (code >= 61 && code <= 65) return '🌧'
  if (code >= 71 && code <= 77) return '🌨'
  if (code >= 80 && code <= 82) return '🌦'
  if (code >= 85 && code <= 86) return '🌨'
  if (code >= 95) return '⛈'
  return '🌤'
})

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const cached = JSON.parse(raw)
    if (Date.now() - cached.timestamp > CACHE_TTL) {
      localStorage.removeItem(CACHE_KEY)
      return null
    }
    return cached.data
  } catch { return null }
}

function saveCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data })) } catch { }
}

function loadSavedCity() {
  try {
    const raw = localStorage.getItem(CITY_KEY)
    if (raw) return JSON.parse(raw)
  } catch { }
  return null
}

function saveCity(city) {
  try { localStorage.setItem(CITY_KEY, JSON.stringify(city)) } catch { }
}

async function fetchWeather(lat, lon, label) {
  loading.value = true
  const cached = loadCache()
  if (cached) {
    weatherCode.value = cached.weathercode ?? cached.weatherCode ?? ''
    temperature.value = cached.temperature ?? cached.temp ?? '--'
    if (label) cityName.value = label
    loading.value = false
    return
  }

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const cw = data.current_weather
    if (cw) {
      weatherCode.value = cw.weathercode
      temperature.value = cw.temperature !== undefined ? `${Math.round(cw.temperature)}°C` : '--'
      if (label) {
        cityName.value = label
        saveCity({ lat, lon, name: label })
      }
      saveCache(cw)
    } else {
      throw new Error('no weather data')
    }
  } catch (e) {
    weatherCode.value = ''
    temperature.value = '--'
    cityName.value = '获取失败'
  } finally {
    loading.value = false
  }
}

async function searchCity() {
  const q = searchQuery.value.trim()
  if (!q) return
  suggestions.value = []
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=zh`
    const res = await fetch(url)
    if (res.ok) {
      const data = await res.json()
      if (data.results && data.results.length > 0) {
        const r = data.results[0]
        const label = r.name + (r.admin1 ? ', ' + r.admin1 : '')
        await fetchWeather(r.latitude, r.longitude, label)
      }
    }
  } catch { }
  showSearch.value = false
  searchQuery.value = ''
}

watch(searchQuery, (val) => {
  if (suggestionTimer.value) clearTimeout(suggestionTimer.value)
  if (!val.trim()) { suggestions.value = []; return }
  suggestionTimer.value = setTimeout(async () => {
    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(val.trim())}&count=5&language=zh`
      const res = await fetch(url)
      if (!res.ok) return
      const data = await res.json()
      suggestions.value = (data.results || []).map(r => ({
        lat: r.latitude, lon: r.longitude,
        name: r.name, admin1: r.admin1 || '', country: r.country || ''
      }))
    } catch { suggestions.value = [] }
  }, 300)
})

function selectSuggestion(s) {
  const label = s.name + (s.admin1 ? ', ' + s.admin1 : '')
  fetchWeather(s.lat, s.lon, label)
  showSearch.value = false
  searchQuery.value = ''
  suggestions.value = []
}

function handleBlur() {
  setTimeout(() => {
    showSearch.value = false
    searchQuery.value = ''
    suggestions.value = []
  }, 200)
}

function handleClickOutside(e) {
  if (showSearch.value && !e.target.closest('.weather-widget')) {
    showSearch.value = false
    searchQuery.value = ''
    suggestions.value = []
  }
}

onMounted(async () => {
  // 1. 尝试加载已保存的城市
  const saved = loadSavedCity()
  if (saved) {
    await fetchWeather(saved.lat, saved.lon, saved.name)
    document.addEventListener('click', handleClickOutside)
    return
  }

  // 2. 尝试浏览器定位
  let located = false
  if (navigator.geolocation) {
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 5000, enableHighAccuracy: false
        })
      })
      const { latitude, longitude } = pos.coords
      // 用 Open-Meteo 反向地理编码获取城市名
      try {
        const geoRes = await fetch(
          `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${latitude}&longitude=${longitude}&language=zh`
        )
        if (geoRes.ok) {
          const geoData = await geoRes.json()
          if (geoData.results && geoData.results.length > 0) {
            const r = geoData.results[0]
            const label = r.name + (r.admin1 ? ', ' + r.admin1 : '')
            await fetchWeather(latitude, longitude, label)
            located = true
          }
        }
      } catch { }
      if (!located) {
        await fetchWeather(latitude, longitude, '当前位置')
        located = true
      }
    } catch { }
  }

  // 3. 默认北京
  if (!located) {
    await fetchWeather(39.9042, 116.4074, '北京')
  }

  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
.weather-widget {
  position: relative;
  display: flex;
  align-items: center;
  font-size: 13px;
  font-family: var(--font);
  user-select: none;
}

.weather-main {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: background var(--transition);
}

.weather-main:hover {
  background: rgba(255,255,255,.08);
}

.weather-icon {
  font-size: 16px;
  line-height: 1;
}

.weather-temp {
  font-weight: 600;
  color: #f1f5f9;
  font-size: 14px;
  letter-spacing: -0.3px;
}

.weather-city {
  color: var(--text-sidebar-dim);
  font-size: 12px;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.weather-loading {
  color: var(--text-sidebar-dim);
  font-size: 13px;
}

.weather-search {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  z-index: 50;
}

.weather-search-input {
  width: 180px;
  padding: 6px 10px;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: var(--radius-sm);
  background: #1e293b;
  color: #f1f5f9;
  font-size: 12px;
  font-family: var(--font);
  outline: none;
  transition: border-color var(--transition);
}

.weather-search-input::placeholder {
  color: #64748b;
}

.weather-search-input:focus {
  border-color: var(--accent);
}

.weather-suggestions {
  background: #1e293b;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: var(--radius-sm);
  margin-top: 2px;
  max-height: 180px;
  overflow-y: auto;
}

.weather-suggestion-item {
  padding: 7px 10px;
  font-size: 12px;
  color: #cbd5e1;
  cursor: pointer;
  transition: background var(--transition);
}

.weather-suggestion-item:hover {
  background: rgba(255,255,255,0.08);
  color: #f1f5f9;
}
</style>