import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useRef, useState } from 'react'

import { api } from '../../convex/_generated/api'
import { ErrorBanner } from '../components/ErrorBanner'
import { useMutation, useQuery } from '../lib/convexTransport'
import { useCurrentUser } from '../lib/currentUser'
import { isoDate } from '../lib/dates'
import {
  byMold,
  byOperation,
  byProblemType,
  inRange,
  type ProblemGroup,
} from '../lib/problemReport'
import { useSafeMutation } from '../lib/useSafeMutation'

export const Route = createFileRoute('/kalipproblem')({
  component: MoldProblemPage,
})

type Problem = {
  _id: string
  material: string
  operation: string
  problemType: string
  description?: string
  occurredAt: string
  reportedBy?: string
  reportedAt: number
  status: string
  solution?: string
  solvedBy?: string
  solvedAt?: number
  downtimeMinutes?: number
  photoUrls: (string | null)[]
}

function MoldProblemPage() {
  const { name: currentUser } = useCurrentUser()
  const problems = (useQuery(api.moldProblems.list) ?? []) as Problem[]
  const lookups = (useQuery(api.lookups.list) ?? []) as { kind: string; value: string }[]
  const products = useQuery(api.products.listAll)?.rows ?? []

  const { run: report, error: reportError, clearError } = useSafeMutation(api.moldProblems.report)
  const { run: solve, error: solveError } = useSafeMutation(api.moldProblems.solve)
  const { run: reopen } = useSafeMutation(api.moldProblems.reopen)
  const { run: remove, error: removeError } = useSafeMutation(api.moldProblems.remove)
  const generateUploadUrl = useMutation(api.moldProblems.generateUploadUrl)

  const operations = useMemo(
    () => lookups.filter((l) => l.kind === 'operation').map((l) => l.value),
    [lookups],
  )
  const problemTypes = useMemo(
    () => lookups.filter((l) => l.kind === 'problemType').map((l) => l.value),
    [lookups],
  )

  const today = isoDate(new Date())
  const [material, setMaterial] = useState('')
  const [operation, setOperation] = useState('')
  const [problemType, setProblemType] = useState('')
  const [occurredAt, setOccurredAt] = useState(today)
  const [description, setDescription] = useState('')
  const [downtime, setDowntime] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const [solving, setSolving] = useState<string | null>(null)
  const [solution, setSolution] = useState('')

  const [tab, setTab] = useState<'open' | 'all' | 'report'>('open')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [filterMaterial, setFilterMaterial] = useState('')

  const filtered = useMemo(() => {
    const ranged = inRange(problems, from, to)
    const q = filterMaterial.trim().toLowerCase()
    return q ? ranged.filter((p) => p.material.toLowerCase().includes(q)) : ranged
  }, [problems, from, to, filterMaterial])

  const visible = useMemo(() => {
    const list = tab === 'open' ? filtered.filter((p) => p.status === 'open') : filtered
    return [...list].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
  }, [filtered, tab])

  const openCount = problems.filter((p) => p.status === 'open').length

  async function submit() {
    if (!material.trim() || !operation || !problemType) return
    setUploading(true)
    try {
      // Fotoğraflar doğrudan dosya deposuna yüklenir; mutasyon yalnızca
      // kimlikleri alır. Büyük dosyayı mutasyonun içinden geçirmek boyut
      // sınırına takılırdı.
      const photos: string[] = []
      for (const file of files) {
        const url = await generateUploadUrl()
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': file.type },
          body: file,
        })
        if (!response.ok) throw new Error(`${file.name} could not be uploaded`)
        const { storageId } = (await response.json()) as { storageId: string }
        photos.push(storageId)
      }
      const ok = await report({
        material: material.trim(),
        operation,
        problemType,
        occurredAt,
        description: description.trim() || undefined,
        downtimeMinutes: downtime.trim() === '' ? undefined : Number(downtime),
        photos: photos.length > 0 ? photos : undefined,
        reportedBy: currentUser ?? undefined,
      })
      if (ok) {
        setDescription('')
        setDowntime('')
        setFiles([])
        if (fileInput.current) fileInput.current.value = ''
      }
    } finally {
      setUploading(false)
    }
  }

  const inputClass = 'rounded-md border border-input bg-background px-3 py-2 text-sm'

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-12">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Mold Problems</h1>
      <p className="mt-2 text-muted-foreground">
        Report what went wrong on a mold, record how it was solved, and see
        which molds and which faults keep coming back. Photographs can be
        attached to a report. The operation and problem type lists are managed
        by the admin, so they match what the shop floor actually says.
      </p>

      <ErrorBanner message={reportError ?? solveError ?? removeError} onDismiss={clearError} />

      {(operations.length === 0 || problemTypes.length === 0) && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          The operation or problem type list is empty, so a problem cannot be
          reported yet. An admin fills these in on the Admin page.
        </p>
      )}

      <div className="mt-6 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold text-foreground">Report a problem</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground">Mold (material)</span>
            <input
              className={`mt-1 w-full ${inputClass}`}
              list="problem-materials"
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
              placeholder="M250SP001RO"
            />
            <datalist id="problem-materials">
              {products.map((p) => (
                <option key={p.code} value={p.code} />
              ))}
            </datalist>
          </label>
          <label className="text-sm">
            <span className="block text-xs text-muted-foreground">Operation</span>
            <select
              className={`mt-1 w-full ${inputClass}`}
              value={operation}
              onChange={(e) => setOperation(e.target.value)}
            >
              <option value="">Select…</option>
              {operations.map((o) => (
                <option key={o} value={o}>
                  {o}
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
            <span className="block text-xs text-muted-foreground">Downtime (min, opt.)</span>
            <input
              type="number"
              min={0}
              className={`mt-1 w-full ${inputClass}`}
              value={downtime}
              onChange={(e) => setDowntime(e.target.value)}
            />
          </label>
          <label className="text-sm">
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
          <label className="text-sm sm:col-span-3">
            <span className="block text-xs text-muted-foreground">What happened?</span>
            <textarea
              rows={2}
              className={`mt-1 w-full ${inputClass}`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Burr on the left flange after 12,000 shots"
            />
          </label>
        </div>
        <button
          onClick={() => void submit()}
          disabled={!material.trim() || !operation || !problemType || uploading}
          className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {uploading ? 'Saving…' : `Report problem${files.length ? ` (${files.length} photo${files.length > 1 ? 's' : ''})` : ''}`}
        </button>
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-2">
        <div className="flex gap-1">
          {(
            [
              ['open', `Open (${openCount})`],
              ['all', `All (${problems.length})`],
              ['report', 'Report'],
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
          <span className="block text-xs text-muted-foreground">Mold</span>
          <input
            className={`mt-1 w-40 ${inputClass}`}
            placeholder="Filter by material"
            value={filterMaterial}
            onChange={(e) => setFilterMaterial(e.target.value)}
          />
        </label>
      </div>

      {tab === 'report' ? (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ReportTable title="By mold" groups={byMold(filtered)} />
          <ReportTable title="By problem type" groups={byProblemType(filtered)} />
          <ReportTable title="By operation" groups={byOperation(filtered)} />
        </div>
      ) : visible.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No problems match this filter.
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {visible.map((p) => (
            <div
              key={p._id}
              className={`rounded-lg border p-4 ${
                p.status === 'open' ? 'border-amber-300 bg-amber-50/50' : 'border-border'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {p.material} · {p.operation} · {p.problemType}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {p.occurredAt}
                    {p.reportedBy ? ` · reported by ${p.reportedBy}` : ''}
                    {p.downtimeMinutes ? ` · ${p.downtimeMinutes} min lost` : ''}
                  </p>
                </div>
                <span
                  className={
                    p.status === 'open'
                      ? 'rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900'
                      : 'rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800'
                  }
                >
                  {p.status === 'open' ? 'Open' : 'Solved'}
                </span>
              </div>

              {p.description && (
                <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{p.description}</p>
              )}

              {p.photoUrls.filter(Boolean).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {p.photoUrls.filter((u): u is string => !!u).map((url) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer">
                      <img
                        src={url}
                        alt={`${p.material} ${p.problemType}`}
                        className="h-24 w-24 rounded-md border border-border object-cover"
                      />
                    </a>
                  ))}
                </div>
              )}

              {p.solution && (
                <p className="mt-2 rounded-md bg-emerald-50 p-2 text-sm text-emerald-900">
                  <strong>Solution:</strong> {p.solution}
                  {p.solvedBy ? ` — ${p.solvedBy}` : ''}
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {p.status === 'open' ? (
                  solving === p._id ? (
                    <>
                      <input
                        className={`w-72 ${inputClass}`}
                        placeholder="What was done?"
                        value={solution}
                        onChange={(e) => setSolution(e.target.value)}
                      />
                      <button
                        onClick={async () => {
                          const ok = await solve({
                            id: p._id,
                            solution,
                            solvedBy: currentUser ?? undefined,
                          })
                          if (ok) {
                            setSolving(null)
                            setSolution('')
                          }
                        }}
                        disabled={!solution.trim()}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      >
                        Save solution
                      </button>
                      <button
                        onClick={() => setSolving(null)}
                        className="text-xs text-muted-foreground underline"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => {
                        setSolving(p._id)
                        setSolution('')
                      }}
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                    >
                      Solve
                    </button>
                  )
                ) : (
                  <button
                    onClick={() => void reopen({ id: p._id })}
                    className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
                  >
                    Reopen
                  </button>
                )}
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete the ${p.problemType} report for ${p.material} (${p.occurredAt})? Its photos go too.`,
                      )
                    ) {
                      void remove({ id: p._id })
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

function ReportTable({ title, groups }: { title: string; groups: ProblemGroup[] }) {
  return (
    <div className="rounded-lg border border-border">
      <h2 className="border-b border-border px-3 py-2 text-sm font-semibold text-foreground">
        {title}
      </h2>
      {groups.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">Nothing in this range.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Times</th>
              <th className="px-3 py-2 font-medium">Open</th>
              <th className="px-3 py-2 font-medium">Lost</th>
              <th className="px-3 py-2 font-medium">Last</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key} className="border-t border-border">
                <td className="px-3 py-2 font-medium text-foreground">{g.key}</td>
                <td className="px-3 py-2 text-foreground">{g.count}</td>
                <td className={`px-3 py-2 ${g.open > 0 ? 'text-amber-700' : 'text-muted-foreground'}`}>
                  {g.open}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {g.downtimeMinutes > 0 ? `${g.downtimeMinutes} min` : '—'}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{g.lastSeen}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
