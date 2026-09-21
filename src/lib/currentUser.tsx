import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { api } from '../../convex/_generated/api'
import { useQuery } from './convexTransport'

/**
 * Giriş yapmış kullanıcı.
 *
 * Oturum jetonu bu tarayıcıda saklanır ve her açılışta sunucuya sorulur;
 * kullanıcı adı, rolü ve "parolasını değiştirmeli mi" bilgisi oradan gelir.
 * Kayıtların üzerine yazılan isim artık bir listeden seçilen değil, giriş
 * yapan kişidir.
 */
const TOKEN_KEY = 'planningexpert.sessionToken'

function readToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    // Gizli sekme ya da engellenmiş site verisi: oturum hatırlanmaz.
    return null
  }
}

function writeToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token)
    else window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* bu tarayıcıda hatırlanmayacak */
  }
}

export interface SessionUser {
  name: string
  role: string
  mustChangePassword: boolean
}

interface CurrentUserValue {
  /** Kayıtlara yazılacak isim; giriş yoksa null. */
  name: string | null
  user: SessionUser | null
  token: string | null
  /** Oturum sunucuya sorulurken true. */
  loading: boolean
  setToken: (token: string | null) => void
}

const CurrentUserContext = createContext<CurrentUserValue>({
  name: null,
  user: null,
  token: null,
  loading: true,
  setToken: () => {},
})

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null)
  // Jeton tarayıcıdan okunana kadar "giriş yok" demek, her açılışta giriş
  // ekranını bir an gösterirdi.
  const [tokenRead, setTokenRead] = useState(false)

  useEffect(() => {
    setTokenState(readToken())
    setTokenRead(true)
  }, [])

  const setToken = useCallback((next: string | null) => {
    setTokenState(next)
    writeToken(next)
  }, [])

  const result = useQuery(api.authInternal.me, tokenRead ? { token: token ?? undefined } : 'skip')
  const loading = !tokenRead || result === undefined
  const user = (result ?? null) as SessionUser | null

  // Jeton var ama sunucu tanımıyorsa (süresi dolmuş, kullanıcı silinmiş)
  // saklamanın anlamı yok.
  useEffect(() => {
    if (!loading && token && user === null) writeToken(null)
  }, [loading, token, user])

  const value = useMemo(
    () => ({ name: user?.name ?? null, user, token, loading, setToken }),
    [user, token, loading, setToken],
  )

  return <CurrentUserContext.Provider value={value}>{children}</CurrentUserContext.Provider>
}

export function useCurrentUser(): CurrentUserValue {
  return useContext(CurrentUserContext)
}
