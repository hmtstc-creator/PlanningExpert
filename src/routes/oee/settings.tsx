import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { api } from '../../../convex/_generated/api'
import { OeeRebuildNotice, useOeeConfig } from '../../components/OeePanel'
import { InfoTip, PageHeader } from '../../components/PageHeader'
import { useMutation, useQuery } from '../../lib/convexTransport'
import { friendlyError } from '../../lib/mutationErrors'
import { addDaysIso, configProblems, dataCostCenters, suggestConfig, withPlantCostCenters, type DayRow, type OeeConfig, type Pick, type ShiftRow } from '../../lib/oee'
import { fromStoredDay, type StoredDowntimeDay } from '../../lib/oeeStore'
import { useCanOpen, usePlant } from '../../lib/plantContext'
import { OEE_SUGGESTED } from '../../lib/settingsDefaults'
import { relatedPages } from '../../lib/navigation'

export const Route = createFileRoute('/oee/settings')({
  component: OeeSettingsPage,
})

/**
 * OEE ayarları: tesise özel her değer burada tanımlanır, kodda değil.
 * "Suggest from data" verideki kodlardan öneri doldurur; kaydeden kullanıcıdır.
 */

const input = 'rounded-md border border-input bg-background px-2 py-1 text-sm'

function OeeSettingsPage() {
  const { config: saved, loaded, savedAt } = useOeeConfig()
  const plantShifts = usePlant().ctx?.active?.shifts
  const shiftSource = usePlant().ctx?.active?.shiftSource
  const canOpen = useCanOpen()
  // Fabrikada tanımlı masraf yerleri: adı orada değişir, burada yalnızca alan.
  const plantList = usePlant().ctx?.active?.costCenters ?? []
  const departments = usePlant().ctx?.active?.departments ?? []
  const plantCcs = new Set(plantList.map((x) => x.code))
  const save = useMutation(api.oee.saveSettings)
  const coverage = useQuery(api.oee.coverage) as
    | { days: { from: string; to: string } | null; shifts: { from: string; to: string } | null; downtimes: { from: string; to: string } | null }
    | undefined
  const dayTo = coverage?.days?.to
  const shiftTo = coverage?.shifts?.to
  const downTo = coverage?.downtimes?.to
  const days = (useQuery(api.oee.days, dayTo ? { from: addDaysIso(dayTo, -120), to: dayTo } : 'skip') ?? []) as DayRow[]
  const shifts = (useQuery(api.oee.shifts, shiftTo ? { from: addDaysIso(shiftTo, -20), to: shiftTo } : 'skip') ?? []) as ShiftRow[]
  const downRaw = (useQuery(api.oee.downtimeDays, downTo ? { from: addDaysIso(downTo, -6), to: downTo } : 'skip') ?? []) as StoredDowntimeDay[]
  const downtimes = useMemo(() => downRaw.map(fromStoredDay), [downRaw])

  const [draft, setDraft] = useState<OeeConfig | null>(null)
  const [state, setState] = useState<{ kind: 'idle' | 'saving' | 'saved' } | { kind: 'error'; text: string }>({ kind: 'idle' })
  useEffect(() => {
    if (loaded && draft === null) setDraft(saved)
  }, [loaded, saved, draft])
  const c = draft ?? saved
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved)
  const set = (patch: Partial<OeeConfig>) => {
    setDraft({ ...c, ...patch })
    setState({ kind: 'idle' })
  }

  // Verideki değerler (seçim listeleri için).
  const events = downtimes.flatMap((d) => d.events)
  const rc1Values = [...new Set([...events.map((e) => e.rc1), ...c.lossReasonCodes, ...c.breakReasonCodes])].filter(Boolean).sort()
  const texts = [...new Set([...events.map((e) => e.textEn.trim().toUpperCase()), ...c.setupTexts.map((t) => t.text)])].filter(Boolean).sort()
  const [textFilter, setTextFilter] = useState('')

  // Öneri yalnızca alanları ve kodları doldurur; masraf yerleri fabrikanınkiler kalır.
  const suggest = () => set(withPlantCostCenters(suggestConfig({ days, shifts, downtimes }, c, OEE_SUGGESTED), plantList, departments))

  // Verideki masraf yerleri ve makineleri (günler, vardiyalar, duruşlar).
  const found = useMemo(() => dataCostCenters({ days, shifts, downtimes }), [days, shifts, downtimes])
  // Veride olup bu fabrikanın masraf yeri olmayan kodlar (satırları yüklenmez).
  const notOfPlant = [...found.keys()].filter((code) => !plantCcs.has(code))
  const hasData = !!(coverage?.shifts || coverage?.days || coverage?.downtimes)

  const onSave = async () => {
    setState({ kind: 'saving' })
    try {
      await save({ config: c })
      setDraft(c)
      setState({ kind: 'saved' })
    } catch (e) {
      setState({ kind: 'error', text: friendlyError(e).message })
    }
  }

  const problems = configProblems(c)

  return (
    <div className="w-full px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <PageHeader
        title="OEE Settings"
        summary="Everything specific to your plant is defined here — nothing is written in the program."
        links={relatedPages('/oee/settings')}
        info={
          <>
            <p>
              Upload data first, then press <b>Suggest from data</b>: the lists are filled from the codes
              found in your files. Check and rename them, then <b>Save</b>. Nothing is used until it is
              saved.
            </p>
            <p>Changing a setting recalculates every page at once; uploaded data is never changed.</p>
          </>
        }
      />

      <OeeRebuildNotice />

      <ol className="mt-4 grid gap-2 text-sm sm:grid-cols-4">
        <StepBox n={1} done={hasData} title="Upload data">
          {hasData ? (
            'Data is stored.'
          ) : (
            <Link to="/oee/data" className="font-medium text-foreground underline">
              Upload on OEE Data →
            </Link>
          )}
        </StepBox>
        <StepBox n={2} done={c.costCenters.length > 0 && c.shifts.length > 0} title="Suggest from data">
          <button type="button" onClick={suggest} disabled={!hasData} className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-muted disabled:opacity-40">
            Suggest from data
          </button>
          <span className="block text-xs text-muted-foreground">Fills every list below from the codes in your files.</span>
        </StepBox>
        <StepBox n={3} done={problems.length === 0} title="Check and rename">
          {problems.length ? <span className="text-amber-800">{problems.join(' ')}</span> : 'Everything is defined.'}
        </StepBox>
        <StepBox n={4} done={!!savedAt && !dirty} title="Save">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={!dirty || state.kind === 'saving'}
              className="rounded-md bg-foreground px-3 py-1 text-xs font-medium text-background disabled:opacity-40"
            >
              {state.kind === 'saving' ? 'Saving…' : 'Save'}
            </button>
            {dirty && (
              <button type="button" onClick={() => setDraft(saved)} className="text-xs underline">
                Discard
              </button>
            )}
          </div>
          {dirty && <span className="block text-xs font-medium text-amber-700">● Unsaved changes</span>}
          {state.kind === 'saved' && <span className="block text-xs text-emerald-700">✓ Saved</span>}
          {state.kind === 'error' && <span className="block text-xs text-destructive">Not saved: {state.text}</span>}
        </StepBox>
      </ol>

      <Card
        title="Departments"
        info="Every OEE page has a button per department of the plant (Company settings → Organization): the OEE of a department is the OEE of its cost centers. 'Cost center' lets you pick a cost center of the department; 'Machine' lets you pick a single machine (for a department of one cost center). 'Production after a setup' is the minutes of production that make a setup OK in this department; empty = the value under Numbers. Departments and which cost center belongs where are set on Company settings."
      >
        <Rows
          empty="This plant has no department yet — a creator adds them on Company settings → Organization."
          head={['Department', 'Cost centers', 'Pick by', 'Production after a setup (min)']}
          rows={c.areas.map((a, i) => [
            <span key="n" className="font-medium">
              {a.name}
            </span>,
            <span key="c" className="text-muted-foreground">
              {c.costCenters
                .filter((cc) => cc.area === a.name)
                .map((cc) => cc.code)
                .join(', ') || '—'}
            </span>,
            <select key="p" className={input} value={a.pick} onChange={(e) => set({ areas: c.areas.map((x, j) => (j === i ? { ...x, pick: e.target.value as Pick } : x)) })}>
              <option value="costCenter">Cost center</option>
              <option value="machine">Machine</option>
            </select>,
            <input
              key="s"
              type="number"
              min={1}
              className={`${input} w-24`}
              placeholder={c.startupRunMin ? String(c.startupRunMin) : ''}
              value={a.startupRunMin || ''}
              onChange={(e) => {
                const v = Number(e.target.value)
                set({ areas: c.areas.map((x, j) => (j === i ? { ...x, startupRunMin: v > 0 ? v : undefined } : x)) })
              }}
            />,
          ])}
        />
        <Link to="/settings" className="mt-2 inline-block text-xs underline">
          Departments and cost centers → Company settings
        </Link>
      </Card>

      <Card title="Cost centers" info="The cost centers of this plant and their department, as defined on Company settings → Organization; every one of them counts in the OEE pages — one without a department under Unassigned. Machines are read from the data.">
        <Rows
          empty="This plant has no cost center yet — a creator adds them on Company settings → Organization."
          head={['Code', 'Machines in the data', 'Name', 'Department']}
          rows={c.costCenters.map((cc) => [
            cc.code,
            <span key="m" className="text-muted-foreground">
              {found.get(cc.code)?.workCenters.join(', ') || '—'}
            </span>,
            <span key="n" title="Named on Company settings">{cc.name}</span>,
            cc.area ? (
              <span key="a">{cc.area}</span>
            ) : (
              <span key="a" className="text-amber-800">
                none — Unassigned
              </span>
            ),
          ])}
        />
        {notOfPlant.length > 0 && (
          <p className="mt-2 text-xs text-amber-800">
            In the uploaded data but not a cost center of this plant: {notOfPlant.join(', ')}. Rows of these cost centers are not uploaded
            to this plant; if they belong here, a creator adds them on Company settings.
          </p>
        )}
      </Card>

      <Card title="Shifts" info="Shift code of the files (Shift Defination, e.g. UB61) → shift number (1st, 2nd, 3rd …). Used for the week-by-shift chart and the Loss Bridge shift filter.">
        {plantShifts?.length ? (
          <p className="text-sm text-muted-foreground">
            From <b>Company settings → Shifts</b> ({shiftSource === 'plant' ? "this plant's own shifts" : 'company standard'}):{' '}
            {plantShifts.map((s) => `${s.number} ${s.name} = ${s.codes.join(', ') || '—'}`).join(' · ')}.{' '}
            {canOpen('/settings') && (
              <Link to="/settings" className="font-medium text-foreground underline">
                Change there →
              </Link>
            )}
          </p>
        ) : (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              Better: define the company's shifts and their codes once on <b>Company settings → Shifts</b> — every plant and page then uses them.
            </p>
            <Rows
              head={['Shift code', 'Shift number', '']}
              rows={c.shifts.map((s, i) => [
                s.code,
                <input
                  key="n"
                  type="number"
                  min={1}
                  className={`${input} w-20`}
                  value={s.number}
                  onChange={(e) => set({ shifts: c.shifts.map((x, j) => (j === i ? { ...x, number: Number(e.target.value) } : x)) })}
                />,
                <RemoveButton key="r" onClick={() => set({ shifts: c.shifts.filter((_, j) => j !== i) })} />,
              ])}
            />
          </>
        )}
      </Card>

      <Card title="Reason Code 1" info="Which downtimes count as a loss (their minutes ÷ loading time) and which are planned breaks (shown apart after a setup).">
        <Rows
          head={['Reason Code 1', 'Counts as']}
          rows={rc1Values.map((v) => [
            v,
            <select
              key="k"
              className={input}
              value={c.lossReasonCodes.includes(v) ? 'loss' : c.breakReasonCodes.includes(v) ? 'break' : 'none'}
              onChange={(e) => {
                const lossReasonCodes = c.lossReasonCodes.filter((x) => x !== v)
                const breakReasonCodes = c.breakReasonCodes.filter((x) => x !== v)
                if (e.target.value === 'loss') lossReasonCodes.push(v)
                if (e.target.value === 'break') breakReasonCodes.push(v)
                set({ lossReasonCodes, breakReasonCodes })
              }}
            >
              <option value="loss">Loss</option>
              <option value="break">Planned break</option>
              <option value="none">Neither</option>
            </select>,
          ])}
        />
      </Card>

      <Card
        title="Loss groups"
        info="Reason Code 2 of the loss downtimes. Name: shown in tables. Chart column: groups with the same column are added together in the charts (e.g. several small groups into 'Others'). In charts: untick for groups shown only in the tables (e.g. unexplained downtimes). Breakdown: shown in the MTTR / MTBF table. Bridge family: where the group sits in the Loss Bridge — Availability as the MES counts it (default), or Performance (e.g. short stops in the TPM way). It changes the availability / performance split there, never the OEE."
      >
        <Rows
          head={['Reason Code 2', 'Name', 'Chart column', 'In charts', 'Breakdown', 'Bridge family', '']}
          rows={c.lossGroups.map((g, i) => [
            g.code,
            <input key="l" className={input} value={g.label} onChange={(e) => set({ lossGroups: c.lossGroups.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />,
            <input key="c" className={input} value={g.chart} onChange={(e) => set({ lossGroups: c.lossGroups.map((x, j) => (j === i ? { ...x, chart: e.target.value } : x)) })} />,
            <input
              key="h"
              type="checkbox"
              checked={!g.hidden}
              onChange={(e) => set({ lossGroups: c.lossGroups.map((x, j) => (j === i ? { ...x, hidden: !e.target.checked } : x)) })}
            />,
            <input
              key="b"
              type="checkbox"
              checked={g.breakdown}
              onChange={(e) => set({ lossGroups: c.lossGroups.map((x, j) => (j === i ? { ...x, breakdown: e.target.checked } : x)) })}
            />,
            <select
              key="f"
              className={input}
              value={g.family ?? 'availability'}
              onChange={(e) =>
                set({
                  lossGroups: c.lossGroups.map((x, j) =>
                    j === i ? { ...x, family: e.target.value === 'performance' ? ('performance' as const) : ('availability' as const) } : x,
                  ),
                })
              }
            >
              <option value="availability">Availability</option>
              <option value="performance">Performance</option>
            </select>,
            <RemoveButton key="r" onClick={() => set({ lossGroups: c.lossGroups.filter((_, j) => j !== i) })} />,
          ])}
        />
      </Card>

      <Card title="Setups" info="Downtime texts (Reason Code Definition EN) that are a setup, planned or unplanned. Other adjustments after a setup are reasons for not getting into production.">
        <input className={`${input} mb-2 w-72`} placeholder="Filter texts…" value={textFilter} onChange={(e) => setTextFilter(e.target.value)} />
        <Rows
          head={['Downtime text', 'Setup']}
          rows={texts
            .filter((t) => !textFilter || t.includes(textFilter.toUpperCase()) || c.setupTexts.some((s) => s.text === t))
            .map((t) => {
              const hit = c.setupTexts.find((s) => s.text === t)
              return [
                t,
                <select
                  key="k"
                  className={input}
                  value={hit?.kind ?? 'none'}
                  onChange={(e) => {
                    const rest = c.setupTexts.filter((s) => s.text !== t)
                    set({ setupTexts: e.target.value === 'none' ? rest : [...rest, { text: t, kind: e.target.value as 'planned' | 'unplanned' }] })
                  }}
                >
                  <option value="none">Not a setup</option>
                  <option value="planned">Planned setup</option>
                  <option value="unplanned">Unplanned setup</option>
                </select>,
              ]
            })}
        />
      </Card>

      <Card title="Numbers">
        <div className="flex flex-wrap gap-4 text-sm">
          <NumberField label="Production after a setup for OK (min, areas without their own)" value={c.startupRunMin} onChange={(v) => set({ startupRunMin: v })} />
          <NumberField label="Weeks in the trends" value={c.trendWeeks} onChange={(v) => set({ trendWeeks: v })} />
          <NumberField label="Rows in the top lists" value={c.topN} onChange={(v) => set({ topN: v })} />
        </div>
      </Card>
    </div>
  )
}

function Card({ title, info, children }: { title: string; info?: string; children: ReactNode }) {
  return (
    <section className="mt-4 rounded-lg border border-border p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        {title}
        {info && <InfoTip label={title}>{info}</InfoTip>}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  )
}

function Rows({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty?: string }) {
  if (!rows.length) return <p className="text-xs text-muted-foreground">{empty ?? 'Nothing yet — upload data and press Suggest from data.'}</p>
  return (
    <div className="max-h-96 overflow-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted text-muted-foreground">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-2 py-1.5 text-left font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border">
              {r.map((cell, j) => (
                <td key={j} className="px-2 py-1">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StepBox({ n, done, title, children }: { n: number; done: boolean; title: string; children: ReactNode }) {
  return (
    <li className={`rounded-lg border p-3 ${done ? 'border-emerald-300 bg-emerald-50/50' : 'border-border'}`}>
      <p className="mb-1 flex items-center gap-2 font-semibold text-foreground">
        <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${done ? 'bg-emerald-600 text-white' : 'bg-foreground text-background'}`}>
          {done ? '✓' : n}
        </span>
        {title}
      </p>
      <div className="space-y-1 text-xs">{children}</div>
    </li>
  )
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-xs text-muted-foreground underline hover:text-destructive">
      Remove
    </button>
  )
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <input type="number" min={1} className={`${input} w-28`} value={value || ''} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}
