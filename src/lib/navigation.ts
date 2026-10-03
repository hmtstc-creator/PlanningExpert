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

export interface NavGroup {
  label: string
  items: NavItem[]
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
  /** Çubukta doğrudan görünen bağlantılar. */
  primary: NavItem[]
  /** Açılan gruplar (yalnızca PlanningExpert'te). */
  groups: NavGroup[]
}

const PLANNING: Area = {
  key: 'planning',
  title: 'PlanningExpert',
  subtitle: 'Production planning',
  home: '/planningexpert',
  module: 'planning',
  primary: [
    { to: '/planlama', label: 'Plan', hint: 'The weekly production plan' },
    { to: '/planningexpert', label: 'Overview', hint: 'Daily status and warnings' },
  ],
  groups: [
    {
      label: 'Planning',
      items: [
        { to: '/capacity', label: 'Capacity Dashboard', hint: 'Weekly capacity vs demand by work center group' },
        { to: '/hammadde', label: 'Raw Material Coverage', hint: 'Steel requirement and orders per week up to the last ZPP week' },
        { to: '/alarms', label: 'Alarms', hint: 'Dies and machines that hold up the plan' },
        { to: '/performans', label: 'Performance', hint: 'Plan versus actual' },
        { to: '/planlogic', label: 'Planning Logic', hint: 'How the plan is calculated' },
        { to: '/kayitlar', label: 'Decision Log', hint: 'Decisions, rules and open issues of the plant' },
      ],
    },
    {
      label: 'Data',
      items: [
        { to: '/sapdata', label: 'SAP Data', hint: 'Upload ZPP, ZPP_DAILY, MB52 and MB51' },
        { to: '/siparisler', label: 'Demand', hint: 'Weekly and daily net requirements' },
        { to: '/stoklar', label: 'Stock', hint: 'Stock by material and location' },
        { to: '/gerceklesen', label: 'Actuals', hint: 'Posted production movements' },
        { to: '/referanslar', label: 'Master Data', hint: 'Cavities, SPM, weights, machines' },
      ],
    },
    {
      label: 'Shop floor',
      items: [
        { to: '/makineler', label: 'Work Centers', hint: 'Cost center, hall, category, coil feed' },
        { to: '/takvim', label: 'Work Calendar', hint: 'Shifts, stops, capacity' },
        { to: '/depolar', label: 'Storage Locations', hint: 'Which stock counts' },
      ],
    },
  ],
}

const flat = (key: AreaKey, title: string, home: string, module: Module | undefined, primary: NavItem[]): Area => ({
  key,
  title,
  subtitle: 'Production Portal',
  home,
  module,
  primary,
  groups: [],
})

/** Board görünümünün menüsü (board kullanıcısında her sayfada bu). */
export const BOARD_AREA: Area = flat('board', 'Board', '/board', 'kpi', [
  { to: '/board', label: 'Board Dashboard', hint: 'Group, company, plant — results and trends' },
  { to: '/kpi/monthly/dashboard', label: 'KPI monthly', hint: 'A3 page, 12 months' },
  { to: '/kpi/weekly/dashboard', label: 'KPI weekly', hint: 'A3 page, 13 weeks' },
  { to: '/oee', label: 'OEE', hint: 'Monthly, weeks and shifts' },
])

/** Modül değiştiricideki sıra: portalın modülleri. */
export const MODULE_AREAS: Area[] = [
  PLANNING,
  flat('oee', 'OEE', '/oee', 'oee', [
    { to: '/oee', label: 'Dashboard', hint: 'Monthly, 10 weeks and the selected week' },
    { to: '/oee/losses', label: 'Losses Trend', hint: 'Losses, dies, breakdowns and setups' },
    { to: '/oee/data', label: 'Data', hint: 'The uploaded sheets, as in the file' },
    { to: '/oee/settings', label: 'Settings', hint: 'Areas, cost centers, shifts, loss groups, setups' },
    { to: '/oee/guide', label: 'How to use', hint: 'First setup and routine uploads' },
  ]),
  flat('die', 'Die Follow-up', '/die-followup', 'die', [
    { to: '/die-followup', label: 'Overview' },
    { to: '/die-followup/problems', label: 'Problems', hint: 'Report, solve, history' },
    { to: '/die-followup/maintenance', label: 'Maintenance & readiness', hint: 'Ready flag, bookings, shot limits' },
    { to: '/die-followup/reports', label: 'Reports', hint: 'Pareto by die, problem, operation' },
  ]),
  flat('machine', 'Machine Follow-up', '/machine-followup', 'machine', [
    { to: '/machine-followup', label: 'Overview' },
    { to: '/machine-followup/breakdowns', label: 'Breakdowns', hint: 'Report, solve, history' },
    { to: '/machine-followup/maintenance', label: 'Maintenance', hint: 'Planned work center maintenance' },
    { to: '/machine-followup/reports', label: 'Reports', hint: 'Pareto by work center and problem' },
  ]),
  flat('kpi', 'KPI', '/kpi', 'kpi', [
    { to: '/kpi', label: 'Overview' },
    { to: '/kpi/monthly/entry', label: 'Monthly entry', hint: 'Plan and actual per cost center and month' },
    { to: '/kpi/monthly/dashboard', label: 'Monthly dashboard', hint: 'A3 page, 12 months' },
    { to: '/kpi/weekly/entry', label: 'Weekly entry', hint: 'Plan and actual per cost center and week' },
    { to: '/kpi/weekly/dashboard', label: 'Weekly dashboard', hint: 'A3 page, 13 weeks' },
  ]),
  { ...BOARD_AREA, primary: [BOARD_AREA.primary[0]] },
]

export const PORTAL_AREA: Area = { ...flat('portal', 'Production Portal', '/', undefined, []), subtitle: 'Planning · OEE · Dies · Machines · KPI' }
export const SETTINGS_AREA: Area = flat('settings', 'Company settings', '/settings', undefined, [])
export const ADMIN_AREA: Area = flat('admin', 'Administration', '/admin', undefined, [])

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`)

/** Yolun alanı: menü, başlık ve modül değiştiricideki seçili modül buradan. */
export function areaFor(pathname: string): Area {
  if (pathname === '/' || under(pathname, '/account') || under(pathname, '/tani') || under(pathname, '/compare')) return PORTAL_AREA
  if (under(pathname, '/admin')) return ADMIN_AREA
  if (under(pathname, '/settings')) return SETTINGS_AREA
  if (under(pathname, '/board')) return BOARD_AREA
  for (const a of MODULE_AREAS) if (a.key !== 'planning' && a.key !== 'board' && under(pathname, a.home)) return a
  return PLANNING
}

/** Bir alanın bütün bağlantıları (telefon çekmecesi ve etkin grup için). */
export function areaLinks(area: Area): NavItem[] {
  return [...area.primary, ...area.groups.flatMap((g) => g.items)]
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
