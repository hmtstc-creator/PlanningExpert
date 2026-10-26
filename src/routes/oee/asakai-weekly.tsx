import { createFileRoute, Link } from '@tanstack/react-router'
import { Fragment, useMemo, useRef } from 'react'

import { api } from '../../../convex/_generated/api'
import { AsakaiBars, AsakaiStacked, Cell, SHEET_FONT, X, colTitle, pct, share } from '../../components/AsakaiSheet'
import { OeeControls, effectiveScope, useOeeConfig, useOeeSelection } from '../../components/OeePanel'
import { dm } from '../../components/OeePeriodControl'
import { PageHeader } from '../../components/PageHeader'
import { SavePdfButton } from '../../components/SavePdfButton'
import { useQuery } from '../../lib/convexTransport'
import { relatedPages } from '../../lib/navigation'
import { addDaysIso, areaNames, chartGroups, visibleChartGroups, type DayRow, type MonthlyRow, type WeeklyRow } from '../../lib/oee'
import { ASAKAI_DAYS, ASAKAI_WEEKS, asakaiWeekly } from '../../lib/oeeAsakai'
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
 * Up" sayfasının kopyası, A4 yatay tek sayfa PDF. Hesap src/lib/oeeAsakai.ts.
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
  const { groups, columns } = useMemo(() => {
    const lossDays = splitShortStops(fromStoredLosses(lossRaw), fromStoredStops(stopRaw), config).lossDays
    const columns = visibleChartGroups(chartGroups(config, lossDays), config)
    return {
      columns,
      groups: asakaiWeekly({ days, weekly, monthly, lossDays }, scope, config, sel.date, sel.monday, columns),
    }
  }, [days, weekly, monthly, lossRaw, stopRaw, scope, config, sel.date, sel.monday])

  const sheetRef = useRef<HTMLDivElement>(null)
  const title = `${(scope.area || 'OEE').toUpperCase()} DAILY FOLLOW UP`
  const ticks = ASAKAI_DAYS.map((_, i) => dm(addDaysIso(sel.monday, i)).slice(0, 5))
  const head = { bg: X.navy, color: '#fff', bold: true }

  return (
    <div className="w-full px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <PageHeader
        title="Asakai weekly"
        summary="The Excel daily follow-up on one A4 page: monthly and last 10 weeks OEE per cost center, the week by day and machine, and the losses."
        links={relatedPages('/oee/asakai-weekly')}
        info={
          <>
            <p>
              One block per cost center of the selected area (in Excel: Progressive, Transfer). OEE is always summed times divided once, as
              on Trend Analysis; losses are shares of the loading time, as on Losses Trend.
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
                pages: 'fit',
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
          <div ref={sheetRef} style={{ ...SHEET_FONT, width: 1400, padding: 8, fontSize: 11 }}>
            <div
              style={{
                display: 'flex',
                border: `2px solid ${X.border}`,
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  flex: 1,
                  textAlign: 'center',
                  fontSize: 18,
                  fontWeight: 700,
                  padding: '6px 0',
                }}
              >
                {title}
              </div>
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

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${groups.length}, minmax(0, 1fr)) minmax(0, 1.45fr)`,
                border: `2px solid ${X.border}`,
              }}
            >
              {groups.map((g) => (
                <div key={g.costCenter} style={{ borderRight: `2px solid ${X.border}` }}>
                  <div
                    style={{
                      textAlign: 'center',
                      fontWeight: 700,
                      fontSize: 15,
                      borderBottom: `2px solid ${X.border}`,
                      padding: 3,
                    }}
                  >
                    {g.name.toUpperCase()}
                  </div>
                  <div style={{ padding: '4px 6px' }}>
                    <AsakaiBars title="MONTHLY" points={g.monthly} />
                    <AsakaiBars title={`WEEKLY - LAST ${ASAKAI_WEEKS} WEEK`} points={g.weekly} />
                  </div>
                </div>
              ))}
              <div>
                <div
                  style={{
                    textAlign: 'center',
                    fontWeight: 700,
                    fontSize: 15,
                    borderBottom: `2px solid ${X.border}`,
                    padding: 3,
                  }}
                >
                  DETAIL LOSSES BRIDGE
                </div>
                <div style={{ padding: '14px 10px' }}>
                  {groups.map((g) => (
                    <table
                      key={g.costCenter}
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        marginBottom: 12,
                        fontSize: 10,
                      }}
                    >
                      <thead>
                        <tr style={{ height: 30 }}>
                          <Cell {...head}>OEE DAILY</Cell>
                          {ASAKAI_DAYS.map((d) => (
                            <Cell key={d} {...head}>
                              {d}
                            </Cell>
                          ))}
                          <Cell {...head}>WEEKLY</Cell>
                        </tr>
                      </thead>
                      <tbody>
                        {g.daily.map((m) => (
                          <tr key={m.workCenter}>
                            <Cell bold>{m.workCenter}</Cell>
                            {m.days.map((v, i) => (
                              <Cell key={i}>{pct(v)}</Cell>
                            ))}
                            <Cell bg={X.lightBlue} color="#c55a11">
                              {pct(m.week)}
                            </Cell>
                          </tr>
                        ))}
                        <tr>
                          <Cell bg={X.totalRow} bold>
                            {g.name.toUpperCase()}
                          </Cell>
                          {g.dailyTotal.days.map((v, i) => (
                            <Cell key={i} bg={X.totalRow} bold>
                              {pct(v)}
                            </Cell>
                          ))}
                          <Cell bg={X.totalRow} bold>
                            {pct(g.dailyTotal.week)}
                          </Cell>
                        </tr>
                      </tbody>
                    </table>
                  ))}
                </div>
              </div>

              {groups.map((g) => (
                <div
                  key={g.costCenter}
                  style={{
                    borderTop: `2px solid ${X.border}`,
                    padding: '6px 6px 2px',
                  }}
                >
                  <AsakaiStacked
                    title={g.name.toUpperCase()}
                    columns={columns}
                    rows={g.stacked.map((r, i) => ({ ...r, tick: ticks[i] }))}
                  />
                </div>
              ))}
              <div
                style={{
                  borderTop: `2px solid ${X.border}`,
                  display: 'flex',
                  padding: '18px 10px 8px 0',
                }}
              >
                <div
                  style={{
                    width: 54,
                    border: `2px solid ${X.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 8,
                  }}
                >
                  <span
                    style={{
                      writingMode: 'vertical-rl',
                      transform: 'rotate(180deg)',
                      fontWeight: 700,
                      fontSize: 18,
                    }}
                  >
                    LOSSES DETAILS
                  </span>
                </div>
                <table
                  style={{
                    flex: 1,
                    minWidth: 0,
                    width: '100%',
                    tableLayout: 'fixed',
                    borderCollapse: 'collapse',
                    fontSize: 10,
                    alignSelf: 'flex-start',
                  }}
                >
                  <colgroup>
                    <col style={{ width: 84 }} />
                    <col style={{ width: 40 }} />
                  </colgroup>
                  <thead>
                    <tr style={{ height: 40 }}>
                      <Cell bg={X.headBlue} bold style={{ fontStyle: 'italic', fontSize: 13 }}>
                        LINE
                      </Cell>
                      <Cell bg={X.headBlue} bold style={{ fontStyle: 'italic', fontSize: 13 }}>
                        OEE
                      </Cell>
                      {columns.map((c) => (
                        <Cell
                          key={c}
                          bg={X.salmon}
                          bold
                          style={{ whiteSpace: 'normal', fontSize: 8, overflowWrap: 'break-word', padding: 0 }}
                        >
                          {colTitle(c)}
                        </Cell>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g, gi) => (
                      <Fragment key={g.costCenter}>
                        {gi > 0 && (
                          <tr style={{ height: 14 }}>
                            <td colSpan={columns.length + 2} />
                          </tr>
                        )}
                        {g.losses.map((r) => (
                          <tr key={r.label}>
                            <Cell bg={X.lineCell} bold>
                              {r.label}
                            </Cell>
                            <Cell bg={X.lightBlue}>{pct(r.oee)}</Cell>
                            {columns.map((c) => (
                              <Cell key={c} bg={X.lightBlue}>
                                {share(r, c)}
                              </Cell>
                            ))}
                          </tr>
                        ))}
                        <tr>
                          <Cell bg={X.slate} color="#fff" bold>
                            {g.name.toUpperCase()}
                          </Cell>
                          <Cell bg={X.totalRow} bold>
                            {pct(g.lossTotal.oee)}
                          </Cell>
                          {columns.map((c) => (
                            <Cell key={c} bg={X.totalRow} bold>
                              {share(g.lossTotal, c)}
                            </Cell>
                          ))}
                        </tr>
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
