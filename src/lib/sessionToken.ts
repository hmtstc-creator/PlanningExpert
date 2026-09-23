// Oturum jetonunun tek kaynağı.
//
// Taşıma katmanı (convexTransport) her çağrıya jetonu kendisi ekliyor;
// böylece yüz küsur çağrı noktasının tek tek jeton taşıması gerekmiyor ve
// biri unutulduğunda sessizce yetkisiz çalışmıyor.
//
// Küçük bir abone deseni: jeton değişince (giriş/çıkış) sorguların yeniden
// çalışması gerekiyor, bu yüzden React durumuna yansıtılabilmeli.

const STORAGE_KEY = 'planningexpert.sessionToken'

type Listener = (token: string | null) => void

const listeners = new Set<Listener>()
let current: string | null = null
let loaded = false

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    // Gizli sekme ya da engellenmiş site verisi.
    return null
  }
}

export function getSessionToken(): string | null {
  if (!loaded) {
    current = typeof window === 'undefined' ? null : readStored()
    loaded = true
  }
  return current
}

export function setSessionToken(token: string | null): void {
  current = token
  loaded = true
  try {
    if (token) window.localStorage.setItem(STORAGE_KEY, token)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* bu tarayıcıda hatırlanmayacak */
  }
  for (const listener of listeners) listener(token)
}

export function subscribeSessionToken(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
