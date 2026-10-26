import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo, useRef } from 'react'

import { api } from '../../../convex/_generated/api'
import { AsakaiBars, AsakaiStacked, Cell, SHEET_FONT, SHEET_WIDTH, X, colTitle, pct, share } from '../../components/AsakaiSheet'
import { OeeControls, effectiveScope, useOeeConfig, useOeeSelection } from '../../components/OeePanel'
import { dm } from '../../components/OeePeriodControl'
import { PageHeader } from '../../components/PageHeader'
import { SavePdfButton } from '../../components/SavePdfButton'
import { useQuery } from '../../lib/convexTransport'
import { relatedPages } from '../../lib/navigation'
import { addDaysIso, areaNames, visibleChartGroups, type DayRow, type MonthlyRow, type WeeklyRow } from '../../lib/oee'
import { ASAKAI_DAYS, ASAKAI_WEEKS, asakaiColumns, asakaiWeekly, dropEmptyUnassigned, type WeeklyGroup } from '../../lib/oeeAsakai'
import { fromStoredStops, type StoredStopDay } from '../../lib/oeeReliability'
import { splitShortStops } from '../../lib/oeeShortStops'
import { fromStoredLosses, type StoredLossDay } from '../../lib/oeeStore'
import { pdfFileName } from '../../lib/pdfFile'
import { sheetToPdf } from '../../lib/pdfSheet'

export const Route = createFileRoute('/oee/asakai-weekly')({
  component: AsakaiWeeklyPage,
})

/**
 * Asakai weekly (planlamacı, 2026-10-26): Excel "Metal Stamping Daily Follow
 * Up" sayfası, masraf yeri başına bir blok (üstte aylık, 10 hafta, günler;
 * altta makine × hafta tablosu). 30 iş yerli masraf yerinde de düzen aynı:
 * yalnız tablo uzar. A4 yatay PDF, blok sayfa arasında bölünmez.
 * Hesap src/lib/oeeAsakai.ts.
 */
function AsakaiWeeklyPage() {
  const sel = useOeeSelection()
  const { config } = useOeeConfig()
  const yearStart = `${sel.date.slice(0, 4)}-01-01`
  const trendFrom = addDaysIso(sel.monday, -7 * (ASAKAI_WEEKS - 1))
  const from = trendFrom < yearStart ? trendFrom : yearStart
  const days = (useQuery(api.oee.days, { from, to: sel.sunday }) ?? []) as DayRow[]
  const periods = useQuery(api.oee.periods) as { weekly: WeeklyRow[]; monthly: MonthlyRow[] } | undefined
  const week = { from: sel.monday, to: sel.sunday }
  const lossRaw = (useQuery(api.oee.lossDays, week) ?? []) as StoredLossDay[]
  const stopRaw = (useQuery(api.oee.stopDays, week) ?? []) as StoredStopDay[]
  const weekly = periods?.weekly ?? []
  const monthly = periods?.monthly ?? []

  const scope = effectiveScope(sel.scope, areaNames(days, config))
  const { groups, columns, chartColumns } = useMemo(() => {
    const lossDays = splitShortStops(fromStoredLosses(lossRaw), fromStoredStops(stopRaw), config).lossDays
    // Tablo "#" gibi grafikte gizli sütunları da gösterir; yığılı grafik göstermez.
    const all = asakaiColumns(config, lossDays)
    const groups = asakaiWeekly({ days, weekly, monthly, lossDays }, scope, config, sel.date, sel.monday, all)
    const columns = dropEmptyUnassigned(all, groups.flatMap((g) => [...g.losses, g.lossTotal]))
    return { groups, columns, chartColumns: visibleChartGroups(columns, config) }
  }, [days, weekly, monthly, lossRaw, stopRaw, scope, config, sel.date, sel.monday])

  const sheetRef = useRef<HTMLDivElement>(null)
  const title = `${(scope.area || 'OEE').toUpperCase()} DAILY FOLLOW UP`
  const ticks = ASAKAI_DAYS.map((_, i) => dm(addDaysIso(sel.monday, i)).slice(0, 5))

  return (
    <div className="w-full px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <PageHeader
        title="Asakai weekly"
        summary="The Excel daily follow-up, one block per cost center: monthly, last 10 weeks and the week by day, then one row per work center with its daily OEE and the week's losses."
        links={relatedPages('/oee/asakai-weekly')}
        info={
          <>
            <p>
              One block per cost center of the selected area (in Excel: Progressive, Transfer); each work center is one row of the block's
              table, so a cost center with many work centers only makes the table longer. In the PDF a block is never split between pages.
              OEE is always summed times divided once, as on Trend Analysis; losses are shares of the loading time, as on Losses Trend.
            </p>
            <p>
              The week is the week of the selected date. Loss columns are the chart columns of <Link to="/oee/settings">OEE Settings</Link>.
            </p>
          </>
        }
      />
      <OeeControls
        selection={sel}
        rows={days}
        config={config}
        actions={
          <SavePdfButton
            fileName={pdfFileName(sel.date, 'ASAKAI WEEKLY')}
            disabled={!groups.length}
            make={() =>
              sheetToPdf(sheetRef.current!, {
                size: 'A4',
                orientation: 'landscape',
                pages: 'flow',
                widthPx: SHEET_WIDTH,
              })
            }
          />
        }
      />

      {!groups.length ? (
        <p className="mt-6 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No OEE data for W{sel.week.week}. Upload the file on{' '}
          <Link to="/oee/data" className="underline">
            OEE Data
          </Link>
          .
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <div ref={sheetRef} style={{ ...SHEET_FONT, width: SHEET_WIDTH, padding: 8, fontSize: 11 }}>
            <div style={{ display: 'flex', border: `2px solid ${X.border}`, marginBottom: 10 }}>
              <div style={{ flex: 1, textAlign: 'center', fontSize: 18, fontWeight: 700, padding: '6px 0' }}>{title}</div>
              <div
                style={{
                  width: 190,
                  background: X.headBlue,
                  borderLeft: `2px solid ${X.border}`,
                  textAlign: 'center',
                  fontSize: 16,
                  fontWeight: 700,
                  fontStyle: 'italic',
                  padding: '7px 0',
                }}
              >
                {dm(sel.date)}
              </div>
            </div>
            {groups.map((g) => (
              <section key={g.costCenter} className="print-avoid-break" style={{ border: `2px solid ${X.border}`, marginBottom: 12 }}>
                <div style={{ textAlign: 'center', fontWeight: 700, fontSize: 15, borderBottom: `2px solid ${X.border}`, padding: 3 }}>
                  {g.name.toUpperCase()}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, padding: '6px 10px' }}>
                  <AsakaiBars title="MONTHLY" points={g.monthly} />
                  <AsakaiBars title={`WEEKLY - LAST ${ASAKAI_WEEKS} WEEK`} points={g.weekly} />
                  <AsakaiStacked
                    title={`W${sel.week.week} BY DAY`}
                    columns={chartColumns}
                    rows={g.stacked.map((r, i) => ({ ...r, tick: ticks[i] }))}
                  />
                </div>
                <div style={{ padding: '0 10px 10px' }}>
                  <WeekTable group={g} columns={columns} />
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Masraf yerinin haftası tek tabloda: makine başına bir satır — günlerin OEE'si,
 * haftalık OEE ve haftanın kayıpları (% of Loading); son satır toplam. 30 iş
 * yeri de olsa düzen bozulmaz, yalnız tablo uzar.
 */
function WeekTable({ group: g, columns }: { group: WeeklyGroup; columns: string[] }) {
  const head = { bg: X.navy, color: '#fff', bold: true }
  const loss = { bg: X.salmon, bold: true, style: { whiteSpace: 'normal' as const, fontSize: 9 } }
  const total = { bg: X.totalRow, bold: true }
  const sep = { borderLeft: `2px solid ${X.border}` }
  return (
    <table style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 10 }}>
      <colgroup>
        <col style={{ width: 110 }} />
      </colgroup>
      <thead>
        <tr>
          <Cell {...head} rowSpan={2}>
            LINE
          </Cell>
          <Cell {...head} colSpan={ASAKAI_DAYS.length + 1}>
            OEE DAILY
          </Cell>
          <Cell bg={X.headBlue} bold colSpan={columns.length} style={sep}>
            LOSSES DETAILS — WEEK (% OF LOADING)
          </Cell>
        </tr>
        <tr style={{ height: 30 }}>
          {ASAKAI_DAYS.map((d) => (
            <Cell key={d} {...head}>
              {d}
            </Cell>
          ))}
          <Cell {...head}>WEEKLY</Cell>
          {columns.map((c, i) => (
            <Cell key={c} {...loss} style={{ ...loss.style, ...(i === 0 ? sep : {}) }}>
              {colTitle(c)}
            </Cell>
          ))}
        </tr>
      </thead>
      <tbody>
        {g.daily.map((m, r) => (
          <tr key={m.workCenter}>
            <Cell bg={X.lineCell} bold>
              {m.workCenter}
            </Cell>
            {m.days.map((v, i) => (
              <Cell key={i}>{pct(v)}</Cell>
            ))}
            <Cell bg={X.lightBlue} color="#c55a11" bold>
              {pct(m.week)}
            </Cell>
            {columns.map((c, i) => (
              <Cell key={c} bg={X.lightBlue} style={i === 0 ? sep : undefined}>
                {g.losses[r] ? share(g.losses[r], c) : ''}
              </Cell>
            ))}
          </tr>
        ))}
        <tr>
          <Cell bg={X.slate} color="#fff" bold>
            {g.name.toUpperCase()}
          </Cell>
          {g.dailyTotal.days.map((v, i) => (
            <Cell key={i} {...total}>
              {pct(v)}
            </Cell>
          ))}
          <Cell {...total}>{pct(g.dailyTotal.week)}</Cell>
          {columns.map((c, i) => (
            <Cell key={c} {...total} style={i === 0 ? sep : undefined}>
              {share(g.lossTotal, c)}
            </Cell>
          ))}
        </tr>
      </tbody>
    </table>
  )
}
