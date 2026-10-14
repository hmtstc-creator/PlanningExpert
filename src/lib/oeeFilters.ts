/**
 * OEE sayfalarının ortak filtresi (Aksiyonlar sunumu, planlamacı 2026-10-14):
 * Trend Analysis, Losses Trend, Loss Bridge, Daily Report, MTTR & MTBF ve
 * Dies OEE Trend aynı filtreyi kullanır; sayfadan sayfaya geçerken seçim
 * kaybolmaz. Alan / masraf yeri seçimi tarayıcıda kalır (localStorage); tarih,
 * dönem, vardiya ve makine bu oturumda (sessionStorage) — ertesi gün program
 * yine son yüklenen günle açılır.
 */
import { useSyncExternalStore } from 'react'

import type { Scope } from './oee'
import type { PeriodMode } from './oeeBridge'

export interface OeeFilters {
  scope: Scope
  /** Seçilen gün; boşsa son yüklenen gün. */
  date: string
  mode: PeriodMode
  range: { from: string; to: string } | null
  /** 0 = bütün vardiyalar. */
  shift: number
  /** Boşsa seçimdeki bütün makineler. */
  machine: string
}

const SCOPE_KEY = 'oee-selection'
const SESSION_KEY = 'oee-filters'

const DEFAULTS: OeeFilters = { scope: { area: '', key: 'all' }, date: '', mode: 'day', range: null, shift: 0, machine: '' }

function read(): OeeFilters {
  const out = { ...DEFAULTS }
  if (typeof window === 'undefined') return out
  try {
    const v = JSON.parse(window.localStorage.getItem(SCOPE_KEY) ?? 'null')
    if (v && typeof v.area === 'string' && typeof v.key === 'string') out.scope = { area: v.area, key: v.key }
  } catch {
    // Saklanamıyorsa varsayılan.
  }
  try {
    const v = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) ?? 'null')
    if (v && typeof v === 'object') {
      if (typeof v.date === 'string') out.date = v.date
      if (v.mode === 'day' || v.mode === 'range') out.mode = v.mode
      if (v.range && typeof v.range.from === 'string' && typeof v.range.to === 'string') out.range = { from: v.range.from, to: v.range.to }
      if (typeof v.shift === 'number') out.shift = v.shift
      if (typeof v.machine === 'string') out.machine = v.machine
    }
  } catch {
    // Saklanamıyorsa yalnızca bellekte.
  }
  return out
}

let state: OeeFilters | null = null
const listeners = new Set<() => void>()

const current = () => (state ??= read())

export function setOeeFilters(patch: Partial<OeeFilters>) {
  const next = { ...current(), ...patch }
  state = next
  try {
    window.localStorage.setItem(SCOPE_KEY, JSON.stringify(next.scope))
    const { scope: _s, ...session } = next
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // Saklanamıyorsa yalnızca bellekte.
  }
  for (const l of listeners) l()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Ortak filtre ve değiştirici. Sunucu çiziminde varsayılan. */
export function useOeeFilters(): [OeeFilters, (patch: Partial<OeeFilters>) => void] {
  const f = useSyncExternalStore(subscribe, current, () => DEFAULTS)
  return [f, setOeeFilters]
}

/** Seçili filtrelerin kısa yazısı (çıktı başlığı). */
export function filterSummary(parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' · ')
}

/** GGAAYY (14.10.2026 → 141026): çıktı dosyasının adı. */
export const ddmmyy = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(2, 4)}`
