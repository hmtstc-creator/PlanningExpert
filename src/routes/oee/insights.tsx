import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { useOeeConfig } from '../../components/OeePanel'
import { dm } from '../../components/OeePeriodControl'
import { PageHeader } from '../../components/PageHeader'
import { useMutation, useQuery } from '../../lib/convexTransport'
import { relatedPages } from '../../lib/navigation'
import { costCenterName, type DayRow } from '../../lib/oee'
import { fullWeeks, lossMeaning, type Finding, type UndefinedCode } from '../../lib/oeeInsights'
import { usePlant } from '../../lib/plantContext'

export const Route = createFileRoute('/oee/insights')({
  component: InsightsPage,
})

interface Report {
  id: string
  costCenter: string
  workCenter: string
  from: string
  to: string
  day: string
  status: string
  progress?: string
  source?: string
  model?: string
  note?: string
  findings?: Finding[]
  signalCount?: number
  undefinedCodes?: UndefinedCode[]
  createdAt: number
  createdBy?: string
}

const today = () => new Date().toISOString().slice(0, 10)
const PRESETS = [1, 4, 12]
const CONF_STYLE: Record<string, string> = {
  high: 'bg-emerald-100 text-emerald-800',
  medium: 'bg-amber-100 text-amber-900',
  low: 'bg-slate-100 text-slate-700',
}

/**
 * OEE Agent Insights (planlamacı, 2026-10-23): masraf yeri / iş yeri / tarih
 * aralığı seçilir, ajan 3–5 "standart raporda görünmeyen" tespit yazar.
 * Sinyaller src/lib/oeeInsights.ts, ajan convex/oeeInsights.ts, kararlar
 * docs/oee-agent-report.md → Agent Insights.
 */
function InsightsPage() {
  const { config } = useOeeConfig()
  const { canArea } = usePlant()
  const canRun = canArea('oee.data', 'edit')
  const [range, setRange] = useState(() => fullWeeks(today(), 4))
  const [costCenter, setCostCenter] = useState('')
  const [workCenter, setWorkCenter] = useState('')
  const [shown, setShown] = useState<string | null>(null)
  const [error, setError] = useState('')
  const request = useMutation(api.oeeInsights.request)
  const history = useQuery(api.oeeInsights.list) as { reports: Report[]; aiConfigured: boolean } | undefined
  const report = useQuery(api.oeeInsights.get, shown ? { id: shown } : 'skip') as Report | null | undefined
  const daysRaw = useQuery(api.oee.days, { from: range.from, to: range.to }) as DayRow[] | undefined

  const costCenters = useMemo(() => {
    const codes = new Set([...config.costCenters.map((c) => c.code), ...(daysRaw ?? []).map((d) => d.costCenter).filter(Boolean)])
    return [...codes].sort((a, b) => costCenterName(a, config).localeCompare(costCenterName(b, config)))
  }, [config, daysRaw])
  const cc = costCenter || costCenters[0] || ''
  const workCenters = useMemo(() => [...new Set((daysRaw ?? []).filter((d) => d.costCenter === cc).map((d) => d.workCenter))].sort(), [daysRaw, cc])
  const wc = workCenters.includes(workCenter) ? workCenter : ''
  // Anlamı ne ayarda ne varsayılanda olan gruplar (src/lib/settingsDefaults.ts → LOSS_CODE_MEANINGS).
  const noMeaning = config.lossGroups.filter((g) => !lossMeaning(g.code, config)).map((g) => g.code)

  async function ask(force = false) {
    setError('')
    try {
      const id = (await request({ costCenter: cc, workCenter: wc, from: range.from, to: range.to, force })) as string
      setShown(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const input = 'rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground'

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 pb-24 sm:py-8">
      <PageHeader
        title="Agent Insights"
        summary="Pick a cost center, a work center and a period: the agent writes 3 to 5 findings you would not see in a standard OEE Pareto."
        links={relatedPages('/oee/insights')}
        info={
          <>
            <p>
              The program first computes statistical signals from the uploaded OEE data: a loss hidden in one part, the same part behaving
              differently on two machines, availability falling with the number of order changes, a weak shift or weekday, micro-stops, a loss
              that jumped from one date on, cycle-time master data that cannot be right (performance above 100 %), the same short adjustment repeated all the time, residual
              stops after breaks, 5S booked as an unplanned loss and data-quality gaps (such as long stops left without a reason). Every signal
              carries its numbers, the top 3 stop texts of its loss, an estimated gain and a confidence.
            </p>
            <p>
              The AI chooses the 3 to 5 strongest and explains them; it only sees these signals and the names of the cost center, work
              centers, parts and loss codes — no people. Without the AI (no key or no usable answer) the 3 strongest signals are shown and the
              page says so.
            </p>
            <p>
              Making a report needs the OEE data permission; everyone with OEE can read them. A report is saved; the same choice on the same day opens the saved one (<i>Regenerate</i> makes a new one). Loss code meanings:{' '}
              <Link to="/oee/settings">OEE Settings</Link> → Loss groups → Meaning.
            </p>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-end gap-3 text-sm">
        <label className="filter-label flex flex-col gap-1">
          Cost center
          <select value={cc} onChange={(e) => setCostCenter(e.target.value)} className={input}>
            {costCenters.map((c) => (
              <option key={c} value={c}>
                {costCenterName(c, config)}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-label flex flex-col gap-1">
          Work center
          <select value={wc} onChange={(e) => setWorkCenter(e.target.value)} className={input}>
            <option value="">All</option>
            {workCenters.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-label flex flex-col gap-1">
          From
          <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className={input} />
        </label>
        <label className="filter-label flex flex-col gap-1">
          To
          <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className={input} />
        </label>
        <div className="inline-flex rounded-md border border-input">
          {PRESETS.map((n) => {
            const r = fullWeeks(today(), n)
            const on = r.from === range.from && r.to === range.to
            return (
              <button key={n} type="button" onClick={() => setRange(r)} className={`px-3 py-1.5 ${on ? 'bg-primary text-primary-foreground' : ''}`}>
                {n} wk
              </button>
            )
          })}
        </div>
        <button type="button" disabled={!cc || !canRun} title={canRun ? undefined : 'Needs the OEE data permission'} onClick={() => ask()} className="rounded-md bg-primary px-4 py-1.5 font-medium text-primary-foreground disabled:opacity-50">
          Agent report
        </button>
      </div>

      {noMeaning.length > 0 && (
        <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {noMeaning.join(', ')} {noMeaning.length === 1 ? 'has' : 'have'} no meaning, so the AI only sees the abbreviation. Fill it in{' '}
          <Link to="/oee/settings">OEE Settings</Link> → Loss groups → Meaning.
        </p>
      )}
      {history && !history.aiConfigured && (
        <p className="mb-3 text-sm text-muted-foreground">AI is not set up on the server (AI_API_KEY): reports show the 3 strongest signals found by the rules.</p>
      )}
      {error && <p className="mb-3 text-sm text-red-700">{error}</p>}

      {report && <ReportView report={report} config={config} onRegenerate={canRun ? () => ask(true) : undefined} />}

      <h2 className="mb-2 mt-8 text-base font-semibold">Earlier reports</h2>
      {!history ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !history.reports.length ? (
        <p className="text-sm text-muted-foreground">No report yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border text-sm">
          {history.reports.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setShown(r.id)} className={`flex w-full flex-wrap gap-2 px-3 py-2 text-left ${r.id === shown ? 'bg-muted' : ''}`}>
                <span className="font-medium">{costCenterName(r.costCenter, config)}</span>
                <span>{r.workCenter || 'all work centers'}</span>
                <span className="text-muted-foreground">
                  {dm(r.from)}–{dm(r.to)}
                </span>
                <span className="ml-auto text-muted-foreground">
                  {r.status === 'done' ? (r.source === 'ai' ? 'AI' : 'rules') : r.status} · {dm(r.day)}
                  {r.createdBy ? ` · ${r.createdBy}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ReportView({ report: r, config, onRegenerate }: { report: Report; config: ReturnType<typeof useOeeConfig>['config']; onRegenerate?: () => void }) {
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h2 className="text-base font-semibold">
          {costCenterName(r.costCenter, config)} · {r.workCenter || 'all work centers'} · {dm(r.from)}–{dm(r.to)}
        </h2>
        {r.status === 'done' && onRegenerate && (
          <button type="button" onClick={onRegenerate} className="ml-auto rounded-md border border-input px-3 py-1 text-sm">
            Regenerate
          </button>
        )}
      </div>
      {r.status === 'running' && <p className="text-sm text-muted-foreground">{r.progress ?? 'Working…'}</p>}
      {!!r.undefinedCodes?.length && (
        <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Undefined code{r.undefinedCodes.length > 1 ? 's' : ''}: {r.undefinedCodes.map((x) => `${x.code} (${x.min} min, ${x.count} stops)`).join(', ')} — in the data
          as a loss but not in <Link to="/oee/settings">OEE Settings</Link> → Loss groups, so the charts show {r.undefinedCodes.length > 1 ? 'them' : 'it'} as
          Unassigned.
        </p>
      )}
      {r.status === 'failed' && <p className="text-sm text-red-700">{r.note}</p>}
      {r.status === 'done' && (
        <>
          <p className="mb-3 text-xs text-muted-foreground">
            {r.source === 'ai'
              ? `Chosen and explained by the AI (${r.model ?? 'model'}) from ${r.signalCount ?? 0} signals.`
              : `Rule-based: the 3 strongest of ${r.signalCount ?? 0} signals, without the AI.`}
            {r.note && r.source !== 'ai' ? ` ${r.note}.` : ''} Made {dm(r.day)}
            {r.createdBy ? ` by ${r.createdBy}` : ''}.
          </p>
          {!r.findings?.length ? (
            <p className="text-sm text-muted-foreground">{r.note || 'No finding.'}</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {r.findings.map((f, i) => (
                <li key={i} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <b>
                      {i + 1}. {f.title}
                    </b>
                    <span className={`ml-auto rounded px-1.5 py-0.5 text-xs ${CONF_STYLE[f.confidence] ?? ''}`}>{f.confidence} confidence</span>
                  </div>
                  <p className="mt-1">{f.finding}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-muted-foreground">
                    <span>{f.evidence}</span>
                    {f.spark && f.spark.length > 1 && <Spark values={f.spark} />}
                  </div>
                  <p className="mt-1">
                    <b>Why a standard report misses it:</b> {f.whyNonObvious}
                  </p>
                  <p className="mt-1">
                    <b>Check first:</b> {f.firstCheck}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Estimated gain: {f.gainMinPerWeek} min / week{f.gainPiecesPerWeek ? ` ≈ ${f.gainPiecesPerWeek} pieces / week` : ''} · based on{' '}
                    {f.signalIds.join(', ')}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  )
}

function Spark({ values }: { values: number[] }) {
  const w = 96
  const h = 24
  const max = Math.max(...values, 1)
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * (h - 2) - 1}`).join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="text-primary" aria-label={`Series: ${values.join(', ')}`}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
