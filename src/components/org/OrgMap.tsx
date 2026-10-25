import { Background, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ChevronDown, ChevronRight, TriangleAlert } from 'lucide-react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'

import { api } from '../../../convex/_generated/api'
import type { GroupRow, UserRow } from '../CompanyAdmin'
import { ErrorBanner } from '../ErrorBanner'
import { OrgMapEditor } from './OrgMapEditor'
import { LEVEL_INFO } from '../OrgTree'
import { useQuery } from '../../lib/convexTransport'
import {
  NODE_H,
  NODE_W,
  dropAction,
  findNodes,
  peopleGraph,
  removeAction,
  structureGraph,
  warningsOf,
  type MapAction,
  type MapEdge,
  type MapGraph,
  type MapLevel,
  type MapNode,
} from '../../lib/orgMap'
import { editCostCenter, type OrgCompany, type OrgHolding } from '../../lib/orgTree'
import { usePlant } from '../../lib/plantContext'
import { useSafeMutation } from '../../lib/useSafeMutation'

/**
 * Organizasyon haritası: holding'ler, şirketler, plant'ler, bölümler, masraf
 * yerleri, work center'lar — ve bir şirketin grupları ile kullanıcıları —
 * sonsuz bir tuvalde. Kaydırılır, yakınlaştırılır; düğüm sürüklenip başka
 * bir düğüme bırakılınca bağ değişir (kurallar src/lib/orgMap.ts, yetki
 * sunucuda). Seçili düğümde ad değiştirme / ekleme / silme: OrgMapEditor.
 */

interface CompanyRow extends OrgCompany {
  userCount: number
}

type View = 'structure' | 'people'

const COLORS: Record<MapLevel, string> = {
  holding: 'bg-indigo-600',
  company: 'bg-sky-600',
  plant: 'bg-emerald-600',
  department: 'bg-amber-500',
  costCenter: 'bg-slate-500',
  workCenter: 'bg-rose-600',
  group: 'bg-violet-600',
  user: 'bg-teal-600',
}
const LABELS: Record<MapLevel, { label: string; short: string }> = {
  ...LEVEL_INFO,
  group: { label: 'Group', short: 'G' },
  user: { label: 'User', short: 'U' },
}

const btn = 'rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40'
const seg = (on: boolean) => `px-3 py-1 text-xs ${on ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`

/** Düğüm çiziminin ekrandan aldığı durum (data'ya her seferinde koymamak için). */
const MapUi = createContext<{ dropTarget: string | null; selected: string | null; toggle: (id: string) => void }>({
  dropTarget: null,
  selected: null,
  toggle: () => {},
})

function OrgNodeView({ data }: NodeProps<Node<{ node: MapNode; draggable: boolean }>>) {
  const { node: n, draggable } = data
  const ui = useContext(MapUi)
  const warn = n.warnings.length > 0
  const ring =
    ui.dropTarget === n.id
      ? 'ring-4 ring-primary'
      : ui.selected === n.id
        ? 'ring-2 ring-foreground'
        : warn
          ? 'ring-2 ring-destructive'
          : ''
  const virtual = n.ref.kind === 'virtual'
  return (
    <div
      style={{ width: NODE_W, height: NODE_H }}
      title={warn ? n.warnings.join('\n') : undefined}
      className={`flex items-center gap-2 rounded-lg border bg-card px-2 text-left shadow-sm ${virtual ? 'border-dashed border-destructive/60' : 'border-border'} ${ring} ${draggable ? 'cursor-grab' : ''}`}
    >
      <Handle type="target" position={Position.Left} className="!h-1 !w-1 !min-w-0 !border-0 !bg-transparent" isConnectable={false} />
      <span className={`flex h-6 min-w-6 shrink-0 items-center justify-center rounded px-1 text-[10px] font-bold text-white ${COLORS[n.level]}`} title={LABELS[n.level].label}>
        {LABELS[n.level].short}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-xs font-semibold ${virtual ? 'text-destructive' : 'text-foreground'}`}>{n.label}</span>
        {n.sub && <span className="block truncate text-[10px] text-muted-foreground">{n.sub}</span>}
      </span>
      {warn && <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-destructive" aria-label="Has issues" />}
      {n.children > 0 && (
        <button
          className="nodrag flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-muted"
          title={n.collapsed ? `Show ${n.children}` : 'Hide'}
          onClick={(e) => {
            e.stopPropagation()
            ui.toggle(n.id)
          }}
        >
          {n.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      )}
      <Handle type="source" position={Position.Right} className="!h-1 !w-1 !min-w-0 !border-0 !bg-transparent" isConnectable={false} />
    </div>
  )
}

const nodeTypes = { org: OrgNodeView }

const EDGE_STYLE: Record<MapEdge['kind'], Partial<Edge>> = {
  tree: { type: 'smoothstep', style: { stroke: 'var(--color-muted-foreground)', strokeWidth: 1.2, opacity: 0.6 } },
  access: { type: 'default', animated: true, style: { stroke: '#059669', strokeWidth: 1.4, strokeDasharray: '5 4' } },
  member: { type: 'default', style: { stroke: '#0d9488', strokeWidth: 1.2 } },
}

export function OrgMap() {
  return (
    <ReactFlowProvider>
      <OrgMapInner />
    </ReactFlowProvider>
  )
}

// Yüklenirken / 'skip' iken useQuery undefined döner; `?? []` her çizimde yeni dizi üretip
// graph → setNodes → yeniden çizim döngüsüne (React #185) yol açıyordu. Sabit boş dizi kullanılır.
const NONE: never[] = []

function OrgMapInner() {
  const { isPlatform, ctx } = usePlant()
  const flow = useReactFlow()
  const companies = (useQuery(api.platform.companies) ?? NONE) as CompanyRow[]
  const holdings = (useQuery(api.platform.holdings, isPlatform ? {} : 'skip') ?? NONE) as OrgHolding[]
  const [view, setView] = useState<View>('structure')
  const [companyId, setCompanyId] = useState<string | null>(null)
  const company = companies.find((c) => c._id === companyId) ?? companies.find((c) => c._id === ctx?.active?.companyId) ?? companies[0]
  const people = view === 'people' && company
  const users = (useQuery(api.users.list, people ? { companyId: company._id } : 'skip') ?? NONE) as UserRow[]
  const groups = (useQuery(api.users.listGroups, people ? { companyId: company._id } : 'skip') ?? NONE) as (GroupRow & { companyId: string })[]

  // Varsayılan: work center'lar kapalı (masraf yeri satırında sayı). Tıklanan düğüm varsayılanı tersine çevirir.
  const [showWc, setShowWc] = useState(false)
  const [flipped, setFlipped] = useState<Set<string>>(() => new Set())
  const toggle = (id: string) =>
    setFlipped((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const graph: MapGraph = useMemo(() => {
    if (view === 'people') return company ? peopleGraph(company, users, groups) : { nodes: [], edges: [] }
    return structureGraph(holdings, companies, (id, level) => (level === 'costCenter' && !showWc) !== flipped.has(id))
  }, [view, company, users, groups, holdings, companies, showWc, flipped])

  const canDrag = (n: MapNode) =>
    (n.ref.kind === 'company' && isPlatform && view === 'structure') || n.ref.kind === 'costCenter' || n.ref.kind === 'user' || n.ref.kind === 'group'

  const [nodes, setNodes] = useState<Node[]>([])
  useEffect(() => {
    setNodes(graph.nodes.map((n) => ({ id: n.id, type: 'org', position: { x: n.x, y: n.y }, data: { node: n, draggable: canDrag(n) }, draggable: canDrag(n), connectable: false })))
    // canDrag görünüme ve yetkiye bağlı; görünüm değişince graph da değişir.
  }, [graph])
  const edges: Edge[] = useMemo(
    () => graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, selectable: e.kind !== 'tree', ...EDGE_STYLE[e.kind] })),
    [graph],
  )

  // İlk açılışta ve görünüm değişince bütün harita ekrana sığar.
  useEffect(() => {
    const t = setTimeout(() => flow.fitView({ padding: 0.15, duration: 300 }), 50)
    return () => clearTimeout(t)
  }, [view, company?._id, graph.nodes.length > 0, flow])

  const [selected, setSelected] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; action: MapAction } | null>(null)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph])
  const actionCtx = { canLinkHoldings: isPlatform, edges: graph.edges, users, groups }

  const targetFor = (dragged: Node): { id: string; action: MapAction } | null => {
    const d = byId.get(dragged.id)
    if (!d) return null
    for (const other of flow.getIntersectingNodes(dragged)) {
      const t = byId.get(other.id)
      const action = t && dropAction(d, t, actionCtx)
      if (action) return { id: t.id, action }
    }
    return null
  }

  // ---- Sunucu işlemleri (eski sayfaların kullandığı aynı mutation'lar) ----
  const setHolding = useSafeMutation(api.platform.setCompanyHolding)
  const updatePlant = useSafeMutation(api.platform.updatePlant)
  const updateUser = useSafeMutation(api.users.update)
  const saveGroup = useSafeMutation(api.users.saveGroup)
  const addHolding = useSafeMutation(api.platform.saveHolding)
  const error = setHolding.error ?? updatePlant.error ?? updateUser.error ?? saveGroup.error ?? addHolding.error
  const clearError = () => [setHolding, updatePlant, updateUser, saveGroup, addHolding].forEach((m) => m.clearError())

  const newHolding = async () => {
    const name = window.prompt('Name of the new holding')?.trim()
    if (name && (await addHolding.run({ name }))) setNotice(`Done: added holding ${name}`)
  }

  const apply = async (a: MapAction) => {
    if (!window.confirm(`${a.text}?`)) return
    let ok = false
    if (a.kind === 'companyHolding') ok = await setHolding.run({ companyId: a.companyId, holdingId: a.holdingId })
    if (a.kind === 'costCenterDepartment') {
      const plant = companies.flatMap((c) => c.plants).find((p) => p._id === a.plantId)
      if (plant) ok = await updatePlant.run({ id: plant._id, name: plant.name, ...editCostCenter(plant, a.code, { department: a.department }) })
    }
    if (a.kind === 'userGroup') {
      const u = users.find((x) => x._id === a.userId)
      const groupIds = u && (a.add ? [...u.groupIds, a.groupId] : u.groupIds.filter((g) => g !== a.groupId))
      if (u && groupIds) ok = await updateUser.run({ id: u._id, name: u.name, email: u.email, active: u.active, groupIds })
    }
    if (a.kind === 'groupPlant') {
      const g = groups.find((x) => x._id === a.groupId)
      if (g && company) {
        const plantIds = a.add ? [...g.plantIds, a.plantId] : g.plantIds.filter((p) => p !== a.plantId)
        // areas gönderilmez: sunucu grubun alan izinlerini korur.
        ok = await saveGroup.run({ id: g._id, companyId: company._id, name: g.name, allPlants: false, plantIds, permissions: g.permissions, board: g.board === true })
      }
    }
    if (ok) setNotice(`Done: ${a.text}`)
  }

  const resetPositions = () => setNodes((ns) => ns.map((n) => ({ ...n, position: { x: byId.get(n.id)?.x ?? 0, y: byId.get(n.id)?.y ?? 0 } })))

  const focus = (id: string) => {
    const n = byId.get(id)
    if (!n) return
    setSelected(id)
    flow.setCenter(n.x + NODE_W / 2, n.y + NODE_H / 2, { zoom: 1.2, duration: 400 })
  }

  const matches = findNodes(graph.nodes, query)
  const issues = warningsOf(graph)
  const sel = selected ? byId.get(selected) : undefined

  return (
    <MapUi.Provider value={{ dropTarget: dropTarget?.id ?? null, selected, toggle }}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-border" role="tablist">
          <button className={seg(view === 'structure')} onClick={() => setView('structure')}>
            Structure
          </button>
          <button className={seg(view === 'people')} onClick={() => setView('people')}>
            Users & groups
          </button>
        </div>
        {view === 'people' && companies.length > 1 && (
          <select className="rounded-md border border-input bg-background px-2 py-1 text-xs" value={company?._id ?? ''} onChange={(e) => setCompanyId(e.target.value)} aria-label="Company">
            {companies.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        {view === 'structure' && (
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={showWc} onChange={(e) => (setShowWc(e.target.checked), setFlipped(new Set()))} /> Work centers
          </label>
        )}
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            if (matches[0]) focus(matches[0].id)
          }}
        >
          <input
            className="w-44 rounded-md border border-input bg-background px-2 py-1 text-xs"
            placeholder="Find (name or code)…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            list="org-map-find"
          />
          <datalist id="org-map-find">
            {matches.slice(0, 20).map((m) => (
              <option key={m.id} value={m.label} />
            ))}
          </datalist>
          {query && <span className="text-xs text-muted-foreground">{matches.length} found</span>}
        </form>
        <button className={btn} onClick={() => flow.fitView({ padding: 0.15, duration: 300 })}>
          Fit to screen
        </button>
        {view === 'structure' && isPlatform && (
          <button className={btn} disabled={addHolding.pending} onClick={() => void newHolding()}>
            Add holding
          </button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {view === 'structure'
            ? `Drag a ${isPlatform ? 'company onto a holding or a ' : ''}cost center onto a department.`
            : 'Drag a user onto a group, a group onto a plant. Click a line to remove it.'}
        </span>
      </div>

      <ErrorBanner message={error} onDismiss={clearError} />
      {notice && (
        <p className="mt-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" role="status">
          {notice}{' '}
          <button className="underline" onClick={() => setNotice(null)}>
            OK
          </button>
        </p>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_300px]">
        <div className="h-[calc(100vh-15rem)] min-h-[420px] overflow-hidden rounded-lg border border-border bg-background">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={(changes) =>
              setNodes((ns) =>
                ns.map((n) => {
                  const c = changes.find((x) => 'id' in x && x.id === n.id)
                  return c?.type === 'position' && c.position ? { ...n, position: c.position, dragging: c.dragging } : n
                }),
              )
            }
            onNodeClick={(_, n) => setSelected(n.id)}
            onNodeDrag={(_, n) => setDropTarget(targetFor(n))}
            onNodeDragStop={(_, n) => {
              const t = targetFor(n)
              setDropTarget(null)
              resetPositions()
              if (t) void apply(t.action)
            }}
            onEdgeClick={(_, e) => {
              const ge = graph.edges.find((x) => x.id === e.id)
              const a = ge && removeAction(ge, graph.nodes, groups)
              if (a) void apply(a)
            }}
            onPaneClick={() => setSelected(null)}
            nodesConnectable={false}
            minZoom={0.05}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={(n) => ((n.data as { node: MapNode }).node.warnings.length ? '#dc2626' : '#94a3b8')} />
          </ReactFlow>
        </div>

        <aside className="space-y-3 lg:max-h-[calc(100vh-15rem)] lg:overflow-y-auto">
          {sel && (
            <section className="rounded-lg border border-border bg-card p-3">
              <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{LABELS[sel.level].label}</p>
              <h2 className="text-sm font-semibold">{sel.label}</h2>
              {sel.sub && <p className="text-xs text-muted-foreground">{sel.sub}</p>}
              {sel.warnings.length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-destructive">
                  {sel.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              <OrgMapEditor
                node={sel}
                companies={companies}
                isPlatform={isPlatform}
                onDone={(text, removed) => {
                  setNotice(`Done: ${text}`)
                  if (removed) setSelected(null)
                }}
              />
            </section>
          )}
          <section className="rounded-lg border border-border bg-card p-3">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">To fix ({issues.length})</h2>
            {issues.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">Nothing — every link is in place.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {issues.map((i) => (
                  <li key={`${i.node.id}|${i.text}`}>
                    <button className="w-full rounded px-1 py-0.5 text-left text-xs hover:bg-muted" onClick={() => focus(i.node.id)}>
                      <b>{i.node.label}</b> — {i.text}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-lg border border-border bg-card p-3 text-xs">
            <h2 className="mb-1 font-semibold tracking-wide text-muted-foreground uppercase">Legend</h2>
            <ul className="grid grid-cols-2 gap-1">
              {(Object.keys(LABELS) as MapLevel[]).map((l) => (
                <li key={l} className="flex items-center gap-1">
                  <span className={`inline-flex h-4 min-w-4 items-center justify-center rounded px-0.5 text-[9px] font-bold text-white ${COLORS[l]}`}>{LABELS[l].short}</span>
                  {LABELS[l].label}
                </li>
              ))}
            </ul>
            {view === 'people' && (
              <p className="mt-2 text-muted-foreground">
                <span className="text-emerald-600">- - -</span> group sees plant · <span className="text-teal-600">——</span> user is in group
              </p>
            )}
          </section>
        </aside>
      </div>
    </MapUi.Provider>
  )
}
