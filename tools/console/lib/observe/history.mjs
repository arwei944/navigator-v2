/**
 * 提交历史 + 部署关联：把本地提交与**本机发布记录**按 commit SHA 关联。
 *
 * ## 数据源换过一次（2026-10-16）
 *
 * 原先读的是 Vercel 的部署列表。但线上已迁到自有服务器（BotKeep），
 * Vercel 那边**早已不再有新的部署** —— 面板会一直显示「最近几次提交均未推送部署」，
 * 而实际上它们都发过了。所以改成读 `deploy.mjs` 写的本机发布记录
 * （`.deploy-history.json`，每次 BotKeep 发布都会追加）。
 *
 * 对外 shape 刻意保持不变（`latest` / `commits[].deployment` / `state` / `stateLabel`），
 * 前端一行不用改；`state` 仍是 'READY'/'ERROR' 这套标签，只是含义变成「发布成功/失败」。
 *
 * 没有发布记录时给出说明而不是空白：空白会让人以为是坏了，而实际只是还没发布过。
 */
import { getLog, remoteShas, getStatus } from '../vcs/git.mjs'
import { history as deployHistory } from '../publish/deploy.mjs'
import { resolvePublisher } from '../../../../shared/publisher.mjs'

/** 本机发布记录 → 前端认的部署形状 */
function asDeployment(p, siteUrl) {
  return {
    url: siteUrl,
    state: p.ok ? 'READY' : 'ERROR',
    stateLabel: p.ok ? '已发布' : '发布失败',
    createdAt: p.at,
  }
}

export async function history({ limit = 25 } = {}) {
  const [commits, st] = await Promise.all([getLog(limit), getStatus().catch(() => null)])
  const upstream = st?.upstream || ''
  const pushed = await remoteShas(upstream)

  let siteUrl = ''
  try { siteUrl = resolvePublisher().siteUrl } catch { /* 通道解析不出就不给可点链接 */ }

  const pubs = deployHistory(60).filter(p => p && p.sha)
  const deployNote = pubs.length
    ? ''
    : '本机还没有发布记录 —— 发布一次（发布面板 / 开发流水线）后，这里会按 commit SHA 与提交精确关联。'

  const bySha = new Map()
  for (const p of pubs) bySha.set(p.sha, p)

  const latest = pubs[0] || null

  return {
    upstream,
    deployNote,
    deployCount: pubs.length,
    latest: latest
      ? {
          ...asDeployment(latest, siteUrl),
          commitSha: latest.sha,
          commitMessage: latest.subject,
        }
      : null,
    commits: commits.map(c => {
      const p = bySha.get(c.sha)
      return {
        ...c,
        pushed: pushed.has(c.sha),
        deployment: p ? asDeployment(p, siteUrl) : null,
      }
    }),
  }
}
