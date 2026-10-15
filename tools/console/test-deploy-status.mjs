/**
 * 部署状态接口用例：零依赖、不联网（读的是本机 store 与构建产物）。
 *
 * 守的核心是**边界**，不是字段名：
 *  1. 它是**公开**接口（后台面板在登录前就要显示）—— 因此绝不允许漏出任何凭据材料；
 *  2. `data/` 是这个项目放管理密钥与 SQLite 的地方，状态里只许出现**汇总数字**，
 *     不能出现文件名（`admin-key.txt` 这个字符串出现一次就等于给出了攻击目标）；
 *  3. 构建信息缺失、站点库读不到这类**降级**必须如实标注，不能编一个看起来正常的假值。
 *
 * 运行：node tools/console/test-deploy-status.mjs
 */
import handler from '../../api/deploy-status.js'

let pass = 0
const failures = []
function ok(cond, label, extra = '') {
  if (cond) { pass++; return }
  failures.push(`${label}${extra ? ` — ${extra}` : ''}`)
}
function eq(actual, expected, label) {
  ok(actual === expected, label, `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}

/** 极简 res 替身：够 handler 用（setHeader + json + statusCode） */
function fakeRes() {
  const state = { code: 200, body: null, headers: {} }
  return {
    setHeader: (k, v) => { state.headers[String(k).toLowerCase()] = v },
    json: (o) => { state.body = o; return o },
    get statusCode() { return state.code },
    set statusCode(v) { state.code = v },
    get body() { return state.body },
    get headers() { return state.headers },
  }
}

/* ---------------- 正常读取 ---------------- */

const res = fakeRes()
await handler({ method: 'GET' }, res)
const j = res.body

eq(res.statusCode, 200, 'GET 返回 200')
ok(j && j.ok === true, '响应 ok:true')

for (const key of ['version', 'runtime', 'data', 'storage', 'cron']) {
  ok(j && typeof j[key] === 'object' && j[key] !== null, `含 ${key} 区块`)
}

eq(typeof j.version.available, 'boolean', 'version.available 是布尔（缺构建信息时不编假值）')
ok(typeof j.runtime.node === 'string' && j.runtime.node.length > 0, 'runtime.node 非空', j.runtime.node)
eq(typeof j.runtime.uptimeSec, 'number', 'uptimeSec 是数字')
eq(typeof j.runtime.persistent, 'boolean', 'persistent 是布尔（沙箱每请求新进程要能识别）')
eq(typeof j.storage.bytes, 'number', 'storage.bytes 是数字')
eq(typeof j.storage.files, 'number', 'storage.files 是数字')
eq(typeof j.cron.started, 'boolean', 'cron.started 是布尔')
ok(typeof j.checkedAt === 'string' && !Number.isNaN(Date.parse(j.checkedAt)), 'checkedAt 是合法时间')

/* ---------------- 边界：绝不能出现的东西 ---------------- */

const flat = JSON.stringify(j).toLowerCase()

// ① 凭据材料。这个接口公开，出现任何一个都是事故。
for (const word of ['admin-key', 'adminkey', 'admin_key', 'secret', 'password', 'passwd',
  'apikey', 'api_key', 'token', 'bearer', 'credential']) {
  ok(!flat.includes(word), `响应不含「${word}」`, '')
}

// ② data/ 下的文件名。哪怕只有一个也等于告诉外面「这里有密钥文件」。
for (const name of ['admin-key.txt', 'admin-password-hash.txt', 'ai-config.json', 'store.db', '.env']) {
  ok(!flat.includes(name), `响应不含文件名「${name}」`, '')
}

// ③ 站点内容不进状态接口：只回数量与版本，不回任何一条站点的名字或网址。
ok(!flat.includes('"sites"'), '响应不回传站点数组本体')
ok(!flat.includes('http://') && !flat.includes('https://'), '响应里没有任何 URL')

/* ---------------- 缓存与降级 ---------------- */

ok(String(res.headers['cache-control'] || '').includes('no-store'), '带 no-store（状态不能被缓存）')

// 构建信息不在时（本地开发 / 旧发布包）必须如实说不存在
ok(j.version.available === true || j.version.available === false, 'version.available 取值明确')
if (!j.version.available) {
  eq(j.version.sha, '', '不可用时 sha 为空串而不是编造的')
}

/* ---------------- 方法白名单 ---------------- */

const post = fakeRes()
await handler({ method: 'POST' }, post)
eq(post.statusCode, 405, 'POST 返回 405')
ok(post.body && post.body.ok === false, 'POST 响应 ok:false')

/* ---------------- 结果 ---------------- */

if (failures.length) {
  console.error(`\n❌ 部署状态 ${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.slice(0, 12).forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 部署状态全部通过：${pass} 条断言`)
