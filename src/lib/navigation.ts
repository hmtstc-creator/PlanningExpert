// Single definition of the navigation, shared by the desktop bar and the
// mobile drawer so the two can never drift apart.
//
// Grouping follows how the work is actually done rather than the order the
// pages were built: the plan is the destination, data feeds it, the shop
// floor definitions constrain it, and analysis checks it afterwards.

export interface NavItem {
  to: string
  label: string
  /** Shown in the mobile drawer, where there is room for a line of context. */
  hint?: string
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

/** Always visible, never inside a menu — these are the daily destinations. */
export const PRIMARY_LINKS: NavItem[] = [
  { to: '/planlama', label: 'Plan', hint: 'The weekly production plan' },
  { to: '/planningexpert', label: 'Overview', hint: 'Daily status and warnings' },
]

/** Planlama başlığının geri kalanı: veri girişi ve motorun açıklaması. */
export const PLANNING_LINKS: NavItem[] = [
  { to: '/sapdata', label: 'SAP Data', hint: 'Upload ZPP, ZPP_DAILY, MB52 and MB51' },
  { to: '/planlogic', label: 'Planning Logic', hint: 'How the plan is calculated' },
]

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Planning',
    items: [{ to: '/planlama', label: 'Production Plan', hint: 'The weekly production plan' }, ...PLANNING_LINKS],
  },
  {
    label: 'Data',
    items: [
      { to: '/siparisler', label: 'Demand', hint: 'Weekly and daily net requirements' },
      { to: '/stoklar', label: 'Stock', hint: 'Stock by material and location' },
      { to: '/gerceklesen', label: 'Actuals', hint: 'Posted production movements' },
      { to: '/referanslar', label: 'Master Data', hint: 'Cavities, SPM, weights, machines' },
    ],
  },
  {
    label: 'Shop floor',
    items: [
      { to: '/makineler', label: 'Presses', hint: 'Halls, categories, tonnage' },
      { to: '/takvim', label: 'Work Calendar', hint: 'Shifts, stops, capacity' },
      { to: '/depolar', label: 'Storage Locations', hint: 'Which stock counts' },
    ],
  },
  {
    label: 'Maintenance',
    items: [
      { to: '/presbakim', label: 'Press Maintenance', hint: 'Which press is down, and when' },
      { to: '/kaliplar', label: 'Mold Maintenance', hint: 'Readiness, bookings, shot limits' },
      { to: '/kalipproblem', label: 'Mold Problems', hint: 'Report, solve, and report on faults' },
    ],
  },
  {
    label: 'Analysis',
    items: [
      { to: '/performans', label: 'Performance', hint: 'Plan versus actual' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/yonetim', label: 'Admin', hint: 'Users, lists, who changed what' },
      { to: '/kayitlar', label: 'Change Log', hint: 'Decisions and rules' },
      { to: '/tani', label: 'Connection Diagnostics', hint: 'Is this device connected?' },
    ],
  },
]

/** Every route in the navigation, for the mobile drawer's flat rendering. */
export const ALL_GROUPS: NavGroup[] = [
  { label: 'Planning', items: [...PRIMARY_LINKS, ...PLANNING_LINKS] },
  ...NAV_GROUPS.filter((group) => group.label !== 'Planning'),
]
