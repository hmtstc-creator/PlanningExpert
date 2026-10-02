import { createContext, useContext, type ReactNode } from 'react'

import { api } from '../../convex/_generated/api'
import { useQuery } from './convexTransport'
import { NO_ACCESS, atLeast, type Access, type Level, type Module } from './tenancy'

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
  migration: { started: boolean; done: boolean }
  plants: PlantSummary[]
  active: {
    plantId: string
    plantName: string
    companyId: string
    companyName: string
    companyStatus: string
    access: Access
    deleteAfter: number | null
  } | null
}

interface Value {
  ctx: TenancyContext | undefined
  access: Access
  can: (module: Module, level?: Level) => boolean
  isPlatform: boolean
  /** Seçili fabrikanın şirketini yönetebilir mi (creator ya da platform). */
  canManage: boolean
}

const PlantContext = createContext<Value>({
  ctx: undefined,
  access: NO_ACCESS,
  can: () => false,
  isPlatform: false,
  canManage: false,
})

export function PlantProvider({ children }: { children: ReactNode }) {
  const ctx = useQuery(api.tenancy.context) as TenancyContext | undefined
  const access = ctx?.active?.access ?? NO_ACCESS
  const isPlatform = ctx?.platformRole === 'owner' || ctx?.platformRole === 'general'
  const value: Value = {
    ctx,
    access,
    can: (m, level = 'view') => atLeast(access[m], level),
    isPlatform,
    canManage: isPlatform || (!!ctx?.isCreator && !!ctx.active && ctx.active.companyId === ctx.companyId),
  }
  return <PlantContext.Provider value={value}>{children}</PlantContext.Provider>
}

export function usePlant(): Value {
  return useContext(PlantContext)
}

/** Sayfanın ait olduğu modül (yol önekine göre); yönetim sayfaları modülsüz. */
export function moduleOfPath(pathname: string): Module | null {
  if (pathname === '/' || pathname.startsWith('/platform') || pathname.startsWith('/yonetim')) return null
  if (pathname.startsWith('/oee')) return 'oee'
  if (pathname.startsWith('/die-followup')) return 'die'
  if (pathname.startsWith('/machine-followup')) return 'machine'
  if (pathname.startsWith('/kpi')) return null
  return 'planning'
}
