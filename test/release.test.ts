import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const { waitForPublishedVersion } = createRequire(resolve('package.json'))('./scripts/publish-release.cjs') as {
  waitForPublishedVersion(name: string, version: string): Promise<{ version: string }>
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('npm registry processing after a successful upload', () => {
  it('waits beyond a minute of initial 404 responses without repeating a publish', async () => {
    vi.useFakeTimers()
    let reads = 0
    vi.stubGlobal('fetch', vi.fn(async () => ++reads <= 5
      ? new Response('{}', { status: 404 })
      : new Response(JSON.stringify({ version: '1.0.2' }))))
    const pending = waitForPublishedVersion('example-package', '1.0.2')
    await vi.advanceTimersByTimeAsync(75000)
    await expect(pending).resolves.toEqual({ version: '1.0.2' })
    expect(reads).toBe(6)
  })

  it('does not hide permanent registry permission failures', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 403 }))
    vi.stubGlobal('fetch', fetch)
    await expect(waitForPublishedVersion('example-package', '1.0.2')).rejects.toThrow('HTTP 403')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('bounds the wait and reports an accepted but still processing upload accurately', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(async () => new Response('{}', { status: 404 }))
    vi.stubGlobal('fetch', fetch)
    const assertion = expect(waitForPublishedVersion('example-package', '1.0.2')).rejects.toThrow('npm accepted the upload, but the version is still not readable')
    await vi.runAllTimersAsync()
    await assertion
    expect(fetch).toHaveBeenCalledTimes(20)
  })
})
