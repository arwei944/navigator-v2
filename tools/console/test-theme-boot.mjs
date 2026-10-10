/**
 * 主题「启动时序」守卫：持久化回填 → 补应用的那一段。
 *
 * 为什么单独一个套件：这里的 bug 有个很难看的特征 —— **它不会报错，只会不生效**。
 * pinia-plugin-persistedstate 是在 store 的 setup **返回之后**才回填持久化状态
 * （`hydrateStore → store.$patch`，同步执行），而主题 store 的启动动作原先写在 setup 主体里，
 * 于是 `follow` / `activeId` 读到的永远是默认值：
 *   「跟随系统」「日落自动换深色」「自建主题刷新后补应用」三条刷新后一次都没跑过。
 * 静态看一眼代码是「对的」，只有把真实 store 建起来、走一遍回填才看得出来。
 *
 * 同时守第二件事：预设配色的两条**延迟落色**路径（themePreset 的 watcher、
 * 明暗切换后 `setTimeout(…, 10)` 的重放）不许把自建主题的配色盖掉。
 *
 * 做法：给 Node 垫一层最小的 browser 替身（document / localStorage / matchMedia），
 * 用项目真实配置（Vite ssrLoadModule）加载 store 源码，零新增依赖。
 *
 * 运行：node tools/console/test-theme-boot.mjs
 */
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

/* ══════════ 浏览器替身 ══════════ */

const cssVars = new Map()
const attrs = new Map()
const mem = new Map()
/** 系统明暗：由场景切换 */
let systemDark = false
/** 注册过的定时器（真的跑 60s 轮询会把测试进程挂住，只记账不执行） */
const intervals = []

const documentStub = {
  documentElement: {
    style: {
      setProperty(k, v) { cssVars.set(k, String(v)) },
      removeProperty(k) { cssVars.delete(k) },
      getPropertyValue(k) { return cssVars.get(k) || '' },
    },
    setAttribute(k, v) { attrs.set(k, String(v)) },
    getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null },
    removeAttribute(k) { attrs.delete(k) },
  },
}

const localStorageStub = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)) },
  removeItem: k => { mem.delete(k) },
  clear: () => mem.clear(),
  key: i => [...mem.keys()][i] ?? null,
  get length() { return mem.size },
}

const quietLogger = {
  info() {}, warn() {}, warnOnce() {}, clearScreen() {}, hasWarned: false,
  error(msg) { if (!/WebSocket server error/.test(String(msg))) console.error(msg) },
}

/**
 * 先起 Vite、再挂 DOM 替身，顺序不能反：
 * `@vue/runtime-dom` 在模块求值时会探测 `document`（`doc && doc.createElement('template')`），
 * 半成品替身会让它以为有真实 DOM 而炸在配置加载阶段。
 * SSRLoad 出来的 store 里对 `document` 的引用都是**调用时**取全局，所以后挂一样生效。
 */
const server = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'error',
  customLogger: quietLogger,
})

globalThis.document = documentStub
globalThis.localStorage = localStorageStub
globalThis.window = {
  matchMedia: () => ({
    matches: systemDark, media: '(prefers-color-scheme: dark)',
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  }),
}
globalThis.setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length }

/* ══════════ 装载 store（必须用真实 pinia 实例） ══════════ */

// pinia 走**裸 import**：过 ssrLoadModule 会拿到另一个模块实例，setActivePinia 在 store 那边看不见
const { createPinia, setActivePinia } = await import('pinia')
const { createApp } = await import('vue')
const persistPlugin = (await import('pinia-plugin-persistedstate')).default

const { bootActions, inSchedule, useThemeStore } = await server.ssrLoadModule('/src/stores/theme.js')
const { usePreferencesStore } = await server.ssrLoadModule('/src/stores/preferences.js')

/**
 * 建一个全新的 pinia 并实例化主题 store —— 等价于「刷新页面」。
 *
 * `createApp({}).use(pinia)` 这一步不能省：pinia 在没有 install 到 app 之前，
 * `pinia.use()` 只是把插件排进 `toBeInstalled`，要到 `install()` 才真正挂上 ——
 * 少了它，持久化插件根本不会跑，本套件会「全都通过」但什么都没测到。
 */
function reload() {
  const pinia = createPinia()
  pinia.use(persistPlugin)
  createApp({}).use(pinia)
  setActivePinia(pinia)
  const theme = useThemeStore()
  return { theme, prefs: usePreferencesStore() }
}

/** 写一份持久化数据（插件把整份 state + 版本号存成一个 JSON 串） */
function seed(key, state) {
  mem.set(key, JSON.stringify({ ...state, __navDataVersion: 2 }))
}

const CUSTOM = {
  id: 'user:test1',
  kind: 'custom',
  name: '测试主题',
  base: 'paper',
  colors: {
    light: { bg: '#fffdf7', bgWhite: '#fffdf7', sidebarBg: '#f7f3e8', accent: '#1f6f5c', accentLight: '#d9ece5' },
    dark: { bg: '#101315', bgWhite: '#171b1e', sidebarBg: '#141819', accent: '#7fd1bb', accentLight: '#1d3b34' },
  },
  tokens: { radiusCard: 4 },
}

/** 微任务之后才是「回填完成、补应用已做」，10ms 那一步是让预设重放有机会露头 */
const settle = async () => { await Promise.resolve(); await new Promise(r => setTimeout(r, 25)) }

try {
  /* ══════════ 1. 行为等价：从没选过主题的用户，刷新后外观一个字节都不变 ══════════ */

  mem.clear()
  {
    const { theme, prefs } = reload()
    const schemeBefore = prefs.visualScheme
    const themeBefore = prefs.theme
    await settle()
    eq(prefs.visualScheme, schemeBefore, '没主动选过主题时不覆盖 preferences.visualScheme')
    eq(prefs.theme, themeBefore, '没主动选过主题时不改明暗')
    eq(theme.activeId, '', 'activeId 保持为空（沿用 preferences 现状）')
    eq(theme.isCustomActive, false, '没有自建主题在生效')
  }

  /* ══════════ 2. 自建主题：刷新后必须被补应用 ══════════ */

  mem.clear()
  seed('theme', { customThemes: [CUSTOM], activeId: CUSTOM.id, follow: 'manual', schedule: { from: '19:00', to: '07:00' } })
  {
    const { prefs } = reload()
    await settle()
    eq(prefs.visualScheme, 'paper', '自建主题的 base 方案被重新落上（不再退回基础方案）')
    eq(cssVars.get('--accent'), CUSTOM.colors.light.accent,
      '自建主题的 accent 生效，且**没有被排队的预设重放盖掉**')
    eq(prefs.visualOverrides.radiusCard, 4, '自建主题的令牌覆盖被重新落上')
  }

  /* ══════════ 3. 自建主题 + 切暗色：逐模式的配色要跟着换 ══════════ */

  {
    const { prefs } = reload()
    await settle()
    prefs.toggleTheme()
    await settle()
    eq(prefs.theme, 'dark', '明暗已切到暗色')
    eq(attrs.get('data-theme'), 'dark', 'data-theme 跟着切')
    eq(cssVars.get('--accent'), CUSTOM.colors.dark.accent,
      '暗色下用的是自建主题的暗色配色（预设重放没有把它盖回预设值）')
  }

  /* ══════════ 4. 跟随系统：刷新后就要跟，不能等系统变化才跟 ══════════ */

  for (const [dark, expected] of [[true, 'dark'], [false, 'light']]) {
    mem.clear()
    systemDark = dark
    seed('theme', { customThemes: [], activeId: '', follow: 'system', schedule: { from: '19:00', to: '07:00' } })
    const { prefs } = reload()
    await settle()
    eq(prefs.theme, expected, `follow=system 且系统为 ${expected} 时刷新后即为 ${expected}`)
  }
  systemDark = false

  /* ══════════ 5. 定时切换：刷新后立刻判定一次（轮询负责之后每分钟纠正） ══════════ */

  {
    const now = new Date()
    const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    const within = { from: hhmm(now), to: hhmm(new Date(now.getTime() + 60_000)) }
    const outside = { from: hhmm(new Date(now.getTime() + 120_000)), to: hhmm(new Date(now.getTime() + 180_000)) }

    mem.clear()
    seed('theme', { customThemes: [], activeId: '', follow: 'schedule', schedule: within })
    const inside = reload()
    await settle()
    eq(inside.prefs.theme, 'dark', '定时区间包含当前时刻 → 刷新后即为暗色')

    mem.clear()
    seed('theme', { customThemes: [], activeId: '', follow: 'schedule', schedule: outside })
    const out = reload()
    await settle()
    eq(out.prefs.theme, 'light', '定时区间不包含当前时刻 → 刷新后即为浅色')

    ok(intervals.some(i => i.ms === 60_000), '定时轮询已注册（休眠唤醒后靠它纠回状态）')
  }

  /* ══════════ 6. 决策表：bootActions 是纯函数，边界全在这里钉死 ══════════ */

  eq(bootActions({ follow: 'manual', activeId: '', customIds: [] }).join(','), '',
    '什么都没选过 → 不补任何动作')
  eq(bootActions({ follow: 'system' }).join(','), 'system', 'follow=system → 补跟随系统')
  eq(bootActions({ follow: 'schedule' }).join(','), 'schedule', 'follow=schedule → 补定时判定')
  eq(bootActions({ activeId: 'builtin:paper', customIds: ['builtin:paper'] }).join(','), '',
    '内置主题不补应用（preferences 里已经存着它，补了反而会多覆盖一次）')
  eq(bootActions({ activeId: 'user:x', customIds: ['user:x'] }).join(','), 'apply',
    '自建主题在列表里 → 补应用')
  eq(bootActions({ activeId: 'user:gone', customIds: [] }).join(','), '',
    '自建主题已被删除 → 不乱应用（否则会拿一份不存在的主题去覆盖外观）')
  eq(bootActions({ follow: 'system', activeId: 'user:x', customIds: ['user:x'] }).join(','), 'system,apply',
    '跟随系统与补应用可以同时成立')

  /* ══════════ 7. inSchedule 边界（跨零点是最容易写反的一处） ══════════ */

  const at = (h, m) => new Date(2026, 0, 1, h, m)
  ok(inSchedule(at(20, 0), { from: '19:00', to: '07:00' }), '跨零点区间：晚 20 点在区间内')
  ok(inSchedule(at(3, 0), { from: '19:00', to: '07:00' }), '跨零点区间：凌晨 3 点在区间内')
  ok(!inSchedule(at(12, 0), { from: '19:00', to: '07:00' }), '跨零点区间：中午 12 点不在区间内')
  ok(inSchedule(at(20, 0), { from: '19:00', to: '23:00' }), '同日区间：边界内含起点')
  ok(!inSchedule(at(23, 0), { from: '19:00', to: '23:00' }), '同日区间：不含终点（避免两段区间重叠处反复切换）')
  /* ══════════ 7. 启动接线：App 必须真的把主题 store 建起来 ══════════
     上面第 2~5 条是「store 建起来之后时序对不对」；这一条补上另一半 ——
     真实应用里根本没有创建它。主题设置面板是按需加载的，如果只靠它去 `useThemeStore()`，
     跟随系统/日落切换/自建主题补应用这三条在刷新后依旧一次都不会发生。
     纯静态检查够用：这是接线，不是逻辑。 */

  const appSrc = readFileSync(new URL('../../src/App.vue', import.meta.url), 'utf-8')
  ok(/useThemeStore\s*\(/.test(appSrc), 'App.vue 在启动时实例化了主题 store（否则整套启动行为不会被触发）')
  ok(/usePreferencesStore\s*\(/.test(appSrc), 'App.vue 仍在启动时实例化 preferences（抽掉它同样会让外观不生效）')
} finally {
  await server.close()
}

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ 主题启动时序 ${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 主题启动时序全部通过：${pass} 条断言`)
// 垫了全局 setInterval 替身，但保险起见还是显式退出，避免将来有人真起定时器把进程挂住
process.exit(0)
