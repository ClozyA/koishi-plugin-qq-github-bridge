# 官方接口调研记录

核对日期：2026-10-25。实现以当次实际安装的包及其类型声明为准；下列官方网页用于确认设计与接口语义。

## Koishi

- [官方仓库](https://github.com/koishijs/koishi)：读取 README、package.json 和 Session 源码，确认 TypeScript 插件生态、工作区与消息表示。
- [开发环境](https://koishi.chat/zh-CN/guide/develop/setup.html)：使用独立 npm 包交付，插件运行要求明确设为 Node >=22。
- [Schema](https://koishi.chat/zh-CN/guide/plugin/schema.html)：导出 `Config`，分组 Schema、secret Token 与中文说明。
- [事件系统](https://koishi.chat/zh-CN/guide/basic/events.html)、[中间件](https://koishi.chat/zh-CN/guide/basic/middleware.html)：前置中间件接收命令，普通聊天向下游传递。
- [服务与依赖](https://koishi.chat/zh-CN/guide/plugin/service.html)、[生命周期](https://koishi.chat/zh-CN/guide/plugin/lifecycle.html)：声明必需服务，动态注入控制台，在 dispose 清理额外副作用。
- [数据库](https://koishi.chat/zh-CN/guide/database/)、[模型](https://koishi.chat/zh-CN/guide/database/model.html)：`model.extend`、显式主键和数据库 CRUD，不要求外部 Redis / 队列。
- [扩展控制台](https://koishi.chat/zh-CN/guide/console/)、[数据交互与鉴权](https://koishi.chat/zh-CN/guide/console/data.html)：`addEntry`、`addListener`、客户端 `ctx.page` 和 `send`。
- [官方控制台仓库](https://github.com/koishijs/webui)：读取 auth 与 client 构建源码，并核对 console 已发布版本的实现。
- [发布要求](https://koishi.chat/zh-CN/guide/develop/publish.html)：符合 `koishi-plugin-*` 名称、语义版本、Koishi peer dependency 和发布文件组织。

实际依赖：Koishi 4.18.11、console/client 5.30.11、auth 4.1.7、SQLite 4.7.0、HTTP 0.6.3。锁文件固定本次安装结果。

## 通过实际源码和运行发现的差异

1. 当前 HTTP 是 fetch 风格的 Cordis 服务，`ctx.http(url, options)` 返回含 `status` / `data` / `Headers` 的响应；不能照搬旧版 axios 错误对象处理。
2. Satori 在分发时将旧 `message` 事件规范化为 `message-created`。两者均接纳，原始 OneBot 消息类型仍必须为群消息。
3. OneBot 6.0.2 使用 `session.setInternal('onebot', payload)` 暴露 `session.onebot`，昵称、ID 与群号从真实适配器字段读取。测试调用了该版本的真实 `adaptSession`。
4. console 的 `addListener` 只修改 listeners 字典，不自动随插件卸载；实现显式清理，并通过禁用 auth 的集成测试验证。
5. client 5.30.11 的 `./global` exports 指向未随包发布的文件；不依赖该文件，而是从安装的官方 TS/Vue 源码生成类型声明供插件客户端严格检查。
6. 生产控制台只允许特定位置的资源（包括 node_modules）。独立消费者测试使用实际 npm 安装的 `.tgz`；源码预览通过官方 devMode。
7. 官方 OneBot 6.0.2 npm 包标记了 `official support for onebot has been dropped`。因此记录的是已发布适配器的兼容性验证，不将其描述为仍由官方维护的最新方案。

## GitHub 与正则

- [Issue comments](https://docs.github.com/en/rest/issues/comments#create-an-issue-comment)：Issue 和 PR 普通评论共用端点。
- [Issues](https://docs.github.com/en/rest/issues/issues#update-an-issue)、[Pull requests](https://docs.github.com/en/rest/pulls/pulls#update-a-pull-request)：分别更新状态，PR 需额外处理 merged。
- [REST 最佳实践](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)：串行请求、写入间隔、限流头与退避。为严格仓库绑定与凭据隔离，本插件对重定向要求部署者修改绑定，而不自动跟随。
- [PAT 官方说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)：Fine-grained 单资源所有者限制、仓库选择与组织策略。
- [Google RE2 WASM](https://github.com/google/re2-wasm)：使用无灾难性回溯的引擎；以限制语法换取任意群消息输入下的可预测匹配时间。

未使用第三方博客作为 API 真实性依据。调研未获取任何用户真实 GitHub Token、QQ 登录状态或生产配置。
