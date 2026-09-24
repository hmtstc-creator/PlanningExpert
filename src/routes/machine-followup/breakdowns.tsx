import { createFileRoute, Link } from '@tanstack/react-router'
import { useMemo, useRef, useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { ErrorBanner } from '../../components/ErrorBanner'
import { useMutation, useQuery } from '../../lib/convexTransport'
import { useCurrentUser } from '../../lib/currentUser'
import { isoDate } from '../../lib/dates'
import { downscaleImage } from '../../lib/imageResize'
import { inRange } from '../../lib/problemReport'
import { useSafeMutation } from '../../lib/useSafeMutation'

export const Route = createFileRoute('/machine-followup/breakdowns')({
  component: BreakdownsPage,
})

type Breakdown = {
  _id: string
  press: string
  problemType: string
  description?: string
  occurredAt: string
  occurredMinute?: number
  stopsPress: boolean
  expectedUpDate?: string
  expectedUpMinute?: number
  reportedBy?: string
  status: string
  solution?: string
  solvedBy?: string
  downtimeMinutes?: number
  photoUrls: (string | null)[]
}

function hhmm(minute: number | undefined): string {
  if (minute === undefined) return ''
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

/** "10:30" → 630; boş ya da hatalıysa undefined. */
function minuteOf(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value)
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined
}

function BreakdownsPage() {
  const { name: currentUser } = useCurrentUser()
  const rows = (useQuery(api.machineProblems.list) ?? []) as Breakdown[]
  const presses = (useQuery(api.presses.list) ?? []) as { name: string }[]
  const lookups = (useQuery(api.lookups.list) ?? []) as { kind: string; value: string }[]
  const problemTypes = useMemo(
    () => lookups.filter((l) => l.kind === 'machineProblemType').map((l) => l.value),
    [lookups],
  )

  const { run: report, error: reportError, clearError } = useSafeMutation(api.machineProblems.report)
  const { run: solve, error: solveError } = useSafeMutation(api.machineProblems.solve)
  const { run: setExpectedUp, error: expectedError } = useSafeMutation(api.machineProblems.setExpectedUp)
  const { run: reopen } = useSafeMutation(api.machineProblems.reopen)
  const { run: remove, error: removeError } = useSafeMutation(api.machineProblems.remove)
  const generateUploadUrl = useMutation(api.machineProblems.generateUploadUrl)

  const today = isoDate(new Date())
  const [press, setPress] = useState('')
  const [problemType, setProblemType] = useState('')
  const [occurredAt, setOccurredAt] = useState(today)
  const [occurredTime, setOccurredTime] = useState('')
  const [stopsPress, setStopsPress] = useState(true)
  const [upDate, setUpDate] = useState('')
  const [upTime, setUpTime] = useState('')
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const [solving, setSolving] = useState<string | null>(null)
  const [solution, setSolution] = useState('')
  const [solveDowntime, setSolveDowntime] = useState('')
  const [editingUp, setEditingUp] = useState<string | null>(null)
  const [editUpDate, setEditUpDate] = useState('')
  const [editUpTime, setEditUpTime] = useState('')

  const [tab, setTab] = useState<'open' | 'all'>('open')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [filterPress, setFilterPress] = useState('')

  const filtered = useMemo(() => {
    const ranged = inRange(rows, from, to)
    return filterPress ? ranged.filter((r) => r.press === filterPress) : ranged
  }, [rows, from, to, filterPress])
  const visible = useMemo(() => {
    const list = tab === 'open' ? filtered.filter((r) => r.status === 'open') : filtered
    return [...list].sort(
      (a, b) =>
        b.occurredAt.localeCompare(a.occurredAt) || (b.occurredMinute ?? 0) - (a.occurredMinute ?? 0),
    )
  }, [filtered, tab])
  const openCount = rows.filter((r) => r.status === 'open').length

  async function submit() {
    if (!press || !problemType) return
    setSaving(true)
    try {
      const photos: string[] = []
      for (const original of files) {
        const file = await downscaleImage(original)
        const url = await generateUploadUrl()
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': file.type },
          body: file,
        })
        if (!response.ok) throw new Error(`${original.name} could not be uploaded`)
        const { storageId } = (await response.json()) as { storageId: string }
        photos.push(storageId)
      }
      const ok = await report({
        press,
        problemType,
        occurredAt,
        occurredMinute: minuteOf(occurredTime),
        stopsPress,
        expectedUpDate: stopsPress && upDate ? upDate : undefined,
        expectedUpMinute: stopsPress && upDate ? minuteOf(upTime) : undefined,
        description: description.trim() || undefined,
        photos: photos.length > 0 ? photos : undefined,
        reportedBy: currentUser ?? undefined,
      })
      if (ok) {
        setDescription('')
        setUpDate('')
        setUpTime('')
        setOccurredTime('')
        setFiles([])
        if (fileInput.current) fileInput.current.value = ''
      }
    } finally {
      setSaving(false)
    }
  }

  const inputClass = 'rounded-md border border-input bg-background px-3 py-2 text-sm'

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-bold text-foreground">Machine Breakdowns</h1>
      <p className="mt-2 text-muted-foreground">
        Report a breakdown and record how it was solved — it closes only with a
        description of what was done. If the press is <strong>stopped</strong>,
        the plan does not use it until the expected time it is back, or until
        the breakdown is solved when no time is given; parts that then cannot
        be delivered show on the PlanningExpert{' '}
        <Link to="/alarms" className="underline hover:no-underline">
          Alarms
        </Link>{' '}
        page. Which presses fail and why is on the{' '}
        <Link to="/machine-followup/reports" className="underline hover:no-underline">
          Reports
        </Link>{' '}
        page.
      </p>

      <ErrorBanner
        message={reportError ?? solveError ?? removeError ?? expectedError}
        onDismiss={clearError}
      />

      {problemTypes.length === 0 && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          The machine problem type list is empty, so a breakdown cannot be
          reported yet. An admin fills it in on the Admin page (Lists → Machine
          problem types).
        </p>
      )}

      <div className="mt-6 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Report a breakdown</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground">Press</span>
            <select className={`mt-1 w-full ${inputClass}`} value={press} onChange={(e) => setPress(e.target.value)}>
              <option value="">Select…</option>
              {presses.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground">Problem type</span>
            <select
              className={`mt-1 w-full ${inputClass}`}
              value={problemType}
              onChange={(e) => setProblemType(e.target.value)}
            >
              <option value="">Select…</option>
              {problemTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground">Date</span>
            <input
              type="date"
              className={`mt-1 w-full ${inputClass}`}
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground">Time (opt.)</span>
            <input
              type="time"
              className={`mt-1 w-full ${inputClass}`}
              value={occurredTime}
              onChange={(e) => setOccurredTime(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-foreground sm:col-span-4">
            <input type="checkbox" checked={stopsPress} onChange={(e) => setStopsPress(e.target.checked)} />
            The press is stopped — do not plan it until it is back
          </label>
          {stopsPress && (
            <>
              <label className="text-sm">
                <span className="block text-xs text-muted-foreground">Expected back (date, opt.)</span>
                <input
                  type="date"
                  className={`mt-1 w-full ${inputClass}`}
                  value={upDate}
                  onChange={(e) => setUpDate(e.target.value)}
                />
              </label>
              <label className="text-sm">
                <span className="block text-xs text-muted-foreground">at (opt.)</span>
                <input
                  type="time"
                  className={`mt-1 w-full ${inputClass}`}
                  value={upTime}
                  disabled={!upDate}
                  onChange={(e) => setUpTime(e.target.value)}
                />
              </label>
              <p className="self-end pb-2 text-xs text-muted-foreground sm:col-span-2">
                {upDate
                  ? 'The plan uses the press again from this moment.'
                  : 'No date: the press stays out of the plan until the breakdown is solved.'}
              </p>
            </>
          )}
          <label className="text-sm sm:col-span-2">
            <span className="block text-xs text-muted-foreground">Photos (opt.)</span>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              className="mt-1 w-full text-sm text-foreground file:mr-2 file:rounded-md file:border-0 file:bg-muted file:px-2 file:py-1.5 file:text-xs"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
          </label>
          <label className="text-sm sm:col-span-4">
            <span className="block text-xs text-muted-foreground">What happened?</span>
            <textarea
              rows={2}
              className={`mt-1 w-full ${inputClass}`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Main cylinder leaking oil, ram stopped at BDC"
            />
          </label>
        </div>
        <button
          onClick={() => void submit()}
          disabled={!press || !problemType || saving}
          className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Report breakdown'}
        </button>
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-2">
        <div className="flex gap-1">
          {(
            [
              ['open', `Open (${openCount})`],
              ['all', `History (${rows.length})`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === value
                  ? 'bg-foreground text-background'
                  : 'border border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">From</span>
          <input type="date" className={`mt-1 ${inputClass}`} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">To</span>
          <input type="date" className={`mt-1 ${inputClass}`} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Press</span>
          <select className={`mt-1 ${inputClass}`} value={filterPress} onChange={(e) => setFilterPress(e.target.value)}>
            <option value="">All presses</option>
            {presses.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {visible.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No breakdowns match this filter.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {visible.map((b) => (
            <div
              key={b._id}
              className={`rounded-lg border p-4 ${
                b.status === 'open'
                  ? b.stopsPress
                    ? 'border-destructive/50 bg-destructive/5'
                    : 'border-amber-300 bg-amber-50/50'
                  : 'border-border'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {b.press} · {b.problemType}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {b.occurredAt} {hhmm(b.occurredMinute)}
                    {b.reportedBy ? ` · reported by ${b.reportedBy}` : ''}
                    {b.downtimeMinutes ? ` · ${b.downtimeMinutes} min lost` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {b.status === 'open' && b.stopsPress && (
                    <span className="rounded bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
                      Press down —{' '}
                      {b.expectedUpDate
                        ? `back ${b.expectedUpDate} ${hhmm(b.expectedUpMinute)}`
                        : 'until solved'}
                    </span>
                  )}
                  {b.status === 'open' && !b.stopsPress && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                      Running with a fault
                    </span>
                  )}
                  {b.status !== 'open' && (
                    <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                      Solved
                    </span>
                  )}
                </div>
              </div>

              {b.description && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{b.description}</p>
              )}
              {b.photoUrls.filter(Boolean).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {b.photoUrls
                    .filter((u): u is string => !!u)
                    .map((url) => (
                      <a key={url} href={url} target="_blank" rel="noreferrer">
                        <img
                          src={url}
                          alt={`${b.press} ${b.problemType}`}
                          className="h-24 w-24 rounded-md border border-border object-cover"
                        />
                      </a>
                    ))}
                </div>
              )}
              {b.solution && (
                <p className="mt-2 rounded-md bg-emerald-50 p-2 text-sm text-emerald-900">
                  <strong>Solution:</strong> {b.solution}
                  {b.solvedBy ? ` — ${b.solvedBy}` : ''}
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {b.status === 'open' ? (
                  solving === b._id ? (
                    <>
                      <textarea
                        rows={2}
                        className={`w-72 ${inputClass}`}
                        placeholder="What was done to fix it? (required)"
                        value={solution}
                        onChange={(e) => setSolution(e.target.value)}
                      />
                      <input
                        type="number"
                        min={0}
                        className={`w-36 ${inputClass}`}
                        placeholder="Min lost (opt.)"
                        value={solveDowntime}
                        onChange={(e) => setSolveDowntime(e.target.value)}
                      />
                      <button
                        onClick={async () => {
                          const ok = await solve({
                            id: b._id,
                            solution,
                            downtimeMinutes: solveDowntime.trim() === '' ? undefined : Number(solveDowntime),
                            solvedBy: currentUser ?? undefined,
                          })
                          if (ok) {
                            setSolving(null)
                            setSolution('')
                            setSolveDowntime('')
                          }
                        }}
                        disabled={!solution.trim()}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      >
                        Save solution
                      </button>
                      <button onClick={() => setSolving(null)} className="text-xs text-muted-foreground underline">
                        Cancel
                      </button>
                    </>
                  ) : editingUp === b._id ? (
                    <>
                      <input
                        type="date"
                        className={inputClass}
                        value={editUpDate}
                        onChange={(e) => setEditUpDate(e.target.value)}
                      />
                      <input
                        type="time"
                        className={inputClass}
                        value={editUpTime}
                        disabled={!editUpDate}
                        onChange={(e) => setEditUpTime(e.target.value)}
                      />
                      <button
                        onClick={async () => {
                          const ok = await setExpectedUp({
                            id: b._id,
                            expectedUpDate: editUpDate || undefined,
                            expectedUpMinute: editUpDate ? minuteOf(editUpTime) : undefined,
                          })
                          if (ok) setEditingUp(null)
                        }}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                      >
                        Save expected time
                      </button>
                      <button onClick={() => setEditingUp(null)} className="text-xs text-muted-foreground underline">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setSolving(b._id)
                          setSolution('')
                          setSolveDowntime('')
                        }}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                        title="A breakdown cannot be closed without saying what was done"
                      >
                        Solve — write what was done
                      </button>
                      {b.stopsPress && (
                        <button
                          onClick={() => {
                            setEditingUp(b._id)
                            setEditUpDate(b.expectedUpDate ?? '')
                            setEditUpTime(
                              b.expectedUpMinute !== undefined ? hhmm(b.expectedUpMinute) : '',
                            )
                          }}
                          className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted"
                        >
                          Change expected back time
                        </button>
                      )}
                    </>
                  )
                ) : (
                  <button
                    onClick={() => void reopen({ id: b._id })}
                    className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
                  >
                    Reopen
                  </button>
                )}
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete the ${b.problemType} breakdown on ${b.press} (${b.occurredAt})? Its photos go too.`,
                      )
                    ) {
                      void remove({ id: b._id })
                    }
                  }}
                  className="text-xs text-destructive hover:underline"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
