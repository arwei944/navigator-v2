/**
 * 背景音乐的音符生成（纯函数）。
 *
 * 为什么用**程序合成**而不是音频文件：
 *   · 这个站点是公开可访问的，放有版权的歌＝公开传播；而 CC0 素材又要挑、又要打包体积；
 *   · 合成出来的东西零素材、零版权、离线可用，代码本身就是"曲子"。
 * 代价是它听起来是**环境音乐**（pad + 琶音 + 低音），不是带歌词的歌 —— 这正是"背景音乐"要的。
 *
 * 抽成纯函数的原因：调度逻辑一旦写错不是变难听，是**炸音**（叠音/爆音/无限增长）。
 * 音符序列可复现、可断言，才能被纯 node 测试钉住。
 */

/** MIDI 音号 → 频率（A4 = 69 = 440Hz） */
export function noteFreq(midi) {
  return 440 * Math.pow(2, (Number(midi) - 69) / 12)
}

/** 同一份种子永远给同一串随机数：曲子不能每听一遍都不一样 */
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashStr(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

/**
 * 三首内置曲目。和弦进行都是常见的四小节循环（听感稳、不刺耳）：
 *   黄昏 Am–F–C–G ／ 清晨 C–G–Am–F ／ 夜行 Dm–B♭–F–C
 */
export const TRACKS = [
  {
    id: 'dusk',
    label: '黄昏',
    desc: '慢速铺底 + 稀疏琶音，适合长时间挂着',
    bpm: 56,
    beatsPerBar: 4,
    chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
    arpPool: [69, 72, 76, 79, 81],
    arpPerBar: 3,
    padGain: 0.16,
    bassGain: 0.20,
    arpGain: 0.09,
  },
  {
    id: 'dawn',
    label: '清晨',
    desc: '明亮一点，琶音更密',
    bpm: 66,
    beatsPerBar: 4,
    chords: [[48, 52, 55], [55, 59, 62], [57, 60, 64], [53, 57, 60]],
    arpPool: [72, 76, 79, 84, 88],
    arpPerBar: 5,
    padGain: 0.13,
    bassGain: 0.18,
    arpGain: 0.085,
  },
  {
    id: 'night',
    label: '夜行',
    desc: '更暗、更慢，低音重一些',
    bpm: 50,
    beatsPerBar: 4,
    chords: [[50, 53, 57], [46, 50, 53], [41, 45, 48], [48, 52, 55]],
    arpPool: [74, 77, 81, 86],
    arpPerBar: 2,
    padGain: 0.17,
    bassGain: 0.24,
    arpGain: 0.075,
  },
]

export const DEFAULT_TRACK = TRACKS[0].id

/** 按 id 取曲目；认不出来就回第一首（偏好数据坏了不该让播放器打不开） */
export function trackById(id) {
  return TRACKS.find(t => t.id === id) || TRACKS[0]
}

/** 第 bar 小节用哪个和弦（四小节循环） */
export function chordAt(track, bar) {
  const list = track?.chords || TRACKS[0].chords
  const i = ((Number(bar) || 0) % list.length + list.length) % list.length
  return list[i]
}

/**
 * 生成一个小节的音符事件。
 * @returns {Array<{t:number,midi:number,dur:number,gain:number,voice:'pad'|'bass'|'arp'}>} t 与 dur 以「拍」为单位
 */
export function notesForBar(track, bar) {
  const t = track || TRACKS[0]
  const chord = chordAt(t, bar)
  const barBeats = t.beatsPerBar || 4
  const out = []

  // 铺底：整小节 3 个音，弱起强收
  for (const midi of chord) {
    out.push({ t: 0, midi, dur: barBeats, gain: t.padGain, voice: 'pad' })
  }
  // 低音：小节开头一个长音（比和弦低八度）
  out.push({ t: 0, midi: chord[0] - 12, dur: barBeats, gain: t.bassGain, voice: 'bass' })

  // 琶音：位置与音高都由「曲目 + 小节号」决定 —— 同一小节每次生成结果一致
  const rnd = mulberry32(hashStr(t.id) + (Number(bar) || 0) * 2654435761)
  const n = Math.max(0, t.arpPerBar || 0)
  for (let i = 0; i < n; i++) {
    const slot = rnd()
    const pick = t.arpPool[Math.floor(rnd() * t.arpPool.length) % t.arpPool.length]
    out.push({
      t: +(slot * (barBeats - 1)).toFixed(3),
      midi: pick,
      dur: 1.6,
      gain: +(t.arpGain * (0.7 + rnd() * 0.5)).toFixed(4),
      voice: 'arp',
    })
  }
  return out.sort((a, b) => a.t - b.t)
}

/** 每小节的秒数 */
export function barSeconds(track) {
  const t = track || TRACKS[0]
  return (60 / (t.bpm || 60)) * (t.beatsPerBar || 4)
}

/** 音量钳制：0–1，且给一个"听得到但不吵"的上限，别让人一开就被吓到 */
export const MAX_VOLUME = 0.8
export function clampVolume(v, fallback = 0.35) {
  if (v === null || v === undefined || v === '') return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.min(MAX_VOLUME, Math.round(n * 100) / 100))
}

/** 秒 → mm:ss（播放器上显示的已播时长） */
export function fmtClock(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
