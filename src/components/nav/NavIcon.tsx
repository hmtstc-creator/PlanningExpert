import {
  Activity,
  Anvil,
  ArrowLeftRight,
  BookOpen,
  Boxes,
  Building2,
  CalendarDays,
  CalendarRange,
  ChartColumn,
  ChartColumnDecreasing,
  ChartGantt,
  ChartNoAxesColumn,
  CircleCheck,
  ClipboardList,
  Cog,
  Database,
  Factory,
  FileSpreadsheet,
  Gauge,
  House,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  Package,
  PencilLine,
  Presentation,
  ScrollText,
  Settings2,
  ShieldCheck,
  Siren,
  Target,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Upload,
  UserRound,
  Users,
  Warehouse,
  Wifi,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'

import type { AccentKey, IconKey } from '../../lib/navigation'

/** Menü ikonları: anahtar listesi src/lib/navigation.ts → ICON_KEYS (eksik kalırsa tip hatası). */
export const ICONS: Record<IconKey, LucideIcon> = {
  home: House,
  gantt: ChartGantt,
  dashboard: LayoutDashboard,
  grid: LayoutGrid,
  chart: ChartColumn,
  gauge: Gauge,
  layers: Layers,
  siren: Siren,
  trending: TrendingUp,
  database: Database,
  upload: Upload,
  clipboard: ClipboardList,
  boxes: Boxes,
  check: CircleCheck,
  package: Package,
  factory: Factory,
  calendar: CalendarDays,
  calendarRange: CalendarRange,
  warehouse: Warehouse,
  book: BookOpen,
  scroll: ScrollText,
  activity: Activity,
  chartDown: ChartColumnDecreasing,
  sheet: FileSpreadsheet,
  settings: Settings2,
  anvil: Anvil,
  alert: TriangleAlert,
  wrench: Wrench,
  pareto: ChartNoAxesColumn,
  cog: Cog,
  zap: Zap,
  target: Target,
  pencil: PencilLine,
  presentation: Presentation,
  building: Building2,
  users: Users,
  shield: ShieldCheck,
  user: UserRound,
  wifi: Wifi,
  compare: ArrowLeftRight,
  trendDown: TrendingDown,
}

export function NavIcon({ icon, className = 'h-4 w-4' }: { icon: IconKey | undefined; className?: string }) {
  const Icon = ICONS[icon ?? 'grid']
  return <Icon className={className} aria-hidden />
}

/**
 * Modül renkleri. Tailwind sınıfları tam yazılır (derleyici dinamik sınıf
 * adını görmez). `tile`: renkli ikon karesi; `soft`: açık zemin + renkli
 * ikon; `text`: vurgu yazısı; `bar`: ince renk şeridi; `ring`: seçili çerçeve.
 */
export const ACCENTS: Record<AccentKey, { tile: string; soft: string; text: string; bar: string; ring: string; dot: string }> = {
  indigo: {
    tile: 'bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-indigo-500/30',
    soft: 'bg-indigo-50 text-indigo-600',
    text: 'text-indigo-600',
    bar: 'from-indigo-500 to-blue-500',
    ring: 'ring-indigo-200 bg-indigo-50/60',
    dot: 'bg-indigo-500',
  },
  emerald: {
    tile: 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-emerald-500/30',
    soft: 'bg-emerald-50 text-emerald-600',
    text: 'text-emerald-600',
    bar: 'from-emerald-500 to-teal-500',
    ring: 'ring-emerald-200 bg-emerald-50/60',
    dot: 'bg-emerald-500',
  },
  amber: {
    tile: 'bg-gradient-to-br from-amber-400 to-orange-600 text-white shadow-amber-500/30',
    soft: 'bg-amber-50 text-amber-600',
    text: 'text-amber-600',
    bar: 'from-amber-400 to-orange-500',
    ring: 'ring-amber-200 bg-amber-50/60',
    dot: 'bg-amber-500',
  },
  rose: {
    tile: 'bg-gradient-to-br from-rose-500 to-red-600 text-white shadow-rose-500/30',
    soft: 'bg-rose-50 text-rose-600',
    text: 'text-rose-600',
    bar: 'from-rose-500 to-red-500',
    ring: 'ring-rose-200 bg-rose-50/60',
    dot: 'bg-rose-500',
  },
  violet: {
    tile: 'bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-violet-500/30',
    soft: 'bg-violet-50 text-violet-600',
    text: 'text-violet-600',
    bar: 'from-violet-500 to-fuchsia-500',
    ring: 'ring-violet-200 bg-violet-50/60',
    dot: 'bg-violet-500',
  },
  sky: {
    tile: 'bg-gradient-to-br from-sky-400 to-cyan-600 text-white shadow-sky-500/30',
    soft: 'bg-sky-50 text-sky-600',
    text: 'text-sky-600',
    bar: 'from-sky-400 to-cyan-500',
    ring: 'ring-sky-200 bg-sky-50/60',
    dot: 'bg-sky-500',
  },
  slate: {
    tile: 'bg-gradient-to-br from-slate-600 to-slate-800 text-white shadow-slate-500/30',
    soft: 'bg-slate-100 text-slate-600',
    text: 'text-slate-700',
    bar: 'from-slate-500 to-slate-700',
    ring: 'ring-slate-200 bg-slate-50',
    dot: 'bg-slate-500',
  },
}

/** Renkli ikon karesi (modül kimliği). */
export function IconTile({ icon, accent, size = 'md' }: { icon: IconKey; accent: AccentKey; size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-12 w-12 rounded-2xl' : size === 'md' ? 'h-9 w-9 rounded-xl' : 'h-7 w-7 rounded-lg'
  const ico = size === 'lg' ? 'h-6 w-6' : size === 'md' ? 'h-[18px] w-[18px]' : 'h-4 w-4'
  return (
    <span className={`grid shrink-0 place-items-center shadow-md ${box} ${ACCENTS[accent].tile}`}>
      <NavIcon icon={icon} className={ico} />
    </span>
  )
}

/** Klavye tuşu. */
export function Kbd({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <kbd
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 font-sans text-[10px] font-medium ${
        dark ? 'border-white/20 bg-white/10 text-white/70' : 'border-border bg-muted text-muted-foreground'
      }`}
    >
      {children}
    </kbd>
  )
}
