import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

/**
 * Ekranda seçili olan kişi.
 *
 * DİKKAT — bu bir kimlik DOĞRULAMA değildir. Parola yok, oturum yok; kişi
 * bir listeden seçilir ve seçim bu tarayıcıda saklanır. Tek işi kayıtların
 * üzerine "bunu kim yaptı" yazmaktır. Kimseyi hiçbir şeyden alıkoymaz ve
 * öyleymiş gibi sunulmamalıdır; gerçek giriş ayrı bir iştir.
 */
const STORAGE_KEY = 'planningexpert.currentUser'

interface CurrentUserValue {
  name: string | null
  setName: (name: string | null) => void
}

const CurrentUserContext = createContext<CurrentUserValue>({
  name: null,
  setName: () => {},
})

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const [name, setNameState] = useState<string | null>(null)

  // Tarayıcı deposu okunamayabilir (gizli sekme, engellenmiş site verisi);
  // okunamaması uygulamayı durdurmamalı, sadece kişi seçilmemiş olur.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored) setNameState(stored)
    } catch {
      /* seçim hatırlanmaz, sorun değil */
    }
  }, [])

  const setName = useCallback((next: string | null) => {
    setNameState(next)
    try {
      if (next) window.localStorage.setItem(STORAGE_KEY, next)
      else window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* bu tarayıcıda hatırlanmayacak */
    }
  }, [])

  return (
    <CurrentUserContext.Provider value={{ name, setName }}>
      {children}
    </CurrentUserContext.Provider>
  )
}

export function useCurrentUser(): CurrentUserValue {
  return useContext(CurrentUserContext)
}
