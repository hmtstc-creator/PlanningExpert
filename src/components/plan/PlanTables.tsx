import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { api } from '../../../convex/_generated/api'
import type { PlanDiff } from '../../lib/planDiff'
import { RAW_URGENT_DAYS, type PlanRun } from '../../lib/planPipeline'
import { fixForUnplanned } from '../../lib/unplannedFix'
import { useSafeMutation } from '../../lib/useSafeMutation'
import { InfoTip } from '../PageHeader'
import { DecisionCell } from './LateJobs'
import { dayMonth } from './usePlanState'

/**
 * Plan özetinin tabloları (Overview, 2026-10-19). Eskiden Production Plan
 * sayfasındaydılar; plan sayfası artık yalnızca Gantt ve araçları.
 */

const CHANGE_LABEL: Record<string, string> = {
  added: 'new',
  removed: 'dropped',
  moved: 'moved',
  quantity: 'qty changed',
  same: 'unchanged',
}

const CHANGE_STYLE: Record<string, string> = {
  added: 'rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800',
  removed: 'rounded bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive',
  moved: 'rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900',
  quantity: 'rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-900',
  same: 'text-xs text-muted-foreground',
}

const pcs = (n: number) => Math.round(n).toLocaleString('en-GB')

/** Bölüm başlığı: başlık, sayı rozeti, isteğe bağlı açıklama ve sağda eylem. */
export function SectionTitle({
  title,
  count,
  tone = 'neutral',
  info,
  action,
}: {
  title: string
  count?: number
  tone?: 'neutral' | 'danger' | 'ok'
  info?: React.ReactNode
  action?: React.ReactNode
}) {
  const badge =
    tone === 'danger'
      ? 'bg-destructive/15 text-destructive'
      : tone === 'ok'
        ? 'bg-emerald-100 text-emerald-800'
        : 'bg-muted text-muted-foreground'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {count !== undefined && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${badge}`}>{count}</span>}
      {info && <InfoTip label={`About ${title.toLowerCase()}`}>{info}</InfoTip>}
      {action && <div className="ml-auto">{action}</div>}
    </div>
  )
}

/** Üretim günündeki dakika → takvim günü ve saat ("Tue 20 Oct · 05:30"). */
function slotLabel(date: string, minute: number, shiftStartMinute: number): string {
  const absolute = shiftStartMinute + minute
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + Math.floor(absolute / 1440))
  const clock = ((absolute % 1440) + 1440) % 1440
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })
  return `${day} · ${String(Math.floor(clock / 60)).padStart(2, '0')}:${String(Math.round(clock % 60)).padStart(2, '0')}`
}

/**
 * Her preste sırayla hangi malzeme, ne zaman başlayıp bitiyor (planlamacı,
 * 2026-10-19). Dondurulmuş ve onaylı işler dahil; Gantt'ın tablo hali.
 */
export function PressPlanPanel({ run }: { run: PlanRun }) {
  const [query, setQuery] = useState('')
  const [press, setPress] = useState('')
  const needle = query.replace(/\s+/g, '').toUpperCase()
  const byPress = useMemo(() => {
    const map = new Map<string, PlanRun['jobs']>()
    for (const p of run.presses) map.set(p.name, [])
    for (const j of run.jobs) {
      const list = map.get(j.press) ?? []
      list.push(j)
      map.set(j.press, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.date.localeCompare(b.date) || a.setupStartMinute - b.setupStartMinute)
    }
    return Array.from(map.entries())
  }, [run])
  const shown = byPress
    .filter(([name]) => !press || name === press)
    .map(([name, jobs]) => [name, needle ? jobs.filter((j) => j.material.toUpperCase().includes(needle)) : jobs] as const)
    .filter(([, jobs]) => jobs.length > 0 || (!needle && !!press))

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <SectionTitle
        title="Plan by work center"
        count={run.jobs.length}
        info="Every job in planning order per work center, with start (setup start) and end. Frozen and approved jobs are included. The same plan is drawn on the Production Plan chart."
        action={
          <Link to="/planlama" className="text-sm font-medium text-foreground underline hover:no-underline">
            Open plan chart →
          </Link>
        }
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <select
          value={press}
          onChange={(e) => setPress(e.target.value)}
          aria-label="Work center"
          className="h-9 rounded-lg border border-input bg-background px-2 text-sm"
        >
          <option value="">All work centers</option>
          {byPress.map(([name, jobs]) => (
            <option key={name} value={name}>
              {name} ({jobs.length})
            </option>
          ))}
        </select>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find reference…"
          aria-label="Find a reference"
          className="h-9 w-48 rounded-lg border border-input bg-background px-3 text-sm"
        />
      </div>
      <div className="mt-3 max-h-[32rem] overflow-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Material</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 font-medium">Start</th>
              <th className="px-3 py-2 font-medium">End</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No job matches.
                </td>
              </tr>
            )}
            {shown.map(([name, jobs]) => (
              <PressRows key={name} name={name} jobs={jobs} shiftStartMinute={run.shiftStartMinute} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function PressRows({ name, jobs, shiftStartMinute }: { name: string; jobs: PlanRun['jobs']; shiftStartMinute: number }) {
  const qty = jobs.reduce((s, j) => s + j.quantity, 0)
  return (
    <>
      <tr className="border-t border-border bg-muted/40">
        <td colSpan={6} className="px-3 py-1.5 text-xs font-semibold text-foreground">
          {name}
          <span className="ml-2 font-normal text-muted-foreground">
            {jobs.length === 0 ? 'no jobs in the horizon' : `${jobs.length} job${jobs.length === 1 ? '' : 's'} · ${pcs(qty)} pcs`}
          </span>
        </td>
      </tr>
      {jobs.map((j, i) => (
        <tr key={`${name}-${i}`} className="border-t border-border/60">
          <td className="px-3 py-1.5 text-xs text-muted-foreground tabular-nums">{i + 1}</td>
          <td className="px-3 py-1.5 font-medium text-foreground">
            {j.material}
            {j.coProduct && <span className="font-normal text-muted-foreground"> +{j.coProduct}</span>}
          </td>
          <td className="px-3 py-1.5 text-right tabular-nums text-foreground">{pcs(j.quantity)}</td>
          <td className="whitespace-nowrap px-3 py-1.5 text-xs tabular-nums text-foreground">
            {slotLabel(j.date, j.setupStartMinute, shiftStartMinute)}
          </td>
          <td className="whitespace-nowrap px-3 py-1.5 text-xs tabular-nums text-muted-foreground">
            {slotLabel(j.endDate ?? j.date, j.endMinute, shiftStartMinute)}
          </td>
          <td className="whitespace-nowrap px-3 py-1.5 text-xs">
            {j.late ? (
              <span className="rounded bg-destructive/15 px-1.5 py-0.5 font-medium text-destructive">late</span>
            ) : j.locked ? (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">approved ✓</span>
            ) : j.frozen ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">frozen</span>
            ) : (
              <span className="text-muted-foreground">{j.bucketLabel}</span>
            )}
          </td>
        </tr>
      ))}
    </>
  )
}

/** Onaylı planla canlı planın farkı. */
export function PlanDiffPanel({ diff, approvedAt }: { diff: PlanDiff; approvedAt: number }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <SectionTitle title="Changes since the approved plan" count={diff.changes.length} />
      <p className="mt-1 text-xs text-muted-foreground">
        Approved {new Date(approvedAt).toLocaleString('en-GB')} · {diff.addedCount} new, {diff.removedCount} dropped,{' '}
        {diff.movedCount} moved, {diff.quantityCount} quantity changed, {diff.sameCount} unchanged.
      </p>
      <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Material</th>
              <th className="px-3 py-2 font-medium">Change</th>
              <th className="px-3 py-2 font-medium">Approved</th>
              <th className="px-3 py-2 font-medium">Now</th>
            </tr>
          </thead>
          <tbody>
            {diff.changes.map((c) => (
              <tr key={c.material} className="border-t border-border align-top">
                <td className="px-3 py-2 font-medium text-foreground">{c.material}</td>
                <td className="px-3 py-2">
                  <span className={CHANGE_STYLE[c.kind]}>{CHANGE_LABEL[c.kind]}</span>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {c.approvedSlots.length > 0 ? (
                    <>
                      {pcs(c.approvedQty)} pcs
                      <br />
                      {c.approvedSlots.join(', ')}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {c.currentSlots.length > 0 ? (
                    <>
                      {pcs(c.currentQty)} pcs
                      <br />
                      {c.currentSlots.join(', ')}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** Acil hammadde: ilk eksik iş RAW_URGENT_DAYS iş günü içinde. */
export function UrgentRawPanel({ run }: { run: PlanRun }) {
  // Sınır motordan gelir (tek hesap); eski planlarda bugünden sayılır.
  const until = run.rawUrgentUntil ?? run.todayIso ?? ''
  const days = run.rawUrgentDays ?? RAW_URGENT_DAYS
  // Toplamda yetse de yoldaki rulo geç geliyorsa iş durur: ilk eksik iş esas.
  const short = (run.rawNeeds ?? []).filter((r) => r.shortFrom)
  const urgent = short.filter((r) => r.shortFrom!.date <= until)
  const later = short.length - urgent.length
  return (
    <section className={`rounded-xl border p-4 ${urgent.length > 0 ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-card'}`}>
      <SectionTitle
        title="Raw material — urgent"
        count={urgent.length}
        tone={urgent.length > 0 ? 'danger' : 'ok'}
        info={
          <>
            Coil stock that runs out within the next {days} working days: planned quantity × gross weight per piece,
            walked in plan order against MB52 raw material stock plus coils in transit. The full requirement is on{' '}
            <Link to="/hammadde">Raw Material Coverage</Link>.
          </>
        }
      />
      {urgent.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No coil runs out in the next {days} working days.{later > 0 && ` ${later} run short later in the plan.`}
        </p>
      ) : (
        <>
          {later > 0 && <p className="mt-1 text-xs text-muted-foreground">{later} more run short later in the plan.</p>}
          <div className="mt-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Raw material</th>
                  <th className="px-3 py-2 text-right font-medium">Required (kg)</th>
                  <th className="px-3 py-2 text-right font-medium">Stock (kg)</th>
                  <th className="px-3 py-2 text-right font-medium">In transit (kg)</th>
                  <th className="px-3 py-2 text-right font-medium">Short (kg)</th>
                  <th className="px-3 py-2 font-medium">First job without coil</th>
                  <th className="px-3 py-2 font-medium">Used by</th>
                </tr>
              </thead>
              <tbody>
                {urgent.map((r) => (
                  <tr key={r.rawMaterial} className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-foreground">{r.rawMaterial}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pcs(r.requiredKg)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{pcs(r.availableKg)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.inTransitKg ? pcs(r.inTransitKg) : '—'}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums text-destructive">
                      {r.shortageKg > 0 ? pcs(r.shortageKg) : 'arrives too late'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      {r.shortFrom ? `${dayMonth(r.shortFrom.date)} · ${r.shortFrom.press} · ${r.shortFrom.material}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{r.materials.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

/** Planlanamayan talep ve her biri için çare. */
export function UnplannedPanel({ run }: { run: PlanRun }) {
  const unplanned = run.unplanned ?? []
  const setRule = useSafeMutation(api.planOverrides.set)
  const [done, setDone] = useState<Set<string>>(new Set())
  return (
    <section className={`rounded-xl border p-4 ${unplanned.length > 0 ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-card'}`}>
      <SectionTitle title="Unplanned" count={unplanned.length} tone={unplanned.length > 0 ? 'danger' : 'ok'} />
      {unplanned.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">All demand in the horizon has a place in the plan.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          {setRule.error && <p className="px-3 py-2 text-xs text-destructive">{setRule.error}</p>}
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Material</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 font-medium">Phase</th>
                <th className="px-3 py-2 font-medium">Required</th>
                <th className="px-3 py-2 font-medium">Reason</th>
                <th className="px-3 py-2 font-medium">Work centers tried</th>
                <th className="px-3 py-2 font-medium">Fix</th>
              </tr>
            </thead>
            <tbody>
              {unplanned.map((u, i) => {
                // Her sebebin somut bir çaresi var; listeyi okuyup ne
                // yapacağını aramak planlamacının işi olmamalı.
                const found = fixForUnplanned(u.reason)
                // Kural kaldırma Production Plan'daki Plan overrides listesinde yapılır.
                const fix = found.to || found.label === 'Move to front' ? found : { ...found, to: '/planlama' }
                return (
                  <tr key={`${u.material}-${i}`} className="border-t border-border align-top">
                    <td className="px-3 py-2 font-medium text-foreground">{u.material}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pcs(u.quantity)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{u.phase}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{u.dueDate}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{u.reason}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      <DecisionCell decision={u.decision} shiftMinutes={run.shiftMinutes} shiftStartMinute={run.shiftStartMinute} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      {fix.to ? (
                        <Link to={fix.to} className="font-medium text-foreground underline hover:no-underline">
                          {fix.label}
                        </Link>
                      ) : done.has(u.material) ? (
                        <span className="text-emerald-700">Moved to front — recalculate the plan</span>
                      ) : (
                        <button
                          type="button"
                          disabled={setRule.pending}
                          onClick={async () => {
                            if (!window.confirm(`Move ${u.material} to the front of the queue (Plan overrides)?`)) return
                            if (await setRule.run({ material: u.material, kind: 'priority' })) {
                              setDone((s) => new Set(s).add(u.material))
                            }
                          }}
                          className="font-medium text-foreground underline hover:no-underline disabled:opacity-50"
                        >
                          {fix.label}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
