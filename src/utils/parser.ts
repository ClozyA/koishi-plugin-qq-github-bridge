import { RE2 } from 're2-wasm'
import type { Config } from '../config'
import { QQ_PATTERN } from '../config'
import type { Command } from '../types'
import { BridgeError } from './errors'

export class MessageParser {
  private readonly reply: RE2

  constructor(private readonly config: Config) {
    const pattern = config.replyPattern || `^${config.replyPrefix}(?<number>\\d+)\\s+(?<body>[\\s\\S]+)$`
    if (pattern.length > 1024 || !pattern.startsWith('^') || !pattern.endsWith('$') ||
      !pattern.includes('(?<number>') || !pattern.includes('(?<body>')) {
      throw new BridgeError('config-regex', '回复正则最多 1024 字符，须使用 ^ 和 $ 全文匹配，并声明 number 和 body 命名捕获组。')
    }
    try { this.reply = new RE2(pattern, 'u') } catch {
      // Never expose the pattern: a misconfigured pattern could itself contain secrets.
      throw new BridgeError('config-regex', '回复正则无效或使用了 RE2 不支持的语法（如回溯引用、前后查找）。')
    }
  }

  parse(text: string): Command | null {
    if (text.length > this.config.maxCommentLength + 4096) return null
    const { adminPrefix, closePrefix, openPrefix } = this.config
    // Reserve privileged command namespaces before trying any custom comment expression.
    if (text.startsWith(adminPrefix) && /^(?:\s|$)/.test(text.slice(adminPrefix.length))) {
      const parts = text.split(/\s+/)
      if (parts[1] === 'confirm' && parts.length === 3 && /^[a-f0-9]{12}$/.test(parts[2])) {
        return { type: 'confirm', code: parts[2] }
      }
      if (parts[1] === 'list' && (parts.length === 2 || (parts.length === 3 && /^[1-9][0-9]{0,5}$/.test(parts[2])))) {
        return { type: 'admin-list', page: parts[2] ? Number(parts[2]) : 1 }
      }
      if (parts.length === 3 && QQ_PATTERN.test(parts[2])) {
        if (parts[1] === 'add') return { type: 'admin-add', qq: parts[2] }
        if (parts[1] === 'remove') return { type: 'admin-remove', qq: parts[2] }
      }
      return { type: 'invalid', message: `用法：${adminPrefix} add/remove QQ号；${adminPrefix} list [页码]；${adminPrefix} confirm 确认码。` }
    }
    for (const [prefix, type] of [[closePrefix, 'close'], [openPrefix, 'open']] as const) {
      if (!text.startsWith(prefix)) continue
      const suffix = text.slice(prefix.length)
      // Ordinary words starting with the prefix are not commands.
      if (suffix && !/^[0-9\s]/.test(suffix)) continue
      const number = this.number(suffix)
      return number ? { type, number } : { type: 'invalid', message: `用法：${prefix}1003（编号须为正整数）。` }
    }
    const match = this.reply.exec(text)
    // An alternative branch or a terminal newline must not defeat full matching.
    if (match && match.index === 0 && match[0] === text) {
      const number = this.number(match.groups?.number)
      const body = match.groups?.body
      if (!number) return { type: 'invalid', message: 'Issue / PR 编号必须是有效的正整数。' }
      if (!body?.trim()) return { type: 'invalid', message: '评论正文不能为空。' }
      if (body.length > this.config.maxCommentLength) return { type: 'invalid', message: `评论过长，最多 ${this.config.maxCommentLength} 字符。` }
      if (!this.config.allowMultiline && /[\r\n]/.test(body)) return { type: 'invalid', message: '当前配置不允许多行评论。' }
      if (/\u0000/.test(body)) return { type: 'invalid', message: '评论包含不支持的空字符。' }
      return { type: 'comment', number, body }
    }
    if (!this.config.replyPattern && new RegExp(`^${this.config.replyPrefix}[0-9]+\\s*$`).test(text)) {
      return { type: 'invalid', message: '评论正文不能为空。' }
    }
    return null
  }

  private number(value?: string): number | undefined {
    if (!value || !/^[1-9][0-9]*$/.test(value)) return
    const number = Number(value)
    if (Number.isSafeInteger(number)) return number
  }
}
