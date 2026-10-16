/**
 * 背景音乐播放器（Web Audio 合成）。
 *
 * 三条设计底线：
 *   ① **单例**：全局只有一个 AudioContext / 一条调度器。多个组件各建一个 = 叠音。
 *   ② **懒创建**：AudioContext 只在用户第一次按下播放时创建 —— 浏览器禁止无手势播放，
 *      提前建出来的上下文只会是 suspended 状态，白占资源。
 *   ③ **换曲/暂停不爆音**：所有增益都走 ramp，绝不直接赋值（直接赋值会"咔"一声）。
 *      同理，切换时先把主增益滑到 0、把在发声的振荡器逐个收尾，而不是"砍断"。
 *
 * 调度用「提前排程 + 心跳」而不是 setTimeout 逐个音符：定时器会被后台标签页节流到 1s，
 * 所以提前量给到 2s —— 就算心跳被拖慢，已排好的音符也不会断。
 */
import { ref, computed } from 'vue'
import {
  noteFreq, notesForBar, barSeconds, trackById, TRACKS, DEFAULT_TRACK,
  clampVolume, fmtClock,
} from '@/utils/bgmScore'

const LOOKAHEAD = 2.0 // 提前排程的秒数（要盖过后台节流的 1s 心跳）
const TICK = 200      // 调度器心跳（毫秒）

const playing = ref(false)
const trackId = ref(DEFAULT_TRACK)
const volume = ref(0.35)
const elapsed = ref(0)
const supported = ref(typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext))

let ctx = null
let master = null
let timer = null
let startedAt = 0
let playedBase = 0
let nextBar = 0
let nextBarTime = 0
const live = new Set()

const track = computed(() => trackById(trackId.value))
const clock = computed(() => fmtClock(elapsed.value))

function ensureCtx() {
  if (ctx || !supported.value) return ctx
  const AC = window.AudioContext || window.webkitAudioContext
  ctx = new AC()
  master = ctx.createGain()
  master.gain.value = 0.0001

  // 空间感：一个轻延迟反馈代替卷积混响（便宜得多，够用）
  const dry = ctx.createBiquadFilter()
  dry.type = 'lowpass'
  dry.frequency.value = 2600
  const delay = ctx.createDelay(1.5)
  delay.delayTime.value = 0.36
  const fb = ctx.createGain()
  fb.gain.value = 0.26
  const wet = ctx.createGain()
  wet.gain.value = 0.3

  master.connect(dry)
  dry.connect(ctx.destination)
  master.connect(delay)
  delay.connect(fb)
  fb.connect(delay)
  delay.connect(wet)
  wet.connect(ctx.destination)
  return ctx
}

function playNote(ev, at) {
  const t = trackById(trackId.value)
  const beat = 60 / t.bpm
  const dur = Math.max(0.12, ev.dur * beat)
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = ev.voice === 'pad' ? 'triangle' : 'sine'
  osc.frequency.value = noteFreq(ev.midi)
  // 铺底慢起慢落，琶音快起快落：这是"背景音乐"而不是"提示音"的关键
  const attack = ev.voice === 'pad' ? Math.min(1.6, dur * 0.45) : 0.07
  const release = ev.voice === 'arp' ? 0.6 : Math.min(2.4, dur * 0.7)
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, ev.gain), at + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur + release)
  osc.connect(g)
  g.connect(master)
  osc.start(at)
  osc.stop(at + dur + release + 0.05)
  live.add(osc)
  osc.onended = () => live.delete(osc)
}

function schedule() {
  if (!ctx || !playing.value) return
  const t = trackById(trackId.value)
  const beat = 60 / t.bpm
  const horizon = ctx.currentTime + LOOKAHEAD
  let guard = 0
  while (nextBarTime < horizon && guard++ < 8) {
    for (const ev of notesForBar(t, nextBar)) playNote(ev, nextBarTime + ev.t * beat)
    nextBar++
    nextBarTime += barSeconds(t)
  }
  elapsed.value = playedBase + Math.max(0, ctx.currentTime - startedAt)
}

/** 把所有在发声的振荡器在指定时刻收尾（不"砍断"，避免咔声） */
function releaseAll(at) {
  for (const osc of live) { try { osc.stop(at) } catch { /* 已经停了 */ } }
  live.clear()
}

async function start() {
  const c = ensureCtx()
  if (!c) return false
  // 用户手势里 resume —— 这是浏览器允许出声的唯一时机
  if (c.state === 'suspended') { try { await c.resume() } catch { /* 拿不到就静默 */ } }
  playing.value = true
  nextBar = 0
  nextBarTime = c.currentTime + 0.12
  startedAt = c.currentTime
  schedule()
  master.gain.cancelScheduledValues(c.currentTime)
  master.gain.setValueAtTime(0.0001, c.currentTime)
  master.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume.value), c.currentTime + 1.4)
  if (!timer) timer = setInterval(schedule, TICK)
  return true
}

function pause() {
  if (!ctx) { playing.value = false; return }
  playing.value = false
  playedBase = elapsed.value
  const now = ctx.currentTime
  master.gain.cancelScheduledValues(now)
  master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now)
  master.gain.exponentialRampToValueAtTime(0.0001, now + 0.7)
  releaseAll(now + 0.8)
  if (timer) { clearInterval(timer); timer = null }
}

function toggle() { return playing.value ? (pause(), false) : start() }

function setVolume(v) {
  volume.value = clampVolume(v, volume.value)
  if (ctx && playing.value) {
    const now = ctx.currentTime
    master.gain.cancelScheduledValues(now)
    master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now)
    master.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume.value), now + 0.25)
  }
}

/** 换曲：正在播就重启调度（同一条上下文，不重建） */
async function setTrack(id) {
  trackId.value = trackById(id).id
  if (playing.value) { pause(); elapsed.value = 0; playedBase = 0; await start() }
}

function nextTrack() {
  const i = TRACKS.findIndex(t => t.id === trackId.value)
  return setTrack(TRACKS[(i + 1) % TRACKS.length].id)
}
function prevTrack() {
  const i = TRACKS.findIndex(t => t.id === trackId.value)
  return setTrack(TRACKS[(i - 1 + TRACKS.length) % TRACKS.length].id)
}

/** 页面卸载/关闭插件时调用：停声 + 关上下文，别留后台占资源 */
function dispose() {
  pause()
  if (ctx) { try { ctx.close() } catch { /* 已关 */ } }
  ctx = null; master = null
}

export function useBgmPlayer() {
  return {
    playing, trackId, track, volume, elapsed, clock, supported, tracks: TRACKS,
    start, pause, toggle, setVolume, setTrack, nextTrack, prevTrack, dispose,
  }
}
