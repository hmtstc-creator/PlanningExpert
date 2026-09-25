import { afterEach, describe, expect, it, vi } from 'vitest'

async function load() {
  vi.resetModules()
  vi.stubEnv('VITE_CONVEX_URL', 'https://happy-cat-123.convex.cloud')
  return import('./serverReachability')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('probeServer', () => {
  it('is ok only when Convex itself answers', async () => {
    const { probeServer } = await load()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'success', value: null }))))
    expect(await probeServer()).toBe('ok')
  })

  it('treats a network failure as blocked', async () => {
    const { probeServer } = await load()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    expect(await probeServer()).toBe('blocked')
  })

  it('treats a firewall block page as blocked, not as connected', async () => {
    const { probeServer } = await load()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Web Page Blocked</html>', { status: 403 })))
    expect(await probeServer()).toBe('blocked')
  })

  it('gives up after the timeout', async () => {
    const { probeServer } = await load()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      ),
    )
    expect(await probeServer(50)).toBe('blocked')
  })
})

describe('login error messages', () => {
  it('turns a network error into advice that names the server', async () => {
    const { friendlyNetworkError } = await load()
    expect(friendlyNetworkError(new TypeError('Failed to fetch'))).toContain('happy-cat-123.convex.cloud')
    expect(friendlyNetworkError(new Error('Request timed out'))).toContain('could not be reached')
    expect(friendlyNetworkError(new Error('Wrong user name or password'))).toBe('Wrong user name or password')
  })

  it('times a hanging request out', async () => {
    const { withTimeout } = await load()
    await expect(withTimeout(new Promise(() => {}), 20)).rejects.toThrow('Request timed out')
    await expect(withTimeout(Promise.resolve(5), 20)).resolves.toBe(5)
  })
})
