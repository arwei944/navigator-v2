<template>
  <!-- 简约背景音乐播放器：右下角一个胶囊，不遮内容、不抢焦点。
       只在「设置 → 背景音乐」打开后由 App.vue 懒加载挂载（首屏零成本）。 -->
  <div class="bgm" :class="{ playing }" :data-bgm="playing ? 'playing' : 'paused'" :data-track="track.id">
    <button
      type="button" class="bgm-icon bgm-main"
      :title="playing ? '暂停背景音乐' : '播放背景音乐'"
      :aria-label="playing ? '暂停背景音乐' : '播放背景音乐'"
      @click="onToggle"
    >{{ playing ? '⏸' : '▶' }}</button>

    <span class="bgm-title" :title="track.desc">
      <span class="bgm-note" :class="{ pulse: playing }">♪</span>
      {{ track.label }}
      <span class="bgm-time" :data-elapsed="Math.floor(elapsed)">{{ clock }}</span>
    </span>

    <button type="button" class="bgm-icon sm" title="上一首" aria-label="上一首" @click="onPrev">⏮</button>
    <button type="button" class="bgm-icon sm" title="下一首" aria-label="下一首" @click="onNext">⏭</button>

    <input
      class="bgm-vol" type="range" min="0" max="0.8" step="0.02"
      :value="volume" aria-label="背景音乐音量"
      :title="`音量 ${Math.round(volume * 100)}%`"
      @input="onVolume"
    >

    <button type="button" class="bgm-icon sm" title="关闭背景音乐（可在设置里再打开）" aria-label="关闭" @click="onOff">✕</button>

    <p v-if="!supported" class="bgm-warn">这个浏览器不支持 Web Audio</p>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, watch } from 'vue'
import { useBgmPlayer } from '@/composables/useBgmPlayer'
import { usePreferencesStore } from '@/stores/preferences'

const prefs = usePreferencesStore()
const { playing, track, volume, elapsed, clock, supported, start, pause, toggle, setVolume, setTrack, nextTrack, prevTrack } = useBgmPlayer()

// 用户显式暂停过就不再自动起（否则点一下别处音乐又响了，很烦）
let userPaused = false

function onToggle() {
  userPaused = playing.value ? true : false
  toggle()
}
function onVolume(e) {
  setVolume(e.target.value)          // 拖动时立刻生效，不能等偏好回流
  prefs.setBgmVolume(volume.value)   // 再落偏好（持久化）
}
async function onNext() {
  await nextTrack()
  prefs.setBgmTrack(track.value.id)
}
async function onPrev() {
  await prevTrack()
  prefs.setBgmTrack(track.value.id)
}

// 设置面板改了曲目/音量 → 播放器跟上。偏好是唯一真源，播放器只跟随。
watch(() => prefs.bgmTrack, id => { if (id !== track.value.id) setTrack(id) })
watch(() => prefs.bgmVolume, v => { if (Math.abs(Number(v) - volume.value) > 0.001) setVolume(v) })
function onOff() {
  pause()
  prefs.setBgmOn(false) // App.vue 据此卸载本组件
}

/* 浏览器禁止无手势播放 —— 所以「背景音乐」只能是"第一次交互后响起"。
   监听一次 pointerdown/keydown，满足策略又符合直觉。 */
function armAutoStart() {
  const off = () => {
    document.removeEventListener('pointerdown', once, true)
    document.removeEventListener('keydown', once, true)
  }
  const once = async (ev) => {
    // 落在播放器自己身上的一下不算「第一次交互」：那一下有自己的语义（可能就是暂停），
    // 抢着自动起播会出现「先起后停」的闪烁
    if (ev?.target instanceof Element && ev.target.closest('.bgm')) return
    off()
    if (!userPaused && !playing.value) await start()
  }
  document.addEventListener('pointerdown', once, true)
  document.addEventListener('keydown', once, true)
  return off
}

let disarm = null
onMounted(() => {
  setVolume(prefs.bgmVolume)
  if (prefs.bgmTrack !== track.value.id) setTrack(prefs.bgmTrack)
  disarm = armAutoStart()
})
onBeforeUnmount(() => { disarm?.(); pause() })
</script>

<style scoped>
.bgm {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px 7px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--glass-bg);
  backdrop-filter: blur(calc(var(--glass-blur, 20px) / 2));
  -webkit-backdrop-filter: blur(calc(var(--glass-blur, 20px) / 2));
  box-shadow: var(--shadow-hover);
  font-size: 12.5px;
  color: var(--text-secondary);
}
.bgm.playing { border-color: var(--accent); }
.bgm-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}
.bgm-icon:hover { background: var(--border-light); color: var(--text-primary); }
.bgm-main { background: var(--accent); color: #fff; font-size: 11px; }
.bgm-main:hover { background: var(--accent); color: #fff; opacity: .9; }
.bgm-icon.sm { width: 22px; height: 22px; font-size: 10px; }
.bgm-title { display: inline-flex; align-items: center; gap: 5px; color: var(--text-primary); white-space: nowrap; }
.bgm-note { color: var(--accent); }
/* 播放时音符轻微跳动：不播也看得出状态 */
.bgm-note.pulse { animation: bgmPulse 1.6s ease-in-out infinite; }
@keyframes bgmPulse { 0%,100% { opacity: .5; transform: translateY(0) } 50% { opacity: 1; transform: translateY(-2px) } }
.bgm-time { font-size: 11px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.bgm-vol { width: 66px; accent-color: var(--accent); cursor: pointer; }
.bgm-warn { position: absolute; left: 0; bottom: -20px; margin: 0; font-size: 10.5px; color: var(--danger); white-space: nowrap; }

@media (max-width: 768px) {
  /* 移动端底部有 tab 栏，往上让一档 */
  .bgm { right: 10px; bottom: 68px; padding: 6px 10px 6px 7px; }
  .bgm-vol { width: 52px; }
}
</style>
