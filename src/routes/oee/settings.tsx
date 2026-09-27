import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { api } from '../../../convex/_generated/api'
import { useOeeConfig } from '../../components/OeePanel'
import { InfoTip, PageHeader } from '../../components/PageHeader'
import { useMutation, useQuery } from '../../lib/convexTransport'
import { friendlyError } from '../../lib/mutationErrors'
import { addDaysIso, configProblems, suggestConfig, type DayRow, type OeeConfig, type Pick, type ShiftRow } from '../../lib/oee'
import { fromStoredDay, type StoredDowntimeDay } from '../../lib/oeeStore'
import { OEE_SUGGESTED } from '../../lib/settingsDefaults'

export const Route = createFileRoute('/oee/settings')({
  component: OeeSettingsPage,
})

/**
 * OEE ayarları: tesise özel her değer burada tanımlanır, kodda değil.
 * "Suggest from data" verideki kodlardan öneri doldurur; kaydeden kullanıcıdır.
 */

const input = 'rounded-md border border-input bg-background px-2 py-1 text-sm'

function OeeSettingsPage() {
  const { config: saved, loaded } = useOeeConfig()
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

  const suggest = () =>
    set(suggestConfig({ days, shifts, downtimes }, c, OEE_SUGGESTED))

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
        links={[
          { to: '/oee', label: 'OEE Dashboard' },
          { to: '/oee/guide', label: 'How to use' },
        ]}
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

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={suggest} className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted">
          Suggest from data
        </button>
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={!dirty || state.kind === 'saving'}
          className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-40"
        >
          {state.kind === 'saving' ? 'Saving…' : 'Save'}
        </button>
        {dirty && (
          <button type="button" onClick={() => setDraft(saved)} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
            Discard changes
          </button>
        )}
        {dirty && <span className="text-xs font-medium text-amber-700">● Unsaved</span>}
        {state.kind === 'saved' && <span className="text-xs text-emerald-700">✓ Saved</span>}
        {state.kind === 'error' && <span className="text-xs text-destructive">Not saved: {state.text}</span>}
        {!days.length && !events.length && (
          <span className="text-xs text-muted-foreground">
            No data yet — <Link to="/oee/guide" className="underline">upload first</Link>, then suggest.
          </span>
        )}
      </div>
      {problems.length > 0 && <p className="mt-2 text-xs text-amber-800">Still missing: {problems.join(' ')}</p>}

      <Card title="Areas" info="The buttons above every OEE page. 'Cost center' lets you pick a cost center of the area; 'Machine' lets you pick a single machine (when the area is one cost center).">
        <Rows
          head={['Area name', 'Pick by', '']}
          rows={c.areas.map((a, i) => [
            <input
              key="n"
              className={input}
              value={a.name}
              onChange={(e) => {
                const old = a.name
                const name = e.target.value
                set({
                  areas: c.areas.map((x, j) => (j === i ? { ...x, name } : x)),
                  costCenters: c.costCenters.map((cc) => (cc.area === old ? { ...cc, area: name } : cc)),
                })
              }}
            />,
            <select key="p" className={input} value={a.pick} onChange={(e) => set({ areas: c.areas.map((x, j) => (j === i ? { ...x, pick: e.target.value as Pick } : x)) })}>
              <option value="costCenter">Cost center</option>
              <option value="machine">Machine</option>
            </select>,
            <RemoveButton key="r" onClick={() => set({ areas: c.areas.filter((_, j) => j !== i) })} />,
          ])}
        />
        <button type="button" onClick={() => set({ areas: [...c.areas, { name: `Area ${c.areas.length + 1}`, pick: 'costCenter' }] })} className="mt-2 text-xs underline">
          + Add area
        </button>
      </Card>

      <Card title="Cost centers" info="Name shown in lists and charts, and the area it belongs to.">
        <Rows
          head={['Code', 'Name', 'Area', '']}
          rows={c.costCenters.map((cc, i) => [
            cc.code,
            <input key="n" className={input} value={cc.name} onChange={(e) => set({ costCenters: c.costCenters.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />,
            <select key="a" className={input} value={cc.area} onChange={(e) => set({ costCenters: c.costCenters.map((x, j) => (j === i ? { ...x, area: e.target.value } : x)) })}>
              <option value="">—</option>
              {c.areas.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>,
            <RemoveButton key="r" onClick={() => set({ costCenters: c.costCenters.filter((_, j) => j !== i) })} />,
          ])}
        />
      </Card>

      <Card title="Shifts" info="Shift Group code of the files → shift number (1st, 2nd, 3rd …). Used for the week-by-shift chart and the downtime Shift column.">
        <Rows
          head={['Shift Group code', 'Shift number', '']}
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
        info="Reason Code 2 of the loss downtimes. Name: shown in tables. Chart column: groups with the same column are added together in the charts (e.g. several small groups into 'Others'). Breakdown: shown in the MTTR / MTBF table."
      >
        <Rows
          head={['Reason Code 2', 'Name', 'Chart column', 'Breakdown', '']}
          rows={c.lossGroups.map((g, i) => [
            g.code,
            <input key="l" className={input} value={g.label} onChange={(e) => set({ lossGroups: c.lossGroups.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />,
            <input key="c" className={input} value={g.chart} onChange={(e) => set({ lossGroups: c.lossGroups.map((x, j) => (j === i ? { ...x, chart: e.target.value } : x)) })} />,
            <input
              key="b"
              type="checkbox"
              checked={g.breakdown}
              onChange={(e) => set({ lossGroups: c.lossGroups.map((x, j) => (j === i ? { ...x, breakdown: e.target.checked } : x)) })}
            />,
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
          <NumberField label="Production after a setup for OK (min)" value={c.startupRunMin} onChange={(v) => set({ startupRunMin: v })} />
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

function Rows({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  if (!rows.length) return <p className="text-xs text-muted-foreground">Nothing yet — upload data and press Suggest from data.</p>
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
