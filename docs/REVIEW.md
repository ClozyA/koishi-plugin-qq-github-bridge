# 第一版需求复核

复核日期：2026-10-26（Asia/Shanghai）。依据用户提供的开发任务、当前源码、实际安装依赖及官方文档。

## 结论

核心实现符合第一版功能与架构要求，具备作为独立 Koishi 插件公开发布的基础。未发现阻止源码公开的明显功能缺口或普通用户越权路径。完整验收尚未完成：真实 QQ / NapCat 消息投递、真实 GitHub 评论与状态变更未实际执行，不能声称生产环境全部验证通过。

原始交付缺少 Git 版本管理、仓库 / 维护者 npm 元数据和自动发布 CI。本次补齐公开仓库元数据、版本管理、跨平台 CI、发布包加载检查、标签发布工作流和维护者发布文档。

## 按需求检查

| 需求 | 源码与自动化结论 | 主要证据 |
| --- | --- | --- |
| 独立 TypeScript 插件及生态元数据 | 符合；Koishi peer dependency、Schema、生命周期与 CJS 入口齐全 | package.json、src/index.ts、src/config.ts |
| 单 Token、多仓库、群绑定 | 符合；目标只从绑定解析，禁止重定向突破绑定 | services/repository.ts、services/github.ts、bridge / runtime 测试 |
| OneBot QQ 群真实身份检查 | 符合；核对原始事件与 Session 的 QQ / 群 / 消息标识，过滤私聊、匿名、自身和非文本 | handlers/message.ts、runtime 测试 |
| Issue / PR 普通评论与正文保留 | 符合；共用 issue-comments 接口，固定转义身份头与原正文分开 | services/github.ts、bridge 测试 |
| 自定义前缀 / 完整正则 | 符合；RE2、命名组、长度和全文匹配校验，特权指令优先 | utils/parser.ts、parser 测试 |
| 独立 QQ 管理员、递归授权与超级管理员撤权 | 符合；不读取 QQ authority，持久化管理员与添加者，数据库失败不宣称成功 | services/permission.ts、bridge 测试 |
| 动态后台维护 | 符合；官方 console/auth RPC 与 QQ 共用数据库，登录状态与当前权限重新检查 | console.ts、client/page.vue、console / client 测试 |
| 审计与保留 | 符合；pending / success / noop / failed / unknown，定期清理，不记录评论正文 | services/storage.ts、bridge 测试 |
| 关闭 / 重开 Issue 与 PR | 符合；使用对应端点、已达状态不写入，merged PR 拒绝重开；未实现 merge | services/github.ts、bridge / github-errors 测试 |
| 去重 / 冷却 / 有限重试 | 符合；数据库事件主键、跨重启记录、串行有界队列，写入不自动重试 | storage.ts、utils/lock.ts、bridge / github-errors 测试 |
| Token 隔离和错误处理 | 符合检查范围；不回显上游错误对象，拒发包含部署 Token 的正文，覆盖常见 HTTP 错误 | utils/errors.ts、github-errors / console 测试 |
| 文档与可发布包 | 符合；安装、Token 权限、边界和真实验收说明齐全 | README、TESTING、RELEASING、check-package.cjs |

后台等级 5 是 Koishi 网页部署管理入口的鉴权，与 QQ 角色体系分开；符合“不依赖 Koishi authority 管理 QQ 管理员”的要求。

## 本次重新执行的验证

Windows、PowerShell 7.6.9、Node 24.15.0、npm 12.0.2：

- `npm ci`：成功。
- 初次 `npm run check`：后端与 Vue 类型检查、构建成功；6 个测试文件、125 项测试通过。随后增加社区版 OneBot 6.9.4 解码兼容测试，完整 126 项测试与类型检查均通过；补充改动在 Ubuntu / Node 22、Ubuntu / Node 24、Windows / Node 24 三组 CI 也全部通过。
- `npm audit --omit=dev`：0 项；增加社区适配器测试依赖后，完整开发依赖树为 26 项（19 moderate、7 high）。新增一项是社区适配器经由既有 Koishi peer dependency 产生的归因；未新增生产直接依赖。Koishi 等宿主依赖在此项目中作为 dev / peer 依赖，不能据此推导实际部署无漏洞。
- 包文件与提取后 Koishi / SQLite 加载检查：`npm run check:package` 本地通过，并纳入 CI。
- 独立消费者安装：从 GitHub Release 下载实际 `v1.0.0` 安装包，在隔离目录通过 npm 安装及独立解析 Koishi / HTTP / SQLite 依赖，启动插件并读写管理员表成功；没有沿用源码目录的 node_modules。
- `v1.0.0` 的 Ubuntu / Node 22、Ubuntu / Node 24、Windows / Node 24 三组 CI 均通过，包含 125 项测试和包加载检查；GitHub Release 由标签流水线成功创建。后续版本以仓库 Actions、GitHub Releases 和 npm registry 为准。

## 仍需真实环境验收的边界

1. 尚未连接真实 NapCat / QQ。现有 runtime 测试使用官方 OneBot 6.0.2、社区版 OneBot 6.9.4 的解码器和人工事件；前者已被上游标为停止官方支持。实际部署仍需实测所选实现的字段与消息链路。
2. GitHub HTTP 测试请求本机模拟服务器，未用真实 PAT 评论或修改 Issue / PR。
3. 本次没有重复执行完整后台浏览器交互验收；已有 Vue 组件及带真实 auth / SQLite 的 RPC 测试通过。历史交付的浏览器检查记录见 TESTING，不把历史记录描述成本次重新实测。
4. 并发队列按插件实例工作；去重主键可跨实例，但多进程共享数据库的权限 / 冷却 / 状态更新事务不在第一版承诺范围。推荐同一 Koishi 应用只启用一个桥接实例。
5. Token 属于一个 GitHub 账号；Fine-grained PAT 的单资源所有者限制需要部署者按绑定仓库安排。

真实环境验收步骤见 TESTING。公开发布是分发验证，不能代替这些运行验收。

## 2026-10-27 发布验证补充

- `1.0.0` 已在 npm 公开发布，registry 安装包 SHA512 integrity 与 GitHub Release 的 tarball 一致。
- npm OIDC 已绑定 `ClozyA/koishi-plugin-qq-github-bridge` 的 `release.yml`，CI 已实际发布 `1.0.1`，registry 返回 SLSA v1 来源证明，tarball integrity 与 GitHub Release 一致。
- `1.0.1` 首次运行发现 npm 后台处理导致发布后暂时 404，原脚本等待过短；registry 可见后重跑成功且未重复上传。已修正为有界等待与读取重试，新增 3 项回归测试，覆盖超过一分钟后可见、永久权限错误以及达到等待上限。`1.0.2` 发布前全量 129 项测试、类型检查、构建和包加载检查均通过。
- 部署者提供的 Koishi 实例仍显示无法连接插件市场，未在该实例安装或启用本插件；不把源码与 npm 验证描述为真实 QQ / GitHub 业务链路验收。
