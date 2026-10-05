// Kişinin kısayolları: sabitlenen ve son açılan sayfalar. Bu cihazda,
// kullanıcı başına (localStorage) — sunucuya gitmez; temizlenirse yalnızca
// kısayollar kaybolur. Kurallar saf ve test ediliyor; kayıt useShortcuts'ta.

import { useCallback, useSyncExternalStore } from 'react'

export const MAX_RECENT = 6
export const MAX_PINS = 12

export interface Shortcuts {
  pins: string[]
  recent: string[]
}

const EMPTY: Shortcuts = { pins: [], recent: [] }

/** Son açılan başa; aynı sayfa bir kez. */
export function pushRecent(list: string[], to: string): string[] {
  return [to, ...list.filter((x) => x !== to)].slice(0, MAX_RECENT)
}

/** Sabitle / kaldır; en çok MAX_PINS (en eskisi düşer). */
export function togglePin(list: string[], to: string): string[] {
  return list.includes(to) ? list.filter((x) => x !== to) : [...list, to].slice(-MAX_PINS)
}

/** Bozuk ya da elle değiştirilmiş kayıt sorun çıkarmasın: yalnızca "/…" yolları. */
export function parseShortcuts(raw: string | null): Shortcuts {
  try {
    const v = JSON.parse(raw ?? '')
    const clean = (x: unknown, max: number) =>
      Array.isArray(x) ? [...new Set(x.filter((s): s is string => typeof s === 'string' && /^\/[\w/-]*$/.test(s)))].slice(0, max) : []
    return { pins: clean(v?.pins, MAX_PINS), recent: clean(v?.recent, MAX_RECENT) }
  } catch {
    return EMPTY
  }
}

// ---- Kayıt (tarayıcı) -------------------------------------------------------

const keyOf = (user: string | null | undefined) => `pp.shortcuts.v1.${user ?? ''}`
const cache = new Map<string, Shortcuts>()
const listeners = new Set<() => void>()

function read(key: string): Shortcuts {
  const hit = cache.get(key)
  if (hit) return hit
  let v = EMPTY
  try {
    if (typeof window !== 'undefined') v = parseShortcuts(window.localStorage.getItem(key))
  } catch {
    v = EMPTY
  }
  cache.set(key, v)
  return v
}

function write(key: string, next: Shortcuts) {
  cache.set(key, next)
  try {
    window.localStorage.setItem(key, JSON.stringify(next))
  } catch {
    // Gizli pencere / dolu depo: kısayollar yalnızca bu oturumda kalır.
  }
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Kişinin kısayolları ve değiştiricileri; bütün bileşenler aynı kaydı görür. */
export function useShortcuts(user: string | null | undefined) {
  const key = keyOf(user)
  const value = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => EMPTY,
  )
  const visit = useCallback(
    (to: string) => {
      const cur = read(key)
      if (cur.recent[0] !== to) write(key, { ...cur, recent: pushRecent(cur.recent, to) })
    },
    [key],
  )
  const pin = useCallback(
    (to: string) => {
      const cur = read(key)
      write(key, { ...cur, pins: togglePin(cur.pins, to) })
    },
    [key],
  )
  return { ...value, visit, pin }
}
