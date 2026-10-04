// Menünün tek tanımı: üst çubuk, telefon çekmecesi ve modül değiştirici aynı
// listeden okur, ikisi birbirinden kopamaz.
//
// Yapı: portal → alan (modül ya da ayarlar) → alanın menüsü. Her alanın
// başlığı, ana sayfası ve menüsü burada; hangi alanda olunduğu yoldan çıkar.
// Yönetim iki ayrı alandır: Company settings (creator: kendi şirketi) ve
// Administration (General: holding, şirket, platform). Modül menülerinde
// yönetim yoktur; kullanıcı menüsünden açılır.

import type { Module } from './tenancy'

export interface NavItem {
  to: string
  label: string
  /** Açılan menüde ve telefon çekmecesinde bir satırlık açıklama. */
  hint?: string
}

/**
 * Menü ağacı: çubukta doğrudan bağlantı (`to`) ya da açılan menü
 * (`children`); açılan menünün satırı da bir alt menü açabilir — en çok üç
 * kademe: çubuk → menü → alt menü.
 */
export interface NavNode {
  label: string
  to?: string
  hint?: string
  children?: NavNode[]
}

export type AreaKey = 'portal' | 'planning' | 'oee' | 'die' | 'machine' | 'kpi' | 'board' | 'settings' | 'admin'

export interface Area {
  key: AreaKey
  title: string
  /** Logonun altında küçük satır. */
  subtitle: string
  home: string
  /** İzin modülü (src/lib/tenancy.ts); yoksa modül değil (portal, ayarlar). */
  module?: Module
  /** Çubuğun menüsü (ağaç). */
  nav: NavNode[]
}

const link = (to: string, label: string, hint?: string): NavNode => ({ to, label, hint })

const PLANNING: Area = {
  key: 'planning',
  title: 'PlanningExpert',
  subtitle: 'Production planning',
  home: '/planningexpert',
  module: 'planning',
  nav: [
    link('/planlama', 'Plan', 'The weekly production plan'),
    link('/planningexpert', 'Overview', 'Daily status and warnings'),
    {
      label: 'Menu',
      children: [
        {
          label: 'Analysis',
          hint: 'Capacity, raw material, alarms, performance',
          children: [
            link('/capacity', 'Capacity Dashboard', 'Weekly capacity vs demand by work center group'),
            link('/hammadde', 'Raw Material Coverage', 'Steel requirement and orders per week'),
            link('/alarms', 'Alarms', 'Dies and machines that hold up the plan'),
            link('/performans', 'Performance', 'Plan versus actual'),
          ],
        },
        {
          label: 'SAP data',
          hint: 'Uploads and what they contain',
          children: [
            link('/sapdata', 'SAP Data', 'Upload ZPP, ZPP_DAILY, MB52 and MB51'),
            link('/siparisler', 'Demand', 'Weekly and daily net requirements'),
            link('/stoklar', 'Stock', 'Stock by material and location'),
            link('/gerceklesen', 'Actuals', 'Posted production movements'),
          ],
        },
        {
          label: 'Master data',
          hint: 'Parts, work centers, calendar, locations',
          children: [
            link('/referanslar', 'Master Data', 'Cavities, SPM, weights, machines'),
            link('/makineler', 'Work Centers', 'Cost center, hall, category, coil feed'),
            link('/takvim', 'Work Calendar', 'Shifts, stops, capacity'),
            link('/depolar', 'Storage Locations', 'Which stock counts'),
          ],
        },
        {
          label: 'Help',
          hint: 'How the plan works, decisions of the plant',
          children: [
            link('/planlogic', 'Planning Logic', 'How the plan is calculated'),
            link('/kayitlar', 'Decision Log', 'Decisions, rules and open issues of the plant'),
          ],
        },
      ],
    },
  ],
}

const area = (key: AreaKey, title: string, home: string, module: Module | undefined, nav: NavNode[]): Area => ({
  key,
  title,
  subtitle: 'Production Portal',
  home,
  module,
  nav,
})

/** Board görünümünün menüsü (board kullanıcısında her sayfada bu). */
export const BOARD_AREA: Area = area('board', 'Board', '/board', 'kpi', [
  link('/board', 'Board Dashboard', 'Group, company, plant — results and trends'),
  link('/kpi/monthly/dashboard', 'KPI monthly', 'A3 page, 12 months'),
  link('/kpi/weekly/dashboard', 'KPI weekly', 'A3 page, 13 weeks'),
  link('/oee', 'OEE', 'Monthly, weeks and shifts'),
])

/** Modül değiştiricideki sıra: portalın modülleri. */
export const MODULE_AREAS: Area[] = [
  PLANNING,
  area('oee', 'OEE', '/oee', 'oee', [
    link('/oee', 'Dashboard', 'Monthly, 10 weeks and the selected week'),
    link('/oee/losses', 'Losses Trend', 'Losses, dies, breakdowns and setups'),
    {
      label: 'Menu',
      children: [
        link('/oee/data', 'Data', 'The uploaded sheets, as in the file'),
        link('/oee/settings', 'Settings', 'Departments, shifts, loss groups, setups'),
        link('/oee/guide', 'How to use', 'First setup and routine uploads'),
      ],
    },
  ]),
  area('die', 'Die Follow-up', '/die-followup', 'die', [
    link('/die-followup', 'Overview'),
    link('/die-followup/problems', 'Problems', 'Report, solve, history'),
    link('/die-followup/maintenance', 'Maintenance', 'Ready flag, bookings, shot limits'),
    link('/die-followup/reports', 'Reports', 'Pareto by die, problem, operation'),
  ]),
  area('machine', 'Machine Follow-up', '/machine-followup', 'machine', [
    link('/machine-followup', 'Overview'),
    link('/machine-followup/breakdowns', 'Breakdowns', 'Report, solve, history'),
    link('/machine-followup/maintenance', 'Maintenance', 'Planned work center maintenance'),
    link('/machine-followup/reports', 'Reports', 'Pareto by work center and problem'),
  ]),
  area('kpi', 'KPI', '/kpi', 'kpi', [
    link('/kpi', 'Overview'),
    {
      label: 'Menu',
      children: [
        {
          label: 'Monthly',
          hint: 'Plan and actual per cost center and month',
          children: [link('/kpi/monthly/entry', 'Entry', 'Plan and actual per cost center'), link('/kpi/monthly/dashboard', 'Dashboard', 'A3 page, 12 months')],
        },
        {
          label: 'Weekly',
          hint: 'Plan and actual per cost center and week',
          children: [link('/kpi/weekly/entry', 'Entry', 'Plan and actual per cost center'), link('/kpi/weekly/dashboard', 'Dashboard', 'A3 page, 13 weeks')],
        },
      ],
    },
  ]),
  { ...BOARD_AREA, nav: [BOARD_AREA.nav[0]] },
]

export const PORTAL_AREA: Area = { ...area('portal', 'Production Portal', '/', undefined, []), subtitle: 'Planning · OEE · Dies · Machines · KPI' }
export const SETTINGS_AREA: Area = area('settings', 'Company settings', '/settings', undefined, [])
export const ADMIN_AREA: Area = area('admin', 'Administration', '/admin', undefined, [])

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`)

/** Yolun alanı: menü, başlık ve modül değiştiricideki seçili modül buradan. */
export function areaFor(pathname: string): Area {
  if (pathname === '/' || under(pathname, '/account') || under(pathname, '/tani') || under(pathname, '/compare')) return PORTAL_AREA
  if (under(pathname, '/admin')) return ADMIN_AREA
  if (under(pathname, '/settings') || under(pathname, '/users')) return SETTINGS_AREA
  if (under(pathname, '/board')) return BOARD_AREA
  for (const a of MODULE_AREAS) if (a.key !== 'planning' && a.key !== 'board' && under(pathname, a.home)) return a
  return PLANNING
}

/** Bir düğümün altındaki bütün bağlantılar. */
export function linksOf(nodes: NavNode[]): NavItem[] {
  return nodes.flatMap((n) => [...(n.to ? [{ to: n.to, label: n.label, hint: n.hint }] : []), ...linksOf(n.children ?? [])])
}

/** Bir alanın bütün bağlantıları. */
export function areaLinks(a: Area): NavItem[] {
  return linksOf(a.nav)
}

/** Düğüm (ya da altındakilerden biri) bu sayfa mı? */
export function nodeHas(node: NavNode, pathname: string): boolean {
  return node.to === pathname || (node.children ?? []).some((c) => nodeHas(c, pathname))
}

/**
 * Sayfalar arası kısayollar (sayfa başlığındaki küçük düğmeler). Etiketler
 * menüdeki adlardan gelir; menüde adı değişen sayfa burada da değişir.
 */
const RELATED_PAGES: Record<string, string[]> = {
  '/planlama': ['/capacity', '/takvim', '/alarms', '/hammadde', '/planlogic'],
  '/planningexpert': ['/planlama', '/capacity', '/alarms', '/sapdata'],
  '/capacity': ['/takvim', '/planlama', '/makineler', '/referanslar'],
  '/hammadde': ['/sapdata', '/depolar', '/referanslar', '/takvim'],
  '/alarms': ['/planlama', '/capacity', '/die-followup/maintenance', '/machine-followup/breakdowns'],
  '/sapdata': ['/siparisler', '/stoklar', '/gerceklesen', '/depolar'],
  '/planlogic': ['/planlama', '/capacity', '/takvim', '/hammadde'],
  '/siparisler': ['/sapdata', '/planlama', '/capacity'],
  '/stoklar': ['/sapdata', '/depolar', '/hammadde'],
  '/gerceklesen': ['/sapdata', '/performans', '/depolar'],
  '/referanslar': ['/makineler', '/planlama', '/capacity'],
  '/makineler': ['/takvim', '/capacity', '/referanslar'],
  '/takvim': ['/capacity', '/makineler', '/planlama'],
  '/depolar': ['/stoklar', '/hammadde', '/sapdata'],
  '/performans': ['/gerceklesen', '/planlama', '/takvim'],
}

const EXTRA_LABELS: Record<string, string> = {
  '/die-followup/maintenance': 'Die Maintenance',
  '/machine-followup/breakdowns': 'Machine Breakdowns',
}

export function pageLabel(to: string): string {
  return areaLinks(PLANNING).find((i) => i.to === to)?.label ?? EXTRA_LABELS[to] ?? to
}

/** Bir sayfanın kısayolları: { to, label }. */
export function relatedPages(path: string): { to: string; label: string }[] {
  return (RELATED_PAGES[path] ?? []).map((to) => ({ to, label: pageLabel(to) }))
}
