/**
 * 控制台路由清单 —— **期望值**，独立于实现文件。
 *
 * ## 为什么单独存一份
 *
 * 路由覆盖用例如果「从源码抽路由再验证源码」，那是自证：
 * 把某个路由注释掉，抽取结果也跟着少一条，两边同时变，永远报绿。
 * 实测确认过这个失效模式。
 *
 * 所以期望清单固定在这里。**新增或删除路由时，必须同时改这个文件** ——
 * 这不是冗余，而是把「路由集合发生变化」变成一个显式的、可 review 的动作。
 * 漏改会立刻变红，且报错会明确指出少哪条。
 *
 * 格式：`'METHOD /api/path'`，按路径排序。
 */
export const EXPECTED_ROUTES = [
  'GET /api/audit',
  'GET /api/changes/summary',
  'GET /api/data/report',
  'GET /api/deploy/endpoints',
  'GET /api/deploy/status',
  'GET /api/env',
  'GET /api/git/diff',
  'GET /api/git/status',
  'GET /api/health',
  'GET /api/health/history',
  'GET /api/health/latest',
  'GET /api/history',
  'GET /api/jobs',
  'GET /api/notify/badge',
  'GET /api/notify/list',
  'GET /api/plugins',
  'GET /api/publish/gates',
  'GET /api/publish/history',
  'GET /api/publish/preflight',
  'GET /api/publish/snapshots',
  'GET /api/release',
  'GET /api/schedule/status',
  'GET /api/secrets',
  'GET /api/sites/list',
  'GET /api/sites/meta',
  'GET /api/sync/cloud',
  'GET /api/sync/deployments',
  'GET /api/sync/status',
  'POST /api/deploy/credentials',
  'POST /api/deploy/publish',
  'POST /api/git/commit',
  'POST /api/git/hunks',
  'POST /api/git/push',
  'POST /api/git/stage',
  'POST /api/health/probe',
  'POST /api/health/publish',
  'POST /api/jobs/selfcheck',
  'POST /api/notify/clear',
  'POST /api/notify/read',
  'POST /api/notify/test',
  'POST /api/notify/webhook',
  'POST /api/plugins',
  'POST /api/publish/rollback',
  'POST /api/release',
  'POST /api/schedule/config',
  'POST /api/schedule/run',
  'POST /api/secrets/save',
  'POST /api/secrets/verify',
  'POST /api/sites/add',
  'POST /api/sites/batch',
  'POST /api/sites/batch/preview',
  'POST /api/sites/icon',
  'POST /api/sites/remove',
  'POST /api/sites/sync',
  'POST /api/sites/update',
  'POST /api/sync/publish',
  'POST /api/sync/verify',
]
