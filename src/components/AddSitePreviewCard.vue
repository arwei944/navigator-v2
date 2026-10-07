<template>
  <Teleport to="body">
    <div class="preview-overlay" @click.self="close">
      <div class="preview-card" @mouseenter="paused = true" @mouseleave="paused = false">
        <template v-if="state.phase === 'loading'">
          <div class="preview-loading">
            <span class="preview-spinner"></span>
            <div class="preview-loading-text">
              <strong>正在识别并添加…</strong>
              <span class="preview-url">{{ state.url }}</span>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="preview-head">
            <span class="preview-ok">已自动添加</span>
            <span class="preview-countdown">
              {{ paused || editing ? '已暂停，不会自动关闭' : `${countdown} 秒后自动关闭` }}
            </span>
          </div>

          <!-- 只读复用站点卡片：看到的就是入库后真实的样子 -->
          <SiteCard :site="state.site" is-read-only />

          <div v-if="!state.site.categoryId" class="preview-note">
            分类未识别。可点「编辑」补充，或稍后在站点管理里调整。
          </div>

          <div class="preview-actions">
            <button type="button" class="btn btn-cancel" @click="undo">撤销添加</button>
            <button type="button" class="btn btn-cancel" @click="editing = true">编辑</button>
            <button type="button" class="btn btn-primary" @click="close">完成</button>
          </div>
        </template>
      </div>

      <EditSiteModal v-if="editing" :site="state.site"
                     @close="editing = false" @saved="onSaved" />
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch, onUnmounted } from 'vue'
import SiteCard from '@/components/SiteCard.vue'
import EditSiteModal from '@/components/EditSiteModal.vue'
import { useSitesStore } from '@/stores/sites'

const props = defineProps({
  // { phase: 'loading' | 'ok', url: string, site?: object }
  // 失败态不渲染本组件（由 App 直接退回弹窗），故这里不处理 error
  state: { type: Object, required: true }
})
const emit = defineEmits(['close'])

const sitesStore = useSitesStore()
const editing = ref(false)
const paused = ref(false)
const countdown = ref(6)
let timer = null

function stopTimer() {
  if (timer) { clearInterval(timer); timer = null }
}

function startTimer() {
  stopTimer()
  countdown.value = 6
  timer = setInterval(() => {
    // 悬停或正在编辑时不倒计时：用户显然在处理这张卡片
    if (paused.value || editing.value) return
    countdown.value -= 1
    if (countdown.value <= 0) { stopTimer(); emit('close') }
  }, 1000)
}

// 只在成功态计时；loading 态没有可关闭的内容
watch(() => [props.state.phase, props.state.site?.id], () => {
  if (props.state.phase === 'ok') startTimer()
  else stopTimer()
}, { immediate: true })

/** 编辑中不允许被遮罩 / Esc 关掉，否则用户正在填的表单会凭空消失 */
function close() {
  if (!editing.value) emit('close')
}

/**
 * 保存编辑后关闭卡片。EditSiteModal 是先 emit('saved') 再 emit('close')，
 * 走到这里时 editing 仍为 true，若复用 close() 会被编辑守卫拦下、卡片不关；
 * 故这里显式清掉 editing 再关闭。
 */
function onSaved() {
  editing.value = false
  emit('close')
}

function onKey(e) {
  if (e.key === 'Escape') close()
}
window.addEventListener('keydown', onKey)

onUnmounted(() => {
  stopTimer()
  window.removeEventListener('keydown', onKey)
})

/** 撤销：把刚入库的这条彻底摘掉（不进回收站），当没发生过 */
function undo() {
  if (props.state.site) sitesStore.undoAdd(props.state.site.id)
  emit('close')
}
</script>

<style scoped>
.preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 240;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(2px);
}

.preview-card {
  width: min(420px, 100%);
  max-height: 90vh;
  overflow-y: auto;
  padding: 18px;
  border-radius: 14px;
  background: var(--bg-white, #fff);
  border: 1px solid var(--border, #e2e8f0);
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.28);
}

.preview-loading {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 2px;
}

.preview-spinner {
  width: 22px;
  height: 22px;
  flex: none;
  border: 2px solid var(--border, #e2e8f0);
  border-top-color: var(--accent, #2563eb);
  border-radius: 50%;
  animation: preview-spin 0.8s linear infinite;
}

@keyframes preview-spin { to { transform: rotate(360deg); } }

.preview-loading-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.preview-url {
  font-size: 12px;
  color: var(--text-muted, #64748b);
  word-break: break-all;
}

.preview-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

.preview-ok {
  font-size: 14px;
  font-weight: 600;
  color: var(--accent, #2563eb);
}

.preview-countdown {
  font-size: 12px;
  color: var(--text-muted, #64748b);
}

.preview-note {
  margin-top: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: #92400e;
  background: #fef3c7;
}

.preview-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}

/* 全局样式表 src/styles/main.css 只提供 CSS 变量，并未定义 `.btn` 系类；
   它们只存在于各弹窗组件自己的 scoped 样式里，故本组件必须自带这几条
   （取值对齐 AddSiteModal.vue）。 */
.btn {
  padding: 8px 20px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all .15s ease;
}
.btn-cancel { background: var(--border-light); color: var(--text-secondary); }
.btn-cancel:hover { background: var(--border); }
.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover { filter: brightness(1.1); }
</style>
