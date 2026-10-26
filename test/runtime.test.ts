import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context, h, Universal, type Session } from 'koishi'
import { HTTP } from '@koishijs/plugin-http'
import Sqlite from '@koishijs/plugin-database-sqlite'
import { OneBot } from '@koishijs/plugin-adapter-onebot'
import { OneBot as CommunityOneBot } from 'koishi-plugin-adapter-onebot'
import { FixtureBot, MockGitHub, configuration, BOT, GROUP, SECRET, SUPER, USER } from './helpers'
import { readMessage } from '../src/handlers/message'
import { RepositoryResolver } from '../src/services/repository'
import * as plugin from '../src'

describe('actual Koishi middleware and lifecycle with OneBot event fixtures', () => {
  let app: Context, bot: FixtureBot, api: MockGitHub
  let fork: ReturnType<Context['plugin']>
  beforeEach(async () => {
    app = new Context({ autoAuthorize: 0 })
    api = new MockGitHub(); await api.start()
    app.plugin(HTTP)
    app.plugin(Sqlite, { path: ':memory:' })
    app.plugin({ inject: ['satori'], apply: (ctx: Context) => { bot = new FixtureBot(ctx) } })
    fork = app.plugin(plugin, configuration({ apiBaseUrl: api.base }))
    await app.start()
  })
  afterEach(async () => { await app.stop(); await api.stop() })

  async function dispatch(session: Session) {
    const finished = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { dispose(); reject(new Error('middleware did not finish')) }, 4000)
      const dispose = app.on('middleware', result => { if (result.id === session.id) { clearTimeout(timer); dispose(); resolve() } })
    })
    bot.dispatch(session)
    await finished
  }

  it('runs a real incoming event through the plugin with authority zero', async () => {
    const session = bot.makeSession('re1003 **真实 Koishi 消息管线** <xml> &\n第二行')
    await dispatch(session)
    expect(bot.replies.at(-1)).toContain('发布评论')
    expect(api.requests.at(-1)?.body?.body).toContain('**真实 Koishi 消息管线** <xml> &\n第二行')
    expect(app.console).toBeUndefined()
  })
  it.each([
    ['official 6.0.2', OneBot],
    ['community 6.9.4', CommunityOneBot],
  ] as const)('accepts sessions decoded by the released %s OneBot adapter', async (_name, adapter) => {
    bot.config.advanced = { splitMixedContent: false }
    const raw = {
      post_type: 'message', message_type: 'group', sub_type: 'normal', time: Math.floor(Date.now() / 1000),
      self_id: Number(BOT), group_id: Number(GROUP), user_id: Number(USER), message_id: 123,
      message: [{ type: 'text', data: { text: 're1004 <hello> & 中文\nsecond' } }],
      raw_message: 're1004 <hello> & 中文\nsecond', sender: { user_id: Number(USER), nickname: '来自适配器' },
    }
    const session = await adapter.adaptSession(bot as never, raw as never) as unknown as Session
    session.setInternal('onebot', raw)
    await dispatch(session)
    expect(bot.replies.at(-1)).toContain('PR #1004')
    expect(api.requests.at(-1)?.body?.body).toContain('<hello> & 中文\nsecond')
  })
  it('unregisters middleware on disable and reloads without duplicate actions', async () => {
    await fork!.dispose()
    await dispatch(bot.makeSession('re1003 disabled'))
    expect(api.requests).toHaveLength(0)
    fork = app.plugin(plugin, configuration({ apiBaseUrl: api.base }))
    await app.lifecycle.flush()
    await dispatch(bot.makeSession('re1003 reenabled'))
    expect(api.requests.filter(r => r.method === 'POST')).toHaveLength(1)
  })
  it('applies a changed super-admin list and changed bindings on reload', async () => {
    await fork!.dispose()
    fork = app.plugin(plugin, configuration({ apiBaseUrl: api.base, superAdmins: [USER], bindings: [{ groupId: GROUP, owner: 'new', repo: 'target', enabled: true }] }))
    await app.lifecycle.flush()
    await dispatch(bot.makeSession('close1003'))
    expect(bot.replies.at(-1)).toContain('已关闭 new/target')
    const oldAdmin = bot.makeSession('close1003', { user_id: Number(SUPER), sender: { user_id: Number(SUPER), nickname: '旧超级管理员' } })
    await dispatch(oldAdmin)
    expect(bot.replies.at(-1)).toContain('需要')
  })
  it.each([
    ['unbound group', (s: Session) => { s.guildId = s.channelId = '999999999'; (s as any).onebot.group_id = 999999999 }],
    ['disabled group', (s: Session) => { s.guildId = s.channelId = '678901234'; (s as any).onebot.group_id = 678901234 }],
    ['non-OneBot', (s: Session) => { Object.defineProperty(s, 'platform', { value: 'discord' }) }],
    ['private message', (s: Session) => { s.isDirect = true; (s as any).onebot.message_type = 'private' }],
    ['anonymous', (s: Session) => { (s as any).onebot.anonymous = { id: 1 } }],
    ['missing raw payload fields', (s: Session) => { delete (s as any).onebot.post_type }],
    ['user identity mismatch', (s: Session) => { (s as any).onebot.user_id = Number(SUPER) }],
    ['sender identity mismatch', (s: Session) => { (s as any).onebot.sender.user_id = Number(SUPER) }],
    ['group identity mismatch', (s: Session) => { (s as any).onebot.group_id = 888888888 }],
    ['message ID missing', (s: Session) => { delete (s as any).onebot.message_id }],
    ['stale replay', (s: Session) => { (s as any).onebot.time = 1 }],
    ['future timestamp', (s: Session) => { (s as any).onebot.time += 3600 }],
    ['message sent event', (s: Session) => { (s as any).onebot.post_type = 'message_sent' }],
    ['image', (s: Session) => { s.elements!.push(h.image('https://example.com/a.png')) }],
    ['at everyone', (s: Session) => { s.elements!.push(h.at('all')) }],
    ['forwarded identity text', (s: Session) => { s.elements = [h('forward', {}, [h.text('re1003 hi')])] }],
    ['quote', (s: Session) => { s.event.message!.quote = { id: 'old' } }],
  ] as const)('ignores %s before GitHub access', async (_name, alter) => {
    const session = bot.makeSession('re1003 test')
    alter(session)
    await dispatch(session)
    expect(api.requests).toHaveLength(0)
    expect(bot.replies).toHaveLength(0)
  })
  it('ignores its own identity and other locally connected OneBot bots', () => {
    const resolver = new RepositoryResolver(configuration().bindings)
    const self = bot.makeSession('re1003 self', { user_id: Number(BOT), sender: { user_id: Number(BOT) } })
    expect(readMessage(self, resolver, 86400000)).toBeNull()
    const second = { platform: 'onebot', selfId: USER }
    app.bots.push(second as never)
    expect(readMessage(bot.makeSession('re1003 second bot'), resolver, 86400000)).toBeNull()
    app.bots.pop()
  })
  it('passes ordinary messages downstream and claims duplicate event IDs once', async () => {
    let downstream = 0
    app.middleware(() => { downstream++ })
    await dispatch(bot.makeSession('普通聊天'))
    expect(downstream).toBe(1)
    const session = bot.makeSession('re1003 hi')
    await dispatch(session)
    await dispatch(bot.makeSession('re1003 hi', { message_id: session.messageId, time: (session as any).onebot.time }))
    expect(api.requests.filter(r => r.method === 'POST')).toHaveLength(1)
    expect(bot.replies).toHaveLength(1)
  })
})
