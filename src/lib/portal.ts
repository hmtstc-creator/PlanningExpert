import type { Module } from './tenancy'

// Portalın modülleri. Ana sayfa bunlardan kurulur; üst çubuk da bir sayfanın
// portalda mı yoksa PlanningExpert içinde mi olduğunu buradan anlar.

export interface PortalModule {
  to: string
  title: string
  description: string
  /** Henüz hazır değilse ana sayfada "yakında" olarak görünür. */
  ready: boolean
  /** Hazır değilken bugün işe yarayan PlanningExpert sayfaları. */
  related?: { to: string; label: string }[]
  /** Yetki modülü (src/lib/tenancy.ts); izni yoksa ana sayfada görünmez. */
  module?: Module
}

export const PORTAL_MODULES: PortalModule[] = [
  {
    to: '/planningexpert',
    module: 'planning',
    title: 'PlanningExpert',
    description: 'Automatic plant production plan, SAP data, maintenance and mould follow-up.',
    ready: true,
  },
  {
    to: '/oee',
    module: 'oee',
    title: 'OEE Trend and Losses',
    description: 'OEE over time per work center and cost center, and the losses behind it.',
    ready: true,
  },
  {
    to: '/die-followup',
    module: 'die',
    title: 'Die Follow-up',
    description: 'Die problems and their history, readiness, maintenance, shot counters and Pareto reports.',
    ready: true,
  },
  {
    to: '/machine-followup',
    module: 'machine',
    title: 'Machine Follow-up',
    description: 'Work center breakdowns and their history, planned maintenance and Pareto reports.',
    ready: true,
  },
  {
    to: '/kpi',
    module: 'kpi',
    title: 'KPI',
    description: 'Monthly and weekly KPIs per cost center — plan against actual, A3 dashboard and PDF.',
    ready: true,
  },
]

/** Portal düzeyindeki sayfalar — PlanningExpert menüsü bunlarda gösterilmez. */
export function isPortalPath(pathname: string): boolean {
  if (pathname === '/') return true
  return PORTAL_MODULES.some((m) => !m.ready && pathname === m.to)
}
