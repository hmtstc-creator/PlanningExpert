import { Link, createFileRoute } from '@tanstack/react-router'
import { usePaginatedQuery, useQuery } from '../lib/convexTransport'
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

import { ErrorBanner } from '../components/ErrorBanner'
import { LevelChip, LevelLegend, TreeRow, type Level } from '../components/OrgTree'
import { InfoTip, PageHeader } from '../components/PageHeader'
import { SaveStatus } from '../components/SaveStatus'
import { UnsavedBar } from '../components/UnsavedBar'
import { relatedPages } from '../lib/navigation'
import { usePlant } from '../lib/plantContext'
import { UNNAMED_STOP, draftOf, pressPayload, sameDraft, stopPatch, stopValue } from '../lib/pressDraft'
import { RATE_MODELS, type RateModel } from '../lib/rateModel'
import { useDraftRows } from '../lib/useDraftRows'
import { useSafeMutation } from '../lib/useSafeMutation'
import {
  categoryGroups,
  hallGroups,
  orgGroups,
  pressesIn,
  sameWcNode,
  type WcCostCenter,
  type WcNode,
  type WcPress,
  type WcView,
} from '../lib/workCenterTree'
import { api } from '../../convex/_generated/api'

export const Route = createFileRoute('/makineler')({
  component: MakinelerPage,
})

const input = 'rounded-md border border-input bg-background px-2 py-1.5 text-sm'
const btn = 'rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40'

/** Kategori ve hol rozetleri (organizasyon seviyeleriyle karışmasın diye ayrı renk). */
function Chip({ kind }: { kind: 'category' | 'hall' }) {
  return kind === 'category' ? (
    <span
      title="Category (line)"
      className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded bg-violet-600 px-1 text-[10px] font-bold text-white"
    >
      CAT
    </span>
  ) : (
    <span
      title="Hall (setup crane)"
      className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded bg-teal-600 px-1 text-[10px] font-bold text-white"
    >
      HL
    </span>
  )
}

/** Holün ne olduğu ve planlayıcıda nasıl çalıştığı (tablo başlığında ve hol görünümünde). */
function HallInfo() {
  return (
    <>
      <p>
        <b>Hall = the setup crane.</b> The hall decides the setup rule: work centers in the same hall share one crane, so the planner keeps
        their setups from colliding.
      </p>
      <p>How it works, for work centers in the same hall:</p>
      <ul className="ml-4 list-disc space-y-0.5">
        <li>
          At most <i>Concurrent setups per hall</i> die setups run at the same time (normally 1). Backlog or late-risk setups may overlap up
          to the plant-wide limit.
        </li>
        <li>
          Consecutive setups keep the <i>Min. gap between setups</i>, frequency stops (e.g. coil changes) keep the <i>Min. gap between coil changes</i>.
        </li>
        <li>A die setup and a frequency stop never happen at the same time.</li>
        <li>When the crane is busy, the next setup waits — the job starts later or moves to another slot.</li>
      </ul>
      <p>
        The limits are set on the Work Calendar page (plan settings). The plan checks report any setup overlap in a hall, and the Gantt
        marks it.
      </p>
      <p>
        <b>Hall is optional.</b> Leave it empty for a work center with its own crane: it then never waits for another work center. The
        plant-wide limit on setups at once (setup crew) still applies to every work center.
      </p>
    </>
  )
}

/** Üretim modeli: work center parçayı neyle ölçer (src/lib/rateModel.ts). */
function ModelInfo() {
  return (
    <>
      <p>
        <b>Production model</b> — how the work center measures a part. Every part takes the model of its main machine.
      </p>
      <ul className="ml-4 list-disc space-y-0.5">
        <li>
          <b>{RATE_MODELS.stroke.label}</b>: {RATE_MODELS.stroke.hint}. The raw material page orders steel in kg for these parts.
        </li>
        <li>
          <b>{RATE_MODELS.cycle.label}</b>: {RATE_MODELS.cycle.hint}. In Master Data the part gets a cycle time in minutes per
          piece (3 decimals) and “stop every N pieces” for its frequency stop (fixture setup …).
        </li>
      </ul>
      <p>
        Every line has its own plan structure; they are not mixed. A press part that goes on to a spot welding line is planned on the
        press; the welding line is planned separately (no link between them today).
      </p>
    </>
  )
}

function ModelSelect({ value, onChange, className = '' }: { value: RateModel; onChange: (v: RateModel) => void; className?: string }) {
  return (
    <select className={`${input} ${className}`} value={value} onChange={(e) => onChange(e.target.value as RateModel)}>
      {(Object.keys(RATE_MODELS) as RateModel[]).map((m) => (
        <option key={m} value={m}>
          {RATE_MODELS[m].label}
        </option>
      ))}
    </select>
  )
}

/** Frekansiyel duruşun ne olduğu ve planlayıcıda nasıl çalıştığı. */
function StopInfo() {
  return (
    <>
      <p>
        <b>Frequency stop</b> = a stop that repeats during a job at a fixed interval — for example a <i>coil setup</i> on a
        press line or a <i>fixture setup</i>. Choose the stop this work center has; leave it <i>— none —</i> where there is
        no such stop (robot lines, cataphoresis, transfer presses running blanks).
      </p>
      <p>The names are this plant's own list: add one with “+ New frequency stop…” or on Company settings → Selection lists.</p>
      <p>How the planner uses it:</p>
      <ul className="ml-4 list-disc space-y-0.5">
        <li>
          On a press the interval is every coil (coil weight ÷ gross weight, Master Data). The first one is part of the setup; each
          one after it stops the press. A cycle line keeps “Stop every N pieces” per part for its own plan.
        </li>
        <li>Its length is the part's <i>Frequency stop time</i> in Master Data.</li>
        <li>
          In one hall, frequency stops keep the <i>Min. gap between coil changes</i> and never run together with a die setup.
        </li>
      </ul>
      <p>With — none — the work center never stops for it, whatever the part data says.</p>
    </>
  )
}

/** Frekansiyel duruş adları ve "yeni" — sayfanın her yerindeki seçiciler için. */
const StopsContext = createContext<{ stops: string[]; onNew: () => Promise<string | null> }>({ stops: [], onNew: async () => null })

/** Frekansiyel duruş seçici: — none —, plant'in listesi, en altta "+ New frequency stop…". */
function StopSelect({
  value,
  onChange,
  className = '',
}: {
  value: { feedsCoil: boolean; frequencyStop: string }
  onChange: (patch: { feedsCoil: boolean; frequencyStop: string }) => void
  className?: string
}) {
  const { stops, onNew } = useContext(StopsContext)
  const current = stopValue(value)
  const options = value.frequencyStop && !stops.includes(value.frequencyStop) ? [...stops, value.frequencyStop] : stops
  return (
    <select
      className={`${input} ${current === UNNAMED_STOP ? 'border-amber-500' : ''} ${className}`}
      value={current}
      title={current === UNNAMED_STOP ? 'This work center has a frequency stop without a name — choose which one it is' : undefined}
      onChange={(e) => {
        if (e.target.value === NEW) void onNew().then((n) => n && onChange(stopPatch(n)))
        else onChange(stopPatch(e.target.value))
      }}
    >
      <option value="">— none —</option>
      {current === UNNAMED_STOP && <option value={UNNAMED_STOP}>Yes — choose its name</option>}
      {options.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
      <option value={NEW}>+ New frequency stop…</option>
    </select>
  )
}

function MakinelerPage() {
  const { ctx } = usePlant()
  const presses = (useQuery(api.presses.list) ?? []) as WcPress[]
  const categoryList = (useQuery(api.presses.categories) ?? []) as {
    name: string
    listed: boolean
  }[]
  const costCenters = (ctx?.active?.costCenters ?? []) as WcCostCenter[]
  const departments = ctx?.active?.departments ?? []
  const plantName = ctx?.active?.plantName ?? 'Plant'
  // OEE verisinde work center'ın geldiği masraf yeri: tanımı teyit etmek için.
  const seen = (useQuery(api.presses.costCentersSeen) ?? []) as {
    workCenter: string
    costCenter: string
  }[]
  const seenBy = useMemo(() => new Map(seen.map((s) => [s.workCenter, s.costCenter])), [seen])
  const { results: products } = usePaginatedQuery(api.products.list, {}, { initialNumItems: 500 })

  const { run: upsert, error: upsertError, clearError } = useSafeMutation(api.presses.upsert)
  const { run: remove, error: removeError } = useSafeMutation(api.presses.remove)
  const { run: rename, error: renameError } = useSafeMutation(api.presses.rename)
  const { run: addCategory, error: addCatError } = useSafeMutation(api.presses.addCategory)
  const { run: addStop, error: addStopError } = useSafeMutation(api.presses.addFrequencyStop)
  const stops = (useQuery(api.presses.frequencyStops) ?? []) as string[]
  const { run: renameCategory, error: renameCatError } = useSafeMutation(api.presses.renameCategory)
  const { run: removeCategory, error: removeCatError } = useSafeMutation(api.presses.removeCategory)

  const [view, setView] = useState<WcView>('org')
  const [node, setNode] = useState<WcNode>({ kind: 'plant' })
  const [prefillName, setPrefillName] = useState<string | null>(null)
  const detailRef = useRef<HTMLDivElement>(null)

  const select = (n: WcNode) => {
    setNode(n)
    // Telefonda panel ağacın altında: seçince oraya kaydır.
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      requestAnimationFrame(() =>
        detailRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        }),
      )
    }
  }

  const categories = categoryList.map((c) => c.name)
  const halls = useMemo(() => hallGroups(presses).halls.map((h) => h.name), [presses])
  const rows = useDraftRows(presses, (p) => p._id, draftOf, sameDraft)
  const savePress = (id: string) => async (draft: ReturnType<typeof draftOf>) => {
    const press = presses.find((p) => p._id === id)
    if (!press) return false
    // Kayıt her zaman eksiksiz gönderilir: sunucu gelmeyen alanı silinmiş sayar.
    return upsert(pressPayload(press.name, draft))
  }

  // Master data'daki ana / alternatif makinelerde geçen ama tanımlı olmayanlar.
  const undefinedPresses = useMemo(() => {
    const names = new Set(presses.map((p) => p.name))
    const set = new Set<string>()
    for (const p of products) {
      for (const m of [p.mainMachine, p.altMachine1, p.altMachine2, p.altMachine3, p.altMachine4]) {
        if (m && m.trim() && !names.has(m.trim())) set.add(m.trim())
      }
    }
    return [...set].sort()
  }, [products, presses])

  const known = new Set(costCenters.map((c) => c.code))
  const unlinked = presses.filter((p) => !p.costCenter || !known.has(p.costCenter))
  const differs = presses.filter((p) => p.costCenter && seenBy.has(p.name) && seenBy.get(p.name) !== p.costCenter)
  // Frekansiyel duruşu açık ama adı seçilmemiş (eski "Coil fed" kayıtları).
  const unnamedStops = presses.filter((p) => p.feedsCoil !== false && !p.frequencyStop)

  // Yeni kategori: sayfada oluşturulur, seçim listesine girer.
  // Yeni frekansiyel duruş: sayfada oluşturulur, seçim listesine girer.
  const newStop = async (): Promise<string | null> => {
    const name = window.prompt('New frequency stop (e.g. Coil setup, Fixture setup)')?.trim()
    if (!name) return null
    const existing = stops.find((c) => c.toLowerCase() === name.toLowerCase())
    if (existing) return existing
    return (await addStop({ name })) ? name : null
  }

  const newCategory = async (): Promise<string | null> => {
    const name = window.prompt('New category (line) name')?.trim()
    if (!name) return null
    const existing = categories.find((c) => c.toLowerCase() === name.toLowerCase())
    if (existing) return existing
    return (await addCategory({ name })) ? name : null
  }

  return (
    <StopsContext.Provider value={{ stops, onNew: newStop }}>
    <div className="w-full px-4 py-6 pb-24 sm:px-6 sm:py-8">
      <PageHeader
        title="Work Center Definitions"
        summary="Cost center, category, hall and frequency stop of every work center — the single work center list of the program."
        links={relatedPages('/makineler')}
        info={
          <>
            <p>
              <b>Cost center:</b> every work center belongs to one cost center of the plant (Plant → Department → Cost center → Work
              center). The cost centers are defined on Company settings; when the OEE data shows a work center under another cost center,
              the row says so.
            </p>
            <p>
              <b>Category</b> groups work centers into lines: the Gantt groups by it and the Capacity Dashboard adds up work centers with
              the same category. The categories are this plant's own list — create, rename and delete them here (Categories view). A
              category does not decide where a part runs — that comes from the main and alternative machines in master data.
            </p>
            <p>
              <b>Hall</b> (optional) is the setup crane: work centers in one hall never set up at the same time. See the i next to Hall.
            </p>
            <p>
              <b>Frequency stop</b> is a stop that repeats during a job — a coil setup on a press line, a fixture setup … Choose it per
              work center from the plant's own list; — none — for lines without one (robot lines, cataphoresis). See the i next to
              Frequency stop.
            </p>
            <p>
              <b>Frozen days</b> locks that work center's plan for the given number of days; empty uses the global setting.
            </p>
            <p>
              Only work centers defined here appear on the Work Calendar, the Capacity Dashboard and the overtime lists. Each work center
              also needs a Work Calendar pattern, otherwise it has no capacity.
            </p>
          </>
        }
      />

      <div className="mt-3">
        <LevelLegend from="plant" />
      </div>

      <ErrorBanner
        message={upsertError ?? removeError ?? renameError ?? addCatError ?? addStopError ?? renameCatError ?? removeCatError}
        onDismiss={clearError}
      />

      {costCenters.length === 0 ? (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50/70 p-3 text-sm text-amber-950">
          This plant has no cost center yet. Every work center belongs to a cost center — add the departments and cost centers on{' '}
          <Link to="/settings" className="underline">
            Company settings
          </Link>{' '}
          first.
        </div>
      ) : (
        (unlinked.length > 0 || differs.length > 0 || unnamedStops.length > 0 || undefinedPresses.length > 0) && (
          <div className="mt-4 space-y-1.5 rounded-lg border border-amber-300 bg-amber-50/70 p-3 text-xs text-amber-950">
            <p className="font-medium">
              {[unlinked.length > 0, differs.length > 0, unnamedStops.length > 0, undefinedPresses.length > 0].filter(Boolean).length} thing(s) to finish
            </p>
            {unlinked.length > 0 && (
              <p>
                <button
                  className="text-left underline decoration-amber-400 underline-offset-2 hover:decoration-amber-700"
                  onClick={() => {
                    setView('org')
                    select({ kind: 'unlinked' })
                  }}
                >
                  {unlinked.length} work center
                  {unlinked.length === 1 ? '' : 's'} without a cost center: {unlinked.map((p) => p.name).join(', ')}
                </button>
              </p>
            )}
            {unnamedStops.length > 0 && (
              <p>
                {unnamedStops.length} work center{unnamedStops.length === 1 ? ' has' : 's have'} a frequency stop without a name
                (formerly “Coil fed”): {unnamedStops.map((p) => p.name).join(', ')} — choose Coil setup, Fixture setup … or — none — in
                the Frequency stop column.
              </p>
            )}
            {differs.length > 0 && (
              <p>
                {differs.length} differ from the OEE data:{' '}
                {differs.map((p) => `${p.name} (here ${p.costCenter}, OEE ${seenBy.get(p.name)})`).join(', ')}
              </p>
            )}
            {undefinedPresses.length > 0 && (
              <div>
                <p>Used in master data but not defined yet — click to add:</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {undefinedPresses.map((p) => (
                    <button
                      key={p}
                      onClick={() => {
                        setPrefillName(p)
                        select({ kind: 'plant' })
                      }}
                      className="flex items-center gap-1 rounded border border-amber-300 bg-white px-1.5 py-0.5 hover:bg-amber-100"
                    >
                      <LevelChip level="workCenter" className="h-4 min-w-4 text-[8px]" />+ {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      )}

      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(300px,380px)_1fr]">
        <aside className="min-w-0 rounded-lg border border-border bg-card p-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Structure</h2>
            <div className="flex rounded-md border border-border p-0.5 text-xs" role="tablist" aria-label="View">
              {(
                [
                  ['org', 'Cost centers'],
                  ['category', 'Categories'],
                  ['hall', 'Halls'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={view === key}
                  onClick={() => {
                    setView(key)
                    select({ kind: 'plant' })
                  }}
                  className={`rounded px-2 py-1 ${view === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <WcTree
            view={view}
            plantName={plantName}
            presses={presses}
            costCenters={costCenters}
            departments={departments}
            categories={categories}
            selected={node}
            onSelect={select}
            onNewCategory={() => void newCategory().then((n) => n && select({ kind: 'category', name: n }))}
          />
        </aside>

        <main ref={detailRef} className="min-w-0 scroll-mt-4">
          <Detail
            node={node}
            plantName={plantName}
            presses={presses}
            costCenters={costCenters}
            categories={categories}
            categoryListed={(name) => categoryList.some((c) => c.name === name && c.listed)}
            halls={halls}
            seenBy={seenBy}
            rows={rows}
            savePress={savePress}
            onSelect={select}
            onNewCategory={newCategory}
            upsert={upsert}
            prefillName={prefillName}
            onPrefillUsed={() => setPrefillName(null)}
            onRenameCode={(p) => {
              const to = window.prompt(
                `New code for ${p.name}. Every linked record changes with it; uploaded OEE data and plan archives keep the old code.`,
                p.name,
              )
              if (to !== null && to.trim() && to.trim() !== p.name) {
                void rename({ id: p._id as never, to: to.trim() }).then(
                  (ok) => ok && node.kind === 'workCenter' && select({ kind: 'workCenter', name: to.trim() }),
                )
              }
            }}
            onDelete={(p) => {
              if (
                window.confirm(
                  `Delete work center ${p.name}? This cannot be undone. A work center still used in master data, the calendar or records cannot be deleted.`,
                )
              ) {
                void remove({ id: p._id as never }).then((ok) => ok && node.kind === 'workCenter' && select({ kind: 'plant' }))
              }
            }}
            onRenameCategory={async (from, to) => {
              const merge = categories.some((c) => c !== from && c.toLowerCase() === to.toLowerCase())
              if (merge && !window.confirm(`${to} already exists — move the work centers of ${from} into ${to}?`)) return false
              const ok = await renameCategory({ from, to })
              if (ok)
                select({
                  kind: 'category',
                  name: categories.find((c) => c.toLowerCase() === to.toLowerCase() && c !== from) ?? to,
                })
              return ok
            }}
            onRemoveCategory={(name) => {
              if (window.confirm(`Delete the category ${name}? Work centers are not deleted.`)) {
                void removeCategory({ name }).then((ok) => ok && select({ kind: 'plant' }))
              }
            }}
          />
        </main>
      </div>

      <UnsavedBar
        count={rows.dirtyKeys.length}
        saving={rows.savingKey !== null}
        noun="work center"
        onSaveAll={() => void rows.commitAll((id, draft) => savePress(id)(draft))}
        onDiscard={rows.discardAll}
      />
    </div>
    </StopsContext.Provider>
  )
}

// ---- Ağaç -------------------------------------------------------------------

function WcTree({
  view,
  plantName,
  presses,
  costCenters,
  departments,
  categories,
  selected,
  onSelect,
  onNewCategory,
}: {
  view: WcView
  plantName: string
  presses: WcPress[]
  costCenters: WcCostCenter[]
  departments: string[]
  categories: string[]
  selected: WcNode
  onSelect: (n: WcNode) => void
  onNewCategory: () => void
}) {
  const [closed, setClosed] = useState<Set<string>>(() => new Set())
  const open = (key: string) => !closed.has(key)
  const toggle = (key: string) =>
    setClosed((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  const is = (n: WcNode) => sameWcNode(selected, n)
  const leaves = (list: WcPress[], meta: (p: WcPress) => string | undefined) =>
    list.map((p) => (
      <TreeRow
        key={p._id}
        level="workCenter"
        label={p.name}
        meta={meta(p)}
        selected={is({ kind: 'workCenter', name: p.name })}
        onSelect={() => onSelect({ kind: 'workCenter', name: p.name })}
        open={false}
      />
    ))
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

  let top: ReactNode = null
  let rows: ReactNode
  let bottom: ReactNode = null
  if (view === 'org') {
    const g = orgGroups(presses, costCenters, departments)
    rows = (
      <>
        {g.departments.map((d) => {
          const key = `d:${d.name}`
          const count = d.costCenters.reduce((s, c) => s + c.presses.length, 0)
          return (
            <TreeRow
              key={key}
              level="department"
              label={d.name || 'Without a department'}
              dashed={!d.name}
              meta={`${d.costCenters.length} CC · ${count} WC`}
              selected={!!d.name && is({ kind: 'department', name: d.name })}
              onSelect={() => d.name && onSelect({ kind: 'department', name: d.name })}
              open={open(key)}
              onToggle={d.costCenters.length ? () => toggle(key) : undefined}
            >
              {d.costCenters.map((c) => {
                const ckey = `c:${c.code}`
                return (
                  <TreeRow
                    key={ckey}
                    level="costCenter"
                    label={c.name && c.name !== c.code ? `${c.code} · ${c.name}` : c.code}
                    meta={`${c.presses.length} WC`}
                    warn={c.presses.length === 0}
                    selected={is({ kind: 'costCenter', code: c.code })}
                    onSelect={() => onSelect({ kind: 'costCenter', code: c.code })}
                    open={open(ckey)}
                    onToggle={c.presses.length ? () => toggle(ckey) : undefined}
                  >
                    {leaves(c.presses, (p) => p.category)}
                  </TreeRow>
                )
              })}
            </TreeRow>
          )
        })}
      </>
    )
    bottom = g.unlinked.length > 0 && (
      <div className="mt-3 rounded-md border border-dashed border-amber-400 bg-amber-50/60 p-2">
        <button
          className="mb-1 text-left text-xs font-medium text-amber-900 underline-offset-2 hover:underline"
          onClick={() => onSelect({ kind: 'unlinked' })}
        >
          Without a cost center — choose one for each
        </button>
        {leaves(g.unlinked, (p) => p.costCenter && `${p.costCenter}?`)}
      </div>
    )
  } else if (view === 'category') {
    const g = categoryGroups(presses, categories)
    top = (
      <>
        <button
          onClick={onNewCategory}
          className="mb-2 w-full rounded-md border border-dashed border-border px-2 py-1.5 text-left text-xs text-muted-foreground hover:border-primary hover:text-foreground"
        >
          + New category
        </button>
        {g.categories.length === 0 && (
          <p className="px-1 py-2 text-xs text-muted-foreground">No category yet — create the lines of this plant.</p>
        )}
      </>
    )
    rows = (
      <>
        {g.categories.map((c) => {
          const key = `k:${c.name}`
          return (
            <TreeRow
              key={key}
              level="workCenter"
              chip={<Chip kind="category" />}
              label={c.name}
              meta={`${c.presses.length} WC`}
              selected={is({ kind: 'category', name: c.name })}
              onSelect={() => onSelect({ kind: 'category', name: c.name })}
              open={open(key)}
              onToggle={c.presses.length ? () => toggle(key) : undefined}
            >
              {leaves(c.presses, (p) => p.costCenter)}
            </TreeRow>
          )
        })}
      </>
    )
    bottom = g.none.length > 0 && (
      <div className="mt-3 rounded-md border border-dashed border-border p-2">
        <button
          className="mb-1 text-left text-xs font-medium text-muted-foreground hover:underline"
          onClick={() => onSelect({ kind: 'noCategory' })}
        >
          No category · {plural(g.none.length, 'work center')}
        </button>
        {leaves(g.none, (p) => p.costCenter)}
      </div>
    )
  } else {
    const g = hallGroups(presses)
    top = (
      <p className="mb-2 flex items-start gap-1 px-1 text-xs text-muted-foreground">
        <span>Work centers in one hall share the setup crane.</span>
        <InfoTip label="What a hall does">
          <HallInfo />
        </InfoTip>
      </p>
    )
    rows = (
      <>
        {g.halls.map((h) => {
          const key = `h:${h.name}`
          return (
            <TreeRow
              key={key}
              level="workCenter"
              chip={<Chip kind="hall" />}
              label={h.name}
              meta={`${h.presses.length} WC · one crane`}
              selected={is({ kind: 'hall', name: h.name })}
              onSelect={() => onSelect({ kind: 'hall', name: h.name })}
              open={open(key)}
              onToggle={() => toggle(key)}
            >
              {leaves(h.presses, (p) => p.category)}
            </TreeRow>
          )
        })}
      </>
    )
    bottom = g.none.length > 0 && (
      <div className="mt-3 rounded-md border border-dashed border-border p-2">
        <button
          className="mb-1 text-left text-xs font-medium text-muted-foreground hover:underline"
          onClick={() => onSelect({ kind: 'noHall' })}
        >
          No hall — each sets up on its own · {g.none.length}
        </button>
        {leaves(g.none, (p) => p.category)}
      </div>
    )
  }

  return (
    <>
      {top}
      <TreeRow
        level="plant"
        label={plantName}
        meta={plural(presses.length, 'work center')}
        selected={is({ kind: 'plant' })}
        onSelect={() => onSelect({ kind: 'plant' })}
        open
      >
        {rows}
      </TreeRow>
      {bottom}
    </>
  )
}

// ---- Sağ panel --------------------------------------------------------------

type Rows = ReturnType<typeof useDraftRows<WcPress, ReturnType<typeof draftOf>>>

function nodeTitle(node: WcNode, plantName: string, costCenters: WcCostCenter[]): { chip: ReactNode; title: string; sub: string } {
  const lv = (l: Level) => <LevelChip level={l} className="h-6 min-w-6 text-xs" />
  switch (node.kind) {
    case 'plant':
      return {
        chip: lv('plant'),
        title: plantName,
        sub: 'All work centers of the plant',
      }
    case 'department':
      return {
        chip: lv('department'),
        title: node.name,
        sub: 'Department — its cost centers and work centers',
      }
    case 'costCenter': {
      const c = costCenters.find((x) => x.code === node.code)
      return {
        chip: lv('costCenter'),
        title: c && c.name !== c.code ? `${c.code} · ${c.name}` : node.code,
        sub: `Cost center${c?.department ? ` of ${c.department}` : ''}`,
      }
    }
    case 'unlinked':
      return {
        chip: lv('workCenter'),
        title: 'Without a cost center',
        sub: 'Choose a cost center on each row and Save',
      }
    case 'category':
      return {
        chip: <Chip kind="category" />,
        title: node.name,
        sub: 'Category (line) — the Gantt groups and the Capacity Dashboard adds up its work centers',
      }
    case 'noCategory':
      return {
        chip: <Chip kind="category" />,
        title: 'No category',
        sub: 'Each of these is its own line in the Gantt and the Capacity Dashboard',
      }
    case 'hall':
      return {
        chip: <Chip kind="hall" />,
        title: node.name,
        sub: 'Hall — these work centers share one setup crane',
      }
    case 'noHall':
      return {
        chip: <Chip kind="hall" />,
        title: 'No hall',
        sub: 'Each sets up on its own; only the plant-wide setup limit applies',
      }
    case 'workCenter':
      return { chip: lv('workCenter'), title: node.name, sub: 'Work center' }
  }
}

function Detail({
  node,
  plantName,
  presses,
  costCenters,
  categories,
  categoryListed,
  halls,
  seenBy,
  rows,
  savePress,
  onSelect,
  onNewCategory,
  upsert,
  prefillName,
  onPrefillUsed,
  onRenameCode,
  onDelete,
  onRenameCategory,
  onRemoveCategory,
}: {
  node: WcNode
  plantName: string
  presses: WcPress[]
  costCenters: WcCostCenter[]
  categories: string[]
  categoryListed: (name: string) => boolean
  halls: string[]
  seenBy: Map<string, string>
  rows: Rows
  savePress: (id: string) => (draft: ReturnType<typeof draftOf>) => Promise<boolean>
  onSelect: (n: WcNode) => void
  onNewCategory: () => Promise<string | null>
  upsert: (args: {
    name: string
    hall: string
    category?: string
    feedsCoil?: boolean
    frequencyStop?: string
    rateModel?: RateModel
    costCenter?: string
  }) => Promise<boolean>
  prefillName: string | null
  onPrefillUsed: () => void
  onRenameCode: (p: WcPress) => void
  onDelete: (p: WcPress) => void
  onRenameCategory: (from: string, to: string) => Promise<boolean>
  onRemoveCategory: (name: string) => void
}) {
  const list = pressesIn(node, presses, costCenters)
  const head = nodeTitle(node, plantName, costCenters)
  const single = node.kind === 'workCenter' ? list[0] : undefined
  const count = (f: (p: WcPress) => string | undefined) => new Set(list.map(f).filter(Boolean)).size
  const stats: { label: string; value: number; chip?: ReactNode }[] = [
    {
      label: 'Work centers',
      value: list.length,
      chip: <LevelChip level="workCenter" />,
    },
    {
      label: 'Cost centers',
      value: count((p) => p.costCenter),
      chip: <LevelChip level="costCenter" />,
    },
    {
      label: 'Categories',
      value: count((p) => p.category?.trim()),
      chip: <Chip kind="category" />,
    },
    {
      label: 'Halls',
      value: count((p) => p.hall.trim()),
      chip: <Chip kind="hall" />,
    },
    {
      label: 'Cycle lines',
      value: list.filter((p) => p.rateModel === 'cycle').length,
    },
  ]

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        {head.chip}
        {node.kind === 'category' ? (
          <CategoryName key={node.name} value={node.name} onSave={(to) => onRenameCategory(node.name, to)} />
        ) : (
          <h2 className="truncate text-lg font-semibold text-foreground">{head.title}</h2>
        )}
        <span className="ml-auto flex items-center gap-3 text-xs">
          {single && (
            <>
              <button
                className="underline"
                onClick={() => onRenameCode(single)}
                title="Change the code everywhere it is used (master data, calendar, overtime, maintenance, breakdowns, plan pins)"
              >
                Change code
              </button>
              <button className="text-destructive hover:underline" onClick={() => onDelete(single)}>
                Delete
              </button>
            </>
          )}
          {node.kind === 'category' && (
            <button
              className="text-destructive hover:underline disabled:opacity-40 disabled:no-underline"
              disabled={list.length > 0}
              title={list.length > 0 ? 'Move its work centers to another category first' : 'Delete the category'}
              onClick={() => onRemoveCategory(node.name)}
            >
              Delete category
            </button>
          )}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {head.sub}
        {node.kind === 'category' && !categoryListed(node.name) && ' · in use, saved to the list with the next change'}
      </p>

      {(node.kind === 'hall' || node.kind === 'noHall') && (
        <div className="mt-3 space-y-1.5 rounded-md border border-teal-200 bg-teal-50/60 p-3 text-xs text-teal-950 [&_b]:font-semibold">
          <HallInfo />
        </div>
      )}

      {!single && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {stats.map((s) => (
            <div key={s.label} className="rounded-md border border-border bg-background px-3 py-2">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {s.chip}
                {s.label}
              </div>
              <div className="mt-0.5 text-lg font-semibold text-foreground tabular-nums">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      <h3 className="mt-5 text-sm font-semibold text-foreground">{single ? 'Definition' : 'Work centers'}</h3>
      <p className="text-xs text-muted-foreground">Edits are saved with Save on the row, or Save all at the bottom.</p>
      {list.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
          No work center here yet.
        </p>
      ) : (
        <WcTable
          list={list}
          costCenters={costCenters}
          categories={categories}
          halls={halls}
          seenBy={seenBy}
          rows={rows}
          savePress={savePress}
          onSelect={onSelect}
          onNewCategory={onNewCategory}
          showActions={!single}
          onRenameCode={onRenameCode}
          onDelete={onDelete}
        />
      )}

      {!single && (
        <AddWorkCenter
          key={JSON.stringify(node) + (prefillName ?? '')}
          node={node}
          costCenters={costCenters}
          categories={categories}
          halls={halls}
          upsert={upsert}
          onNewCategory={onNewCategory}
          prefillName={prefillName}
          onPrefillUsed={onPrefillUsed}
          onAdded={(name) => onSelect({ kind: 'workCenter', name })}
        />
      )}
    </div>
  )
}

function CategoryName({ value, onSave }: { value: string; onSave: (to: string) => Promise<boolean> }) {
  const [v, setV] = useState(value)
  return (
    <span className="flex max-w-full items-center gap-1.5">
      <input
        className={`w-56 min-w-0 font-semibold ${input}`}
        value={v}
        onChange={(e) => setV(e.target.value)}
        aria-label="Category name"
      />
      <button
        className={btn}
        disabled={!v.trim() || v.trim() === value}
        onClick={() => void onSave(v.trim())}
        title="Renames the category on every work center in it"
      >
        Rename
      </button>
    </span>
  )
}

/** Masraf yeri seçici: fabrikanın masraf yerleri, bölümlerine göre gruplu. */
function CostCenterSelect({
  value,
  costCenters,
  onChange,
  className = '',
}: {
  value: string
  costCenters: WcCostCenter[]
  onChange: (code: string) => void
  className?: string
}) {
  const known = costCenters.some((c) => c.code === value)
  const groups = new Map<string, WcCostCenter[]>()
  for (const c of costCenters) {
    const d = c.department || 'Without a department'
    if (!groups.has(d)) groups.set(d, [])
    groups.get(d)!.push(c)
  }
  return (
    <select
      className={`${input} ${known ? '' : 'border-amber-500'} ${className}`}
      value={known ? value : ''}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{value && !known ? `${value} — not a cost center of this plant` : '— choose —'}</option>
      {[...groups].map(([d, list]) => (
        <optgroup key={d} label={d}>
          {list.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

const NEW = '\u0000new'

/** Kategori seçici: plant'in listesi; en altta "+ New category…" (bu sayfada oluşturulur). */
function CategorySelect({
  value,
  categories,
  onChange,
  onNew,
  className = '',
}: {
  value: string
  categories: string[]
  onChange: (v: string) => void
  onNew: () => Promise<string | null>
  className?: string
}) {
  const options = value && !categories.includes(value) ? [...categories, value] : categories
  return (
    <select
      className={`${input} ${className}`}
      value={value}
      onChange={(e) => {
        if (e.target.value === NEW) void onNew().then((n) => n && onChange(n))
        else onChange(e.target.value)
      }}
    >
      <option value="">— none —</option>
      {options.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
      <option value={NEW}>+ New category…</option>
    </select>
  )
}

/** Hol kutusu: serbest metin; öneriler plant'in kullandığı hollerden. */
function HallInput({
  value,
  halls,
  onChange,
  className = '',
}: {
  value: string
  halls: string[]
  onChange: (v: string) => void
  className?: string
}) {
  return (
    <>
      <input
        className={`${input} ${className}`}
        list="wc-halls"
        placeholder="— none —"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id="wc-halls">
        {halls.map((h) => (
          <option key={h} value={h} />
        ))}
      </datalist>
    </>
  )
}

function WcTable({
  list,
  costCenters,
  categories,
  halls,
  seenBy,
  rows,
  savePress,
  onSelect,
  onNewCategory,
  showActions,
  onRenameCode,
  onDelete,
}: {
  list: WcPress[]
  costCenters: WcCostCenter[]
  categories: string[]
  halls: string[]
  seenBy: Map<string, string>
  rows: Rows
  savePress: (id: string) => (draft: ReturnType<typeof draftOf>) => Promise<boolean>
  onSelect: (n: WcNode) => void
  onNewCategory: () => Promise<string | null>
  showActions: boolean
  onRenameCode: (p: WcPress) => void
  onDelete: (p: WcPress) => void
}) {
  const ccName = (code: string) => costCenters.find((c) => c.code === code)?.name
  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Work center</th>
            <th className="px-3 py-2 font-medium">Cost center</th>
            <th className="px-3 py-2 font-medium">Category</th>
            <th className="px-3 py-2 font-medium">
              <span className="inline-flex items-center gap-1">
                Hall
                <InfoTip label="What a hall does">
                  <HallInfo />
                </InfoTip>
              </span>
            </th>
            <th className="px-3 py-2 font-medium">
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                Model
                <InfoTip label="Production model">
                  <ModelInfo />
                </InfoTip>
              </span>
            </th>
            <th className="px-3 py-2 font-medium">
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                Frequency stop
                <InfoTip label="What a frequency stop is">
                  <StopInfo />
                </InfoTip>
              </span>
            </th>
            <th className="px-3 py-2 font-medium" title="Days of this work center's plan that stay locked; empty uses the global setting">
              Frozen days
            </th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {list.map((p) => {
            const draft = rows.draftFor(p)
            const dirty = rows.isDirty(p)
            const busy = rows.savingKey === p._id
            const saveThisRow = () => {
              if (dirty && !busy) void rows.commit(p._id, savePress(p._id))
            }
            const oee = seenBy.get(p.name)
            return (
              <tr
                key={p._id}
                className={`border-t border-border align-top ${dirty ? 'bg-amber-50' : ''}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') saveThisRow()
                }}
              >
                <td className="px-3 py-2">
                  <button
                    className="flex items-center gap-1.5 font-medium whitespace-nowrap text-foreground hover:underline"
                    onClick={() => onSelect({ kind: 'workCenter', name: p.name })}
                  >
                    <LevelChip level="workCenter" />
                    {p.name}
                  </button>
                </td>
                <td className="px-3 py-2">
                  <CostCenterSelect
                    className="w-60"
                    value={draft.costCenter}
                    costCenters={costCenters}
                    onChange={(code) => rows.edit(p._id, { costCenter: code })}
                  />
                  {oee && oee !== draft.costCenter && (
                    <button
                      className="mt-1 block text-[11px] text-amber-800 underline"
                      title="The cost center this work center has in the latest OEE upload"
                      onClick={() => rows.edit(p._id, { costCenter: oee })}
                    >
                      OEE data: {oee}
                      {ccName(oee) ? ` — ${ccName(oee)}` : ''} · use
                    </button>
                  )}
                </td>
                <td className="px-3 py-2">
                  <CategorySelect
                    className="w-44"
                    value={draft.category}
                    categories={categories}
                    onChange={(v) => rows.edit(p._id, { category: v })}
                    onNew={onNewCategory}
                  />
                </td>
                <td className="px-3 py-2">
                  <HallInput className="w-28" value={draft.hall} halls={halls} onChange={(v) => rows.edit(p._id, { hall: v })} />
                </td>
                <td className="px-3 py-2">
                  <ModelSelect className="w-44" value={draft.rateModel} onChange={(v) => rows.edit(p._id, { rateModel: v })} />
                </td>
                <td className="px-3 py-2">
                  <StopSelect className="w-40" value={draft} onChange={(patch) => rows.edit(p._id, patch)} />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={0}
                    className={`w-20 ${input}`}
                    placeholder="—"
                    value={draft.frozenDays}
                    onChange={(e) => rows.edit(p._id, { frozenDays: e.target.value })}
                  />
                </td>
                <td className="px-3 py-2 pt-3 whitespace-nowrap">
                  <SaveStatus dirty={dirty} saving={busy} justSaved={!!rows.justSaved[p._id]} />
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button onClick={saveThisRow} disabled={!dirty || busy} className={btn}>
                    Save
                  </button>
                  {showActions && (
                    <>
                      <button
                        className="ml-3 text-xs underline disabled:opacity-40"
                        disabled={dirty}
                        onClick={() => onRenameCode(p)}
                        title="Change the code everywhere it is used"
                      >
                        Change code
                      </button>
                      <button className="ml-3 text-xs text-destructive hover:underline" onClick={() => onDelete(p)}>
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Yeni work center: seçili düğümün masraf yeri / kategori / holü hazır gelir. */
function AddWorkCenter({
  node,
  costCenters,
  categories,
  halls,
  upsert,
  onNewCategory,
  prefillName,
  onPrefillUsed,
  onAdded,
}: {
  node: WcNode
  costCenters: WcCostCenter[]
  categories: string[]
  halls: string[]
  upsert: (args: {
    name: string
    hall: string
    category?: string
    feedsCoil?: boolean
    frequencyStop?: string
    rateModel?: RateModel
    costCenter?: string
  }) => Promise<boolean>
  onNewCategory: () => Promise<string | null>
  prefillName: string | null
  onPrefillUsed: () => void
  onAdded: (name: string) => void
}) {
  const [name, setName] = useState(prefillName ?? '')
  const [costCenter, setCostCenter] = useState(node.kind === 'costCenter' ? node.code : '')
  const [category, setCategory] = useState(node.kind === 'category' ? node.name : '')
  const [hall, setHall] = useState(node.kind === 'hall' ? node.name : '')
  const [stop, setStop] = useState({ feedsCoil: false, frequencyStop: '' })
  const [rateModel, setRateModel] = useState<RateModel>('stroke')
  const [saving, setSaving] = useState(false)
  const add = async () => {
    const n = name.trim()
    if (!n || !costCenter) return
    setSaving(true)
    try {
      const ok = await upsert({
        name: n,
        hall: hall.trim(),
        category: category || undefined,
        feedsCoil: stop.feedsCoil,
        frequencyStop: stop.frequencyStop || undefined,
        rateModel,
        costCenter,
      })
      if (ok) {
        onPrefillUsed()
        onAdded(n)
      }
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className={`mt-5 rounded-lg border p-3 ${prefillName ? 'border-primary ring-2 ring-primary/30' : 'border-border'}`}>
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <LevelChip level="workCenter" /> Add a work center
      </h3>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted-foreground">
          Code
          <input
            autoFocus={!!prefillName}
            className={`mt-1 block w-36 ${input}`}
            placeholder="PRS-107"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Cost center
          <CostCenterSelect className="mt-1 block w-52" value={costCenter} costCenters={costCenters} onChange={setCostCenter} />
        </label>
        <label className="text-xs text-muted-foreground">
          Category
          <CategorySelect
            className="mt-1 block w-44"
            value={category}
            categories={categories}
            onChange={setCategory}
            onNew={onNewCategory}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            Hall (optional)
            <InfoTip label="What a hall does">
              <HallInfo />
            </InfoTip>
          </span>
          <HallInput className="mt-1 block w-32" value={hall} halls={halls} onChange={setHall} />
        </label>
        <label className="text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            Model
            <InfoTip label="Production model">
              <ModelInfo />
            </InfoTip>
          </span>
          <ModelSelect className="mt-1 block w-52" value={rateModel} onChange={setRateModel} />
        </label>
        <label className="text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            Frequency stop
            <InfoTip label="What a frequency stop is">
              <StopInfo />
            </InfoTip>
          </span>
          <StopSelect className="mt-1 block w-44" value={stop} onChange={setStop} />
        </label>
        <button onClick={() => void add()} disabled={!name.trim() || !costCenter || saving} className={`${btn} py-2`}>
          {saving ? 'Adding…' : 'Add work center'}
        </button>
      </div>
      {!costCenter && name.trim() && (
        <p className="mt-1.5 text-xs text-amber-800">Choose the cost center — every work center belongs to one.</p>
      )}
    </div>
  )
}
