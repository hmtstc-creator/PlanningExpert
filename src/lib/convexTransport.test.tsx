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
