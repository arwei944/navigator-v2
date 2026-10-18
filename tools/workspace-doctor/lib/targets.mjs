/**
 * 5S 清运目标定义 —— 唯一事实来源。
 *
 * 每条目标都必须给出「为什么可以清」的依据（绝大多数来自 .gitignore 的显式声明：
 * 那些路径被明确标注为「本机状态 / 不入库」）。
 *
 * autoClean=false 的是数据类资产（快照 / 构建产物）：只体检、不清运 ——
 * 它们需要的是「保留策略」，而不是「直接删」。
 */
export const TARGETS = [
  {
    id: 'chrome-profiles',
    label: 'CDP 临时 Chrome profile',
    dir: '.',
    re: /^\.chrome-/,
    kind: 'dir',
    autoClean: true,
    reason: '.gitignore 第 30 行：零依赖 CDP 验证用的临时配置目录，每次测量都该是干净的',
  },
  {
    id: 'probe-drafts',
    label: 'probe 验收草稿（截图 / 报告 / 临时文件）',
    dir: 'probe',
    re: /^_|\.png$|\.txt$/,
    kind: 'any',
    autoClean: true,
    reason: '.gitignore 第 24-28 行：探针产物只作本机验收证据，不入库',
  },
  {
    id: 'api-icon-baks',
    label: '图标抓取备份副产物',
    dir: 'api',
    re: /^sites-data\.bak-.*\.json$/,
    kind: 'file',
    autoClean: true,
    reason: '.gitignore 第 50 行：每次运行 fetch-favicons 都生成一份，属本机状态',
  },
  {
    id: 'root-reports',
    label: '根目录散落报告',
    dir: '.',
    re: /^_(chrome|probe)-report.*\.json$/,
    kind: 'file',
    autoClean: true,
    reason: '.gitignore 第 22-23 行：探针报告由脚本生成，只作本机验收证据',
  },
  {
    id: 'perf-report',
    label: '性能基线报告目录',
    dir: '.',
    re: /^perf-report$/,
    kind: 'dir',
    autoClean: true,
    reason: '.gitignore 第 12 行：本机性能基线产物',
  },
  {
    id: 'backups',
    label: '站点数据快照仓',
    dir: '.',
    re: /^backups$/,
    kind: 'dir',
    autoClean: false,
    reason: '数据快照：应设保留策略（保留最近 N 份）而非直接删，故只体检不清运',
  },
  {
    id: 'dist',
    label: '构建产物',
    dir: '.',
    re: /^dist$/,
    kind: 'dir',
    autoClean: false,
    reason: '构建产物，随 build 刷新；体积已由 test-bundle-size 守护',
  },
]
