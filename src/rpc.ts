import type { Client } from '@koishijs/plugin-console'
import type { Dashboard, TokenStatus } from './types'

declare module '@koishijs/console' {
  interface Events {
    'qq-github-bridge/dashboard'(this: Client, page?: number): Promise<Dashboard>
    'qq-github-bridge/admin'(this: Client, action: 'add' | 'remove', qq: string): Promise<string>
    'qq-github-bridge/validate'(this: Client, groupId?: string): Promise<TokenStatus>
  }
}
