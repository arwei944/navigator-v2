<template>
  <section class="settings-section">
    <div class="section-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      <span>背景音乐</span>
    </div>

    <div class="setting-row">
      <label class="setting-toggle">
        <span class="setting-label">播放背景音乐</span>
        <input type="checkbox" :checked="prefs.bgmOn" @change="prefs.setBgmOn($event.target.checked)" />
        <span class="toggle-track"><span class="toggle-thumb"></span></span>
      </label>
    </div>

    <template v-if="prefs.bgmOn">
      <div class="setting-row">
        <div class="setting-label">曲目</div>
        <div class="theme-toggle-wrapper">
          <button
            v-for="t in tracks" :key="t.id"
            class="theme-toggle-btn" :class="{ active: prefs.bgmTrack === t.id }"
            :title="t.desc" @click="pickTrack(t.id)"
          >{{ t.label }}</button>
        </div>
      </div>
      <div class="setting-row">
        <div class="setting-label">音量 {{ Math.round(prefs.bgmVolume * 100) }}%</div>
        <input
          class="bgm-range" type="range" min="0" max="0.8" step="0.02"
          :value="prefs.bgmVolume" aria-label="背景音乐音量" @input="onVolume"
        >
      </div>
      <div class="section-note">
        音源是<b>程序实时合成</b>（不是音频文件）：没有素材版权问题、不占下载体积、离线也能响。
        浏览器禁止页面自动出声，所以是<b>第一次点击/按键之后</b>才响起；右下角有播放器，随时可暂停或关闭。
      </div>
    </template>
    <div v-else class="section-note">
      打开后右下角会出现一个播放器。音源为实时合成，无版权素材、不增加下载体积。
    </div>
  </section>
</template>

<script setup>
import { usePreferencesStore } from '@/stores/preferences'
import { TRACKS as tracks } from '@/utils/bgmScore'

const prefs = usePreferencesStore()

// 这里**只写偏好**，不直接碰播放器：偏好是唯一真源，播放器 watch 它。
// 单向数据流，避免「两处各存一份、谁覆盖谁说不清」；顺带也让设置面板与播放器
// 不再共享同一个 chunk（共享会把播放器代码并进 35 KiB 的设置面板包里）。
function pickTrack(id) { prefs.setBgmTrack(id) }
function onVolume(e) { prefs.setBgmVolume(e.target.value) }
</script>

<style scoped>
.settings-section { padding: 16px 0; border-bottom: 1px solid var(--border-light); }
.settings-section:last-child { border-bottom: none; }
.section-header { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 14px; }
.section-header svg { width: 16px; height: 16px; color: var(--accent); opacity: 0.8; }
.setting-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; gap: 16px; }
.setting-label { font-size: 13px; color: var(--text-secondary); white-space: nowrap; }
.theme-toggle-wrapper { display: flex; gap: 4px; background: var(--border-light); padding: 3px; border-radius: 8px; }
.theme-toggle-btn { padding: 5px 12px; border: none; border-radius: 6px; background: transparent; color: var(--text-secondary); font-size: 12px; font-weight: 500; cursor: pointer; transition: all var(--dur-fast) ease; font-family: var(--font); }
.theme-toggle-btn.active { background: var(--bg-white); color: var(--text-primary); box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.setting-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; cursor: pointer; }
.setting-toggle input { display: none; }
.toggle-track { width: 38px; height: 22px; background: var(--border); border-radius: 11px; position: relative; transition: background var(--dur-base) ease; flex-shrink: 0; }
.setting-toggle input:checked + .toggle-track { background: var(--accent); }
.toggle-thumb { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform var(--dur-base) ease; box-shadow: 0 1px 3px rgba(0,0,0,.15); }
.setting-toggle input:checked + .toggle-track .toggle-thumb { transform: translateX(16px); }
.section-note { font-size: 11px; line-height: 1.6; color: var(--text-secondary); opacity: 0.7; padding: 2px 0 4px; }
.bgm-range { width: 180px; accent-color: var(--accent); cursor: pointer; }
</style>
