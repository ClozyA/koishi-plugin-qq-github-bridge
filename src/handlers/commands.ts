import { randomBytes } from 'node:crypto'
import type { Context } from 'koishi'
import type { Config } from '../config'
import type { Actor, Command, Dashboard, IncomingMessage, MutatingCommand, Outcome } from '../types'
import { GitHub } from '../services/github'
import { Permissions } from '../services/permission'
import { RepositoryResolver } from '../services/repository'
import { Storage } from '../services/storage'
import { MessageParser } from '../utils/parser'
import { SerialQueue } from '../utils/lock'
import { BridgeError, publicError, redact } from '../utils/errors'

interface Confirmation { command: MutatingCommand; code: string; expires: number; actorId: string; groupId: string; repository: string }

export class Bridge {
  readonly repositories: RepositoryResolver
  private readonly parser: MessageParser
  private readonly permissions: Permissions
  private readonly storage: Storage
  private readonly github: GitHub
  // One bounded queue serializes permission changes and state writes in this instance.
  // It also prevents different bound groups racing against the same target.
  private readonly queue = new SerialQueue()
  private readonly confirmations = new Map<string, Confirmation>()

  constructor(private readonly ctx: Context, readonly config: Config) {
    this.repositories = new RepositoryResolver(config.bindings)
    this.parser = new MessageParser(config)
    this.permissions = new Permissions(ctx, config)
    this.storage = new Storage(ctx, config)
    this.github = new GitHub(ctx, config)
  }

  async dispose() {
    this.queue.close()
    this.github.dispose()
    this.confirmations.clear()
    await this.queue.drain()
  }

  private target(command: Command) {
    if ('number' in command) return String(command.number)
    if ('qq' in command) return command.qq
    return ''
  }

  private async authorize(actor: Actor, command: Command) {
    if (command.type.startsWith('admin-') && actor.source === 'qq' && !this.config.enableAdminCommands) {
      throw new BridgeError('admin-disabled', '部署者已关闭 QQ 管理员指令，请使用后台管理。')
    }
    if (command.type !== 'comment') await this.permissions.requireAdmin(actor, command.type === 'admin-remove')
  }

  private async audited(actor: Actor, command: Command, task: () => Promise<Outcome>): Promise<string> {
    const id = await this.storage.begin(actor, command.type, this.target(command))
    try {
      const outcome = await task()
      const saved = await this.storage.finish(id, outcome.result || 'success', 'completed')
      return outcome.message + (saved ? '' : '\n操作已完成，但审计结果更新失败；后台记录暂为 pending。')
    } catch (error) {
      const safe = publicError(error)
      await this.storage.finish(id, safe.uncertain ? 'unknown' : 'failed', safe.code)
      throw safe
    }
  }

  private async perform(message: IncomingMessage, command: MutatingCommand): Promise<Outcome> {
    await this.authorize(message.actor, command)
    if (command.type === 'comment') return this.github.comment(message.repository, command.number, message.actor, command.body, message.eventKey)
    if (command.type === 'close' || command.type === 'open') return this.github.state(message.repository, command.number, command.type === 'close' ? 'closed' : 'open')
    if (command.type === 'admin-add') return this.permissions.add(message.actor, command.qq)
    return this.permissions.remove(message.actor, command.qq)
  }

  private confirmKey(message: IncomingMessage) { return `${message.actor.qq}:${message.actor.groupId}` }

  private pruneConfirmations() {
    for (const [key, pending] of this.confirmations) if (pending.expires < Date.now()) this.confirmations.delete(key)
  }

  async handle(message: IncomingMessage): Promise<string | null> {
    const command = this.parser.parse(message.text)
    if (!command) return null
    try {
      const result = await this.queue.run(async () => {
        if (Date.now() - message.timestamp > this.config.dedupWindow) return ''
        if (!await this.storage.claim(message)) return ''
        if (command.type === 'invalid') return command.message
        this.pruneConfirmations()
        if (command.type === 'confirm') {
          const key = this.confirmKey(message)
          const pending = this.confirmations.get(key)
          if (!pending || pending.code !== command.code || pending.actorId !== message.actor.qq ||
            pending.groupId !== message.actor.groupId || pending.repository !== message.repository.fullName) {
            throw new BridgeError('confirmation', '确认码无效或已过期。请由原操作者在原群重新发起操作。')
          }
          // Consume before any asynchronous work; a failed / uncertain write cannot reuse it.
          this.confirmations.delete(key)
          return this.audited(message.actor, pending.command, () => this.perform(message, pending.command))
        }
        await this.storage.cooldown(message.actor.qq)
        return this.audited(message.actor, command, async () => {
          await this.authorize(message.actor, command)
          if (command.type === 'admin-list') {
            const admins = await this.permissions.list((command.page - 1) * 20, 21)
            const rows = admins.slice(0, 20).map(row => `${row.qq}（添加者：${row.addedBy}；${row.createdAt.toISOString()}）`)
            return { message: `超级管理员：${this.config.superAdmins.join('、')}\n普通管理员（第 ${command.page} 页）：\n${rows.join('\n') || '无'}${admins.length > 20 ? `\n下一页：${this.config.adminPrefix} list ${command.page + 1}` : ''}` }
          }
          if (command.type !== 'comment' && this.config.confirmHighRisk) {
            if (this.confirmations.size >= 1000) throw new BridgeError('busy', '待确认操作过多，请稍后再试。')
            const code = randomBytes(6).toString('hex')
            this.confirmations.set(this.confirmKey(message), {
              command, code, expires: Date.now() + this.config.confirmationTimeout,
              actorId: message.actor.qq, groupId: message.actor.groupId, repository: message.repository.fullName,
            })
            const action = { close: '关闭', open: '重新打开', 'admin-add': '添加管理员', 'admin-remove': '撤销管理员' }[command.type]
            return {
              message: `待确认：${action} ${this.target(command)}${'number' in command ? `（${message.repository.fullName}）` : ''}。\n请在 ${this.config.confirmationTimeout / 1000} 秒内由 QQ ${message.actor.qq} 在本群发送：\n${this.config.adminPrefix} confirm ${code}`,
              result: 'noop',
            }
          }
          return this.perform(message, command)
        })
      })
      return redact(result, this.config.token)
    } catch (error) {
      const safe = publicError(error)
      // Do not give HTTP errors (including headers) to Koishi's logger.
      this.ctx.logger('qq-github-bridge').warn('操作未完成，错误类别：%s', safe.code)
      return redact(safe.message, this.config.token)
    }
  }

  async dashboard(authenticate: () => Promise<Actor>, page: number): Promise<Dashboard> {
    return this.queue.run(async () => {
      await authenticate()
      const rows = await this.permissions.list((page - 1) * 50, 51)
      const audits = await this.ctx.database.get('qgh_audit', {}, { sort: { createdAt: 'desc', id: 'desc' }, limit: 100 })
      return {
        admins: rows.slice(0, 50).map(row => ({ ...row, createdAt: row.createdAt.toISOString() })),
        hasMoreAdmins: rows.length > 50,
        superAdmins: [...this.config.superAdmins],
        bindings: this.config.bindings.map(b => ({ groupId: b.groupId, repository: `${b.owner}/${b.repo}`, enabled: b.enabled })),
        audits: audits.map(row => ({ ...row, createdAt: row.createdAt.toISOString() })),
        auditEnabled: this.config.auditEnabled, auditRetentionDays: this.config.auditRetentionDays,
      }
    })
  }

  async manage(authenticate: () => Promise<Actor>, action: 'add' | 'remove', qq: string) {
    return this.queue.run(async () => {
      const actor = await authenticate()
      const command: Command = { type: action === 'add' ? 'admin-add' : 'admin-remove', qq }
      return this.audited(actor, command, () => action === 'add' ? this.permissions.add(actor, qq) : this.permissions.remove(actor, qq))
    })
  }

  async validateToken(authenticate: () => Promise<Actor>, groupId?: string) {
    return this.queue.run(async () => {
      await authenticate()
      const repository = groupId ? this.repositories.resolve(groupId) : undefined
      if (groupId && !repository) throw new BridgeError('binding', '所选群没有启用的仓库绑定。')
      return this.github.validate(repository)
    })
  }

  async cleanup() {
    try {
      await this.queue.run(async () => {
        this.pruneConfirmations()
        await this.storage.cleanup()
      })
    } catch {
      this.ctx.logger('qq-github-bridge').warn('过期记录清理未完成，将在下一周期重试。')
    }
  }
}
