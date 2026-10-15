#!/usr/bin/env node
/**
 * 通过自有服务器（BotKeep）发布 —— 完整走 `lib/deploy.mjs` 的 publish：
 * **构建 → 产物门禁 → 打包 tar → 分片上传 → 触发解压 → 线上验证**。
 *
 * 为什么单独一个脚本：发布通道（`shared/publisher.mjs`）需要一个**可执行的部署命令**，
 * 而往通道里塞一条 `node -e "import(...).then(...)"` 会把逻辑藏进字符串 ——
 * 既没法单独跑，也没法维护。这里就是那条命令的落点。
 *
 * 注意它与 `nav release run` 的分工：那个是**完整开发闭环**（含测试 / 提交 / 推送），
 * 这个只管**从已构建产物到线上**这一段。改了代码之外的部署参数、或只想重发一次时用它。
 *
 * 用法：
 *   node scripts/deploy-botkeep.mjs                 # 完整发布
 *   node scripts/deploy-botkeep.mjs --skip-build    # 复用现有 dist
 *   node scripts/deploy-botkeep.mjs --quiet         # 只要最终那行结果
 */
import { publish } from '../tools/console/lib/deploy.mjs'

const args = process.argv.slice(2)
const skipBuild = args.includes('--skip-build')
const quiet = args.includes('--quiet')

const r = await publish({
  skipBuild,
  log: quiet ? () => {} : (t) => process.stdout.write(String(t).endsWith('\n') ? t : t + '\n'),
})

if (!quiet) process.stdout.write('\n')
process.stdout.write(JSON.stringify({
  ok: Boolean(r.ok),
  shortSha: r.shortSha || '',
  online: r.online || '',
  seconds: r.seconds || 0,
  error: r.error || '',
}) + '\n')

process.exit(r.ok ? 0 : 1)
