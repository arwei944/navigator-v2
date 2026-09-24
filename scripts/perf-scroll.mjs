/**
 * 卡片虚拟化滚动基准测试：生成一个自包含 HTML，模拟 N 站点卡片网格，
 * 自动滚动并用 requestAnimationFrame 统计帧率，对比 content-visibility 开/关。
 * 用法: node scripts/perf-scroll.mjs [--count 1000]
 * 产物: perf-report/scroll-bench.html（浏览器打开-http 服务器-点“开始自动滚动”）
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs({
  args: process.argv.slice(2),
  options: { count: { type: 'string', short: 'c' } },
  allowPositionals: false
})
const COUNT = args.values.count !== undefined ? Number(args.values.count) : 1000

const colors = ['#22c55e', '#0ea5e9', '#8b5cf6', '#f97316', '#ef4444', '#eab308', '#ec4899', '#14b8a6']
const descs = [
  'AI 对话助手，支持文本生成与多轮问答',
  '数据分析与可视化工具',
  '开发者常用技术文档与社区',
  '加密货币行情跟踪与资讯聚合',
  '云端存储与协作办公套件',
  '开源代码托管与版本管理',
  '实时协作笔记与知识库',
  '在线设计工具与素材资源',
]
function card(i) {
  const color = colors[i % colors.length]
  const desc = descs[i % descs.length]
  const name = `站点 ${i + 1}`
  return `<div class="card" style="--c:${color}" title="${desc}">
      <span class="icon" style="background:${color}">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>
        </svg>
      </span>
      <span class="meta">
        <span class="name">${name}</span>
        <span class="url">example-${i}.io</span>
        <span class="desc">${desc}</span>
      </span>
      <span class="badge">收录</span>
    </div>`
}

function cardsHtml() {
  let out = ''
  for (let i = 0; i < COUNT; i++) out += card(i)
  return out
}

const injectedCards = cardsHtml()

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>卡片虚拟化滚动基准（${COUNT} 卡片）</title>
<style>
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; }
.toolbar {
  position: fixed; top: 0; left: 0; right: 0; z-index: 10; padding: 14px 24px;
  display: flex; align-items: center; gap: 20px; flex-wrap: wrap;
  background: rgba(15,23,42,.92); border-bottom: 1px solid #334155; backdrop-filter: blur(8px);
}
.toolbar .label { font-size: 14px; font-weight: 700; }
.stat { font-size: 13px; color: #7dd3fc; min-width: 13ch; }
.stat b { color: #fff; }
button { padding: 6px 14px; border: 1px solid #334155; border-radius: 8px; background: #1e293b; color: #e2e8f0; cursor: pointer; font-size: 13px; }
button.active { background: #0ea5e9; color: #fff; border-color: #0ea5e9; }
.verdict { font-size: 14px; }
.verdict.good { color: #4ade80; }
.verdict.bad { color: #f87171; }
.cards-grid { margin-top: 68px; padding: 20px; display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
.card {
  display: flex; align-items: flex-start; gap: 12px; padding: 16px; border-radius: 12px;
  background: linear-gradient(160deg, #1e293b, #263449 120%); border: 1px solid #334155;
  min-height: 96px; box-shadow: 0 1px 0 rgba(255,255,255,.04);
  transition: transform .15s ease, border-color .15s ease;
}
.card:hover { transform: translateY(-2px); border-color: var(--c, #0ea5e9); }
.card .icon {
  width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center;
  justify-content: center; flex-shrink: 0; box-shadow: 0 2px 6px color-mix(in srgb, var(--c) 40%, transparent);
}
.card .icon svg { width: 22px; height: 22px; }
.card .meta { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
.card .name { font-size: 14px; font-weight: 600; }
.card .url { font-size: 11px; color: #7dd3fc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card .desc { font-size: 11px; color: #64748b; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card .badge { font-size: 10px; color: #cbd5e1; padding: 2px 8px; border-radius: 10px; background: #334155; flex-shrink: 0; }

/* content-visibility 虚拟化开关（与 CardsContainer 一致的方案） */
html.cv .card { content-visibility: auto; contain-intrinsic-size: auto 96px; }
</style>
</head>
<body>
<div class="toolbar">
  <span class="label">🎯 卡片虚拟化滚动基准</span>
  <button id="btn-run">开始自动滚动</button>
  <button id="btn-cv" class="active">content-visibility: ON</button>
  <span class="stat">目标 <b>60fps</b></span>
  <span class="stat">平均 <b id="fps-avg">-</b> fps</span>
  <span class="stat">最低 <b id="fps-min">-</b> fps</span>
  <span class="stat">延迟样本 <b id="drops">-</b></span>
  <span class="verdict" id="verdict"></span>
</div>
<div class="cards-grid" id="grid"></div>

<script>
const N = ${COUNT};
const grid = document.getElementById('grid');
grid.innerHTML = ${JSON.stringify(injectedCards)};
document.title = '卡片虚拟化滚动基准（' + N + ' 卡片）';

const btnRun = document.getElementById('btn-run');
const btnCv = document.getElementById('btn-cv');
const elAvg = document.getElementById('fps-avg');
const elMin = document.getElementById('fps-min');
const elDrops = document.getElementById('drops');
const elVerdict = document.getElementById('verdict');
let running = false;

btnCv.addEventListener('click', () => {
  document.documentElement.classList.toggle('cv');
  btnCv.textContent = document.documentElement.classList.contains('cv') ? 'content-visibility: ON' : 'content-visibility: OFF';
  btnCv.classList.toggle('active', document.documentElement.classList.contains('cv'));
});

btnRun.addEventListener('click', () => {
  if (running) return;
  running = true;
  btnRun.disabled = true;
  const SEC = 5;
  const RATE = 1400; // px/s 滚动速度
  const samples = [];     // 每 100ms 采一次瞬时 fps
  let frames = 0, min = Infinity, drops = 0;
  let last = performance.now(), t0 = last, windowStart = last;

  function loop(t) {
    const d = (t - t0) / 1000;
    window.scrollTo(0, d * RATE);
    frames++;
    if (t - windowStart >= 100) {
      const fps = frames * 1000 / (t - windowStart);
      samples.push(fps);
      min = Math.min(min, fps);
      if (fps < 50) drops++;
      frames = 0; windowStart = t;
      if (fps < 30) elVerdict.textContent = '滑过卡顿区…';
    }
    if (d < SEC) {
      requestAnimationFrame(loop);
    } else {
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      elAvg.textContent = avg.toFixed(1);
      elMin.textContent = min.toFixed(1);
      elDrops.textContent = drops;
      const mode = document.documentElement.classList.contains('cv') ? 'ON' : 'OFF';
      const good = avg >= 55 && min >= 45;
      elVerdict.textContent = mode + ' · ' + (good ? '✅ 60fps 达标' : '⚠️ 未达 60fps');
      elVerdict.className = 'verdict ' + (good ? 'good' : 'bad');
      running = false;
      btnRun.disabled = false;
    }
  }
  requestAnimationFrame(loop);
});
</script>
</body>
</html>`

const outDir = join(root, 'perf-report')
mkdirSync(outDir, { recursive: true })
const file = join(outDir, 'scroll-bench.html')
writeFileSync(file, html, 'utf-8')
console.log(`✅ 已生成压测基准: ${file}（${COUNT} 张卡片，更接近真实站点卡片）`)
console.log('   用法：在该目录起 http 服务器（python -m http.server 5500）→ 浏览器打开 → 点"开始自动滚动"')
console.log('   切换 content-visibility ON/OFF 各测一次，5 秒后显示平均/最低帧率与达标判定。')