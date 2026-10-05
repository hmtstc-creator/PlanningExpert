import { Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { ErrorBanner } from './ErrorBanner'
import { PageHeader } from './PageHeader'
import { useQuery } from '../lib/convexTransport'
import {
  KPI_INPUTS,
  formatKpi,
  kpiFor,
  periodTitle,
  slotKey,
  type KpiEntry as Entry,
  type KpiPeriod,
  type KpiValues,
  type OeeSum,
  type OperatorType,
} from '../lib/kpi'
import { usePlant } from '../lib/plantContext'
import { useSafeMutation } from '../lib/useSafeMutation'
import { KpiPeriodPicker, defaultSlot } from './KpiPeriodPicker'
import { relatedPages } from '../lib/navigation'

/**
 * KPI veri girişi (aylık ya da haftalık). Her satır bir masraf yeri ve
 * operatör tipi (Direct / Indirect); bir masraf yerinin birden çok satırı
 * olabilir. Her satırda Plan ve Actual alt satırı. Hesaplananlar (Overtime %,
 * Total presence, Efficiency, gerçekleşen OEE) salt okunur.
 */

type Side = Partial<Record<keyof KpiValues, string>>
interface Line {
  id: string
  costCenter: string
  operatorType: OperatorType
  plan: Side
  actual: Side
}

const pctKeys = new Set(KPI_INPUTS.filter((i) => i.pct).map((i) => i.key))

const toText = (v: KpiValues, key: keyof KpiValues) => {
  const x = v[key]
  if (x === undefined || x === null) return ''
  return pctKeys.has(key) ? String(Math.round(x * 1000) / 10) : String(x)
}

function toValues(side: Side): KpiValues {
  const out: KpiValues = {}
  for (const [k, text] of Object.entries(side)) {
    const t = (text ?? '').trim().replace(',', '.')
    if (!t) continue
    const n = Number(t)
    if (!Number.isFinite(n)) continue
    out[k as keyof KpiValues] = pctKeys.has(k as keyof KpiValues) ? n / 100 : n
  }
  return out
}

const sideOf = (v: KpiValues) => Object.fromEntries(KPI_INPUTS.map((i) => [i.key, toText(v ?? {}, i.key)])) as Side
let seq = 0
const newId = () => `l${Date.now()}-${seq++}`

const input = 'w-20 rounded-md border border-input bg-background px-1.5 py-1 text-right text-sm tabular-nums disabled:opacity-60'
const sel = 'rounded-md border border-input bg-background px-1.5 py-1 text-sm disabled:opacity-60'

const COMPUTED = [
  ['Overtime %', 'overtimePct', '%'],
  ['Total presence h', 'totalPresenceHours', 'h'],
  ['Efficiency', 'efficiency', '%'],
] as const

export function KpiEntryPage({ period }: { period: KpiPeriod }) {
  const { ctx, canArea } = usePlant()
  const editable = canArea('kpi.entry', 'edit')
  const costCenters = useMemo(() => ctx?.active?.costCenters ?? [], [ctx?.active?.costCenters])
  const [slot, setSlot] = useState(() => defaultSlot(period))
  const data = useQuery(api.kpi.entries, { period, year: slot.year, num: slot.num }) as { entries: Entry[]; oee: OeeSum[] } | undefined
  const { run: save, error, clearError } = useSafeMutation(api.kpi.save)
  const [lines, setLines] = useState<Line[]>([])
  const [saved, setSaved] = useState<Line[]>([])
  const [justSaved, setJustSaved] = useState(false)

  // Sunucudaki kayıtlar → satırlar; kaydı olmayan masraf yeri boş bir Direct satırla başlar.
  const serverSig = JSON.stringify(data?.entries ?? null)
  useEffect(() => {
    if (!data) return
    const next: Line[] = []
    for (const cc of costCenters) {
      const own = data.entries.filter((e) => e.costCenter === cc.code).sort((a, b) => (a.line ?? 0) - (b.line ?? 0))
      if (!own.length) next.push({ id: `${cc.code}-0`, costCenter: cc.code, operatorType: 'direct', plan: sideOf({}), actual: sideOf({}) })
      own.forEach((e, i) => next.push({ id: `${cc.code}-${i}`, costCenter: cc.code, operatorType: e.operatorType, plan: sideOf(e.plan), actual: sideOf(e.actual) }))
    }
    setLines(next)
    setSaved(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSig, slotKey(slot), JSON.stringify(costCenters)])

  const dirty = JSON.stringify(lines) !== JSON.stringify(saved)
  const patch = (id: string, p: Partial<Line>) => {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l)))
    setJustSaved(false)
  }
  const setValue = (id: string, side: 'plan' | 'actual', key: keyof KpiValues, text: string) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, [side]: { ...l[side], [key]: text } } : l)))
  /** Aynı masraf yerinin altına yeni satır; tip varsayılanı diğerinin tersi. */
  const addLine = (after: Line) =>
    setLines((ls) => {
      const i = ls.findIndex((l) => l.id === after.id)
      const line: Line = { id: newId(), costCenter: after.costCenter, operatorType: after.operatorType === 'direct' ? 'indirect' : 'direct', plan: sideOf({}), actual: sideOf({}) }
      return [...ls.slice(0, i + 1), line, ...ls.slice(i + 1)]
    })
  const removeLine = (id: string) => setLines((ls) => ls.filter((l) => l.id !== id))

  const entryOf = (l: Line): Entry => ({ period, year: slot.year, num: slot.num, costCenter: l.costCenter, operatorType: l.operatorType, plan: toValues(l.plan), actual: toValues(l.actual) })
  const oeeOf = (cc: string) => (data?.oee ?? []).filter((o) => o.costCenter === cc)
  // Satır başına hesap; OEE kök verisi masraf yerinin ilk satırında gösterilir.
  const results = useMemo(() => {
    const seen = new Set<string>()
    return Object.fromEntries(
      lines.map((l) => {
        const first = !seen.has(l.costCenter)
        seen.add(l.costCenter)
        return [l.id, kpiFor([entryOf(l)], first ? oeeOf(l.costCenter) : [])]
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, data])
  const total = useMemo(() => kpiFor(lines.map(entryOf), data?.oee ?? []), [lines, data]) // eslint-disable-line react-hooks/exhaustive-deps

  const onSave = async () => {
    const rows = lines.map((l) => ({ costCenter: l.costCenter, operatorType: l.operatorType, plan: toValues(l.plan), actual: toValues(l.actual) }))
    if (await save({ period, year: slot.year, num: slot.num, rows })) {
      setSaved(lines)
      setJustSaved(true)
    }
  }

  const ccName = (code: string) => costCenters.find((c) => c.code === code)?.name ?? code
  const inputs = KPI_INPUTS

  return (
    <div className="w-full px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <PageHeader
        title={period === 'month' ? 'Monthly KPI — data entry' : 'Weekly KPI — data entry'}
        summary={`${ctx?.active?.plantName ?? ''} — plan and actual per cost center, ${period === 'month' ? 'one month' : 'one ISO week'} at a time.`}
        links={relatedPages(period === 'month' ? '/kpi/monthly/entry' : '/kpi/weekly/entry')}
        info={
          <>
            <p>
              The cost centers are those of the plant (Company settings → Organization). A cost center can have
              several lines — e.g. one Direct and one Indirect line: press “+ line” and choose the type.
            </p>
            <p>
              Entered: operators, production volume and hour, normal presence, overtime, Absenteeism % and Productivity (a value, not %); OEE
              target in the plan. Calculated: Overtime % = overtime ÷ normal presence; Total presence = normal presence +
              overtime; Efficiency = production hour ÷ total presence.
            </p>
            <p>
              Actual OEE comes from the OEE data (Σ operating ÷ Σ loading). Actual production volume and hour are taken from
              the OEE data when left empty. Several lines: hours and pieces are added; Absenteeism % is weighted by normal
              presence, Productivity by total presence (open point, see the KPI notes).
            </p>
          </>
        }
      />
      <ErrorBanner message={error} onDismiss={clearError} />

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <KpiPeriodPicker period={period} value={slot} onChange={(s) => (dirty && !window.confirm('Discard the unsaved changes?') ? null : setSlot(s))} />
        <span className="pb-2 text-sm font-semibold text-foreground">{periodTitle(period, slot.year, slot.num)}</span>
        <div className="ml-auto flex items-center gap-2">
          {dirty && <span className="text-xs font-medium text-amber-700">● Unsaved changes</span>}
          {!dirty && justSaved && <span className="text-xs text-emerald-700">✓ Saved</span>}
          {dirty && (
            <button className="text-xs underline" onClick={() => setLines(saved)}>
              Discard
            </button>
          )}
          <button className="rounded-md bg-foreground px-4 py-1.5 text-sm font-medium text-background disabled:opacity-40" disabled={!dirty || !editable} onClick={() => void onSave()}>
            Save
          </button>
        </div>
      </div>
      {!editable && <p className="mt-2 text-xs text-muted-foreground">You can view the KPI data; changing it needs KPI edit permission.</p>}

      {costCenters.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {ctx?.active?.plantName} has no cost center yet — a creator adds them on{' '}
          <Link to="/settings" className="underline">
            Company settings
          </Link>
          .
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-2 text-left font-medium">Cost center</th>
                <th className="px-2 py-2 text-left font-medium">Operator type</th>
                <th className="px-2 py-2 font-medium" />
                {inputs.map((i) => (
                  <th key={i.key} className="px-2 py-2 text-right font-medium" title={i.label}>
                    {i.label}
                    <span className="block font-normal">({i.unit})</span>
                  </th>
                ))}
                {COMPUTED.map(([label]) => (
                  <th key={label} className="bg-muted px-2 py-2 text-right font-medium">
                    {label}
                    <span className="block font-normal">(calculated)</span>
                  </th>
                ))}
                <th className="px-2 py-2 text-right font-medium">
                  OEE
                  <span className="block font-normal">(OEE data)</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => {
                const r = results[l.id]
                const sameAsPrev = idx > 0 && lines[idx - 1].costCenter === l.costCenter
                const o = oeeOf(l.costCenter)[0]
                return (['plan', 'actual'] as const).map((side) => (
                  <tr key={`${l.id}${side}`} className={side === 'plan' ? `border-t ${sameAsPrev ? 'border-border/50' : 'border-border'}` : ''}>
                    {side === 'plan' && (
                      <>
                        <td rowSpan={2} className="px-2 py-1 align-top whitespace-nowrap">
                          {sameAsPrev ? <span className="text-muted-foreground">↳ {ccName(l.costCenter)}</span> : <b>{ccName(l.costCenter)}</b>}
                          <span className="block text-xs text-muted-foreground">{l.costCenter}</span>
                        </td>
                        <td rowSpan={2} className="px-2 py-1 align-top whitespace-nowrap">
                          <select className={sel} disabled={!editable} value={l.operatorType} onChange={(e) => patch(l.id, { operatorType: e.target.value as OperatorType })}>
                            <option value="direct">Direct</option>
                            <option value="indirect">Indirect</option>
                          </select>
                          {editable && (
                            <span className="mt-1 flex gap-2 text-xs">
                              <button type="button" className="underline" onClick={() => addLine(l)}>
                                + line
                              </button>
                              {lines.filter((x) => x.costCenter === l.costCenter).length > 1 && (
                                <button
                                  type="button"
                                  className="text-destructive underline"
                                  onClick={() => window.confirm(`Remove this ${l.operatorType} line of ${ccName(l.costCenter)}?`) && removeLine(l.id)}
                                >
                                  remove
                                </button>
                              )}
                            </span>
                          )}
                        </td>
                      </>
                    )}
                    <td className="px-2 py-1 text-xs text-muted-foreground">{side === 'plan' ? 'Plan' : 'Actual'}</td>
                    {inputs.map((i) => {
                      if (side === 'actual' && i.planOnly) return <td key={i.key} />
                      const hint =
                        side === 'actual' && !sameAsPrev && o?.loadingMin
                          ? i.key === 'volume'
                            ? `OEE: ${Math.round(o.good).toLocaleString('en-GB')}`
                            : i.key === 'productionHours'
                              ? `OEE: ${Math.round(o.productionMin / 60)}`
                              : ''
                          : ''
                      return (
                        <td key={i.key} className="px-1 py-0.5 text-right">
                          <input
                            className={input}
                            inputMode="decimal"
                            disabled={!editable}
                            placeholder={hint}
                            title={hint ? `Empty = ${hint}` : undefined}
                            value={l[side][i.key] ?? ''}
                            onChange={(e) => setValue(l.id, side, i.key, e.target.value)}
                          />
                        </td>
                      )
                    })}
                    {COMPUTED.map(([label, key, unit]) => (
                      <td key={label} className="bg-muted/40 px-2 py-1 text-right text-muted-foreground tabular-nums">
                        {formatKpi(r?.[side][key] ?? null, unit)}
                      </td>
                    ))}
                    <td className="px-2 py-1 text-right text-muted-foreground tabular-nums">{side === 'actual' && !sameAsPrev ? formatKpi(r?.actual.oee ?? null, '%') : ''}</td>
                  </tr>
                ))
              })}
              {(['plan', 'actual'] as const).map((side) => (
                <tr key={`total${side}`} className={side === 'plan' ? 'border-t-2 border-foreground font-semibold' : 'font-semibold'}>
                  {side === 'plan' && (
                    <td colSpan={2} rowSpan={2} className="px-2 py-1 align-top">
                      Total
                    </td>
                  )}
                  <td className="px-2 py-1 text-xs text-muted-foreground">{side === 'plan' ? 'Plan' : 'Actual'}</td>
                  {inputs.map((i) => {
                    const key = i.key === 'absenteeism' ? 'absenteeismPct' : i.key === 'operators' ? 'operators' : (i.key as keyof typeof total.plan)
                    const unit = i.pct ? '%' : i.key === 'operators' || i.key === 'productivity' ? 'n' : i.key === 'volume' ? 'pcs' : 'h'
                    return (
                      <td key={i.key} className="px-2 py-1 text-right tabular-nums">
                        {side === 'actual' && i.planOnly ? '' : formatKpi(total[side][key] ?? null, unit)}
                      </td>
                    )
                  })}
                  {COMPUTED.map(([label, key, unit]) => (
                    <td key={label} className="bg-muted/40 px-2 py-1 text-right tabular-nums">
                      {formatKpi(total[side][key] ?? null, unit)}
                    </td>
                  ))}
                  <td className="px-2 py-1 text-right tabular-nums">{side === 'actual' ? formatKpi(total.actual.oee, '%') : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">Empty fields stay empty (not 0). Percentages are entered as numbers, e.g. 3.5 for 3.5%. Productivity is a plain value.</p>
    </div>
  )
}
