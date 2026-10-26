import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { createHarness, GROUP, SECRET, SUPER, USER } from './helpers'
import { Bridge } from '../src/handlers/commands'

type Harness = Awaited<ReturnType<typeof createHarness>>
describe('bridge with real Koishi database and HTTP service + mock GitHub', () => {
  let env: Harness
  beforeEach(async () => { env = await createHarness() })
  afterEach(async () => { vi.restoreAllMocks(); await env.stop() })

  it.each([1003, 1004])('comments on Issue / PR #%i through issue-comments', async number => {
    const text = '**已经修复**\n```ts\nconst x = "<tag>"\n```  '
    const result = await env.bridge.handle(env.message(`re${number} ${text}`))
    expect(result).toContain('发布评论')
    expect(result).toContain('#issuecomment-')
    const [read, write] = env.api.requests
    expect(read.method).toBe('GET')
    expect(write.method).toBe('POST')
    expect(write.path).toBe(`/repos/owner/repo/issues/${number}/comments`)
    expect(write.body?.body).toContain(text)
    expect(write.body?.body).toContain(`QQ：${USER}`)
    expect(write.headers.authorization).toBe(`Bearer ${SECRET}`)
  })
  it('routes multiple groups and shared-repository groups from configuration', async () => {
    for (const group of [GROUP, '456789012', '567890123']) await env.bridge.handle(env.message('re1003 test', USER, group))
    expect(env.api.requests.filter(r => r.method === 'POST').map(r => r.path)).toEqual([
      '/repos/owner/repo/issues/1003/comments', '/repos/other/project/issues/1003/comments', '/repos/owner/repo/issues/1003/comments',
    ])
  })
  it('does not modify body or interpret a repository URL as routing', async () => {
    await env.bridge.handle(env.message('re1003 https://github.com/evil/repo/issues/12\n$& $` $\'  '))
    const write = env.api.requests.at(-1)!
    expect(write.path).toContain('/owner/repo/')
    expect(write.body?.body).toContain('https://github.com/evil/repo/issues/12\n$& $` $\'  ')
  })
  it('escapes nickname injection and retains the verified QQ header', async () => {
    const message = env.message('re1003 normal body')
    message.actor.nickname = '假名</sub>\n**超级管理员** @victim\u202e'
    await env.bridge.handle(message)
    const body = String(env.api.requests.at(-1)!.body?.body)
    expect(body).not.toContain('假名</sub>')
    expect(body).not.toContain('@victim')
    expect(body).not.toContain('\u202e')
    expect(body).toContain(`QQ：${USER}`)
  })
  it.each(['close1003', 'open1005', 'ghadmin add 876543210', 'ghadmin remove 876543210', 'ghadmin list'])('denies ordinary user command %s', async text => {
    expect(await env.bridge.handle(env.message(text))).toMatch(/需要.*管理员|只有超级管理员/)
    expect(env.api.requests).toHaveLength(0)
  })
  it('supports recursive grants, duplicate detection and super-only revocation', async () => {
    expect(await env.bridge.handle(env.message(`ghadmin add ${USER}`, SUPER))).toContain('已添加')
    expect(await env.bridge.handle(env.message('ghadmin add 876543210', USER))).toContain('已添加')
    expect(await env.bridge.handle(env.message('ghadmin add 765432109', '876543210'))).toContain('已添加')
    expect(await env.bridge.handle(env.message(`ghadmin add ${USER}`, SUPER))).toContain('已是管理员')
    expect(await env.bridge.handle(env.message('ghadmin remove 876543210', USER))).toContain('只有超级管理员')
    expect(await env.bridge.handle(env.message(`ghadmin remove ${SUPER}`, SUPER))).toContain('只能通过插件后台')
    expect(await env.bridge.handle(env.message(`ghadmin remove ${USER}`, SUPER))).toContain('已撤销')
    expect(await env.bridge.handle(env.message('close1003', USER))).toContain('需要')
    expect(await env.bridge.handle(env.message('close1003', '765432109'))).toContain('已关闭')
    expect(await env.app.database.get('qgh_admin', USER)).toHaveLength(0)
  })
  it('serializes concurrent grants without duplicate rows or false success', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => env.bridge.handle(env.message(`ghadmin add ${USER}`, SUPER))))
    expect(results.filter(r => r?.includes('已添加'))).toHaveLength(1)
    expect(await env.app.database.get('qgh_admin', USER)).toHaveLength(1)
  })
  it.each([
    ['close1003', '/repos/owner/repo/issues/1003', 'closed'],
    ['open1005', '/repos/owner/repo/issues/1005', 'open'],
    ['close1004', '/repos/owner/repo/pulls/1004', 'closed'],
    ['open1006', '/repos/owner/repo/pulls/1006', 'open'],
  ])('uses the proper endpoint for %s', async (command, path, state) => {
    expect(await env.bridge.handle(env.message(command, SUPER))).toMatch(/已关闭|已重新打开/)
    expect(env.api.requests.at(-1)).toMatchObject({ method: 'PATCH', path, body: { state } })
  })
  it.each(['close1005', 'open1003', 'close1006', 'open1004'])('does not write an already requested state %s', async command => {
    expect(await env.bridge.handle(env.message(command, SUPER))).toContain('无需重复')
    expect(env.api.requests.every(r => r.method === 'GET')).toBe(true)
  })
  it('rejects reopening a merged PR without PATCH', async () => {
    expect(await env.bridge.handle(env.message('open1007', SUPER))).toContain('已合并')
    expect(env.api.requests.every(r => r.method === 'GET')).toBe(true)
  })
  it('serializes same target updates across multiple bound groups', async () => {
    const results = await Promise.all([env.bridge.handle(env.message('close1003', SUPER)), env.bridge.handle(env.message('close1003', SUPER, '567890123'))])
    expect(results.some(r => r?.includes('无需重复'))).toBe(true)
    expect(env.api.requests.filter(r => r.method === 'PATCH')).toHaveLength(1)
  })
  it('deduplicates concurrent delivery, including another controller on the same database', async () => {
    const message = env.message('re1003 hello')
    const other = new Bridge(env.app, env.config)
    const results = await Promise.all([env.bridge.handle(message), env.bridge.handle(message), other.handle(message)])
    await other.dispose()
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(env.api.requests.filter(r => r.method === 'POST')).toHaveLength(1)
  })
  it('rejects sensitive content before sending any GitHub request', async () => {
    expect(await env.bridge.handle(env.message(`re1003 ${SECRET}`))).not.toContain(SECRET)
    expect(env.api.requests).toHaveLength(0)
    expect(JSON.stringify(await env.app.database.get('qgh_audit', {}))).not.toContain(SECRET)
  })
  it('does not POST when the target does not exist or body is empty', async () => {
    expect(await env.bridge.handle(env.message('re404 hi'))).toContain('不存在')
    expect(await env.bridge.handle(env.message('re1003 '))).toContain('不能为空')
    expect(env.api.requests.filter(r => r.method === 'POST')).toHaveLength(0)
  })
  it('fails closed when deduplication database writes fail', async () => {
    const original = env.app.database.create.bind(env.app.database)
    vi.spyOn(env.app.database, 'create').mockImplementation((async (table: string, data: unknown) => {
      if (table === 'qgh_event') throw new Error(SECRET)
      return original(table as never, data as never)
    }) as typeof env.app.database.create)
    expect(await env.bridge.handle(env.message('re1003 no'))).toContain('去重记录写入失败')
    expect(env.api.requests).toHaveLength(0)
  })
  it('does not claim successful authorization on a database failure', async () => {
    const original = env.app.database.create.bind(env.app.database)
    vi.spyOn(env.app.database, 'create').mockImplementation((async (table: string, data: unknown) => {
      if (table === 'qgh_admin') throw new Error(SECRET)
      return original(table as never, data as never)
    }) as typeof env.app.database.create)
    const result = await env.bridge.handle(env.message(`ghadmin add ${USER}`, SUPER))
    expect(result).not.toContain('已添加')
    expect(result).not.toContain(SECRET)
    expect(await env.app.database.get('qgh_admin', USER)).toHaveLength(0)
  })
  it('keeps a pending audit and accurately reports a committed operation when audit finalization fails', async () => {
    const original = env.app.database.set.bind(env.app.database)
    vi.spyOn(env.app.database, 'set').mockImplementation((async (table: string, query: unknown, data: unknown) => {
      if (table === 'qgh_audit') throw new Error(SECRET)
      return original(table as never, query as never, data as never)
    }) as typeof env.app.database.set)
    expect(await env.bridge.handle(env.message('re1003 hi'))).toContain('操作已完成，但审计结果更新失败')
    expect((await env.app.database.get('qgh_audit', {}))[0].result).toBe('pending')
  })
  it('prunes old audit, cooldown, event records, retains active ones', async () => {
    await env.bridge.handle(env.message('re1003 kept'))
    await env.app.database.create('qgh_event', { id: 'old', expiresAt: new Date(0) })
    await env.app.database.create('qgh_audit', { id: 'old', createdAt: new Date(0), result: 'success' })
    await env.app.database.create('qgh_cooldown', { qq: USER, expiresAt: new Date(0) })
    await env.bridge.cleanup()
    expect(await env.app.database.get('qgh_event', 'old')).toHaveLength(0)
    expect(await env.app.database.get('qgh_audit', 'old')).toHaveLength(0)
    expect(await env.app.database.get('qgh_cooldown', USER)).toHaveLength(0)
    expect(await env.app.database.get('qgh_audit', {})).toHaveLength(1)
  })
})

describe('confirmation, rate limits and restart', () => {
  it('uses operator + group bound one-use confirmation and rechecks permission', async () => {
    const env = await createHarness({ confirmHighRisk: true })
    try {
      const request = await env.bridge.handle(env.message('close1003', SUPER))
      const code = request!.match(/confirm ([a-f0-9]{12})/)![1]
      expect(env.api.requests).toHaveLength(0)
      expect(await env.bridge.handle(env.message(`ghadmin confirm ${code}`, USER))).toContain('无效')
      expect(await env.bridge.handle(env.message(`ghadmin confirm ${code}`, SUPER, '456789012'))).toContain('无效')
      expect(await env.bridge.handle(env.message(`ghadmin confirm ${code}`, SUPER))).toContain('已关闭')
      expect(await env.bridge.handle(env.message(`ghadmin confirm ${code}`, SUPER))).toContain('无效')
      await env.app.database.create('qgh_admin', { qq: USER, addedBy: SUPER, createdAt: new Date() })
      const prompt = await env.bridge.handle(env.message('open1005', USER))
      await env.app.database.remove('qgh_admin', USER)
      expect(await env.bridge.handle(env.message(`ghadmin confirm ${prompt!.match(/confirm ([a-f0-9]{12})/)![1]}`, USER))).toContain('需要')
    } finally { await env.stop() }
  })
  it('expires confirmation and clears it on dispose', async () => {
    const env = await createHarness({ confirmHighRisk: true })
    try {
      const prompt = await env.bridge.handle(env.message('close1003', SUPER))
      const code = prompt!.match(/confirm ([a-f0-9]{12})/)![1]
      const now = Date.now()
      vi.spyOn(Date, 'now').mockReturnValue(now + 65000)
      expect(await env.bridge.handle(env.message(`ghadmin confirm ${code}`, SUPER))).toContain('无效或已过期')
      vi.restoreAllMocks()
      await env.bridge.dispose()
      const other = new Bridge(env.app, env.config)
      expect(await other.handle(env.message(`ghadmin confirm ${code}`, SUPER))).toContain('无效')
      await other.dispose()
    } finally { vi.restoreAllMocks(); await env.stop() }
  })
  it('rate-limits the same user across groups and reloads', async () => {
    const env = await createHarness({ userCooldown: 60000 })
    try {
      await env.bridge.handle(env.message('re1003 first'))
      expect(await env.bridge.handle(env.message('re1003 second', USER, '456789012'))).toContain('过于频繁')
      const other = new Bridge(env.app, env.config)
      expect(await other.handle(env.message('re1003 third'))).toContain('过于频繁')
      await other.dispose()
      expect(env.api.requests.filter(r => r.method === 'POST')).toHaveLength(1)
    } finally { await env.stop() }
  })
  it('disables QQ admin commands but preserves independently configured super admin state permissions', async () => {
    const env = await createHarness({ enableAdminCommands: false })
    try {
      expect(await env.bridge.handle(env.message(`ghadmin add ${USER}`, SUPER))).toContain('已关闭 QQ 管理员指令')
      expect(await env.bridge.handle(env.message('close1003', SUPER))).toContain('已关闭 owner/repo')
    } finally { await env.stop() }
  })
  it('persists admins and event claims through actual SQLite close / restart', async () => {
    const directory = await mkdtemp(resolve('.test-data-restart-'))
    const path = join(directory, 'bridge.db')
    let env = await createHarness({}, path)
    try {
      await env.bridge.handle(env.message(`ghadmin add ${USER}`, SUPER))
      const message = env.message('re1003 persistent')
      await env.bridge.handle(message)
      await env.stop()
      env = await createHarness({}, path)
      expect(await env.bridge.handle(message)).toBe('')
      expect(await env.bridge.handle(env.message('close1003', USER))).toContain('已关闭')
      expect((await env.app.database.get('qgh_admin', USER))[0].addedBy).toBe(SUPER)
      expect(env.api.requests.filter(r => r.method === 'POST')).toHaveLength(0)
    } finally {
      await env.stop()
      if (dirname(directory) !== resolve('.') || !basename(directory).startsWith('.test-data-restart-')) throw new Error('Unsafe test cleanup path')
      await rm(directory, { recursive: true, force: true })
    }
  })
})
