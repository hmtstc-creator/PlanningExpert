import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../../../../convex/_generated/api'
import { ErrorBanner } from '../../../components/ErrorBanner'
import { SavePdfButton } from '../../../components/SavePdfButton'
import { SopSheet, type SheetEdit } from '../../../components/sop/SopSheet'
import { useQuery } from '../../../lib/convexTransport'
import { isoDate } from '../../../lib/dates'
import { pdfFileName } from '../../../lib/pdfFile'
import { sheetsToPdf } from '../../../lib/pdfSheet'
import { usePlant } from '../../../lib/plantContext'
import {
  addPhoto,
  insertStep,
  mergeFrames,
  moveStep,
  patchStep,
  removePhoto,
  removeStep,
  setMark,
  setSecond,
  sopTitle,
  togglePpe,
} from '../../../lib/sop/sopDraft'
import { SHEET_H, SHEET_W, paginate } from '../../../lib/sop/sopLayout'
import { LANGUAGE_NAMES, MAX_PHOTOS_PER_STEP, type Draft, type Language } from '../../../lib/sop/sopSchema'
import { useSafeMutation } from '../../../lib/useSafeMutation'

export const Route = createFileRoute('/machine-followup/sop/$id')({
  component: SopEditorPage,
})

interface Job {
  _id: string
  status: string
  language: string
  machine: string
  partName: string
  videoName: string
  videoSeconds: number | null
  progress: string
  error: string
  pendingFrames: { step: number; photo: number; second: number }[]
  approvedAt: number | null
  approvedBy: string
  draft: Draft
  urls: Record<string, string | null>
}

const btn = 'rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-40'
const round1 = (n: number) => Math.round(n * 10) / 10

/** Ekrana sığan ölçek: form kendi ölçüsünde çizilir, ekranda küçültülür (PDF'e ölçeksiz kopyası gider). */
function useFitScale() {
  const ref = useRef<HTMLDivElement>(null)
  const [k, setK] = useState(0.5)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setK(Math.min(1, el.clientWidth / SHEET_W)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, k }
}

function StepPanel({
  draft,
  index,
  job,
  pending,
  busy,
  onChange,
  onFrame,
  drawing,
  setDrawing,
}: {
  draft: Draft
  index: number
  job: Job
  pending: ReadonlySet<string>
  busy: boolean
  onChange: (d: Draft) => void
  onFrame: (d: Draft, photo: number, second: number) => void
  drawing: { step: number; photo: number } | null
  setDrawing: (d: { step: number; photo: number } | null) => void
}) {
  const step = draft.steps[index]
  const [seconds, setSeconds] = useState<string[]>([])
  useEffect(() => setSeconds(step?.photos.map((p) => String(p.second)) ?? []), [step])
  if (!step) return null
  const max = job.videoSeconds ?? undefined
  const ask = (k: number, s: number) => {
    const sec = round1(Math.max(0, max !== undefined ? Math.min(max, s) : s))
    onFrame(setSecond(draft, index, k, sec), k, sec)
  }
  return (
    <div className="rounded-xl border border-border bg-card p-3 text-sm shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Step {index + 1}</h3>
        {step.start !== undefined && (
          <span className="text-xs text-muted-foreground">
            video {step.start}–{step.end} s
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" className={btn} disabled={index === 0} onClick={() => onChange(moveStep(draft, index, -1))}>
          ◀ Move
        </button>
        <button type="button" className={btn} disabled={index === draft.steps.length - 1} onClick={() => onChange(moveStep(draft, index, 1))}>
          Move ▶
        </button>
        <button type="button" className={btn} onClick={() => onChange(insertStep(draft, index))}>
          + Step after
        </button>
        <button
          type="button"
          className={`${btn} text-destructive`}
          onClick={() => window.confirm(`Delete step ${index + 1}?`) && onChange(removeStep(draft, index))}
        >
          Delete step
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Texts are written on the form itself — click a box to edit.</p>
      {step.photos.map((p, k) => {
        const isDrawing = drawing?.step === index && drawing.photo === k
        return (
          <div key={k} className="mt-3 rounded-lg border border-border p-2">
            <div className="flex items-center justify-between text-xs font-medium">
              <span>Photo {k + 1}</span>
              {pending.has(`${index}:${k}`) && <span className="text-amber-700">getting the frame…</span>}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <button type="button" className={btn} disabled={busy} onClick={() => ask(k, p.second - 1)}>
                −1 s
              </button>
              <button type="button" className={btn} disabled={busy} onClick={() => ask(k, p.second - 0.2)}>
                −0.2
              </button>
              <input
                className="w-20 rounded-md border border-input bg-background px-2 py-1 text-xs"
                value={seconds[k] ?? ''}
                onChange={(e) => setSeconds(seconds.map((x, j) => (j === k ? e.target.value : x)))}
                onKeyDown={(e) => e.key === 'Enter' && Number.isFinite(Number(seconds[k])) && ask(k, Number(seconds[k]))}
                aria-label="Second of the video"
              />
              <button type="button" className={btn} disabled={busy} onClick={() => ask(k, p.second + 0.2)}>
                +0.2
              </button>
              <button type="button" className={btn} disabled={busy} onClick={() => ask(k, p.second + 1)}>
                +1 s
              </button>
              <button type="button" className={btn} disabled={busy || !Number.isFinite(Number(seconds[k]))} onClick={() => ask(k, Number(seconds[k]))}>
                Use this second
              </button>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <button type="button" className={`${btn} ${isDrawing ? 'border-red-500 text-red-700' : ''}`} onClick={() => setDrawing(isDrawing ? null : { step: index, photo: k })}>
                {isDrawing ? 'Drag on the photo… (click to stop)' : 'Draw red mark'}
              </button>
              {p.mark && (
                <button type="button" className={btn} onClick={() => onChange(setMark(draft, index, k, undefined))}>
                  Remove mark
                </button>
              )}
              <button type="button" className={`${btn} text-destructive`} onClick={() => onChange(removePhoto(draft, index, k))}>
                Remove photo
              </button>
            </div>
          </div>
        )
      })}
      {step.photos.length < MAX_PHOTOS_PER_STEP && (
        <button
          type="button"
          className={`${btn} mt-3`}
          disabled={busy}
          onClick={() => {
            const second = round1((step.photos[0]?.second ?? step.start ?? 0) + 1)
            onFrame(addPhoto(draft, index, second), step.photos.length, second)
          }}
        >
          + Second photo
        </button>
      )}
    </div>
  )
}

function SopEditorPage() {
  const { id } = Route.useParams()
  const { canManage } = usePlant()
  const job = useQuery(api.sop.get, canManage ? { id } : 'skip') as Job | null | undefined
  const save = useSafeMutation(api.sop.saveDraft)
  const requestFrame = useSafeMutation(api.sop.requestFrame)
  const approve = useSafeMutation(api.sop.approve)
  const retry = useSafeMutation(api.sop.retry)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [drawing, setDrawing] = useState<{ step: number; photo: number } | null>(null)
  const sheets = useRef<(HTMLDivElement | null)[]>([])
  const { ref, k } = useFitScale()

  // Sunucudaki taslak değişince (yeni kare geldi): kaydedilmemiş yazı varsa yalnız kareler alınır.
  const serverJson = job ? JSON.stringify(job.draft) : ''
  useEffect(() => {
    if (!job) return
    setDraft((local) => (local && dirty ? mergeFrames(local, job.draft) : job.draft))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverJson])

  const pending = useMemo(() => new Set((job?.pendingFrames ?? []).map((f) => `${f.step}:${f.photo}`)), [job?.pendingFrames])
  const change = (d: Draft) => {
    setDraft(d)
    setDirty(true)
  }
  const persist = async (d: Draft) => {
    const ok = await save.run({ id, draftJson: JSON.stringify(d) })
    if (ok) setDirty(false)
    return ok
  }

  if (!canManage) return <div className="p-6 text-muted-foreground">Only a company creator can use SOP Builder.</div>
  if (job === undefined) return <div className="p-6 text-muted-foreground">Loading…</div>
  if (job === null) return <div className="p-6 text-muted-foreground">This SOP no longer exists.</div>

  const editable = job.status === 'review' || job.status === 'approved'
  const d = draft ?? job.draft
  const pages = paginate(d.steps)
  const edit: SheetEdit | undefined = editable
    ? {
        setHeader: (f, value) => change({ ...d, header: { ...d.header, [f]: value } }),
        setStep: (i, patch) => change(patchStep(d, i, patch)),
        togglePpe: (key) => change(togglePpe(d, key)),
        select: (i) => setSelected(i),
        drawing,
        setMark: (i, p, mark) => {
          change(setMark(d, i, p, mark))
          setDrawing(null)
        },
      }
    : undefined
  const onFrame = async (next: Draft, photo: number, second: number) => {
    setDraft(next)
    if (!(await persist(next)) || selected === null) return
    await requestFrame.run({ id, step: selected, photo, second })
  }
  const error = save.error ?? requestFrame.error ?? approve.error ?? retry.error

  return (
    <div className="w-full px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <Link to="/machine-followup/sop" className="text-xs text-primary hover:underline">
            ← SOP Builder
          </Link>
          <h1 className="text-2xl font-bold text-foreground">{d.header.operation || 'SOP'}</h1>
          <p className="text-sm text-muted-foreground">
            {LANGUAGE_NAMES[job.language as Language] ?? job.language}
            {job.machine && ` · ${job.machine}`}
            {job.partName && ` · ${job.partName}`}
            {job.videoName && ` · ${job.videoName}`}
            {job.videoSeconds ? ` (${Math.round(job.videoSeconds)} s)` : ''}
            {job.approvedAt && ` · approved by ${job.approvedBy} ${new Date(job.approvedAt).toLocaleDateString()}`}
          </p>
        </div>
        {editable && (
          <div className="flex flex-wrap items-start gap-2">
            <button type="button" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted" onClick={() => change(insertStep(d, d.steps.length - 1))}>
              + Step
            </button>
            <button
              type="button"
              disabled={!dirty || save.pending}
              className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              onClick={() => void persist(d)}
            >
              {save.pending ? 'Saving…' : dirty ? 'Save' : 'Saved'}
            </button>
            <button
              type="button"
              disabled={approve.pending}
              className="rounded-md border border-emerald-600 px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
              onClick={async () => {
                if (dirty && !(await persist(d))) return
                await approve.run({ id })
              }}
            >
              {job.status === 'approved' ? 'Approved ✓' : 'Approve'}
            </button>
            <SavePdfButton
              fileName={pdfFileName(isoDate(new Date()), sopTitle(d))}
              make={() => sheetsToPdf(sheets.current.slice(0, pages.length).filter((x): x is HTMLDivElement => !!x), { size: 'A3', orientation: 'landscape', marginMm: 0 })}
            />
          </div>
        )}
      </div>
      <ErrorBanner message={error} onDismiss={() => (save.clearError(), requestFrame.clearError(), approve.clearError(), retry.clearError())} />

      {!editable && (
        <div className="mt-6 rounded-xl border border-border bg-card p-6 text-center">
          {job.status === 'error' ? (
            <>
              <p className="font-medium text-red-700">The analysis failed</p>
              <p className="mt-1 text-sm text-muted-foreground">{job.error}</p>
              <button type="button" className="mt-3 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground" onClick={() => void retry.run({ id })}>
                Try again
              </button>
            </>
          ) : (
            <>
              <p className="font-medium">{job.status === 'queued' ? 'Waiting in the queue' : 'Analysing the video…'}</p>
              <p className="mt-1 text-sm text-muted-foreground">{job.progress} — you can close this page; the work goes on.</p>
            </>
          )}
        </div>
      )}

      {editable && (
        <div className="mt-4 flex flex-col gap-4 xl:flex-row xl:items-start">
          <div ref={ref} className="min-w-0 flex-1">
            {pages.map((_, p) => (
              <div key={p} className="mb-4 shadow-sm" style={{ width: SHEET_W * k, height: SHEET_H * k }}>
                <div ref={(el) => void (sheets.current[p] = el)} style={{ width: SHEET_W, transform: `scale(${k})`, transformOrigin: '0 0' }}>
                  <SopSheet draft={d} page={p} pages={pages.length} urls={job.urls} edit={edit} selected={selected} pending={pending} />
                </div>
              </div>
            ))}
          </div>
          <div className="w-full shrink-0 xl:sticky xl:top-20 xl:w-80">
            {selected !== null && d.steps[selected] ? (
              <StepPanel
                draft={d}
                index={selected}
                job={job}
                pending={pending}
                busy={save.pending || requestFrame.pending}
                onChange={change}
                onFrame={(next, photo, second) => void onFrame(next, photo, second)}
                drawing={drawing}
                setDrawing={setDrawing}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">
                Click a photo on the form to change its frame, its red mark or the order of the steps. Click any text box to
                correct the text. Tick the protective equipment at the bottom.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
