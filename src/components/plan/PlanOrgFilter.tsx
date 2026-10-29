import { useEffect, useMemo, useState, type ReactNode } from 'react'

import {
  NO_ORG_FILTER,
  UNASSIGNED,
  orgFilterActive,
  planOrgOptions,
  pruneOrgSelection,
  visibleWorkCenters,
  type OrgCostCenter,
  type OrgPress,
  type PlanOrgOptions,
  type PlanOrgSelection,
} from '../../lib/planOrgFilter'
import { InfoTip } from '../PageHeader'

/**
 * Süzgeç seçimi oturumlar arası kalır: planlamacı hep aynı bölüme bakar.
 * Her sayfanın kendi anahtarı var — Master Data'da parçaya, plan sayfasında
 * haftaya bakarken aynı seçime zorlanmak istenmiyor.
 */
const STORE_KEY = 'planningexpert.plan.orgFilter'

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

function readStored(key: string): PlanOrgSelection {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return NO_ORG_FILTER
    const parsed = JSON.parse(raw) as Partial<PlanOrgSelection>
    return {
      department: typeof parsed.department === 'string' ? parsed.department : '',
      costCenters: strings(parsed.costCenters),
      workCenters: strings(parsed.workCenters),
    }
  } catch {
    return NO_ORG_FILTER
  }
}

/**
 * Bölüm / masraf yeri / iş yeri süzgecinin durumu. Seçim yalnız görünümü
 * daraltır — plan fabrikanın tamamı için hesaplanır (src/lib/planOrgFilter.ts).
 * `storeKey` verilmezse plan sayfasının anahtarı kullanılır.
 */
export function usePlanOrgFilter(
  presses: OrgPress[],
  costCenters: OrgCostCenter[],
  departments: string[],
  storeKey: string = STORE_KEY,
) {
  const [selection, setSelection] = useState<PlanOrgSelection>(() => readStored(storeKey))
  const options = useMemo(
    () => planOrgOptions(presses, costCenters, departments, selection),
    [presses, costCenters, departments, selection],
  )

  // Tanımlar yüklendikten sonra geçersiz kalan seçimi temizle. Liste henüz
  // boşken (sorgu yükleniyor) dokunulmaz, yoksa saklanan seçim silinir.
  useEffect(() => {
    if (presses.length === 0) return
    const pruned = pruneOrgSelection(selection, options)
    if (pruned !== selection) setSelection(pruned)
  }, [presses.length, options, selection])

  useEffect(() => {
    try {
      window.localStorage.setItem(storeKey, JSON.stringify(selection))
    } catch {
      // Gizli sekmede yazılamaz; süzgeç yine çalışır.
    }
  }, [selection, storeKey])

  const active = orgFilterActive(selection) && presses.length > 0
  const visible = useMemo(
    () => (active ? visibleWorkCenters(presses, costCenters, selection) : null),
    [active, presses, costCenters, selection],
  )

  /** Süzgeç kapalıysa her iş yeri görünür (tanımı silinmiş olan da). */
  const shows = useMemo(() => (visible ? (name: string) => visible.has(name) : () => true), [visible])

  return { selection, setSelection, options, active, shows }
}

const countLabel = (count: number) => `${count} WC`

/**
 * Bölüm → masraf yeri süzgeci (planlamacı isteği: plan sayfası yalnız preslerin
 * listesi değil, bölüm bazında çalışsın). Bölüm tek seçim, masraf yeri çoklu.
 */
export function PlanOrgFilter({
  options,
  selection,
  onChange,
  planned,
  total,
  subject = 'in the plan',
  showWorkCenters = false,
  info,
}: {
  options: PlanOrgOptions
  selection: PlanOrgSelection
  onChange: (next: PlanOrgSelection) => void
  /** Süzgeçten geçen iş yeri sayısı. */
  planned: number
  /** Bütün iş yeri sayısı. */
  total: number
  /** Sayı cümlesinin sonu: "… work centers <subject>". */
  subject?: string
  /** Üçüncü kademe (iş yeri seçimi) gösterilsin mi? */
  showWorkCenters?: boolean
  /** Bölüm kutusunun bilgi balonu; verilmezse plan sayfasının metni. */
  info?: ReactNode
}) {
  const active = orgFilterActive(selection)

  const toggle = (code: string) =>
    onChange({
      ...selection,
      costCenters: selection.costCenters.includes(code)
        ? selection.costCenters.filter((c) => c !== code)
        : [...selection.costCenters, code],
      // Masraf yeri değişince iş yeri seçimi o masraf yerinin dışında kalabilir.
      workCenters: [],
    })

  const toggleWorkCenter = (name: string) =>
    onChange({
      ...selection,
      workCenters: selection.workCenters.includes(name)
        ? selection.workCenters.filter((w) => w !== name)
        : [...selection.workCenters, name],
    })

  return (
    <div className={`mt-4 rounded-lg border p-3 text-sm ${active ? 'border-sky-300 bg-sky-50/60 dark:bg-sky-950/20' : 'border-border'}`}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            Department
            <InfoTip label="About the department filter">
              {info ?? (
                <p>
                  The plan is always computed for the whole plant — capacity, cranes and dies are
                  only correct when every work center is seen together. This filter narrows what
                  you see: the chart, the work center lists, the part list of <b>Add job</b> and the
                  late-job count all follow it.
                </p>
              )}
              <p>
                Departments and cost centers are defined on Company settings, and the link from a
                work center to its cost center on Work Center Definitions.
              </p>
            </InfoTip>
          </span>
          <select
            className="mt-1 w-56 rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={selection.department}
            onChange={(e) => onChange({ department: e.target.value, costCenters: [], workCenters: [] })}
          >
            <option value="">All departments</option>
            {options.departments.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label} · {countLabel(o.count)}
              </option>
            ))}
          </select>
        </label>

        <span className="py-2 text-muted-foreground">
          {active
            ? `Showing ${planned} of ${total} work centers ${subject}`
            : `All ${total} work centers ${subject}`}
        </span>

        {active && (
          <button
            type="button"
            onClick={() => onChange(NO_ORG_FILTER)}
            className="ml-auto rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            Clear filter
          </button>
        )}
      </div>

      {options.costCenters.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Cost centers:</span>
          {options.costCenters.map((o) => {
            const on = selection.costCenters.includes(o.value)
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(o.value)}
                className={`rounded-full border px-2.5 py-1 text-xs ${
                  on ? 'border-sky-600 bg-sky-600 text-white' : 'border-input hover:bg-muted'
                }`}
              >
                {o.label} <span className={on ? 'opacity-80' : 'text-muted-foreground'}>· {countLabel(o.count)}</span>
              </button>
            )
          })}
          {selection.costCenters.length > 0 && (
            <button
              type="button"
              onClick={() => onChange({ ...selection, costCenters: [], workCenters: [] })}
              className="ml-1 text-xs text-muted-foreground hover:underline"
            >
              all
            </button>
          )}
        </div>
      )}

      {showWorkCenters && options.workCenters.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-muted-foreground">Work centers:</span>
          {options.workCenters.map((name) => {
            const on = selection.workCenters.includes(name)
            return (
              <button
                key={name}
                type="button"
                aria-pressed={on}
                onClick={() => toggleWorkCenter(name)}
                className={`rounded-full border px-2.5 py-1 text-xs ${
                  on ? 'border-sky-600 bg-sky-600 text-white' : 'border-input hover:bg-muted'
                }`}
              >
                {name}
              </button>
            )
          })}
          {selection.workCenters.length > 0 && (
            <button
              type="button"
              onClick={() => onChange({ ...selection, workCenters: [] })}
              className="ml-1 text-xs text-muted-foreground hover:underline"
            >
              all
            </button>
          )}
        </div>
      )}

      {active && planned === 0 && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          No work center matches this selection. Check the cost center of the work centers on Work
          Center Definitions.
        </p>
      )}

      {selection.department === UNASSIGNED && (
        <p className="mt-2 text-xs text-muted-foreground">
          These work centers have no cost center, or a cost center that is not defined for this plant.
        </p>
      )}
    </div>
  )
}
