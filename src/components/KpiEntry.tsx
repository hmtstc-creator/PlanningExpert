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
import { isoWeek } from '../lib/oee'
import { usePlant } from '../lib/plantContext'
import { useSafeMutation } from '../lib/useSafeMutation'
import { KpiPeriodPicker, defaultSlot } from './KpiPeriodPicker'

/**
 * KPI veri girişi (aylık ya da haftalık): seçili fabrikanın masraf yerleri
 * sütunlarda, her birinde Plan | Actual. Hesaplananlar (fazla mesai %, toplam
 * mevcudiyet, devamsızlık %, verimlilik, gerçekleşen OEE) salt okunur.
 */

type Side = Partial<Record<keyof KpiValues, string>>
interface Draft {
  operatorType: OperatorType
  plan: Side
  actual: Side
}

const toText = (v: KpiValues, key: keyof KpiValues) => {
  const x = v[key]
  if (x === undefined || x === null) return ''
  return key === 'oee' ? String(Math.round(x * 1000) / 10) : String(x)
}

function toValues(side: Side): KpiValues {
  const out: KpiValues = {}
  for (const [k, text] of Object.entries(side)) {
    const t = (text ?? '').trim().replace(',', '.')
    if (!t) continue
    const n = Number(t)
    if (!Number.isFinite(n)) continue
    out[k as keyof KpiValues] = k === 'oee' ? n / 100 : n
  }
  return out
}

const input = 'w-24 rounded-md border border-input bg-background px-2 py-1 text-right text-sm tabular-nums disabled:opacity-60'

export function KpiEntryPage({ period }: { period: KpiPeriod }) {
  const { ctx, can } = usePlant()
  const editable = can('kpi', 'edit')
  const costCenters = ctx?.active?.costCenters ?? []
  const [slot, setSlot] = useState(() => defaultSlot(period))
  const data = useQuery(api.kpi.entries, { period, year: slot.year, num: slot.num }) as { entries: Entry[]; oee: OeeSum[] } | undefined
  const { run: save, error, clearError } = useSafeMutation(api.kpi.save)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [saved, setSaved] = useState<Record<string, Draft>>({})
  const [justSaved, setJustSaved] = useState(false)

  // Sunucudaki kayıtlar → taslak (dönem ya da veri değişince).
  const serverSig = JSON.stringify(data?.entries ?? null)
  useEffect(() => {
    if (!data) return
    const next: Record<string, Draft> = {}
    for (const cc of costCenters) {
      const e = data.entries.find((x) => x.costCenter === cc.code)
      const side = (v: KpiValues) => Object.fromEntries(KPI_INPUTS.map((i) => [i.key, toText(v ?? {}, i.key)])) as Side
      next[cc.code] = { operatorType: e?.operatorType ?? 'direct', plan: side(e?.plan ?? {}), actual: side(e?.actual ?? {}) }
    }
    setDrafts(next)
    setSaved(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSig, slotKey(slot), JSON.stringify(costCenters)])

  const dirty = JSON.stringify(drafts) !== JSON.stringify(saved)
  const edit = (cc: string, patch: Partial<Draft>) => {
    setDrafts((d) => ({ ...d, [cc]: { ...d[cc], ...patch } }))
    setJustSaved(false)
  }
  const setValue = (cc: string, side: 'plan' | 'actual', key: keyof KpiValues, text: string) =>
    setDrafts((d) => ({ ...d, [cc]: { ...d[cc], [side]: { ...d[cc][side], [key]: text } } }))

  const results = useMemo(() => {
    const out: Record<string, ReturnType<typeof kpiFor>> = {}
    for (const cc of costCenters) {
      const d = drafts[cc.code]
      if (!d) continue
      const entry: Entry = { period, year: slot.year, num: slot.num, costCenter: cc.code, operatorType: d.operatorType, plan: toValues(d.plan), actual: toValues(d.actual) }
      out[cc.code] = kpiFor([entry], (data?.oee ?? []).filter((o) => o.costCenter === cc.code))
    }
    return out
  }, [drafts, costCenters, data, period, slot])

  const onSave = async () => {
    const rows = costCenters
      .filter((cc) => drafts[cc.code])
      .map((cc) => ({ costCenter: cc.code, operatorType: drafts[cc.code].operatorType, plan: toValues(drafts[cc.code].plan), actual: toValues(drafts[cc.code].actual) }))
    if (await save({ period, year: slot.year, num: slot.num, rows })) {
      setSaved(drafts)
      setJustSaved(true)
    }
  }

  const title = period === 'month' ? 'Monthly KPI — data entry' : 'Weekly KPI — data entry'
  const oeeOf = (cc: string) => (data?.oee ?? []).find((o) => o.costCenter === cc)

  return (
    <div className="w-full px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <PageHeader
        title={title}
        summary={`${ctx?.active?.plantName ?? ''} — plan and actual per cost center, ${period === 'month' ? 'one month' : 'one ISO week'} at a time.`}
        links={[{ to: period === 'month' ? '/kpi/monthly/dashboard' : '/kpi/weekly/dashboard', label: 'Dashboard' }]}
        info={
          <>
            <p>
              The cost centers are those of the plant (Companies and plants → Plant → Cost centers). Hours and pieces are entered;
              the rest is calculated from them — percentages are never averaged.
            </p>
            <p>
              Overtime % = overtime ÷ normal presence. Total presence = normal presence + overtime. Absenteeism % = absence ÷
              (normal presence + absence). Productivity = production hour ÷ total presence.
            </p>
            <p>
              Actual OEE comes from the OEE data (Σ operating ÷ Σ loading). Actual production volume and hour are taken from
              the OEE data too when left empty (good pieces, net production time).
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
            <button className="text-xs underline" onClick={() => setDrafts(saved)}>
              Discard
            </button>
          )}
          <button
            className="rounded-md bg-foreground px-4 py-1.5 text-sm font-medium text-background disabled:opacity-40"
            disabled={!dirty || !editable}
            onClick={() => void onSave()}
          >
            Save
          </button>
        </div>
      </div>
      {!editable && <p className="mt-2 text-xs text-muted-foreground">You can view the KPI data; changing it needs KPI edit permission.</p>}

      {costCenters.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {ctx?.active?.plantName} has no cost center yet — a creator adds them on{' '}
          <Link to="/platform" className="underline">
            Companies and plants
          </Link>
          .
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
          <table className="text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="sticky left-0 bg-muted px-3 py-2 text-left font-medium" rowSpan={2}>
                  KPI
                </th>
                {costCenters.map((cc) => (
                  <th key={cc.code} colSpan={2} className="border-l border-border px-3 py-2 text-center font-semibold text-foreground">
                    {cc.name} <span className="font-normal text-muted-foreground">({cc.code})</span>
                  </th>
                ))}
              </tr>
              <tr>
                {costCenters.map((cc) => [
                  <th key={`${cc.code}p`} className="border-l border-border px-3 py-1 text-right font-medium">
                    Plan
                  </th>,
                  <th key={`${cc.code}a`} className="px-3 py-1 text-right font-medium">
                    Actual
                  </th>,
                ])}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border">
                <td className="sticky left-0 bg-background px-3 py-1.5">Operator type</td>
                {costCenters.map((cc) => (
                  <td key={cc.code} colSpan={2} className="border-l border-border px-3 py-1.5 text-center">
                    <select
                      className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                      disabled={!editable}
                      value={drafts[cc.code]?.operatorType ?? 'direct'}
                      onChange={(e) => edit(cc.code, { operatorType: e.target.value as OperatorType })}
                    >
                      <option value="direct">Direct</option>
                      <option value="indirect">Indirect</option>
                    </select>
                  </td>
                ))}
              </tr>
              {KPI_INPUTS.map((row) => (
                <tr key={row.key} className="border-t border-border">
                  <td className="sticky left-0 bg-background px-3 py-1.5 whitespace-nowrap">
                    {row.label} <span className="text-xs text-muted-foreground">({row.unit})</span>
                  </td>
                  {costCenters.map((cc) => {
                    const d = drafts[cc.code]
                    const o = oeeOf(cc.code)
                    const hint =
                      row.key === 'volume' && o?.loadingMin ? `from OEE: ${Math.round(o.good).toLocaleString('en-GB')}` : row.key === 'productionHours' && o?.loadingMin ? `from OEE: ${Math.round(o.productionMin / 60)}` : ''
                    return [
                      <td key={`${cc.code}p`} className="border-l border-border px-2 py-1 text-right">
                        <input className={input} inputMode="decimal" disabled={!editable || !d} value={d?.plan[row.key] ?? ''} onChange={(e) => setValue(cc.code, 'plan', row.key, e.target.value)} />
                      </td>,
                      <td key={`${cc.code}a`} className="px-2 py-1 text-right">
                        {row.planOnly ? (
                          <span className="text-xs text-muted-foreground" title="Actual OEE comes from the OEE data">
                            {formatKpi(results[cc.code]?.actual.oee ?? null, '%')}
                          </span>
                        ) : (
                          <input
                            className={input}
                            inputMode="decimal"
                            disabled={!editable || !d}
                            placeholder={hint}
                            title={hint ? `Empty = ${hint}` : undefined}
                            value={d?.actual[row.key] ?? ''}
                            onChange={(e) => setValue(cc.code, 'actual', row.key, e.target.value)}
                          />
                        )}
                      </td>,
                    ]
                  })}
                </tr>
              ))}
              {(
                [
                  ['Overtime %', 'overtimePct', '%'],
                  ['Total presence hour', 'totalPresenceHours', 'h'],
                  ['Absenteeism %', 'absenteeismPct', '%'],
                  ['Productivity', 'productivity', '%'],
                ] as const
              ).map(([label, key, unit]) => (
                <tr key={key} className="border-t border-border bg-muted/40 text-muted-foreground">
                  <td className="sticky left-0 bg-muted px-3 py-1.5 whitespace-nowrap">
                    {label} <span className="text-xs">(calculated)</span>
                  </td>
                  {costCenters.map((cc) => [
                    <td key={`${cc.code}p`} className="border-l border-border px-3 py-1.5 text-right tabular-nums">
                      {formatKpi(results[cc.code]?.plan[key] ?? null, unit)}
                    </td>,
                    <td key={`${cc.code}a`} className="px-3 py-1.5 text-right tabular-nums">
                      {formatKpi(results[cc.code]?.actual[key] ?? null, unit)}
                    </td>,
                  ])}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Week {isoWeek(new Date().toISOString().slice(0, 10)).week} is the current ISO week. Empty fields stay empty (not 0).
      </p>
    </div>
  )
}
