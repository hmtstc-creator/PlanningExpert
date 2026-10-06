// Menünün tek tanımı: üst çubuk, telefon çekmecesi ve modül değiştirici aynı
// listeden okur, ikisi birbirinden kopamaz.
//
// Yapı: portal → alan (modül ya da ayarlar) → alanın menüsü. Her alanın
// başlığı, ana sayfası ve menüsü burada; hangi alanda olunduğu yoldan çıkar.
// Yönetim iki ayrı alandır: Company settings (creator: kendi şirketi) ve
// Administration (General: holding, şirket, platform). Modül menülerinde
// yönetim yoktur; kullanıcı menüsünden açılır.

import type { Module } from './tenancy'

/**
 * Menü ikonları (anahtar → src/components/nav/NavIcon.tsx). Liste burada:
 * menü verisi React'tan bağımsız kalsın, ikon haritası da eksiksiz olsun
 * (tip denetimi).
 */
export const ICON_KEYS = [
  'home', 'gantt', 'dashboard', 'grid', 'chart', 'gauge', 'layers', 'siren', 'trending', 'database', 'upload', 'clipboard',
  'boxes', 'check', 'package', 'factory', 'calendar', 'calendarRange', 'warehouse', 'book', 'scroll', 'activity', 'chartDown',
  'sheet', 'settings', 'anvil', 'alert', 'wrench', 'pareto', 'cog', 'zap', 'target', 'pencil', 'presentation', 'building',
  'users', 'shield', 'user', 'wifi', 'compare', 'trendDown',
] as const
export type IconKey = (typeof ICON_KEYS)[number]

/** Modül rengi (src/components/nav/NavIcon.tsx → ACCENTS). */
export type AccentKey = 'indigo' | 'emerald' | 'amber' | 'rose' | 'violet' | 'sky' | 'slate'

export interface NavItem {
  to: string
  label: string
  /** Açılan menüde ve telefon çekmecesinde bir satırlık açıklama. */
  hint?: string
  icon?: IconKey
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
  icon?: IconKey
  children?: NavNode[]
}

export type AreaKey = 'portal' | 'planning' | 'oee' | 'die' | 'machine' | 'kpi' | 'board' | 'settings' | 'admin'

export interface Area {
  key: AreaKey
  title: string
  /** Modül şeridinde kısa ad. */
  short: string
  /** Logonun altında küçük satır. */
  subtitle: string
  home: string
  icon: IconKey
  accent: AccentKey
  /** İzin modülü (src/lib/tenancy.ts); yoksa modül değil (portal, ayarlar). */
  module?: Module
  /** Çubuğun menüsü (ağaç). */
  nav: NavNode[]
}

const link = (to: string, label: string, hint?: string, icon?: IconKey): NavNode => ({ to, label, hint, icon })

const PLANNING: Area = {
  key: 'planning',
  title: 'PlanningExpert',
  short: 'Planning',
  subtitle: 'Production planning',
  home: '/planningexpert',
  icon: 'gantt',
  accent: 'indigo',
  module: 'planning',
  nav: [
    link('/planlama', 'Plan', 'The weekly production plan', 'gantt'),
    link('/planningexpert', 'Overview', 'Daily status and warnings', 'dashboard'),
    {
      label: 'Menu',
      icon: 'grid',
      children: [
        {
          label: 'Analysis',
          hint: 'Capacity, raw material, alarms, performance',
          icon: 'chart',
          children: [
            link('/capacity', 'Capacity Dashboard', 'Weekly capacity vs demand by work center group', 'gauge'),
            link('/hammadde', 'Raw Material Coverage', 'Steel requirement and orders per week', 'layers'),
            link('/alarms', 'Alarms', 'Dies and machines that hold up the plan', 'siren'),
            link('/performans', 'Performance', 'Plan versus actual', 'trending'),
          ],
        },
        {
          label: 'SAP data',
          hint: 'Uploads and what they contain',
          icon: 'database',
          children: [
            link('/sapdata', 'SAP Data', 'Upload ZPP, ZPP_DAILY, MB52 and MB51', 'upload'),
            link('/siparisler', 'Demand', 'Weekly and daily net requirements', 'clipboard'),
            link('/stoklar', 'Stock', 'Stock by material and location', 'boxes'),
            link('/gerceklesen', 'Actuals', 'Posted production movements', 'check'),
          ],
        },
        {
          label: 'Master data',
          hint: 'Parts, work centers, calendar, locations',
          icon: 'package',
          children: [
            link('/referanslar', 'Master Data', 'Cavities, SPM, weights, machines', 'package'),
            link('/makineler', 'Work Centers', 'Cost center, hall, category, coil feed', 'factory'),
            link('/takvim', 'Work Calendar', 'Shifts, stops, capacity', 'calendar'),
            link('/depolar', 'Storage Locations', 'Which stock counts', 'warehouse'),
          ],
        },
        {
          label: 'Help',
          hint: 'How the plan works, decisions of the plant',
          icon: 'book',
          children: [
            link('/planlogic', 'Planning Logic', 'How the plan is calculated', 'book'),
            link('/kayitlar', 'Decision Log', 'Decisions, rules and open issues of the plant', 'scroll'),
          ],
        },
      ],
    },
  ],
}

const area = (key: AreaKey, title: string, short: string, home: string, icon: IconKey, accent: AccentKey, module: Module | undefined, nav: NavNode[]): Area => ({
  key,
  title,
  short,
  subtitle: 'Production Portal',
  home,
  icon,
  accent,
  module,
  nav,
})

/** Board görünümünün menüsü (board kullanıcısında her sayfada bu). */
export const BOARD_AREA: Area = area('board', 'Board', 'Board', '/board', 'presentation', 'sky', 'kpi', [
  link('/board', 'Board Dashboard', 'Group, company, plant — results and trends', 'presentation'),
  link('/kpi/monthly/dashboard', 'KPI monthly', 'A3 page, 12 months', 'chart'),
  link('/kpi/weekly/dashboard', 'KPI weekly', 'A3 page, 13 weeks', 'chart'),
  link('/oee', 'OEE', 'Monthly, weeks and shifts', 'activity'),
])

/** Modül değiştiricideki sıra: portalın modülleri. */
export const MODULE_AREAS: Area[] = [
  PLANNING,
  area('oee', 'OEE', 'OEE', '/oee', 'activity', 'emerald', 'oee', [
    link('/oee', 'Dashboard', 'Monthly, 10 weeks and the selected week', 'dashboard'),
    link('/oee/losses', 'Losses Trend', 'Losses, dies, breakdowns and setups', 'trendDown'),
    link('/oee/bridge', 'Loss Bridge', 'From calendar time to OEE, loss by loss — priorities', 'chartDown'),
    {
      label: 'Menu',
      icon: 'grid',
      children: [
        link('/oee/data', 'Data', 'The uploaded sheets, as in the file', 'sheet'),
        link('/oee/settings', 'Settings', 'Departments, shifts, loss groups, setups', 'settings'),
        link('/oee/guide', 'How to use', 'First setup and routine uploads', 'book'),
      ],
    },
  ]),
  area('die', 'Die Follow-up', 'Dies', '/die-followup', 'anvil', 'amber', 'die', [
    link('/die-followup', 'Overview', 'Open problems, readiness, shot limits', 'dashboard'),
    link('/die-followup/problems', 'Problems', 'Report, solve, history', 'alert'),
    link('/die-followup/maintenance', 'Maintenance', 'Ready flag, bookings, shot limits', 'wrench'),
    link('/die-followup/reports', 'Reports', 'Pareto by die, problem, operation', 'pareto'),
  ]),
  area('machine', 'Machine Follow-up', 'Machines', '/machine-followup', 'cog', 'rose', 'machine', [
    link('/machine-followup', 'Overview', 'Stopped machines and open breakdowns', 'dashboard'),
    link('/machine-followup/breakdowns', 'Breakdowns', 'Report, solve, history', 'zap'),
    link('/machine-followup/maintenance', 'Maintenance', 'Planned work center maintenance', 'wrench'),
    link('/machine-followup/reports', 'Reports', 'Pareto by work center and problem', 'pareto'),
  ]),
  area('kpi', 'KPI', 'KPI', '/kpi', 'target', 'violet', 'kpi', [
    link('/kpi', 'Overview', 'Monthly and weekly KPIs at a glance', 'dashboard'),
    {
      label: 'Menu',
      icon: 'grid',
      children: [
        {
          label: 'Monthly',
          hint: 'Plan and actual per cost center and month',
          icon: 'calendar',
          children: [
            link('/kpi/monthly/entry', 'Entry', 'Plan and actual per cost center', 'pencil'),
            link('/kpi/monthly/dashboard', 'Dashboard', 'A3 page, 12 months', 'chart'),
          ],
        },
        {
          label: 'Weekly',
          hint: 'Plan and actual per cost center and week',
          icon: 'calendarRange',
          children: [
            link('/kpi/weekly/entry', 'Entry', 'Plan and actual per cost center', 'pencil'),
            link('/kpi/weekly/dashboard', 'Dashboard', 'A3 page, 13 weeks', 'chart'),
          ],
        },
      ],
    },
  ]),
  { ...BOARD_AREA, nav: [BOARD_AREA.nav[0]] },
]

export const PORTAL_AREA: Area = {
  ...area('portal', 'Production Portal', 'Portal', '/', 'home', 'sky', undefined, []),
  subtitle: 'Planning · OEE · Dies · Machines · KPI',
}
export const SETTINGS_AREA: Area = area('settings', 'Company settings', 'Settings', '/settings', 'building', 'slate', undefined, [
  link('/settings', 'Company settings', 'Plants, departments, cost centers, lists', 'building'),
  link('/users', 'Users & permissions', 'Groups, users, permission matrix', 'users'),
])
export const ADMIN_AREA: Area = area('admin', 'Administration', 'Admin', '/admin', 'shield', 'slate', undefined, [])

/** Hesap ve yönetim bağlantıları (kullanıcı menüsü, çekmece, arama). */
export const ACCOUNT_LINKS: (NavItem & { need?: 'manage' | 'platform' })[] = [
  { to: '/account', label: 'My account', hint: 'Password, devices, who you are', icon: 'user' },
  { to: '/settings', label: 'Company settings', hint: 'Plants, departments, cost centers, lists', icon: 'building', need: 'manage' },
  { to: '/users', label: 'Users & permissions', hint: 'Groups, users, permission matrix', icon: 'users', need: 'manage' },
  { to: '/admin', label: 'Administration', hint: 'Holdings, companies, Generals, security', icon: 'shield', need: 'platform' },
  { to: '/compare', label: 'Compare plants', hint: 'Plants side by side', icon: 'compare' },
  { to: '/tani', label: 'Connection diagnostics', hint: 'Is this device connected?', icon: 'wifi' },
]

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
  return nodes.flatMap((n) => [...(n.to ? [{ to: n.to, label: n.label, hint: n.hint, icon: n.icon }] : []), ...linksOf(n.children ?? [])])
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
 * Sayfalar arası kısayollar (sayfa başlığındaki küçük düğmeler): her sayfanın
 * iş akışında yanındaki sayfalar — modül sınırı tanımaz (ör. Die Problems →
 * OEE Losses). Kullanıcının açamayacağı sayfa düğmede görünmez
 * (PageLinks). Yeni sayfa eklenince buraya da eklenir; test hedeflerin
 * varlığını denetler (navigation.test.ts).
 */
const RELATED_PAGES: Record<string, string[]> = {
  // PlanningExpert
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
  '/referanslar': ['/makineler', '/planlama', '/capacity', '/die-followup/maintenance'],
  '/makineler': ['/takvim', '/capacity', '/referanslar', '/settings'],
  '/takvim': ['/capacity', '/makineler', '/planlama', '/machine-followup/maintenance'],
  '/depolar': ['/stoklar', '/hammadde', '/sapdata'],
  '/performans': ['/gerceklesen', '/planlama', '/takvim', '/oee'],
  '/kayitlar': ['/planlama', '/planlogic', '/settings'],
  // OEE
  '/oee': ['/oee/losses', '/oee/bridge', '/oee/data', '/kpi/monthly/dashboard', '/machine-followup/breakdowns'],
  '/oee/losses': ['/oee', '/oee/bridge', '/machine-followup/breakdowns', '/die-followup/problems', '/oee/data'],
  '/oee/bridge': ['/oee', '/oee/losses', '/die-followup/problems', '/machine-followup/breakdowns', '/oee/settings'],
  '/oee/data': ['/oee', '/oee/settings', '/oee/guide'],
  '/oee/settings': ['/settings', '/oee/data', '/oee/guide', '/makineler'],
  '/oee/guide': ['/oee/settings', '/oee/data', '/oee'],
  // Die Follow-up
  '/die-followup': ['/die-followup/problems', '/die-followup/maintenance', '/alarms', '/referanslar'],
  '/die-followup/problems': ['/die-followup/reports', '/die-followup/maintenance', '/oee/losses'],
  '/die-followup/maintenance': ['/alarms', '/planlama', '/referanslar', '/die-followup/problems'],
  '/die-followup/reports': ['/die-followup/problems', '/oee/losses'],
  // Machine Follow-up
  '/machine-followup': ['/machine-followup/breakdowns', '/machine-followup/maintenance', '/alarms', '/makineler'],
  '/machine-followup/breakdowns': ['/machine-followup/reports', '/machine-followup/maintenance', '/oee/losses', '/planlama'],
  '/machine-followup/maintenance': ['/takvim', '/planlama', '/machine-followup/breakdowns', '/makineler'],
  '/machine-followup/reports': ['/machine-followup/breakdowns', '/oee/losses'],
  // KPI ve Board
  '/kpi': ['/kpi/monthly/entry', '/kpi/weekly/entry', '/oee', '/settings'],
  '/kpi/monthly/entry': ['/kpi/monthly/dashboard', '/oee', '/settings'],
  '/kpi/weekly/entry': ['/kpi/weekly/dashboard', '/oee', '/settings'],
  '/kpi/monthly/dashboard': ['/kpi/monthly/entry', '/kpi/weekly/dashboard', '/oee', '/board'],
  '/kpi/weekly/dashboard': ['/kpi/weekly/entry', '/kpi/monthly/dashboard', '/oee', '/board'],
  '/board': ['/kpi/monthly/dashboard', '/kpi/weekly/dashboard', '/oee'],
  // Yönetim
  '/settings': ['/users', '/makineler', '/oee/settings'],
  '/users': ['/settings'],
}

/**
 * Modül dışından bakınca da anlaşılan adlar ("Dashboard" değil "OEE
 * Dashboard"). Yoksa menüdeki ad.
 */
const LABELS: Record<string, string> = {
  '/oee': 'OEE Dashboard',
  '/oee/losses': 'OEE Losses',
  '/oee/bridge': 'OEE Loss Bridge',
  '/oee/data': 'OEE Data',
  '/oee/settings': 'OEE Settings',
  '/oee/guide': 'OEE Guide',
  '/die-followup': 'Die Follow-up',
  '/die-followup/problems': 'Die Problems',
  '/die-followup/maintenance': 'Die Maintenance',
  '/die-followup/reports': 'Die Reports',
  '/machine-followup': 'Machine Follow-up',
  '/machine-followup/breakdowns': 'Machine Breakdowns',
  '/machine-followup/maintenance': 'Machine Maintenance',
  '/machine-followup/reports': 'Machine Reports',
  '/kpi': 'KPI Overview',
  '/kpi/monthly/entry': 'KPI Monthly Entry',
  '/kpi/weekly/entry': 'KPI Weekly Entry',
  '/kpi/monthly/dashboard': 'KPI Monthly',
  '/kpi/weekly/dashboard': 'KPI Weekly',
  '/board': 'Board Dashboard',
  '/settings': 'Company settings',
  '/users': 'Users & permissions',
}

export function pageLabel(to: string): string {
  return LABELS[to] ?? areaLinks(PLANNING).find((i) => i.to === to)?.label ?? to
}

/** Bir sayfanın kısayolları: { to, label }. */
export function relatedPages(path: string): { to: string; label: string }[] {
  return (RELATED_PAGES[path] ?? []).map((to) => ({ to, label: pageLabel(to) }))
}

/** Test için: kısayol haritası. */
export const RELATED_PAGE_MAP: Readonly<Record<string, readonly string[]>> = RELATED_PAGES
