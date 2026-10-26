import { randomUUID } from 'node:crypto'
import type { Context } from 'koishi'
import type { Config } from '../config'
import type { Actor, IncomingMessage } from '../types'
import { BridgeError } from '../utils/errors'

export class Storage {
  constructor(private readonly ctx: Context, private readonly config: Config) {}

  async claim(message: IncomingMessage): Promise<boolean> {
    // The primary key is the atomic claim, including across reconnects / plugin reloads.
    const [existing] = await this.ctx.database.get('qgh_event', message.eventKey)
    if (existing) return false
    try {
      await this.ctx.database.create('qgh_event', {
        id: message.eventKey,
        // Allow clock skew and avoid cleanup racing a still-valid incoming event.
        expiresAt: new Date(Math.max(Date.now(), message.timestamp) + this.config.dedupWindow + 60000),
      })
      return true
    } catch {
      const [winner] = await this.ctx.database.get('qgh_event', message.eventKey)
      if (winner) return false
      throw new BridgeError('database', '数据库去重记录写入失败，未执行操作。')
    }
  }

  async cooldown(qq: string) {
    if (!this.config.userCooldown) return
    const [existing] = await this.ctx.database.get('qgh_cooldown', qq)
    const now = Date.now()
    if (existing && +existing.expiresAt > now) {
      throw new BridgeError('cooldown', `操作过于频繁，请在 ${Math.ceil((+existing.expiresAt - now) / 1000)} 秒后重试。`)
    }
    await this.ctx.database.upsert('qgh_cooldown', [{ qq, expiresAt: new Date(now + this.config.userCooldown) }])
  }

  async begin(actor: Actor, action: string, target: string): Promise<string | undefined> {
    if (!this.config.auditEnabled) return
    const id = randomUUID()
    await this.ctx.database.create('qgh_audit', {
      id, actorId: actor.id, actorQQ: actor.qq, source: actor.source, action, target,
      groupId: actor.groupId, repository: actor.repository, createdAt: new Date(),
      result: 'pending', detail: '',
    })
    return id
  }

  async finish(id: string | undefined, result: string, detail: string): Promise<boolean> {
    if (!id) return true
    try {
      // detail is an internal error code or constant, never exception text / API response data.
      await this.ctx.database.set('qgh_audit', id, { result, detail })
      return true
    } catch {
      this.ctx.logger('qq-github-bridge').warn('审计结果写入失败，原始记录保留为 pending；请核对操作结果。')
      return false
    }
  }

  async cleanup() {
    const now = Date.now()
    await this.ctx.database.remove('qgh_event', { expiresAt: { $lt: new Date(now) } })
    await this.ctx.database.remove('qgh_cooldown', { expiresAt: { $lt: new Date(now) } })
    await this.ctx.database.remove('qgh_audit', { createdAt: { $lt: new Date(now - this.config.auditRetentionDays * 86400000) } })
  }
}
