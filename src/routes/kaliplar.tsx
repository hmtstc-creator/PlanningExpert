import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery } from '../lib/convexTransport'
import { useMemo, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { ErrorBanner } from '../components/ErrorBanner'
import { MaterialPicker } from '../components/MaterialPicker'
import { useSafeMutation } from '../lib/useSafeMutation'
import { buildMoldLife, type MoldStatus } from '../lib/moldLife'
import { useCurrentUser } from '../lib/currentUser'
import { isoDate } from '../lib/dates'
import { maintenanceDates } from '../lib/maintenance'
import type { ProductSpec } from '../lib/planning'

export const Route = createFileRoute('/kaliplar')({
  component: KaliplarPage,
})

const STATUS_LABEL: Record<MoldStatus, string> = {
  exceeded: 'limit exceeded',
  warning: 'near limit',
  ok: 'ok',
  unknown: 'no limit set',
}

const STATUS_STYLE: Record<MoldStatus, string> = {
  exceeded: 'rounded bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive',
  warning: 'rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900',
  ok: 'rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800',
  unknown: 'rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground',
}

function KaliplarPage() {
  // Malzeme kartları da eksiksiz okunur: kartı görülmeyen bir malzemenin
  // göz sayısı ve kalıp limiti bilinmez, vuruş hesabı da yanlış çıkar.
  const products = useQuery(api.products.listAll)?.rows ?? []
  // Kalıp ömrü ve gerçekleşme oranı bu satırların toplamından çıkar;
  // sayfalı okumak toplamı eksik bırakır ve iki sayıyı da yanıltıcı yapar.
  const actualResult = useQuery(api.actualProduction.listAll)
  const actualRows = useMemo(() => actualResult?.rows ?? [], [actualResult])
  const actualStatus = actualResult === undefined ? 'LoadingFirstPage' : 'Exhausted'
  const actualIncomplete = actualResult !== undefined && !actualResult.complete
  const { name: currentUser } = useCurrentUser()
  const maintenance = (useQuery(api.moldMaintenance.list) ?? []) as {
    _id: string
    material: string
    date: string
    dateTo?: string
    kind?: string
    note?: string
  }[]
  const readiness = (useQuery(api.moldReadiness.list) ?? []) as {
    _id: string
    material: string
    ready: boolean
    readyDate?: string
    reason?: string
    updatedBy?: string
  }[]
  const { run: addMaintenance, error: addError, clearError } = useSafeMutation(
    api.moldMaintenance.add,
  )
  const { run: removeMaintenance, error: removeError } = useSafeMutation(
    api.moldMaintenance.remove,
  )
  const { run: setReadiness, error: readinessError } = useSafeMutation(
    api.moldReadiness.set,
  )
  const alarms = (useQuery(api.moldAlarms.list) ?? []) as {
    _id: string
    material: string
    status: string
    shotsAtAlarm: number
    limitAtAlarm: number
    openedAt: number
    closedAt?: number
    closedBy?: string
    closeReason?: string
  }[]
  const { run: closeAlarm, error: alarmError } = useSafeMutation(api.moldAlarms.close)
  const { run: reopenAlarm } = useSafeMutation(api.moldAlarms.reopen)
  const syncAlarms = useMutation(api.moldAlarms.sync)
  const [closingAlarm, setClosingAlarm] = useState<string | null>(null)
  const [closeReason, setCloseReason] = useState('')
  const [syncing, setSyncing] = useState(false)

  const openAlarms = useMemo(
    () => alarms.filter((a) => a.status === 'open').sort((a, b) => b.openedAt - a.openedAt),
    [alarms],
  )
  const acknowledgedAlarms = useMemo(
    () => alarms.filter((a) => a.status !== 'open'),
    [alarms],
  )

  const [material, setMaterial] = useState('')
  const [date, setDate] = useState(() => isoDate(new Date()))
  const [dateTo, setDateTo] = useState('')
  const [kind, setKind] = useState('periodic')
  const [note, setNote] = useState('')

  // Hazır/hazır değil kutusu.
  const [readyMaterial, setReadyMaterial] = useState('')
  const [readyDate, setReadyDate] = useState('')
  const [readyReason, setReadyReason] = useState('')

  // Hazırlık ve bakım kayıtları master data listesinden seçilir: elle
  // yazılan bir kod plana hiç ulaşmaz.
  const materialOptions = useMemo(
    () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (products as any[]).map((p) => ({ code: p.code as string, coProduct: p.coProduct })),
    [products],
  )

  const productByCode = useMemo(() => {
    const map = new Map<string, ProductSpec>()
    for (const p of products) map.set(p.code, p as ProductSpec)
    return map
  }, [products])

  /**
   * Her malzeme için en son PERİYODİK bakım tarihi.
   *
   * Shot sayacını yalnızca ağır (periyodik) bakım sıfırlar. Bir arıza
   * onarımını sayaç sıfırlaması saymak kalıbı olduğundan taze gösterir ve
   * periyodik bakımı sonsuza kadar öteler.
   */
  const lastMaintenance = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of maintenance) {
      if (m.kind === 'repair') continue
      const current = map.get(m.material)
      if (!current || m.date > current) map.set(m.material, m.date)
    }
    return map
  }, [maintenance])

  const readinessByMaterial = useMemo(
    () => new Map(readiness.map((r) => [r.material, r])),
    [readiness],
  )

  const today = isoDate(new Date())

  /** Bugün ve sonrası için planlanmış bakımlar — plana giden kayıtlar. */
  const upcomingMaintenance = useMemo(
    () =>
      maintenance
        .filter((m) => (m.dateTo ?? m.date) >= today)
        .sort((a, b) => a.date.localeCompare(b.date)),
    [maintenance, today],
  )

  const heldMolds = useMemo(
    () => readiness.filter((r) => !r.ready).sort((a, b) => a.material.localeCompare(b.material)),
    [readiness],
  )

  const actual = useMemo(
    () =>
      actualRows.map((r) => ({
        material: r.material,
        postingDate: r.postingDate,
        quantity: r.quantity,
      })),
    [actualRows],
  )

  const rows = useMemo(
    () => buildMoldLife(actual, productByCode, lastMaintenance),
    [actual, productByCode, lastMaintenance],
  )

  const exceeded = rows.filter((r) => r.status === 'exceeded').length
  const warning = rows.filter((r) => r.status === 'warning').length
  const unknown = rows.filter((r) => r.status === 'unknown').length

  /**
   * Ağır bakımı gelmiş ya da yaklaşmış kalıplar, en acili başta.
   *
   * Limiti olmayan kalıplar burada yok: limit tanımlı değilse "yaklaştı"
   * demek uydurma olur — o eksiklik ayrı bir sayaçla bildiriliyor.
   */
  const dueList = useMemo(
    () =>
      rows
        .filter((r) => r.status === 'exceeded' || r.status === 'warning')
        .sort((a, b) => (b.usageRatio ?? 0) - (a.usageRatio ?? 0)),
    [rows],
  )

  async function submit() {
    const m = material.trim()
    if (!m) return
    const ok = await addMaintenance({
      material: m,
      date,
      dateTo: dateTo || undefined,
      kind,
      note: note || undefined,
      createdBy: currentUser ?? undefined,
    })
    if (ok) {
      setMaterial('')
      setNote('')
      setDateTo('')
    }
  }

  async function submitReadiness(ready: boolean) {
    const m = readyMaterial.trim()
    if (!m) return
    const ok = await setReadiness({
      material: m,
      ready,
      readyDate: ready ? undefined : readyDate || undefined,
      reason: ready ? undefined : readyReason || undefined,
      updatedBy: currentUser ?? undefined,
    })
    if (ok) {
      setReadyMaterial('')
      setReadyReason('')
    }
  }

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-12">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Mold Maintenance</h1>
      <p className="mt-2 text-muted-foreground">
        Everything the plan needs to know about a mold. Mark whether it is
        ready for production — a mold that is not ready is held out of the plan
        until its ready date. Book maintenance as a date range and the plan
        keeps those days free. The shot counter runs from the last periodic
        maintenance, using the actual production uploaded via MB51 (quantity ÷
        cavities), against the periodic maintenance limit on the material's
        master data record; a repair does not reset it.
      </p>

      <ErrorBanner
        message={addError ?? removeError ?? readinessError ?? alarmError}
        onDismiss={clearError}
      />

      {openAlarms.length > 0 && (
        <div className="mt-6 rounded-lg border-2 border-destructive bg-destructive/10 p-4">
          <h2 className="text-sm font-semibold text-destructive">
            Shot limit alarms — {openAlarms.length} mold(s) held out of the plan
          </h2>
          <p className="mt-1 text-sm text-foreground">
            These molds passed their periodic maintenance limit. They were not
            stopped mid-run, but they are not being planned into new work until
            each alarm is closed. Recording periodic maintenance closes an alarm
            by itself; closing it by hand means "I have seen this, let it keep
            running".
          </p>
          <div className="mt-3 overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Mold</th>
                  <th className="px-3 py-2 font-medium">Shots at alarm</th>
                  <th className="px-3 py-2 font-medium">Limit</th>
                  <th className="px-3 py-2 font-medium">Since</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {openAlarms.map((alarm) => (
                  <tr key={alarm._id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-foreground">{alarm.material}</td>
                    <td className="px-3 py-2 text-foreground">
                      {alarm.shotsAtAlarm.toLocaleString('en-GB')}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {alarm.limitAtAlarm.toLocaleString('en-GB')}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(alarm.openedAt).toLocaleString('en-GB')}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {closingAlarm === alarm._id ? (
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          <input
                            className="w-56 rounded-md border border-input bg-background px-2 py-1 text-sm"
                            placeholder="Why may it keep running?"
                            value={closeReason}
                            onChange={(e) => setCloseReason(e.target.value)}
                          />
                          <button
                            onClick={async () => {
                              const ok = await closeAlarm({
                                id: alarm._id,
                                reason: closeReason,
                                closedBy: currentUser ?? undefined,
                              })
                              if (ok) {
                                setClosingAlarm(null)
                                setCloseReason('')
                              }
                            }}
                            disabled={!closeReason.trim()}
                            className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
                          >
                            Close alarm
                          </button>
                          <button
                            onClick={() => setClosingAlarm(null)}
                            className="text-xs text-muted-foreground underline"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <button
                            onClick={() => {
                              setMaterial(alarm.material)
                              setKind('periodic')
                              window.scrollTo({ top: 0, behavior: 'smooth' })
                            }}
                            className="text-xs text-foreground underline hover:no-underline"
                          >
                            Book maintenance
                          </button>
                          <button
                            onClick={() => {
                              setClosingAlarm(alarm._id)
                              setCloseReason('')
                            }}
                            className="text-xs text-destructive underline hover:no-underline"
                          >
                            Let it keep running
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {acknowledgedAlarms.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">
            {acknowledgedAlarms.length} mold(s) are running past their limit by
            decision
          </p>
          <ul className="mt-1 space-y-1 text-xs text-amber-900">
            {acknowledgedAlarms.map((alarm) => (
              <li key={alarm._id} className="flex flex-wrap items-center gap-2">
                <strong>{alarm.material}</strong>
                <span>
                  {alarm.closeReason}
                  {alarm.closedBy ? ` — ${alarm.closedBy}` : ''}
                </span>
                <button
                  onClick={() =>
                    void reopenAlarm({ id: alarm._id, reopenedBy: currentUser ?? undefined })
                  }
                  className="underline hover:no-underline"
                >
                  Hold it again
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Periodic maintenance due" value={exceeded.toString()} warn={exceeded > 0} />
        <Stat label="Approaching" value={warning.toString()} warn={warning > 0} />
        <Stat label="No limit set" value={unknown.toString()} />
      </div>

      {dueList.length > 0 && (
        <div className="mt-4 rounded-lg border-2 border-destructive/40 bg-destructive/5 p-4">
          <h2 className="text-sm font-semibold text-destructive">
            Periodic (heavy) maintenance — due or approaching ({dueList.length})
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Shots since the last periodic maintenance, against the limit on the
            material's master data record. Passing the limit is allowed — a mold
            is never stopped mid-run — but it raises an alarm, and from then on
            it is not planned into new work until the alarm is closed.
          </p>
          <button
            onClick={async () => {
              setSyncing(true)
              try {
                await syncAlarms()
              } finally {
                setSyncing(false)
              }
            }}
            disabled={syncing}
            className="mt-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:bg-muted disabled:opacity-50"
            title="Alarms are raised automatically when MB51 is uploaded; use this to re-check now"
          >
            {syncing ? 'Checking…' : 'Re-check alarms now'}
          </button>
          <div className="mt-2 overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Mold</th>
                  <th className="px-3 py-2 font-medium">Shots</th>
                  <th className="px-3 py-2 font-medium">Limit</th>
                  <th className="px-3 py-2 font-medium">Used</th>
                  <th className="px-3 py-2 font-medium">Last periodic</th>
                  <th className="px-3 py-2 font-medium">Booked?</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {dueList.map((row) => {
                  const booked = upcomingMaintenance.find(
                    (m) => m.material === row.material && m.kind !== 'repair',
                  )
                  const held = readinessByMaterial.get(row.material)
                  return (
                    <tr key={row.material} className="border-t border-border">
                      <td className="px-3 py-2 font-medium text-foreground">{row.material}</td>
                      <td className="px-3 py-2 text-foreground">
                        {Math.round(row.cumulativeShots).toLocaleString('en-GB')}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {row.maxShots?.toLocaleString('en-GB') ?? '—'}
                      </td>
                      <td className="px-3 py-2">
                        <span className={STATUS_STYLE[row.status]}>
                          {row.usageRatio === null
                            ? STATUS_LABEL[row.status]
                            : `${Math.round(row.usageRatio * 100)}%`}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {row.lastMaintenance ?? 'never'}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {booked ? (
                          <span className="text-emerald-700">
                            {booked.date}
                            {booked.dateTo ? ` → ${booked.dateTo}` : ''}
                          </span>
                        ) : held && !held.ready ? (
                          <span className="text-amber-700">held</span>
                        ) : (
                          <span className="text-destructive">not booked</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => {
                            setMaterial(row.material)
                            setKind('periodic')
                            window.scrollTo({ top: 0, behavior: 'smooth' })
                          }}
                          className="text-xs text-foreground underline hover:no-underline"
                        >
                          Book it
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <h2 className="mt-8 text-sm font-semibold text-foreground">
        Is the mold ready for production?
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        A mold that is not ready is not planned at all. Give the date it will
        be ready and the plan resumes from that day; leave the date empty and
        it stays out of the plan until someone releases it.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-border p-4">
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Material</span>
          <div className="mt-1 w-56">
            <MaterialPicker
              options={materialOptions}
              value={readyMaterial}
              onChange={setReadyMaterial}
              placeholder="Search master data"
            />
          </div>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Ready on (opt.)</span>
          <input
            type="date"
            className="mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={readyDate}
            onChange={(e) => setReadyDate(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Reason (opt.)</span>
          <input
            className="mt-1 w-56 rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={readyReason}
            onChange={(e) => setReadyReason(e.target.value)}
            placeholder="Punch being reground"
          />
        </label>
        <button
          onClick={() => void submitReadiness(false)}
          disabled={!readyMaterial.trim()}
          className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Hold — not ready
        </button>
        <button
          onClick={() => void submitReadiness(true)}
          disabled={!readyMaterial.trim()}
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          Release — ready
        </button>
      </div>

      {heldMolds.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-amber-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-amber-50 text-amber-900">
              <tr>
                <th className="px-3 py-2 font-medium">Held mold</th>
                <th className="px-3 py-2 font-medium">Ready on</th>
                <th className="px-3 py-2 font-medium">Reason</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {heldMolds.map((r) => (
                <tr key={r._id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium text-foreground">{r.material}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.readyDate ?? (
                      <span className="text-destructive">no date — held indefinitely</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.reason ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() =>
                        void setReadiness({
                          material: r.material,
                          ready: true,
                          updatedBy: currentUser ?? undefined,
                        })
                      }
                      className="text-xs text-foreground underline hover:no-underline"
                    >
                      Release
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-8 text-sm font-semibold text-foreground">Book mold maintenance</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        The mold cannot run on any day in the range. Periodic maintenance also
        restarts the shot counter from the start date; a repair does not.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-border p-4">
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Material</span>
          <div className="mt-1 w-56">
            <MaterialPicker
              options={materialOptions}
              value={material}
              onChange={setMaterial}
              placeholder="Search master data"
            />
          </div>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Type</span>
          <select
            className="mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="periodic">Periodic (heavy) — resets the counter</option>
            <option value="repair">Repair — does not reset</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">From</span>
          <input
            type="date"
            className="mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">To (opt.)</span>
          <input
            type="date"
            className="mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Note (opt.)</span>
          <input
            className="mt-1 w-56 rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Cutter replaced"
          />
        </label>
        <button
          onClick={() => void submit()}
          disabled={!material.trim()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          Book maintenance
        </button>
      </div>

      {upcomingMaintenance.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Mold</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Days closed</th>
                <th className="px-3 py-2 font-medium">Note</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {upcomingMaintenance.map((m) => (
                <tr key={m._id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium text-foreground">{m.material}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {m.kind === 'repair' ? 'Repair' : 'Periodic'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {m.date}
                    {m.dateTo ? ` → ${m.dateTo}` : ''}{' '}
                    <span className="text-xs">
                      ({maintenanceDates(m).length} day
                      {maintenanceDates(m).length > 1 ? 's' : ''})
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{m.note ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete the maintenance booked for ${m.material} on ${m.date}?`,
                          )
                        ) {
                          void removeMaintenance({ id: m._id })
                        }
                      }}
                      className="text-xs text-destructive hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {actualStatus === 'LoadingFirstPage' && (
        <p className="mt-6 text-sm text-muted-foreground">Loading actual production…</p>
      )}

      {actualIncomplete && (
        <p className="mt-6 rounded-lg border-2 border-destructive bg-destructive/10 p-3 text-sm text-foreground">
          <strong className="text-destructive">These shot counts are too low.</strong>{' '}
          There is more actual production than one query can read, so part of it
          is missing from the totals below. A mould close to its limit may look
          safe here. Upload a shorter MB51 period.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No actual production data has been uploaded, so mold shots cannot be
          calculated. Upload the MB51 report on the Actuals page.
        </p>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Material</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Shots</th>
                <th className="px-3 py-2 font-medium">Limit</th>
                <th className="px-3 py-2 font-medium">Remaining</th>
                <th className="px-3 py-2 font-medium">Usage</th>
                <th className="px-3 py-2 font-medium">Last maintenance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.material} className="border-t border-border">
                  <td className="px-3 py-2 font-medium text-foreground">{r.material}</td>
                  <td className="px-3 py-2">
                    <span className={STATUS_STYLE[r.status]}>{STATUS_LABEL[r.status]}</span>
                  </td>
                  <td className="px-3 py-2 text-foreground">
                    {r.cumulativeShots.toLocaleString('en-GB')}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.maxShots ? r.maxShots.toLocaleString('en-GB') : '—'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.remainingShots !== null ? r.remainingShots.toLocaleString('en-GB') : '—'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.usageRatio !== null ? `${(r.usageRatio * 100).toFixed(0)}%` : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {r.lastMaintenance ?? 'none'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {maintenance.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-foreground">
            Maintenance records ({maintenance.length})
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {maintenance
              .slice()
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((m) => (
                <li
                  key={m._id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                >
                  <span className="text-foreground">
                    <strong>{m.material}</strong>{' '}
                    <span className="text-muted-foreground">
                      — {m.date}
                      {m.note ? ` · ${m.note}` : ''}
                    </span>
                  </span>
                  <button
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete the maintenance record for ${m.material} on ${m.date}?`,
                        )
                      ) {
                        void removeMaintenance({ id: m._id })
                      }
                    }}
                    className="text-xs text-destructive hover:underline"
                  >
                    Delete
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${warn ? 'text-destructive' : 'text-foreground'}`}>
        {value}
      </p>
    </div>
  )
}
