import { Link } from '@tanstack/react-router'
import { useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'

import { api } from '../../convex/_generated/api'
import { useMutation, useQuery } from '../lib/convexTransport'
import { friendlyError } from '../lib/mutationErrors'
import {
  EMPTY_CONFIG,
  addDaysIso,
  areaNames,
  configProblems,
  isoWeek,
  mondayOfIso,
  parseOeeWorkbook,
  scopeOptions,
  sheetKind,
  type OeeConfig,
  type Scope,
  type SheetRows,
} from '../lib/oee'
import { importOee, type OeeApi } from '../lib/oeeStore'

/**
 * OEE sayfalarının ortak parçaları: ayar (kullanıcının OEE ayarları), alan /
 * masraf yeri / makine seçimi, tarih (varsayılan dün) ve yükleme düğmesi.
 */

const KEY = 'oee-selection'

function localIso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Kaydedilmiş OEE ayarları; yoksa boş ayar ve eksikler listesi. */
export function useOeeConfig(): { config: OeeConfig; problems: string[]; loaded: boolean } {
  const doc = useQuery(api.oee.settings) as { config: OeeConfig } | null | undefined
  const config = doc?.config ?? EMPTY_CONFIG
  return { config, problems: doc === undefined ? [] : configProblems(config), loaded: doc !== undefined }
}

export function useOeeSelection() {
  const [saved, setSaved] = useState<Scope>(() => {
    try {
      const v = JSON.parse(window.localStorage.getItem(KEY) ?? 'null')
      if (v && typeof v.area === 'string' && typeof v.key === 'string') return v
    } catch {
      // Saklanamıyorsa varsayılan.
    }
    return { area: '', key: 'all' }
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

/** Seçili alan ayarda yoksa ilk alan kullanılır. */
export function effectiveScope(scope: Scope, areas: string[]): Scope {
  if (areas.includes(scope.area)) return scope
  return { area: areas[0] ?? '', key: 'all' }
}

export function OeeControls({
  selection,
  rows,
  config,
}: {
  selection: ReturnType<typeof useOeeSelection>
  /** Seçenekler için iş merkezi / masraf yeri listesi. */
  rows: { workCenter: string; costCenter: string }[]
  config: OeeConfig
}) {
  const { setScope, date, setDate, week } = selection
  const areas = useMemo(() => areaNames(rows, config), [rows, config])
  const scope = effectiveScope(selection.scope, areas)
  const options = useMemo(() => scopeOptions(scope.area, rows, config), [scope.area, rows, config])
  const coverage = useQuery(api.oee.coverage) as { days: { from: string; to: string } | null } | undefined
  const problems = configProblems(config)
  return (
    <>
      {problems.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <b>OEE settings are not complete:</b> {problems.join(' ')}{' '}
          <Link to="/oee/settings" className="font-medium underline">
            Open Settings →
          </Link>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-border p-3 text-sm">
        {areas.length > 0 && (
          <div className="flex flex-wrap rounded-md border border-border p-0.5" role="group" aria-label="Area">
            {areas.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setScope({ area: a, key: 'all' })}
                aria-pressed={scope.area === a}
                className={`rounded px-3 py-1 text-xs font-semibold ${scope.area === a ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted'}`}
              >
                {a}
              </button>
            ))}
          </div>
        )}
        {areas.length > 0 && (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {config.areas.find((a) => a.name === scope.area)?.pick === 'costCenter' ? 'Cost center' : 'Machine'}
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
        )}
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
          {coverage?.days && ` · data ${coverage.days.from} – ${coverage.days.to}`}
        </span>
        <div className="ml-auto">
          <OeeUploadButton />
        </div>
      </div>
    </>
  )
}

/** Tek düğme: dosyayı seç, tanınan sayfaları oku, ekle ya da güncelle. */
export function OeeUploadButton() {
  const input = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'busy'; step: string } | { kind: 'done'; text: string } | { kind: 'error'; text: string }>({
    kind: 'idle',
  })
  const last = useQuery(api.oee.lastImport) as { fileName: string; uploadedAt: number; uploadedBy?: string } | null | undefined
  const calls: OeeApi = {
    upsertShifts: useMutation(api.oee.upsertShifts),
    upsertDaily: useMutation(api.oee.upsertDaily),
    upsertOrders: useMutation(api.oee.upsertOrders),
    upsertWeekly: useMutation(api.oee.upsertWeekly),
    upsertMonthly: useMutation(api.oee.upsertMonthly),
    upsertDowntimeDays: useMutation(api.oee.upsertDowntimeDays),
    finishImport: useMutation(api.oee.finishImport),
  }

  const onFile = async (file: File) => {
    setState({ kind: 'busy', step: 'Reading the file…' })
    try {
      const buf = await file.arrayBuffer()
      const names = XLSX.read(buf, { type: 'array', bookSheets: true }).SheetNames
      const wanted = names.filter((n) => sheetKind(n))
      if (!wanted.length) {
        throw new Error('No OEE sheet in this file (Shiftly KPI, Shiftly Order Based KPI, Downtimes, Daily KPI, Weekly KPI, Monthly KPI).')
      }
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
        text: `✓ Added / updated: ${parsed.read.map((r) => `${r.sheet} ${r.rows.toLocaleString('en-GB')}`).join(' · ')}. Nothing was deleted.`,
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
        {state.kind === 'busy' ? (
          state.step
        ) : state.kind === 'done' ? (
          state.text
        ) : state.kind === 'error' ? (
          <span className="text-destructive">Not saved: {state.text}</span>
        ) : last ? (
          `Last: ${last.fileName} · ${new Date(last.uploadedAt).toLocaleString('en-GB')}${last.uploadedBy ? ` · ${last.uploadedBy}` : ''}`
        ) : (
          <>
            No data yet — <Link to="/oee/guide" className="underline">how to start</Link>
          </>
        )}
      </span>
    </div>
  )
}
