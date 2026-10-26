import { setTimeout as delay } from 'node:timers/promises'
import type { Context } from 'koishi'
import type { Config } from '../config'
import type { Actor, Outcome, Repository, TokenStatus } from '../types'
import { BridgeError, redact } from '../utils/errors'

interface Issue { number: number; state: 'open' | 'closed'; html_url: string; pull_request?: unknown }
interface Pull extends Issue { merged: boolean }

function metadata(value: string): string {
  return value.slice(0,80).replace(/[\r\n\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/[&<>"'`*_\[\]{}()|@#!\\]/g, character => `&#${character.codePointAt(0)};`)
}

export class GitHub {
  private readonly abort = new AbortController()
  private readonly base: string
  private blockedUntil = 0
  private lastMutation = 0

  constructor(private readonly ctx: Context, private readonly config: Config) {
    this.base = config.apiBaseUrl.replace(/\/+$/, '')
  }

  dispose() { this.abort.abort() }

  private async sleep(ms: number) {
    try { await delay(ms, undefined, { signal: this.abort.signal }) } catch {
      throw new BridgeError('disposed', '插件正在停用，请稍后再试。')
    }
  }

  private async request<T>(method: 'GET' | 'POST' | 'PATCH', path: string, data?: object): Promise<T> {
    if (this.abort.signal.aborted) throw new BridgeError('disposed', '插件正在停用，请稍后再试。')
    if (this.blockedUntil > Date.now()) throw new BridgeError('rate-limit', `GitHub 限流中，请在约 ${Math.ceil((this.blockedUntil - Date.now()) / 1000)} 秒后再试。`)
    const writing = method !== 'GET'
    if (writing) {
      const wait = 1000 - (Date.now() - this.lastMutation)
      if (wait > 0) await this.sleep(wait)
      this.lastMutation = Date.now()
    }
    for (let attempt = 0; ; attempt++) {
      let response: { status: number; data: unknown; headers: Headers }
      try {
        response = await this.ctx.http(this.base + path, {
          method, data,
          headers: {
            Authorization: `Bearer ${this.config.token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': this.config.apiVersion,
            'User-Agent': 'koishi-plugin-qq-github-bridge/1.0.0',
          },
          timeout: this.config.requestTimeout,
          signal: this.abort.signal,
          // Never send credentials or execute writes at a redirected/unbound repository.
          redirect: 'manual',
          validateStatus: () => true,
        })
      } catch {
        if (!writing && attempt < this.config.readRetries && !this.abort.signal.aborted) {
          await this.sleep(300 * 2 ** attempt)
          continue
        }
        throw new BridgeError(writing ? 'write-unknown' : 'network', writing
          ? 'GitHub 写入请求未得到确认（网络超时、连接失败或插件停用）。操作可能已成功；请先到 GitHub 核对，不要直接重发。'
          : '无法连接 GitHub（超时、DNS 或连接故障），请稍后重试或联系部署者。', writing)
      }
      if (response.status >= 200 && response.status < 300) return response.data as T
      const status = response.status
      const getHeader = (name: string) => response.headers?.get?.(name)
      const serverMessage = (response.data as { message?: unknown } | null)?.message
      const rateLimited = status === 429 || (status === 403 && (getHeader('x-ratelimit-remaining') === '0' ||
        !!getHeader('retry-after') || (typeof serverMessage === 'string' && /rate limit|abuse/i.test(serverMessage))))
      if (rateLimited) {
        const retryHeader = getHeader('retry-after')
        const seconds = Number(retryHeader)
        const retryAt = retryHeader && !Number.isFinite(seconds) ? Date.parse(retryHeader) : Date.now() + seconds * 1000
        const resetAt = getHeader('x-ratelimit-remaining') === '0' ? Number(getHeader('x-ratelimit-reset')) * 1000 : 0
        this.blockedUntil = Math.max(Date.now() + 60000, Number.isFinite(retryAt) ? retryAt : 0, Number.isFinite(resetAt) ? resetAt : 0)
        throw new BridgeError('rate-limit', 'GitHub 请求限流，已暂停后续请求，请稍后再试。')
      }
      if (status >= 500) {
        if (!writing && attempt < this.config.readRetries) {
          await this.sleep(300 * 2 ** attempt)
          continue
        }
        throw new BridgeError(writing ? 'write-unknown' : 'github-server', writing
          ? 'GitHub 服务端异常，写入结果无法确认。请先到 GitHub 核对，插件不会自动重试。'
          : 'GitHub 服务端暂时异常，有限重试后仍未恢复。', writing)
      }
      const errors: Record<number, [string, string]> = {
        401: ['token-invalid', 'GitHub Token 无效或已过期，请部署者在后台更新。'],
        403: ['github-forbidden', 'GitHub 拒绝访问：Token 权限不足、仓库或组织访问受限；请部署者检查权限和组织审批。'],
        404: ['not-found', 'GitHub 仓库或目标不存在，或当前 Token 无权访问。'],
        410: ['gone', '目标功能或资源已不可用（例如仓库关闭了 Issues）。'],
        422: ['validation', 'GitHub 拒绝请求：数据不合法、触发反滥用限制，或当前目标不允许此状态转换。请在 GitHub 核对目标状态和 PR 源分支。'],
      }
      if (status >= 300 && status < 400) throw new BridgeError('redirect', 'GitHub 返回重定向；为保持群绑定边界已停止请求，请部署者更新仓库绑定或 API 地址。')
      const [code, message] = errors[status] || ['github-error', `GitHub 请求失败（HTTP ${status}）。请部署者检查配置。`]
      throw new BridgeError(code, message)
    }
  }

  private path(repo: Repository): string {
    return `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`
  }

  private link(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length > 2000 || value.includes(this.config.token)) return
    try {
      const url = new URL(value)
      // html_url is returned by the trusted API, never used as a request target.
      // Proxies / Enterprise Cloud can have a different API and web hostname.
      if (url.username || url.password || url.search || decodeURIComponent(value).includes(this.config.token)) return
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) return
      return url.href
    } catch { return }
  }

  private async target(repo: Repository, number: number): Promise<Issue> {
    const issue = await this.request<Issue>('GET', `${this.path(repo)}/issues/${number}`)
    if (!issue || issue.number !== number || !['open', 'closed'].includes(issue.state)) {
      throw new BridgeError('github-response', 'GitHub 返回了不符合预期的目标数据，已停止操作。')
    }
    return issue
  }

  formatComment(actor: Actor, body: string, eventKey: string): string {
    if (body.includes(this.config.token)) throw new BridgeError('secret-in-body', '评论包含部署 Token，已拒绝发送。请移除敏感信息。')
    const nickname = metadata(redact(actor.nickname, this.config.token))
    const header = `<sub>QQ Bridge 已验证发送者 · 昵称：「${nickname}」 · QQ：${actor.qq} · QQ群：${actor.groupId}</sub>`
    const comment = `${header}\n\n---\n\n${this.config.commentTemplate.replace('{body}', () => body)}\n\n<!-- qq-github-bridge:${eventKey} -->`
    // GitHub imposes its own limit; also bound bytes to safely accommodate Unicode text.
    if (comment.length > 65000 || Buffer.byteLength(comment, 'utf8') > 65000) {
      throw new BridgeError('comment-too-large', '渲染后的评论过长，请缩短正文或评论模板。')
    }
    return comment
  }

  async comment(repo: Repository, number: number, actor: Actor, body: string, eventKey: string): Promise<Outcome> {
    const comment = this.formatComment(actor, body, eventKey)
    const issue = await this.target(repo, number)
    const result = await this.request<{ id?: number; html_url?: unknown }>('POST', `${this.path(repo)}/issues/${number}/comments`, { body: comment })
    const link = this.link(result?.html_url)
    if (!link || !Number.isSafeInteger(result?.id) || result.id! <= 0) {
      throw new BridgeError('write-unknown', 'GitHub 返回了成功状态，但评论标识或链接不完整，无法确认评论结果。请先到 GitHub 核对，不要直接重发。', true)
    }
    return {
      message: `已在 ${repo.fullName} ${issue.pull_request ? 'PR' : 'Issue'} #${number} 发布评论。\n${link}`,
      result: 'success',
    }
  }

  async state(repo: Repository, number: number, desired: 'open' | 'closed'): Promise<Outcome> {
    let target: Issue | Pull = await this.target(repo, number)
    const isPR = !!target.pull_request
    if (isPR) {
      target = await this.request<Pull>('GET', `${this.path(repo)}/pulls/${number}`)
      if (!target || target.number !== number || !['open', 'closed'].includes(target.state) || typeof (target as Pull).merged !== 'boolean') {
        throw new BridgeError('github-response', 'GitHub 返回了不符合预期的 PR 状态，已停止操作。')
      }
      if (desired === 'open' && (target as Pull).merged) throw new BridgeError('pr-merged', '该 PR 已合并，不能重新打开。')
    }
    const label = `${repo.fullName} ${isPR ? 'PR' : 'Issue'} #${number}`
    if (target.state === desired) return { message: `${label} 当前已经${desired === 'open' ? '打开' : '关闭'}，无需重复操作。`, result: 'noop' }
    const updated = await this.request<Issue>('PATCH', `${this.path(repo)}/${isPR ? 'pulls' : 'issues'}/${number}`, { state: desired })
    if (updated?.number !== number || updated?.state !== desired) {
      throw new BridgeError('write-unknown', 'GitHub 未确认预期状态，操作结果不确定；请到 GitHub 核对。', true)
    }
    return { message: `已${desired === 'open' ? '重新打开' : '关闭'} ${label}。`, result: 'success' }
  }

  async validate(repo?: Repository): Promise<TokenStatus> {
    const user = await this.request<{ login: string }>('GET', '/user')
    if (!user || !/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(user.login)) throw new BridgeError('github-response', 'Token 验证响应无效，请检查 API 地址。')
    const repositories: TokenStatus['repositories'] = []
    if (repo) {
      try {
        const data = await this.request<{ full_name: string }>('GET', this.path(repo))
        if (data?.full_name?.toLowerCase() !== repo.fullName.toLowerCase()) throw new BridgeError('repo-mismatch', '仓库响应与群绑定不一致。')
        repositories.push({ repository: repo.fullName, accessible: true, message: '仓库可读取。' })
      } catch (error) {
        if (!(error instanceof BridgeError)) throw error
        repositories.push({ repository: repo.fullName, accessible: false, message: error.message })
      }
    }
    return { login: redact(user.login, this.config.token), repositories, message: 'Token 身份已验证。只读检测不能证明写权限；Issues 和 Pull requests 均需 Read and write。' }
  }
}
