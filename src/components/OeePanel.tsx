import { Link } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
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
  withPlantCostCenters,
  forPlantCostCenters,
} from '../lib/oee'
import { usePlant } from '../lib/plantContext'
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
export function useOeeConfig(): { config: OeeConfig; problems: string[]; loaded: boolean; savedAt: number | null } {
  const doc = useQuery(api.oee.settings) as { config: OeeConfig; updatedAt: number } | null | undefined
  // Masraf yeri adları fabrika tanımından (tek kaynak).
  const plantCcs = usePlant().ctx?.active?.costCenters
  const departments = usePlant().ctx?.active?.departments
  const config = useMemo(() => withPlantCostCenters(doc?.config ?? EMPTY_CONFIG, plantCcs ?? [], departments ?? []), [doc, plantCcs, departments])
  return { config, problems: doc === undefined ? [] : configProblems(config), loaded: doc !== undefined, savedAt: doc?.updatedAt ?? null }
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

/**
 * İlk sürümle yüklenen veriyi (gün toplamları ve kayıp özetleri olmadan)
 * sayfa açılınca bir kez tamamlar: yalnızca ekler, hiçbir şey silmez.
 */
export function OeeRebuildNotice() {
  const coverage = useQuery(api.oee.coverage) as { needsRebuild?: { days: boolean; losses: boolean } } | undefined
  const rebuild = useMutation(api.oee.rebuildStored)
  const [state, setState] = useState<{ kind: 'idle' | 'done' } | { kind: 'busy'; text: string } | { kind: 'error'; text: string }>({ kind: 'idle' })
  const started = useRef(false)
  const need = coverage?.needsRebuild
  useEffect(() => {
    if (!need || (!need.days && !need.losses) || started.current) return
    started.current = true
    void (async () => {
      try {
        for (const step of ['days', 'losses'] as const) {
          if (!need[step]) continue
          let cursor: string | null = null
          let n = 0
          for (;;) {
            const r = (await rebuild({ step, cursor })) as { cursor: string; isDone: boolean; count: number }
            n += r.count
            setState({ kind: 'busy', text: `${step === 'days' ? 'Day totals' : 'Loss summaries'}: ${n}` })
            if (r.isDone) break
            cursor = r.cursor
          }
        }
        setState({ kind: 'done' })
      } catch (e) {
        started.current = false
        setState({ kind: 'error', text: friendlyError(e).message })
      }
    })()
  }, [need, rebuild])
  if (state.kind === 'idle') return null
  return (
    <div className="mt-4 rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900">
      {state.kind === 'busy' && <>Preparing the stored data from the shifts and downtimes (nothing is deleted)… {state.text}</>}
      {state.kind === 'done' && <>✓ Stored data prepared — day totals and loss summaries are complete.</>}
      {state.kind === 'error' && <span className="text-destructive">Could not prepare the stored data: {state.text}</span>}
    </div>
  )
}

/** Veri uyarıları: eksik dönemler, eksik makineler, KPI–Downtimes farkı. Hesabı değiştirmez. */
export function OeeDataNotice({ items }: { items: string[] }) {
  if (!items.length) return null
  return (
    <div className="mt-4 rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900" role="status">
      <b>Data notes</b> (the numbers use what is uploaded):
      <ul className="mt-1 list-disc pl-5">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  )
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
  const canEditOee = usePlant().canArea('oee.data', 'edit')
  return (
    <>
      <OeeRebuildNotice />
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
        {/* Yükleme yalnızca OEE düzenleme izniyle (board görünümünde yok). */}
        {canEditOee && (
          <div className="ml-auto">
            <OeeUploadButton />
          </div>
        )}
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
  // Yalnızca bu fabrikanın masraf yerlerinin satırları yüklenir.
  const plant = usePlant().ctx?.active
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
      const all = parseOeeWorkbook(sheets)
      if (all.problems.length) throw new Error(all.problems.join(' · '))
      const codes = (plant?.costCenters ?? []).map((c) => c.code)
      if (!codes.length) {
        throw new Error(`${plant?.plantName ?? 'This plant'} has no cost center yet — a creator adds them on Company settings → Organization.`)
      }
      const { parsed, skipped } = forPlantCostCenters(all, codes)
      const kept = parsed.shifts.length + parsed.daily.length + parsed.weekly.length + parsed.monthly.length + parsed.downtimes.length
      if (!kept) throw new Error(`No row of this file belongs to the cost centers of ${plant?.plantName} (${codes.join(', ')}).`)
      await importOee(parsed, file.name, calls, (step) => setState({ kind: 'busy', step }))
      const other = skipped.length ? ` Not this plant (skipped): ${skipped.map((s) => `${s.costCenter} ${s.rows.toLocaleString('en-GB')}`).join(', ')}.` : ''
      setState({
        kind: 'done',
        text: `✓ ${plant?.plantName}: added / updated ${parsed.shifts.length.toLocaleString('en-GB')} shifts, ${parsed.downtimes.reduce((a, d) => a + d.events.length, 0).toLocaleString('en-GB')} downtimes, ${parsed.orders.length.toLocaleString('en-GB')} order rows, ${parsed.weekly.length} weekly, ${parsed.monthly.length} monthly. Nothing was deleted.${other}`,
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
