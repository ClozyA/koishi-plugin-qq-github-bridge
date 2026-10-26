import { createHash } from 'node:crypto'
import type { Session } from 'koishi'
import { QQ_PATTERN } from '../config'
import type { IncomingMessage } from '../types'
import type { RepositoryResolver } from '../services/repository'

/** Narrow subset of the trusted OneBot transport payload, not message-supplied JSON. */
interface OneBotMessage {
  post_type?: string
  message_type?: string
  sub_type?: string
  anonymous?: unknown
  self_id?: number | string
  user_id?: number | string
  group_id?: number | string
  message_id?: number | string
  time?: number
  sender?: { user_id?: number | string; nickname?: string; card?: string }
}

function numericId(value: unknown): string | undefined {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return
  if (typeof value !== 'string' && typeof value !== 'number') return
  const text = String(value)
  if (QQ_PATTERN.test(text)) return text
}

export function readMessage(session: Session, resolver: RepositoryResolver, window: number, now = Date.now()): IncomingMessage | null {
  // Satori 4 normalizes the legacy 'message' event to 'message-created' at dispatch.
  if (session.platform !== 'onebot' || !['message', 'message-created'].includes(session.type) || session.isDirect || !session.guildId) return null
  // setInternal('onebot', payload) is how the official OneBot adapter exposes raw events.
  const raw = (session as Session & { onebot?: OneBotMessage }).onebot
  if (!raw || raw.post_type !== 'message' || raw.message_type !== 'group' || raw.anonymous || raw.sub_type === 'anonymous') return null
  const qq = numericId(raw.user_id)
  const sender = numericId(raw.sender?.user_id)
  const groupId = numericId(raw.group_id)
  if (!qq || qq !== sender || qq !== session.userId || !groupId || groupId !== session.guildId || groupId !== session.channelId) return null
  if (numericId(raw.self_id) !== session.selfId || qq === session.selfId) return null
  if (session.bot.ctx.bots.some(bot => bot.platform === 'onebot' && bot.selfId === qq)) return null
  const repository = resolver.resolve(groupId)
  if (!repository) return null
  const messageId = raw.message_id
  if ((typeof messageId !== 'string' && typeof messageId !== 'number') ||
    !/^-?[0-9]{1,30}$/.test(String(messageId)) || (typeof messageId === 'number' && !Number.isSafeInteger(messageId))) return null
  if (String(messageId) !== session.messageId) return null
  const timestamp = typeof raw.time === 'number' && Number.isSafeInteger(raw.time) ? raw.time * 1000 : 0
  if (!timestamp || now - timestamp > window || timestamp - now > 60000) return null
  // Parse decoded text elements, never serialized Satori markup or raw CQ codes.
  // Attachments / quotes / mentions are ignored as a whole so nothing is silently discarded.
  if (session.quote || !session.elements?.length || session.elements.some(element => element.type !== 'text')) return null
  const text = session.elements.map(element => element.attrs.content as string).join('')
  const eventKey = createHash('sha256').update(`onebot:${groupId}:${messageId}`).digest('hex')
  return {
    actor: {
      source: 'qq', id: qq, qq, groupId, repository: repository.fullName,
      nickname: raw.sender?.nickname || raw.sender?.card || qq,
    },
    repository, eventKey, timestamp, text,
  }
}
