import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { AgentReportView, SECTION_TITLES, headlineText } from '../../components/AgentReportView'
import { DieFollowUpDialog, type FollowUpDraft } from '../../components/DieFollowUpDialog'
import { OeeControls, OeeDataNotice, effectiveScope, useOeeConfig, useOeeSelection } from '../../components/OeePanel'
import { dm } from '../../components/OeePeriodControl'
import { PageHeader } from '../../components/PageHeader'
import { SavePdfButton } from '../../components/SavePdfButton'
import { agentReportPdf } from '../../lib/agentPdf'
import { useQuery } from '../../lib/convexTransport'
import { relatedPages } from '../../lib/navigation'
import { addDaysIso, areaNames, costCentersOf, inScope, scopeLabel, type DayRow, type OrderRow, type ShiftRow } from '../../lib/oee'
import { agentReport, type AgentNote, type DieTopic, type MachineTopic, type MoldAlarmRow } from '../../lib/oeeAgent'
import { useOeeFilters } from '../../lib/oeeFilters'
import { fromStoredDay, fromStoredLosses, type StoredDowntimeDay, type StoredLossDay } from '../../lib/oeeStore'
import { pdfFileName } from '../../lib/pdfFile'
import { useCanOpen, usePlant } from '../../lib/plantContext'

export const Route = createFileRoute('/oee/agent')({
  component: AgentReportPage,
})

/**
 * OEE Agent Report (planlamacı, 2026-10-16): seçilen günün kısa notları — kalıp,
 * pres / makine, vardiya, tekrar eden duruşlar, açık konular, iyi haberler; en üstte
 * yönetim özeti. Kurallar src/lib/oeeAgent.ts, kararlar docs/oee-agent-report.md.
 */
function AgentReportPage() {
  const sel = useOeeSelection()
  const { config } = useOeeConfig()
  const canOpen = useCanOpen()
  const { can, canArea } = usePlant()
  const [filters, setFilters] = useOeeFilters()
  const coverage = useQuery(api.oee.coverage) as { days: { from: string; to: string } | null } | undefined
  const lastDay = coverage?.days?.to ?? null
  // Rapor tek gün: seçili gün, veri o güne kadar yoksa son yüklü gün.
  const day = lastDay && sel.date > lastDay ? lastDay : sel.date
  const weekFrom = addDaysIso(day, -6)

  const daysRaw = useQuery(api.oee.days, { from: addDaysIso(day, -27), to: day }) as DayRow[] | undefined
  const lossesRaw = useQuery(api.oee.lossDays, { from: addDaysIso(day, -27), to: day }) as StoredLossDay[] | undefined
  const shiftsRaw = useQuery(api.oee.shifts, { from: weekFrom, to: day }) as ShiftRow[] | undefined
  const evRaw = useQuery(api.oee.downtimeDays, { from: weekFrom, to: day }) as StoredDowntimeDay[] | undefined
  const ordersRaw = useQuery(api.oee.orders, { from: weekFrom, to: day }) as OrderRow[] | undefined
  const dayRows = useMemo(() => daysRaw ?? [], [daysRaw])
  const shiftRows = useMemo(() => shiftsRaw ?? [], [shiftsRaw])
  const orders = useMemo(() => ordersRaw ?? [], [ordersRaw])
  // Açık konular: yalnızca modülü görebilene (sunucu da aynı izni ister).
  const dieOk = can('die') || can('planning')
  const machineOk = can('machine') || can('planning')
  const dieRaw = useQuery(api.moldProblems.list, dieOk ? {} : 'skip') as (DieTopic & { _id: string })[] | undefined
  const alarmRaw = useQuery(api.moldAlarms.list, dieOk ? {} : 'skip') as MoldAlarmRow[] | undefined
  const machineRaw = useQuery(api.machineProblems.list, machineOk ? {} : 'skip') as (MachineTopic & { _id: string })[] | undefined

  const lossDays = useMemo(() => fromStoredLosses(lossesRaw ?? []), [lossesRaw])
  const events = useMemo(() => (evRaw ?? []).map(fromStoredDay), [evRaw])
  const scope = effectiveScope(sel.scope, areaNames(dayRows, config))
  const machineOptions = useMemo(
    () => [...new Set(dayRows.filter((r) => inScope(r, scope, config)).map((r) => r.workCenter))].sort(),
    [dayRows, scope, config],
  )
  const machine = machineOptions.includes(filters.machine) ? filters.machine : ''
  const wcCostCenter = useMemo(() => costCentersOf(dayRows), [dayRows])

  const report = useMemo(() => {
    const inSel = (r: { workCenter: string; costCenter: string }) => inScope(r, scope, config) && (!machine || r.workCenter === machine)
    const inSelWc = (wc: string) => inSel({ workCenter: wc, costCenter: wcCostCenter.get(wc) ?? '' })
    return agentReport({
      day,
      config,
      days: dayRows.filter(inSel),
      lossDays: lossDays.filter(inSel),
      shifts: shiftRows.filter(inSel),
      events: events.filter(inSel),
      orders: orders.filter((o) => inSelWc(o.workCenter)),
      dieTopics: dieOk ? (dieRaw ?? []).map((p) => ({ ...p, id: p._id })) : null,
      // Makine konusu: seçili iş yerlerininkiler.
      machineTopics: machineOk ? (machineRaw ?? []).filter((p) => inSelWc(p.press)).map((p) => ({ ...p, id: p._id })) : null,
      moldAlarms: dieOk ? (alarmRaw ?? []) : null,
    })
  }, [day, config, dayRows, lossDays, shiftRows, events, orders, dieRaw, machineRaw, alarmRaw, dieOk, machineOk, scope, machine, wcCostCenter])

  const loading =
    coverage === undefined || [daysRaw, lossesRaw, shiftsRaw, evRaw, ordersRaw].some((x) => x === undefined) ||
    (dieOk && (dieRaw === undefined || alarmRaw === undefined)) ||
    (machineOk && machineRaw === undefined)
  const label = `${scopeLabel(scope, config)}${machine ? ` · ${machine}` : ''}`
  const canFollow = canArea('die.problems', 'edit') || canArea('planning.plan', 'edit')
  const [draft, setDraft] = useState<FollowUpDraft | null>(null)
  const followUp = canFollow
    ? (n: AgentNote) =>
        n.followUp &&
        setDraft({ ...n.followUp, period: dm(day), source: 'OEE Agent Report' })
    : undefined
  const fileName = pdfFileName(day, 'AGENT REPORT')
  const title = `Agent Report · ${label} · ${dm(day)}`
  const notes = [
    ...(lastDay && sel.date > lastDay ? [`No OEE data uploaded for ${dm(sel.date)} yet — the report shows ${dm(lastDay)}, the last uploaded day.`] : []),
  ]

  return (
    <div className="mx-auto w-full max-w-[210mm] px-4 py-6 pb-24 sm:px-0 sm:py-8">
      <PageHeader
        title="Agent Report"
        summary="One day in short notes for management: what went wrong on dies, presses and shifts, what repeats, and which open topics cost time."
        links={relatedPages('/oee/agent')}
        info={
          <>
            <p>
              Every note is written by fixed rules from the uploaded OEE data of the day and the 7 or 28 days before it — no guessing, no AI.
              Numbers are those of the Loss Bridge: minutes are added up, rates come from the sums.
            </p>
            <p>
              <b>Critical</b>: act today. <b>Warning</b>: follow up, it grows. <b>Watch</b>: small, but a pattern. <b>Good news</b>: a clear
              improvement or a topic that may be solved. The summary lists the critical points and warnings with the most lost time, one per
              part or work center.
            </p>
            <p>
              Thresholds and which loss groups are die or machine losses: <Link to="/oee/settings">OEE Settings</Link> → Agent Report and
              Loss groups.
            </p>
          </>
        }
      />
      <OeeControls
        selection={sel}
        rows={dayRows}
        config={config}
        extra={
          <label className="filter-label flex flex-col gap-1">
            Machine
            <select
              value={machine}
              onChange={(e) => setFilters({ machine: e.target.value })}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
            >
              <option value="">All in the selection</option>
              {machineOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        }
        actions={
          <SavePdfButton
            fileName={fileName}
            disabled={loading}
            make={() =>
              agentReportPdf(report, {
                title: `OEE Agent Report · ${dm(day)}`,
                headline: headlineText(report),
                filters: [label, `Day ${dm(day)}`, 'All shifts'],
                sections: SECTION_TITLES,
              })
            }
          />
        }
      />
      <OeeDataNotice items={notes} />

      <div className="mt-4">
        {loading ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Reading the day…</p>
        ) : (
          <AgentReportView report={report} title={title} onFollowUp={followUp} canOpen={canOpen} />
        )}
      </div>
      {draft && <DieFollowUpDialog draft={draft} onClose={() => setDraft(null)} />}
    </div>
  )
}
