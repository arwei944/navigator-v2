# Changelog

## [3.1.0](https://github.com/arwei944/navigator-v2/compare/nav-v2-v3.0.0...nav-v2-v3.1.0) (2026-10-10)


### Features

* **card:** 卡片体系升级 —— 三处断层修复 + 信息架构与能力扩展 ([55b4e84](https://github.com/arwei944/navigator-v2/commit/55b4e846dfd35600465edbc7ceed8505da55cb22))
* **card:** 新增卡片设置面板（排列方式 / 卡片大小 / 每行数量 / 元素显隐） ([c5270bb](https://github.com/arwei944/navigator-v2/commit/c5270bb4b06d46b37b784c9a16f481e90404a232))
* **card:** 补齐卡片体系剩余项 —— 站点归档 / 数据归一 / 折叠性能（含真机验证） ([4de0705](https://github.com/arwei944/navigator-v2/commit/4de070552621746750fd8cb4f0c45ebacedb6bba))
* **console:** 新增历史与数据面板，实现提交×部署关联与数据体检 ([8fd6b6e](https://github.com/arwei944/navigator-v2/commit/8fd6b6e351a01189511aa63a42d3a2254aff7436))
* **console:** 新增可用性与审计面板，diff 支持分块暂存，同步面板接入门禁与快照 ([0157409](https://github.com/arwei944/navigator-v2/commit/01574090dbec4c89a97fd85d97421fcd63984b1f))
* **console:** 新增同步面板，实现一键发布全链路时间线与云端一致性验证 ([05decd2](https://github.com/arwei944/navigator-v2/commit/05decd2378fdbcaee3a715ce5019aeb1e10f0229))
* **console:** 新增本地运维控制台，支持改动/diff/暂存/提交/推送与 SSE 实时日志 ([fd5a5d1](https://github.com/arwei944/navigator-v2/commit/fd5a5d1b226db80a6baa7fdf2b6769144a20e670))
* **console:** 新增站点管理面板，实现站点增删改与一键同步云端 ([f579203](https://github.com/arwei944/navigator-v2/commit/f5792039758e25a05f07d0001ccaecbba4f08500))
* **deploy:** 保存即部署 —— 监听本地变更自动发布到生产 ([58d399b](https://github.com/arwei944/navigator-v2/commit/58d399be8324bddcb4da49da943e0d34978425c1))
* **infer:** 升级站点元信息抓取引擎 ([7369982](https://github.com/arwei944/navigator-v2/commit/7369982b485d49e3803fb7e40a5ec9d56f264dc9))
* Navigator V2 网站导航中心 - 210+ 站点 / 4 大类 22 子分类 / Vue 3 + Vite + Pinia / PWA / Vercel 部署 ([1804399](https://github.com/arwei944/navigator-v2/commit/1804399e87364b9bcd34e50b0fc0fff1637f425b))
* Navigator V3 — 清理失效 KV 同步，统一 Blob 数据源，增加发布门禁与数据校验 ([c642eac](https://github.com/arwei944/navigator-v2/commit/c642eac3005eb4d22ecac778e54186cff6acb73f))
* **nav:** v8 智能化+主题+便签；发布迁移自建 Node 服务，自动补全恢复真实抓取 ([a74c6c3](https://github.com/arwei944/navigator-v2/commit/a74c6c3a36fc04bf3d7b8413527f3f1dbee1ef1d))
* **nav:** 侧栏底部新增常驻管理入口（折叠态收为图标）+ HANDOVER §33 ([fa38c68](https://github.com/arwei944/navigator-v2/commit/fa38c68f298e53e04aef2461247d5ab7e97c4428))
* **nav:** 导航结构重设计 + 别名检索 + 发布/管理大模块 ([f49a044](https://github.com/arwei944/navigator-v2/commit/f49a044ab9b7f06aca80a06c164c32f50247fb6f))
* **nav:** 收录站点 dt35 AltVsBTC（data 分类）+ HANDOVER §41 ([8eb1e83](https://github.com/arwei944/navigator-v2/commit/8eb1e838fc60fc0928f76fde430998108fa81e21))
* **nav:** 站点用途体系 + 视觉方案设置 + 搜索栏「添加站点」入口与建议下拉修复（站点数据 300） ([3d48492](https://github.com/arwei944/navigator-v2/commit/3d48492aa9a0a1debaaf06a7bf60544c6b61276f))
* **nav:** 管理后台升级 + 站点探活重构 + 点击统计与排序 ([fecc603](https://github.com/arwei944/navigator-v2/commit/fecc60396fdfcf9a7ddbe7a720e0a1214217ba15))
* **omni:** 搜索框升级为全能框，吃掉命令面板 ([3d69de0](https://github.com/arwei944/navigator-v2/commit/3d69de067871f97cb5f3f46aaf30bb929ff671f6))
* **scripts:** 发布门禁、CLI 参数化、图标/排序修复与滚动性能基准 ([b8c622d](https://github.com/arwei944/navigator-v2/commit/b8c622d0652a51e7b256235adf614d289efc484a))
* **search:** 站内搜索与站外搜索合并为统一搜索框 ([6f35151](https://github.com/arwei944/navigator-v2/commit/6f351514e096f4938221c1e854ed9b9245b70829))
* **security:** 第三批安全加固与架构（SSRF 连接层校验 / 条件写 / 首屏分包） ([248c25b](https://github.com/arwei944/navigator-v2/commit/248c25b2d51ece957b8fda905536c8fbfc6faecc))
* **sites:** 收录 bs9 华润赢（huarun.win，代理/VPN） ([f0e1c1d](https://github.com/arwei944/navigator-v2/commit/f0e1c1de740f374c23e7d31cf2ba43ffe667062f))
* **sites:** 收录 dt34 OpenChainBench（加密货币基础设施公开基准测试站，数据与研究） ([fc6c52d](https://github.com/arwei944/navigator-v2/commit/fc6c52dcbfd0f2e88fec854efc602fc581402656))
* **sites:** 新增 6 个站点并更新 3 个 favicon ([dddc3d9](https://github.com/arwei944/navigator-v2/commit/dddc3d973f7c67095413687d4cdd34bd1e0d8584))
* **stores:** 本地数据版本化持久化与站点在线状态探测 ([c79c7f9](https://github.com/arwei944/navigator-v2/commit/c79c7f9e6f219e60a40f5069cd74d1931d5f8503))
* **sync:** 新增云端会话同步接口与客户端服务，站点接口鉴权改为请求头 ([4e8fe18](https://github.com/arwei944/navigator-v2/commit/4e8fe189e4813b3b064b6b067dd4e3c3fbefe7c2))
* **ui:** 站点在线角标、智能推荐、卡片虚拟化与后台数据洞察 ([8f11baa](https://github.com/arwei944/navigator-v2/commit/8f11baaf1e906efc16547958695e1a58cf0419f8))
* **v5:** MCP 服务化，把 35 条命令收敛成 5 个域级工具 ([67bfa02](https://github.com/arwei944/navigator-v2/commit/67bfa026230509b00128b90a2bb01207bdde824b))
* **v5:** 云端快照回滚、发布门禁、操作审计、可用性看板与 hunk 分块暂存 ([87e35d9](https://github.com/arwei944/navigator-v2/commit/87e35d949d5a216ea23cf343821a379e30ac9d55))
* 交付智能体 CLI、站点自动补全与本地覆盖层，收口控制台安全边界 ([ccd9750](https://github.com/arwei944/navigator-v2/commit/ccd9750158209647af5e624f0bad4395dbeff485))
* 偏好新增网址自动添加开关（默认开启） ([11a17b9](https://github.com/arwei944/navigator-v2/commit/11a17b994b9e303c4be55cd297e86936de69ccd6))
* 卡片高亮描边与列表滚动定位 ([bd5840e](https://github.com/arwei944/navigator-v2/commit/bd5840e6281c0e9fe6bb5373ab7cee31f357d107))
* 搜索栏一键添加改为静默入库 + Toast 反馈 + 自动定位高亮 ([922ee4f](https://github.com/arwei944/navigator-v2/commit/922ee4f0301f92d3c20b441efab14734e9b8e1c3))
* 搜索栏网址默认自动添加并出预览卡片，失败回落弹窗 ([cc92a4d](https://github.com/arwei944/navigator-v2/commit/cc92a4d9004cbfd585a48cc7303d0b0d6a6f1bbb))
* 新增底部 Toast 提示基础设施（store + 宿主组件） ([13f24e9](https://github.com/arwei944/navigator-v2/commit/13f24e9a685b3ae056a9f3748327ab9895fba359))
* 新增网址自动添加服务（含四道护栏） ([a7e95e3](https://github.com/arwei944/navigator-v2/commit/a7e95e36343807b772a267bdc45e852d528d0c54))
* 新增自动分类决策内核（主题表 + 6 条优先级分支 + 拼音 id 派生） ([63e1376](https://github.com/arwei944/navigator-v2/commit/63e137681e43534d78c7254d9bf4cdc69b850680))
* 新增自动添加预览卡片（可撤销/编辑/倒计时关闭） ([beaeaae](https://github.com/arwei944/navigator-v2/commit/beaeaaec8f691c24b8b2fb18c365fa18d819d2ab))
* 站点 store 新增卡片高亮定位状态 ([3be753b](https://github.com/arwei944/navigator-v2/commit/3be753b7e54ad2b133b907c4573373b957981a11))
* 站点 store 返回新建对象并支持撤销新增 ([66aab55](https://github.com/arwei944/navigator-v2/commit/66aab55d51fb2eb7a86069ff5136ba52027daed7))
* 管理后台新增偏好设置 Tab 与网址自动添加开关 ([776d60f](https://github.com/arwei944/navigator-v2/commit/776d60ffca79997063c54cce575505caa087ff05))
* 自动添加接入分类决策并返回分类结果 ([3d4d614](https://github.com/arwei944/navigator-v2/commit/3d4d6148fb52388399e1180405ff9a30e1038c65))
* 自动添加改为域名兜底入库，退役抓取失败与低置信护栏 ([0e7caf4](https://github.com/arwei944/navigator-v2/commit/0e7caf4585e9eea20fe015a11bd8e352243de98f))


### Bug Fixes

* **api:** Blob 读取加 useCache:false，发布后首次读取即拿到最新版本 ([f4c210d](https://github.com/arwei944/navigator-v2/commit/f4c210dfba1e8fa163e551a5eef2f99e9480efa6))
* **auto-add:** 分类创建与站点写库纳入同一 try 块 ([038afd2](https://github.com/arwei944/navigator-v2/commit/038afd2e989455cd46577b22a3b3db5766b34eb7))
* **gate:** 放行凭证落盘持久化，修复 CLI 跨进程核销失效 ([4f8103b](https://github.com/arwei944/navigator-v2/commit/4f8103b503944117a6924db8cfaf4adb5c8d2c89))
* **infer:** 支持读取 manifest theme_color，修复仅声明在 webmanifest 的站点配色退化 ([182cc7b](https://github.com/arwei944/navigator-v2/commit/182cc7be47ef369fc1e327f53188b9ffedf545d1))
* **open:** 卡片改为「链接导航」式新标签页打开，不再走 window.open ([0359d8e](https://github.com/arwei944/navigator-v2/commit/0359d8e05789a56a1520777ece3fdaec8e3fcf5c))
* **search:** 已收录域名回车改走 Toast 定位，保留外链打开途径 ([b94f10e](https://github.com/arwei944/navigator-v2/commit/b94f10e9eec27fa57f6415c41802f1aad465b495))
* **sites:** 拒收 favicon.im 占位图标，修复内联 SVG 图标被引号截断 ([a096cd2](https://github.com/arwei944/navigator-v2/commit/a096cd2b5fd4f197d4719645e38475672e4fcddf))
* **watch:** 修正部署失败后的无限自动重试 ([b03e691](https://github.com/arwei944/navigator-v2/commit/b03e691fe4aa7182cd23386ba84aa1b0ec912567))
* 修复体检发现的 P0（数据覆盖 / PWA 全失效）与 6 项 P1 ([a703c38](https://github.com/arwei944/navigator-v2/commit/a703c386148b9ddb297cad4f96cf3464ad96b158))
* 修复预览卡片编辑保存后不关闭的问题 ([08ab5f2](https://github.com/arwei944/navigator-v2/commit/08ab5f2153b9a1e399d60b1cb9b9a27d2de93f31))
* 分类本地持久化覆盖层 + 自动添加在途锁防重复入库（裁定 6/7） ([d2a94f5](https://github.com/arwei944/navigator-v2/commit/d2a94f51c28481417747d5f6273816608ca2e836))
* 移除自动添加服务中撞码的入库失败兜底分支 ([6a70a2b](https://github.com/arwei944/navigator-v2/commit/6a70a2b244155d2e67fe7964dd90b7c4c1cd2db3))
* 补齐偏好设置面板标题 h2 自足样式 ([e4fca8a](https://github.com/arwei944/navigator-v2/commit/e4fca8a59671f4aaeeb0a7056bf8eb8f01ab2460))


### Performance Improvements

* 第二批性能与流量优化（轮询 304 / SW 预缓存瘦身 / 单卡改动 3.9×） ([5c0221e](https://github.com/arwei944/navigator-v2/commit/5c0221e267e980aed4dcd2f58f73504d5f10d4aa))
