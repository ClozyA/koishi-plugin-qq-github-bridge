# koishi-plugin-qq-github-bridge

[![CI](https://github.com/ClozyA/koishi-plugin-qq-github-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/ClozyA/koishi-plugin-qq-github-bridge/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/koishi-plugin-qq-github-bridge)](https://www.npmjs.com/package/koishi-plugin-qq-github-bridge)

通过 QQ 群评论、关闭、重开 GitHub Issue / Pull Request。使用部署者统一配置的 PAT、群与仓库绑定、独立 QQ 管理员体系和 Koishi 数据库，带官方控制台扩展。

## 功能

- `re1003 正文` 发布 Issue / PR 普通会话评论，支持 Markdown、多行和中英文，返回评论链接。
- `close1003` / `open1003` 修改 Issue 或 PR 状态；识别已合并 PR 和无需变更的状态。
- QQ 群绑定唯一仓库，多个群可共享仓库。目标只来自后台绑定；消息里的链接不能切换仓库。
- 超级管理员由 Schema 配置；普通管理员可递归授权。只有超级管理员可在 QQ 撤销管理员。
- 后台管理页面实时读取、添加和删除数据库中的管理员，显示添加者、时间、审计及 Token 检查。
- 基于事件标识的数据库去重、跨重启冷却、有限只读重试和写入结果不确定处理。
- 通过 RE2 执行自定义正则，避免回溯型正则阻塞事件循环。

不实现 PR 合并、Review Comment、OAuth、Webhook、跨平台机器人或删除 GitHub 内容。

## 运行条件

| 组件 | 要求 / 本次验证版本 |
| --- | --- |
| Node.js | >= 22；2026-10-26 本地复核使用 24.15.0 |
| Koishi | ^4.18.11 |
| 数据库 | Koishi 持久数据库；实际验证 `database-sqlite` 4.7.0 |
| HTTP | Koishi `http` 服务；实际验证 0.6.3 |
| QQ | OneBot v11 / NapCat 群消息，Koishi 平台名必须是 `onebot` |
| 后台页面 | `console` ^5.30.11 + `auth` ^4.1.7，使用已登录的部署管理员账号 |

本插件不安装或接管 QQ 适配器。当前发布的官方 `adapter-onebot` 6.0.2 已被上游标记为停止官方支持；本次验证了该包的事件解码器与 Koishi 的衔接，**没有登录真实 QQ，也没有连接真实 NapCat**。选择其他兼容实现后，需要按 [真实环境验收步骤](docs/TESTING.md) 检查其事件字段。

## 安装

在 **Koishi 应用目录** 安装 npm 包：

```powershell
npm install koishi-plugin-qq-github-bridge
```

也可以从 [GitHub Releases](https://github.com/ClozyA/koishi-plugin-qq-github-bridge/releases) 下载 `.tgz`，在应用目录安装：

```powershell
npm install "C:\你的下载目录\koishi-plugin-qq-github-bridge-1.0.0.tgz"
```

重载 Koishi 后，在插件配置中添加 `qq-github-bridge`。npm 依赖更新后如果控制台尚未刷新可用插件列表，请重启该实例。插件市场收录后也可以搜索 `qq-github-bridge` 安装；npm 发布成功不等同于已确认市场收录。

首次启用在 Koishi 后台完成：

1. 启用 `http`、持久数据库，以及已连接的 OneBot 适配器。SQLite 只需本地数据库文件，不需要另开数据库服务。
2. 在本插件「GitHub 设置」填写统一 Token；默认 API 为 `https://api.github.com`。
3. 在「独立权限设置」填写至少一个超级管理员 QQ。填真实数字 QQ，不能填 Koishi 用户 ID、昵称或 QQ UID。
4. 在「仓库绑定」添加群号、Owner、仓库名并启用。例：`345678901` → `example/project`。
5. 启用官方 `console` 与 `auth`，以部署管理员登录，打开左侧 **QQ GitHub Bridge**。
6. 使用「检查连接」验证 Token 身份与选定仓库的可读性。写权限仍需按下文配置。

普通使用者不需要 GitHub 账号或 Token。所有 GitHub 操作显示为 Token 所属账号执行；评论固定身份头和操作审计记录真实 QQ 操作者。

## GitHub Token

推荐 Fine-grained PAT：GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens。

1. 选择仓库所属的 Resource owner。
2. 仅选择要绑定的仓库。
3. Repository permissions 设置 **Issues: Read and write**、**Pull requests: Read and write**；Metadata 采用 GitHub 要求的只读权限。
4. 设置合理有效期；组织要求审批时，等待审批后再使用。Token 所属账号本身也必须有目标操作权限。

Fine-grained PAT 限定单个资源所有者，不能用一个这样的 Token 同时覆盖多个组织。多个仓库属于同一组织时可统一选择；确实需要跨组织且组织策略允许时，可以使用拥有适当权限的 classic PAT（公开仓库通常使用 `public_repo`，私有仓库需 `repo`）。第一版仍然只有一个 Token，不能自动突破 GitHub 的授权边界。[GitHub 官方 Token 说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

PR 的普通评论使用 Issues comments 接口，状态变更使用对应的 Issues / Pull requests 接口。[评论接口](https://docs.github.com/en/rest/issues/comments#create-an-issue-comment)、[Issue 状态接口](https://docs.github.com/en/rest/issues/issues#update-an-issue)、[PR 状态接口](https://docs.github.com/en/rest/pulls/pulls#update-a-pull-request)

不要把 Token 发到 QQ。插件配置使用 secret 输入框；管理页面、审计和对外错误不会返回 Token。部署者仍需保护 Koishi 配置文件、备份和控制台登录账户。

## QQ 指令与角色

以下指令必须在已启用绑定的 QQ 群内发送，且必须是纯文本消息。

| 指令 | 可使用角色 |
| --- | --- |
| `re1003 这个问题已经修复。` | 所有绑定群成员 |
| `close1003` | 管理员、超级管理员 |
| `open1003` | 管理员、超级管理员 |
| `ghadmin add 123456789` | 管理员、超级管理员 |
| `ghadmin remove 123456789` | 仅超级管理员 |
| `ghadmin list` / `ghadmin list 2` | 管理员、超级管理员 |
| `ghadmin confirm 确认码` | 原操作人，在原群确认 |

默认关闭、重开、授权和撤权要求二次确认。机器人给出随机确认码，有效期 60 秒；同一人在同一群发起新操作会替换旧确认。确认时再次检查权限，撤权后旧确认失效。取消可等待过期；插件重载会清空确认。

QQ 权限从真实 OneBot 用户 ID 与本插件数据库判断，**不会读取 QQ 用户的 Koishi `authority`**。群主、QQ群管理员、机器人其他插件的管理员均不会自动获得本插件权限。权限跨所有绑定群生效。撤销一名管理员不会级联撤销其曾经授权的人。

后台维护使用官方控制台登录机制，限制到等级 5 的部署管理员；这是保护部署配置的网页访问门槛，不会授予其关联 QQ 任何额外权限。后台每次操作重新检查当前账户等级、Token 会话及过期时间。`auth` 停用后管理接口移除。后台变更记录 `console:账户ID`；如果账户绑定了 OneBot QQ，审计同时记该 QQ，未绑定时不编造 QQ。

## 匹配、正文和模板

默认规则：

```regex
^re(?<number>\d+)\s+(?<body>[\s\S]+)$
```

可以修改 `replyPrefix`；填写 `replyPattern` 后，回复前缀仅在清空自定义正则后生效。管理员指令和状态指令优先于自定义评论匹配。

自定义规则必须以 `^` 开始、`$` 结束，且声明 `(?<number>...)` 与 `(?<body>...)`；使用 RE2、固定 `u` 模式，不写 `/.../flags`。不支持回溯引用和前后查找。最多 1024 字符，构造失败时拒绝启用。编号必须为可精确表示的正整数；全文匹配再次校验，防止分支和末尾换行绕过边界。

例如：

```regex
^回复 #(?<number>\d+):(?<body>[\s\S]+)$
```

`回复 #1003:正文` 就会发布评论。捕获到的 `body` 保留原文，包括 Markdown、换行和末尾空格；默认规则的 `\s+` 是指令分隔符，想保留正文起始空白时可采用以上冒号规则。

评论模板仅支持一次 `{body}`。昵称、QQ、群号由插件生成固定身份头，昵称会转义并移除控制字符，不与正文混排。正文不做 Markdown 转义、不改写提及；它以 GitHub 机器人账号发布，所以正文里的 `@用户名` 会遵循 GitHub 的通知行为。模板后附内部去重标记，便于人工核查超时结果。

第一版不转存图片、语音、文件，不自动剥离 @ 或引用消息。含非文本元素、引用、匿名消息、私聊、QQ 频道、未绑定群、机器人自身及同实例其他 OneBot 机器人消息均忽略。没有可靠消息 ID 或时间戳的事件也忽略。

## 配置与运维

所有日常配置通过插件 Schema 表单修改，保存后按 Koishi 生命周期重新加载，无需重新安装。数据库管理员立即生效，无需重载。

| 设置 | 默认值 | 含义 |
| --- | --- | --- |
| `apiBaseUrl` | `https://api.github.com` | 企业版可填 `https://主机/api/v3`；仅本机测试允许 HTTP |
| `apiVersion` | `2026-03-10` | 企业版需改为其支持的版本 |
| `requestTimeout` | 15000 ms | 单个 API 请求超时 |
| `readRetries` | 2 | 网络 / 5xx 的额外只读重试次数 |
| `userCooldown` | 5000 ms | 每用户跨群共享，保存在数据库 |
| `maxCommentLength` | 6000 | UTF-16 字符数；渲染后另受 65000 字节上限约束 |
| `allowMultiline` | `true` | 允许多行正文 |
| `confirmHighRisk` | `true` | QQ 高风险操作确认；后台也有明确确认步骤 |
| `confirmationTimeout` | 60000 ms | QQ 确认码有效期 |
| `enableAdminCommands` | `true` | 关闭后禁止 QQ 新增 / 撤权 / 列表；状态管理仍按管理员权限判断 |
| `auditEnabled` | `true` | 操作审计；不记录昵称、评论正文或 Token |
| `auditRetentionDays` | 30 | 每小时清理，关闭审计后也清理过期历史 |
| `dedupWindow` | 86400000 ms | 24 小时去重；过期历史事件不执行 |

错误处理、数据备份、生命周期与已知边界见 [架构与可靠性](docs/ARCHITECTURE.md)。

## 开发、验证与发布

```powershell
npm ci
npm run check
npm run check:package
npm pack
```

`check` 分别执行后端与前端 TypeScript 检查、构建和自动化测试。前端使用 Koishi 官方 `@koishijs/client` 构建器；由于该版本直接导出 TS/Vue 源码且未包含声明的 `global.d.ts`，检查脚本先从已安装 SDK 生成声明，再对本插件客户端严格检查，不手写 SDK 类型桩。

`npm run preview` 启动仅监听 `127.0.0.1` 的开发预览，使用内存数据库、模拟 GitHub 和固定的本地测试账户。此脚本不是生产启动器，不连接真实 QQ 或 GitHub。源码预览使用官方 devMode；生产环境应安装 `.tgz` 或 npm 包，使控制台能从 `node_modules` 加载编译资源。

`.tgz` 包含 `lib/`、`dist/`、`src/`、`client/`、文档与许可证，兼容已安装插件的开发模式与源码调试；完整源码交付另外包含测试、锁文件和构建脚本。Koishi 是 peer dependency，唯一直接运行依赖为 `re2-wasm`。

CI 在 Linux（Node 22 / 24）和 Windows（Node 24）执行静态检查、构建、125 项自动化测试和实际安装包加载检查。

维护者发布新版本时，在 PowerShell 7（`pwsh`）运行：

```powershell
npm version patch
git push origin main
git push origin --tags
```

推送 `v*` 标签后，Release workflow 校验版本及 main 分支归属，重新检查并生成 `.tgz` 和 SHA256，创建 GitHub Release，再通过 npm OIDC 可信发布上传同一安装包并生成来源证明。首次 npm 发布及可信发布关系需要维护者初始化；具体配置、开关和失败重试见 [发布说明](docs/RELEASING.md)。

[需求复核结论](docs/REVIEW.md)明确区分源码符合程度、自动化验证及尚缺的真实环境验收。[历史测试报告](docs/TESTING.md)保留原始交付的验证范围；官方资料与技术选择见 [调研记录](docs/RESEARCH.md)。
