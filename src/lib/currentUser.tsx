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
import { useAction, useQuery } from './convexTransport'
import { getSessionToken, setSessionToken, subscribeSessionToken } from './sessionToken'

/**
 * Giriş yapmış kullanıcı.
 *
 * Oturum jetonu bu tarayıcıda saklanır ve her açılışta sunucuya sorulur;
 * kullanıcı adı, rolü ve "parolasını değiştirmeli mi" bilgisi oradan gelir.
 * Kayıtların üzerine yazılan isim artık bir listeden seçilen değil, giriş
 * yapan kişidir.
 */
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
  // Jeton paylaşılan depoda: taşıma katmanı her çağrıya oradan ekliyor.
  const [token, setTokenState] = useState<string | null>(null)
  // Jeton tarayıcıdan okunana kadar "giriş yok" demek, her açılışta giriş
  // ekranını bir an gösterirdi.
  const [tokenRead, setTokenRead] = useState(false)

  useEffect(() => {
    setTokenState(getSessionToken())
    setTokenRead(true)
    return subscribeSessionToken(setTokenState)
  }, [])

  const logout = useAction(api.auth.logout)

  /**
   * Çıkış yalnızca jetonu unutmak değil, sunucudaki oturumu da kapatmak
   * olmalı: kopyalanmış bir jeton aksi halde 12 saat daha çalışırdı.
   * Sunucuya ulaşılamasa bile yerel jeton her hâlükârda temizlenir.
   */
  const setToken = useCallback(
    (next: string | null) => {
      const previous = getSessionToken()
      if (next === null && previous) {
        void logout({ token: previous }).catch(() => {})
      }
      setSessionToken(next)
    },
    [logout],
  )

  const result = useQuery(api.authInternal.me, tokenRead ? { token: token ?? undefined } : 'skip')
  const loading = !tokenRead || result === undefined
  const user = (result ?? null) as SessionUser | null

  // Jeton var ama sunucu tanımıyorsa (süresi dolmuş, kullanıcı silinmiş)
  // saklamanın anlamı yok. `result === null` gerçekten BU jeton için gelen
  // cevaptır: taşıma katmanı yeni argümanlar için cevap gelene kadar
  // undefined döner, eski "oturum yok" cevabı yeni jetonu sildiremez.
  useEffect(() => {
    if (tokenRead && token && result === null) setSessionToken(null)
  }, [tokenRead, token, result])

  const value = useMemo(
    () => ({ name: user?.name ?? null, user, token, loading, setToken }),
    [user, token, loading, setToken],
  )

  return <CurrentUserContext.Provider value={value}>{children}</CurrentUserContext.Provider>
}

export function useCurrentUser(): CurrentUserValue {
  return useContext(CurrentUserContext)
}
