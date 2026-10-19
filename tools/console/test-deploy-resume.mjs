/**
 * 断点续传判据守卫：纯函数，不联网、不落盘。
 *
 * 这条判据一旦出错，后果不是「慢一点」而是**线上跑半新半旧的包**：
 * 若指纹比对了错的维度（比如只看分片数），换了内容但片数相同的构建会被当成断点跳过，
 * 于是分片位上是上一版的字节，合并解压出来的是坏包。所以这里把「不满足就不许跳过」
 * 逐条钉住。
 *
 * 运行：node tools/console/test-deploy-resume.mjs
 */
import { sliceFingerprint, shouldResumeUpload } from './lib/publish/deploy.mjs'

let pass = 0
const failures = []
const ok = (cond, label, extra = '') => { if (cond) pass++; else failures.push(`${label}${extra ? ` — ${extra}` : ''}`) }
const eq = (a, b, label) => ok(Object.is(a, b), label, `期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`)

const S = (name, bytes) => ({ name, bytes, base64: '' })

/* ---- sliceFingerprint ---- */

eq(sliceFingerprint([S('a.paa', 100), S('a.pab', 50)]), 'a.paa:100,a.pab:50', '指纹 = 名:字节 拼接')
eq(sliceFingerprint([]), '', '空数组 → 空串')
eq(sliceFingerprint(null), '', 'null 安全')
// 关键：内容变了（字节数变）指纹必须变
ok(sliceFingerprint([S('a.paa', 100)]) !== sliceFingerprint([S('a.paa', 101)]), '字节数变化 → 指纹变化')
// 片数相同但内容不同，也必须能区分（这正是「只看片数」会踩的坑）
ok(sliceFingerprint([S('a.paa', 100), S('a.pab', 50)]) !== sliceFingerprint([S('a.paa', 50), S('a.pab', 100)]), '同片数不同内容 → 指纹不同')

/* ---- shouldResumeUpload ---- */

const fp = 'a.paa:100,a.pab:50'
const ck = { fingerprint: fp, uploaded: true, workloadId: 'w1' }

eq(shouldResumeUpload(ck, fp, 'w1'), true, '三条件齐全 → 可跳过上传')
eq(shouldResumeUpload(ck, fp, undefined), true, '未给 workloadId 时不做该项比对（向后兼容旧断点）')
eq(shouldResumeUpload(null, fp, 'w1'), false, '无断点 → 不跳过')
eq(shouldResumeUpload({ fingerprint: fp, uploaded: false }, fp, 'w1'), false, '上一轮没传完 → 不跳过')
eq(shouldResumeUpload(ck, 'a.paa:999', 'w1'), false, '指纹不一致 → 不跳过')
eq(shouldResumeUpload(ck, '', 'w1'), false, '空指纹 → 不跳过')
eq(shouldResumeUpload(ck, fp, 'w2'), false, '换了 workload → 不跳过（分片不在那台机器上）')
eq(shouldResumeUpload({ uploaded: true }, fp, 'w1'), false, '旧断点缺指纹字段 → 不跳过')

/* ---- 结果 ---- */

if (failures.length) {
  console.error(`\n❌ 断点续传判据 ${failures.length} 条失败（通过 ${pass} 条）：`)
  failures.forEach(f => console.error('  - ' + f))
  process.exit(1)
}
console.log(`\n✅ 断点续传判据：${pass} 条断言`)
process.exit(0)
