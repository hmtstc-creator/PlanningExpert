import { createContext, useContext, type ReactNode } from 'react'

import { api } from '../../convex/_generated/api'
import { useQuery } from './convexTransport'
import { setDisplayTimeZone } from './sapUploads'
import { NO_ACCESS, NO_AREAS, atLeast, type Access, type AreaAccess, type AreaKey, type Level, type Module } from './tenancy'

/**
 * Oturumun şirket / fabrika bağlamı (convex/tenancy.ts → context): seçili
 * fabrika, görebildiği fabrikalar ve modül izinleri. Menü, fabrika seçici ve
 * sayfa kapısı buradan okur. Asıl denetim sunucudadır; burası yalnızca
 * ekranda gösterilmeyecek olanı gizler.
 */
export interface PlantSummary {
  _id: string
  name: string
  companyId: string
  companyName: string
  companyStatus: string
}

export interface TenancyContext {
  platformRole: 'owner' | 'general' | null
  isCreator: boolean
  companyId: string | null
  holdingId: string | null
  holdingName: string | null
  /** Board görünümü: yalnızca Board Dashboard ve KPI / OEE dashboard'ları. */
  isBoard: boolean
  migration: { started: boolean; done: boolean }
  plants: PlantSummary[]
  active: {
    plantId: string
    plantName: string
    companyId: string
    companyName: string
    companyStatus: string
    /** Fabrikanın ülkesi ve saat dilimi (tek kaynak: plants). */
    country: string
    timeZone: string
    /** Fabrikanın masraf yerleri (Company settings'ta tanımlanır). */
    costCenters: { code: string; name: string; department?: string }[]
    /** Plant'in bölümleri, sırasıyla (OEE alanları bunlardır). */
    departments: string[]
    /** Geçerli vardiyalar (src/lib/shifts.ts): plant'in kendi ya da şirket standardı. */
    shifts?: import('./shifts').ShiftDef[]
    shiftSource?: import('./shifts').ShiftSource
    access: Access
    /** Alan izinleri (AREAS); eski sunucu yanıtında yok. */
    areas?: AreaAccess
    deleteAfter: number | null
  } | null
}

interface Value {
  ctx: TenancyContext | undefined
  access: Access
  can: (module: Module, level?: Level) => boolean
  /** Alan izni (ör. canArea('planning.calendar', 'edit')). */
  canArea: (area: AreaKey, level?: Level) => boolean
  isPlatform: boolean
  /** Seçili fabrikanın şirketini yönetebilir mi (creator ya da platform). */
  canManage: boolean
}

const PlantContext = createContext<Value>({
  ctx: undefined,
  access: NO_ACCESS,
  can: () => false,
  canArea: () => false,
  isPlatform: false,
  canManage: false,
})

export function PlantProvider({ children }: { children: ReactNode }) {
  const ctx = useQuery(api.tenancy.context) as TenancyContext | undefined
  const access = ctx?.active?.access ?? NO_ACCESS
  // Saatler fabrikanın diliminde gösterilir (formatPlantTime).
  setDisplayTimeZone(ctx?.active?.timeZone || 'UTC')
  const isPlatform = ctx?.platformRole === 'owner' || ctx?.platformRole === 'general'
  const value: Value = {
    ctx,
    access,
    can: (m, level = 'view') => atLeast(access[m], level),
    canArea: (a, level = 'view') => atLeast((ctx?.active?.areas ?? NO_AREAS)[a] ?? 'none', level),
    isPlatform,
    canManage: isPlatform || (!!ctx?.isCreator && !!ctx.active && ctx.active.companyId === ctx.companyId),
  }
  return <PlantContext.Provider value={value}>{children}</PlantContext.Provider>
}

export function usePlant(): Value {
  return useContext(PlantContext)
}

/** Board görünümünde açık sayfalar (özet ve dashboard'lar, salt okunur). */
export const BOARD_PATHS = ['/board', '/kpi', '/kpi/monthly/dashboard', '/kpi/weekly/dashboard', '/oee']

export function boardAllows(pathname: string): boolean {
  const p = pathname.replace(/\/$/, '') || '/'
  // Hesap ve bağlantı teşhisi herkese açık.
  return p === '/' || p === '/account' || p === '/tani' || BOARD_PATHS.includes(p)
}

/** Seçili fabrikanın saat dilimi; bilinmiyorsa UTC. */
export function usePlantTimeZone(): string {
  return useContext(PlantContext).ctx?.active?.timeZone || 'UTC'
}

/** Sayfanın ait olduğu modül (yol önekine göre); yönetim sayfaları modülsüz. */
export function moduleOfPath(pathname: string): Module | null {
  // Karşılaştırma birden çok fabrikayı okur; sunucu her fabrikanın OEE iznine bakar.
  // Modülsüz: portal, Board, yönetim (Administration, Company settings), hesap, teşhis, karşılaştırma.
  const free = ['/board', '/admin', '/settings', '/users', '/account', '/tani', '/platform', '/yonetim', '/compare']
  if (pathname === '/' || free.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null
  if (pathname.startsWith('/oee')) return 'oee'
  if (pathname.startsWith('/die-followup')) return 'die'
  if (pathname.startsWith('/machine-followup')) return 'machine'
  if (pathname.startsWith('/kpi')) return 'kpi'
  return 'planning'
}

/**
 * Bu kullanıcı sayfayı açabilir mi? (TenancyGate'in kuralı; kısayol ve
 * bağlantılar açılmayacak sayfayı göstermesin diye.) Bağlam henüz yoksa
 * hepsi açık sayılır — kapı yine sayfada denetler.
 */
export function useCanOpen(): (path: string) => boolean {
  const { ctx, can, canManage, isPlatform } = usePlant()
  return (path: string) => {
    if (!ctx) return true
    const p = path.replace(/\/$/, '') || '/'
    if (ctx.isBoard && !boardAllows(p)) return false
    if (p === '/settings' || p.startsWith('/settings/') || p === '/users') return canManage
    if (p === '/admin' || p.startsWith('/admin/')) return isPlatform
    const m = moduleOfPath(p)
    return !m || can(m)
  }
}

