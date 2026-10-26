import { createServer, IncomingMessage as HttpRequest, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { Bot, Context, h, Universal, type Session } from 'koishi'
import { HTTP } from '@koishijs/plugin-http'
import Sqlite from '@koishijs/plugin-database-sqlite'
import { Config, validateConfig } from '../src/config'
import { registerModels } from '../src/database/models'
import { Bridge } from '../src/handlers/commands'
import type { IncomingMessage } from '../src/types'

export const SECRET = 'github_pat_TEST_ONLY_NOT_A_REAL_SECRET_123456789'
export const SUPER = '123456789'
export const USER = '234567890'
export const GROUP = '345678901'
export const BOT = '987654321'

export function configuration(overrides: Partial<Config> = {}): Config {
  return validateConfig(Config({
    token: SECRET, superAdmins: [SUPER],
    bindings: [
      { groupId: GROUP, owner: 'owner', repo: 'repo', enabled: true },
      { groupId: '456789012', owner: 'other', repo: 'project', enabled: true },
      { groupId: '567890123', owner: 'owner', repo: 'repo', enabled: true },
      { groupId: '678901234', owner: 'disabled', repo: 'repo', enabled: false },
    ],
    userCooldown: 0, confirmHighRisk: false, readRetries: 0,
    ...overrides,
  }))
}

export interface RequestRecord { method: string; path: string; body?: Record<string, unknown>; headers: HttpRequest['headers'] }
export type Responder = (request: RequestRecord, response: ServerResponse) => boolean | Promise<boolean>

export class MockGitHub {
  readonly requests: RequestRecord[] = []
  readonly server = createServer((req, res) => { void this.respond(req, res) })
  base = ''
  intercept?: Responder
  private readonly states = new Map<string, string>()

  async start() {
    await new Promise<void>(resolve => this.server.listen(0, '127.0.0.1', resolve))
    const address = this.server.address()
    this.base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  }

  async stop() {
    this.server.closeAllConnections()
    await new Promise<void>(resolve => this.server.close(() => resolve()))
  }

  private async respond(req: HttpRequest, res: ServerResponse) {
    let body = ''
    for await (const chunk of req) body += chunk
    const record: RequestRecord = { method: req.method || 'GET', path: req.url || '/', headers: req.headers, body: body ? JSON.parse(body) : undefined }
    this.requests.push(record)
    res.setHeader('content-type', 'application/json')
    if (await this.intercept?.(record, res)) return
    if (record.path === '/user') { res.end(JSON.stringify({ login: 'bridge-account' })); return }
    const repoOnly = /^\/repos\/([^/]+\/[^/]+)$/.exec(record.path)
    if (repoOnly) { res.end(JSON.stringify({ full_name: repoOnly[1] })); return }
    const match = /^\/repos\/([^/]+\/[^/]+)\/(issues|pulls)\/(\d+)(\/comments)?$/.exec(record.path)
    const number = Number(match?.[3])
    if (!match || number === 404) { res.statusCode = 404; res.end(JSON.stringify({ message: 'not found' })); return }
    const key = `${match[1]}/${number}`
    if (match[4] && record.method === 'POST') {
      res.statusCode = 201
      res.end(JSON.stringify({ id: this.requests.length, html_url: `${this.base}/${match[1]}/issues/${number}#issuecomment-${this.requests.length}` }))
      return
    }
    const isPR = [1004, 1006, 1007].includes(number)
    if (record.method === 'PATCH') this.states.set(key, String(record.body?.state))
    res.end(JSON.stringify({
      number, state: this.states.get(key) || ([1005, 1006, 1007].includes(number) ? 'closed' : 'open'),
      html_url: `${this.base}/${match[1]}/issues/${number}`,
      ...(isPR ? { pull_request: {}, merged: number === 1007 } : {}),
    }))
  }
}

export async function createHarness(overrides: Partial<Config> = {}, path = ':memory:') {
  const api = new MockGitHub()
  await api.start()
  const app = new Context()
  app.plugin(HTTP)
  app.plugin(Sqlite, { path })
  registerModels(app)
  await app.start()
  const config = configuration({ apiBaseUrl: api.base, ...overrides })
  const bridge = new Bridge(app, config)
  const message = (text: string, qq = USER, groupId = GROUP, eventKey = randomUUID().replace(/-/g, '')): IncomingMessage => {
    const repository = bridge.repositories.resolve(groupId)!
    return { text, repository, eventKey, timestamp: Date.now(), actor: {
      source: 'qq', id: qq, qq, nickname: '测试用户', groupId, repository: repository?.fullName,
    } }
  }
  return { app, bridge, config, api, message, async stop() { await bridge.dispose(); await app.stop(); await api.stop() } }
}

export class FixtureBot extends Bot<Context> {
  readonly replies: string[] = []
  constructor(ctx: Context) {
    super(ctx, {}, 'onebot')
    this.user = { id: BOT, name: 'Fixture Bot' }
    this.internal = {}
  }
  async start() { this.online() }
  async sendMessage(_channel: string, fragment: h.Fragment) {
    this.replies.push(h.normalize(fragment).map(element => element.type === 'text' ? element.attrs.content : String(element)).join(''))
    return ['fixture-reply']
  }

  makeSession(text: string, overrides: Record<string, unknown> = {}): Session {
    const raw = {
      post_type: 'message', message_type: 'group', sub_type: 'normal', anonymous: null,
      message_id: String(Math.floor(Math.random() * 100000000)), time: Math.floor(Date.now() / 1000),
      self_id: Number(BOT), user_id: Number(USER), group_id: Number(GROUP),
      sender: { user_id: Number(USER), nickname: '测试昵称', card: '群昵称' },
      ...overrides,
    }
    const session = this.session({
      type: 'message', timestamp: raw.time * 1000,
      user: { id: String(raw.user_id), name: '测试昵称' },
      guild: { id: String(raw.group_id) }, channel: { id: String(raw.group_id), type: Universal.Channel.Type.TEXT },
      message: { id: String(raw.message_id), elements: [h.text(text)], content: h.text(text).toString() },
    })
    session.setInternal('onebot', raw)
    return session
  }
}
