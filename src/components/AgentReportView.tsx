import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { dmShort, duration, type AgentNote, type AgentReport, type NoteLevel, type NoteSection } from '../lib/oeeAgent'

/** Seviye: ad, renk (ekran ve PDF aynı — src/lib/agentPdf.ts). */
export const LEVELS: Record<NoteLevel, { label: string; dot: string; chip: string }> = {
  critical: { label: 'Critical', dot: '#c62828', chip: 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200' },
  warning: { label: 'Warning', dot: '#d97706', chip: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200' },
  watch: { label: 'Watch', dot: '#2a78d6', chip: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200' },
  good: { label: 'Good news', dot: '#13795b', chip: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200' },
}

export const SECTION_TITLES: Record<NoteSection, { title: string; hint: string }> = {
  dies: { title: 'Dies', hint: 'Die losses by part, open die topics, dies over their shot limit, scrap and reject.' },
  machines: { title: 'Presses and machines', hint: 'Breakdowns, OEE against the 4-week average, longer stops, short stops.' },
  shifts: { title: 'Shifts', hint: 'Weakest shift of the day, shift patterns, speed loss, downtime without a reason.' },
  repeats: { title: 'Repeating stops', hint: 'The same stop on several days of the last 7 — on one press, or following the part.' },
  topics: { title: 'Open topics', hint: 'Did a die or machine topic that is still open cost time on this day?' },
  good: { title: 'Good news', hint: 'Clear improvements and topics that may be solved.' },
}

const ORDER: NoteSection[] = ['dies', 'machines', 'shifts', 'repeats', 'topics', 'good']

const pct = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(1)}%`)

/** Başlık cümlesi: tesisin OEE'si, 4 haftalık ortalamaya göre, not sayıları. */
export function headlineText(r: AgentReport): string {
  const h = r.headline
  const diff = h.oee !== null && h.baseOee !== null ? (h.oee - h.baseOee) * 100 : null
  const parts = [
    `OEE ${pct(h.oee)} on ${dmShort(r.day)}${diff !== null ? ` (${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(1)} pts against the 4-week average)` : ''}`,
    `loading ${duration(h.loadingMin)} on ${h.workCenters} work center${h.workCenters === 1 ? '' : 's'}`,
  ]
  const c = r.counts
  const counts = [
    c.critical && `${c.critical} critical`,
    c.warning && `${c.warning} warning${c.warning === 1 ? '' : 's'}`,
    c.watch && `${c.watch} to watch`,
    c.good && `${c.good} good`,
  ].filter(Boolean)
  return `${parts.join(' · ')}. ${counts.length ? `${counts.join(', ')}.` : 'Nothing above the thresholds.'}`
}

export function AgentReportView({
  report,
  title,
  actions,
  onFollowUp,
  canOpen = () => true,
}: {
  report: AgentReport
  title: ReactNode
  actions?: ReactNode
  /** Die Follow-up penceresi (yetkisi olana). */
  onFollowUp?: (n: AgentNote) => void
  canOpen?: (path: string) => boolean
}) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-foreground">{title}</h2>
          <p className="mt-0.5 text-sm text-foreground">{headlineText(report)}</p>
        </div>
        {actions}
      </div>

      {report.notices.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {report.notices.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <section className="mt-4 rounded-xl border-2 border-[#1e3a5f]/40 bg-[#eef3f8] p-3 dark:border-[#dbe7f3]/30 dark:bg-[#16263a]">
        <h3 className="text-sm font-bold tracking-wide text-[#1e3a5f] uppercase dark:text-[#dbe7f3]">Summary for management</h3>
        {report.summary.length === 0 ? (
          <p className="mt-1 text-sm text-foreground">No critical point or warning on {dmShort(report.day)}.</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {report.summary.map((n, i) => (
              <li key={n.key} className="flex gap-2 text-sm">
                <span className="w-4 shrink-0 text-right font-bold text-foreground tabular-nums">{i + 1}.</span>
                <span className="min-w-0">
                  <LevelChip level={n.level} /> <span className="font-semibold text-foreground">{n.title}</span>{' '}
                  <span className="text-muted-foreground">→ {n.owner}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {ORDER.map((s) => (
        <section key={s} className="mt-5">
          <div className="flex flex-wrap items-baseline gap-x-2 border-b border-border pb-1">
            <h3 className="text-base font-bold text-foreground">{SECTION_TITLES[s].title}</h3>
            <p className="text-xs text-muted-foreground">{SECTION_TITLES[s].hint}</p>
          </div>
          {report.sections[s].length === 0 && !(s === 'topics' && (report.quietTopics.length || report.affectedTopics.length)) ? (
            <p className="mt-2 text-sm text-muted-foreground">Nothing to report.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {report.sections[s].map((n) => (
                <NoteRow key={n.key} note={n} onFollowUp={onFollowUp} canOpen={canOpen} />
              ))}
            </ul>
          )}
          {report.hidden[s] > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              + {report.hidden[s]} smaller note{report.hidden[s] === 1 ? '' : 's'} not shown.
            </p>
          )}
          {s === 'topics' && report.affectedTopics.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Cost time on {dmShort(report.day)}:</span> {report.affectedTopics.join(' · ')}
            </p>
          )}
          {s === 'topics' && report.quietTopics.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">No loss on {dmShort(report.day)}:</span> {report.quietTopics.join(' · ')}
            </p>
          )}
        </section>
      ))}
    </div>
  )
}

function LevelChip({ level }: { level: NoteLevel }) {
  const l = LEVELS[level]
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-px align-[1px] text-[10px] font-bold tracking-wide uppercase ${l.chip}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: l.dot }} />
      {l.label}
    </span>
  )
}

function NoteRow({ note: n, onFollowUp, canOpen }: { note: AgentNote; onFollowUp?: (n: AgentNote) => void; canOpen: (p: string) => boolean }) {
  return (
    <li className="rounded-lg border border-border px-3 py-2" style={{ borderLeft: `4px solid ${LEVELS[n.level].dot}` }}>
      <p className="text-sm">
        <LevelChip level={n.level} /> <span className="font-semibold text-foreground">{n.title}</span>
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{n.evidence}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          Owner: <span className="font-medium text-foreground">{n.owner}</span>
        </span>
        {n.link && canOpen(n.link.to) && (
          <Link to={n.link.to} search={n.link.search as never} className="font-medium text-foreground underline underline-offset-2 print:hidden">
            {n.link.label}
          </Link>
        )}
        {n.followUp && onFollowUp && (
          <button
            type="button"
            onClick={() => onFollowUp(n)}
            className="rounded border border-[var(--viz-1,#2a78d6)]/40 bg-[#2a78d6]/10 px-1.5 py-0.5 font-medium text-foreground hover:bg-[#2a78d6]/20 print:hidden"
          >
            + Open follow-up
          </button>
        )}
      </p>
    </li>
  )
}
