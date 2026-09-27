import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState, type ReactNode } from 'react'

import { api } from '../../../convex/_generated/api'
import { Legend, LineTrendChart, StackedShareChart, pct } from '../../components/OeeCharts'
import { OeeControls, useOeeSelection } from '../../components/OeePanel'
import { InfoTip, PageHeader } from '../../components/PageHeader'
import { useQuery } from '../../lib/convexTransport'
import {
  LOSS_CHART_GROUPS,
  BREAK_KEY,
  LOSS_GROUPS,
  STARTUP_RUN_MIN,
  addDaysIso,
  chartShare,
  costCentersOf,
  dieTable,
  isoWeek,
  lossForPeriod,
  reasonPareto,
  reliability,
  scopeLabel,
  setupAnalysis,
  weekGap,
  type LossBreakdown,
  type OrderRow,
  type SetupRow,
  type SetupStatus,
  type ShiftRow,
} from '../../lib/oee'
import { fromStoredDay, fromStoredLoss, type StoredDowntimeDay, type StoredLossDay } from '../../lib/oeeStore'

export const Route = createFileRoute('/oee/losses')({
  component: LossesPage,
})

const WEEKS = 10
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
/** Tabloda ilk gösterilen satır sayısı (en kötü kalıplar, nedenler). */
const TOP = 10

const minutes = (m: number) => (m >= 90 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m)} min`)
/** Fark (puan). Kayıpta artış kötüdür (kırmızı); OEE'de artış iyidir. */
const gapText = (cur: number, prev: number, higherIsBetter = false) => {
  const d = (cur - prev) * 100
  if (Math.abs(d) < 0.05) return { text: '0.0', tone: 'text-muted-foreground' }
  const worse = higherIsBetter ? d < 0 : d > 0
  return { text: `${d > 0 ? '▲ +' : '▼ '}${d.toFixed(1)}`, tone: worse ? 'text-destructive' : 'text-emerald-700' }
}

function LossesPage() {
  const sel = useOeeSelection()
  const trendFrom = addDaysIso(sel.monday, -7 * (WEEKS - 1))
  const prevMonday = addDaysIso(sel.monday, -7)
  const shifts = (useQuery(api.oee.shifts, { from: trendFrom, to: sel.sunday }) ?? []) as ShiftRow[]
  const lossRaw = (useQuery(api.oee.lossDays, { from: trendFrom, to: sel.sunday }) ?? []) as StoredLossDay[]
  const orders = (useQuery(api.oee.orders, { from: prevMonday, to: sel.sunday }) ?? []) as OrderRow[]
  // Pazar gecesi biten setup'ın ilk üretim saati Pazartesiye taşabilir: bir gün fazla.
  const downRaw = (useQuery(api.oee.downtimeDays, { from: sel.monday, to: addDaysIso(sel.sunday, 1) }) ?? []) as StoredDowntimeDay[]
  const lossDays = useMemo(() => lossRaw.map(fromStoredLoss), [lossRaw])
  const downtimes = useMemo(() => downRaw.map(fromStoredDay), [downRaw])
  const scope = sel.scope
  const label = scopeLabel(scope)

  const days = useMemo(
    () =>
      DAY_LABELS.map((d, i) => {
        const date = addDaysIso(sel.monday, i)
        return { key: date, label: `${d} ${date.slice(8)}`, b: lossForPeriod(shifts, lossDays, scope, date, date) }
      }),
    [shifts, lossDays, scope, sel.monday],
  )
  const weekCur = lossForPeriod(shifts, lossDays, scope, sel.monday, sel.sunday)
  const weekPrev = lossForPeriod(shifts, lossDays, scope, prevMonday, addDaysIso(prevMonday, 6))
  const trend = useMemo(
    () =>
      Array.from({ length: WEEKS }, (_, i) => {
        const monday = addDaysIso(sel.monday, -7 * (WEEKS - 1 - i))
        return { label: `W${isoWeek(monday).week}`, b: lossForPeriod(shifts, lossDays, scope, monday, addDaysIso(monday, 6)) }
      }),
    [shifts, lossDays, scope, sel.monday],
  )
  const gap = useMemo(() => weekGap(shifts, lossDays, scope, sel.monday), [shifts, lossDays, scope, sel.monday])
  const reasons = useMemo(() => reasonPareto(lossDays, scope, sel.monday), [lossDays, scope, sel.monday])
  const ccOf = useMemo(() => costCentersOf(shifts), [shifts])
  const dies = useMemo(() => dieTable(orders, scope, sel.monday, sel.sunday, ccOf), [orders, scope, sel.monday, sel.sunday, ccOf])
  const reli = useMemo(() => reliability(shifts, lossDays, scope, sel.monday, sel.sunday), [shifts, lossDays, scope, sel.monday, sel.sunday])
  const dieBreak = useMemo(() => reliability(shifts, lossDays, scope, sel.monday, sel.sunday, 'KLP'), [shifts, lossDays, scope, sel.monday, sel.sunday])
  const setups = useMemo(() => setupAnalysis(downtimes, orders, scope, sel.monday, sel.sunday), [downtimes, orders, scope, sel.monday, sel.sunday])

  const stackParts = (b: LossBreakdown) => [
    { key: 'oee', label: 'OEE', value: b.oee ?? 0 },
    ...LOSS_CHART_GROUPS.map((g) => ({ key: g.key, label: g.label, value: chartShare(b, g.key) })),
  ]
  const noData = shifts.length === 0 && lossDays.length === 0

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Losses Trend"
        summary="Where the time goes: losses of the selected week against the week before, dies, breakdowns and setups."
        links={[
          { to: '/oee', label: 'OEE Dashboard' },
          { to: '/oee/data', label: 'Data' },
        ]}
        info={
          <>
            <p>
              A loss is its unscheduled downtime minutes (Downtimes, Reason Code 2) ÷ Loading time of
              the same presses and days — the "% of Loading" of the BoardReport. <b>Speed</b> =
              (Production − Operation) ÷ Loading. <b>Others</b> = Management + Logistic + Quality.
            </p>
            <p>
              Groups: KLP die breakdown, STP setup, ARZ machine breakdown, KSD short stoppages, KON
              quality, OFC logistic, YNT management, # undefined.
            </p>
            <p>Gap = this week − previous week, in percentage points: ▲ red is worse, ▼ green is better.</p>
          </>
        }
      />

      <OeeControls selection={sel} rows={shifts} />

      {noData && (
        <p className="mt-6 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No data for this period yet. Upload the file with <b>Upload data</b>.
        </p>
      )}

      <Section title={`Week W${sel.week.week} — daily % of Loading · ${label}`} note={`${sel.monday} – ${sel.sunday}`}>
        <Legend items={[{ key: 'oee', label: 'OEE' }, ...LOSS_CHART_GROUPS]} />
        <StackedShareChart columns={days.map((d) => ({ key: d.key, label: d.label, parts: stackParts(d.b) }))} ariaLabel="Daily OEE and losses" />
        <div className="mt-2 overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">% of Loading</th>
                {days.map((d) => (
                  <th key={d.key} className="px-2 py-1.5 text-right font-medium">{d.label}</th>
                ))}
                <th className="px-2 py-1.5 text-right font-medium">Week</th>
                <th className="px-2 py-1.5 text-right font-medium">Previous</th>
                <th className="px-2 py-1.5 text-right font-medium">Gap (pts)</th>
              </tr>
            </thead>
            <tbody>
              {[{ key: 'oee', label: 'OEE' }, ...LOSS_CHART_GROUPS].map((g) => {
                const v = (b: LossBreakdown) => (g.key === 'oee' ? b.oee ?? 0 : chartShare(b, g.key))
                const gp = gapText(v(weekCur), v(weekPrev), g.key === 'oee')
                return (
                  <tr key={g.key} className="border-t border-border">
                    <td className="px-2 py-1 font-medium text-foreground">{g.label}</td>
                    {days.map((d) => (
                      <td key={d.key} className="px-2 py-1 text-right tabular-nums">{d.b.loadingMin > 0 ? pct(v(d.b)) : '—'}</td>
                    ))}
                    <td className="px-2 py-1 text-right font-semibold tabular-nums">{pct(v(weekCur))}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{pct(v(weekPrev))}</td>
                    <td className={`px-2 py-1 text-right tabular-nums ${gp.tone}`}>{gp.text}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={`Week gap by press and cost center — W${sel.week.week} vs W${isoWeek(prevMonday).week}`} info="Each cell: this week's loss share, and the change against the previous week in percentage points.">
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Press / cost center</th>
                <th className="px-2 py-1.5 text-right font-medium">OEE</th>
                {LOSS_CHART_GROUPS.map((g) => (
                  <th key={g.key} className="px-2 py-1.5 text-right font-medium">{g.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gap.map((r) => {
                const oeeGap = gapText(r.current.oee ?? 0, r.previous.oee ?? 0, true)
                return (
                  <tr key={r.key} className={`border-t border-border ${r.isGroup ? 'bg-muted/40 font-semibold' : ''}`}>
                    <td className="whitespace-nowrap px-2 py-1 text-foreground">{r.label}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {pct(r.current.oee)}{' '}
                      <span className={`text-[10px] ${oeeGap.tone}`}>
                        {r.previous.loadingMin > 0 ? oeeGap.text : ''}
                      </span>
                    </td>
                    {LOSS_CHART_GROUPS.map((g) => {
                      const cur = chartShare(r.current, g.key)
                      const gp = gapText(cur, chartShare(r.previous, g.key))
                      return (
                        <td key={g.key} className="px-2 py-1 text-right tabular-nums">
                          {r.current.loadingMin > 0 ? pct(cur) : '—'}{' '}
                          <span className={`text-[10px] ${gp.tone}`}>{r.previous.loadingMin > 0 ? gp.text : ''}</span>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={`Loss trend — last ${WEEKS} weeks · ${label}`}>
        <Legend items={LOSS_CHART_GROUPS.map((g, i) => ({ ...g, slot: i + 1 }))} />
        <LineTrendChart
          labels={trend.map((t) => t.label)}
          series={LOSS_CHART_GROUPS.map((g, i) => ({
            key: g.key,
            label: g.label,
            // Yığılmış grafikte 1. renk OEE'nin; kayıplar aynı renkleri korur.
            slot: i + 1,
            values: trend.map((t) => (t.b.loadingMin > 0 ? chartShare(t.b, g.key) : null)),
          }))}
          ariaLabel="Weekly loss trend"
        />
      </Section>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Section title="Top downtime reasons" note={`W${sel.week.week}, unscheduled`} flush>
          <SimpleTable
            head={['Reason', 'Group', 'Count', 'This week', 'Previous', 'Change']}
            rows={reasons.slice(0, 15).map((r) => {
              const d = r.minutes - r.previousMinutes
              return [
                r.text,
                LOSS_GROUPS.find((g) => g.code === r.group)?.label ?? r.group,
                String(r.count),
                minutes(r.minutes),
                minutes(r.previousMinutes),
                <span key="d" className={d > 0 ? 'text-destructive' : d < 0 ? 'text-emerald-700' : ''}>
                  {d > 0 ? '▲ ' : d < 0 ? '▼ ' : ''}
                  {minutes(Math.abs(d))}
                </span>,
              ]
            })}
          />
        </Section>

        <Section title="Breakdowns — MTTR and MTBF" note={`W${sel.week.week}`} flush info="MTTR = breakdown minutes ÷ breakdowns (average repair). MTBF = production time ÷ breakdowns (average running time between two breakdowns).">
          <SimpleTable
            head={['Press', 'Machine bd.', 'Machine min', 'MTTR', 'MTBF', 'Die bd.', 'Die min', 'Die MTTR']}
            rows={reli.map((r, i) => {
              const d = dieBreak[i]
              return [
                r.workCenter,
                String(r.breakdowns),
                minutes(r.breakdownMin),
                r.mttrMin === null ? '—' : minutes(r.mttrMin),
                r.mtbfMin === null ? '—' : minutes(r.mtbfMin),
                String(d?.breakdowns ?? 0),
                minutes(d?.breakdownMin ?? 0),
                d?.mttrMin == null ? '—' : minutes(d.mttrMin),
              ]
            })}
          />
        </Section>
      </div>

      <DieSection dies={dies} week={sel.week.week} />

      <SetupSection setups={setups} week={sel.week.week} loaded={downRaw.length > 0} />
    </div>
  )
}

function DieSection({ dies, week }: { dies: ReturnType<typeof dieTable>; week: number }) {
  const [press, setPress] = useState('all')
  const presses = [...new Set(dies.map((d) => d.workCenter))].sort()
  const list = dies.filter((d) => press === 'all' || d.workCenter === press)
  const worst = [...list].filter((d) => d.weightedOee !== null).sort((a, b) => a.weightedOee! - b.weightedOee!).slice(0, TOP)
  const speed = [...list].sort((a, b) => b.speedLossMin - a.speedLossMin).filter((d) => d.speedLossMin > 0).slice(0, TOP)
  return (
    <section className="mt-6 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          Dies — W{week}
          <InfoTip label="About die OEE">
            Die OEE is weighted by good quantity, as in the file: Σ(OEE × good) ÷ Σ good (Order Based KPI,
            TOTAL1). Speed loss = Production − Operation time of the die's orders.
          </InfoTip>
        </h2>
        <PressPicker presses={presses} value={press} onChange={setPress} />
      </div>
      <div className="mt-2 grid gap-4 xl:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Worst {TOP} dies by OEE</p>
          <SimpleTable
            head={['Die', 'Press', 'Orders', 'Good', 'Loading', 'OEE']}
            rows={worst.map((d) => [d.equipment, d.workCenter, String(d.orders), d.good.toLocaleString('en-GB'), minutes(d.loadingMin), pct(d.weightedOee)])}
          />
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Most speed loss</p>
          <SimpleTable
            head={['Die', 'Press', 'Good', 'Speed loss', 'OEE']}
            rows={speed.map((d) => [d.equipment, d.workCenter, d.good.toLocaleString('en-GB'), minutes(d.speedLossMin), pct(d.weightedOee)])}
          />
        </div>
      </div>
    </section>
  )
}

const STATUS: Record<SetupStatus, { label: string; tone: string }> = {
  ok: { label: 'OK — 1 h production', tone: 'text-emerald-700' },
  nok: { label: 'NOK — no 1 h production before the next setup', tone: 'text-destructive' },
  open: { label: 'Open — not known yet', tone: 'text-muted-foreground' },
}

const reasonLabel = (code: string) =>
  code === BREAK_KEY ? 'Breaks' : code === 'next-setup' ? 'Next setup came' : LOSS_GROUPS.find((g) => g.code === code)?.label ?? code

const lostText = (lost: Record<string, number>) =>
  Object.entries(lost)
    .sort((a, b) => b[1] - a[1])
    .map(([k, m]) => `${reasonLabel(k)} ${minutes(m)}`)
    .join(' · ') || '—'

function SetupSection({ setups, week, loaded }: { setups: SetupRow[]; week: number; loaded: boolean }) {
  const [press, setPress] = useState('all')
  const [status, setStatus] = useState<'all' | SetupStatus>('all')
  const presses = [...new Set(setups.map((s) => s.workCenter))].sort()
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const summary = presses.map((p) => {
    const rows = setups.filter((s) => s.workCenter === p)
    const nok = rows.filter((s) => s.status === 'nok')
    const main = new Map<string, number>()
    for (const r of nok) main.set(r.mainReason ?? '', (main.get(r.mainReason ?? '') ?? 0) + 1)
    return {
      press: p,
      count: rows.length,
      planned: rows.filter((s) => s.kind !== 'unplanned').length,
      unplanned: rows.filter((s) => s.kind === 'unplanned').length,
      ok: rows.filter((s) => s.status === 'ok').length,
      nok: nok.length,
      open: rows.filter((s) => s.status === 'open').length,
      avgSetup: avg(rows.map((s) => s.setupMin)),
      avgToRun: avg(rows.filter((s) => s.timeToRunMin !== null).map((s) => s.timeToRunMin!)),
      reasons: [...main].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${reasonLabel(k)} ${n}`).join(', '),
    }
  })
  // NOK nedenleri: ana neden sayısı ve setup sonrası kaybedilen süre (seçilen pres).
  const nokRows = setups.filter((s) => s.status === 'nok' && (press === 'all' || s.workCenter === press))
  const reasonMap = new Map<string, { main: number; lost: number; setups: number }>()
  for (const r of nokRows) {
    const m = reasonMap.get(r.mainReason ?? '') ?? { main: 0, lost: 0, setups: 0 }
    m.main += 1
    reasonMap.set(r.mainReason ?? '', m)
    for (const [k, v] of Object.entries(r.lost)) {
      const x = reasonMap.get(k) ?? { main: 0, lost: 0, setups: 0 }
      x.lost += v
      x.setups += 1
      reasonMap.set(k, x)
    }
  }
  const reasonRows = [...reasonMap].filter(([k]) => k).sort((a, b) => b[1].main - a[1].main || b[1].lost - a[1].lost)
  const list = setups.filter((s) => (press === 'all' || s.workCenter === press) && (status === 'all' || s.status === status))
  return (
    <section className="mt-6 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          Setups — W{week}
          <InfoTip label="About the setup analysis">
            <p>
              Only planned and unplanned <b>die setups</b> count as a setup (DIE SETUP – PLANNED /
              UNPLANNED; on APR REGLAJ MATRITA – PLANIFICATA / NEPLANIFICATA). Sensor, gripper, coil
              and other adjustments are not a setup; after a setup they are a reason for not starting.
            </p>
            <p>
              <b>OK</b>: after the setup ends, the press produced {STARTUP_RUN_MIN} minutes (time
              without any downtime) before the next die setup. <b>NOK</b>: it did not — it could not
              get into production. The downtimes between the end of the setup and that hour (or the
              next setup) are the reasons: short stoppages, further setup work, die breakdown, …;
              breaks are shown apart. <b>Open</b>: the data ends before it is known.
            </p>
            <p>Setup records with no production between them (shift change, break) count as one setup.</p>
          </InfoTip>
        </h2>
        <div className="flex flex-wrap gap-2">
          <PressPicker presses={presses} value={press} onChange={setPress} />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as 'all' | SetupStatus)}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs"
          >
            <option value="all">All results</option>
            {(Object.keys(STATUS) as SetupStatus[]).map((k) => (
              <option key={k} value={k}>
                {STATUS[k].label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {!loaded && <p className="mt-2 text-xs text-muted-foreground">No downtime rows for this week.</p>}
      {summary.length > 0 && (
        <SimpleTable
          head={['Press', 'Setups', 'Planned', 'Unplanned', 'OK', 'NOK', 'Open', 'Avg setup', 'Avg to 1 h production', 'NOK main reasons']}
          rows={summary.map((s) => [
            s.press,
            String(s.count),
            String(s.planned),
            String(s.unplanned),
            <span key="ok" className="text-emerald-700">{s.ok}</span>,
            <span key="nok" className={s.nok ? 'font-semibold text-destructive' : ''}>
              {s.nok} ({s.count ? Math.round((s.nok / s.count) * 100) : 0}%)
            </span>,
            String(s.open),
            s.avgSetup === null ? '—' : minutes(s.avgSetup),
            s.avgToRun === null ? '—' : minutes(s.avgToRun),
            s.reasons || '—',
          ])}
        />
      )}
      {reasonRows.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-muted-foreground">
            Why NOK setups did not start {press === 'all' ? '' : `— ${press}`}
          </p>
          <SimpleTable
            head={['Reason', 'Main reason of', 'Seen in NOK setups', 'Time lost after setup']}
            rows={reasonRows.map(([k, v]) => [reasonLabel(k), `${v.main} setup(s)`, String(v.setups), v.lost ? minutes(v.lost) : '—'])}
          />
        </div>
      )}
      {list.length > 0 && (
        <div className="mt-3">
          <SimpleTable
            head={['Press', 'Setup', 'Order', 'Die / material', 'Type', 'Setup time', 'Result', 'To 1 h production', 'Downtime after setup', 'Main reason', 'Good']}
            rows={list.map((s) => [
              s.workCenter,
              `${s.start.slice(5)} – ${s.end.slice(11)}`,
              s.order,
              s.material,
              s.kind,
              minutes(s.setupMin),
              <span key="r" className={STATUS[s.status].tone}>{s.status.toUpperCase()}</span>,
              s.timeToRunMin !== null
                ? minutes(s.timeToRunMin)
                : `${minutes(s.runMin)} run${s.nextSetup ? ` · next setup ${s.nextSetup.slice(5)}` : ''}`,
              lostText(s.lost),
              s.mainReason ? reasonLabel(s.mainReason) : '—',
              s.good.toLocaleString('en-GB'),
            ])}
          />
        </div>
      )}
    </section>
  )
}

function PressPicker({ presses, value, onChange }: { presses: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1 text-xs">
      <option value="all">All presses</option>
      {presses.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </select>
  )
}

function SimpleTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  if (!rows.length) return <p className="mt-2 text-xs text-muted-foreground">Nothing for this week.</p>
  return (
    <div className="mt-2 max-h-[28rem] overflow-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted text-muted-foreground">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-2 py-1.5 text-left font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border align-top">
              {r.map((c, j) => (
                <td key={j} className={`px-2 py-1 ${j === 0 ? 'whitespace-nowrap font-medium text-foreground' : 'tabular-nums'}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Section({ title, note, info, flush, children }: { title: string; note?: string; info?: string; flush?: boolean; children: ReactNode }) {
  return (
    <section className={`${flush ? '' : 'mt-6'} rounded-lg border border-border p-4`}>
      <h2 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-foreground">
        {title}
        {note && <span className="text-xs font-normal text-muted-foreground">{note}</span>}
        {info && <InfoTip label={title}>{info}</InfoTip>}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  )
}
