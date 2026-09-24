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
}

export const PORTAL_MODULES: PortalModule[] = [
  {
    to: '/planningexpert',
    title: 'PlanningExpert',
    description: 'Automatic press shop production plan, SAP data, maintenance and mould follow-up.',
    ready: true,
  },
  {
    to: '/oee',
    title: 'OEE Trend and Losses',
    description: 'OEE over time per press and the losses behind it.',
    ready: false,
    related: [
      { to: '/performans', label: 'Performance (plan versus actual)' },
      { to: '/gerceklesen', label: 'Actual production' },
    ],
  },
  {
    to: '/die-followup',
    title: 'Die Follow-up',
    description: 'Die problems and their history, readiness, maintenance, shot counters and Pareto reports.',
    ready: true,
  },
  {
    to: '/machine-followup',
    title: 'Machine Follow-up',
    description: 'Press breakdowns and their history, planned maintenance and Pareto reports.',
    ready: true,
  },
  {
    to: '/kpi',
    title: 'KPI',
    description: 'Key plant figures on one page.',
    ready: false,
    related: [
      { to: '/planningexpert', label: 'PlanningExpert overview' },
      { to: '/performans', label: 'Performance' },
    ],
  },
]

/** Portal düzeyindeki sayfalar — PlanningExpert menüsü bunlarda gösterilmez. */
export function isPortalPath(pathname: string): boolean {
  if (pathname === '/') return true
  return PORTAL_MODULES.some((m) => !m.ready && pathname === m.to)
}
