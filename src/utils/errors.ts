/** Only deliberately authored messages may cross the chat / console boundary. */
export class BridgeError extends Error {
  constructor(public readonly code: string, message: string, public readonly uncertain = false) {
    super(message)
    this.name = 'BridgeError'
  }
}

export function publicError(error: unknown): BridgeError {
  return error instanceof BridgeError
    ? error
    : new BridgeError('internal', '内部服务或数据库暂不可用，操作未能确认完成。请联系部署者检查服务。')
}

export function redact(text: string, token: string): string {
  if (token) text = text.split(token).join('[已隐藏敏感信息]')
  return text.replace(/(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g, '[已隐藏敏感信息]')
}
