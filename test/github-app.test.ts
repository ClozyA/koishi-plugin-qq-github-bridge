import { generateKeyPairSync, verify } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { GitHub } from '../src/services/github'
import { configuration, createHarness, GROUP, SECRET } from './helpers'

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
const privateKey = keys.privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
const appConfig = { authMode: 'app' as const, token: '', appId: '123', installationId: '456', privateKey }
const repo = { owner: 'owner', repo: 'repo', fullName: 'owner/repo' }

describe('GitHub App authentication', () => {
  it('validates App configuration while preserving PAT defaults', () => {
    expect(configuration().authMode).toBe('pat')
    expect(configuration(appConfig).authMode).toBe('app')
    expect(configuration({ ...appConfig, privateKey: privateKey.replace(/\n/g, '\\n') }).authMode).toBe('app')
    expect(() => configuration({ ...appConfig, privateKey: 'invalid' })).toThrow('私钥')
    expect(() => configuration({ ...appConfig, installationId: '../other' })).toThrow('安装 ID')
  })

  it('signs a JWT, uses and refreshes an installation token, and validates without /user', async () => {
    const env = await createHarness(appConfig)
    let issued = 0
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    env.api.intercept = (request, res) => {
      if (request.path === '/app' || request.path === '/app/installations/456/access_tokens') {
        const jwt = request.headers.authorization!.slice(7)
        const [header, payload, signature] = jwt.split('.')
        expect(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), keys.publicKey, Buffer.from(signature, 'base64url'))).toBe(true)
        expect(JSON.parse(Buffer.from(payload, 'base64url').toString()).iss).toBe('123')
        if (request.path === '/app') res.end(JSON.stringify({ slug: 'auto-mas-bot' }))
        else res.end(JSON.stringify({ token: `installation-token-${++issued}`, expires_at: new Date(now + 3600000 * issued).toISOString() }))
        return true
      }
      return false
    }
    const github = new GitHub(env.app, env.config)
    try {
      const status = await github.validate(repo)
      expect(status.login).toBe('auto-mas-bot[bot]')
      expect(status.repositories[0].accessible).toBe(true)
      expect(env.api.requests.some(r => r.path === '/user')).toBe(false)
      await github.validate(repo)
      expect(issued).toBe(1)
      clock.mockReturnValue(now + 3541000)
      await github.validate(repo)
      expect(issued).toBe(2)
      expect(env.api.requests.filter(r => r.path === '/repos/owner/repo').map(r => r.headers.authorization)).toEqual([
        'Bearer installation-token-1', 'Bearer installation-token-1', 'Bearer installation-token-2',
      ])
    } finally { github.dispose(); clock.mockRestore(); await env.stop() }
  })

  it('fails safely when token issuance fails and never sends a repository write', async () => {
    const env = await createHarness(appConfig)
    env.api.intercept = (request, res) => {
      if (request.path.includes('/access_tokens')) { res.statusCode = 403; res.end(JSON.stringify({ message: SECRET })); return true }
      return false
    }
    try {
      const result = await env.bridge.handle(env.message('re1003 test', undefined, GROUP))
      expect(result).toContain('GitHub App 认证失败')
      expect(result).not.toContain(SECRET)
      expect(env.api.requests).toHaveLength(1)
    } finally { await env.stop() }
  })
})
