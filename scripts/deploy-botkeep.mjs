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
 * ## 升级数据保护（默认开启）
 *
 * 部署包排除 `data/`，但平台没有持久卷。这里在发布前后加一层：
 *   部署前拉一份完整备份（站点 + 审计 + 健康 + 统计）到 `backups/upgrades/`，
 *   部署后核对「站点条数 / version / 老站点 id / 审计条数」不下降；
 *   异常默认自动恢复，恢复后再核对。
 *
 * 用法：
 *   node scripts/deploy-botkeep.mjs                 # 完整发布（含数据保护）
 *   node scripts/deploy-botkeep.mjs --skip-build    # 复用现有 dist
 *   node scripts/deploy-botkeep.mjs --quiet         # 只要最终那行结果
 *   node scripts/deploy-botkeep.mjs --no-guard      # 关闭升级数据保护
 *   node scripts/deploy-botkeep.mjs --no-restore    # 只核对，异常时不自动恢复
 */
import { publish } from '../tools/console/lib/publish/deploy.mjs'
import { captureBaseline, verifyAfter, restoreBaseline } from './upgrade-guard.mjs'

const args = process.argv.slice(2)
const skipBuild = args.includes('--skip-build')
const quiet = args.includes('--quiet')
/** 强制全量打包（线上产物被重建 / manifest 失效时的逃生阀） */
const full = args.includes('--full')
const noGuard = args.includes('--no-guard')
const noRestore = args.includes('--no-restore')

const log = quiet ? () => {} : (t) => process.stdout.write(String(t).endsWith('\n') ? t : t + '\n')

const baseline = noGuard
  ? { ok: false, skipped: true, reason: '--no-guard' }
  : await captureBaseline({ log })

const r = await publish({ skipBuild, full, log })

let guard = null
if (!noGuard) {
  if (!r.ok) {
    guard = { ok: false, skipped: true, reasons: ['部署未成功，跳过数据核对'] }
  } else {
    guard = await verifyAfter(baseline, { log })
    if (!guard.ok && !noRestore) {
      const restore = await restoreBaseline(baseline, { log })
      guard = { ...guard, restore }
      // 恢复并复核通过 → 数据实际上已经连续，整体不算失败
      if (restore.ok) guard.ok = true
    }
  }
}

if (!quiet) process.stdout.write('\n')
process.stdout.write(JSON.stringify({
  ok: Boolean(r.ok),
  shortSha: r.shortSha || '',
  online: r.online || '',
  seconds: r.seconds || 0,
  error: r.error || '',
  dataGuard: guard ? {
    ok: Boolean(guard.ok),
    skipped: Boolean(guard.skipped),
    reasons: guard.reasons || [],
    restored: Boolean(guard.restore?.ok),
    baselineSites: baseline.ok ? baseline.summary.sites : null,
    baselineVersion: baseline.ok ? baseline.summary.version : null,
  } : null,
}) + '\n')

const dataOk = !guard || guard.ok || guard.skipped
process.exit(r.ok && dataOk ? 0 : 1)