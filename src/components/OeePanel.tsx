import { useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'

import { api } from '../../convex/_generated/api'
import { useMutation, useQuery } from '../lib/convexTransport'
import { friendlyError } from '../lib/mutationErrors'
import { addDaysIso, isoWeek, mondayOfIso, parseOeeWorkbook, scopeOptions, sheetKind, type Area, type Scope, type SheetRows } from '../lib/oee'
import { importOee, type OeeApi } from '../lib/oeeStore'

/**
 * OEE sayfalarının ortak üst çubuğu: PRS / APR, masraf yeri ya da makine,
 * tarih (varsayılan dün) ve dosya yükleme düğmesi. Seçim tarayıcıda
 * saklanır; tarih her açılışta dün olur.
 */

const KEY = 'oee-selection'

function localIso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function useOeeSelection() {
  const [saved, setSaved] = useState<Scope>(() => {
    try {
      const v = JSON.parse(window.localStorage.getItem(KEY) ?? 'null')
      if (v && (v.area === 'PRS' || v.area === 'APR') && typeof v.key === 'string') return v
    } catch {
      // Saklanamıyorsa varsayılan.
    }
    return { area: 'PRS', key: 'all' }
  })
  const [date, setDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return localIso(d)
  })
  const setScope = (s: Scope) => {
    setSaved(s)
    try {
      window.localStorage.setItem(KEY, JSON.stringify(s))
    } catch {
      // Yalnızca bu oturumda kalır.
    }
  }
  const monday = mondayOfIso(date)
  return { scope: saved, setScope, date, setDate, monday, sunday: addDaysIso(monday, 6), week: isoWeek(date) }
}

export function OeeControls({
  selection,
  rows,
}: {
  selection: ReturnType<typeof useOeeSelection>
  /** Seçenekler için iş merkezi / masraf yeri listesi. */
  rows: { workCenter: string; costCenter: string }[]
}) {
  const { scope, setScope, date, setDate, week } = selection
  const options = useMemo(() => scopeOptions(scope.area, rows), [scope.area, rows])
  const coverage = useQuery(api.oee.coverage) as
    | { shifts: { from: string; to: string } | null; downtimes: { from: string; to: string } | null }
    | undefined
  const setArea = (area: Area) => setScope({ area, key: 'all' })
  return (
    <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-border p-3 text-sm">
      <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Area">
        {(['PRS', 'APR'] as const).map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setArea(a)}
            aria-pressed={scope.area === a}
            className={`rounded px-3 py-1 text-xs font-semibold ${scope.area === a ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted'}`}
          >
            {a}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {scope.area === 'PRS' ? 'Cost center' : 'Machine'}
        <select
          value={options.some((o) => o.key === scope.key) ? scope.key : 'all'}
          onChange={(e) => setScope({ ...scope, key: e.target.value })}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
        >
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Date
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground"
        />
      </label>
      <span className="pb-2 text-xs text-muted-foreground">
        Week <strong className="text-foreground">W{week.week}</strong>
        {coverage?.shifts && ` · data ${coverage.shifts.from} – ${coverage.shifts.to}`}
      </span>
      <div className="ml-auto">
        <OeeUploadButton />
      </div>
    </div>
  )
}

/** Tek düğme: dosyayı seç, gerekli sayfaları oku, yükle. */
export function OeeUploadButton() {
  const input = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'busy'; step: string } | { kind: 'done'; text: string } | { kind: 'error'; text: string }>({
    kind: 'idle',
  })
  const last = useQuery(api.oee.lastImport) as { fileName: string; uploadedAt: number; uploadedBy?: string } | null | undefined
  const calls: OeeApi = {
    clearRange: useMutation(api.oee.clearRange),
    insertShifts: useMutation(api.oee.insertShifts),
    insertOrders: useMutation(api.oee.insertOrders),
    insertWeekly: useMutation(api.oee.insertWeekly),
    insertMonthly: useMutation(api.oee.insertMonthly),
    insertDowntimeDays: useMutation(api.oee.insertDowntimeDays),
    insertLossDays: useMutation(api.oee.insertLossDays),
    finishImport: useMutation(api.oee.finishImport),
  } as unknown as OeeApi

  const onFile = async (file: File) => {
    setState({ kind: 'busy', step: 'Reading the file…' })
    try {
      const buf = await file.arrayBuffer()
      const names = XLSX.read(buf, { type: 'array', bookSheets: true }).SheetNames
      const wanted = names.filter((n) => sheetKind(n))
      if (!wanted.length) throw new Error('No OEE sheet in this file (Shiftly KPI, Order Based KPI, Downtimes, Weekly KPI, Monthly KPI).')
      const book = XLSX.read(buf, { type: 'array', sheets: wanted, dense: true })
      const sheets: Record<string, SheetRows> = {}
      for (const n of wanted) {
        sheets[n] = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[n], { header: 1, raw: true, defval: null, blankrows: false })
      }
      const parsed = parseOeeWorkbook(sheets)
      if (parsed.problems.length) throw new Error(parsed.problems.join(' · '))
      await importOee(parsed, file.name, calls, (step) => setState({ kind: 'busy', step }))
      setState({
        kind: 'done',
        text: `✓ Saved: ${parsed.read.map((r) => `${r.sheet} ${r.rows.toLocaleString('en-GB')}`).join(' · ')}`,
      })
    } catch (e) {
      setState({ kind: 'error', text: friendlyError(e).message || 'Upload failed' })
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        ref={input}
        type="file"
        accept=".xlsx,.xlsm,.xls"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void onFile(f)
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={state.kind === 'busy'}
        className="rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-50"
      >
        {state.kind === 'busy' ? 'Uploading…' : 'Upload data'}
      </button>
      <span className="max-w-xs text-right text-[11px] text-muted-foreground">
        {state.kind === 'busy'
          ? state.step
          : state.kind === 'done'
            ? state.text
            : state.kind === 'error'
              ? <span className="text-destructive">Not saved: {state.text}</span>
              : last
                ? `Last: ${last.fileName} · ${new Date(last.uploadedAt).toLocaleString('en-GB')}${last.uploadedBy ? ` · ${last.uploadedBy}` : ''}`
                : 'No data uploaded yet'}
      </span>
    </div>
  )
}
