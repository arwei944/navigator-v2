<template>
  <Teleport to="body">
    <div class="theme-overlay" @click.self="$emit('close')">
      <div class="theme-modal">
        <div class="theme-header">
          <h3>主题切换</h3>
          <button class="close-btn" @click="$emit('close')" aria-label="关闭">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div class="theme-grid">
          <div
            v-for="theme in themes"
            :key="theme.id"
            class="theme-card"
            :class="{ active: currentTheme === theme.id }"
            @click="selectTheme(theme)"
          >
            <div class="color-swatch" :style="{ background: theme.primary }">
              <div class="swatch-bar" :style="{ background: theme.bg }"></div>
              <div class="swatch-accent" :style="{ background: theme.accent }"></div>
            </div>
            <div class="theme-info">
              <span class="theme-name">{{ theme.name }}</span>
              <span class="theme-hex">{{ theme.primary }}</span>
            </div>
            <div v-if="currentTheme === theme.id" class="check-badge">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
defineProps({
  currentTheme: { type: String, default: 'default' }
})

const emit = defineEmits(['select', 'close'])

const themes = [
  {
    id: 'default',
    name: '默认蓝',
    primary: '#2563eb',
    bg: '#f1f5f9',
    sidebarBg: '#0f172a',
    accent: '#dbeafe',
    color: '#2563eb'
  },
  {
    id: 'green',
    name: '极客绿',
    primary: '#10b981',
    bg: '#ecfdf5',
    sidebarBg: '#064e3b',
    accent: '#a7f3d0',
    color: '#10b981'
  },
  {
    id: 'purple',
    name: '赛博紫',
    primary: '#8b5cf6',
    bg: '#f5f3ff',
    sidebarBg: '#2e1065',
    accent: '#ddd6fe',
    color: '#8b5cf6'
  },
  {
    id: 'orange',
    name: '日落橙',
    primary: '#f59e0b',
    bg: '#fffbeb',
    sidebarBg: '#451a03',
    accent: '#fde68a',
    color: '#f59e0b'
  }
]

function selectTheme(theme) {
  emit('select', {
    id: theme.id,
    primary: theme.primary,
    bg: theme.bg,
    sidebarBg: theme.sidebarBg,
    accent: theme.accent
  })
}
</script>

<style scoped>
.theme-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 0.2s ease;
}

.theme-modal {
  background: var(--bg-white);
  border-radius: var(--radius-lg);
  padding: 24px;
  width: 440px;
  max-width: 90vw;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
  animation: slideUp 0.25s ease;
}

.theme-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.theme-header h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.close-btn {
  width: 32px;
  height: 32px;
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

.theme-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.theme-card {
  position: relative;
  border-radius: var(--radius);
  border: 2px solid var(--border);
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--bg-white);
}

.theme-card:hover {
  border-color: var(--accent);
  box-shadow: var(--shadow-hover);
  transform: translateY(-2px);
}

.theme-card.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

.color-swatch {
  height: 60px;
  border-radius: var(--radius-sm);
  margin-bottom: 10px;
  display: flex;
  align-items: flex-end;
  gap: 4px;
  padding: 6px;
  position: relative;
  overflow: hidden;
}

.swatch-bar {
  height: 8px;
  flex: 1;
  border-radius: 4px;
  opacity: 0.9;
}

.swatch-accent {
  width: 20px;
  height: 8px;
  border-radius: 4px;
  opacity: 0.7;
}

.theme-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.theme-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.theme-hex {
  font-size: 11px;
  color: var(--text-secondary);
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.check-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(16px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
</style>