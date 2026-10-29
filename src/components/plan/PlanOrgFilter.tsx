import { useEffect, useMemo, useState } from 'react'

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

/** Süzgeç seçimi oturumlar arası kalır: planlamacı hep aynı bölüme bakar. */
const STORE_KEY = 'planningexpert.plan.orgFilter'

function readStored(): PlanOrgSelection {
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    if (!raw) return NO_ORG_FILTER
    const parsed = JSON.parse(raw) as Partial<PlanOrgSelection>
    return {
      department: typeof parsed.department === 'string' ? parsed.department : '',
      costCenters: Array.isArray(parsed.costCenters) ? parsed.costCenters.filter((c): c is string => typeof c === 'string') : [],
    }
  } catch {
    return NO_ORG_FILTER
  }
}

/**
 * Plan sayfasının bölüm / masraf yeri süzgecinin durumu. Seçim yalnız
 * görünümü daraltır — plan fabrikanın tamamı için hesaplanır
 * (src/lib/planOrgFilter.ts).
 */
export function usePlanOrgFilter(presses: OrgPress[], costCenters: OrgCostCenter[], departments: string[]) {
  const [selection, setSelection] = useState<PlanOrgSelection>(readStored)
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
      window.localStorage.setItem(STORE_KEY, JSON.stringify(selection))
    } catch {
      // Gizli sekmede yazılamaz; süzgeç yine çalışır.
    }
  }, [selection])

  const active = orgFilterActive(selection) && presses.length > 0
  const visible = useMemo(
    () => (active ? visibleWorkCenters(presses, costCenters, selection) : null),
    [active, presses, costCenters, selection],
  )

  /** Süzgeç kapalıysa her iş yeri görünür (tanımı silinmiş olan da). */
  const shows = useMemo(() => (visible ? (name: string) => visible.has(name) : () => true), [visible])

  return { selection, setSelection, options, active, shows }
}

const countLabel = (planned: number, other: number) =>
  `${planned} WC${other > 0 ? ` + ${other} not planned` : ''}`

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
}: {
  options: PlanOrgOptions
  selection: PlanOrgSelection
  onChange: (next: PlanOrgSelection) => void
  /** Süzgeçten geçen ve planda olan iş yeri sayısı. */
  planned: number
  /** Plandaki bütün iş yeri sayısı. */
  total: number
}) {
  const active = orgFilterActive(selection)
  const chosen = selection.department === '' ? null : options.departments.find((o) => o.value === selection.department)
  // Seçilen bölümde pres planına girmeyen (cycle) iş yerleri: boş görünen
  // bölümün nedeni budur.
  const notPlanned =
    selection.costCenters.length > 0
      ? options.costCenters.filter((o) => selection.costCenters.includes(o.value)).reduce((s, o) => s + o.other, 0)
      : (chosen?.other ?? 0)

  const toggle = (code: string) =>
    onChange({
      ...selection,
      costCenters: selection.costCenters.includes(code)
        ? selection.costCenters.filter((c) => c !== code)
        : [...selection.costCenters, code],
    })

  return (
    <div className={`mt-4 rounded-lg border p-3 text-sm ${active ? 'border-sky-300 bg-sky-50/60 dark:bg-sky-950/20' : 'border-border'}`}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            Department
            <InfoTip label="About the department filter">
              <p>
                The plan is always computed for the whole plant — capacity, cranes and dies are
                only correct when every work center is seen together. This filter narrows what
                you see: the chart, the work center lists, the part list of <b>Add job</b> and the
                late-job count all follow it.
              </p>
              <p>
                Departments and cost centers are defined on Company settings, and the link from a
                work center to its cost center on Work Center Definitions.
              </p>
            </InfoTip>
          </span>
          <select
            className="mt-1 w-56 rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={selection.department}
            onChange={(e) => onChange({ department: e.target.value, costCenters: [] })}
          >
            <option value="">All departments</option>
            {options.departments.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label} · {countLabel(o.planned, o.other)}
              </option>
            ))}
          </select>
        </label>

        <span className="py-2 text-muted-foreground">
          {active
            ? `Showing ${planned} of ${total} work centers in the plan`
            : `All ${total} work centers in the plan`}
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
                title={o.other > 0 ? `${o.other} work center(s) here are not part of the press plan` : undefined}
                className={`rounded-full border px-2.5 py-1 text-xs ${
                  on ? 'border-sky-600 bg-sky-600 text-white' : 'border-input hover:bg-muted'
                }`}
              >
                {o.label} <span className={on ? 'opacity-80' : 'text-muted-foreground'}>· {countLabel(o.planned, o.other)}</span>
              </button>
            )
          })}
          {selection.costCenters.length > 0 && (
            <button
              type="button"
              onClick={() => onChange({ ...selection, costCenters: [] })}
              className="ml-1 text-xs text-muted-foreground hover:underline"
            >
              all
            </button>
          )}
        </div>
      )}

      {active && planned === 0 && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
          {notPlanned > 0
            ? `No work center here is part of the press plan. ${notPlanned} work center(s) in this selection run on a cycle time (spot welding, robot, assembly, nut welding); PlanningExpert does not plan those yet — they are planned separately.`
            : 'No work center of this selection is in the plan. Check the cost center of the work centers on Work Center Definitions.'}
        </p>
      )}

      {active && planned > 0 && notPlanned > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {notPlanned} further work center(s) in this selection run on a cycle time and are not part of
          the press plan, so they are not shown.
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
