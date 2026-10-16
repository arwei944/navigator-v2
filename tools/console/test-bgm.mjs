/**
 * 背景音乐的音符生成：noteFreq / chordAt / notesForBar / barSeconds / clampVolume / fmtClock。
 *
 * 盯的是两类事故：
 *   ① 同一小节生成出不同的音符 → 曲子每次听起来都在变，像坏了；
 *   ② 音符跑到小节之外或增益越界 → 调度器会叠音/爆音（不是"难听"，是刺耳）。
 */
import {
  noteFreq, TRACKS, DEFAULT_TRACK, trackById, chordAt, notesForBar, barSeconds,
  clampVolume, fmtClock, MAX_VOLUME,
} from '../../src/utils/bgmScore.js'

let pass = 0
const failures = []
function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}
function near(actual, expected, tol, label) {
  ok(Math.abs(actual - expected) <= tol, label, `期望 ≈${expected}（±${tol}），实得 ${actual}`)
}

/* ---- 音高换算 ---- */
eq(noteFreq(69), 440, 'A4 = 440Hz')
near(noteFreq(81), 880, 1e-9, '高八度 = 两倍频率')
near(noteFreq(57), 220, 1e-9, '低八度 = 一半频率')
ok(noteFreq(60) > 261 && noteFreq(60) < 262, '中央 C ≈ 261.6Hz', String(noteFreq(60)))

/* ---- 曲目表本身要成立 ---- */
eq(TRACKS.length, 3, '内置三首曲目')
eq(new Set(TRACKS.map(t => t.id)).size, 3, '曲目 id 不重复')
eq(trackById(DEFAULT_TRACK).id, DEFAULT_TRACK, '默认曲目取得到')
eq(trackById('不存在的曲目').id, TRACKS[0].id, '认不出的曲目 id 回落到第一首（偏好坏了不该打不开）')
for (const t of TRACKS) {
  ok(t.bpm >= 40 && t.bpm <= 90, `${t.label}：速度在 40–90 之间`, `${t.bpm}`)
  ok(t.chords.length === 4 && t.chords.every(c => c.length === 3), `${t.label}：四小节 × 三音和弦`)
  ok(t.arpPool.length >= 3, `${t.label}：琶音音池够用`, `${t.arpPool.length}`)
  ok(t.padGain > 0 && t.padGain < 0.5 && t.arpGain > 0 && t.arpGain < 0.3, `${t.label}：增益在安全范围`)
}

/* ---- 和弦循环 ---- */
const tk = TRACKS[0]
eq(JSON.stringify(chordAt(tk, 0)), JSON.stringify(chordAt(tk, 4)), '和弦每四小节循环一次')
eq(JSON.stringify(chordAt(tk, 1)), JSON.stringify(chordAt(tk, 5)), '循环偏移一致')
ok(JSON.stringify(chordAt(tk, 0)) !== JSON.stringify(chordAt(tk, 1)), '相邻小节和弦不同')
eq(JSON.stringify(chordAt(tk, -1)), JSON.stringify(chordAt(tk, 3)), '负小节号也能落到正确和弦上')
eq(JSON.stringify(chordAt(null, 0)), JSON.stringify(TRACKS[0].chords[0]), '传空曲目时用默认曲目')

/* ---- 音符生成：可复现、在小节内、增益安全 ---- */
const a1 = notesForBar(tk, 7)
const a2 = notesForBar(tk, 7)
eq(JSON.stringify(a1), JSON.stringify(a2), '同一小节每次生成的音符完全一致（不能每听一遍都变）')
ok(JSON.stringify(notesForBar(tk, 8)) !== JSON.stringify(notesForBar(tk, 7)), '不同小节内容不同')

const pad = a1.filter(n => n.voice === 'pad')
const bass = a1.filter(n => n.voice === 'bass')
const arp = a1.filter(n => n.voice === 'arp')
eq(pad.length, 3, '每小节三个铺底音')
eq(bass.length, 1, '每小节一个低音')
eq(arp.length, tk.arpPerBar, '琶音个数等于曲目设定')

for (const n of a1) {
  ok(n.t >= 0 && n.t < tk.beatsPerBar, `音符落在小节内（t=${n.t}）`)
  ok(n.dur > 0, `音符时长为正（${n.voice}）`)
  ok(n.gain > 0 && n.gain < 1, `增益在 (0,1) 内（${n.voice} ${n.gain}）`)
  ok(Number.isFinite(noteFreq(n.midi)), `音高可换算（midi=${n.midi}）`)
  ok(n.midi >= 20 && n.midi <= 100, `音高在合理音域（midi=${n.midi}）`)
}
const times = a1.map(n => n.t)
eq(JSON.stringify(times), JSON.stringify([...times].sort((x, y) => x - y)), '事件按时间排好序')

// 三首曲目都要能生成，且不越界
for (const t of TRACKS) {
  for (const bar of [0, 1, 3, 9]) {
    const ns = notesForBar(t, bar)
    ok(ns.length === 3 + 1 + t.arpPerBar, `${t.label} 第 ${bar} 小节事件数正确`, String(ns.length))
    ok(ns.every(n => n.t >= 0 && n.t < t.beatsPerBar), `${t.label} 第 ${bar} 小节无越界音符`)
  }
}

/* ---- 小节时长 ---- */
near(barSeconds(tk), (60 / 56) * 4, 1e-9, '小节秒数 = 拍长 × 每小节拍数')
near(barSeconds(null), (60 / TRACKS[0].bpm) * 4, 1e-9, '传空曲目时用默认曲目算')

/* ---- 音量钳制 ---- */
eq(clampVolume(0.35), 0.35, '正常音量原样通过')
eq(clampVolume(0), 0, '允许静音（0）')
eq(clampVolume(5), MAX_VOLUME, '超上限被钳住（别让人一开就被吓到）')
eq(clampVolume(-1), 0, '负值收到 0')
eq(clampVolume(NaN), 0.35, 'NaN → 回落默认')
eq(clampVolume(null), 0.35, 'null → 回落默认')
eq(clampVolume('0.5'), 0.5, '字符串数字也能用')
eq(clampVolume(0.333), 0.33, '取两位小数（音量滑杆的粒度）')

/* ---- 时长格式 ---- */
eq(fmtClock(0), '00:00', '零秒')
eq(fmtClock(65), '01:05', '分秒进位')
eq(fmtClock(3600), '60:00', '一小时')
eq(fmtClock(-5), '00:00', '负值容错')

console.log(`\n背景音乐内核：${pass} 通过 / ${failures.length} 失败`)
if (failures.length) {
  for (const f of failures) console.log('  ✖ ' + f)
  process.exit(1)
}
