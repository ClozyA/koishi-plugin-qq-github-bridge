import { resolve } from 'node:path'
import type { Context } from 'koishi'
import type { Client } from '@koishijs/plugin-console'
import type {} from '@koishijs/plugin-auth'
import { QQ_PATTERN } from './config'
import type { Actor } from './types'
import type {} from './rpc'
import type { Bridge } from './handlers/commands'
import { BridgeError, publicError, redact } from './utils/errors'

/** Web deployer access is separate from the QQ administrator model. No QQ authority is used. */
export async function authenticateConsole(ctx: Context, client: Client): Promise<Actor> {
  if (!ctx.get('auth')) throw new BridgeError('console-auth', '控制台登录服务未启用，管理接口已停用。')
  const auth = client.auth
  if (!auth || auth.expiredAt <= Date.now()) throw new BridgeError('console-auth', '请先以部署管理员账号登录控制台。')
  const [token] = await ctx.database.get('token', { id: auth.id, token: auth.token, expiredAt: { $gt: Date.now() } }, ['id'])
  const [user] = await ctx.database.get('user', { id: auth.id }, ['id', 'authority'])
  if (!token || !user || user.authority < 5) throw new BridgeError('console-auth', '只有已登录的控制台部署管理员（等级 5）可以维护此插件。')
  const [binding] = await ctx.database.get('binding', { aid: user.id, platform: 'onebot' }, { limit: 1 })
  return {
    source: 'console', id: String(user.id), qq: binding && QQ_PATTERN.test(binding.pid) ? binding.pid : '',
    nickname: '', groupId: '', repository: '',
  }
}

export function registerConsole(ctx: Context, bridge: Bridge) {
  // Without the official auth service, even the listeners do not exist.
  ctx.inject(['console', 'auth'], ctx => {
    ctx.console.addEntry({ dev: resolve(__dirname, '../client/index.ts'), prod: resolve(__dirname, '../dist') })
    const safe = async <T>(task: () => Promise<T>): Promise<T> => {
      try { return await task() } catch (error) {
        // Console logs thrown objects, so replace them rather than rethrowing raw errors.
        throw new Error(redact(publicError(error).message, bridge.config.token))
      }
    }
    ctx.console.addListener('qq-github-bridge/dashboard', function (page = 1) {
      return safe(async () => {
        if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new BridgeError('input', '页码无效。')
        return bridge.dashboard(() => authenticateConsole(ctx, this), page)
      })
    }, { authority: 5 })
    ctx.console.addListener('qq-github-bridge/admin', function (action, qq) {
      return safe(async () => {
        if (!['add', 'remove'].includes(action) || typeof qq !== 'string' || !QQ_PATTERN.test(qq)) throw new BridgeError('input', '管理员操作或 QQ 号无效。')
        return bridge.manage(() => authenticateConsole(ctx, this), action, qq)
      })
    }, { authority: 5 })
    ctx.console.addListener('qq-github-bridge/validate', function (groupId) {
      return safe(async () => {
        if (groupId !== undefined && (typeof groupId !== 'string' || !QQ_PATTERN.test(groupId))) throw new BridgeError('input', 'QQ群号无效。')
        return bridge.validateToken(() => authenticateConsole(ctx, this), groupId)
      })
    }, { authority: 5 })
    // Console 5.30 addListener() assigns into a dictionary and does NOT register
    // a disposal effect. Explicitly remove only this activation's own listeners.
    const listeners = ctx.console.listeners
    const owned = ['dashboard', 'admin', 'validate'].map(name => {
      const key = `qq-github-bridge/${name}`
      return [key, listeners[key]] as const
    })
    ctx.on('dispose', () => {
      for (const [key, listener] of owned) if (listeners[key] === listener) delete listeners[key]
    })
  })
}
