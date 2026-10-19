/**
 * 控制台路由 · 运维域：部署（BotKeep）、开发流水线、插件注册表、可部署端点。
 *
 * 路由前缀：`/api/deploy/*`、`/api/release`、`/api/plugins`、`/api/publish/rollback`
 *
 * 这里的凭据类接口只回「配没配」，绝不回值 —— 与审计日志同一口径：
 * 记录「改了哪一项」而不记录内容。
 */
import * as deploy from '../publish/deploy.mjs'
import * as release from '../publish/release.mjs'
import * as pluginsCfg from '../publish/plugins.mjs'
import * as endpointsCfg from '../publish/endpoints.mjs'
import * as snapshots from '../publish/snapshots.mjs'
import * as notify from '../observe/notify.mjs'
import { record } from '../core/audit.mjs'
import { sendJson, readJsonBody } from './api-http.mjs'

export async function handleOpsGet(req, res, path, url) {
  /**
   * N2：可部署端点清单。**不含任何凭据材料**（只回「配没配」）——
   * 端点配置（NAV_DEPLOY_ENDPOINTS）在本地 .env.local，所以只有本地控制台能看到全量端点；
   * 线上产物里没有这份配置。发布后的选择与执行也在本地（线上无源码、无发布凭据）。
   */
  if (path === '/api/deploy/endpoints') {
    sendJson(res, 200, { endpoints: endpointsCfg.publicEndpoints() })
    return true
  }

  /* ---- 开发流水线：预检（只读）---- */
  if (path === '/api/release') {
    try {
      // requireMessage:false —— 面板打开时只是「看看状态」，此刻没填提交消息不算阻塞
      const p = await release.preflight({ requireMessage: false })
      sendJson(res, 200, { ok: true, ...p, last: release.lastRelease() })
    } catch (e) {
      sendJson(res, 400, { error: e.message })
    }
    return true
  }

  /* ---- 插件管理：九个引擎注册表的聚合视图（与站内 /api/plugins 同源）---- */
  if (path === '/api/plugins') {
    try {
      sendJson(res, 200, await pluginsCfg.status())
    } catch (e) {
      sendJson(res, 400, { error: e.message })
    }
    return true
  }

  if (path === '/api/deploy/status') {
    try {
      sendJson(res, 200, {
        ...(await deploy.deployStatus({ url: url.searchParams.get('url') || '' })),
        history: deploy.history(10),
        dist: deploy.distSize(),
      })
    } catch (e) {
      sendJson(res, 400, { error: e.message })
    }
    return true
  }

  return false
}

export async function handleOpsPost(req, res, path) {
  /* ---- 开发流水线：启动（长任务，前端拿 jobId 走 SSE 看实时日志与时间线）---- */
  if (path === '/api/release') {
    const body = await readJsonBody(req)
    const opts = {
      message: String(body.message || ''),
      skipTest: body.skipTest === true,
      noPush: body.noPush === true,
      skipBuild: body.skipBuild === true,
    }
    const p = await release.preflight(opts)
    if (p.blockers.length && body.force !== true) {
      sendJson(res, 409, { error: p.blockers[0], blockers: p.blockers })
      return true
    }
    try {
      const job = release.startRelease(opts)
      // 审计只记「跑了什么、跳了什么」，不记提交消息正文（那是用户的业务内容）
      record({
        action: 'release.start',
        target: 'botkeep',
        detail: [`job ${job.id}`, opts.skipTest ? '跳过测试' : '', opts.noPush ? '不推送' : '', opts.skipBuild ? '跳过构建' : ''].filter(Boolean).join(' · '),
      })
      sendJson(res, 200, { ok: true, jobId: job.id })
    } catch (e) {
      record({ action: 'release.start', result: 'fail', detail: e.message })
      sendJson(res, 409, { error: e.message })
    }
    return true
  }

  /* ---- 插件配置（本机）---- */
  if (path === '/api/plugins') {
    const body = await readJsonBody(req)
    try {
      const r = pluginsCfg.save(body.overrides || {})
      // 审计只记「改了哪几项」，绝不记值 —— 与凭据那条一个口径
      record({
        action: 'plugins.save',
        target: 'local',
        detail: (r.applied || []).join('+') || '(无变化)',
      })
      sendJson(res, 200, { ok: true, ...r, groups: (await pluginsCfg.status()).groups })
    } catch (e) {
      record({ action: 'plugins.save', result: 'fail', target: 'local', detail: e.message })
      sendJson(res, 400, { error: e.message })
    }
    return true
  }

  /* ---- 发布到自有服务器 ---- */
  if (path === '/api/deploy/credentials') {
    const body = await readJsonBody(req)
    const s = deploy.saveCredentials({ key: body.key, workloadId: body.workloadId })
    // 审计只记「改了哪一项」，绝不记值
    record({
      action: 'deploy.credentials',
      target: 'BOTKEEP_*',
      detail: [body.key !== undefined ? 'key' : '', body.workloadId !== undefined ? 'workloadId' : ''].filter(Boolean).join('+') || '(无变化)',
    })
    sendJson(res, 200, { ok: true, ...s })
    return true
  }

  if (path === '/api/deploy/publish') {
    const body = await readJsonBody(req)
    // 端点解析（N2）：给了就校验 —— 未知 id 明确报错，绝不静默少发一个端点。
    // 没给就不传，startPublish 落回原单端点 publish()，与多端点引入前一字不差。
    const picked = Array.isArray(body.endpoints) ? endpointsCfg.resolveEndpoints(body.endpoints) : null
    if (picked && !picked.ok) {
      record({ action: 'deploy.publish', result: 'fail', target: 'botkeep', detail: picked.error })
      sendJson(res, 400, { error: picked.error })
      return true
    }
    /**
     * 幂等键（N2 硬约束）：优先取 `Idempotency-Key` 请求头（脚本/HTTP 客户端惯例），
     * 其次取 body.idempotencyKey。同 key 的重复请求返回**同一个 job**，不会重复部署；
     * 格式不合规或命中已失效台账则由 startPublish 抛错，下面统一转 409 并记审计（失败不静默）。
     */
    const idem = String(req.headers['idempotency-key'] || body.idempotencyKey || '').trim()
    try {
      const job = deploy.startPublish({
        skipBuild: body.skipBuild === true,
        url: String(body.url || ''),
        endpoints: picked ? picked.endpoints : undefined,
        idempotencyKey: idem || undefined,
      })
      const ids = picked ? picked.endpoints.map(e => e.id) : ['default']
      const replayed = Number(job.replayed) > 0
      // 审计只记端点 id 与任务号，不记任何凭据
      record({
        action: 'deploy.publish',
        target: 'botkeep',
        detail: `job ${job.id}${ids.length > 1 ? ` · ${ids.length} 端点：${ids.join(',')}` : ''}${replayed ? ' · 幂等回放（未重复部署）' : ''}`,
      })
      sendJson(res, 200, { jobId: job.id, endpoints: ids, replayed })
    } catch (e) {
      record({ action: 'deploy.publish', result: 'fail', target: 'botkeep', detail: e.message })
      sendJson(res, 409, { error: e.message })
    }
    return true
  }

  if (path === '/api/publish/rollback') {
    const body = await readJsonBody(req)
    const pathname = String(body.snapshot || '')
    if (!pathname) { sendJson(res, 400, { error: '缺少快照 pathname' }); return true }
    try {
      const preview = await snapshots.previewRollback(pathname)
      record({
        action: 'rollback.preview', target: pathname,
        detail: `v${preview.currentVersion}(${preview.currentCount}) → v${preview.snapshotVersion}(${preview.snapshotCount}) · 移除 ${preview.willRemove.length} / 恢复 ${preview.willRestore.length} / 改回 ${preview.willRevert.length}`,
      })
      if (body.dryRun === true) {
        sendJson(res, 200, { ok: true, dryRun: true, preview })
        return true
      }
      const r = await snapshots.rollbackTo(pathname)
      record({
        action: 'rollback.apply', target: pathname,
        detail: `云端 v${r.previousVersion} → v${r.version} · ${r.sites.length} 站点；回滚前数据已存快照 ${r.snapshot?.pathname || '(无)'}`,
      })
      notify.push({
        kind: 'rollback.done',
        title: `云端数据已回滚 · v${r.previousVersion} → v${r.version}`,
        body: `${r.sites.length} 站点；回滚前数据已存快照 ${r.snapshot?.pathname || '(无)'}`,
        meta: { from: r.previousVersion, to: r.version, count: r.sites.length, safetySnapshot: r.snapshot?.pathname || '' },
      })
      sendJson(res, 200, {
        ok: true,
        preview,
        restoredFrom: r.restoredFrom,
        previousVersion: r.previousVersion,
        version: r.version,
        count: r.sites.length,
        withIcons: r.sites.filter(s => s.icon).length,
        safetySnapshot: r.snapshot,
      })
    } catch (e) {
      record({ action: 'rollback.apply', result: 'fail', target: pathname, detail: e.message })
      sendJson(res, 400, { ok: false, error: e.message })
    }
    return true
  }

  return false
}
