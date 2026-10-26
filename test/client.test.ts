// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import type { Dashboard } from '../src/types'
import Page from '../client/page.vue'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@koishijs/client', () => ({ send }))

describe('compiled Vue management page', () => {
  let app: App | undefined
  let dashboard: Dashboard
  beforeEach(() => {
    dashboard = {
      admins: [], hasMoreAdmins: false, superAdmins: ['123456789'], audits: [], auditEnabled: true, auditRetentionDays: 30,
      bindings: [{ groupId: '345678901', repository: 'example/project', enabled: true }],
    }
    send.mockReset()
    send.mockImplementation(async (event: string, action?: unknown, target?: string) => {
      if (event.endsWith('/dashboard')) return structuredClone(dashboard)
      if (event.endsWith('/admin')) {
        if (action === 'add') dashboard.admins.push({ qq: target!, addedBy: 'console:0', createdAt: new Date().toISOString() })
        else dashboard.admins = dashboard.admins.filter(admin => admin.qq !== target)
        return action === 'add' ? `已添加管理员 ${target}` : `已撤销管理员 ${target}`
      }
      return { login: 'mock-account', repositories: [], message: '只读验证成功' }
    })
  })
  afterEach(() => { app?.unmount(); app = undefined; document.body.replaceChildren() })

  async function mount() {
    const root = document.createElement('div'); document.body.append(root)
    app = createApp(Page)
    app.component('k-layout', defineComponent({ setup(_, { slots }) { return () => h('main', slots.default?.()) } }))
    app.mount(root)
    await vi.waitFor(() => expect(document.body.textContent).not.toContain('正在读取后台数据'))
  }

  function button(text: string) {
    const button = Array.from(document.querySelectorAll('button')).find(item => item.textContent === text)
    if (!button) throw new Error(`Button not found: ${text}`)
    return button
  }

  async function requestAdd() {
    const input = document.querySelector<HTMLInputElement>('#qgh-qq')!
    input.value = '234567890'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await nextTick()
  }

  it('requires an explicit second step and refreshes rows after adding', async () => {
    await mount(); await requestAdd()
    expect(document.body.textContent).toContain('确定添加管理员')
    expect(send.mock.calls.filter(([name]) => name.endsWith('/admin'))).toHaveLength(0)
    button('确认新增').click()
    await vi.waitFor(() => expect(document.body.textContent).toContain('已添加管理员 234567890'))
    expect(document.body.textContent).toContain('console:0')
    expect(send).toHaveBeenCalledWith('qq-github-bridge/admin', 'add', '234567890')
  })
  it('cancels pending changes without an RPC', async () => {
    await mount(); await requestAdd(); button('取消').click(); await nextTick()
    expect(document.body.textContent).not.toContain('确定添加管理员')
    expect(send.mock.calls.filter(([name]) => name.endsWith('/admin'))).toHaveLength(0)
  })
  it('confirms revocation and refreshes the displayed database snapshot', async () => {
    dashboard.admins.push({ qq: '234567890', addedBy: '123456789', createdAt: new Date().toISOString() })
    await mount(); button('撤销').click(); await nextTick()
    expect(document.body.textContent).toContain('确定撤销管理员')
    button('确认撤销').click()
    await vi.waitFor(() => expect(document.body.textContent).toContain('已撤销管理员 234567890'))
    expect(document.body.textContent).toContain('本页暂无普通管理员')
  })
  it('displays server errors instead of a success notice', async () => {
    await mount(); await requestAdd()
    send.mockRejectedValueOnce('没有权限')
    button('确认新增').click()
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toBe('没有权限'))
    expect(document.querySelector('.qgh-notice')).toBeNull()
  })
  it('passes only the configured group selector when checking credentials', async () => {
    await mount()
    const select = document.querySelector<HTMLSelectElement>('#qgh-repo')!
    select.value = '345678901'; select.dispatchEvent(new Event('change', { bubbles: true })); await nextTick()
    button('检查连接').click()
    await vi.waitFor(() => expect(document.body.textContent).toContain('mock-account'))
    expect(send).toHaveBeenCalledWith('qq-github-bridge/validate', '345678901')
  })
  it('renders untrusted metadata as text rather than HTML', async () => {
    dashboard.admins.push({ qq: '234567890', addedBy: '<img src=x onerror=alert(1)>', createdAt: new Date().toISOString() })
    await mount()
    expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(document.querySelector('img')).toBeNull()
  })
})
