// Convex için WebSocket'siz yedek taşıma katmanı.
//
// Convex'in React istemcisi canlı veriyi WebSocket ile taşır. Kurumsal
// güvenlik duvarları HTTPS'e izin verip WebSocket'i sık sık keser; bu
// durumda site açılır ama hiçbir veri gelmez. Burada WebSocket birkaç
// saniye içinde kurulamazsa otomatik olarak saf HTTPS'e (ConvexHttpClient)
// geçiliyor ve veri periyodik olarak çekiliyor.
//
// Ödün: HTTP modunda veri canlı değil, periyodik tazelenir. Planlama
// uygulaması için bu kabul edilebilir — alternatif hiç çalışmamasıdır.

import { ConvexHttpClient } from 'convex/browser'
import {
  useAction as useConvexAction,
  useConvex,
  useMutation as useConvexMutation,
  usePaginatedQuery as useConvexPaginatedQuery,
  useQuery as useConvexQuery,
} from 'convex/react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { reportMutationError } from './mutationErrors'
import { getSessionToken, subscribeSessionToken } from './sessionToken'

export type TransportMode = 'connecting' | 'websocket' | 'http'

/** WebSocket bu süre içinde kurulamazsa HTTP'ye düşülür. */
const WS_GRACE_MS = 7000
/** HTTP modunda verinin tazelenme aralığı. */
const HTTP_POLL_MS = 20_000

const CONVEX_URL: string = (import.meta as any).env?.VITE_CONVEX_URL ?? ''

interface TransportValue {
  mode: TransportMode
  http: ConvexHttpClient | null
  /** Mutation sonrası HTTP modundaki sorguları tazelemek için sayaç. */
  revision: number
  bumpRevision: () => void
  /**
   * Oturum jetonu. Her çağrıya buradan ekleniyor — yüz küsur çağrı
   * noktasının tek tek taşıması gerekseydi biri mutlaka unutulur ve o işlev
   * yetkisiz kalırdı.
   */
  token: string | null
}

const TransportContext = createContext<TransportValue>({
  mode: 'connecting',
  http: null,
  revision: 0,
  bumpRevision: () => {},
  token: null,
})

export function TransportProvider({ children }: { children: ReactNode }) {
  const convex = useConvex()
  const [mode, setMode] = useState<TransportMode>('connecting')
  const [revision, setRevision] = useState(0)

  const http = useMemo(
    () =>
      CONVEX_URL
        ? new ConvexHttpClient(CONVEX_URL, { skipConvexDeploymentUrlCheck: true })
        : null,
    [],
  )

  useEffect(() => {
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null

    const read = () => {
      const connected = convex.connectionState().isWebSocketConnected
      if (connected) {
        if (fallbackTimer) {
          clearTimeout(fallbackTimer)
          fallbackTimer = null
        }
        setMode('websocket')
      } else {
        // WebSocket düştüyse hemen HTTP'ye geçme — kısa kopmalar olur.
        setMode((current) => (current === 'http' ? 'http' : 'connecting'))
        if (fallbackTimer === null) {
          fallbackTimer = setTimeout(() => {
            setMode((current) => (current === 'websocket' ? current : 'http'))
          }, WS_GRACE_MS)
        }
      }
    }

    read()
    const unsubscribe = convex.subscribeToConnectionState?.(read)
    const interval = setInterval(read, 2000)
    return () => {
      unsubscribe?.()
      clearInterval(interval)
      if (fallbackTimer) clearTimeout(fallbackTimer)
    }
  }, [convex])

  const bumpRevision = useCallback(() => setRevision((r) => r + 1), [])

  // Jeton değişince (giriş/çıkış) sorgular yeniden çalışmalı, bu yüzden
  // React durumuna yansıtılıyor.
  const [token, setToken] = useState<string | null>(() => getSessionToken())
  useEffect(() => subscribeSessionToken(setToken), [])

  const value = useMemo(
    () => ({ mode, http, revision, bumpRevision, token }),
    [mode, http, revision, bumpRevision, token],
  )

  return <TransportContext.Provider value={value}>{children}</TransportContext.Provider>
}

export function useTransport(): TransportValue {
  return useContext(TransportContext)
}

/**
 * HTTP modunda bir sorguyu periyodik olarak çeker. WebSocket modundayken
 * hiçbir şey yapmaz (hook kuralları gereği yine de çağrılır).
 */
function useHttpQuery<T>(
  active: boolean,
  fn: unknown,
  args: unknown,
): { data: T | undefined; error: string | null } {
  const { http, revision } = useTransport()
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const argsKey = JSON.stringify(args ?? null)
  const latest = useRef(0)

  useEffect(() => {
    if (!active || !http || args === 'skip') return
    let cancelled = false

    const run = async () => {
      const ticket = ++latest.current
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (http as any).query(fn, args)
        if (!cancelled && ticket === latest.current) {
          // Aynı veri tekrar geldiyse state'e dokunma: yeni nesne kimliği
          // tüm sayfalarda gereksiz yeniden render ve form sıfırlaması
          // tetikliyordu.
          setData((current) =>
            JSON.stringify(current) === JSON.stringify(result) ? current : (result as T),
          )
          setError(null)
        }
      } catch (e) {
        if (!cancelled && ticket === latest.current) {
          setError(e instanceof Error ? e.message : String(e))
        }
      }
    }

    void run()
    const interval = setInterval(() => void run(), HTTP_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, http, fn, argsKey, revision])

  return { data, error }
}

/**
 * `convex/react`'in useQuery'si yerine kullanılır. WebSocket varsa canlı
 * abonelik, yoksa HTTPS üzerinden periyodik çekim.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
/**
 * Çağrı argümanlarına oturum jetonunu ekler.
 *
 * Tek yerden eklendiği için hiçbir çağrı noktası jetonu taşımayı
 * unutamıyor; unutulan bir SUNUCU işlevi ise sessizce açık kalmaz, hata
 * verir.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withToken(args: any, token: string | null): any {
  if (args === 'skip') return 'skip'
  const base = args && typeof args === 'object' ? args : {}
  return token ? { ...base, token } : { ...base }
}

export function useQuery(fn: any, args?: any): any {
  const { mode, token } = useTransport()
  const useHttp = mode === 'http'
  // Jeton değişince nesne kimliği de değişsin ki sorgu yeniden çalışsın.
  const withAuth = useMemo(() => withToken(args ?? {}, token), [args, token])
  // Hook kuralları: ikisi de her render'da çağrılır, biri devre dışı kalır.
  const wsResult = useConvexQuery(fn, useHttp ? 'skip' : withAuth)
  const { data } = useHttpQuery<unknown>(useHttp, fn, withAuth)
  return useHttp ? data : wsResult
}

/**
 * `usePaginatedQuery` yerine. HTTP modunda tek sayfa çekilir — uygulamadaki
 * tüm kullanımlar zaten ilk sayfayı istiyor.
 */
export function usePaginatedQuery(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any,
  options: { initialNumItems: number },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): { results: any[]; status: string; loadMore: (n: number) => void } {
  const { mode, token } = useTransport()
  const useHttp = mode === 'http'

  const withAuth = useMemo(() => withToken(args, token), [args, token])
  const wsResult = useConvexPaginatedQuery(fn, useHttp ? 'skip' : withAuth, options)
  const httpArgs = useMemo(
    () => ({
      ...(withAuth && withAuth !== 'skip' ? withAuth : {}),
      paginationOpts: { numItems: options.initialNumItems, cursor: null },
    }),
    [withAuth, options.initialNumItems],
  )
  const { data } = useHttpQuery<{ page: unknown[] }>(useHttp, fn, httpArgs)

  if (!useHttp) return wsResult as never

  return {
    results: (data?.page ?? []) as unknown[],
    status: data === undefined ? 'LoadingFirstPage' : 'Exhausted',
    loadMore: () => {},
  }
}

/**
 * `useMutation` yerine. HTTP modunda ConvexHttpClient ile yazar ve ardından
 * sorguları tazelemek için revision'ı artırır.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useMutation(fn: any): (args?: any) => Promise<any> {
  const { mode, http, bumpRevision, token } = useTransport()
  const wsMutation = useConvexMutation(fn)

  return useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (args?: any) => {
      const withAuth = withToken(args ?? {}, token)
      if (mode !== 'http') return wsMutation(withAuth)
      if (!http) throw new Error('Veritabanı adresi tanımlı değil')
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (http as any).mutation(fn, withAuth)
        bumpRevision()
        return result
      } catch (e) {
        reportMutationError(e)
        throw e
      }
    },
    [mode, http, wsMutation, fn, bumpRevision, token],
  )
}

/**
 * `useAction` yerine. Action'lar sorgu değil, sonuç döndüren çağrılardır;
 * iki taşıma modunda da aynı şekilde çalışırlar.
 *
 * Hata burada `reportMutationError`'a GİTMEZ: giriş hatası ("kullanıcı adı
 * ya da parola yanlış") kullanıcının okuması gereken normal bir cevaptır,
 * ekranın köşesinde beliren bir sistem hatası değil. Çağıran taraf ne
 * yapacağını kendi bilir.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useAction(fn: any): (args?: any) => Promise<any> {
  const { mode, http, token } = useTransport()
  const wsAction = useConvexAction(fn)

  return useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (args?: any) => {
      // Giriş action'ı jetonu yok sayar; diğerleri denetler.
      const withAuth = withToken(args ?? {}, token)
      if (mode !== 'http') return wsAction(withAuth)
      if (!http) throw new Error('Veritabanı adresi tanımlı değil')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (http as any).action(fn, withAuth)
    },
    [mode, http, wsAction, fn, token],
  )
}

export { useConvex } from 'convex/react'
