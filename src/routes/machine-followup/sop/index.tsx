import { Link, createFileRoute } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'

import { api } from '../../../../convex/_generated/api'
import { ErrorBanner } from '../../../components/ErrorBanner'
import { PageLinks } from '../../../components/PageHeader'
import { GUIDE_LANGS, GUIDE_LANGUAGE_NAMES, SopGuide, type GuideLang } from '../../../components/sop/SopGuide'
import { useMutation, useQuery } from '../../../lib/convexTransport'
import { relatedPages } from '../../../lib/navigation'
import { usePlant } from '../../../lib/plantContext'
import { filterSops } from '../../../lib/sop/sopSearch'
import { LANGUAGES, LANGUAGE_NAMES, type Language } from '../../../lib/sop/sopSchema'
import { useSafeMutation } from '../../../lib/useSafeMutation'

export const Route = createFileRoute('/machine-followup/sop/')({
  component: SopListPage,
})

interface Row {
  _id: string
  status: string
  language: string
  operation: string
  reference: string
  sopNo: string
  machine: string
  steps: number
  createdAt: number
  createdBy: string
  progress: string
  error: string
}

const STATUS: Record<string, { label: string; cls: string }> = {
  queued: { label: 'In the queue', cls: 'bg-slate-100 text-slate-700' },
  processing: { label: 'Analysing', cls: 'bg-sky-100 text-sky-800' },
  review: { label: 'Ready to review', cls: 'bg-amber-100 text-amber-900' },
  approved: { label: 'Approved', cls: 'bg-emerald-100 text-emerald-800' },
  error: { label: 'Failed', cls: 'bg-red-100 text-red-800' },
}

const inputClass = 'mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
const today = () => {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}

/** Büyük video: yükleme ilerlemesi görünsün diye XHR (fetch ilerleme vermez). */
function upload(url: string, file: File, onProgress: (p: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4')
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText).storageId)
      else reject(new Error(`Upload failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('Upload failed — check the connection'))
    xhr.send(file)
  })
}

/** "5, 12.5, 1:03" → saniyeler. */
function parseMoments(s: string): number[] {
  return s
    .split(/[,;\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const [a, b] = t.split(':')
      return b === undefined ? Number(a) : Number(a) * 60 + Number(b)
    })
    .filter((n) => Number.isFinite(n) && n >= 0)
}

function NewSop({ ready }: { ready: boolean }) {
  const uploadUrl = useMutation(api.sop.generateUploadUrl)
  const create = useMutation(api.sop.create)
  const [file, setFile] = useState<File | null>(null)
  const [language, setLanguage] = useState<Language>('tr')
  const [f, setF] = useState({ operation: '', machine: '', partName: '', reference: '', issuedBy: '', issueDate: today(), notes: '', moments: '' })
  const [progress, setProgress] = useState<number | null>(null)
  // Dosya kutusu yalnız yeniden kurularak boşalır.
  const [inputKey, setInputKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!file) return setError('Choose the video')
    if (!f.operation.trim()) return setError('Write the operation name')
    setError(null)
    setProgress(0)
    try {
      const storageId = await upload(await uploadUrl({}), file, setProgress)
      await create({
        videoStorageId: storageId,
        videoName: file.name,
        language,
        machine: f.machine,
        partName: f.partName,
        notes: f.notes,
        keyMoments: parseMoments(f.moments),
        header: { operation: f.operation, reference: f.reference, issuedBy: f.issuedBy, issueDate: f.issueDate },
      })
      setFile(null)
      setF({ ...f, operation: '', partName: '', reference: '', notes: '', moments: '' })
      setInputKey((k) => k + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setProgress(null)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-6 rounded-xl border border-border bg-card p-4 shadow-sm">
      <h2 className="text-base font-semibold">New SOP from a video</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        The video is analysed in the background, one at a time — you can close the page. The steps, photos and texts
        come back for you to check and correct before you save the PDF.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm sm:col-span-2">
          <span className="text-xs text-muted-foreground">Video (MP4, MOV…)</span>
          <input key={inputKey} type="file" accept="video/*" className={inputClass} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <label className="text-sm">
          <span className="text-xs text-muted-foreground">Language of the texts</span>
          <select className={inputClass} value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_NAMES[l]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-xs text-muted-foreground">Operation name (NUME OPERAȚIE)</span>
          <input className={inputClass} value={f.operation} onChange={set('operation')} required />
        </label>
        <label className="text-sm">
          <span className="text-xs text-muted-foreground">Machine</span>
          <input className={inputClass} value={f.machine} onChange={set('machine')} />
        </label>
        <label className="text-sm">
          <span className="text-xs text-muted-foreground">Part name</span>
          <input className={inputClass} value={f.partName} onChange={set('partName')} />
        </label>
        <label className="text-sm">
          <span className="text-xs text-muted-foreground">Part code (REFERINȚĂ)</span>
          <input className={inputClass} value={f.reference} onChange={set('reference')} />
        </label>
        <label className="text-sm">
          <span className="text-xs text-muted-foreground">Prepared by (EMIS DE)</span>
          <input className={inputClass} value={f.issuedBy} onChange={set('issuedBy')} />
        </label>
        <label className="text-sm">
          <span className="text-xs text-muted-foreground">Issue date (DATĂ EMITERE)</span>
          <input className={inputClass} value={f.issueDate} onChange={set('issueDate')} />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="text-xs text-muted-foreground">Key moments (optional, seconds: 5, 12, 1:03) — steps are split at these</span>
          <input className={inputClass} value={f.moments} onChange={set('moments')} placeholder="e.g. 4, 11, 27, 52" />
        </label>
        <label className="text-sm sm:col-span-2 lg:col-span-4">
          <span className="text-xs text-muted-foreground">Note for the analysis (optional)</span>
          <input className={inputClass} value={f.notes} onChange={set('notes')} placeholder="e.g. the operator works on the left side; the torque wrench clicks at 25 Nm" />
        </label>
      </div>
      {!ready && (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
          Uploads open when the worker is running and the Gemini key is entered (Setup above).
        </p>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button type="submit" disabled={progress !== null || !ready} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {progress === null ? 'Upload and analyse' : `Uploading… ${Math.round(progress * 100)}%`}
        </button>
        <span className="text-xs text-muted-foreground">Other fields of the form are written on the form itself.</span>
      </div>
      <ErrorBanner message={error} onDismiss={() => setError(null)} />
    </form>
  )
}

interface Readiness {
  workerConnected: boolean
  workerPaired: boolean
  aiKeySet: boolean
  aiKeyHint: string
  aiKeySetBy: string
  ready: boolean
}

/** Kurulum: Gemini anahtarı burada girilir (sohbete / sunucuya yazılmaz), worker durumu. */
function Setup({ status }: { status: Readiness | undefined }) {
  const setKey = useSafeMutation(api.sop.setAiKey)
  const clearKey = useSafeMutation(api.sop.clearAiKey)
  const reset = useSafeMutation(api.sop.resetWorker)
  const [key, setKeyText] = useState('')
  const [editing, setEditing] = useState(false)
  if (!status) return null
  const dot = (ok: boolean) => <span className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`} />
  return (
    <div className="mt-6 rounded-xl border border-border bg-card p-4 text-sm shadow-sm">
      <h2 className="text-base font-semibold">Setup</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {dot(status.workerConnected)}
        <span>
          {status.workerConnected
            ? 'The SOP worker on the server is running.'
            : 'The SOP worker is not running yet — it starts with the next site update (about 5 minutes).'}
        </span>
        {status.workerPaired && !status.workerConnected && (
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            title="Use this only if the worker was reinstalled and cannot connect"
            onClick={() => window.confirm('Forget the connected worker? The next worker that asks will be connected.') && void reset.run({})}
          >
            Reset connection
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {dot(status.aiKeySet)}
        {status.aiKeySet && !editing ? (
          <>
            <span>
              Gemini key is set ({status.aiKeyHint}
              {status.aiKeySetBy && `, by ${status.aiKeySetBy}`}).
            </span>
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => setEditing(true)}>
              Change
            </button>
            <button type="button" className="text-xs text-destructive hover:underline" onClick={() => window.confirm('Remove the Gemini key?') && void clearKey.run({})}>
              Remove
            </button>
          </>
        ) : (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={async (e) => {
              e.preventDefault()
              if (await setKey.run({ key })) {
                setKeyText('')
                setEditing(false)
              }
            }}
          >
            <span>Gemini key:</span>
            <input
              type="password"
              autoComplete="off"
              className="w-72 rounded-md border border-input bg-background px-3 py-1.5 text-sm"
              placeholder="AIza… (from aistudio.google.com)"
              value={key}
              onChange={(e) => setKeyText(e.target.value)}
            />
            <button type="submit" disabled={!key.trim() || setKey.pending} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
              Save key
            </button>
            {editing && (
              <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </form>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">The key is kept on our own server; the page only shows its last 4 characters.</p>
      <ErrorBanner message={setKey.error ?? clearKey.error ?? reset.error} onDismiss={() => (setKey.clearError(), clearKey.clearError(), reset.clearError())} />
    </div>
  )
}

function SopListPage() {
  const { canManage } = usePlant()
  const rows = useQuery(api.sop.list, canManage ? {} : 'skip') as Row[] | undefined
  const status = useQuery(api.sop.status, canManage ? {} : 'skip') as Readiness | undefined
  const retry = useSafeMutation(api.sop.retry)
  const remove = useSafeMutation(api.sop.remove)
  const [query, setQuery] = useState('')
  /** Sayfanın kılavuz dili (tek state; kılavuz bu dille gösterilir). */
  const [guideLang, setGuideLang] = useState<GuideLang>('tr')
  const shownRows = rows ? filterSops(rows, query) : rows
  if (!canManage) {
    return (
      <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
        <h1 className="text-2xl font-bold text-foreground">SOP Builder</h1>
        <p className="mt-2 text-muted-foreground">Only a company creator can use this page.</p>
      </div>
    )
  }
  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold text-foreground">SOP Builder</h1>
        <PageLinks links={relatedPages('/machine-followup/sop')} />
      </div>
      <p className="mt-1 text-muted-foreground">
        Standard operating procedures in the company form (PAȘI DE BAZĂ · PUNCTE CHEIE · CAUZE) from a video of the
        operation. The form never changes; more than 6 steps continue on a copy of the page.
      </p>
      <Setup status={status} />
      <NewSop ready={status?.ready ?? false} />
      <ErrorBanner message={retry.error ?? remove.error} onDismiss={() => (retry.clearError(), remove.clearError())} />
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          className={`${inputClass} max-w-md`}
          placeholder="Search by title or code…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search SOPs"
        />
        {query && rows && (
          <span className="text-xs text-muted-foreground">
            {shownRows?.length ?? 0} / {rows.length}
          </span>
        )}
      </div>
      <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Operation</th>
              <th className="px-3 py-2">Part code</th>
              <th className="px-3 py-2">Machine</th>
              <th className="px-3 py-2">Language</th>
              <th className="px-3 py-2">Steps</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows === undefined && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">Loading…</td>
              </tr>
            )}
            {rows && rows.length > 0 && shownRows?.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No SOP matches “{query}”.</td>
              </tr>
            )}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No SOP yet — upload the first video above.</td>
              </tr>
            )}
            {shownRows?.map((r) => {
              const st = STATUS[r.status] ?? { label: r.status, cls: 'bg-slate-100' }
              return (
                <tr key={r._id} className="border-t border-border align-top">
                  <td className="px-3 py-2 font-medium">
                    <Link to="/machine-followup/sop/$id" params={{ id: r._id }} className="text-primary hover:underline">
                      {r.operation || '(no name)'}
                    </Link>
                    {r.sopNo && <span className="ml-2 text-xs text-muted-foreground">{r.sopNo}</span>}
                  </td>
                  <td className="px-3 py-2">{r.reference}</td>
                  <td className="px-3 py-2">{r.machine}</td>
                  <td className="px-3 py-2">{LANGUAGE_NAMES[r.language as Language] ?? r.language}</td>
                  <td className="px-3 py-2">{r.steps || ''}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                    {(r.status === 'queued' || r.status === 'processing') && r.progress && <div className="mt-1 text-xs text-muted-foreground">{r.progress}</div>}
                    {r.status === 'error' && r.error && <div className="mt-1 max-w-xs text-xs text-red-700">{r.error}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString()}
                    <div>{r.createdBy}</div>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {r.status === 'error' && (
                      <button type="button" className="mr-3 text-xs text-primary hover:underline" onClick={() => void retry.run({ id: r._id })}>
                        Retry
                      </button>
                    )}
                    {r.status !== 'processing' && (
                      <button
                        type="button"
                        className="text-xs text-destructive hover:underline"
                        onClick={() => window.confirm(`Delete the SOP "${r.operation}"? Its photos are deleted too.`) && void remove.run({ id: r._id })}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-6 flex justify-end">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Guide language
          <select className={inputClass} value={guideLang} onChange={(e) => setGuideLang(e.target.value as GuideLang)}>
            {GUIDE_LANGS.map((l) => (
              <option key={l} value={l}>
                {GUIDE_LANGUAGE_NAMES[l]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <SopGuide lang={guideLang} />
    </div>
  )
}
