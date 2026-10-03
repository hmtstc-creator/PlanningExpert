import { ChevronRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import {
  companiesOf,
  departmentsOf,
  orphanCompanies,
  sameNode,
  unassignedOf,
  type OrgCompany,
  type OrgHolding,
  type OrgNode,
} from '../lib/orgTree'

/**
 * Organizasyon ağacı (diyagram): Holding → Company → Plant → Department →
 * Cost center. Her seviyenin rengi ve harfi sabittir; düğüme tıklayınca
 * sağdaki (telefonda alttaki) panel o düğümü yönetir.
 */

export type Level = 'holding' | 'company' | 'plant' | 'department' | 'costCenter'

export const LEVEL_INFO: Record<Level, { label: string; short: string; chip: string }> = {
  holding: { label: 'Holding', short: 'H', chip: 'bg-indigo-600 text-white' },
  company: { label: 'Company', short: 'C', chip: 'bg-sky-600 text-white' },
  plant: { label: 'Plant', short: 'P', chip: 'bg-emerald-600 text-white' },
  department: { label: 'Department', short: 'D', chip: 'bg-amber-500 text-white' },
  costCenter: { label: 'Cost center', short: 'CC', chip: 'bg-slate-500 text-white' },
}

export function LevelChip({ level, className = '' }: { level: Level; className?: string }) {
  const l = LEVEL_INFO[level]
  return (
    <span title={l.label} className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-1 text-[10px] font-bold ${l.chip} ${className}`}>
      {l.short}
    </span>
  )
}

/** Seviyelerin zinciri: sayfanın üstünde yapının kendisi. */
export function LevelLegend() {
  const levels: Level[] = ['holding', 'company', 'plant', 'department', 'costCenter']
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" aria-label="Levels">
      {levels.map((l, i) => (
        <li key={l} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden>→</span>}
          <span className="flex items-center gap-1 rounded-full border border-border bg-background py-0.5 pr-2 pl-0.5">
            <LevelChip level={l} className="rounded-full" />
            <span className="font-medium text-foreground">{LEVEL_INFO[l].label}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

interface Props {
  holdings: OrgHolding[]
  companies: OrgCompany[]
  selected: OrgNode | null
  onSelect: (n: OrgNode) => void
  /** General: holding'siz şirketi bir holding'e bağlayabilir. */
  canLink: boolean
}

export function OrgTree({ holdings, companies, selected, onSelect, canLink }: Props) {
  // Açık / kapalı düğümler; plant'e kadar açık başlar, bölümler kapalı.
  const [closed, setClosed] = useState<Set<string>>(() => new Set())
  const [openDepts, setOpenDepts] = useState<Set<string>>(() => new Set())
  const toggle = (key: string) =>
    setClosed((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  const toggleDept = (key: string) =>
    setOpenDepts((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  const company = (c: OrgCompany) => (
    <Row
      key={c._id}
      level="company"
      label={c.name}
      meta={`${c.plants.length} plant${c.plants.length === 1 ? '' : 's'}`}
      muted={c.status !== 'active'}
      selected={sameNode(selected, { kind: 'company', id: c._id })}
      onSelect={() => onSelect({ kind: 'company', id: c._id })}
      open={!closed.has(c._id)}
      onToggle={c.plants.length ? () => toggle(c._id) : undefined}
    >
      {c.plants.map((p) => {
        const loose = unassignedOf(p)
        const depts = departmentsOf(p)
        return (
          <Row
            key={p._id}
            level="plant"
            label={p.name}
            meta={`${depts.length} dept · ${p.costCenters?.length ?? 0} CC`}
            warn={!depts.length || loose.length > 0}
            selected={sameNode(selected, { kind: 'plant', id: p._id })}
            onSelect={() => onSelect({ kind: 'plant', id: p._id })}
            open={!closed.has(p._id)}
            onToggle={depts.length || loose.length ? () => toggle(p._id) : undefined}
          >
            {depts.map((d) => {
              const key = `${p._id}|${d.name}`
              return (
                <Row
                  key={key}
                  level="department"
                  label={d.name}
                  meta={`${d.costCenters.length} CC`}
                  warn={!d.costCenters.length}
                  selected={sameNode(selected, { kind: 'department', plantId: p._id, department: d.name })}
                  onSelect={() => onSelect({ kind: 'department', plantId: p._id, department: d.name })}
                  open={openDepts.has(key)}
                  onToggle={d.costCenters.length ? () => toggleDept(key) : undefined}
                >
                  {d.costCenters.map((cc) => (
                    <Leaf key={cc.code} code={cc.code} name={cc.name} onSelect={() => onSelect({ kind: 'department', plantId: p._id, department: d.name })} />
                  ))}
                </Row>
              )
            })}
            {loose.length > 0 && (
              <Row
                level="department"
                label="Without a department"
                meta={`${loose.length} CC`}
                warn
                dashed
                selected={sameNode(selected, { kind: 'department', plantId: p._id, department: null })}
                onSelect={() => onSelect({ kind: 'department', plantId: p._id, department: null })}
                open={openDepts.has(`${p._id}|`)}
                onToggle={() => toggleDept(`${p._id}|`)}
              >
                {loose.map((cc) => (
                  <Leaf key={cc.code} code={cc.code} name={cc.name} onSelect={() => onSelect({ kind: 'department', plantId: p._id, department: null })} />
                ))}
              </Row>
            )}
          </Row>
        )
      })}
    </Row>
  )

  const orphans = orphanCompanies(holdings, companies)
  return (
    <div className="text-sm">
      {holdings.map((h) => {
        const list = companiesOf(h._id, companies)
        return (
          <Row
            key={h._id}
            level="holding"
            label={h.name}
            meta={`${list.length} compan${list.length === 1 ? 'y' : 'ies'}`}
            warn={!list.length}
            selected={sameNode(selected, { kind: 'holding', id: h._id })}
            onSelect={() => onSelect({ kind: 'holding', id: h._id })}
            open={!closed.has(h._id)}
            onToggle={list.length ? () => toggle(h._id) : undefined}
          >
            {list.map(company)}
          </Row>
        )
      })}
      {orphans.length > 0 && (
        <div className="mt-3 rounded-md border border-dashed border-amber-400 bg-amber-50/60 p-2">
          <p className="mb-1 text-xs font-medium text-amber-900">{canLink ? 'No holding — open the company and choose its holding' : 'Not linked to a holding yet — a General links it'}</p>
          {orphans.map(company)}
        </div>
      )}
    </div>
  )
}

function Row({
  level,
  label,
  meta,
  warn,
  muted,
  dashed,
  selected,
  onSelect,
  open,
  onToggle,
  children,
}: {
  level: Level
  label: string
  meta?: string
  warn?: boolean
  muted?: boolean
  dashed?: boolean
  selected: boolean
  onSelect: () => void
  open: boolean
  /** Yoksa çocuk yok (ok gösterilmez). */
  onToggle?: () => void
  children?: ReactNode
}) {
  return (
    <div className="relative">
      <div
        className={`flex items-center gap-1.5 rounded-md py-1 pr-1.5 pl-0.5 ${selected ? 'bg-primary/10 ring-1 ring-primary/40' : 'hover:bg-muted'} ${muted ? 'opacity-60' : ''}`}
      >
        <button
          type="button"
          aria-label={open ? 'Collapse' : 'Expand'}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background ${onToggle ? '' : 'invisible'}`}
          onClick={onToggle}
        >
          <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
        </button>
        <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={onSelect}>
          <LevelChip level={level} className={dashed ? 'opacity-60' : ''} />
          <span className={`truncate ${level === 'holding' || level === 'company' ? 'font-semibold' : ''} ${dashed ? 'italic text-amber-900' : 'text-foreground'}`}>{label}</span>
          {warn && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" title="Something is missing here" />}
          {meta && <span className="ml-auto shrink-0 pl-2 text-[11px] text-muted-foreground">{meta}</span>}
        </button>
      </div>
      {open && children && (
        <div className="ml-[13px] border-l border-border pl-2.5 [&>*]:before:absolute [&>*]:before:top-[15px] [&>*]:before:-left-2.5 [&>*]:before:w-2 [&>*]:before:border-t [&>*]:before:border-border [&>*]:before:content-['']">
          {children}
        </div>
      )}
    </div>
  )
}

function Leaf({ code, name, onSelect }: { code: string; name: string; onSelect: () => void }) {
  return (
    <div className="relative">
      <button type="button" onClick={onSelect} className="flex w-full items-center gap-1.5 rounded-md py-1 pr-1.5 pl-6 text-left hover:bg-muted">
        <LevelChip level="costCenter" />
        <span className="font-mono text-xs">{code}</span>
        <span className="truncate text-xs text-muted-foreground">{name !== code ? name : ''}</span>
      </button>
    </div>
  )
}
