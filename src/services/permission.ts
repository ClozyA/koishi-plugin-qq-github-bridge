import type { Context } from 'koishi'
import type { Config } from '../config'
import { QQ_PATTERN } from '../config'
import type { Actor, Outcome } from '../types'
import { BridgeError } from '../utils/errors'

export class Permissions {
  private readonly superAdmins: Set<string>
  constructor(private readonly ctx: Context, config: Config) {
    this.superAdmins = new Set(config.superAdmins)
  }

  async requireAdmin(actor: Actor, superOnly = false) {
    // Console actors are constructed only after a fresh authenticated deployer check.
    if (actor.source === 'console') return
    if (this.superAdmins.has(actor.qq)) return
    if (superOnly) throw new BridgeError('forbidden', '只有超级管理员可以撤销管理员权限。')
    const [admin] = await this.ctx.database.get('qgh_admin', actor.qq)
    if (!admin) throw new BridgeError('forbidden', '此操作需要 GitHub Bridge 管理员权限。')
  }

  async add(actor: Actor, qq: string): Promise<Outcome> {
    await this.requireAdmin(actor)
    if (!QQ_PATTERN.test(qq)) throw new BridgeError('qq', '请输入有效的数字 QQ 号。')
    if (this.superAdmins.has(qq)) return { message: `${qq} 已是后台配置的超级管理员。`, result: 'noop' }
    const [existing] = await this.ctx.database.get('qgh_admin', qq)
    if (existing) return { message: `${qq} 已是管理员，无需重复添加。`, result: 'noop' }
    await this.ctx.database.create('qgh_admin', {
      qq, addedBy: actor.source === 'console' ? `console:${actor.id}` : actor.qq, createdAt: new Date(),
    })
    return { message: `已添加管理员 ${qq}，权限立即生效。`, result: 'success' }
  }

  async remove(actor: Actor, qq: string): Promise<Outcome> {
    await this.requireAdmin(actor, true)
    if (!QQ_PATTERN.test(qq)) throw new BridgeError('qq', '请输入有效的数字 QQ 号。')
    if (this.superAdmins.has(qq)) throw new BridgeError('super-admin', '超级管理员只能通过插件后台配置修改，不能在管理员列表或 QQ 指令中撤销。')
    const [existing] = await this.ctx.database.get('qgh_admin', qq)
    if (!existing) return { message: `${qq} 当前不是管理员。`, result: 'noop' }
    await this.ctx.database.remove('qgh_admin', qq)
    return { message: `已撤销管理员 ${qq}。此前由其添加的其他管理员保持不变。`, result: 'success' }
  }

  async list(offset = 0, limit = 50) {
    return this.ctx.database.get('qgh_admin', {}, { sort: { createdAt: 'asc', qq: 'asc' }, offset, limit })
  }
}
