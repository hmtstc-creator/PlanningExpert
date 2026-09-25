// Veri sunucusuna (Convex) bu bilgisayardan ulaşılabiliyor mu?
//
// Giriş ekranı bunu gösterir: şirket ağı ya da güvenlik yazılımı
// `*.convex.cloud` adresini engellerse sayfa açılır ama giriş hiçbir zaman
// cevap alamaz. Kullanıcı sebebini görmeli ve IT'ye ne soracağını bilmeli.

import { useEffect, useState } from 'react'

export const CONVEX_URL: string = import.meta.env.VITE_CONVEX_URL ?? ''

export function convexHost(): string {
  try {
    return new URL(CONVEX_URL).host
  } catch {
    return CONVEX_URL || '(not configured)'
  }
}

export type Reachability = 'checking' | 'ok' | 'blocked' | 'no-url'

/**
 * Gerçek bir Convex cevabı ister: açık (girişsiz) `authInternal:me`
 * sorgusu. Yalnızca "bağlantı kuruldu" demek yetmez — araya giren bir
 * güvenlik duvarı kendi engel sayfasını döndürebilir; o durumda cevap
 * Convex'in JSON'u olmaz ve engelli sayılır.
 */
export async function probeServer(timeoutMs = 10_000): Promise<Exclude<Reachability, 'checking'>> {
  if (!CONVEX_URL) return 'no-url'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${CONVEX_URL}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'authInternal:me', args: {}, format: 'json' }),
      signal: controller.signal,
      cache: 'no-store',
    })
    const body = (await response.json()) as { status?: string }
    return body.status === 'success' ? 'ok' : 'blocked'
  } catch {
    return 'blocked'
  } finally {
    clearTimeout(timer)
  }
}

export function useServerReachability(): { state: Reachability; retry: () => void } {
  const [state, setState] = useState<Reachability>(CONVEX_URL ? 'checking' : 'no-url')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!CONVEX_URL) return
    let cancelled = false
    setState('checking')
    void probeServer().then((result) => {
      if (!cancelled) setState(result)
    })
    return () => {
      cancelled = true
    }
  }, [attempt])
  return { state, retry: () => setAttempt((a) => a + 1) }
}

/** Ağ hatasını okunur bir cümleye çevirir; diğer hataları olduğu gibi bırakır. */
export function friendlyNetworkError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/failed to fetch|networkerror|load failed|network request failed|timed out|aborted/i.test(message)) {
    return `The data server (${convexHost()}) could not be reached from this computer. The network or security software may be blocking it.`
  }
  return message
}

/** Bir sözü süre sınırıyla bekler; süre dolarsa açıklayıcı hata verir. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Request timed out')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
