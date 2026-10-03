# Changelog

## [3.1.0](https://github.com/arwei944/navigator-v2/compare/nav-v2-v3.0.0...nav-v2-v3.1.0) (2026-10-03)


### Features

* **console:** 新增历史与数据面板，实现提交×部署关联与数据体检 ([8fd6b6e](https://github.com/arwei944/navigator-v2/commit/8fd6b6e351a01189511aa63a42d3a2254aff7436))
* **console:** 新增可用性与审计面板，diff 支持分块暂存，同步面板接入门禁与快照 ([0157409](https://github.com/arwei944/navigator-v2/commit/01574090dbec4c89a97fd85d97421fcd63984b1f))
* **console:** 新增同步面板，实现一键发布全链路时间线与云端一致性验证 ([05decd2](https://github.com/arwei944/navigator-v2/commit/05decd2378fdbcaee3a715ce5019aeb1e10f0229))
* **console:** 新增本地运维控制台，支持改动/diff/暂存/提交/推送与 SSE 实时日志 ([fd5a5d1](https://github.com/arwei944/navigator-v2/commit/fd5a5d1b226db80a6baa7fdf2b6769144a20e670))
* **console:** 新增站点管理面板，实现站点增删改与一键同步云端 ([f579203](https://github.com/arwei944/navigator-v2/commit/f5792039758e25a05f07d0001ccaecbba4f08500))
* **infer:** 升级站点元信息抓取引擎 ([7369982](https://github.com/arwei944/navigator-v2/commit/7369982b485d49e3803fb7e40a5ec9d56f264dc9))
* Navigator V2 网站导航中心 - 210+ 站点 / 4 大类 22 子分类 / Vue 3 + Vite + Pinia / PWA / Vercel 部署 ([1804399](https://github.com/arwei944/navigator-v2/commit/1804399e87364b9bcd34e50b0fc0fff1637f425b))
* Navigator V3 — 清理失效 KV 同步，统一 Blob 数据源，增加发布门禁与数据校验 ([c642eac](https://github.com/arwei944/navigator-v2/commit/c642eac3005eb4d22ecac778e54186cff6acb73f))
* **nav:** 侧栏底部新增常驻管理入口（折叠态收为图标）+ HANDOVER §33 ([fa38c68](https://github.com/arwei944/navigator-v2/commit/fa38c68f298e53e04aef2461247d5ab7e97c4428))
* **nav:** 导航结构重设计 + 别名检索 + 发布/管理大模块 ([f49a044](https://github.com/arwei944/navigator-v2/commit/f49a044ab9b7f06aca80a06c164c32f50247fb6f))
* **nav:** 管理后台升级 + 站点探活重构 + 点击统计与排序 ([fecc603](https://github.com/arwei944/navigator-v2/commit/fecc60396fdfcf9a7ddbe7a720e0a1214217ba15))
* **scripts:** 发布门禁、CLI 参数化、图标/排序修复与滚动性能基准 ([b8c622d](https://github.com/arwei944/navigator-v2/commit/b8c622d0652a51e7b256235adf614d289efc484a))
* **sites:** 收录 bs9 华润赢（huarun.win，代理/VPN） ([f0e1c1d](https://github.com/arwei944/navigator-v2/commit/f0e1c1de740f374c23e7d31cf2ba43ffe667062f))
* **sites:** 收录 dt34 OpenChainBench（加密货币基础设施公开基准测试站，数据与研究） ([fc6c52d](https://github.com/arwei944/navigator-v2/commit/fc6c52dcbfd0f2e88fec854efc602fc581402656))
* **sites:** 新增 6 个站点并更新 3 个 favicon ([dddc3d9](https://github.com/arwei944/navigator-v2/commit/dddc3d973f7c67095413687d4cdd34bd1e0d8584))
* **stores:** 本地数据版本化持久化与站点在线状态探测 ([c79c7f9](https://github.com/arwei944/navigator-v2/commit/c79c7f9e6f219e60a40f5069cd74d1931d5f8503))
* **sync:** 新增云端会话同步接口与客户端服务，站点接口鉴权改为请求头 ([4e8fe18](https://github.com/arwei944/navigator-v2/commit/4e8fe189e4813b3b064b6b067dd4e3c3fbefe7c2))
* **ui:** 站点在线角标、智能推荐、卡片虚拟化与后台数据洞察 ([8f11baa](https://github.com/arwei944/navigator-v2/commit/8f11baaf1e906efc16547958695e1a58cf0419f8))
* **v5:** MCP 服务化，把 35 条命令收敛成 5 个域级工具 ([67bfa02](https://github.com/arwei944/navigator-v2/commit/67bfa026230509b00128b90a2bb01207bdde824b))
* **v5:** 云端快照回滚、发布门禁、操作审计、可用性看板与 hunk 分块暂存 ([87e35d9](https://github.com/arwei944/navigator-v2/commit/87e35d949d5a216ea23cf343821a379e30ac9d55))
* 交付智能体 CLI、站点自动补全与本地覆盖层，收口控制台安全边界 ([ccd9750](https://github.com/arwei944/navigator-v2/commit/ccd9750158209647af5e624f0bad4395dbeff485))


### Bug Fixes

* **api:** Blob 读取加 useCache:false，发布后首次读取即拿到最新版本 ([f4c210d](https://github.com/arwei944/navigator-v2/commit/f4c210dfba1e8fa163e551a5eef2f99e9480efa6))
* **gate:** 放行凭证落盘持久化，修复 CLI 跨进程核销失效 ([4f8103b](https://github.com/arwei944/navigator-v2/commit/4f8103b503944117a6924db8cfaf4adb5c8d2c89))
* **infer:** 支持读取 manifest theme_color，修复仅声明在 webmanifest 的站点配色退化 ([182cc7b](https://github.com/arwei944/navigator-v2/commit/182cc7be47ef369fc1e327f53188b9ffedf545d1))
* **sites:** 拒收 favicon.im 占位图标，修复内联 SVG 图标被引号截断 ([a096cd2](https://github.com/arwei944/navigator-v2/commit/a096cd2b5fd4f197d4719645e38475672e4fcddf))
