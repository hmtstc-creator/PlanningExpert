import { useState } from 'react'

import { api } from '../../../convex/_generated/api'
import { ErrorBanner } from '../ErrorBanner'
import { useQueryOnce } from '../../lib/convexTransport'
import type { OrgCompany } from '../../lib/orgTree'
import { MODULES, MODULE_LABELS, type Module } from '../../lib/tenancy'
import { useSafeMutation } from '../../lib/useSafeMutation'

/**
 * Şirketin ayarları — tek kaynak: Holdings & companies paneli ve Organization
 * map'in şirket düğümü aynı bileşenleri kullanır.
 * - `CompanyStatusModules` (General): askıya al / yeniden aç, kiralanan modüller.
 * - `CompanyDataActions` (creator ya da General): dışa aktarım; kalıcı silme
 *   (General, askıdan 90 gün sonra, şirket adı yazılarak; geri alınamaz).
 * Yetki ve korumalar sunucudadır (`platform.updateCompany`, `deleteCompany`).
 */

export type CompanyInfo = OrgCompany & { deleteAfter?: number }

const btn = 'rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50'

export function CompanyStatusModules({ company: c }: { company: CompanyInfo }) {
  const { run: updateCompany, error, clearError, pending } = useSafeMutation(api.platform.updateCompany)
  const save = (patch: { modules?: string[]; status?: CompanyInfo['status'] }) =>
    updateCompany({ id: c._id, name: c.name, modules: (patch.modules ?? c.modules) as Module[], status: patch.status ?? c.status })

  return (
    <div className="space-y-2 text-xs">
      <ErrorBanner message={error} onDismiss={clearError} />
      <div className="flex flex-wrap items-center gap-2">
        {c.status !== 'active' && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">suspended</span>}
        <button
          className={btn}
          disabled={pending}
          onClick={() => {
            const next = c.status === 'active' ? 'suspended' : 'active'
            const msg = next === 'suspended' ? `Suspend ${c.name}? Everybody reads only; data can be deleted after 90 days.` : `Reactivate ${c.name}?`
            if (window.confirm(msg)) void save({ status: next })
          }}
        >
          {c.status === 'active' ? 'Suspend' : 'Reactivate'}
        </button>
      </div>
      {c.status !== 'active' && c.deleteAfter && (
        <p className="text-amber-900">Suspended — data can be deleted after {new Date(c.deleteAfter).toISOString().slice(0, 10)}.</p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-muted-foreground">Modules rented:</span>
        {MODULES.map((m) => (
          <label key={m} className="flex items-center gap-1">
            <input
              type="checkbox"
              disabled={pending}
              checked={c.modules.includes(m)}
              onChange={(e) => void save({ modules: e.target.checked ? [...c.modules, m] : c.modules.filter((x) => x !== m) })}
            />
            {MODULE_LABELS[m]}
          </label>
        ))}
      </div>
    </div>
  )
}

export function CompanyDataActions({ company: c, isPlatform }: { company: CompanyInfo; isPlatform: boolean }) {
  const tablesOf = useQueryOnce(api.platform.exportTables)
  const pageOf = useQueryOnce(api.platform.exportPage)
  const { run: deleteCompany, error, clearError } = useSafeMutation(api.platform.deleteCompany)
  const [progress, setProgress] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const canDelete = isPlatform && c.status === 'suspended' && !!c.deleteAfter && Date.now() >= c.deleteAfter

  const exportAll = async () => {
    setFailed(null)
    try {
      const tables = (await tablesOf({ companyId: c._id })) as string[]
      const plants: Record<string, { name: string; tables: Record<string, unknown[]> }> = {}
      for (const p of c.plants) {
        plants[p._id] = { name: p.name, tables: {} }
        for (const table of tables) {
          const rows: unknown[] = []
          let cursor: string | null = null
          for (;;) {
            setProgress(`${p.name} · ${table} · ${rows.length}`)
            const r = (await pageOf({ companyId: c._id, plantId: p._id, table, cursor })) as { page: unknown[]; isDone: boolean; continueCursor: string }
            rows.push(...r.page)
            if (r.isDone) break
            cursor = r.continueCursor
          }
          if (rows.length) plants[p._id].tables[table] = rows
        }
      }
      const file = { company: { name: c.name, modules: c.modules, status: c.status }, exportedAt: new Date().toISOString(), plants }
      const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${c.name.replace(/[^\w-]+/g, '_')}_export_${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e))
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
      <ErrorBanner message={error ?? failed} onDismiss={() => (clearError(), setFailed(null))} />
      <button className={btn} disabled={!!progress} onClick={() => void exportAll()}>
        {progress ? `Exporting… ${progress}` : 'Export data (JSON)'}
      </button>
      {canDelete && (
        <button
          className="rounded-md border border-destructive px-2 py-1 text-destructive hover:bg-destructive/10"
          onClick={() => {
            // İki adım: onay, sonra şirket adını yazma (sunucu da adı denetler).
            if (!window.confirm(`Delete ${c.name} and ALL its plant data permanently? This cannot be undone — export first.`)) return
            const typed = window.prompt('Type the company name to confirm:')
            if (typed !== null) void deleteCompany({ id: c._id, confirmName: typed })
          }}
        >
          Delete permanently
        </button>
      )}
    </div>
  )
}
