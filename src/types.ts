export interface Repository {
  owner: string
  repo: string
  fullName: string
}

export interface Actor {
  source: 'qq' | 'console'
  id: string
  qq: string
  nickname: string
  groupId: string
  repository: string
}

export interface IncomingMessage {
  actor: Actor
  repository: Repository
  eventKey: string
  timestamp: number
  text: string
}

export type Command =
  | { type: 'comment'; number: number; body: string }
  | { type: 'close'; number: number }
  | { type: 'open'; number: number }
  | { type: 'admin-add'; qq: string }
  | { type: 'admin-remove'; qq: string }
  | { type: 'admin-list'; page: number }
  | { type: 'confirm'; code: string }
  | { type: 'invalid'; message: string }

export type MutatingCommand = Exclude<Command, { type: 'invalid' | 'confirm' | 'admin-list' }>

export interface Outcome {
  message: string
  result?: 'success' | 'noop'
}

export interface AdminView {
  qq: string
  addedBy: string
  createdAt: string
}

export interface AuditView {
  id: string
  actorId: string
  actorQQ: string
  source: string
  action: string
  target: string
  groupId: string
  repository: string
  createdAt: string
  result: string
  detail: string
}

export interface Dashboard {
  admins: AdminView[]
  hasMoreAdmins: boolean
  superAdmins: string[]
  bindings: Array<{ groupId: string; repository: string; enabled: boolean }>
  audits: AuditView[]
  auditEnabled: boolean
  auditRetentionDays: number
}

export interface TokenStatus {
  login: string
  repositories: Array<{ repository: string; accessible: boolean; message: string }>
  message: string
}
