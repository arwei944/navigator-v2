/**
 * 离线词表：把非中文的站点名称 / 描述里的**概念**抽成中文关键词。
 *
 * ## 为什么需要它（L1 层）
 *
 * 翻译这条链路原先只有一个引擎：MyMemory 免密钥接口（兜底 Google）。但它的额度是
 * **按出口 IP 计的日配额** —— 部署出口是共享 IP，随时会被别人一起用光；耗尽时它
 * **不报 HTTP 错**，而是在译文位置回一句警告（`parseMyMemory` 能识别）→ 落回 Google，
 * 而部署网络连不到 `translate.googleapis.com`。
 *
 * 结果就是「今天能译、明天不能译」。这不满足「必须实时免费」：
 * 实时要有 0ms 的路径，免费要有不依赖第三方配额的路径。
 *
 * 所以 L1 是**地板**：纯本地、0ms、离线可用、永不失败。
 *
 * ## 为什么产出的是「关键词」而不是「直译句子」
 *
 * 逐词替换英文句子只会得到词沙拉（`The best free online tools for developers`
 * → 「最好的 免费的 在线的 工具 为了 开发者」）—— 既不可读也不诚实。
 * 抽概念则是词表真正擅长的：产出「免费 · 在线 · 开发者工具」，一眼可知**这是关键词而非译文**，
 * 用户不会被「看起来像翻译」的假象骗到。UI 必须标明来源是本词表（见 `localMetaNotice` 口径）。
 *
 * ## 边界
 *
 * - 这里**不做**语法、语序、时态。命中就给词，不命中就不给。
 * - 覆盖率太低时返回空串（`glossaryGloss`），让上层去走 L2/L3 —— 宁可没有，不要给噪音。
 * - 前后端**共用**：Node 侧由 `shared/translate.mjs` 引用，浏览器侧由 `localMeta.js`
 *   动态 import（首屏只剩 ~2KiB 余量，绝不能静态引入）。
 */

/* ---------------- 短语表：最长匹配优先 ---------------- */

/**
 * 多词短语。**先于单词匹配**，否则 `open source` 会被拆成「打开 + 来源」。
 * 键统一小写，值是可以直接拼进关键词串的中文。
 */
const PHRASES = {
  'all in one': '一体化',
  'one stop': '一站式',
  'open source': '开源',
  'free trial': '免费试用',
  'free forever': '永久免费',
  'no sign up': '免注册',
  'no signup': '免注册',
  'no registration': '免注册',
  'without registration': '免注册',
  'sign up': '注册',
  'sign in': '登录',
  'log in': '登录',
  'log out': '登出',
  'get started': '快速上手',
  'learn more': '了解更多',
  'find out': '了解',
  'sign up free': '免费注册',
  'how to': '教程',
  'step by step': '分步',
  'real time': '实时',
  'machine learning': '机器学习',
  'deep learning': '深度学习',
  'artificial intelligence': '人工智能',
  'neural network': '神经网络',
  'large language model': '大语言模型',
  'user friendly': '易用',
  'easy to use': '易用',
  'built for': '专为',
  'made for': '专为',
  'designed for': '专为',
  'powered by': '由…驱动',
  'everything you need': '一站式',
  'all you need': '一站式',
  'in one place': '集中管理',
  'on the go': '移动端',
  'on demand': '按需',
  'up to date': '实时更新',
  'state of the art': '前沿',
  'cutting edge': '前沿',
  'world class': '顶级',
  'best in class': '同类最佳',
  'privacy first': '隐私优先',
  'privacy focused': '隐私优先',
  'no ads': '无广告',
  'ad free': '无广告',
  'no tracking': '不追踪',
  'high quality': '高质量',
  'high speed': '高速',
  'high performance': '高性能',
  'low cost': '低成本',
  'cost effective': '高性价比',
  'time saving': '省时',
  'cloud based': '云端',
  'web based': '网页版',
  'cross platform': '跨平台',
  'source code': '源代码',
  'api key': 'API 密钥',
  'data analysis': '数据分析',
  'data science': '数据科学',
  'social media': '社交媒体',
  'search engine': '搜索引擎',
  'web hosting': '网站托管',
  'domain name': '域名',
  'customer service': '客户服务',
  'project management': '项目管理',
  'task management': '任务管理',
  'note taking': '笔记',
  'screen recording': '录屏',
  'screen shot': '截图',
  'screenshot': '截图',
  'image editing': '图片编辑',
  'video editing': '视频剪辑',
  'photo editing': '照片编辑',
  'text to speech': '文字转语音',
  'speech to text': '语音转文字',
  'text to image': '文字生成图片',
  'background remover': '背景消除',
  'background removal': '背景消除',
  'pdf converter': 'PDF 转换',
  'file transfer': '文件传输',
  'file sharing': '文件分享',
  'cloud storage': '云存储',
  'password manager': '密码管理',
  'virtual private network': '虚拟专用网络',
  'private browsing': '隐私浏览',
  'static site': '静态站点',
  'website builder': '建站',
  'landing page': '落地页',
  'email marketing': '邮件营销',
  'content marketing': '内容营销',
  'seo tools': 'SEO 工具',
  'short link': '短链接',
  'url shortener': '短链接',
  'qr code': '二维码',
  'weather forecast': '天气预报',
  'exchange rate': '汇率',
  'stock market': '股票市场',
  'real estate': '房地产',
  'online course': '在线课程',
  'video game': '电子游戏',
  'live streaming': '直播',
}

/* ---------------- 单词表 ---------------- */

/** 单词词典。值取**无语境下最通用**的中文，不做一词多义。 */
const WORDS = {
  /* 动作 */
  create: '创建', make: '制作', build: '构建', generate: '生成', convert: '转换', transform: '转换',
  download: '下载', upload: '上传', edit: '编辑', share: '分享', search: '搜索', find: '查找',
  discover: '发现', browse: '浏览', explore: '探索', manage: '管理', organize: '整理',
  track: '追踪', analyze: '分析', analyse: '分析', monitor: '监控', protect: '保护',
  store: '存储', save: '保存', sync: '同步', stream: '串流', play: '播放', watch: '观看', listen: '收听',
  read: '阅读', write: '写作', learn: '学习', teach: '教学', translate: '翻译', send: '发送',
  receive: '接收', connect: '连接', deploy: '部署', host: '托管', publish: '发布', design: '设计',
  develop: '开发', code: '代码', automate: '自动化', optimize: '优化', boost: '提升', improve: '改善',
  compare: '对比', review: '评测', buy: '购买', sell: '出售', trade: '交易', invest: '投资',
  earn: '赚取', clean: '清理', fix: '修复', repair: '维修', recover: '恢复', scan: '扫描',
  detect: '检测', remove: '移除', delete: '删除', merge: '合并', split: '拆分', compress: '压缩',
  resize: '调整尺寸', crop: '裁剪', format: '格式化', print: '打印', record: '录制', capture: '捕捉',
  schedule: '排期', plan: '规划', collaborate: '协作', chat: '聊天', call: '通话', meet: '会议',
  join: '加入', subscribe: '订阅', follow: '关注', post: '发布', comment: '评论', render: '渲染',
  encrypt: '加密', decrypt: '解密', notify: '通知', remind: '提醒', sort: '排序', filter: '筛选',
  import: '导入', export: '导出', backup: '备份', restore: '还原', install: '安装', update: '更新',

  /* 名词：技术与产品 */
  tool: '工具', tools: '工具', app: '应用', apps: '应用', website: '网站', site: '站点',
  platform: '平台', service: '服务', software: '软件', system: '系统', engine: '引擎', library: '库',
  framework: '框架', api: '接口', database: '数据库', server: '服务器', cloud: '云端',
  storage: '存储', file: '文件', files: '文件', document: '文档', doc: '文档', docs: '文档',
  image: '图片', images: '图片', photo: '照片', picture: '图片', video: '视频', videos: '视频',
  audio: '音频', music: '音乐', podcast: '播客', text: '文本', content: '内容', blog: '博客',
  article: '文章', news: '资讯', data: '数据', analytics: '分析', insights: '洞察', report: '报告',
  dashboard: '仪表盘', chart: '图表', graph: '图表', map: '地图', email: '邮件', message: '消息',
  note: '笔记', notes: '笔记', task: '任务', tasks: '任务', project: '项目', team: '团队',
  workspace: '工作区', account: '账户', profile: '资料', payment: '支付', invoice: '发票',
  pricing: '定价', price: '价格', currency: '货币', crypto: '加密货币', cryptocurrency: '加密货币',
  bitcoin: '比特币', ethereum: '以太坊', wallet: '钱包', exchange: '交易所', market: '市场',
  trading: '交易', stock: '股票', stocks: '股票', fund: '基金', insurance: '保险', loan: '贷款',
  tax: '税务', legal: '法律', contract: '合同', job: '职位', jobs: '职位', career: '职业',
  resume: '简历', hiring: '招聘', recruitment: '招聘', education: '教育', course: '课程',
  courses: '课程', lesson: '课程', tutorial: '教程', language: '语言', health: '健康',
  fitness: '健身', diet: '饮食', food: '美食', recipe: '食谱', travel: '旅行', hotel: '酒店',
  flight: '航班', booking: '预订', ticket: '票务', event: '活动', game: '游戏', games: '游戏',
  gaming: '游戏', sports: '体育', shopping: '购物', shop: '商店', product: '产品',
  deal: '优惠', coupon: '优惠券', discount: '折扣', subscription: '订阅',
  newsletter: '简报', community: '社区', forum: '论坛', support: '支持', help: '帮助',
  guide: '指南', template: '模板', templates: '模板', plugin: '插件', extension: '扩展',
  widget: '小组件', theme: '主题', font: '字体', icon: '图标', color: '颜色', palette: '配色',
  animation: '动画', mockup: '设计稿', prototype: '原型', workflow: '工作流', pipeline: '流水线',
  integration: '集成', automation: '自动化', bot: '机器人', assistant: '助手', agent: '智能体',
  model: '模型', models: '模型', dataset: '数据集', algorithm: '算法', prompt: '提示词',
  privacy: '隐私', security: '安全', password: '密码', encryption: '加密', firewall: '防火墙',
  proxy: '代理', vpn: 'VPN', torrent: '种子下载', tracker: '追踪器', ads: '广告', advertising: '广告',
  marketing: '营销', sales: '销售', brand: '品牌', startup: '创业公司', business: '商业',
  enterprise: '企业', finance: '金融', banking: '银行', realtime: '实时', latency: '延迟',
  bandwidth: '带宽', speed: '速度', performance: '性能', quality: '质量', feature: '功能',
  features: '功能', version: '版本', release: '版本', beta: '测试版', preview: '预览',
  demo: '演示', example: '示例', sample: '示例', usage: '用法', documentation: '文档',
  editor: '编辑器', viewer: '查看器', player: '播放器', builder: '构建器', converter: '转换器',
  generator: '生成器', downloader: '下载器', manager: '管理器', tracker: '追踪器',
  calculator: '计算器', checker: '检查器', reader: '阅读器', calendar: '日历', timer: '计时器',
  todo: '待办', board: '看板', kanban: '看板', sheet: '表格', spreadsheet: '电子表格',
  slide: '幻灯片', presentation: '演示文稿', wiki: '百科', snippet: '代码片段',
  boilerplate: '样板代码', cheatsheet: '速查表', bundle: '打包', compiler: '编译器',
  terminal: '终端', console: '控制台', repo: '仓库', repository: '仓库', commit: '提交',
  branch: '分支', debug: '调试', debugger: '调试器', linter: '代码检查',
  test: '测试', testing: '测试', benchmark: '基准测试', uptime: '在线率',
  status: '状态', incident: '故障', outage: '宕机', log: '日志', logs: '日志', metric: '指标',
  metrics: '指标', alert: '告警', alarm: '提醒', notification: '通知', webhook: 'Webhook',
  endpoint: '接口地址', token: '令牌', credential: '凭据', permission: '权限', role: '角色',
  member: '成员', members: '成员', organization: '组织', contact: '联系人', customer: '客户',
  lead: '线索', funnel: '漏斗', conversion: '转化', traffic: '流量',
  visitor: '访客', visitors: '访客', click: '点击', clicks: '点击', impression: '曝光',
  campaign: '广告活动', audience: '受众', segment: '分群', keyword: '关键词', backlink: '外链',
  domain: '域名', hosting: '托管', cdn: 'CDN',
  screenshot: '截图', wireframe: '线框图', asset: '素材', assets: '素材',
  logo: '标志', gradient: '渐变', typography: '排版',
  dark: '深色', light: '浅色', mode: '模式', layout: '布局', grid: '网格', card: '卡片',
  button: '按钮', form: '表单', input: '输入', table: '表格', menu: '菜单', navbar: '导航栏',
  sidebar: '侧栏', footer: '页脚', header: '页头', modal: '弹窗', tooltip: '提示', toast: '提示条',
  minute: '分钟', second: '秒', hour: '小时', day: '天', week: '周', month: '月', year: '年',

  /* AI / 多媒体类：导航站里这类描述极多，缺了会让整句抽不出概念 */
  ai: 'AI', powered: '驱动', upscale: '放大', upscaler: '放大', upscaling: '放大',
  enhance: '增强', enhancer: '增强', remover: '消除', removal: '消除',
  chatbot: '聊天机器人', summarize: '摘要', summarizer: '摘要', summary: '摘要',
  transcribe: '转录', transcription: '转录', subtitle: '字幕', subtitles: '字幕',
  voice: '语音', dubbing: '配音', avatar: '头像', portrait: '人像', face: '人脸',
  vector: '矢量', svg: 'SVG', pdf: 'PDF', markdown: 'Markdown', css: 'CSS', html: 'HTML',
  javascript: 'JavaScript', python: 'Python', sql: 'SQL', json: 'JSON', sdk: 'SDK',
  cli: '命令行', ide: 'IDE', git: 'Git', docker: 'Docker', kubernetes: 'Kubernetes',
  watermark: '水印', caption: '字幕', sticker: '贴纸', emoji: '表情',
  thumbnail: '缩略图', teaser: '预告', clip: '片段', playlist: '播放列表', album: '专辑',
  lyrics: '歌词', karaoke: '卡拉OK', beat: '节拍', voiceover: '旁白', sound: '音效',
  effect: '特效', effects: '特效', collage: '拼图',
  retouch: '修图', rotate: '旋转', flip: '翻转', zoom: '缩放', blur: '模糊',
  sharpen: '锐化', denoise: '降噪', matting: '抠图', cutout: '抠图',
  motion: '动效', transition: '转场', timeline: '时间轴', storyboard: '分镜',

  /* 形容词 / 修饰 */
  free: '免费', online: '在线', offline: '离线', open: '开放', source: '来源', premium: '高级',
  pro: '专业版', paid: '付费', best: '优质', top: '顶级', fast: '快速', quick: '快速',
  instant: '即时', simple: '简洁', easy: '易用', powerful: '强大', advanced: '进阶',
  smart: '智能', intelligent: '智能', automatic: '自动', auto: '自动', secure: '安全',
  private: '私密', safe: '安全', anonymous: '匿名', unlimited: '无限', large: '大型',
  small: '小型', mini: '迷你', lightweight: '轻量', modern: '现代', beautiful: '精美',
  clean: '清爽', minimal: '极简', custom: '自定义', customizable: '可定制', flexible: '灵活',
  scalable: '可扩展', reliable: '可靠', trusted: '可信', popular: '热门', leading: '领先',
  complete: '完整', comprehensive: '全面', professional: '专业', high: '高', great: '出色',
  excellent: '优秀', ultimate: '终极', essential: '必备', useful: '实用', helpful: '好用',
  amazing: '惊艳', awesome: '出色', perfect: '完美', new: '新', latest: '最新',
  updated: '已更新', daily: '每日', weekly: '每周', monthly: '每月', yearly: '每年',
  anytime: '随时', anywhere: '随处', worldwide: '全球', global: '全球', local: '本地',
  personal: '个人', developer: '开发者', developers: '开发者', designer: '设计师',
  designers: '设计师', creator: '创作者', creators: '创作者', student: '学生',
  teacher: '教师', marketer: '营销人员', writer: '写作者', entrepreneur: '创业者',
  beginner: '初学者', expert: '专家', people: '人们', users: '用户', user: '用户',
  everyone: '所有人', anyone: '任何人', world: '世界', internet: '互联网', web: '网页',
  mobile: '移动端', desktop: '桌面端', browser: '浏览器', device: '设备', devices: '设备',
  today: '今日', official: '官方', independent: '独立',
  practical: '实用', efficient: '高效', productive: '高效', seamless: '无缝',
  intuitive: '直观', stunning: '惊艳', gorgeous: '华丽', elegant: '优雅', immersive: '沉浸式',
}

/* ---------------- 停用词：不参与关键词，也不计入覆盖率分母 ---------------- */

/**
 * 英文虚词。**必须单独列出**：否则 `The best free online tools for developers`
 * 的分母会把 the/for 也算进去，覆盖率被虚词稀释到看不出好坏。
 */
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'with', 'without', 'of', 'to', 'in', 'on', 'at', 'by',
  'from', 'your', 'you', 'our', 'we', 'us', 'their', 'them', 'it', 'its', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'that', 'this', 'these', 'those', 'all', 'any', 'some', 'more',
  'most', 'less', 'no', 'not', 'only', 'just', 'also', 'very', 'too', 'so', 'as', 'than', 'then',
  'when', 'where', 'which', 'who', 'what', 'how', 'why', 'can', 'will', 'would', 'should', 'could',
  'may', 'might', 'must', 'do', 'does', 'did', 'done', 'has', 'have', 'had', 'get', 'got', 'made',
  'use', 'used', 'using', 'need', 'want', 'like', 'such', 'over', 'under', 'out', 'up', 'down',
  'about', 'into', 'through', 'between', 'during', 'before', 'after', 'while', 'because', 'but',
  'if', 'else', 'here', 'there', 'now', 'new', 'one', 'two', 'way', 'thing', 'things', 'let',
  's', 't', 're', 've', 'll', 'd', 'm',
])

/* ---------------- 匹配 ---------------- */

const WORD_RE = /[A-Za-z][A-Za-z'’]*/g
const HAN = /\p{Script=Han}/u
const MAX_PHRASE_WORDS = 5

/** 切词：只取拉丁字母词，丢掉标点与数字 */
export function tokenize(text) {
  return String(text ?? '').match(WORD_RE) || []
}

/** 查一个短语（已小写、已去连字符） */
function lookupPhrase(key) {
  return Object.prototype.hasOwnProperty.call(PHRASES, key) ? PHRASES[key] : ''
}

/**
 * 查一个单词，带**最朴素的词形回退**。
 *
 * 只做英文里最常见的三条规则，不做词干化（Porter stemmer 那类会过度合并，
 * 把 `analytics` / `analysis` 一起塌成 `analyt`）。宁可漏，不要错：
 *   `websites` → `website`、`classes` → `class`、`stories` → `story`
 *
 * 有了这三条，词表就不必把每个词的复数各登记一遍 —— 词表体积直接省下可观的一块，
 * 而首屏预算只剩 ~2KiB 余量，这个词表是要进懒加载 chunk 的。
 */
function lookupWord(w) {
  if (Object.prototype.hasOwnProperty.call(WORDS, w)) return WORDS[w]
  if (w.length > 3 && w.endsWith('ies')) {
    const t = w.slice(0, -3) + 'y'
    if (Object.prototype.hasOwnProperty.call(WORDS, t)) return WORDS[t]
  }
  if (w.length > 3 && w.endsWith('es')) {
    const t = w.slice(0, -2)
    if (Object.prototype.hasOwnProperty.call(WORDS, t)) return WORDS[t]
  }
  if (w.length > 2 && w.endsWith('s')) {
    const t = w.slice(0, -1)
    if (Object.prototype.hasOwnProperty.call(WORDS, t)) return WORDS[t]
  }
  return ''
}

/** 已经含汉字就不必再过词表（品牌名混排时尤其重要，别把中文一起吞掉） */
export function isChinese(text) {
  return HAN.test(String(text ?? ''))
}

/**
 * 从一段文本里抽中文关键词。
 *
 * 算法：按出现顺序扫描，**短语优先最长匹配**（最多 5 个词），命中即跳到短语末尾；
 * 否则退到单词匹配。虚词与未命中词直接跳过（不影响顺序）。
 *
 * @returns {{ keywords: string[], hits: number, total: number, coverage: number }}
 *   `total` 只数**实词**（非虚词）个数，`coverage` = hits / total。
 *   虚词不计入分母，否则长句的覆盖率会被 the/for/of 稀释，阈值就没意义了。
 */
export function extractKeywords(text, { max = 6 } = {}) {
  const raw = String(text ?? '')
  // 已含中文：不抽（混合文案里汉字已经承载了主要语义）
  if (!raw.trim() || isChinese(raw)) return { keywords: [], hits: 0, total: 0, coverage: 0 }

  // 用带位置的小写词列表做匹配，位置用来反查原文（这里只需要顺序，不需要原文）
  const words = tokenize(raw).map(w => w.toLowerCase().replace(/[’']s$/, '').replace(/[’']/g, ''))

  const keywords = []
  const seen = new Set()
  let hits = 0
  let total = 0
  let i = 0

  while (i < words.length) {
    const w = words[i]

    // ① 短语：从长到短试（i 处起最多 5 个词）
    let matched = ''
    let span = 0
    for (let n = Math.min(MAX_PHRASE_WORDS, words.length - i); n >= 2; n--) {
      const key = words.slice(i, i + n).join(' ')
      const zh = lookupPhrase(key)
      if (zh) { matched = zh; span = n; break }
    }

    if (matched) {
      hits++
      for (let k = 0; k < span; k++) if (!STOP.has(words[i + k])) total++
      if (!seen.has(matched)) { seen.add(matched); keywords.push(matched) }
      i += span
      continue
    }

    // ② 单词
    const isStop = STOP.has(w)
    if (!isStop) total++
    const zh = lookupWord(w)
    if (zh) {
      hits++
      if (!seen.has(zh)) { seen.add(zh); keywords.push(zh) }
    }
    i++
  }

  return {
    keywords: keywords.slice(0, max),
    hits,
    total,
    coverage: total ? hits / total : 0,
  }
}

/**
 * 产出可直接显示的「中文关键词」串。
 *
 * 覆盖率低于 `minCoverage` 时返回空串 —— **宁可没有，也不给噪音**：
 * 一句只命中 1 个词的长描述，抽出来的关键词会严重误导用户。
 *
 * @returns {{ text: string, keywords: string[], coverage: number, hits: number, total: number }}
 */
export function glossaryGloss(text, { max = 6, minCoverage = 0.34, minHits = 2 } = {}) {
  const r = extractKeywords(text, { max })
  const enough = r.hits >= minHits && r.coverage >= minCoverage
  return { text: enough ? r.keywords.join(' · ') : '', ...r }
}

/** 词表规模（守卫用：删条目导致规模异常缩水要能被发现） */
export function glossarySize() {
  return { phrases: Object.keys(PHRASES).length, words: Object.keys(WORDS).length }
}
