import { useMemo, useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { draftAreaLevel, groupDraft, groupPayload, type GroupDraft, type PeopleGroup } from '../../lib/peopleTree'
import { MODULES, MODULE_LABELS, areasOf, type Level, type Module } from '../../lib/tenancy'
import { useSafeMutation } from '../../lib/useSafeMutation'
import { ErrorBanner } from '../ErrorBanner'
import { LevelChip } from '../OrgTree'
import { InfoTip } from '../PageHeader'

/**
 * Bir grubun erişimi: Board grubu, gördüğü plant'ler ve modül / alan izin
 * matrisi. Users & permissions (GroupPanel) ve Organization map (grup düğümü,
 * `GroupAccessForm`) aynı alanları kullanır; kural src/lib/tenancy.ts, kayıt
 * `users.saveGroup` (sunucu aynı kuralla denetler).
 */

const input = 'rounded-md border border-input bg-background px-2 py-1.5 text-sm'
const td = 'px-3 py-2'
const tdc = 'px-1.5 py-1'

export const LEVEL_TEXT: Record<Level, string> = { none: 'No access', view: 'Views', edit: 'Edits' }

/** İzin hücresi: düzenler = dolu, görür = çerçeve, yok = çizgi. */
export function LevelCell({ level, title, text }: { level: Level; title?: string; text?: string }) {
  if (level === 'none')
    return (
      <span title={title ?? LEVEL_TEXT.none} className="text-xs text-muted-foreground/60">
        —
      </span>
    )
  return (
    <span
      title={title ?? LEVEL_TEXT[level]}
      className={`inline-block rounded px-1.5 py-px text-[10px] font-semibold ${level === 'edit' ? 'bg-emerald-600 text-white' : 'border border-emerald-600 text-emerald-700'}`}
    >
      {text ?? (level === 'edit' ? 'Edit' : 'View')}
    </span>
  )
}

function LevelSelect({ value, onChange, inherit, className = '' }: { value: Level | ''; onChange: (v: Level | '') => void; inherit?: Level; className?: string }) {
  return (
    <select className={`${input} py-1 text-xs ${className}`} value={value} onChange={(e) => onChange(e.target.value as Level | '')}>
      {inherit !== undefined && <option value="">Same as module ({LEVEL_TEXT[inherit].toLowerCase()})</option>}
      <option value="none">No access</option>
      <option value="view">Views</option>
      <option value="edit">Edits</option>
    </select>
  )
}

function ModuleRows({ module: m, d, setD, compact }: { module: Module; d: GroupDraft; setD: (d: GroupDraft) => void; compact: boolean }) {
  const cell = compact ? tdc : td
  return (
    <>
      <tr className="border-t border-border bg-muted/40">
        <td className={`${cell} font-semibold text-foreground`}>{MODULE_LABELS[m]}</td>
        <td className={cell}>
          <LevelSelect value={d.modules[m]} onChange={(v) => setD({ ...d, modules: { ...d.modules, [m]: (v || 'none') as Level } })} className={compact ? 'w-full' : ''} />
        </td>
        {!compact && (
          <td className={cell}>
            <LevelCell level={d.modules[m]} />
          </td>
        )}
      </tr>
      {areasOf(m).map((a) => {
        const level = draftAreaLevel(d, a.key)
        const own = d.areas[a.key]
        return (
          <tr key={a.key} className="border-t border-border">
            <td className={`${cell} ${compact ? 'pl-3' : 'pl-8'}`}>
              <span className="block text-sm" title={compact ? a.hint : undefined}>
                {a.label}
              </span>
              {!compact && <span className="block text-[11px] text-muted-foreground">{a.hint}</span>}
            </td>
            <td className={cell}>
              <LevelSelect
                value={own && own !== d.modules[m] ? own : ''}
                inherit={d.modules[m]}
                onChange={(v) => setD({ ...d, areas: { ...d.areas, [a.key]: v } })}
                className={`${compact ? 'w-full' : ''} ${own && own !== d.modules[m] ? 'border-violet-500' : ''}`}
              />
            </td>
            {!compact && (
              <td className={cell}>
                <LevelCell level={level} />
              </td>
            )}
          </tr>
        )
      })}
    </>
  )
}

/** Board grubu, plant'ler ve izin matrisi — taslak üzerinde (kayıt çağıranda). */
export function GroupAccessFields({
  d,
  setD,
  plants,
  modules,
  compact = false,
}: {
  d: GroupDraft
  setD: (d: GroupDraft) => void
  plants: { _id: string; name: string }[]
  modules: Module[]
  compact?: boolean
}) {
  const h3 = compact ? 'mt-3 text-xs font-semibold text-foreground' : 'mt-5 text-sm font-semibold text-foreground'
  return (
    <>
      <label className={`${compact ? 'mt-2 text-xs' : 'mt-3 text-sm'} flex items-start gap-2`}>
        <input type="checkbox" className="mt-0.5 h-4 w-4" checked={d.board} onChange={(e) => setD({ ...d, board: e.target.checked })} />
        <span>
          Board group
          <span className="block text-xs text-muted-foreground">Members use the board view only: Board Dashboard and the KPI / OEE dashboards, read only.</span>
        </span>
      </label>

      <h3 className={h3}>Plants</h3>
      <div className={`mt-1 flex flex-wrap gap-x-4 gap-y-1 ${compact ? 'text-xs' : 'text-sm'}`}>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={d.allPlants} onChange={(e) => setD({ ...d, allPlants: e.target.checked })} />
          All plants <span className="text-xs text-muted-foreground">(plants added later too)</span>
        </label>
        {!d.allPlants &&
          plants.map((p) => (
            <label key={p._id} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={d.plantIds.includes(p._id)}
                onChange={(e) => setD({ ...d, plantIds: e.target.checked ? [...d.plantIds, p._id] : d.plantIds.filter((x) => x !== p._id) })}
              />
              <LevelChip level="plant" /> {p.name}
            </label>
          ))}
      </div>

      <h3 className={`${h3} flex items-center gap-1.5`}>
        Permissions
        <InfoTip label="Module and area levels">
          <p>The module level applies to all its areas. Set an area apart only where it differs — e.g. PlanningExpert views, Work calendar edits.</p>
          <p>“Same as module” follows the module when it changes later.</p>
        </InfoTip>
      </h3>
      <div className={`mt-2 rounded-lg border border-border ${compact ? '' : 'overflow-x-auto'}`}>
        <table className={`w-full ${compact ? 'table-fixed text-xs' : 'text-sm'}`}>
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th className={`${compact ? tdc : 'px-3 py-2'} text-left font-medium`}>Module / area</th>
              <th className={`${compact ? `${tdc} w-[55%]` : 'px-3 py-2'} text-left font-medium`}>Level</th>
              {!compact && <th className="px-3 py-2 text-left font-medium">Result</th>}
            </tr>
          </thead>
          <tbody>
            {modules.map((m) => (
              <ModuleRows key={m} module={m} d={d} setD={setD} compact={compact} />
            ))}
          </tbody>
        </table>
      </div>
      {modules.length < MODULES.length && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Not rented by the company: {MODULES.filter((m) => !modules.includes(m)).map((m) => MODULE_LABELS[m]).join(', ')}.
        </p>
      )}
    </>
  )
}

/**
 * Organization map → grup düğümü: erişim formu ve kaydet. Ad haritada
 * *Rename* ile değişir; burada taslaktaki ad grubun adı olarak kalır.
 */
export function GroupAccessForm({
  group,
  companyId,
  company,
}: {
  group: PeopleGroup
  companyId: string
  company: { modules: string[]; plants: { _id: string; name: string }[] }
}) {
  const save = useSafeMutation(api.users.saveGroup)
  const [d, setD] = useState<GroupDraft>(() => groupDraft(group))
  const base = useMemo(() => JSON.stringify(groupPayload(groupDraft(group))), [group])
  // Ad haritada ayrı değişir: kayıtta her zaman grubun güncel adı gider.
  const payload = groupPayload({ ...d, name: group.name })
  const dirty = JSON.stringify(payload) !== base
  const modules = MODULES.filter((m) => company.modules.includes(m))

  return (
    <div>
      <GroupAccessFields d={d} setD={setD} plants={company.plants} modules={modules} compact />
      <div className="mt-2 flex items-center gap-2">
        <button
          className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
          disabled={!dirty || save.pending}
          onClick={() => void save.run({ id: group._id, companyId, ...payload })}
        >
          {save.pending ? 'Saving…' : 'Save access'}
        </button>
        {dirty && (
          <button className="text-xs underline" onClick={() => setD(groupDraft(group))}>
            Discard
          </button>
        )}
      </div>
      <ErrorBanner message={save.error} onDismiss={save.clearError} />
    </div>
  )
}
