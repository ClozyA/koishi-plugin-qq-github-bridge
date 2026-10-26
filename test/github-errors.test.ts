import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, SECRET, SUPER } from './helpers'

type Harness = Awaited<ReturnType<typeof createHarness>>
describe('GitHub failures', () => {
  let env: Harness
  beforeEach(async () => { env = await createHarness() })
  afterEach(async () => { await env?.stop() })

  it.each([
    [401, 'Token 无效'], [403, '权限不足'], [404, '不存在'], [422, 'GitHub 拒绝请求'], [429, '限流'], [503, '服务端暂时异常'],
  ] as const)('handles HTTP %i without disclosing API error content', async (status, expected) => {
    env.api.intercept = (_request, res) => { res.statusCode = status; res.end(JSON.stringify({ message: SECRET, headers: { authorization: SECRET } })); return true }
    const result = await env.bridge.handle(env.message('re1003 test'))
    expect(result).toContain(expected)
    expect(result).not.toContain(SECRET)
    expect(result).not.toContain('已在')
    expect(env.api.requests).toHaveLength(1)
    expect(JSON.stringify(await env.app.database.get('qgh_audit', {}))).not.toContain(SECRET)
  })
  it('blocks subsequent requests after a primary rate limit until reset', async () => {
    env.api.intercept = (_request, res) => {
      res.statusCode = 403
      res.setHeader('x-ratelimit-remaining', '0')
      res.setHeader('x-ratelimit-reset', String(Math.floor(Date.now() / 1000) + 90))
      res.end(JSON.stringify({ message: 'API rate limit exceeded' })); return true
    }
    expect(await env.bridge.handle(env.message('re1003 first'))).toContain('限流')
    expect(await env.bridge.handle(env.message('re1003 second'))).toContain('限流中')
    expect(env.api.requests).toHaveLength(1)
  })
  it('never follows a redirect or sends credentials to a redirected URL', async () => {
    env.api.intercept = (_request, res) => { res.statusCode = 307; res.setHeader('location', env.api.base + '/other'); res.end('{}'); return true }
    expect(await env.bridge.handle(env.message('re1003 test'))).toContain('重定向')
    expect(env.api.requests).toHaveLength(1)
  })
  it.each(['disconnect', '500'] as const)('does not retry ambiguous comment writes after %s', async failure => {
    env.api.intercept = (request, res) => {
      if (request.method !== 'POST') return false
      if (failure === 'disconnect') res.destroy()
      else { res.statusCode = 500; res.end(JSON.stringify({ message: SECRET })) }
      return true
    }
    const message = env.message('re1003 uncertain')
    const result = await env.bridge.handle(message)
    expect(result).toMatch(/可能已成功|结果无法确认/)
    expect(await env.bridge.handle(message)).toBe('')
    expect(env.api.requests.filter(r => r.method === 'POST')).toHaveLength(1)
    expect((await env.app.database.get('qgh_audit', {}))[0].result).toBe('unknown')
  })
  it('treats an invalid state confirmation as uncertain rather than success', async () => {
    env.api.intercept = (request, res) => {
      if (request.method !== 'PATCH') return false
      res.end(JSON.stringify({ number: 1003, state: 'open' })); return true
    }
    expect(await env.bridge.handle(env.message('close1003', SUPER))).toContain('结果不确定')
    expect((await env.app.database.get('qgh_audit', {}))[0].result).toBe('unknown')
  })
  it('does not retry an invalid PR reopen transition', async () => {
    env.api.intercept = (request, res) => {
      if (request.method !== 'PATCH') return false
      res.statusCode = 422; res.end(JSON.stringify({ message: 'head ref deleted ' + SECRET })); return true
    }
    expect(await env.bridge.handle(env.message('open1006', SUPER))).toContain('不允许此状态转换')
    expect(env.api.requests.filter(r => r.method === 'PATCH')).toHaveLength(1)
  })
  it('accepts the official web link returned through a custom API base', async () => {
    env.api.intercept = (request, res) => {
      if (request.method !== 'POST') return false
      res.statusCode = 201; res.end(JSON.stringify({ id: 123, html_url: 'https://github.com/owner/repo/issues/1003#issuecomment-123' })); return true
    }
    expect(await env.bridge.handle(env.message('re1003 proxy'))).toContain('https://github.com/owner/repo/issues/1003#issuecomment-123')
  })
  it('never claims success when a comment response has no usable identity or link', async () => {
    env.api.intercept = (request, res) => {
      if (request.method !== 'POST') return false
      res.statusCode = 201; res.end(JSON.stringify({ id: 123, html_url: 'javascript:alert(1)' })); return true
    }
    const result = await env.bridge.handle(env.message('re1003 malformed success'))
    expect(result).toContain('无法确认评论结果')
    expect(result).not.toContain('已在')
    expect((await env.app.database.get('qgh_audit', {}))[0].result).toBe('unknown')
  })
  it('validates token identity and the selected bound repository without writes', async () => {
    const actor = env.message('', SUPER).actor
    const result = await env.bridge.validateToken(async () => ({ ...actor, source: 'console' }), '345678901')
    expect(result.login).toBe('bridge-account')
    expect(result.repositories[0].accessible).toBe(true)
    expect(result.message).toContain('不能证明写权限')
    expect(env.api.requests.every(r => r.method === 'GET')).toBe(true)
  })
})

describe('transport retry and disposal', () => {
  it('retries only safe reads with a finite retry budget', async () => {
    const env = await createHarness({ readRetries: 2 })
    try {
      let reads = 0
      env.api.intercept = (request, res) => {
        if (request.method === 'GET' && ++reads < 3) { res.statusCode = 503; res.end('{}'); return true }
        return false
      }
      expect(await env.bridge.handle(env.message('re1003 after recovery'))).toContain('发布评论')
      expect(env.api.requests.filter(r => r.method === 'GET')).toHaveLength(3)
      expect(env.api.requests.filter(r => r.method === 'POST')).toHaveLength(1)
    } finally { await env.stop() }
  })
  it('times out a write once even when read retries are enabled', async () => {
    const env = await createHarness({ readRetries: 2, requestTimeout: 1000 })
    try {
      env.api.intercept = (request, _res) => request.method === 'POST'
      expect(await env.bridge.handle(env.message('re1003 timeout'))).toContain('可能已成功')
      expect(env.api.requests.filter(r => r.method === 'POST')).toHaveLength(1)
    } finally { await env.stop() }
  })
  it('aborts an active write and drops queued work when disposed', async () => {
    const env = await createHarness()
    try {
      let started!: () => void
      const start = new Promise<void>(resolve => { started = resolve })
      env.api.intercept = (request, _res) => { if (request.method === 'POST') { started(); return true } return false }
      const operation = env.bridge.handle(env.message('re1003 first'))
      const queued = env.bridge.handle(env.message('re1003 second'))
      await start
      await env.bridge.dispose()
      expect(await operation).toContain('可能已成功')
      expect(await queued).toContain('正在停用')
      expect(env.api.requests.filter(r => r.method === 'POST')).toHaveLength(1)
    } finally { await env.stop() }
  })
})
