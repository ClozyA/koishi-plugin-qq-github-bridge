import { Context, h } from 'koishi'
import { Config, validateConfig } from './config'
import { registerModels } from './database/models'
import { registerConsole } from './console'
import { Bridge } from './handlers/commands'
import { readMessage } from './handlers/message'

export { Config } from './config'
export const name = 'qq-github-bridge'
export const inject = ['database', 'http']
export const usage = `
通过 OneBot / NapCat QQ 群评论、关闭和重开 GitHub Issue / PR。

1. 启用持久数据库（推荐 database-sqlite）、OneBot 适配器。
2. 填写统一 GitHub Token、至少一位超级管理员、群与仓库绑定。
3. 启用官方 console 和 auth，并用部署管理员账号登录，左侧即可打开「QQ GitHub Bridge」维护管理员、查看审计和验证 Token。

默认高风险操作需要同一 QQ 在原群发送确认码。详细命令与权限说明见 README。
`

export function apply(ctx: Context, config: Config) {
  validateConfig(config)
  registerModels(ctx)
  const bridge = new Bridge(ctx, config)
  ctx.middleware(async (session, next) => {
    const message = readMessage(session, bridge.repositories, config.dedupWindow)
    if (!message) return next()
    const reply = await bridge.handle(message)
    if (reply === null) return next()
    // Treat responses as literal text, so API links / database fields cannot inject CQ elements.
    if (reply) return h.text(reply)
  }, true)
  registerConsole(ctx, bridge)
  ctx.on('ready', () => bridge.cleanup())
  ctx.setInterval(() => void bridge.cleanup(), 3600000)
  ctx.on('dispose', () => bridge.dispose())
}
