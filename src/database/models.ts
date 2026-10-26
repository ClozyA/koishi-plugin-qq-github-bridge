import type { Context } from 'koishi'

export interface AdminRow { qq: string; addedBy: string; createdAt: Date }
export interface EventRow { id: string; expiresAt: Date }
export interface CooldownRow { qq: string; expiresAt: Date }
export interface AuditRow {
  id: string
  actorId: string
  actorQQ: string
  source: string
  action: string
  target: string
  groupId: string
  repository: string
  createdAt: Date
  result: string
  detail: string
}

declare module 'koishi' {
  interface Tables {
    qgh_admin: AdminRow
    qgh_event: EventRow
    qgh_cooldown: CooldownRow
    qgh_audit: AuditRow
  }
}

/** Additive schema, stable keys. Future renamed fields should use Minato's legacy migration. */
export function registerModels(ctx: Context) {
  ctx.model.extend('qgh_admin', {
    qq: 'string(20)', addedBy: 'string(64)', createdAt: 'timestamp',
  }, { primary: 'qq' })
  ctx.model.extend('qgh_event', {
    id: 'string(64)', expiresAt: 'timestamp',
  }, { primary: 'id' })
  ctx.model.extend('qgh_cooldown', {
    qq: 'string(20)', expiresAt: 'timestamp',
  }, { primary: 'qq' })
  ctx.model.extend('qgh_audit', {
    id: 'string(36)', actorId: 'string(64)', actorQQ: 'string(20)', source: 'string(16)',
    action: 'string(32)', target: 'string(100)', groupId: 'string(20)', repository: 'string(201)',
    createdAt: 'timestamp', result: 'string(24)', detail: 'string(255)',
  }, { primary: 'id' })
}
