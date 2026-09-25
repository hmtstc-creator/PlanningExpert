// @vitest-environment jsdom
import { act, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { TransportContext, useHttpQuery } from './convexTransport'

// HTTP yedek modu: giriş sonrası jeton eklendiğinde eski "oturum yok"
// cevabı yeni jetonun cevabı gibi dönmemeli. Dönerse jeton hemen silinir ve
// giriş ekranı sessizce geri gelir — bilgisayarda yaşanan hata buydu.

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('useHttpQuery', () => {
  it('does not return the old answer for new arguments', async () => {
    const answers = new Map<string, ReturnType<typeof deferred<unknown>>>()
    const http = {
      query: (_fn: unknown, args: { token?: string }) => {
        const key = args.token ?? 'none'
        if (!answers.has(key)) answers.set(key, deferred())
        return answers.get(key)!.promise
      },
    }
    const seen: unknown[] = []
    function Probe({ token }: { token?: string }) {
      const { data } = useHttpQuery<unknown>(true, 'authInternal:me', token ? { token } : {})
      seen.push(data)
      return null
    }
    const value = { mode: 'http' as const, http: http as never, revision: 0, bumpRevision: () => {}, token: null }
    const view = render(
      <TransportContext.Provider value={value}>
        <Probe />
      </TransportContext.Provider>,
    )
    await act(async () => answers.get('none')!.resolve(null))
    expect(seen.at(-1)).toBeNull()

    // Giriş: jeton eklendi. Cevap gelene kadar "bilinmiyor" (undefined)
    // olmalı, eski null değil.
    view.rerender(
      <TransportContext.Provider value={value}>
        <Probe token="t1" />
      </TransportContext.Provider>,
    )
    expect(seen.at(-1)).toBeUndefined()

    await act(async () => answers.get('t1')!.resolve({ name: 'admin' }))
    expect(seen.at(-1)).toEqual({ name: 'admin' })
  })
})

// ---- Hangi taşıma: WebSocket mi HTTPS mi? ---------------------------------

import { ConvexProvider } from 'convex/react'
import { vi } from 'vitest'

import { TransportProvider, useTransport } from './convexTransport'

function fakeConvex({ connected, answers }: { connected: boolean; answers: boolean }) {
  const listeners = new Set<() => void>()
  return {
    connectionState: () => ({ isWebSocketConnected: connected }),
    subscribeToConnectionState: (cb: () => void) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    watchQuery: () => {
      let update: (() => void) | null = null
      let ready = false
      // Sunucu cevabı gelir, sonra dinleyiciye haber verilir.
      if (answers)
        setTimeout(() => {
          ready = true
          update?.()
        }, 100)
      return {
        onUpdate: (cb: () => void) => {
          update = cb
          return () => (update = null)
        },
        localQueryResult: () => (ready ? null : undefined),
      }
    },
  }
}

function modeAfter(convex: object, ms: number): string {
  let mode = ''
  function Show() {
    mode = useTransport().mode
    return null
  }
  render(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <ConvexProvider client={convex as any}>
      <TransportProvider>
        <Show />
      </TransportProvider>
    </ConvexProvider>,
  )
  act(() => {
    vi.advanceTimersByTime(ms)
  })
  return mode
}

describe('transport choice', () => {
  it('waits (does not trust the WebSocket) while it has not answered yet', () => {
    vi.useFakeTimers()
    try {
      expect(modeAfter(fakeConvex({ connected: true, answers: false }), 3000)).toBe('connecting')
    } finally {
      vi.useRealTimers()
    }
  })

  it('switches to HTTPS 8 s after a silent WebSocket, and stays there', () => {
    vi.useFakeTimers()
    try {
      expect(modeAfter(fakeConvex({ connected: true, answers: false }), 9000)).toBe('http')
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses the WebSocket once it has really answered', () => {
    vi.useFakeTimers()
    try {
      expect(modeAfter(fakeConvex({ connected: true, answers: true }), 2500)).toBe('websocket')
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses HTTPS when the WebSocket never opens', () => {
    vi.useFakeTimers()
    try {
      expect(modeAfter(fakeConvex({ connected: false, answers: false }), 8000)).toBe('http')
    } finally {
      vi.useRealTimers()
    }
  })
})
