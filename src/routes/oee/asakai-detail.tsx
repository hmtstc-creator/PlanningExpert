import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo, useRef } from 'react'

import { api } from '../../../convex/_generated/api'
import { Cell, SHEET_FONT, SHEET_WIDTH, X, colTitle, pct, share } from '../../components/AsakaiSheet'
import { OeeControls, effectiveScope, oeeToday, useOeeConfig, useOeeSelection } from '../../components/OeePanel'
import { dm } from '../../components/OeePeriodControl'
import { PageHeader } from '../../components/PageHeader'
import { SavePdfButton } from '../../components/SavePdfButton'
import { useQuery } from '../../lib/convexTransport'
import { relatedPages } from '../../lib/navigation'
import { addDaysIso, areaNames, isoWeek, lossDayOf, type OrderRow, type ShiftRow } from '../../lib/oee'
import { ASAKAI_TOP, asakaiColumns, asakaiDay, asakaiTopStops, asakaiDetail, definedWorkCenters, dropEmptyUnassigned } from '../../lib/oeeAsakai'
import { fromStoredStops, stopDayOf } from '../../lib/oeeReliability'
import { splitShortStops } from '../../lib/oeeShortStops'
import { fromStoredDay, type StoredDowntimeDay } from '../../lib/oeeStore'
import { pdfFileName } from '../../lib/pdfFile'
import { sheetToPdf } from '../../lib/pdfSheet'

export const Route = createFileRoute('/oee/asakai-detail')({
  component: AsakaiDetailPage,
})

/** Malzeme sütunu en az bu kadar (Excel'deki boş sarı sütunlar). */
const PART_COLUMNS = 6

/**
 * Asakai detail (planlamacı, 2026-10-26): seçili gün, makine × vardiya —
 * OEE, Loading, kayıplar ve vardiyada basılan malzemeler (adet - OEE).
 * A4 yatay PDF, makine blokları sayfa arasında bölünmez.
 */
function AsakaiDetailPage() {
  const sel = useOeeSelection()
  const { config } = useOeeConfig()
  // Bugün (sistemin çalışma günü) gizli: gün bitmediği için yarım veri yanlış gösterir — en son dün.
  const today = oeeToday()
  const lastDay = addDaysIso(today, -1)
  const date = asakaiDay(sel.date, today)
  const q = { from: date, to: date }
  const shiftRows = useQuery(api.oee.shifts, q) as ShiftRow[] | undefined
  const evRaw = useQuery(api.oee.downtimeDays, q) as StoredDowntimeDay[] | undefined
  const orders = (useQuery(api.oee.orders, q) ?? []) as OrderRow[]
  const shifts = shiftRows ?? []
  // Masraf yerinin bütün iş yerleri (Makineler → masraf yeri): o gün verisi olmayan makine de satır olur.
  const presses = (useQuery(api.presses.list) ?? []) as { name: string; costCenter?: string }[]
  const defined = useMemo(() => definedWorkCenters(presses), [presses])
  const filterRows = useMemo(() => [...shifts, ...defined], [shifts, defined])

  const scope = effectiveScope(sel.scope, areaNames(filterRows, config))
  const { groups, columns } = useMemo(() => {
    const events = (evRaw ?? []).map(fromStoredDay)
    // Kısa duruşlar ayrılır (kendi kodunda sayılmaz, hız kaybının içinde); "#" gibi grafikte gizli sütunlar dahil.
    const split = splitShortStops(events.map(lossDayOf), fromStoredStops(events.map(stopDayOf)), config).lossDays
    const all = asakaiColumns(config, split)
    const groups = asakaiDetail({ shifts, events, orders, defined }, scope, config, all)
    const rows = groups.flatMap((g) => g.machines.flatMap((m) => [m.total, ...m.shifts]))
    return { groups, columns: dropEmptyUnassigned(all, rows) }
  }, [shifts, evRaw, orders, defined, scope, config])

  const sheetRef = useRef<HTMLDivElement>(null)
  // Excel'deki gibi tek tablo: masraf yerleri ardışık (Progressive, Transfer).
  const machines = groups.flatMap((g) => g.machines)
  // Her iş yerinin gününde ve her vardiyasında kendi en büyük duruşları kırmızı.
  const topOf = new Map(machines.map((m) => [m.workCenter, asakaiTopStops(m.total, columns)]))
  const partCols = Math.max(PART_COLUMNS, ...machines.map((m) => m.parts.length))
  const day = dm(date)
  const loading = shiftRows === undefined || evRaw === undefined

  return (
    <div className="w-full px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <PageHeader
        title="Asakai detail"
        summary="The selected day by work center and shift: OEE, loading time, losses and the materials pressed (good quantity - OEE)."
        links={relatedPages('/oee/asakai-detail')}
        info={
          <>
            <p>
              The dark row of each work center is the day; rows 1, 2, 3 are its shifts (shift numbers from{' '}
              <Link to="/oee/settings">OEE Settings</Link>
              ). Losses are shares of the loading time, split by shift as on Loss Bridge; red cells are the {ASAKAI_TOP} largest
              stops of each row — the work center&apos;s day and each of its shifts on their own (Speed and Unassigned are not
              counted).
            </p>
            <p>Right: the materials of the day (orders file), each shift&apos;s good quantity and OEE — e.g. &quot;12660 - %90&quot;.</p>
            <p>
              Today is not shown: the working day is not over, so its part-day data would make OEE and the loss shares wrong. The latest
              day on the page is yesterday. Every work center of the cost center is a row (Machines → cost center), even when it has no
              data on the selected day.
            </p>
          </>
        }
      />
      <OeeControls
        selection={{ ...sel, date, week: isoWeek(date) }}
        rows={filterRows}
        config={config}
        maxDate={lastDay}
        actions={
          <SavePdfButton
            fileName={pdfFileName(date, 'ASAKAI DETAIL')}
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
          {loading ? 'Loading…' : `No shift data for ${day}.`}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <div ref={sheetRef} style={{ ...SHEET_FONT, width: SHEET_WIDTH, padding: 8, fontSize: 11 }}>
            <div
              style={{
                display: 'inline-block',
                border: `2px solid #404040`,
                background: '#d6dce4',
                padding: '6px 34px',
                fontWeight: 700,
                fontSize: 13,
                marginBottom: 14,
              }}
            >
              {day}
            </div>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                tableLayout: 'fixed',
              }}
            >
              <colgroup>
                <col style={{ width: 120 }} />
                <col style={{ width: 18 }} />
                <col style={{ width: 58 }} />
                <col style={{ width: 52 }} />
                {columns.map((c) => (
                  <col key={c} style={{ width: 80 }} />
                ))}
                <col style={{ width: 8 }} />
                {Array.from({ length: partCols }, (_, i) => (
                  <col key={i} />
                ))}
              </colgroup>
              <thead>
                <tr style={{ height: 44 }}>
                  <Cell bg={X.headBlue} bold colSpan={2} style={{ fontStyle: 'italic', fontSize: 15 }}>
                    LINE
                  </Cell>
                  <Cell bg={X.headBlue} bold style={{ fontStyle: 'italic', fontSize: 15 }}>
                    OEE
                  </Cell>
                  <Cell
                    bg={X.headBlue}
                    bold
                    style={{
                      fontStyle: 'italic',
                      fontSize: 9,
                      whiteSpace: 'normal',
                    }}
                  >
                    LOADING TIME
                  </Cell>
                  {columns.map((c) => (
                    <Cell key={c} bg={X.salmon} bold style={{ whiteSpace: 'normal' }}>
                      {colTitle(c)}
                    </Cell>
                  ))}
                  <td colSpan={partCols + 1} />
                </tr>
              </thead>
              {machines.map((m) => (
                <tbody key={m.workCenter} className="print-avoid-break">
                  <tr style={{ height: 8 }}>
                    <td colSpan={columns.length + 5 + partCols} />
                  </tr>
                  <tr>
                    <td colSpan={2} />
                    <Cell bg={X.salmonLight} bold>
                      {pct(m.total.oee ?? 0)}
                    </Cell>
                    <Cell bg={X.salmonLight} bold>
                      {Math.round(m.total.loadingMin)}
                    </Cell>
                    {columns.map((c) => {
                      const red = topOf.get(m.workCenter)?.has(c)
                      return (
                        <Cell key={c} bg={red ? X.bad : X.slate} color={red ? X.badText : '#fff'} bold>
                          {share(m.total, c)}
                        </Cell>
                      )
                    })}
                    <td />
                    {Array.from({ length: partCols }, (_, i) => (
                      <Cell key={i} bg={X.yellow} bold>
                        {m.parts[i] ?? ''}
                      </Cell>
                    ))}
                  </tr>
                  {m.shifts.map((s, si) => {
                    const top = asakaiTopStops(s, columns)
                    return (
                      <tr key={s.label}>
                        {si === 0 && (
                          <Cell bg={X.lineCell} bold rowSpan={m.shifts.length}>
                            {m.workCenter}
                          </Cell>
                        )}
                        <Cell bg={X.lineCell} bold>
                          {s.label}
                        </Cell>
                        <Cell bg={X.salmonLight}>{pct(s.oee ?? 0)}</Cell>
                        <Cell bg={X.salmonLight}>{Math.round(s.loadingMin)}</Cell>
                        {columns.map((c) => (
                          <Cell key={c} bg={top.has(c) ? X.bad : X.lightBlue} color={top.has(c) ? X.badText : undefined}>
                            {share(s, c)}
                          </Cell>
                        ))}
                        <td />
                        {Array.from({ length: partCols }, (_, i) => {
                          const cell = m.parts[i] ? m.partCells[si][m.parts[i]] : undefined
                          return (
                            <Cell key={i}>
                              {cell ? `${Math.round(cell.good)} - %${cell.oee === null ? '' : Math.round(cell.oee * 100)}` : ''}
                            </Cell>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              ))}
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
