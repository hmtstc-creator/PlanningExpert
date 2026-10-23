import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { useOeeConfig } from '../../components/OeePanel'
import { dm } from '../../components/OeePeriodControl'
import { PageHeader } from '../../components/PageHeader'
import { useMutation, useQuery } from '../../lib/convexTransport'
import { relatedPages } from '../../lib/navigation'
import { costCenterName } from '../../lib/oee'
import { TOPIC_DEFAULTS } from '../../lib/oeeTopics'
import { usePlant } from '../../lib/plantContext'

export const Route = createFileRoute('/oee/topics')({
  component: OpenTopicsPage,
})

interface Topic {
  id: string
  key: string
  costCenter: string
  workCenter: string
  groupLabel: string
  title: string
  analysis?: string
  action?: string
  evidence: string
  source: string
  firstDay: string
  lastDay: string
  seenDays: number
  status: string
  closedBy?: string
  closeNote?: string
}

interface Run {
  day: string
  status: string
  candidates?: number
  added?: number
  updated?: number
  note?: string
}

/**
 * OEE açık konular (planlamacı, 2026-10-23): ajanın kronik ve kritik bulduğu
 * kayıplar, masraf yeri bazında. Kurallar src/lib/oeeTopics.ts, ajan
 * convex/oeeTopics.ts, kararlar docs/oee-agent-report.md.
 */
function OpenTopicsPage() {
  const { config } = useOeeConfig()
  const { canArea } = usePlant()
  const canEdit = canArea('oee.data', 'edit')
  const [status, setStatus] = useState<'open' | 'closed'>('open')
  const topics = useQuery(api.oeeTopics.list, { status }) as Topic[] | undefined
  const info = useQuery(api.oeeTopics.runs) as { runs: Run[]; aiConfigured: boolean } | undefined
  const runNow = useMutation(api.oeeTopics.runNow)
  const close = useMutation(api.oeeTopics.close)
  const reopen = useMutation(api.oeeTopics.reopen)
  const [closing, setClosing] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const byCostCenter = useMemo(() => {
    const map = new Map<string, Topic[]>()
    for (const t of topics ?? []) map.set(t.costCenter, [...(map.get(t.costCenter) ?? []), t])
    return [...map.entries()].sort(([a], [b]) => costCenterName(a, config).localeCompare(costCenterName(b, config)))
  }, [topics, config])
  const last = info?.runs[0]

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 pb-24 sm:py-8">
      <PageHeader
        title="Open Topics"
        summary="Chronic and critical losses found by the agent after each OEE upload, by cost center and work center."
        links={relatedPages('/oee/topics')}
        info={
          <>
            <p>
              After an OEE upload the agent looks at the last uploaded day once. A loss group of a work center is a candidate when it lost at
              least {TOPIC_DEFAULTS.dayMin} min that day and also lost time in earlier weeks. It looks back {TOPIC_DEFAULTS.lookbackWeeks} weeks
              (7 days each); a week counts when the loss was at least {TOPIC_DEFAULTS.weekMin} min.
            </p>
            <p>
              The AI model decides whether a candidate is really chronic and critical. Without the AI (no key, no answer) the rules decide:
              lost time in at least {TOPIC_DEFAULTS.chronicWeeks} of the earlier weeks, at least {TOPIC_DEFAULTS.weekMin} min in the last 7 days
              and not less than the average of the earlier weeks.
            </p>
            <p>
              A day is analysed only once. An open topic is not written again: when it shows up the next day, only <i>last seen</i> and
              <i> days seen</i> change. Close a topic with a note when it is solved; if it comes back, the agent opens a new one.
            </p>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <div className="inline-flex rounded-md border border-input">
          {(['open', 'closed'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`px-3 py-1.5 ${status === s ? 'bg-primary text-primary-foreground' : ''}`}
            >
              {s === 'open' ? 'Open' : 'Closed'}
            </button>
          ))}
        </div>
        <span className="text-muted-foreground">
          {last
            ? `Last analysis: ${dm(last.day)} — ${last.status === 'done' ? `${last.added ?? 0} new, ${last.updated ?? 0} seen again of ${last.candidates ?? 0} candidates` : last.status}${last.note ? ` · ${last.note}` : ''}`
            : 'No analysis yet.'}
          {info && !info.aiConfigured && ' · AI not set up: the rules decide.'}
        </span>
        {canEdit && (
          <button type="button" onClick={() => runNow({})} className="ml-auto rounded-md border border-input px-3 py-1.5">
            Analyse the last day
          </button>
        )}
      </div>

      {topics === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !topics.length ? (
        <p className="text-sm text-muted-foreground">{status === 'open' ? 'No open topic.' : 'No closed topic.'}</p>
      ) : (
        byCostCenter.map(([cc, list]) => (
          <section key={cc} className="mb-6">
            <h2 className="mb-2 text-base font-semibold">
              {costCenterName(cc, config)} <span className="font-normal text-muted-foreground">· {list.length}</span>
            </h2>
            <ul className="flex flex-col gap-2">
              {list.map((t) => (
                <li key={t.id} className="rounded-md border border-border bg-card p-3 text-sm">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800">Critical</span>
                    <b>{t.title}</b>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {t.workCenter} · {t.groupLabel} · {t.source === 'ai' ? 'AI' : 'rules'}
                    </span>
                  </div>
                  {t.analysis && <p className="mt-1">{t.analysis}</p>}
                  {t.action && (
                    <p className="mt-1">
                      <b>Action:</b> {t.action}
                    </p>
                  )}
                  <p className="mt-1 text-muted-foreground">{t.evidence}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    First {dm(t.firstDay)} · last seen {dm(t.lastDay)} · {t.seenDays} day{t.seenDays === 1 ? '' : 's'} seen
                    {t.status === 'closed' && ` · closed${t.closedBy ? ` by ${t.closedBy}` : ''}: ${t.closeNote ?? ''}`}
                  </p>
                  {canEdit &&
                    (t.status === 'open' ? (
                      closing === t.id ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <input
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="What was done / why it is closed"
                            className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1"
                          />
                          <button
                            type="button"
                            disabled={!note.trim()}
                            onClick={async () => {
                              await close({ id: t.id, note })
                              setClosing(null)
                              setNote('')
                            }}
                            className="rounded-md bg-primary px-3 py-1 text-primary-foreground disabled:opacity-50"
                          >
                            Close
                          </button>
                          <button type="button" onClick={() => setClosing(null)} className="rounded-md border border-input px-3 py-1">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => setClosing(t.id)} className="mt-2 rounded-md border border-input px-3 py-1">
                          Close topic
                        </button>
                      )
                    ) : (
                      <button type="button" onClick={() => reopen({ id: t.id })} className="mt-2 rounded-md border border-input px-3 py-1">
                        Reopen
                      </button>
                    ))}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
