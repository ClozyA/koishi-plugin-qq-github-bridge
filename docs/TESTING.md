# 原始交付的测试与验收报告（2026-10-25）

本文保留 2026-10-25 原始交付的历史记录，以下“未发布”等状态属于该日期。2026-10-26 的重新检查、GitHub / npm 发布准备与验收结论见 [本次需求复核](REVIEW.md)，当前发布配置见 [发布说明](RELEASING.md)。

验证日期：2026-10-25（Asia/Shanghai）。本报告区分真实运行的框架与模拟的外部系统。

## 已执行结果

| 层级 | 结果 | 具体范围 |
| --- | --- | --- |
| 后端 TypeScript 静态检查 | 通过 | 严格模式，含后端与自动化测试源码 |
| Vue / 前端 TypeScript 静态检查 | 通过 | 使用由实际官方 SDK 生成的声明，严格检查本插件客户端 |
| 插件构建 | 通过 | `tsc` 输出 CommonJS / 声明 / source map，官方 client 构建器输出 JS / CSS |
| 自动化测试 | **125 项通过，6 个测试文件通过** | `npm run check`，最后完整运行耗时约 4.53 秒（不含检查与构建） |
| 真实 Koishi 框架 | 通过本地集成验证 | Context、服务注入、消息分发、中间件、auth、console、停用与重新启用；不是线上生产部署验收 |
| 真实 SQLite 驱动 | 通过 | 内存数据库 CRUD、临时磁盘数据库关闭后重新打开，管理员 / 去重记录保持 |
| 真实 Koishi HTTP 服务 | 通过 | 请求本机模拟 GitHub HTTP 服务，验证路径、方法、请求头、状态、超时和中止 |
| 官方 OneBot 适配器解码 | 通过 | 调用 6.0.2 发布包的 `adaptSession` 解码人工构造的 OneBot 群消息 |
| 独立 npm 消费者安装 | 通过 | 用实际 `.tgz` 安装到独立目录，从 node_modules 加载插件并启动 console / auth / SQLite |
| 后台实际页面 | 已验证加载与显示 | 在本机 Koishi 的生产资源模式登录测试账号，打开插件页面，读取数据库并检查渲染；留有界面截图 |
| 后台新增 / 撤销交互 | 通过组件和 RPC 自动化测试 | 编译的 Vue 页面在 Happy DOM 内验证确认、取消、成功刷新、错误展示；RPC 使用真实 Koishi auth 和数据库 |
| 真实 OneBot / NapCat / QQ | **未验证** | 没有启动或登录真实 QQ；未测真实消息投递与 QQ 回执 |
| 真实 GitHub 写入 | **未验证** | 未使用真实 PAT，未向任何真实仓库评论或修改状态 |
| npm / 插件市场公开发布 | **未执行** | 已生成本地可安装包；未注册 / 登录 / 发布到外部账户 |

本机 Node.js 24.19.0、npm 11.17.0、Windows；Koishi 4.18.11、SQLite 4.7.0、HTTP 0.6.3、console/client 5.30.11、auth 4.1.7。仅验证了当前平台，未执行 Linux / macOS 或多数据库驱动矩阵。

浏览器实操中原生 `window.confirm` 阻塞了内嵌浏览器的控制通道，因此改为页面内确认。最终的新增、取消、撤销流程通过组件测试和服务端 RPC 测试验证；不把这描述成完整的真人浏览器点击端到端验收。

## 自动化覆盖

| 测试文件 | 主要验证 |
| --- | --- |
| `test/parser.test.ts` | 默认 / 自定义前缀、命名组、多行、空正文、错误编号、命令冲突、嵌套量词线性匹配、危险正则与配置拒绝 |
| `test/bridge.test.ts` | Issue / PR 评论、多群路由、正文保留、昵称注入、递归授权、撤权边界、并发授权、状态端点、merged PR、去重、冷却、审计失败、SQLite 重启 |
| `test/github-errors.test.ts` | 401/403/404/422/429/503、限流暂停、禁止重定向、连接中断、写超时、有限 GET 重试、停用中止、响应异常、企业 / 代理返回链接 |
| `test/runtime.test.ts` | 真正消息管线、OneBot 解码、热重载、重新绑定、低 authority 仍可评论、忽略私聊 / 非 OneBot / 匿名 / 不一致身份 / 自身 / 媒体 / 历史消息 |
| `test/console.test.ts` | 未登录、过期会话、会话撤销、旧 socket 被降权、QQ 与后台共享数据库、输入校验、auth 停用后 RPC 清理 |
| `test/client.test.ts` | 编译 Vue 页面的二次确认、取消、撤销、刷新、错误反馈、选择绑定检查 Token、元数据按文本渲染 |

使用本地模拟服务器，不依赖外部 GitHub 或真实 QQ。权限测试使用真实 Koishi 数据库接口；故障注入只在明确的失败场景替换对应方法。HTTP 测试不是简单地替换 `github.comment()` 返回成功。

## 复现

在源码目录运行：

```sh
npm ci
npm run typecheck
npm run build
npm test
npm pack
```

也可运行 `npm run check` 一次执行前三项验证。查看某一测试：

```sh
npm test -- test/runtime.test.ts --reporter=verbose
```

本地后台预览：

```sh
npm run preview
```

脚本仅监听本机，控制台端口从 5147 到 5167 选择。测试登录为 `bridge-preview` / `local-preview-only`，使用内存数据与模拟 GitHub，只为开发检查准备，不可作为生产启动配置。退出后测试数据不保留。

## 依赖审计的实际边界

- 源码完整开发依赖树：**25 条告警（18 moderate、7 high）**。
- 本插件仓库执行 `npm audit --omit=dev`：0 条。这里 Koishi / console / auth 同时作为开发测试宿主和 peer dependency，因而这条命令**不代表实际部署的整个 Koishi 应用没有漏洞**。
- 独立消费者安装 Koishi、console、auth、SQLite 和本插件后的树：**19 条告警（14 moderate、5 high）**。
- 告警主要来自宿主 / 工具链的 `file-type`、`zod` / `koa-body`、`js-yaml`、`uuid`，开发客户端另含 `element-plus`、旧 Vite / esbuild 的传递问题。部分是旧主版本无法直接修复的依赖约束。
- 已尝试遵循现有版本范围的 `npm audit fix`，未通过 `--force` 强行降级或替换框架。没有声称所有告警均已修复，也没有针对每条上游告警做可利用性验证。

依赖锁文件随源码交付。正式上线时应复核宿主的当前安全更新；仅使用 `npm audit --omit=dev` 的零告警作为安全结论是不充分的。

## 真实环境验收步骤（尚未执行）

1. 使用隔离测试 QQ 群、真实 NapCat / OneBot 连接与专用 GitHub 测试仓库。先确认原始 `message_id`、`time`、`user_id`、`sender.user_id`、`group_id` 和 `self_id` 均正常。
2. 为测试仓库配置最小权限 Fine-grained PAT，在后台检查身份与仓库可读性。
3. 向 Issue 和 PR 分别发送多行 `re编号 正文`，检查 GitHub 正文、身份头和 QQ 返回的评论链接。
4. 普通用户尝试 close / open / ghadmin，确认 GitHub 无变化。
5. 超级管理员授权 A，A 授权 B，B 再授权 C；重启 Koishi 后检查权限。普通管理员撤权应失败，超级管理员撤权立即生效。
6. 按提示确认关闭和重开 Issue、普通 PR；对已合并 PR、源分支已删除 PR 检查实际 GitHub 错误与 QQ 反馈。
7. 将第二个群绑定另一个仓库，验证路由隔离；禁用或删除绑定，确认不再调用 GitHub。
8. 对相同 OneBot 事件重复投递、重连后回放、插件停用重启测试，检查不会重复评论。模拟提交后断网，核对不确定提示。
9. 在真实浏览器手动完成后台新增、取消、撤销、分页、Token 检查，并检查窄屏 / 实际主题；确认普通控制台账号和未登录访客无法读写管理数据。
10. 检查 Koishi / NapCat 全链路日志、配置备份保护与日志保留，确保部署中的其他插件不记录请求凭据。

以上验收需要部署者实际环境与凭据，本次没有假设或伪造结果。
