import { createFileRoute, Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { api } from '../../../convex/_generated/api'
import { OeeRebuildNotice, OeeUploadButton } from '../../components/OeePanel'
import { PageHeader } from '../../components/PageHeader'
import { useQuery } from '../../lib/convexTransport'

export const Route = createFileRoute('/oee/guide')({
  component: OeeGuidePage,
})

/**
 * Kullanım yöntemi — programı kullanan her tesis için. Kural: geçmiş
 * silinmez; aynı satır tekrar gelirse güncellenir, mükerrer olmaz.
 */

type Span = { from: string; to: string } | null

function OeeGuidePage() {
  const coverage = useQuery(api.oee.coverage) as
    | { days: Span; shifts: Span; orders: Span; downtimes: Span; weekly: Span }
    | undefined
  const settings = useQuery(api.oee.settings) as { updatedAt: number } | null | undefined

  return (
    <div className="w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="How to use OEE"
        summary="Once: load the history and define your plant. Then: upload the last two weeks whenever you like."
        links={[
          { to: '/oee', label: 'OEE Dashboard' },
          { to: '/oee/settings', label: 'Settings' },
          { to: '/oee/data', label: 'Data' },
        ]}
      />

      <OeeRebuildNotice />

      <section className="mt-6 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">What is stored now</h2>
        <table className="mt-2 w-full text-sm">
          <tbody>
            <Status label="Days (Shiftly / Daily KPI)" span={coverage?.days} />
            <Status label="Shifts (Shiftly KPI)" span={coverage?.shifts} />
            <Status label="Orders (Shiftly Order Based KPI)" span={coverage?.orders} />
            <Status label="Downtimes" span={coverage?.downtimes} />
            <Status label="Weeks (Weekly KPI)" span={coverage?.weekly} />
            <tr className="border-t border-border">
              <td className="py-1.5 pr-4 text-muted-foreground">Settings</td>
              <td className="py-1.5">
                {settings ? (
                  `saved ${new Date(settings.updatedAt).toLocaleString('en-GB')}`
                ) : (
                  <Link to="/oee/settings" className="text-amber-700 underline">
                    not defined yet
                  </Link>
                )}
              </td>
            </tr>
          </tbody>
        </table>
        <div className="mt-3">
          <OeeUploadButton />
        </div>
      </section>

      <Step n={1} title="Once — load the history">
        <p>
          Export from your system, from the start of the year until today, and put the sheets in one
          Excel file (or upload several files one after the other):
        </p>
        <ul>
          <li>
            <b>Daily KPI</b> — one row per day and machine (history of the days).
          </li>
          <li>
            <b>Weekly KPI</b> (and / or <b>Weekly KPI_fix</b>) — one row per week and machine.
          </li>
          <li>
            <b>Monthly KPI</b> — one row per month and machine; the <b>first column is Year</b>.
          </li>
          <li>
            <b>Shiftly KPI</b>, <b>Shiftly Order Based KPI</b> and <b>Downtimes</b> — as far back as your
            system gives them (at least the last two weeks).
          </li>
        </ul>
        <p>
          Work center <b>Upload data</b>. The program reads the sheets it knows by their names and ignores the
          rest; the columns are found by their titles, so the order of the columns does not matter.
        </p>
        <p>
          <b>Every dated sheet must start on a Monday</b> (or on 1 January for the history from the start
          of the year). A file that starts on another day is not uploaded at all — the first week would
          be half a week and would overwrite the full week already stored.
        </p>
      </Step>

      <Step n={2} title="Once — define your plant">
        <p>
          Open <Link to="/oee/settings">Settings</Link> and press <b>Suggest from data</b>. Check the
          suggestion and correct it:
        </p>
        <ul>
          <li>
            departments — each department of the plant is a button on top of every page and its OEE is the
            OEE of its cost centers; departments, cost centers and their names are set on Company settings →
            Organization (in Settings you only choose how to pick inside a department),
          </li>
          <li>shift numbers of the Shift Group codes,</li>
          <li>which Reason Code 1 is a loss and which is a planned break,</li>
          <li>names of the loss groups (Reason Code 2), their chart columns and which are breakdowns,</li>
          <li>which downtime texts are a planned or unplanned setup,</li>
          <li>production time after a setup for OK, weeks in the trends, rows in the top lists.</li>
        </ul>
        <p>Work center Save. Nothing specific to your plant is written in the program — it is all here.</p>
      </Step>

      <Step n={3} title="Every time — upload the last two weeks">
        <p>
          Export <b>Shiftly KPI</b>, <b>Shiftly Order Based KPI</b>, <b>Weekly KPI</b>, <b>Monthly KPI</b>{' '}
          and <b>Downtimes</b> for the last two weeks, <b>starting on a Monday</b>, into one file and press{' '}
          <b>Upload data</b> — daily, weekly, whenever you like.
        </p>
        <ul>
          <li>
            <b>Nothing is deleted.</b> Days that are not in the file stay as they are.
          </li>
          <li>
            <b>No duplicates.</b> A row that is already stored is updated, not added again:
            <ul>
              <li>shift: date + machine + shift group,</li>
              <li>order: date + machine + shift + order + equipment,</li>
              <li>downtime: all downtimes of a day and machine that is in the file are replaced by the file (a downtime moved or split in the system is not counted twice),</li>
              <li>week: year + week + machine; month: year + month + machine.</li>
            </ul>
          </li>
          <li>
            A correction in the system (a reason code changed, a shift completed later) reaches the
            program the next time that day is in the file.
          </li>
          <li>Daily KPI is not needed any more: days are calculated from the shifts. A newer Weekly or Monthly row replaces the stored one.</li>
        </ul>
      </Step>

      <Step n={4} title="Check">
        <ul>
          <li>The line above the charts shows which days are stored.</li>
          <li>
            <Link to="/oee/data">Data</Link> shows every sheet in the order of the file, with the source of
            each day and week.
          </li>
          <li>If a page says the settings are not complete, open Settings — usually a new code appeared in the data.</li>
        </ul>
      </Step>

      <Step n={5} title="How the numbers are made">
        <ul>
          <li>OEE = Availability × Performance × Quality; Availability = Production ÷ Loading, Performance = Operation ÷ Production.</li>
          <li>Times are always added first and divided once — a week is never the average of its days.</li>
          <li>
            A day is the sum of its shifts, or the Daily KPI row when no shifts were uploaded. A week or
            month is the sum of its days, or the uploaded Weekly / Monthly KPI row when that covers more
            loading time.
          </li>
          <li>Die OEE is weighted by good quantity, as in the source report.</li>
        </ul>
      </Step>
    </div>
  )
}

function Status({ label, span }: { label: string; span: Span | undefined }) {
  return (
    <tr className="border-t border-border first:border-t-0">
      <td className="py-1.5 pr-4 text-muted-foreground">{label}</td>
      <td className="py-1.5 tabular-nums">{span === undefined ? '…' : span ? `${span.from} – ${span.to}` : 'nothing yet'}</td>
    </tr>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-xs text-background">{n}</span>
        {title}
      </h2>
      <div className="mt-2 space-y-2 text-sm text-muted-foreground [&_a]:underline [&_b]:text-foreground [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-1">
        {children}
      </div>
    </section>
  )
}
