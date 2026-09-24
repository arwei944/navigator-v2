/**
 * 提交历史 + 部署关联：把本地提交与 Vercel 部署按 commit SHA 关联。
 * 无 VERCEL_TOKEN 时降级为纯提交列表（并给出说明）。
 */
import { getLog, remoteShas, getStatus } from './git.mjs'
import * as vercel from './vercel.mjs'

export async function history({ limit = 25 } = {}) {
  const [commits, st] = await Promise.all([getLog(limit), getStatus().catch(() => null)])
  const upstream = st?.upstream || ''
  const pushed = await remoteShas(upstream)

  let deployments = []
  let deployNote = ''
  if (vercel.available()) {
    try {
      deployments = await vercel.listDeployments(60)
    } catch (e) {
      deployNote = `部署状态读取失败：${e.message}`
    }
  } else {
    deployNote = '未配置 VERCEL_TOKEN，无法关联部署状态（仅显示提交记录）'
  }

  const bySha = new Map()
  for (const d of deployments) if (d.commitSha) bySha.set(d.commitSha, d)

  // 最近一次生产部署：提交未推送/未关联时的可见基线
  const latest = deployments.find(d => d.target === 'production') || deployments[0] || null

  return {
    upstream,
    deployNote,
    deployCount: deployments.length,
    latest: latest
      ? {
          url: latest.url,
          state: latest.state,
          stateLabel: vercel.stateLabel(latest.state),
          createdAt: latest.createdAt,
          commitSha: latest.commitSha,
          commitMessage: latest.commitMessage,
        }
      : null,
    commits: commits.map(c => {
      const d = bySha.get(c.sha)
      return {
        ...c,
        pushed: pushed.has(c.sha),
        deployment: d
          ? { url: d.url, state: d.state, stateLabel: vercel.stateLabel(d.state), createdAt: d.createdAt }
          : null,
      }
    }),
  }
}