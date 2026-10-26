import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from 'koishi'
import { Console, type Client, type Entry } from '@koishijs/plugin-console'
import Auth from '@koishijs/plugin-auth'
import { createHarness, SECRET, SUPER, USER } from './helpers'
import { registerConsole } from '../src/console'
import type { Dashboard } from '../src/types'

class HeadlessConsole extends Console {
  protected resolveEntry(_files: Entry.Files, _key: string) { return ['/fixture.js'] }
}
// Console's published legacy static inject shape is supported at runtime but
// differs from current Cordis declarations. Keep its real constructor contract.
const ConsolePlugin: new (ctx: Context) => HeadlessConsole = HeadlessConsole

type Harness = Awaited<ReturnType<typeof createHarness>>
describe('official console / auth service integration', () => {
  let env: Harness
  let client: Client
  let authFork: ReturnType<Context['plugin']>
  beforeEach(async () => {
    env = await createHarness()
    env.app.plugin(ConsolePlugin)
    env.app.plugin((ctx: Context) => registerConsole(ctx, env.bridge))
    await env.app.lifecycle.flush()
    expect(env.app.console.listeners['qq-github-bridge/admin']).toBeUndefined()
    authFork = env.app.plugin(Auth, { admin: { enabled: false } })
    await env.app.lifecycle.flush()
    const user = await env.app.database.createUser('onebot', SUPER, { authority: 5, name: 'deployer' })
    const token = 'test-console-session'
    const expiredAt = Date.now() + 3600000
    await env.app.database.create('token', { id: user.id, token, expiredAt, type: 'password', createdAt: new Date(), lastUsedAt: new Date() })
    client = { auth: { id: user.id, authority: 5, name: 'deployer', config: {}, token, expiredAt } } as Client
  })
  afterEach(async () => { await env?.stop() })

  function call(event: string, ...args: unknown[]) {
    const listener = env.app.console.listeners[event]
    return listener.callback.call(client, ...args)
  }

  it('requires server-side authority metadata on every RPC and exposes no secret', async () => {
    for (const name of ['dashboard', 'admin', 'validate']) expect(env.app.console.listeners[`qq-github-bridge/${name}`].authority).toBe(5)
    const dashboard = await call('qq-github-bridge/dashboard') as Dashboard
    expect(JSON.stringify(dashboard)).not.toContain(SECRET)
    expect(dashboard.superAdmins).toEqual([SUPER])
  })
  it('uses the exact same admin rows as QQ and audits the logged-in account', async () => {
    expect(await call('qq-github-bridge/admin', 'add', USER)).toContain('已添加')
    expect(await env.bridge.handle(env.message('close1003', USER))).toContain('已关闭')
    const dashboard = await call('qq-github-bridge/dashboard') as Dashboard
    expect(dashboard.admins[0].addedBy).toBe(`console:${client.auth!.id}`)
    expect(dashboard.audits.some(row => row.source === 'console' && row.actorQQ === SUPER)).toBe(true)
    expect(await call('qq-github-bridge/admin', 'remove', USER)).toContain('已撤销')
    expect(await env.bridge.handle(env.message('open1005', USER))).toContain('需要')
  })
  it('does not let an unauthenticated caller bypass auth by calling a hidden RPC', async () => {
    client.auth = undefined
    await expect(call('qq-github-bridge/admin', 'add', USER)).rejects.toThrow('登录')
    expect(await env.app.database.get('qgh_admin', USER)).toHaveLength(0)
  })
  it('denies an expired or revoked login session', async () => {
    await env.app.database.remove('token', { token: client.auth!.token })
    await expect(call('qq-github-bridge/dashboard')).rejects.toThrow('已登录')
    client.auth!.expiredAt = 1
    await expect(call('qq-github-bridge/dashboard')).rejects.toThrow('登录')
  })
  it('rechecks current console privilege even when the socket caches authority five', async () => {
    await env.app.database.set('user', client.auth!.id, { authority: 1 })
    await expect(call('qq-github-bridge/admin', 'add', USER)).rejects.toThrow('等级 5')
    expect(await env.app.database.get('qgh_admin', USER)).toHaveLength(0)
  })
  it.each([['remove', SUPER], ['merge', USER], ['add', '../../x'], ['add', '<at id=12345/>']])('rejects invalid backend mutation %s %s', async (action, target) => {
    await expect(call('qq-github-bridge/admin', action, target)).rejects.toThrow()
  })
  it('does not accept arbitrary URLs / repositories / tokens through validate RPC', async () => {
    await expect(call('qq-github-bridge/validate', 'https://evil.invalid')).rejects.toThrow('QQ群号')
    await expect(call('qq-github-bridge/validate', '999999999')).rejects.toThrow('没有启用')
    expect(env.api.requests).toHaveLength(0)
  })
  it('removes handlers when the auth service is disabled', async () => {
    await authFork!.dispose()
    await env.app.lifecycle.flush()
    expect(env.app.console.listeners['qq-github-bridge/admin']).toBeUndefined()
    expect(env.app.console.listeners['qq-github-bridge/dashboard']).toBeUndefined()
  })
})
