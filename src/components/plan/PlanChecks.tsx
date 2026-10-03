import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { type PlanOptimisation } from '../../lib/planPipeline'
import type { MaterialVerdictKind, PlanValidation } from '../../lib/planValidator'
import { InfoTip } from '../PageHeader'

/** Bağımsız doğrulama ve optimizasyon panelleri (Production Plan). */
const VERDICT_TEXT: Record<MaterialVerdictKind, { label: string; tone: string }> = {
  agree: { label: 'Really short', tone: 'text-destructive' },
  'engine-missed': { label: 'Engine missed it', tone: 'text-destructive font-semibold' },
  'engine-false-late': { label: 'False alarm', tone: 'text-amber-700' },
  'explained-unplanned': { label: 'Unplanned', tone: 'text-destructive' },
  'frozen-late': { label: 'Frozen job too late', tone: 'text-amber-700' },
}

/**
 * Bağımsız doğrulama: motordan ayrı bir kod stoğu saat saat yeniden yürütür,
 * kuralları yeniden sayar ve her eksik parça için "hiçbir plan kurtaramaz
 * mıydı?" sorusunu sınar. Motorun kendi denetimi motorun sayılarını
 * tekrarlar; bu ise ham veriden baştan hesaplar.
 */
export function IndependentCheck({ v }: { v: PlanValidation }) {
  const [open, setOpen] = useState(false)
  const sm = v.summary
  const rulesOk = sm.rulesBroken === 0
  const engineOk = sm.verdicts['engine-missed'] === 0 && sm.verdicts['engine-false-late'] === 0
  const short = v.materials.filter((m) => m.verdict !== 'engine-false-late' || m.stockouts > 0)
  return (
    <div
      className={`mt-6 rounded-lg border p-4 ${
        rulesOk && engineOk ? 'border-sky-200 bg-sky-50/60' : 'border-destructive bg-destructive/10'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">
          Independent check —{' '}
          {rulesOk && engineOk ? 'the plan and its late list are confirmed' : 'differences found'}{' '}
          <InfoTip label="About the independent check">
            Separate code, not the planner's, replays stock hour by hour from the SAP files and the
            planned jobs, re-checks every rule, and tests whether any plan could have avoided each
            shortage. <Link to="/planlogic" hash="check">Planning Logic</Link>
          </InfoTip>
        </h2>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
        >
          {open ? 'Hide ▴' : 'Details ▾'}
        </button>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <CheckStat label="Parts really short (stock replay)" value={sm.realStockouts} warn={sm.realStockouts > 0} />
        <CheckStat
          label="Minimum any plan can reach"
          value={sm.lateLowerBound}
          hint={`work center load ${sm.lateLowerBoundBy.press} · setup crew ${sm.lateLowerBoundBy.setupCrew} · hall crane ${sm.lateLowerBoundBy.hallCrane}`}
        />
        <CheckStat
          label="Late list vs replay"
          value={sm.verdicts['engine-missed'] + sm.verdicts['engine-false-late']}
          hint={`${sm.verdicts['engine-missed']} missed · ${sm.verdicts['engine-false-late']} false alarms`}
          warn={!engineOk}
        />
        <CheckStat label="Rules broken" value={sm.rulesBroken} warn={!rulesOk} hint={sm.rulesFailed.join(', ') || 'none'} />
        <CheckStat label="Setups (plan / minimum)" value={`${sm.setups.plan} / ${sm.setups.lowerBound}`} />
        <CheckStat label="Production time (plan / max possible)" value={`${sm.utilisation.plan}% / ${sm.utilisation.upperBound}%`} />
        <CheckStat
          label="Idle waiting for the setup crew"
          value={`${Math.round(v.efficiency.idleHours.waitingCrew)} h`}
          warn={v.efficiency.idleHours.waitingCrew > 0}
          hint={`next ${v.efficiency.windowDays} days`}
        />
        <CheckStat label="Data to check" value={sm.dataSuspect} warn={sm.dataSuspect > 0} />
      </dl>
      {open && (
        <div className="mt-4 space-y-4">
          {short.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-border bg-background">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Part</th>
                    <th className="px-3 py-2 font-medium">Verdict</th>
                    <th className="px-3 py-2 font-medium">First short</th>
                    <th className="px-3 py-2 text-right font-medium">Short pcs</th>
                    <th className="px-3 py-2 font-medium">Could any plan avoid it?</th>
                    <th className="px-3 py-2 font-medium">Data to check</th>
                  </tr>
                </thead>
                <tbody>
                  {short.slice(0, 100).map((m) => (
                    <tr key={m.group} className="border-t border-border align-top">
                      <td className="px-3 py-1.5 font-medium text-foreground">{m.group}</td>
                      <td className={`px-3 py-1.5 ${VERDICT_TEXT[m.verdict].tone}`}>{VERDICT_TEXT[m.verdict].label}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{m.firstShortAt ?? '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{Math.round(m.shortQty).toLocaleString('en-GB')}</td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">
                        {m.feasibility ? (
                          <>
                            <span
                              className={
                                m.feasibility.verdict === 'capacity-proven'
                                  ? 'font-medium text-foreground'
                                  : m.feasibility.verdict === 'avoidable'
                                    ? 'font-medium text-destructive'
                                    : ''
                              }
                            >
                              {m.feasibility.verdict === 'capacity-proven'
                                ? 'No — '
                                : m.feasibility.verdict === 'avoidable'
                                  ? 'Yes — '
                                  : 'Not proven — '}
                            </span>
                            {m.feasibility.reason}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-amber-800">{m.dataFlags.join(' · ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {v.rules.map((r) => (
              <li key={r.id}>
                <span className={r.broken === 0 ? 'text-emerald-700' : 'text-destructive'}>
                  {r.broken === 0 ? '✓' : '✗'}
                </span>{' '}
                <span className="text-foreground">{r.label}</span>{' '}
                <span className="text-xs text-muted-foreground">
                  ({r.checked.toLocaleString('en-GB')} checked{r.broken > 0 ? `, ${r.broken} broken` : ''})
                </span>
                {r.examples.length > 0 && r.broken > 0 && (
                  <ul className="ml-5 list-disc text-xs text-destructive">
                    {r.examples.slice(0, 5).map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          {v.warnings.length > 0 && (
            <ul className="list-inside list-disc text-xs text-muted-foreground">
              {v.warnings.slice(0, 10).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function CheckStat({
  label,
  value,
  hint,
  warn,
}: {
  label: string
  value: number | string
  hint?: string
  warn?: boolean
}) {
  return (
    <div className="rounded-md border border-border bg-background p-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-lg font-semibold tabular-nums ${warn ? 'text-destructive' : 'text-foreground'}`}>
        {typeof value === 'number' ? value.toLocaleString('en-GB') : value}
      </dd>
      {hint && <dd className="text-[11px] text-muted-foreground">{hint}</dd>}
    </div>
  )
}

const STOP_TEXT: Record<PlanOptimisation['stoppedBecause'], string> = {
  target: 'target reached',
  noImprovement: 'no better scenario in the last 25 tries',
  limit: 'scenario limit reached',
  time: 'time limit reached',
}

/**
 * Senaryo araması: aynı veriyle farklı sıralama ve pres seçim kurallarıyla
 * planlar kurulur; geç işi en az, doluluğu en yüksek olan seçilir.
 */
export function OptimisationPanel({ opt }: { opt: PlanOptimisation }) {
  const reached = opt.achieved >= opt.target
  const pct = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString('en-GB')}%`
  const [open, setOpen] = useState(false)
  return (
    <div
      className={`mt-6 rounded-lg border p-4 ${
        reached ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/70'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">
          Work center utilisation {pct(opt.achieved)}{' '}
          <span className="font-normal text-muted-foreground">
            (target {pct(opt.target)}, next {opt.windowDays} days)
          </span>
        </h2>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
        >
          {open ? 'Hide ▴' : 'Details ▾'}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {reached
          ? `Target reached. `
          : `Target not reached — the best of ${opt.tried} scenario(s) reaches ${pct(opt.achieved)}. `}
        Tried {opt.tried} scenario(s), stopped: {STOP_TEXT[opt.stoppedBecause]}. Chosen:{' '}
        <strong className="text-foreground">{opt.chosen}</strong> (standard plan {pct(opt.standard)}).
        {opt.localSearch && opt.localSearch.evaluations > 0 &&
          `Local search on the late parts: ${opt.localSearch.evaluations} moves tried, ${opt.localSearch.improvements} kept. `}
        Fewest late items always wins over higher utilisation.
      </p>
      {open && (
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="overflow-x-auto rounded-md border border-border bg-background">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Work center</th>
                  <th className="px-3 py-2 text-right font-medium">Available h</th>
                  <th className="px-3 py-2 text-right font-medium">Busy h</th>
                  <th className="px-3 py-2 text-right font-medium">Utilisation</th>
                </tr>
              </thead>
              <tbody>
                {opt.perPress.map((p) => (
                  <tr key={p.press} className="border-t border-border">
                    <td className="px-3 py-1.5 font-medium text-foreground">{p.press}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{p.capacityHours.toFixed(1)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{p.busyHours.toFixed(1)}</td>
                    <td
                      className={`px-3 py-1.5 text-right tabular-nums ${
                        p.utilisation < opt.target ? 'text-amber-700' : 'text-emerald-700'
                      }`}
                    >
                      {pct(p.utilisation)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto rounded-md border border-border bg-background">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Scenario</th>
                  <th className="px-3 py-2 text-right font-medium">Late</th>
                  <th className="px-3 py-2 text-right font-medium">Late h</th>
                  <th className="px-3 py-2 text-right font-medium">Setups</th>
                  <th className="px-3 py-2 text-right font-medium">Utilisation</th>
                </tr>
              </thead>
              <tbody>
                {opt.scenarios.map((sc) => (
                  <tr
                    key={sc.label}
                    className={`border-t border-border ${sc.label === opt.chosen ? 'font-semibold text-foreground' : ''}`}
                  >
                    <td className="px-3 py-1.5">
                      {sc.label}
                      {sc.label === opt.chosen && ' ✓'}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {sc.late}
                      {sc.unplanned > 0 && ` +${sc.unplanned} unplanned`}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{Math.round(sc.lateHours)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{sc.setups}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{pct(sc.utilisation)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
